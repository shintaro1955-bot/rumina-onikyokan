/* ============================================================
   録音の提出リマインド（一日のトークコーチの燃料を切らさない）

   狙い：診断ログが上がらないと、日次のトークコーチも弱点ロープレも
   一切動かない。「今日回ったのに録音を出していない人」を出して、
   夕方にやさしく促す。

   安全設計（reminders.mjs と同じ流儀）：
   - 既定はドライラン。RECMIND_ENABLED=on かつ LINE_MESSAGING_TOKEN が
     あるときだけ実送信する。
   - 到達可能＝ポータルで本人選択済み（氏名→lineId が引ける）人のみ。
     未連携には物理的に送れないので「未連携」として仕分けるだけ。
   - 1人1日1通まで。クワイエット時間の外では送らない。
   - 誰が出したか／出していないかの判定は決定論（cyzenの稼働 × 診断ログ）。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getDb } from './store.mjs';
import * as cyzen from './cyzen.mjs';
import { resolveLineIds } from './reminders.mjs';

const ON = /^(1|true|yes|on)$/i.test(process.env.RECMIND_ENABLED || '');
const TOKEN = process.env.LINE_MESSAGING_TOKEN || '';
const QUIET_START = Number(process.env.RECMIND_QUIET_START || 16);   // JST これ以降に送る（稼働終わりごろ）
const QUIET_END = Number(process.env.RECMIND_QUIET_END || 22);       // JST これ未満まで
const STATE_FILE = join(DATA_DIR, 'recmind.json');

export function config() {
  return { enabled: ON, canSend: !!(ON && TOKEN), tokenSet: !!TOKEN, quietStart: QUIET_START, quietEnd: QUIET_END };
}

// JSTの現在時刻（Railwayは既定UTCなので+9）
function nowJst() { return new Date(Date.now() + 9 * 3600 * 1000); }
function jstDate(d = nowJst()) { return d.toISOString().slice(0, 10); }
function jstHour(d = nowJst()) { return d.getUTCHours(); }

function loadState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  return { date: '', sent: {} };
}
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('[recmind] state保存失敗:', e.message); } }
function todayState() {
  const s = loadState(); const d = jstDate();
  if (s.date !== d) { s.date = d; s.sent = {}; saveState(s); }
  return s;
}

/* 診断ログの索引から「その日、誰が出したか」を引く。
   索引は氏名(salesRepName)とログイン名(user)の両方を持つので、どちらでも当てる。 */
function submittedIndex(date) {
  // 1本の録音は氏名(salesRepName)とログイン名(user)の両方を持つ。照合はどちらでも当てたいので
  // 別名ごとに引けるようにしつつ、**録音のidを持たせて後で重複を潰す**（同じ1本が2人分に見えるため）。
  const byName = new Map();   // 氏名/別名 → {count, pings, at, ids:Set}
  for (const r of (getDb().reports || [])) {
    const d = r.date || String(r.at || '').slice(0, 10);
    if (d !== date) continue;
    const aliases = new Set();
    if (r.name) aliases.add(r.name);
    const un = r.user ? userNameOf(r.user) : null; if (un) aliases.add(un);
    for (const k of aliases) {
      const cur = byName.get(k) || { count: 0, pings: 0, at: null, ids: new Set() };
      if (!cur.ids.has(r.id)) { cur.count++; cur.pings += (r.pings || 0); cur.ids.add(r.id); }
      if (!cur.at || String(r.at) > String(cur.at)) cur.at = r.at;
      byName.set(k, cur);
    }
  }
  return { byName };
}

/* ログイン名 → 氏名（診断ログが user しか持たない場合の橋渡し） */
function userNameOf(username) {
  const u = (getDb().users || {})[username];
  return u ? (u.name || u.username) : null;
}

/**
 * その日の提出状況。
 * 母集団＝cyzenでその日"回った"人（訪問件数・訪問スタンプ・勤務開始のいずれかがある）。
 * cyzenが無い環境では、診断ログを出した人だけを並べる（母集団が作れないので未提出は出さない）。
 */
export function submissions({ date } = {}) {
  const day = date || cyzen.latestDate() || jstDate();
  const { byName } = submittedIndex(day);
  const rows = [];
  const seen = new Set();
  if (cyzen.ready()) {
    for (const rec of cyzen.records()) {
      if (rec.date !== day) continue;
      const worked = (rec.visitsSelf > 0) || (rec.visitStamp > 0) || !!rec.workStart || !!rec.workEnd;
      if (!worked) continue;
      const name = cyzen.userName(rec.code) || null;
      if (!name) continue;
      const s = byName.get(name) || null;
      rows.push({ code: rec.code, name, visits: rec.visitsSelf || 0,
        submitted: !!s, recordings: s ? s.count : 0, pings: s ? s.pings : 0, at: s ? s.at : null });
      seen.add(name);
    }
  }
  // cyzenに居ないが録音は出している人（アップロードだけの人）も落とさない。
  // ただし同じ録音を別名でもう一度並べない（氏名とログイン名で二重に出る）。
  const emitted = new Set();
  for (const name of seen) { const v = byName.get(name); if (v) for (const id of v.ids) emitted.add(id); }
  for (const [name, v] of byName) {
    if (seen.has(name)) continue;
    if ([...v.ids].every(id => emitted.has(id))) continue;   // その録音はもう誰かの行で数えている
    rows.push({ code: null, name, visits: null, submitted: true, recordings: v.count, pings: v.pings, at: v.at });
    for (const id of v.ids) emitted.add(id);
  }

  rows.sort((a, b) => (a.submitted === b.submitted) ? (b.visits || 0) - (a.visits || 0) : (a.submitted ? 1 : -1));
  const missing = rows.filter(r => !r.submitted);
  return {
    ready: true, date: day, cyzenReady: cyzen.ready(),
    rows, total: rows.length, submitted: rows.length - missing.length, missing: missing.length,
  };
}

/** 本人ぶんの提出状況（トップ画面の「今日の録音、出せた？」用・軽い）。 */
export function mine({ username, name, date } = {}) {
  const day = date || jstDate();
  const { byName } = submittedIndex(day);
  const alias = name || (username ? userNameOf(username) : null);
  const v = (alias && byName.get(alias)) || (username ? byName.get(userNameOf(username)) : null) || null;
  // その人が出した日の一覧（新しい順・最大14日）。「昨日のコーチを見る」の出し分けに使う。
  const days = [];
  for (const r of (getDb().reports || [])) {
    const d = r.date || String(r.at || '').slice(0, 10);
    if (!d) continue;
    const un = r.user ? userNameOf(r.user) : null;
    if (r.name !== alias && un !== alias && r.user !== username) continue;
    if (!days.includes(d)) days.push(d);
  }
  days.sort().reverse();
  return { date: day, submitted: !!v, recordings: v ? v.count : 0, pings: v ? v.pings : 0, at: v ? v.at : null, days: days.slice(0, 14) };
}

function message(name, visits) {
  const v = (visits && visits > 0) ? `今日は${visits}件まわったね。` : '今日もおつかれさま。';
  return [
    `${name}さん、おつかれさま！`,
    `${v}録音、まだ上がってないみたい👀`,
    '出しておくと、明日の朝に「どこで崩れたか・明日の言い方」が出るよ。',
    'アプリの「稼働終了・録音を出稿」から、今日のぶんをどうぞ。― Rumina',
  ].join('\n');
}

/** 未提出かつLINEに届く人を出す。 */
export async function targets({ date } = {}) {
  const s = submissions({ date });
  const missing = s.rows.filter(r => !r.submitted);
  const { byName, byCode, source } = await resolveLineIds(missing.map(r => r.name));
  const reachable = [], unreachable = [];
  for (const r of missing) {
    const lineId = byName.get(r.name) || (byCode && r.code ? byCode.get(String(r.code)) : null) || null;
    if (lineId) reachable.push({ ...r, lineId, message: message(r.name, r.visits) });
    else unreachable.push(r);
  }
  return { ...s, reachable, unreachable, source };
}

async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
}

/** 1回分の実行。live=false（既定）はドライラン＝送らず、送る内容だけ返す。 */
export async function runOnce({ date, live = false } = {}) {
  const t = await targets({ date });
  const h = jstHour();
  const quiet = h < QUIET_START || h >= QUIET_END;
  const st = todayState();
  const out = [], skipped = [];
  for (const r of t.reachable) {
    if (st.sent[r.name]) { skipped.push({ name: r.name, why: '本日送信済み' }); continue; }
    out.push(r);
  }
  const canSend = !!(ON && TOKEN) && live && !quiet;
  let sent = 0, failed = [];
  if (canSend) {
    for (const r of out) {
      try { await pushLine(r.lineId, r.message); st.sent[r.name] = Date.now(); sent++; }
      catch (e) { failed.push({ name: r.name, error: e.message }); }
    }
    saveState(st);
  }
  return {
    ...t, hour: h, quiet, live, enabled: ON, tokenSet: !!TOKEN,
    wouldSend: out.map(r => ({ name: r.name, visits: r.visits, message: r.message })),
    skipped, sent, failed,
    note: canSend ? `${sent}件送信しました。` : (!live ? '下書きです（送信していません）。' : quiet ? `送信時間外です（JST ${QUIET_START}〜${QUIET_END}時）。` : !ON ? 'RECMIND_ENABLED=on が未設定です。' : 'LINEの送信設定がありません。'),
  };
}
