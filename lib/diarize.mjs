/* ============================================================
   Phase 3 — 話者分離（DiarizationProvider）
   Whisperは話者を出さないため、各セグメントに speaker='sales'|'customer'
   を付与する。既定は「発話内容＋ターン構造」ベースのヒューリスティック
   （依存ゼロ・音響分離ではない）。音響分離が必要なら acoustic プロバイダ
   （AssemblyAI等）に差し替える。
   ============================================================ */

// 営業側の定型・お客様側の定型（役割語彙）
const SALES = /(電気代|無料診断|明細|検針|太陽光|蓄電池|オール電化|こんにちは|回って|ご確認|させて|ちなみに|見させて|キャンペーン|お住まい|いかがですか|失礼します|担当|ご案内|30秒|少しだけ)/;
const CUSTOMER = /(大丈夫|忙しい|間に合って|いらない|結構です|興味|うちは|主人|旦那|妻|賃貸|持ち家|借家|今ちょっと|分からない|関係ない|いいです|必要ない|やってる|もう(付け|入れ))/;
const VISIT_GAP = 60; // これ以上の無音は別訪問＝次の口開けは営業と仮定

/**
 * ヒューリスティック話者分離。
 * @param {Array<{startSec,endSec,text}>} segments
 * @returns {Array} speaker と diarConfidence を付与した新配列
 */
export function heuristicDiarize(segments) {
  let prev = null, prevEnd = -1e9;
  return segments.map((s, i) => {
    const newVisit = s.startSec - prevEnd > VISIT_GAP;
    const sales = (s.text.match(SALES) || []).length;
    const cust = (s.text.match(CUSTOMER) || []).length;
    const q = /[?？]/.test(s.text);

    let score = sales - cust;
    if (newVisit) score += 2;          // 訪問の口開けは営業
    else if (prev) score += (prev === 'customer' ? 0.6 : -0.6); // 会話は交互になりやすい
    if (q) score += 0.4;               // 質問は営業（訪販は営業が問いを投げる）

    const speaker = score >= 0 ? 'sales' : 'customer';
    const conf = Math.min(1, 0.5 + Math.abs(score) * 0.18);
    prev = speaker; prevEnd = s.endSec;
    return { ...s, speaker, diarConfidence: +conf.toFixed(2) };
  });
}

/**
 * 音響話者分離アダプタ（差し替え用スケルトン）。
 * AssemblyAI / Deepgram / pyannote 等の話者ラベルを
 * { speaker:'sales'|'customer' } に正規化して返す実装をここに入れる。
 * 音源側の「営業＝装着マイクで音量大」等の前提で sales/customer を対応付ける。
 */
export async function acousticDiarize(/* segments, audioPath, opts */) {
  throw Object.assign(new Error('acoustic diarization provider is not configured'), { code: 'NO_DIARIZER' });
}

export function diarize(segments, method = 'heuristic') {
  if (method === 'none' || !segments.length) return segments.map(s => ({ ...s, speaker: null }));
  if (method === 'acoustic') {
    // インポート等で既にラベル済みならそのまま尊重。無ければヒューリスティックに退避。
    if (segments.some(s => s.speaker === 'sales' || s.speaker === 'customer')) return segments.map(s => ({ ...s }));
    return heuristicDiarize(segments);
  }
  return heuristicDiarize(segments); // 既定
}
