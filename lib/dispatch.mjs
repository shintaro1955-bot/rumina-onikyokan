/* ============================================================
   毎日の配信管制（研修が要る人へ、1人1日1通だけ）

   なぜ「管制」なのか：
   このアプリには既にLINEを送る経路が3本ある（入力リマインド／録音提出の催促／
   先週比のお知らせ）。ここに研修の催促を4本目として足すと、同じ日に同じ人へ
   4通届く。読まれなくなった瞬間に、この仕組みは全部死ぬ。
   そこで**送る・送らないを決める場所をここ1か所に集約**し、他の3本は
   「今日この人に誰かが送ったか」をここへ問い合わせてから送る。

   決めごと（営業教育部_RULE）：
   ・名指しは**本人へのDMだけ**。グループに個人の低調な数値は貼らない。
   ・示す他人の数字は**トップの実績と全体の傾向のみ**。同僚の低い数字は出さない。
   ・**確度が保証できない個人数値は突きつけない**。
     cyzenのアポは計上漏れが実在するので、**アポ報告が0件の人にトークの指導は送らない**
     （訪問70件でアポ0は、トークが崩れているのではなく報告が抜けている可能性が高い）。
     こういう人は送信対象から外して「人が確認する」側へ回す。
   ・**休職・離脱の可能性がある人へ自動送信しない**（稼働が急に落ちた人）。
   ・人格否定はしない。事実 → 次の一手だけ書く。絵文字は使わない。

   安全設計（既存の3本と同じ）：
   ・既定はドライラン。DISPATCH_ENABLED=on かつ LINE_MESSAGING_TOKEN がある時だけ実送信。
   ・1人1日1通／週◯通まで／同じ理由は中◯日あけないと再送しない。
   ・LINE未連携の人には物理的に送れないので「未到達」として仕分けるだけ。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getDb } from './store.mjs';
import * as cyzen from './cyzen.mjs';
import * as training from './training.mjs';
import { resolveLineIds } from './reminders.mjs';
import * as sendlog from './sendlog.mjs';
import * as fieldcheck from './fieldcheck.mjs';
import { jstDate, jstHour, daysBetween } from './sendlog.mjs';

const ON = /^(1|true|yes|on)$/i.test(process.env.DISPATCH_ENABLED || '');
const TOKEN = process.env.LINE_MESSAGING_TOKEN || '';
const HOUR = Number(process.env.DISPATCH_HOUR || 17);            // JST この時刻台に1回
const WEEK_CAP = Number(process.env.DISPATCH_WEEK_CAP || 2);     // 1人あたり週◯通まで
const COOLDOWN = Number(process.env.DISPATCH_COOLDOWN_DAYS || 3);// 同じ理由は中◯日あける
const STATE_FILE = join(DATA_DIR, 'dispatch.json');

export function config() {
  return { enabled: ON, canSend: !!(ON && TOKEN), tokenSet: !!TOKEN, hour: HOUR, weekCap: WEEK_CAP, cooldownDays: COOLDOWN };
}

/* 送った事実は lib/sendlog.mjs に集約する（4本の経路で共有するため）。
   ここが持つのは「今日もう流したか」だけ。 */
function loadRun() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  return {};
}
function saveRun(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('[dispatch] state保存失敗:', e.message); } }

/* ---- 文面（事実 → 次の一手。絵文字なし） ---- */
function msgTraining(name, step, title) {
  return [
    `${name}さん、おつかれさまです。`,
    `営業解禁の研修が STEP${step}（${title}）で止まっています。`,
    'アプリの「研修」から受けられます。ここを通すまでは現場に出る前の段階です。',
    '分からないところがあれば、受ける前に聞いてください。',
  ].join('\n');
}
/* 未解禁なのに訪問記録がある人。同じ「研修が止まっている」でも、
   もう現場に出てしまっている以上、伝えることが違う。 */
function msgTrainingOnField(name, step, title, v) {
  return [
    `${name}さん、おつかれさまです。`,
    `直近で訪問${v.visits}件の記録が上がっていますが、営業解禁の研修が STEP${step}（${title}）で止まったままです。`,
    '解禁前に現場に出ることは、会社として認められません。特商法の段（STEP3）を通していない状態での勧誘は、本人にも会社にも責任が及びます。',
    'いったん訪問を止めて、アプリの「研修」を先に通してください。上長にもこの状態を共有しています。',
  ].join('\n');
}
function msgTalk(name, r, std) {
  const L = [
    `${name}さん、おつかれさまです。`,
    `稼働${r.days}日で、訪問は1日あたり ${r.vpd}件。量は足りています。アポ率は ${r.apoRate}% でした。`,
  ];
  if (std.source === 'top') L.push(`同じくらいの訪問数から、${std.name}さんはアポ率 ${std.apoRate}% を出しています。回る数ではなく、玄関先で決まっている差です。`);
  L.push('今日の録音を1本アプリに上げてください。崩れている局面に合わせてロープレの課題が出ます。');
  return L.join('\n');
}

/* 名簿の正本はcyzen。アプリに登録していなくても、訪問している以上は対象になる。
   いきなり研修の進み具合を言っても通じないので、まず登録から案内する。 */
function msgRegister(name, visits) {
  return [
    `${name}さん、おつかれさまです。`,
    `直近14日で訪問${visits}件の記録が上がっていますが、営業解禁の研修アプリにまだ登録がありません。`,
    '全員が受ける決まりです。ポータルからLINEでログインして、お名前を選ぶと登録されます。',
    '登録が済んだら、アプリの「研修」から順に受けてください。ここを通すまでは現場に出る前の段階です。',
  ].join('\n');
}

/* 判定A：訪問そのものが足りない。量は本人が今日から動かせるので、数で示す。 */
function msgVisits(name, r, std) {
  const L = [
    `${name}さん、おつかれさまです。`,
    `稼働${r.days}日で、訪問は1日あたり ${r.vpd}件でした。`,
  ];
  if (std.source === 'top') L.push(`いま一番出している${std.name}さんは1日 ${std.visitsPerDay}件です。差は ${Math.max(0, Math.round((std.visitsPerDay - r.vpd) * 10) / 10)}件／日。`);
  else L.push(`社の基準は1日 ${std.visitsPerDay}件です。`);
  L.push('トークの前に、まず回る数です。明日の訪問予定を朝のうちに決めてから出てください。');
  return L.join('\n');
}

/* 判定C：訪問もアポも出ているが、成約まで届いていない。
   成約率は件数が少ないと振れるので、文面でも母数を必ず添える。 */
function msgClose(name, r, std) {
  return [
    `${name}さん、おつかれさまです。`,
    `訪問とアポは出ています。直近の成約は ${r.closed}件で、成約率は ${r.closeRate}% でした（母数が小さいと振れます）。`,
    `社の目安は ${std.closeRate}% です。止まっているのは玄関先ではなく、最後の詰めのところです。`,
    '商談の録音を1本アプリに上げてください。切り返しと2択クロージングの局面を見ます。',
  ].join('\n');
}

/* ---- 誰に送り、誰を人に回すか ----
   ここが配信管制の判断の中心。副作用を持たせず、入力だけで決まるようにしてある
   （cyzenの1行・社の基準・直近の傾向を渡すと、送る／人へ回す／見送る のどれかを返す）。

   送らない側に倒す場面を先に書いているのは、迷ったときに送らないほうへ倒すため。
   訪問販売の現場で、機械から的外れな催促が届くのが一番よくない。 */
export function classify(x, std, trendRow) {
  if (x.isCloser) return { action: 'skip', reason: 'closer', why: 'クローザーは対象外' };
  if (x.seg === 'S') return { action: 'skip', reason: 'top', why: 'トップ水準。送るものがない' };

  // 稼働が急に落ちた人は、どの判定でも自動送信しない。
  // 休職・離脱・体調の可能性があり、機械が催促してよい場面ではない。
  const t = trendRow;
  const atRisk = t && t.priDays > 0 && ((t.recDays <= 2 && t.recDays <= t.priDays * 0.5) || t.recVpd === 0);
  if (atRisk) return { action: 'review', reason: 'atrisk', why: '稼働が急に落ちています。自動連絡はせず、人が状況を確認してください。' };

  // 判定D・E＝数字が低いのではなく、そもそも測れていない。
  if (x.seg === 'D') return { action: 'review', reason: 'low', why: `稼働${x.days}日。数字の指導ではなく、まず状況を確認してください。` };
  if (x.seg === 'E') return { action: 'review', reason: 'record', why: '期間中の報告書がありません。評価できないので、報告の出し方から確認してください。' };

  // アポ報告が0件＝計上漏れの疑い。トークや成約の指導を送ると誤指導になる。
  if (!x.apo && x.seg !== 'A') {
    return { action: 'review', reason: 'record', why: `訪問${x.visits}件に対してアポ報告が0件。指導ではなく報告の出し方を確認してください。` };
  }

  if (x.seg === 'A') {
    if (std.visitsPerDay && x.vpd >= std.visitsPerDay * 0.8) {
      return { action: 'skip', reason: 'visits', why: `訪問${x.vpd}件/日はトップ(${std.visitsPerDay}件)に近く、送る差がありません` };
    }
    return { action: 'send', reason: 'visits' };
  }
  if (x.seg === 'B') {
    // トップに肉薄している人にまで催促を送らない。差がわずかな相手に「型が崩れている」と
    // 言うのは事実に合わないし、通知そのものが読まれなくなる。
    if (std.apoRate && x.apoRate >= std.apoRate * 0.7) {
      return { action: 'skip', reason: 'talk', why: `アポ率${x.apoRate}%はトップ(${std.apoRate}%)に近く、送る差がありません` };
    }
    return { action: 'send', reason: 'talk' };
  }
  if (x.seg === 'C') {
    // 成約率は母数が小さいと振れる。確度が保証できない数字を本人に突きつけない。
    if (!(x.closed >= 3)) {
      return { action: 'review', reason: 'thin', why: `成約${x.closed}件では成約率が振れます。数字を突きつけず、人が見てください。` };
    }
    return { action: 'send', reason: 'close' };
  }
  return { action: 'skip', reason: 'other', why: '該当する判定がありません' };
}

/* ---- 対象の算出（すべて決定論。AIは使わない） ---- */
/**
 * 1人につき理由は1つだけ。上から順に見て、最初に当たったものを採る。
 *  1) アプリに未登録なのに訪問している … 名簿の正本はcyzen。まず登録から
 *  2) 研修ゲート未通過（アプリ登録者）… 現場に出る前の段階なので優先
 *  3) cyzenの判定A … 訪問そのものが足りない（量）
 *  4) cyzenの判定B … 訪問は足りているがアポ率が低い（トークの質）
 *  5) cyzenの判定C … 訪問もアポも出ているが成約まで届かない（クロージング）
 *
 * **自動で送らないもの**
 *  判定D（稼働そのものが低い）・判定E（報告書なし）・稼働が急に落ちた人・
 *  アポ報告0件・成約が3件未満。いずれも数字が低いのではなく、そもそも測れていない、
 *  あるいは休職や離脱の可能性がある。機械が催促してよい場面ではないので、人に回す。
 */
export async function plan({ date = '' } = {}) {
  const day = date || jstDate();
  const std = cyzen.standard();
  const out = { ready: true, day, std, pick: [], review: [], skipped: [] };

  /* --- 1) 研修ゲート ---
     **名簿の正本はcyzen**。アプリの登録者だけを回すと、登録していない人に
     1通も届かない。実測で、訪問しているのにアプリ未登録の人が78名いた
     （訪問650件の主力を含む）。cyzenに出ている以上は対象にする。 */
  const seen = new Set();

  // 1-a) 訪問しているのにアプリに登録すらしていない人。ここが一番届いていない層。
  let fcOut = null;
  try { fcOut = fieldcheck.fieldCheck({ days: 14 }); } catch (e) { fcOut = null; }
  if (fcOut && fcOut.ready) {
    // 未登録の人にもcyzenの判定は出ている。1人1通なので登録を先に出すが、
    // 「この人は判定Bでもある」が管理側に見えないと、あとで二度手間になる。
    const segOf = new Map((cyzen.roster({}).rows || []).map(x => [x.name, x.seg]));
    for (const u of (fcOut.unregistered || [])) {
      if (!u.name || seen.has(u.name)) continue;
      const seg = segOf.get(u.name) || null;
      out.pick.push({
        // 上限の外には置かない。78名に毎日飛ばすと、読まれなくなって逆効果になる。
        // 週2通・同じ理由は中3日、の通常の抑制をそのままかける。
        name: u.name, code: u.code, reason: 'register', visits: u.visits, seg,
        message: msgRegister(u.name, u.visits),
      });
      seen.add(u.name);
    }
  }

  let trs = [];
  try { trs = training.roster(); } catch (e) { trs = []; }
  for (const t of trs) {
    const db = getDb();
    const u = db.users[t.user] || {};
    if (u.role === 'owner') continue;             // 管理者は対象外
    if (u.isModel) continue;                      // 起動時seedのダミー
    if (t.status === 'cleared') continue;
    if (t.status === 'suspended') {               // 停止中は自動で催促しない（人が話す場面）
      out.review.push({ name: t.name, why: '研修が停止中です。再開は人が判断してください。', reason: 'training' });
      continue;
    }
    let step = 1, title = training.STEPS[1].title;
    try { const o = training.overview(t.user); step = o.unlocked || 1; title = (training.STEPS[step] || training.STEPS[1]).title; } catch (e) {}
    // 未解禁なのに現場に出ている人は、同じ「研修の催促」でも中身を変える。
    let v = null;
    try { v = fieldcheck.myViolation({ name: t.name, username: t.user }); } catch (e) {}
    out.pick.push({
      name: t.name, user: t.user, reason: 'training', step, onField: !!v,
      message: v ? msgTrainingOnField(t.name, step, title, v) : msgTraining(t.name, step, title),
    });
    seen.add(t.name);
  }

  /* --- 2) cyzenの判定（A＝量／B＝トーク／C＝詰め） --- */
  const r = cyzen.roster({});
  if (r.ready) {
    // 直近の傾向。稼働が急に落ちた人を自動送信から外すために使う。
    const tr = cyzen.trends({ recentDays: 7 });
    const trend = new Map((tr.rows || []).map(x => [x.code, x]));
    for (const x of r.rows) {
      if (!x.name || seen.has(x.name)) continue;
      const c = classify(x, std, trend.get(x.code));
      if (c.action === 'skip') { if (c.reason !== 'top' && c.reason !== 'closer') out.skipped.push({ name: x.name, seg: x.seg, reason: c.reason, why: c.why }); continue; }
      if (c.action === 'review') { out.review.push({ name: x.name, seg: x.seg, reason: c.reason, why: c.why }); continue; }
      const msg = c.reason === 'visits' ? msgVisits(x.name, x, std)
                : c.reason === 'talk'   ? msgTalk(x.name, x, std)
                : msgClose(x.name, x, std);
      out.pick.push({ name: x.name, code: x.code, reason: c.reason, seg: x.seg, vpd: x.vpd, apoRate: x.apoRate, closeRate: x.closeRate, message: msg });
      seen.add(x.name);
    }
  }

  /* --- 送りすぎの抑制（台帳は4本の経路で共有） --- */
  const today = jstDate();
  const keep = [];
  for (const p of out.pick) {
    // 未解禁のまま現場に出ている件だけは、上限や間隔より優先して届ける。
    if (p.onField) { keep.push(p); continue; }
    if (sendlog.sentToday(p.name)) { out.skipped.push({ ...p, why: '今日はもう送っています（別の連絡を含む）' }); continue; }
    const week = sendlog.sentThisWeek(p.name);
    if (week >= WEEK_CAP) { out.skipped.push({ ...p, why: `今週すでに${week}通送っています（上限${WEEK_CAP}通）` }); continue; }
    const last = sendlog.lastSentFor(p.name, p.reason);
    if (last && daysBetween(last, today) < COOLDOWN) { out.skipped.push({ ...p, why: `同じ内容を${daysBetween(last, today)}日前に送っています（中${COOLDOWN}日あけます）` }); continue; }
    keep.push(p);
  }
  out.pick = keep;

  /* --- LINEに届くか --- */
  const { byName, byCode, source } = await resolveLineIds(out.pick.map(p => p.name));
  const reachable = [], unreachable = [];
  for (const p of out.pick) {
    const lineId = byName.get(p.name) || (byCode && p.code ? byCode.get(String(p.code)) : null) || null;
    if (lineId) reachable.push({ ...p, lineId }); else unreachable.push(p);
  }
  out.reachable = reachable; out.unreachable = unreachable; out.source = source;
  out.summary = {
    register: out.pick.filter(p => p.reason === 'register').length,
    training: out.pick.filter(p => p.reason === 'training').length,
    visits: out.pick.filter(p => p.reason === 'visits').length,
    talk: out.pick.filter(p => p.reason === 'talk').length,
    close: out.pick.filter(p => p.reason === 'close').length,
    reachable: reachable.length, unreachable: unreachable.length,
    review: out.review.length, skipped: out.skipped.length,
  };
  return out;
}

async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
}

/** 1回分。live=false（既定）は下書きを返すだけで送らない。 */
export async function runOnce({ live = false } = {}) {
  const p = await plan();
  const canSend = !!(ON && TOKEN) && live;
  let sent = 0; const failed = [];
  if (canSend) {
    for (const r of p.reachable) {
      try { await pushLine(r.lineId, r.message); sendlog.mark(r.name, r.reason, 'dispatch'); sent++; }
      catch (e) { failed.push({ name: r.name, error: e.message }); }
    }
  }
  return {
    ...p, live, enabled: ON, tokenSet: !!TOKEN, sent, failed,
    note: canSend ? `${sent}件送信しました。`
      : (!live ? '下書きです（送信していません）。'
        : !ON ? 'DISPATCH_ENABLED=on が未設定です。' : 'LINEの送信設定がありません。'),
  };
}

/* ---- 毎日1回だけ走らせる ----
   Railwayはコンテナが落ちると再起動するので「起動時に1回」は当てにならない。
   30分ごとに起きて、JST HOUR 台で、その日まだ流していなければ流す。 */
let timer = null;
function ranToday() { return loadRun().lastRun === jstDate(); }
function markRun() { const s = loadRun(); s.lastRun = jstDate(); saveRun(s); }

export function startScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      if (jstHour() !== HOUR || ranToday()) return;
      const r = await runOnce({ live: true });
      markRun();
      console.log(`[dispatch] ${r.note} 研修${r.summary.training}／トーク${r.summary.talk}／未到達${r.summary.unreachable}／要確認${r.summary.review}`);
    } catch (e) { console.error('[dispatch]', e.message); }
  };
  timer = setInterval(tick, 30 * 60 * 1000);
  console.log(`✓ 毎日の配信管制 起動（JST ${HOUR}時台・${ON && TOKEN ? '実送信' : 'ドライラン'}／1人1日1通・週${WEEK_CAP}通まで）`);
}
