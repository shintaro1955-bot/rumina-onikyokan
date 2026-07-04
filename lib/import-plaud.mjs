/* ============================================================
   Plaud NotePin 書き出し → segments[] 取り込みアダプタ
   仕様：SPEC-plaud-import.md
   出力：{ segments:[{startSec,endSec,text,speaker,confidence}], meta }
   speaker は 'sales'|'customer'|null。meta.hasSpeakers で話者分離方式を決める。
   ============================================================ */

const SALES_LEX = /(電気代|無料診断|明細|検針|太陽光|蓄電池|オール電化|こんにちは|回って|ご確認|させて|ちなみに|見させて|キャンペーン|いかがですか|失礼します|お伺い|30秒)/g;
const CUST_LEX = /(大丈夫|忙しい|間に合って|いらない|結構|興味|うちは|主人|旦那|賃貸|持ち家|関係ない|分からない|いいです)/g;

function toSec(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const p = t.split(':').map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.reduce((a, n) => a * 60 + n, 0);   // "HH:MM:SS" / "MM:SS"
}
const hits = (re, s) => (s.match(re) || []).length;

/** メイン：JSONオブジェクト / JSON文字列 / プレーンテキスト を受ける */
export function parsePlaud(input) {
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return fromJson(JSON.parse(t)); }   // [00:10:10]… のようなテキストはparse失敗→下でテキスト扱い
      catch { /* fall through */ }
    }
    return fromText(t);
  }
  return fromJson(input);
}

function fromJson(data) {
  const raw = Array.isArray(data) ? data : (data.segments || data.transcript || []);
  const segs = raw.map(s => ({
    startSec: toSec(s.start ?? s.startSec ?? s.begin ?? s.t),
    endSec: toSec(s.end ?? s.endSec ?? s.stop),
    text: String(s.text ?? s.content ?? '').trim(),
    speakerId: s.speaker ?? s.speaker_id ?? s.speakerLabel ?? null,
    confidence: s.confidence ?? s.conf ?? 0.9,
  })).filter(s => s.text);
  fixEnds(segs);
  const meta = buildMeta(data, segs);
  assignRoles(segs, meta);
  return { segments: segs.map(clean), meta };
}

function fromText(t) {
  const line = /^\s*[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*(?:(話者\s*\d+|Speaker\s*\d+|営業|お客様|客|S\d+)\s*[:：])?\s*(.+?)\s*$/;
  const segs = [];
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(line);
    if (!m) continue;
    segs.push({ startSec: toSec(m[1]), endSec: 0, text: m[3].trim(), speakerId: m[2] || null, confidence: 0.9 });
  }
  fixEnds(segs);
  const meta = buildMeta({}, segs);
  assignRoles(segs, meta);
  return { segments: segs.map(clean), meta };
}

// end が無い/不正なら次の開始 or +3秒で補完
function fixEnds(segs) {
  for (let i = 0; i < segs.length; i++) {
    if (!(segs[i].endSec > segs[i].startSec)) segs[i].endSec = segs[i + 1] ? segs[i + 1].startSec : segs[i].startSec + 3;
  }
}

function buildMeta(data, segs) {
  const m = String(data.startedAt || data.startTime || '').match(/T(\d{2}):/);
  return {
    device: data.device || null,
    recordingId: data.recordingId || null,
    durationSec: data.durationSec || data.duration || (segs.length ? Math.ceil(segs[segs.length - 1].endSec) : 0),
    startHour: m ? +m[1] : 9,
    hasSpeakers: false,   // assignRoles で確定
  };
}

/** 話者ID → 'sales'|'customer' を推定 */
function assignRoles(segs, meta) {
  // 役割が明示（営業/お客様）ならそれを直接採用
  const explicit = s => {
    if (!s.speakerId) return undefined;
    if (/営業|sales/i.test(s.speakerId)) return 'sales';
    if (/客|customer/i.test(s.speakerId)) return 'customer';
    return null;
  };
  if (segs.some(s => explicit(s) !== undefined && explicit(s) !== null)) {
    segs.forEach(s => { const e = explicit(s); s.speaker = e === undefined ? null : e; });
    meta.hasSpeakers = true;
    return;
  }

  const ids = [...new Set(segs.map(s => s.speakerId).filter(Boolean))];
  if (ids.length < 2) { segs.forEach(s => (s.speaker = null)); meta.hasSpeakers = false; return; }

  // スコア = 総発話時間 ＋ 営業語彙 − 客語彙。最大の話者を営業とみなす（全訪問に共通する声）
  const score = {};
  ids.forEach(id => (score[id] = 0));
  for (const s of segs) {
    if (!s.speakerId) continue;
    score[s.speakerId] += (s.endSec - s.startSec) + 8 * hits(SALES_LEX, s.text) - 8 * hits(CUST_LEX, s.text);
  }
  const salesId = ids.reduce((a, b) => (score[b] > score[a] ? b : a));
  segs.forEach(s => (s.speaker = s.speakerId ? (s.speakerId === salesId ? 'sales' : 'customer') : null));
  meta.hasSpeakers = true;
  meta.salesId = salesId;
}

const clean = s => ({ startSec: +s.startSec, endSec: +s.endSec, text: s.text, speaker: s.speaker ?? null, confidence: s.confidence });
