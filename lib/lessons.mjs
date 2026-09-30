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
  // 同梱のものを外したときは、次の起動で戻らないように覚えておく
  const db = getDb();
  db.training.removedVideos ||= [];
  const key = code + ':' + id;
  if (!db.training.removedVideos.includes(key)) db.training.removedVideos.push(key);
  save();
  return { ok: r[code].length < n };
}

/* ---- 最初に入れておく動画（確認済みの公式チャンネルのものだけ） ----
   一度だけ入れる。管理画面で外したら、次の起動で戻らない（外した記録を残す）。
   公式チャンネル以外は入れない。代理店や解説者のチャンネルは、内容の責任が
   会社に及ぶうえ、こちらで中身を確かめきれないため。 */
const SEED_VIDEOS = {
  'L2-11': [
    { yt: 'GpvBbD_OmSQ', title: 'お客さまインタビュー Vol.1（長州産業 公式）' },
    { yt: 'A8VJ3AfjnbY', title: 'お客さまインタビュー Vol.2（長州産業 公式）' },
    { yt: 'KBGWNOrQz9A', title: 'スマートPVマルチ 初期設定（長州産業 公式）' },
  ],
  'L2-03': [{ yt: 'Klba6lkIm4s', title: 'エネルギーシステムのある暮らし（シャープ 公式）' }],
  'L2-10': [{ yt: 'Qy1TRTj3t2g', title: 'COCORO ENERGY の紹介（シャープ 公式）' }],
};

export function seedVideos() {
  const db = getDb();
  db.training ||= {};
  db.training.lessonVideos ||= {};
  db.training.removedVideos ||= [];      // 外したものは戻さない
  const removed = new Set(db.training.removedVideos);
  let n = 0;
  for (const [code, vids] of Object.entries(SEED_VIDEOS)) {
    const cur = (db.training.lessonVideos[code] ||= []);
    for (const v of vids) {
      if (removed.has(code + ':' + v.yt)) continue;
      if (cur.some(x => x.yt === v.yt)) continue;
      cur.push({ ...v, at: new Date().toISOString(), seeded: true });
      n++;
    }
  }
  if (n) save();
  return { added: n };
}
