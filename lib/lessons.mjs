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
import { getDb, save } from './store.mjs';

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

/** 1章ぶん（動画も付けて返す）。 */
export function one(code) {
  const l = all().find(x => x.code === code);
  if (!l) return null;
  return { ...l, videos: videosOf(code) };
}

/** 目次（本文は返さない。一覧を軽くするため） */
export function indexOf(step) {
  return forStep(step).map(l => ({
    code: l.code, title: l.title, aim: l.aim, minutes: l.minutes,
    sections: (l.sections || []).length, quiz: (l.quiz || []).length,
    videos: videosOf(l.code).length,
  }));
}

/* ---- 章に貼る動画（YouTube） ----
   種のJSONには入れない。動画は差し替わるし、どれを貼るかは会社が決めること。
   管理画面から貼って、db側に持つ。
   埋め込みは youtube-nocookie を使う（視聴履歴を残さない）。 */
function root() {
  const db = getDb();
  db.training ||= {};
  db.training.lessonVideos ||= {};
  return db.training.lessonVideos;
}

/** URLでも動画IDでも受ける。取れなければ null。 */
export function videoId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function videosOf(code) { return root()[code] || []; }

export function setVideo(code, input, title) {
  if (!one(code)) return { ok: false, why: 'その章がありません' };
  const id = videoId(input);
  if (!id) return { ok: false, why: 'YouTubeのURLまたは動画IDを入れてください' };
  const r = root();
  r[code] ||= [];
  if (r[code].some(v => v.yt === id)) return { ok: false, why: 'この章にはすでに貼られています' };
  r[code].push({ yt: id, title: String(title || '').trim() || null, at: new Date().toISOString() });
  save();
  return { ok: true, yt: id };
}

export function removeVideo(code, id) {
  const r = root();
  if (!r[code]) return { ok: false, why: 'ありません' };
  const n = r[code].length;
  r[code] = r[code].filter(v => v.yt !== id);
  save();
  return { ok: r[code].length < n };
}
