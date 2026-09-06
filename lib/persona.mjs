/* ============================================================
   AIロープレの「お客様役」（訪問販売の玄関先の家主を演じる）
   ・営業マンの練習相手。簡単には落ちない現実的な客を演じる。
   ・出力はセリフのみ（ナレーション・ラベルなし）。短く（1〜3文）。
   ・採点は別（鬼教官の決定論＝roleplay.js）。ここは相手役に徹する。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// 会話はテンポが命。速いモデルを既定に（環境変数で差し替え可）。
const MODEL = process.env.ROLEPLAY_MODEL || 'claude-sonnet-5';
const URL = 'https://api.anthropic.com/v1/messages';

export const ready = () => !!API_KEY;
export const model = () => MODEL;

const TYPES = {
  '警戒': '見知らぬ訪問販売に強い警戒心。最初は早く玄関を閉めたい。名乗りが曖昧だと不審がる。',
  '多忙': '時間がない。用件を早く言えと急かす。回りくどい説明はさえぎる。',
  '価格重視': 'お金の話にしか興味がない。「高いんでしょ」「結構です」と即断りがち。',
};

function systemPrompt(ctype) {
  const t = TYPES[ctype] || TYPES['警戒'];
  return [
    'あなたは、訪問販売の営業マンが玄関先で対応している「お客様（戸建ての家主）」を演じます。',
    '商材は太陽光・蓄電池・電気の健康診断です。営業マンはロープレ（練習）中で、あなたはその相手役です。',
    `お客様の性格：${t}`,
    '',
    '演じ方のルール：',
    '・実際の玄関先の会話らしく、短く（1〜3文）。セリフだけを話す。ナレーションや状況説明はしない。',
    '・簡単には落ちない。いきなり「話を聞きたい」とは言わない。正しい手順を踏まれて初めて少しだけ軟化する。',
    '・営業が名乗り（社名・目的・商材）を言わない／曖昧なときは不審がる。',
    '・「協会」を国や自治体の公的機関のように匂わされたら、鵜呑みにせず「役所の人？」等と突っ込むか警戒を強める。',
    '・地域の施工実績・工事マップ、その場の無料電気代診断など、具体を出されたら少し興味を示してよい。',
    '・診断や商品の前に、いきなり見積り・kW数・工事費など「売り込み」が来たら警戒を強める。',
    '・敬語すぎず、素の家主の口調で。長い演説はしない。',
    '・出力は日本語のセリフのみ。名前や「客:」などのラベル、括弧書きの動作説明は付けない。',
  ].join('\n');
}

/**
 * お客様役の次の一言を返す。
 * @param {{ctype?:string, history?:Array<{role:'sales'|'customer',text:string}>, salesText:string}} p
 * @returns {Promise<string|null>}
 */
export async function customerReply({ ctype = '警戒', history = [], salesText = '' } = {}) {
  if (!API_KEY) return null;
  const msgs = [];
  for (const h of (history || [])) {
    if (!h || !h.text) continue;
    msgs.push({ role: h.role === 'sales' ? 'user' : 'assistant', content: String(h.text).slice(0, 800) });
  }
  msgs.push({ role: 'user', content: String(salesText || '').slice(0, 800) });

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, system: systemPrompt(ctype), messages: msgs }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[persona] Anthropic error:', j.error.message); return null; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    // 念のためラベルや括弧書きの動作説明が付いたら落とす。
    return (text || '').replace(/^(客|お客様|customer)\s*[:：]\s*/i, '').replace(/^（[^）]*）\s*/, '').trim() || null;
  } catch (e) {
    console.warn('[persona] 例外:', e.message); return null;
  }
}
