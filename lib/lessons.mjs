/* ============================================================
   教材（読み物）

   これまでの「教材」は、テストの問題に一言解説を付けて並べただけだった。
   答えは覚えられるが、**なぜそうなのか・現場で何と言うのか**が無い。
   228問のうち223問が解説60字未満、特商法のトーク例は0件。
   それでは初めて太陽光に触れる人は学べない。

   ここで持つのは、章立ての読み物。
   ・狙い（これを読むと何が言えるようになるか）
   ・本文（なぜそうなのか。間違えやすいところ）
   ・トーク（現場での言い方）
   ・図（文字だけでは入らないもの）
   ・出典（自社資料・カタログ・条文）
   ・関連する問題（読んだ内容がどの問題になるか）

   元資料はリポジトリに入れない（PPA研修182MB・SHARPカタログ64MB）。
   **中身を読み物に起こして持つ**。原本の場所は source に残す。
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(new URL('..', import.meta.url).pathname, 'seed', 'lessons.json');

let CACHE = null;
function all() {
  if (CACHE) return CACHE;
  try { CACHE = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []; }
  catch (e) { console.error('[lessons] 読み込み失敗:', e.message); CACHE = []; }
  return CACHE;
}
export function reload() { CACHE = null; return all().length; }
export function count() { return all().length; }

/** そのSTEPで読む章。順番どおりに返す。 */
export function forStep(step) {
  return all().filter(l => l.step === Number(step)).sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** 1章ぶん。 */
export function one(code) { return all().find(l => l.code === code) || null; }

/** 目次（本文は返さない。一覧を軽くするため） */
export function indexOf(step) {
  return forStep(step).map(l => ({
    code: l.code, title: l.title, aim: l.aim, minutes: l.minutes,
    sections: (l.sections || []).length, quiz: (l.quiz || []).length,
  }));
}
