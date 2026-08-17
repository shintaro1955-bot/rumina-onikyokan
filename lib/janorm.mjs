/* ============================================================
   日本語の文字起こし後処理
   Deepgramの numerals は日本語に効かない（「三十八件」のまま返る）ため、
   漢数字→算用数字の変換と、ドメイン用語の誤認補正をこちら側で行う。
   方針：**誤変換しないことを最優先**。
     ① 数字の漢字を含むが数量ではない語（一般社団法人・十分 等）を先に退避
     ② 明らかな非単語だけを補正（実在する別語の置換はしない）
     ③ 漢数字は「助数詞が続くとき」に限って変換する
   ============================================================ */

/* ① 退避する語＝数字の漢字を含むが数量ではないもの。長い語から先に守る。 */
const PROTECT = [
  '一般社団法人', '一石二鳥', '一戸建て', '一戸建', '不十分', '一日中', '一通り',
  '一般', '一括', '一番', '一度', '一部', '一体', '一応', '一切', '一緒', '一方',
  '万一', '十分', '四季', '三角', '四角', '第一', '唯一', '一目', '一言',
];

/* ② ドメイン用語の誤認補正。**実在する別語は入れない**（例：業界→協会 はしない）。 */
const FIX = [
  [/検針評価|検針表|検診票|献身票|検針肥/g, '検針票'],
  [/土提案|ご堤案/g, 'ご提案'],
  [/蓄電地|蓄電値|畜電池|畜電地/g, '蓄電池'],
  [/太陽工|太陽港/g, '太陽光'],
  [/エコキュウト|エコキュード/g, 'エコキュート'],
  [/フィットファンダー|フィットファウンター|フィットファウンダ(?!ー)/g, 'フィットファウンダー'],
  [/卒[Ff][Ii][Tt]/g, '卒FIT'],
  [/オール電価|オール電気化/g, 'オール電化'],
  [/助成金支縁協会|助成金支援教会/g, '助成金支援協会'],
  [/再エネ付加金/g, '再エネ賦課金'],
];

const DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
/* 助数詞＝これが続くときだけ漢数字を数値に変換する（誤変換防止の要） */
const COUNTER = '件|人|名|分|秒|時間|時|年|月|日|円|万円|台|軒|階|回|個|割|度|kW|kWh|キロワット|パーセント|％|%|㎡|畳';
const KANJI_RUN = '[〇零一二三四五六七八九十百千万億]+';
const SEP = '';   // 保護語の番兵（本文には現れない制御文字）

/** 「三十八」「二千五百」→ 数値。解釈できなければ null。 */
function kanjiToNumber(s) {
  if (!s) return null;
  if (/^[〇零一二三四五六七八九]+$/.test(s)) {          // 位取りなしの並び（例「二三」→23）
    let out = ''; for (const c of s) out += DIGIT[c];
    return out === '' ? null : parseInt(out, 10);
  }
  let total = 0, section = 0, current = 0, ok = false;
  for (const c of s) {
    if (DIGIT[c] !== undefined) { current = DIGIT[c]; ok = true; }
    else if (c === '十') { section += (current || 1) * 10; current = 0; ok = true; }
    else if (c === '百') { section += (current || 1) * 100; current = 0; ok = true; }
    else if (c === '千') { section += (current || 1) * 1000; current = 0; ok = true; }
    else if (c === '万') { total += ((section + current) || 1) * 10000; section = 0; current = 0; ok = true; }
    else if (c === '億') { total += ((section + current) || 1) * 100000000; section = 0; current = 0; ok = true; }
    else return null;
  }
  return ok ? total + section + current : null;
}

/**
 * 文字起こし1行を正規化する。
 * @param {string} text
 * @returns {string}
 */
export function normalizeJa(text) {
  if (!text) return text;
  let s = String(text);

  // ① 保護語を番兵つきの通し番号へ退避
  const vault = [];
  for (const w of PROTECT) {
    if (!s.includes(w)) continue;
    vault.push(w);
    s = s.split(w).join(`${SEP}${vault.length - 1}${SEP}`);
  }

  // ② 誤認補正（非単語のみ）
  for (const [re, to] of FIX) s = s.replace(re, to);

  // ③-a 「二、三分」のような並列は両方まとめて変換
  s = s.replace(new RegExp(`(${KANJI_RUN})([、，])(${KANJI_RUN})(?=(?:${COUNTER}))`, 'g'),
    (m, a, sep, b) => {
      const na = kanjiToNumber(a), nb = kanjiToNumber(b);
      return (na === null || nb === null) ? m : `${na}${sep}${nb}`;
    });

  // ③-b 助数詞が続く漢数字だけを変換
  s = s.replace(new RegExp(`${KANJI_RUN}(?=(?:${COUNTER}))`, 'g'),
    (m) => { const n = kanjiToNumber(m); return n === null ? m : String(n); });

  // ④ 保護語を戻す
  s = s.replace(new RegExp(`${SEP}(\\d+)${SEP}`, 'g'), (m, i) => vault[+i]);
  return s;
}

/** セグメント配列にまとめて適用する。 */
export function normalizeSegments(segments) {
  return segments.map(s => ({ ...s, text: normalizeJa(s.text) }));
}
