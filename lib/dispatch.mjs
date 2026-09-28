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
function msgTalk(name, r, std) {
  const L = [
    `${name}さん、おつかれさまです。`,
    `稼働${r.days}日で、訪問は1日あたり ${r.vpd}件。量は足りています。アポ率は ${r.apoRate}% でした。`,
  ];
  if (std.source === 'top') L.push(`同じくらいの訪問数から、${std.name}さんはアポ率 ${std.apoRate}% を出しています。回る数ではなく、玄関先で決まっている差です。`);
  L.push('今日の録音を1本アプリに上げてください。崩れている局面に合わせてロープレの課題が出ます。');
  return L.join('\n');
}

/* ---- 対象の算出（すべて決定論。AIは使わない） ---- */
/**
 * 1人につき理由は1つだけ。上から順に見て、最初に当たったものを採る。
 *  1) 研修ゲート未通過（アプリ登録者）… 現場に出る前の段階なので最優先
 *  2) トークの質（訪問は足りているがアポ率がトップ未満・かつアポ報告がある）
 */
export async function plan({ date = '' } = {}) {
  const day = date || jstDate();
  const std = cyzen.standard();
  const out = { ready: true, day, std, pick: [], review: [], skipped: [] };

  /* --- 1) 研修ゲート --- */
  const seen = new Set();
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
    out.pick.push({ name: t.name, user: t.user, reason: 'training', step, message: msgTraining(t.name, step, title) });
    seen.add(t.name);
  }

  /* --- 2) トークの質（cyzenの判定B） --- */
  const r = cyzen.roster({});
  if (r.ready) {
    // 稼働が急に落ちた人は自動送信しない（休職・離脱の可能性／人が確認する）
    const tr = cyzen.trends({ recentDays: 7 });
    const trend = new Map((tr.rows || []).map(x => [x.code, x]));
    for (const x of r.rows) {
      if (x.seg !== 'B' || x.isCloser || !x.name || seen.has(x.name)) continue;
      const t = trend.get(x.code);
      const atRisk = t && t.priDays > 0 && ((t.recDays <= 2 && t.recDays <= t.priDays * 0.5) || t.recVpd === 0);
      if (atRisk) { out.review.push({ name: x.name, why: '稼働が急に落ちています。自動連絡はせず、人が状況を確認してください。', reason: 'talk' }); continue; }
      // アポ報告が0件＝計上漏れの疑い。トークの指導を送ると誤指導になる。
      if (!x.apo) { out.review.push({ name: x.name, why: `訪問${x.visits}件に対してアポ報告が0件。トークではなく報告の出し方を確認してください。`, reason: 'record' }); continue; }
      // トップに肉薄している人にまで催促を送らない。差がわずかな相手に「型が崩れている」と
      // 言うのは事実に合わないし、通知そのものが読まれなくなる。トップの7割を下回る人だけ。
      if (std.apoRate && x.apoRate >= std.apoRate * 0.7) { out.skipped.push({ name: x.name, reason: 'talk', why: `アポ率${x.apoRate}%はトップ(${std.apoRate}%)に近く、送る差がありません` }); continue; }
      out.pick.push({ name: x.name, code: x.code, reason: 'talk', vpd: x.vpd, apoRate: x.apoRate, message: msgTalk(x.name, x, std) });
      seen.add(x.name);
    }
  }

  /* --- 送りすぎの抑制（台帳は4本の経路で共有） --- */
  const today = jstDate();
  const keep = [];
  for (const p of out.pick) {
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
    training: out.pick.filter(p => p.reason === 'training').length,
    talk: out.pick.filter(p => p.reason === 'talk').length,
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
