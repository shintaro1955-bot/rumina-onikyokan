/* ============================================================
   「今日この人に送ったか」の共有台帳

   LINEを送る経路が4本ある（入力リマインド／録音提出の催促／先週比／配信管制）。
   それぞれが自分の都合で送ると、同じ日に同じ人へ何通も届く。
   読まれなくなった瞬間に、この仕組みは全部意味を失う。
   そこで**送った事実だけを1か所に集め**、各経路は送る前にここを見る。

   ここは台帳だけを持つ。誰に何を送るかは決めない（決めるのは lib/dispatch.mjs）。
   経路間で参照するので、どの経路にも依存しないように独立させている。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';

const FILE = join(DATA_DIR, 'sendlog.json');

function nowJst() { return new Date(Date.now() + 9 * 3600 * 1000); }
export function jstDate(d = nowJst()) { return d.toISOString().slice(0, 10); }
export function jstHour() { return nowJst().getUTCHours(); }
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

export function load() {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
  return { log: {} };   // { [氏名]: [{ day, reason, by }] }
}
export function save(s) { try { writeFileSync(FILE, JSON.stringify(s)); } catch (e) { console.error('[sendlog] 保存失敗:', e.message); } }

/* 直近28日ぶんだけ残す（際限なく太らせない） */
export function prune(s) {
  const today = jstDate();
  s.log ||= {};
  for (const k of Object.keys(s.log)) {
    s.log[k] = (s.log[k] || []).filter(x => daysBetween(x.day, today) <= 28);
    if (!s.log[k].length) delete s.log[k];
  }
  return s;
}

/** 今日この人へ、どれかの経路が既に送っているか。送る前に必ず見る。 */
export function sentToday(name) {
  if (!name) return false;
  const today = jstDate();
  return ((load().log || {})[name] || []).some(x => x.day === today);
}

/** 直近7日に送った通数（週の上限を見るため）。 */
export function sentThisWeek(name) {
  if (!name) return 0;
  const today = jstDate();
  return ((load().log || {})[name] || []).filter(x => daysBetween(x.day, today) < 7).length;
}

/** 同じ理由を最後に送った日（連投を避けるため）。 */
export function lastSentFor(name, reason) {
  if (!name) return null;
  return ((load().log || {})[name] || []).filter(x => x.reason === reason).map(x => x.day).sort().pop() || null;
}

/** 送ったことを記録する。by＝どの経路か（あとで内訳を見るため）。 */
export function mark(name, reason, by) {
  if (!name) return;
  const s = prune(load());
  (s.log[name] ||= []).push({ day: jstDate(), reason, by });
  save(s);
}

/** 本人ぶんの履歴（マイページ用。他人のものは返さない）。 */
export function historyOf(name) {
  return ((load().log || {})[name] || []).slice().reverse();
}

/** 直近の全体像（owner用）。 */
export function recent(days = 7) {
  const s = load(); const today = jstDate();
  const rows = [];
  for (const [name, xs] of Object.entries(s.log || {})) {
    for (const x of xs) if (daysBetween(x.day, today) < days) rows.push({ name, ...x });
  }
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return rows;
}
