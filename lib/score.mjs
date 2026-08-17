/* ============================================================
   鬼教官の物差しでのAI採点（Claude）
   ・入力は「営業/客」ラベル付きの文字起こし（Deepgramの話者分離が前提）。
   ・出力は構造化JSON（structured outputs）。軸ごとに 0〜5 と根拠の引用。
   ・正直表示の一線：**これは参考値**。ロープレの合否など確定判定は
     roleplay.js の決定論チェックが正本で、そちらをAIで上書きしない。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.SCORE_MODEL || 'claude-opus-4-8';
const URL = 'https://api.anthropic.com/v1/messages';

export const ready = () => !!API_KEY;

/** 採点軸＝武装トークの入口3局面＋鬼教官のKPI観点。 */
export const AXES = [
  { key: 'opening', label: '冒頭10秒', crit: '名乗り3点（社名・目的・商材）を固定文言で言えたか。名乗って終わらず、質問で相手に喋らせたか。' },
  { key: 'proof', label: '地域実績の提示', crit: 'この地域・5km圏の施工実績を「数字」で先出しできたか。' },
  { key: 'bridge', label: '診断への橋渡し', crit: '玄関で商品を売り込まず、「その場で無料の電気健康診断」へ橋渡しできたか。' },
  { key: 'assoc', label: '協会の正しい説明', crit: '加盟の事実を提示しつつ、「国の機関ではない／当社は加盟事業者」を自分から言えたか（誤認させていないか）。' },
  { key: 'listen', label: 'ヒアリング', crit: '客に喋らせたか。質問が一方通行になっていないか。客の発話量が確保できているか。' },
  { key: 'rebuttal', label: '切り返し', crit: '断り文句の後に、少なくとも1回は具体的な切り返しを入れて会話を継続したか。' },
  { key: 'closing', label: 'クロージング', crit: '二択（日程など）で次アクションを取りにいったか。曖昧に終わらせていないか。' },
];

const SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'integer', description: '総合点 0〜100' },
    verdict: { type: 'string', description: '一言の総括。鬼教官の口調で、事実にだけ厳しく。' },
    axes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: AXES.map(a => a.key) },
          score: { type: 'integer', description: '0〜5' },
          evidence: { type: 'string', description: '判断根拠。該当する発言を文字起こしから短く引用する。無ければ「該当発言なし」。' },
          fix: { type: 'string', description: '明日この場面でやり直すなら何を言うか。具体的な一言で。' },
        },
        required: ['key', 'score', 'evidence', 'fix'],
        additionalProperties: false,
      },
    },
    customerTalkRatio: { type: 'string', description: '客の発話量の体感（例「少ない／半分／多い」）と、その根拠。' },
  },
  required: ['overall', 'verdict', 'axes', 'customerTalkRatio'],
  additionalProperties: false,
};

const SYSTEM = [
  'あなたは訪問販売の営業教育AI「鬼教官」。優しくないが人格否定はしない。',
  '数字・行動・発言の事実にだけ厳しく踏み込む。文字起こしに無いことは推測で断定しない。',
  '根拠(evidence)は必ず文字起こしからの引用にし、該当が無ければ「該当発言なし」と書き、その軸は低く付ける。',
  '景表法に触れる誇大表現や、公的機関と誤認させる説明を見つけたら必ず指摘する。',
].join(' ');

/**
 * @param {{labeledTranscript:string, kpis?:object, diarized?:boolean}} input
 * @returns {Promise<object|null>} 採点結果。キー未設定・失敗時は null（呼び出し側は決定論スコアのみ表示）。
 */
export async function scoreTalk({ labeledTranscript, kpis, diarized = true } = {}) {
  if (!API_KEY || !labeledTranscript) return null;
  const axisList = AXES.map(a => `- ${a.key}（${a.label}）：${a.crit}`).join('\n');
  const kpiText = kpis ? JSON.stringify(kpis) : '(なし)';
  const note = diarized
    ? '話者は音響分離で確定済み。「営業」「客」のラベルは信頼してよい。'
    : '話者ラベルは推定であり取り違えの可能性がある。話者に依存する判断は慎重に。';

  const user = [
    '次の商談の文字起こしを、鬼教官の物差しで採点してください。',
    note,
    '',
    '【採点軸（各0〜5点）】',
    axisList,
    '',
    '【機械計測済みのKPI（参考・これと矛盾する断定はしない）】',
    kpiText,
    '',
    '【文字起こし】',
    labeledTranscript.slice(0, 12000),
  ].join('\n');

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: user }],
      }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[score] Anthropic error:', j.error.message); return null; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    // 軸のラベルを補って画面でそのまま使えるようにする
    parsed.axes = (parsed.axes || []).map(x => ({ ...x, label: (AXES.find(a => a.key === x.key) || {}).label || x.key }));
    parsed.model = MODEL;
    parsed.advisory = true;   // 参考値である印（確定判定ではない）
    return parsed;
  } catch (e) {
    console.warn('[score] 失敗:', e.message);
    return null;
  }
}
