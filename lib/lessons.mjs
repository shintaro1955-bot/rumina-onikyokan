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

/** 埋め込みが許可されているか。禁止の動画をiframeに入れると黒画面になるので、貼る前に見る。
    調べられなかったときは「許可されている」として扱う（貼れないよりは貼れたほうがよい）。 */
export async function checkEmbeddable(id) {
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + id, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await r.text();
    const m = html.match(/"playableInEmbed":(true|false)/);
    return { known: !!m, embeddable: m ? m[1] === 'true' : true };
  } catch (e) { return { known: false, embeddable: true }; }
}

export function setVideo(code, input, title, opts = {}) {
  if (!one(code)) return { ok: false, why: 'その章がありません' };
  const id = videoId(input);
  if (!id) return { ok: false, why: 'YouTubeのURLまたは動画IDを入れてください' };
  const r = root();
  r[code] ||= [];
  if (r[code].some(v => v.yt === id)) return { ok: false, why: 'この章にはすでに貼られています' };
  const v = { yt: id, title: String(title || '').trim() || null, at: new Date().toISOString() };
  if (opts.noEmbed) v.noEmbed = true;      // 埋め込み禁止。YouTubeで開くリンクにする
  r[code].push(v);
  save();
  return { ok: true, yt: id, noEmbed: !!v.noEmbed };
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
   会社に及ぶうえ、こちらで中身を確かめきれないため。

   貼る前に、チャンネルの持ち主を裏取りする。チャンネル名が社名になっているだけでは
   足りない（実際、社名を名乗る販売店のチャンネルが検索上位に出る）。
   about ページか動画の説明文から、その会社・官庁のドメインへのリンクを確認する。
   確認できたもの:
     経済産業省(資源エネルギー庁) metichannel  UCAMvYSb3oO7oQpcaHZQYv7A  → meti.go.jp
     消費者庁 / CAA                           UCxYpWT3DELDs8_uks1hKuUw  → caa.go.jp
     国民生活センター                          UCh1FFDfkrworkAZUFKHKKAg  → kokusen.go.jp
     長州産業株式会社                          UCp4z115uhqEYBwurx3r2k9g
     シャープ公式チャンネル SHARP               UCyO-5z7HgokQwzdniinnngA
     ニチコン株式会社／nichicon                UCnPPlzP3nUcOw5GJx_nvUYA  → nichicon.co.jp
     Channel Panasonic - Official            UCOcdBuUur7MiKPdHQUM_8IA  → channel.panasonic.com
     DMMエナジー                              UCGnyXJgDZT9sekVctdzHg7w  → 説明文が energy.dmm.com
   裏取りできず、入れていないもの:
     オムロン エネルギーソリューション / OMRON   UCgOrlpKptNDxMXg5QNYw9gw  → 外部リンクなし */
const SEED_VIDEOS = {
  /* 玄関先（STEP1）── 買う側から見た訪問販売。自分の言い方を疑うために見る */
  'L1-02': [{ yt: 'CdqLOVJEfMU', title: '布団の処分を口実にした強引な訪問販売に注意（国民生活センター 公式・6分40秒）' }],
  'L1-03': [{ yt: 'nbHuzaSJtyU', title: '消費者を保護する制度の内容を知ろう（消費者庁 公式・5分57秒）' }],
  'L1-04': [{ yt: 'xdQZQct8QWU', title: '高齢者・障害者の消費者被害と見守り（消費者庁 公式・7分09秒）' }],

  /* 商材と制度（STEP2）── 制度の説明は国の動画をそのまま見せる。言い換えで事故を起こさない */
  'L2-01': [{ yt: 'HNm08ZsGUr4', title: '資源エネルギー庁×鷹の爪「みんなで支える再生可能エネルギー」（経済産業省 公式・10分03秒）' }],
  'L2-02': [{ yt: '_YG5THeHCJw', title: '再生可能エネルギーってなに？（経済産業省 公式・1分36秒）' }],
  'L2-03': [{ yt: 'Klba6lkIm4s', title: 'エネルギーシステムのある暮らし（シャープ 公式）' }],
  'L2-04': [
    { yt: 'n945Hn4mdN8', noEmbed: true, title: 'ＦＩＴ制度って何だろう？（経済産業省 公式・1分54秒）' },
    { yt: 'uePA0kD58CA', title: 'ＦＩＰ制度について（経済産業省 公式・3分29秒）' },
    { yt: 'NKHimAZg8aI', noEmbed: true, title: '新しい制度ではどうなるの？（経済産業省 公式・2分37秒）' },
    { yt: 'P90luMrEkXc', noEmbed: true, title: '太陽光発電の廃棄費用積立て制度（経済産業省 公式・21分58秒／必要なところだけで可）' },
  ],
  'L2-07': [{ yt: 'xqau01KpvBw', noEmbed: true, title: 'ＦＩＴ制度からの卒業って何？（経済産業省 公式・2分22秒）' }],
  'L2-10': [
    { yt: 'Qy1TRTj3t2g', title: 'COCORO ENERGY の紹介（シャープ 公式）' },
    { yt: 'HZctY0fB-9c', title: '蓄電池AI制御のご紹介（シャープ 公式・2分12秒）' },
  ],
  'L2-11': [
    { yt: 'GpvBbD_OmSQ', title: 'お客さまインタビュー Vol.1（長州産業 公式）' },
    { yt: 'A8VJ3AfjnbY', title: 'お客さまインタビュー Vol.2（長州産業 公式）' },
    { yt: 'KBGWNOrQz9A', title: 'スマートPVマルチ 初期設定（長州産業 公式）' },
    { yt: 'WA7fVsXgSQ4', title: '国産太陽光パネルの工場見学（長州産業 公式・5分23秒）' },
    { yt: 'Hxa_nYMRMk0', title: 'テレビCM「充電中と発電中」篇（長州産業 公式・31秒）' },
  ],
  'L2-12': [
    { yt: 'nQePABmUhD8', title: 'トライブリッド蓄電システム ESS-T5／T6 商品紹介（ニチコン 公式・4分37秒）' },
    { yt: 'OXX0UMmnEjo', title: '住宅用創蓄連携システム 平常時のはたらき（パナソニック 公式・31秒）' },
  ],
  'L2-13': [{ yt: 'shNGlsxjOOk', title: 'DMM.make smart ハイブリッド型 蓄電システム（DMMエナジー 公式・16秒）' }],
  'L2-14': [
    { yt: 'q-csdXP8nvc', title: 'SHARPの太陽光「Eeeストレージ 棒に振る」篇（シャープ 公式・37秒）' },
    { yt: '_yBQYdlXCHM', title: 'シャープのホームエネルギーソリューション（シャープ 公式・18分13秒）' },
  ],

  /* 法令（STEP3）── 出どころが役所であること自体に意味がある */
  'L3-01': [{ yt: 'EZvr3sD_ijs', title: '契約と消費者を守る法制度（消費者庁 公式・10分45秒／若手従業員向け研修プログラム）' }],
  'L3-02': [{ yt: '9aP61cYnY-k', title: '特定商取引法・預託法等改正 事業者説明会（消費者庁 公式・55分27秒／長いので通しでなくてよい）' }],
  'L3-04': [
    { yt: 'zTBn37uElG8', title: '消費生活センターの役割と相談の仕方を知ろう（消費者庁 公式・5分19秒）' },
    { yt: 'MlLfQt_zLzc', title: '消費者ホットライン「188（いやや）」に相談しよう（国民生活センター 公式・18秒）' },
  ],
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
