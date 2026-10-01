/* ============================================================
   STEP4「鬼教官 最終口頭試問」

   STEP1〜3は選択式。選択式は「選べるが言えない」を通してしまう。
   玄関先で要るのは、覚えていることではなく、口から出ること。
   ここは選択肢を出さず、場面を示して実際に言ってもらう。

   採点の順番（この順番が肝）
     ① 言ってはいけない言い回しの検出 … talkrisk.mjs の辞書が正本。
        high が1件でもあれば、その問は0点。AIの判断で覆さない。
     ② 要点を言えているか … ここだけAIに見てもらう（0〜2点）。
     ③ 合否 … ①と②の両方を満たしたときだけ合格。

   AIに「違反かどうか」を判定させない理由は talkrisk.mjs と同じ。
   誤って「違反」と言えば本人に、誤って「問題なし」と言えば会社に害が出る。

   採点できなかったとき（APIキー未設定・通信失敗）は、落とさない。
   「採点できなかった」として返し、STEP3までの合格＋面談の経路に戻す。
   機械が動かないことを理由に人を不合格にしない。
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as talkrisk from './talkrisk.mjs';

const FILE = join(new URL('..', import.meta.url).pathname, 'seed', 'oral.json');
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
/* 採点に使うモデル。
   ORAL_MODEL を指定すればそれだけを使う。指定が無ければ、起動時に候補を順に試して、
   最初に返ってきたものを使う。モデル名は入れ替わる。名前が古くなったときに
   「毎回採点できない＝誰もSTEP4を通れない」という形で静かに壊れるのを避ける。 */
const MODEL_CANDIDATES = ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];
let MODEL = process.env.ORAL_MODEL || MODEL_CANDIDATES[0];
export const modelName = () => MODEL;
const URL_API = 'https://api.anthropic.com/v1/messages';

export const PHASES = ['open', 'back', 'cool', 'calc', 'risk'];
export const PHASE_LABEL = {
  open: '冒頭の名乗りと目的', back: '断られたときの引き際', cool: 'クーリングオフ',
  calc: '試算の前提', risk: '不利になる事実を先に言う',
};
export const COUNT = PHASES.length;      // 5問。各局面から1問
export const PASS_SCORE = 8;             // 10点満点中8点
export const COOLDOWN_MIN = 60 * 24;     // 不合格から24時間（STEP3と同じ重さ）

let CACHE = null;
function all() {
  if (CACHE) return CACHE;
  try { CACHE = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []; }
  catch (e) { console.error('[oral] 読み込み失敗:', e.message); CACHE = []; }
  return CACHE;
}
export function reload() { CACHE = null; return all().length; }
export function count() { return all().length; }
export const aiReady = () => !!API_KEY;

/** 問題が揃っていて、かつ採点できる状態か。片方でも欠けたらSTEP4は使わない。 */
export function ready() {
  const per = PHASES.map(p => all().filter(q => q.phase === p).length);
  const st = selfTestResult();
  // 自己確認で「つながらない」と分かっているときは開かない（受けさせてから落とさない）
  const ok = per.every(n => n >= 1) && aiReady() && st.ok !== false;
  return { ok, questions: all().length, perPhase: per, ai: aiReady(), grader: st };
}

/** 5局面から1問ずつ引く。毎回ちがう組み合わせになる。 */
export function draw() {
  return PHASES.map(p => {
    const pool = all().filter(q => q.phase === p);
    return pool[Math.floor(Math.random() * pool.length)];
  }).filter(Boolean);
}

/** 受験者に見せる形。模範解答と禁止事項は出さない（答えが見えてしまう）。 */
export function forExam(q) {
  return { code: q.code, phase: q.phase, phaseLabel: PHASE_LABEL[q.phase] || q.phase, law: q.law, scene: q.scene, ask: q.ask, minChars: q.minChars || 25 };
}

/* ---- ① 言ってはいけない言い回し（決定論・ここが正本） ---- */
function riskOf(text) {
  const hits = talkrisk.scanText(String(text || '')) || [];
  return { high: hits.filter(h => h.level === 'high'), mid: hits.filter(h => h.level === 'mid') };
}

/* ---- ② 要点を言えているか（AI） ---- */
const SYSTEM = [
  'あなたは訪問販売の新人研修で、口頭試問の答えを見る試験官です。',
  '見るのは「要点を自分の言葉で言えているか」だけです。',
  '法令違反かどうかの判定はしません。それは別の仕組みが決めます。',
  '答えは音声を文字起こししたものです。言い淀み・助詞の崩れ・句読点の乱れで減点しません。',
  '丁寧さや言い回しの上手さでも減点しません。要点が入っているかだけを見ます。',
  '2 = 要点をおおむね言えている。1 = 一部しか言えていない。0 = 言えていない、または答えになっていない。',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          score: { type: 'integer', description: '0・1・2 のいずれか' },
          covered: { type: 'array', items: { type: 'string' }, description: '言えていた要点' },
          missing: { type: 'array', items: { type: 'string' }, description: '言えていなかった要点' },
          comment: { type: 'string', description: '本人に返す一言。30〜80字。何が足りないかを具体的に' },
        },
        required: ['code', 'score', 'covered', 'missing', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

let LAST_ERROR = null;
export const lastError = () => LAST_ERROR;
async function gradeByAI(pairs, useModel) {
  if (!API_KEY) return null;
  const model = useModel || MODEL;
  const body = pairs.map(({ q, answer }) => [
    `--- ${q.code}（${PHASE_LABEL[q.phase]}）`,
    `場面：${q.scene}`,
    `問い：${q.ask}`,
    `見る要点：`,
    ...q.mustCover.map(m => `  ・${m}`),
    `答え：${String(answer || '').slice(0, 1200) || '（無言）'}`,
  ].join('\n')).join('\n\n');
  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 2500, system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: '次の5問の答えを、要点が言えているかで採点してください。\n\n' + body }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json();
    if (j.error) { LAST_ERROR = `${j.error.type || ''} ${j.error.message || ''}`.trim(); console.warn('[oral] Anthropic error:', LAST_ERROR); return null; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) { LAST_ERROR = `本文が空（stop_reason: ${j.stop_reason || '?'}）`; return null; }
    try { return JSON.parse(text).items || null; }
    catch (e) { LAST_ERROR = 'JSONとして読めません：' + text.slice(0, 160); return null; }
  } catch (e) {
    LAST_ERROR = e.message;
    console.warn('[oral] 採点失敗:', e.message);
    return null;
  }
}

/* ---- 起動時の自己確認 ----
   採点のモデル名が違っていても、表に出る症状は「毎回うまく採点できない＝面談へ回る」だけで、
   気づかないまま誰もSTEP4を通れない、ということが起こりうる。
   そうならないよう、起動のときに1回だけ短い採点を投げて、返ってくるかを確かめておく。
   結果は /api/health に出す。落ちても起動は止めない。 */
let SELFTEST = { at: null, ok: null, why: '未実施' };
export function selfTestResult() { return SELFTEST; }
export async function selfTest() {
  const at = () => new Date().toISOString();
  if (!API_KEY) { SELFTEST = { at: at(), ok: false, why: 'APIキーが設定されていません' }; return SELFTEST; }
  const q = all()[0];
  if (!q) { SELFTEST = { at: at(), ok: false, why: '問題がありません' }; return SELFTEST; }
  // ORAL_MODEL の指定があればそれだけ。無ければ候補を順に試す。
  const list = process.env.ORAL_MODEL ? [process.env.ORAL_MODEL] : MODEL_CANDIDATES;
  const tried = [];
  for (const m of list) {
    const r = await gradeByAI([{ q, answer: q.modelAnswer }], m);
    tried.push(m + (r && r.length ? '○' : '×（' + (LAST_ERROR || '理由不明') + '）'));
    if (r && r.length) {
      MODEL = m;
      SELFTEST = { at: at(), ok: true, why: null, model: m, tried };
      return SELFTEST;
    }
  }
  SELFTEST = { at: at(), ok: false, why: `どのモデルでも採点につながりませんでした（試した順：${tried.join(' ')}）`, model: null, tried };
  return SELFTEST;
}

/** 採点。answers = [{ code, answer, via }]。
    返り値 graded=false は「採点できなかった」。不合格ではない。 */
export async function grade(answers = []) {
  const bank = all();
  const pairs = answers.map(a => ({ q: bank.find(x => x.code === a.code), answer: a.answer, via: a.via || 'text' }))
    .filter(x => x.q);
  if (!pairs.length) return { graded: false, why: '答えがありません' };

  // ① 決定論：言ってはいけない言い回し
  const risks = pairs.map(({ q, answer }) => ({ code: q.code, ...riskOf(answer) }));

  // ② AI：要点
  const ai = await gradeByAI(pairs);
  if (!ai) return { graded: false, why: '採点の仕組みにつながりませんでした。STEP3までの合格として、面談で判断します。' };

  const items = pairs.map(({ q, answer, via }) => {
    const a = ai.find(x => x.code === q.code) || { score: 0, covered: [], missing: q.mustCover, comment: '採点できませんでした' };
    const aiScore = Math.max(0, Math.min(2, Math.round(Number(a.score) || 0)));   // スキーマで範囲を縛れないので、ここで丸める
    const r = risks.find(x => x.code === q.code) || { high: [], mid: [] };
    const short = String(answer || '').replace(/\s/g, '').length < (q.minChars || 25);
    // high があればAIの点に関わらず0点。短すぎる答えも0点（言えたことにしない）。
    const score = r.high.length || short ? 0 : aiScore;
    return {
      code: q.code, phase: q.phase, phaseLabel: PHASE_LABEL[q.phase], law: q.law,
      scene: q.scene, ask: q.ask, answer: String(answer || ''), via,
      score, covered: a.covered || [], missing: a.missing || [], comment: a.comment || '',
      tooShort: short,
      risks: [...r.high.map(h => ({ ...h, level: 'high' })), ...r.mid.map(h => ({ ...h, level: 'mid' }))],
      modelAnswer: q.modelAnswer,
    };
  });

  const total = items.reduce((n, x) => n + x.score, 0);
  const highCount = items.reduce((n, x) => n + x.risks.filter(r => r.level === 'high').length, 0);
  const zero = items.filter(x => x.score === 0);
  const passed = total >= PASS_SCORE && highCount === 0 && zero.length === 0;

  const why = passed ? null
    : highCount ? '言ってはいけない言い回しが見つかりました。ここは一度でも出たら合格になりません。'
    : zero.length ? `${zero.map(z => z.phaseLabel).join('・')}が言えていません。`
    : `${total}点でした。合格は${PASS_SCORE}点以上です。`;

  return { graded: true, passed, total, max: COUNT * 2, pass: PASS_SCORE, highCount, items, why, model: MODEL };
}
