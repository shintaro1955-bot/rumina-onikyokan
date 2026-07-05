/* ============================================================
   永続ストア（依存ゼロ・JSONファイル）
   DATA_DIR/db.json に users / submissions を保存。
   ※ Railwayは既定でエフェメラル。永続化にはボリュームを
     マウントして DATA_DIR=/data を設定すること。
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.DATA_DIR || join(new URL('..', import.meta.url).pathname, 'data');
const FILE = join(DIR, 'db.json');

let db = { users: {}, submissions: {} };

(function load() {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    if (existsSync(FILE)) db = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (e) { console.error('store load failed:', e.message); }
})();

export function getDb() { return db; }
export function save() {
  try { writeFileSync(FILE, JSON.stringify(db, null, 1)); }
  catch (e) { console.error('store write failed:', e.message); }
}
