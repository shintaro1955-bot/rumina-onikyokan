/* ============================================================
   Rumina 鬼教官 — Claude APIによる「鬼教官の講評」生成
   ・ANTHROPIC_API_KEY 未設定なら null を返し、呼び出し側はルールベース(generateCoachComment)にフォールバック。
   ・依存パッケージゼロ（Node18+ の global fetch を使用）。生HTTPSでAnthropic Messages APIを叩く。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CRITIQUE_MODEL || 'claude-opus-4-8';
const URL = 'https://api.anthropic.com/v1/messages';

export const critiqueReady = () => !!API_KEY;

/** 解析結果を、講評プロンプト用の簡潔なファクト文字列にまとめる（数字は盛らない・事実のみ）。 */
function factsBlock(a = {}, benchmark = {}, modelTalk = null) {
  const k = a.kpis || a.metrics || {};
  const num = (v) => (v === 0 || v ? String(v) : '—');
  const lines = [
    `総ピンポン数: ${num(a.pingCount ?? k.pings)}`,
    `会話（在宅反応）数: ${num(a.talkCount ?? k.talks)}`,
    `在宅反応率: ${num(k.homeRate ?? a.homeRate)}%`,
    `アポ率: ${num(k.appointmentRate ?? a.appointmentRate)}%`,
    `平均会話秒数: ${num(k.avgTalkSec ?? a.avgTalkSec)}`,
    `冒頭質問率: ${num(k.openQuestionRate ?? a.openQuestionRate)}%`,
    `切り返し回数: ${num(k.rebuttals ?? a.rebuttals)}`,
    `鬼教官スコア: ${num(a.score)}`,
  ];
  if (benchmark && Object.keys(benchmark).length) {
    lines.push(`トップ営業ベンチ: 在宅${num(benchmark.homeRate)}% / アポ${num(benchmark.appointmentRate)}% / 会話${num(benchmark.avgTalkSec)}秒 / 冒頭質問${num(benchmark.openQuestionRate)}%`);
  }
  if (a.quality && a.quality.estimatedFields && a.quality.estimatedFields.length) {
    lines.push(`※推定値（未確定）: ${a.quality.estimatedFields.join(', ')}`);
  }
  if (modelTalk) {
    const mt = typeof modelTalk === 'string' ? modelTalk : JSON.stringify(modelTalk).slice(0, 1200);
    lines.push(`成功モデル/八賀式トークの型: ${mt}`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  'あなたは訪問販売の営業教育AI「鬼教官」。優しくないが人格否定は絶対にしない。',
  '数字・行動・会話の事実にだけ厳しく踏み込み、最後は必ず「勝たせる」視点で締める。',
  '推定値と確定値を混同しない。景表法に触れる誇大・断定的な効果表現はしない。',
  '出力は日本語。前置きや「承知しました」等は書かず、講評本文だけを返す。',
].join(' ');

/**
 * 鬼教官の講評をClaudeで生成する。
 * @returns {Promise<string|null>} 講評テキスト。キー未設定・失敗時は null。
 */
export async function generateCritique({ analysis, transcript, benchmark, modelTalk } = {}) {
  if (!API_KEY || !analysis) return null;
  const facts = factsBlock(analysis, benchmark || {}, modelTalk || null);
  const excerpt = String(transcript || '').slice(0, 6000);
  const user = [
    '以下はある営業マンの1日の稼働データと、商談の文字起こし抜粋です。',
    'トップ営業／成功モデルの型との差分を踏まえ、次の構成で鬼教官の口調で講評してください。',
    '(1) 今日の総括（一言で刺す） (2) 事実として良かった点 (3) 決定的に足りない点と、その原因 (4) 明日やる具体的アクションを3つ（数値目標つき）。',
    '推定値の項目は「推定なので確定測定で詰める」と明示すること。',
    '',
    '【稼働データ】',
    facts,
    '',
    '【商談の文字起こし抜粋】',
    excerpt || '(文字起こしなし)',
  ].join('\n');

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[critique] Anthropic error:', j.error.message); return null; }
    const text = (j.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch (e) {
    console.warn('[critique] 失敗:', e.message);
    return null;
  }
}
