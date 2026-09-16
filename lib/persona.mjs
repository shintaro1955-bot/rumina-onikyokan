/* ============================================================
   AIロープレの「お客様役」（訪問販売の玄関先の家主を演じる）
   ・営業マンの練習相手。簡単には落ちない現実的な客を演じる。
   ・出力はセリフのみ（ナレーション・ラベルなし）。短く（1〜3文）。
   ・採点は別（鬼教官の決定論＝roleplay.js）。ここは相手役に徹する。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// 会話はテンポが命。速いモデルを既定に（環境変数で差し替え可）。
// 客役は短い返答で十分。会話のテンポ優先で高速モデルを既定にする（遅いと練習にならない）。
const MODEL = process.env.ROLEPLAY_MODEL || 'claude-haiku-4-5-20251001';
const URL = 'https://api.anthropic.com/v1/messages';

export const ready = () => !!API_KEY;
export const model = () => MODEL;

/* ---- 3軸（お客様 × 難易度 × 商材）で人格を組み立てる ---- */
// お客様像（顔・声はフロント側。ここは性格だけ）
const PERSONA_DESC = {
  shufu: '30代の在宅主婦。昼間に訪問を受ける。丁寧な口調だが、見知らぬ訪問販売には警戒的。子どもや家事の合間で、長話は嫌う。',
  danna: '40代の夫。休日に在宅していて呼び出された。用件を早く言えと急かし気味。理屈っぽく、値段・手間・本当に得なのかに厳しい。',
  senior: '70代の高齢の家主。耳が少し遠く、のんびり。人は悪くないが、契約や機械の話には慎重で、家族に相談したがる。',
};
// 難易度（どれだけ手強いか＝軟化のしにくさ）
const DIFFICULTIES = {
  normal: '標準的な警戒心。正しい手順（名乗り3点・地域の実績・その場の無料診断など）を丁寧に踏まれれば、少しずつ軟化してよい。',
  hard: '警戒が強く、生半可な説明では玄関を閉めたがる。具体（地域名や件数などの数字、その場の得）と要点が無いと相手にしない。軟化のハードルは高め。',
  boss: 'ほぼ聞く気のない門前払いタイプ。短く冷たく断り、すぐ切り上げようとする。よほど刺さる一言（具体的な地域実績や、その場で得だと分かる話）が来た時だけ、ほんの一瞬だけ間を持つ。基本は落ちない。人格否定や暴言は言わない。',
};
// 商材（シナリオの文脈＋よくある断り）
const PRODUCTS = {
  solar: { ctx: '営業マンは太陽光発電・蓄電池の提案で訪ねてきた。', obj: 'うち持ち家だけど今さら／太陽光は元が取れないって聞く／屋根に穴あけるんでしょ／訪問販売はちょっと' },
  ecocute: { ctx: '営業マンはエコキュート・オール電化（給湯や光熱費）の提案で訪ねてきた。', obj: '給湯器はまだ壊れてない／ガスで困ってない／どうせ高いんでしょ' },
  shindan: { ctx: '営業マンは「電気代の無料健康診断」の入口案内で訪ねてきた。', obj: '診断だけ？結局売りつけるんでしょ／間に合ってます／今忙しい' },
};
const COMMON_RULES = [
  '演じ方のルール：',
  '・実際の玄関先の会話らしく、**とても短く（基本1文、長くても2文）**。セリフだけを話す。ナレーション・状況説明・カッコ書きの動作は書かない。だらだら喋らない。',
  '・簡単には落ちない。いきなり「話を聞きたい」とは言わない。手順を踏まれて初めて、手強さに応じて少しだけ軟化する。',
  '・営業が名乗り（社名・目的・商材）を言わない／曖昧なときは不審がる。',
  '・「協会」を国や自治体の公的機関のように匂わされたら、鵜呑みにせず「役所の人？」等と突っ込むか警戒を強める。',
  '・地域の施工実績・工事マップ、その場の無料診断など"具体"を出されたら、手強さに応じて少し興味を示してよい。',
  '・診断や商品説明の前に、いきなり見積り・kW数・工事費など「売り込み」が来たら警戒を強める。',
  '・敬語すぎず素の家主の口調で。出力は日本語のセリフのみ。名前や「客:」などのラベルは付けない。',
];

// 旧・押して話すモード用（ctypeのみ）。互換のため残す。
const TYPES = {
  '警戒': '見知らぬ訪問販売に強い警戒心。最初は早く玄関を閉めたい。名乗りが曖昧だと不審がる。',
  '多忙': '時間がない。用件を早く言えと急かす。回りくどい説明はさえぎる。',
  '価格重視': 'お金の話にしか興味がない。「高いんでしょ」「結構です」と即断りがち。',
};

// 3軸から組み立てる（avatar モード）。
function systemPromptV2({ persona, difficulty, product }) {
  const P = PERSONA_DESC[persona] || PERSONA_DESC.shufu;
  const D = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const R = PRODUCTS[product] || PRODUCTS.solar;
  return [
    'あなたは、訪問販売の営業マンが玄関先で対応している「お客様（戸建ての家主）」を演じます。営業はロープレ（練習）中で、あなたはその相手役です。',
    R.ctx,
    `お客様像：${P}`,
    `今日の手強さ：${D}`,
    `よくある断りの例（このニュアンスを使ってよい）：${R.obj}`,
    '',
    ...COMMON_RULES,
  ].join('\n');
}

// 旧・ctypeのみ（押して話すモード）。
function systemPrompt(ctype) {
  const t = TYPES[ctype] || TYPES['警戒'];
  return [
    'あなたは、訪問販売の営業マンが玄関先で対応している「お客様（戸建ての家主）」を演じます。',
    '商材は太陽光・蓄電池・電気の健康診断です。営業マンはロープレ（練習）中で、あなたはその相手役です。',
    `お客様の性格：${t}`,
    '',
    ...COMMON_RULES,
  ].join('\n');
}

/**
 * お客様役の次の一言を返す。
 * 新（avatar）＝{persona,difficulty,product}。旧（押して話す）＝{ctype}。
 */
export async function customerReply({ ctype = '警戒', persona, difficulty, product, history = [], salesText = '' } = {}) {
  if (!API_KEY) return null;
  const msgs = [];
  for (const h of (history || [])) {
    if (!h || !h.text) continue;
    msgs.push({ role: h.role === 'sales' ? 'user' : 'assistant', content: String(h.text).slice(0, 800) });
  }
  msgs.push({ role: 'user', content: String(salesText || '').slice(0, 800) });

  // 3軸のどれかが来ていれば新（avatar）、無ければ旧（ctype）で組み立てる。
  const sys = (persona || difficulty || product) ? systemPromptV2({ persona, difficulty, product }) : systemPrompt(ctype);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 90, system: sys, messages: msgs }),
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
