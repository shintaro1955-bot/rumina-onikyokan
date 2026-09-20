/* ============================================================
   ロープレ講評（録音の文字起こしから、伸ばすポイントを抜粋）
   ・できていない点／次に練習すべき点／ヒアリング力で伸ばす点を抽出。
   ・ヒアリング力を最重視（質問で引き出せているか・傾聴・一方通行でないか）。
   ・正直表示の一線：これは**参考**。合否の確定判定は決定論(roleplay.js)が正本。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// 速さ優先（結果画面で待たせない）。深く見たいときは env で sonnet に。
const MODEL = process.env.RP_FEEDBACK_MODEL || 'claude-haiku-4-5-20251001';
const URL = 'https://api.anthropic.com/v1/messages';

export const ready = () => !!API_KEY;

const SYSTEM = [
  'あなたは訪問販売のトップ営業を育てる「鬼教官」。玄関先ロープレの文字起こしを見て、営業マン（「営業:」の発話）だけを評価します。',
  '評価の物差しは「八賀式トークロジック（基本トークフロー）」の6局面：',
  '①冒頭フック（開口10秒で電気代/無料診断/明細を刺して質問し、相手に喋らせる）',
  '②問題提起（値上げ・時間帯単価・燃料費調整などの不利益を"相手の口から"言わせて危機感を共有）',
  '③明細ドライブ（"売る"でなく"見る"。明細を30秒見せてもらう合意を取り警戒を下げる）',
  '④価値提示（補助金の"今だけ"・創蓄で前傾させる）',
  '⑤切り返し（断られても最低1回「電気代だけ確認しても？」で粘る）',
  '⑥2択クロージング（A/Bの二択で日程を置く）',
  '基本思想：売り込まない。気づきを渡して相手の口から課題を言わせる。断りは入口。最後は二択で日程を置く。',
  '最重視は「ヒアリング力」＝②問題提起と③明細ドライブ（相手に喋らせ、明細を見せてもらう所）。質問で引き出せているか／相手の返答を受けてつないでいるか／一方的に説明していないか。',
  '',
  '【アウト（断り）の見方】断りは入口だが、"粘ってよい断り"と"引くべき断り"がある。取り違えが一番の時間のロス。',
  '・粘る余地あり＝「間に合ってます」等の反射の断り／「忙しい」／「もう付いている・他社と契約済み」／「高い・お金がない」。用件がまだ伝わっていないか、明細に戻せば続く。ここで引くのが最ももったいない。',
  '・1回だけ粘る＝「訪問販売はお断り」／「興味がない」。名乗り直しか気づきを1つ渡して反応を見て、変わらなければ引く。',
  '・引くべき＝①「帰ってください」「お断りします」「二度と来ないで」など契約しない意思がはっきり示された場合 ②賃貸・持ち家でないなど設置条件を満たさない場合。①は特定商取引法で再勧誘が禁止されており、粘ること自体が誤り（効率ではなく法令の線）。②は粘っても数字にならないので時間を次の家に使う。',
  '引くべき断りに営業が粘っていたら、それは明確に指摘する。逆に粘る余地のある断りで即引いていたら、そこが一番の損失として指摘する。',
  '人格否定はしない。抽象論（「もっと頑張る」等）は禁止。どの局面ができていて どこが抜けているかを、実際のセリフに即して、次にすぐやれる具体で書く。各項目は短い1文。',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    notDone: { type: 'array', items: { type: 'string' }, description: '録音の中でできていない・弱かった点（具体・2〜4個）' },
    practice: { type: 'array', items: { type: 'string' }, description: '次に練習すべき具体アクション（2〜4個）' },
    hearing: { type: 'array', items: { type: 'string' }, description: 'ヒアリング力で伸ばす点（具体・2〜3個）' },
    good: { type: 'array', items: { type: 'string' }, description: 'できていた点（あれば1〜2個・無ければ空配列）' },
    outs: {
      type: 'array',
      description: '客が断った場面ごとの分析（最大4件・断りが無ければ空配列）',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: '客の断りのセリフ（短く引用）' },
          type: { type: 'string', description: '断りの型（反射の断り／時間がない／決裁者が不在／訪問販売お断り／もう付いている／賃貸・持ち家でない／お金がない／興味がない／明確な拒絶）' },
          handled: { type: 'boolean', description: 'この断りに適切に対応できたか。粘るべき断りで粘れたら true、引くべき断りで引けたら true。粘るべき所で即引いた／引くべき所で粘り続けた場合は false' },
          better: { type: 'string', description: 'その場で言うべきだった最短の一言（実際に口に出せるセリフ）。引くべき断りなら引き方を書く' },
          verdict: { type: 'string', enum: ['粘る余地あり', '1回だけ粘る', '引くべき'], description: '粘る価値の判定' },
        },
        required: ['quote', 'type', 'handled', 'better', 'verdict'],
        additionalProperties: false,
      },
    },
    outAdvice: { type: 'string', description: '時間効率の総括。どこで粘りどこで切って次の家へ行くべきだったか（1〜2文）。断りが無ければ空文字' },
    summary: { type: 'string', description: '鬼教官の一言総括（1〜2文）' },
  },
  required: ['notDone', 'practice', 'hearing', 'good', 'outs', 'outAdvice', 'summary'],
  additionalProperties: false,
};

/** 文字起こし（営業:/客: 形式）から講評を返す。取れなければ null。 */
export async function roleplayFeedback(transcript) {
  if (!API_KEY || !transcript) return null;
  const user = [
    '次のロープレを評価してください。',
    '【文字起こし（営業=営業マン／客=AIお客様）】',
    String(transcript).slice(0, 8000),
  ].join('\n');
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM, output_config: { format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[rpfeedback] Anthropic error:', j.error.message); return null; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    parsed.advisory = true;
    parsed.model = MODEL;
    return parsed;
  } catch (e) { console.warn('[rpfeedback] 例外:', e.message); return null; }
}
