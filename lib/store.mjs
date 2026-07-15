/* ============================================================
   永続ストア（依存ゼロ・JSONファイル）
   DATA_DIR 配下に保存：
     db.json          … users / submissions / model / reports(索引)
     reports/<id>.json … 1録音=1診断ログ（KPI＋訪問明細＋文字起こし全文）
     uploads/<id>/...  … アップロード音声（任意保持）
   ※ Railwayは既定でエフェメラル。永続化には Volume をマウントして
     DATA_DIR=/data を設定すること（再デプロイで消えないのはVolume上のみ）。
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(new URL('..', import.meta.url).pathname, 'data');
const FILE = join(DATA_DIR, 'db.json');
export const REPORTS_DIR = join(DATA_DIR, 'reports');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');

const EMPTY = { users: {}, submissions: {}, model: null, reports: [] };
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
      pings: record.pingCount, user: record.user || null,
    };
    db.reports = [idx, ...(db.reports || []).filter(r => r.id !== record.id)].slice(0, LOG_CAP);
    save();
  } catch (e) { console.error('saveReport failed:', e.message); }
}
export function getReport(id) {
  try { const p = join(REPORTS_DIR, `${id}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
  catch { return null; }
}
