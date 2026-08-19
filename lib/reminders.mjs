/* ============================================================
   入力リマインド（2時間ごと・フレンドリー名指し）
   狙い：GPSで動いているのに勤務終了報告を入れていない現場職へ、
   1日数回・やさしく本人の名前で「入力しよ」と促す。

   安全設計：
   - 既定はドライラン（実送信しない）。REMINDER_ENABLED=on かつ
     LINE_MESSAGING_TOKEN があるときだけ実際にLINE pushする。
   - 到達可能＝LINE名寄せ済み(db.users に lineId かつ repId=cyzenコード)のみ。
     未連携の人には物理的に送れないので「未到達」として仕分けるだけ。
   - 送りすぎ防止：クワイエット時間・最短間隔・1日上限。
   - 「今日もう入力済み」の除外はライブcyzen API接続後に効く（下記 refine）。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';
import { getDb } from './store.mjs';
import * as cyzen from './cyzen.mjs';

const ON = /^(1|true|yes|on)$/i.test(process.env.REMINDER_ENABLED || '');
const TOKEN = process.env.LINE_MESSAGING_TOKEN || '';
const INTERVAL_H = Number(process.env.REMINDER_INTERVAL_HOURS || 2);
const DAILY_CAP = Number(process.env.REMINDER_DAILY_CAP || 4);
const QUIET_START = Number(process.env.REMINDER_QUIET_START || 9);   // JST これ以降に送る
const QUIET_END = Number(process.env.REMINDER_QUIET_END || 21);      // JST これ未満まで送る
const STATE_FILE = join(DATA_DIR, 'reminders.json');

export function config() {
  return { enabled: ON, canSend: !!(ON && TOKEN), tokenSet: !!TOKEN, intervalHours: INTERVAL_H, dailyCap: DAILY_CAP, quietStart: QUIET_START, quietEnd: QUIET_END };
}

// JSTの現在時刻（Railwayは既定UTCなので+9）
function nowJst() { return new Date(Date.now() + 9 * 3600 * 1000); }
function jstDate(d = nowJst()) { return d.toISOString().slice(0, 10); }
function jstHour(d = nowJst()) { return d.getUTCHours(); }

function loadState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
  return { date: '', sent: {} };
}
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('[reminders] state保存失敗:', e.message); } }
function todayState() {
  const s = loadState(); const d = jstDate();
  if (s.date !== d) { s.date = d; s.sent = {}; }   // 日付が変わったらリセット
  return s;
}

// フレンドリー名指し文面（送信回数で少し変える。LINE向けなので絵文字OK）
function friendly(name, count) {
  const variants = [
    `${name}さん、おはよう！今日も現場おつかれさま☀️ 終わったら「訪問件数」だけ入力しておこうね。あなたの頑張りがちゃんと数字で残るように。― Rumina`,
    `${name}さーん、Ruminaだよ😊 今日の訪問、忘れないうちにサッと入力しちゃお！30秒で終わるよ〜。`,
    `${name}さん、まだ今日の入力が見当たらないよ〜👀 動いた分、ちゃんと残そう！訪問件数だけでOK。`,
    `${name}さん、あと一歩！今日ぶんの報告を入れたら完璧です💪 入力よろしくね。― Rumina`,
  ];
  return variants[Math.min(count, variants.length - 1)];
}

/* リマインド対象を算出。
   ベース＝入力コンプライアンスの none/low（習慣的に入れていない現場職）。
   到達可能＝db.users に lineId があり repId が対象コードに一致（名寄せ済み）。 */
export function targets() {
  const comp = cyzen.compliance();
  if (!comp.ready) return { ready: false, needHistory: comp.needHistory, reachable: [], unreachable: [] };
  const base = comp.rows.filter(r => r.level === 'none' || r.level === 'low');
  // repId(=cyzenコード) → LINE userId の対応表
  const byCode = new Map();
  for (const u of Object.values(getDb().users)) {
    if (u.lineId && u.repId) byCode.set(String(u.repId), u.lineId);
  }
  const reachable = [], unreachable = [];
  for (const r of base) {
    const lineId = byCode.get(String(r.code));
    if (lineId) reachable.push({ code: r.code, name: r.name, level: r.level, worked: r.worked, reported: r.reported, lineId });
    else unreachable.push({ code: r.code, name: r.name, level: r.level, worked: r.worked, reported: r.reported });
  }
  return { ready: true, reachable, unreachable, total: base.length };
}

/* いま送るべき対象（クワイエット時間・最短間隔・1日上限を適用） */
export function due() {
  const t = targets(); if (!t.ready) return { ...t, due: [] };
  const h = jstHour();
  if (h < QUIET_START || h >= QUIET_END) return { ...t, due: [], reason: 'quiet-hours', hour: h };
  const st = todayState();
  const now = Date.now();
  const due = [];
  for (const r of t.reachable) {
    const rec = st.sent[r.code] || { count: 0, last: 0 };
    if (rec.count >= DAILY_CAP) continue;
    if (now - rec.last < INTERVAL_H * 3600 * 1000) continue;
    due.push({ ...r, sentToday: rec.count, message: friendly(r.name, rec.count) });
  }
  return { ...t, due };
}

async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
}

/* 1回分の実行。live=false（既定）はドライラン＝送らず記録だけ返す。 */
export async function runOnce({ live = false } = {}) {
  const d = due();
  if (!d.ready) return { ok: false, ...d };
  const willSend = live && ON && !!TOKEN;
  const st = todayState();
  const sent = [], failed = [];
  for (const r of d.due) {
    if (willSend) {
      try { await pushLine(r.lineId, r.message); }
      catch (e) { failed.push({ code: r.code, name: r.name, error: e.message }); continue; }
    }
    const rec = st.sent[r.code] || { count: 0, last: 0 };
    rec.count++; rec.last = Date.now(); st.sent[r.code] = rec;
    sent.push({ code: r.code, name: r.name, message: r.message });
  }
  if (willSend || sent.length) saveState(st);
  return { ok: true, mode: willSend ? 'live' : 'dry-run', dueCount: d.due.length, sent, failed, reachable: d.reachable.length, unreachable: d.unreachable.length, reason: d.reason || null };
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  const ms = INTERVAL_H * 3600 * 1000;
  // 起動直後は流さない。以後 INTERVAL ごとに実行（ドライランでも記録は残る）。
  timer = setInterval(() => { runOnce({ live: true }).catch(e => console.error('[reminders]', e.message)); }, ms);
  console.log(`✓ 入力リマインド スケジューラ起動（${INTERVAL_H}hごと・${ON && TOKEN ? '実送信' : 'ドライラン'}／${QUIET_START}-${QUIET_END}時JST）`);
}
