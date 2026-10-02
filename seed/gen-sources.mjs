/* ============================================================
   参照資料の台帳

   AI先生は「承認済み資料に基づいて答える」。そのために、
   **何を根拠にしたか**を資料名と更新日で出せる必要がある。
   教材の source は自由文なので、そこから日付は取れない。ここで持つ。

   updated は「資料に実際に記録されている日付」だけを入れる。
   記載が無いものは null にして、画面には「更新日の記載なし」と出す。
   推測した日付を入れない（更新日は、鮮度を信じる根拠になるため）。
   ============================================================ */
import { writeFileSync } from 'node:fs';

const S = (id, name, kind, updated, updatedNote, where, note = '') =>
  ({ id, name, kind, updated, updatedNote, where, note });

const rows = [
  /* ---- 社内資料 ---- */
  S('ff-compliance', 'FITFOUNDER コンプライアンス研修', '社内資料', '2024-10', '資料名に 2024.10 と記載',
    '07_研修_教育/FITFOUNDERコンプライアンス研修.pptx'),
  S('ff-interphone', 'FF インターフォン研修', '社内資料', '2025-02', '資料名に 2025年2月版 と記載',
    '07_研修_教育/FF_インターフォン研修_2025年2月版.pptx',
    '台本の一部に、同じ社内のコンプライアンス研修が禁止例として挙げている言い回しが残っている（2026-10-02時点で未修正）。この資料の台本をそのまま根拠にしない。'),
  S('ff-kujo', 'FITFOUNDER 苦情応対マニュアル', '社内資料', '2024-10', '資料名に 2024.10 と記載',
    '07_研修_教育/'),
  S('ff-hokumen', 'FF 北面パネル研修資料', '社内資料', null, '資料に更新日の記載なし', '07_研修_教育/'),
  S('ff-sangyo', '自社 産業用提案書', '社内資料', null, '資料に更新日の記載なし', '08_営業_提案/',
    '経年劣化 約0.4%/年 の前提はここから。'),
  S('ff-mitsumori', '自社 見積・単価表の考え方', '社内整理', null, '更新日の記載なし', '—',
    'kWあたり単価で管理するという考え方のみ。仕切り表の数値は社外秘で、教材には入れていない。'),
  S('denki-ryokin', '電気料金の構成（明細の読み方）', '社内整理', null, '更新日の記載なし', '—',
    '当年度の単価そのものは持たない（毎年変わるため）。'),

  /* ---- メーカーのカタログ・公式サイト ---- */
  S('cat-choshu', '長州産業 Smart PV Multi カタログ', 'メーカー資料', null,
    'カタログ記号 SB103 2604M（更新日としての記載ではない）', '~/Downloads/長州産業（カタログ）.pdf',
    '「業界唯一」類は自社調べ・時点つきの注記がある。注記ごと伝える。'),
  S('cat-sharp', 'SHARP 太陽光発電システム カタログ', 'メーカー資料', null, 'カタログに更新日の記載なし',
    '~/Downloads/SHARP(カタログ).pdf'),
  S('cat-dmm', 'DMM 太陽光発電システム カタログ', 'メーカー資料', '2025-11-21',
    'ファイル名 251121_2_solarsystem_catalog から', '~/Downloads/DMM（カタログ）.pdf'),
  S('cic-site', '長州産業 公式サイト（蓄電システム）', 'メーカー公式サイト', '2026-09-30', '参照した日',
    'cic-solar.jp/products/power-storage-system/',
    '蓄電容量のラインナップは改定される。案件で使う前に見直すこと。'),
  S('dmm-site', 'DMM.make smart 公式サイト', 'メーカー公式サイト', '2026-09-30', '参照した日',
    'energy.dmm.com/'),

  /* ---- 法令・公的資料 ---- */
  S('law-tokushoho', '特定商取引に関する法律（条文）', '法令', null, '改正があれば変わる。条文を直接確認すること',
    'e-Gov 法令検索'),
  S('law-shohisha', '消費者契約法（条文）', '法令', null, '改正があれば変わる', 'e-Gov 法令検索'),
  S('law-keihyo', '不当景品類及び不当表示防止法（景品表示法）', '法令', null, '改正があれば変わる', 'e-Gov 法令検索'),
  S('meti-fit', '資源エネルギー庁 FIT／FIP・買取価格の公表資料', '公的資料', null,
    '買取単価は年度ごとに改定。当年度の数値は必ず公表値を確認', 'enecho.meti.go.jp',
    '教材には当年度の単価そのものを入れていない（翌年に嘘になるため）。'),
];

const bad = [];
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.id)) bad.push([r.id, 'idが重複']); seen.add(r.id);
  if (!r.name || !r.kind) bad.push([r.id, '名前か種別がない']);
  if (!r.updatedNote) bad.push([r.id, '更新日の根拠が書かれていない']);
  if (r.updated && !/^\d{4}(-\d{2}){0,2}$/.test(r.updated)) bad.push([r.id, '更新日の形式が不正: ' + r.updated]);
  if (/[가-힣ᄀ-ᇿ㄰-㆏]/.test(JSON.stringify(r))) bad.push([r.id, 'ハングルが混入']);
}
if (bad.length) { console.error('不備:', bad); process.exit(1); }

writeFileSync(new URL('./sources.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
const withDate = rows.filter(r => r.updated).length;
console.log(`参照資料 ${rows.length}件（更新日あり ${withDate}件／記載なし ${rows.length - withDate}件）`);
