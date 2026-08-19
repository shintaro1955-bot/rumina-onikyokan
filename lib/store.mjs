/* ============================================================
   永続ストア（依存ゼロ・JSONファイル）
   DATA_DIR 配下に保存：
     db.json          … users / submissions / model / reports(索引)
     reports/<id>.json … 1録音=1診断ログ（KPI＋訪問明細＋文字起こし全文）
     uploads/<id>/...  … アップロード音声（任意保持）
   ※ Railwayは既定でエフェメラル。永続化には Volume をマウントして
     DATA_DIR=/data を設定すること（再デプロイで消えないのはVolume上のみ）。
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(new URL('..', import.meta.url).pathname, 'data');
const FILE = join(DATA_DIR, 'db.json');
export const REPORTS_DIR = join(DATA_DIR, 'reports');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');

const EMPTY = { users: {}, submissions: {}, model: null, reports: [], consents: {} };
let db = { ...EMPTY };

(function load() {
  try {
    for (const d of [DATA_DIR, REPORTS_DIR, UPLOAD_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
    if (existsSync(FILE)) db = { ...EMPTY, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch (e) { console.error('store load failed:', e.message); }
})();

export function getDb() { return db; }
export function save() {
  try { writeFileSync(FILE, JSON.stringify(db, null, 1)); }
  catch (e) { console.error('store write failed:', e.message); }
}

/* ---------- 診断ログ（1録音=1レコード） ---------- */
// 索引(db.reports)は軽量メタのみ。本体(文字起こし全文含む)は reports/<id>.json。
const LOG_CAP = +(process.env.REPORT_LOG_CAP || 1000);
export function saveReport(record) {
  try {
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(join(REPORTS_DIR, `${record.id}.json`), JSON.stringify(record));
    const idx = {
      id: record.id, at: record.at, name: record.salesRepName, date: record.date,
      source: record.source, score: record.coachScore, overall: record.overall,
      pings: record.pingCount, audio: record.audio || null, user: record.user || null,
    };
    db.reports = [idx, ...(db.reports || []).filter(r => r.id !== record.id)].slice(0, LOG_CAP);
    save();
  } catch (e) { console.error('saveReport failed:', e.message); }
}
/** 診断ログを1件削除する（JSON実体＋索引の両方）。誤って出稿したものや検証データの後始末用。 */
export function deleteReport(id) {
  let removed = false;
  try {
    const p = join(REPORTS_DIR, `${id}.json`);
    if (existsSync(p)) { unlinkSync(p); removed = true; }
    const before = (db.reports || []).length;
    db.reports = (db.reports || []).filter(r => r.id !== id);
    if (db.reports.length !== before) removed = true;
    save();
  } catch (e) { console.error('deleteReport failed:', e.message); }
  return removed;
}
export function getReport(id) {
  try { const p = join(REPORTS_DIR, `${id}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
  catch { return null; }
}

/* ===== 寺子屋（Zoom研修）=====
 * 研修はかならず鬼教官から入る運用にするため、ZoomのURLはここにだけ置く。
 * 参加すると本人のマイページに履歴が残り、その日の学びを日記として書いてもらう。
 * 翌日、マイページの先頭に「昨日の学び」として出して忘れないようにする。 */
export function getTerakoya() {
  const db = getDb();
  if (!db.terakoya) db.terakoya = { session: null, attendance: [], diaries: [] };
  return db.terakoya;
}
/** ownerが開催予定を設定（Zoom URL・日時・テーマ） */
export function setTerakoyaSession(sess) {
  const db = getDb(); const t = getTerakoya();
  t.session = {
    id: sess.id || ('tk' + Date.now().toString(36)),
    title: String(sess.title || '寺子屋').slice(0, 80),
    theme: String(sess.theme || '').slice(0, 200),
    startAt: String(sess.startAt || '').slice(0, 40),     // 例 '2026-08-21 19:00'
    zoomUrl: String(sess.zoomUrl || '').slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  save(db); return t.session;
}
/** 参加ボタンを押した記録（＝出欠。URLを配らず必ずここを通す） */
export function markAttendance(user, sessionId) {
  const db = getDb(); const t = getTerakoya();
  const rec = { user, sessionId, at: new Date().toISOString() };
  const dup = t.attendance.find((a) => a.user === user && a.sessionId === sessionId);
  if (!dup) { t.attendance.push(rec); save(db); }
  return dup || rec;
}
export function listAttendance(sessionId) {
  return getTerakoya().attendance.filter((a) => !sessionId || a.sessionId === sessionId);
}
/** その日の学び（日記）。1人1日1件で上書き */
export function saveDiary(user, day, body, sessionId) {
  const db = getDb(); const t = getTerakoya();
  const d = { user, day, body: String(body || '').slice(0, 2000), sessionId: sessionId || null, at: new Date().toISOString() };
  const i = t.diaries.findIndex((x) => x.user === user && x.day === day);
  if (i >= 0) t.diaries[i] = d; else t.diaries.push(d);
  save(db); return d;
}
export function getDiary(user, day) {
  return getTerakoya().diaries.find((x) => x.user === user && x.day === day) || null;
}
/** 直近の日記（新しい順）。マイページの振り返りに使う */
export function listDiaries(user, limit) {
  return getTerakoya().diaries.filter((x) => x.user === user)
    .sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, limit || 10);
}
