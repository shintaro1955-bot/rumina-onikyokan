/* ============================================================
   一日のトークコーチ（診断ログ＝1日ぶんのピンポンを束ねて指導する）
   ・入力は既に解析済みの診断ログ（pipeline.analyze の pings）。1日分をまとめて読む。
   ・**数字と局面判定はここ（決定論）が正本**。集計をLLMに委ねない（digest.mjs と同じ流儀）。
     LLMに任せるのは「どう言い換えるか」の言語化だけ。
   ・物差しは八賀式トークロジックの6局面（roleplay.js の CHECKS と同じ定義を
     サーバ側に持たせたもの。**どちらかを直したら両方直すこと**）。
   ============================================================ */
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.DAYCOACH_MODEL || 'claude-opus-4-8';
const URL = 'https://api.anthropic.com/v1/messages';

export const ready = () => !!API_KEY;

/* ---- 八賀式6局面（決定論）。roleplay.js の CHECKS と対。 ---- */
const firstN = (s, n) => String(s || '').slice(0, n);
export const PHASES = [
  { id: 1, phase: '冒頭フック', req: true,
    test: s => { const h = firstN(s, 150); return /(電気代|健康診断|無料診断|診断|明細)/.test(h) && /(？|\?|ですか|ませんか|どう|いかが|上がって|高く)/.test(h); } },
  { id: 2, phase: '問題提起', req: false,
    test: s => /(値上げ|上がって|単価|燃料費調整|時間帯|夜トク|従量|プラン|高く|上昇)/.test(s) },
  { id: 3, phase: '明細ドライブ', req: false,
    test: s => /(明細|検針票|請求書)/.test(s) && /(見|確認|拝見|見せ|30秒|チェック)/.test(s) },
  { id: 4, phase: '価値提示', req: false,
    test: s => /(補助金|助成金|今だけ|創蓄|創って|蓄電池|太陽光|エコキュート|オール電化)/.test(s) },
  { id: 5, phase: '切り返し', req: false,
    test: s => /(電気代だけ|確認だけ|見るだけ|お手間|一目|ちなみに)/.test(s) && /(確認|見|いいですか|大丈夫|だけ)/.test(s) },
  { id: 6, phase: '2択クロージング', req: false,
    test: s => /(どちら|どっち)/.test(s) && /(日|曜|夕方|昼|午前|午後|明日|明後日|来週|都合|時)/.test(s) },
];

/* ---- 断りの型ごとの「粘る価値」----
   型のラベルは pipeline.mjs の OBJECTION_DICT が付けたものをそのまま使う（辞書を二重に持たない）。
   press=まだ粘れる / once=1回だけ試して引く / stop=引く
   ※ stop の「断固拒否」は効率の話だけでなく、特定商取引法が再勧誘を禁じている領域。 */
export const OBJECTION_WORTH = {
  '断固拒否': { worth: 'stop', note: '契約しない意思表示。特定商取引法で再勧誘は禁止。粘ること自体が誤り。' },
  'うちは持ち家じゃない': { worth: 'stop', note: '設置条件を満たさない。粘っても数字にならないので次の家へ。' },
  '訪問販売お断り': { worth: 'once', note: '手段への拒否。名乗り直しを1回だけ。変わらなければ引く。' },
  '興味ない': { worth: 'once', note: 'メリットが自分事になっていない。気づきを1つ渡して反応を見る。' },
  '間に合ってます': { worth: 'press', note: '中身を聞く前の反射。ここで引くのが一番もったいない。' },
  '今忙しい': { worth: 'press', note: '用件の長さへの警戒。短さを約束すれば通る。' },
  '主人がいないと分からない': { worth: 'press', note: '断りではなく「今は決められない」。2択で日程を置けば次につながる。' },
  '電気は関係ない': { worth: 'press', note: '明細に戻せばやり直せる。' },
};
const worthOf = (label) => (OBJECTION_WORTH[label] || { worth: 'press', note: '' });

/* ---- ① 決定論の集計（正本）---- */
/** 1日分の診断ログ（reports配列）から、事実だけを積み上げる。 */
export function buildDayFacts(reports = [], { name = null, date = null } = {}) {
  const pings = [];
  for (const r of reports) for (const p of (r.pings || [])) pings.push(p);

  const home = pings.filter(p => p.customerSpoke);
  const conv = pings.filter(p => p.conversation);
  const apo = pings.filter(p => p.appointmentCreated);
  const prospect = pings.filter(p => p.result === 'prospect');

  // 局面の達成。母数の取り方で意味が変わるので局面ごとに変える：
  //  ①冒頭フックは「相手が出てきた全戸」が母数。会話に入れた訪問だけで測ると、
  //    "フックが無くて即断られた訪問"が母数から消えて、一番の問題が隠れてしまう。
  //  ②〜⑥は会話に入れた訪問が母数（ドアも開かない訪問で問うのは酷）。
  const phases = PHASES.map(ph => {
    const base = ph.id === 1 ? home : conv;
    const hit = base.filter(p => { try { return ph.test(String(p.text || '')); } catch (e) { return false; } });
    return { id: ph.id, phase: ph.phase, req: ph.req, done: hit.length, of: base.length,
      baseLabel: ph.id === 1 ? '在宅' : '会話',
      rate: base.length ? Math.round(hit.length / base.length * 100) : 0 };
  });

  // 断りの型ごとに「切り返したか」を数える
  const objMap = {};
  for (const p of pings) {
    if (!p.objectionType) continue;
    const w = worthOf(p.objectionType);
    const o = objMap[p.objectionType] || (objMap[p.objectionType] = { label: p.objectionType, worth: w.worth, note: w.note, count: 0, pressed: 0 });
    o.count++; if ((p.rebuttalCount || 0) > 0) o.pressed++;
  }
  const objections = Object.values(objMap).sort((a, b) => b.count - a.count);

  // 一番の損失＝粘れる断りなのに一度も食い下がらなかった件数
  const gaveUpEarly = objections.filter(o => o.worth === 'press').reduce((n, o) => n + (o.count - o.pressed), 0);
  // 逆の誤り＝引くべき断りに食い下がった件数（時間の浪費かつ法令リスク）
  const pushedTooFar = objections.filter(o => o.worth === 'stop').reduce((n, o) => n + o.pressed, 0);

  // 崩れどころ＝必須の①が落ちていればそこ、なければ達成率が最も低い局面
  const req1 = phases.find(p => p.id === 1);
  const weakest = (req1 && req1.rate < 50) ? req1 : phases.slice().sort((a, b) => a.rate - b.rate)[0];

  return {
    name, date,
    recordings: reports.length,
    totalPings: pings.length,
    homeCount: home.length,
    convCount: conv.length,
    apoCount: apo.length,
    prospectCount: prospect.length,
    homeRate: pings.length ? Math.round(home.length / pings.length * 100) : 0,
    convRate: home.length ? Math.round(conv.length / home.length * 100) : 0,
    apoRate: conv.length ? Math.round(apo.length / conv.length * 100) : 0,
    phases, weakest: weakest || null,
    objections, gaveUpEarly, pushedTooFar,
    samples: pickSamples(pings),
  };
}

/** LLMに渡す抜粋。全部渡すと長すぎるので「惜しい／崩れた／取れた」を選ぶ。 */
function pickSamples(pings) {
  const cut = (p, tag) => ({ tag, hour: p.hour, result: p.result, objection: p.objectionType || null,
    rebuttals: p.rebuttalCount || 0, text: String(p.text || '').slice(0, 700) });
  const out = [];
  // 惜しい＝会話には入れたのにアポにならなかった
  for (const p of pings.filter(p => p.conversation && !p.appointmentCreated).slice(0, 4)) out.push(cut(p, '惜しい（会話に入れたがアポなし）'));
  // 崩れた＝粘れる断りなのに切り返し0
  for (const p of pings.filter(p => p.objectionType && worthOf(p.objectionType).worth === 'press' && !(p.rebuttalCount > 0)).slice(0, 3)) out.push(cut(p, '崩れた（粘れる断りで引いた）'));
  // 誤り＝引くべき断りに粘った
  for (const p of pings.filter(p => p.objectionType && worthOf(p.objectionType).worth === 'stop' && (p.rebuttalCount > 0)).slice(0, 2)) out.push(cut(p, '誤り（引くべき断りに粘った）'));
  // 取れた＝アポ（良い型の確認用）
  for (const p of pings.filter(p => p.appointmentCreated).slice(0, 2)) out.push(cut(p, '取れた（アポ）'));
  return out.slice(0, 10);
}

/* ---- ①-b 今日の弱点から「ロープレの課題」を決める（決定論）----
   実戦で崩れた所を、そのままロープレ道場のお題にするための材料。
   customerRule＝AIお客様に渡す縛り（その局面を必ず突いてくる客になる）。
   checkId＝合否を見る八賀式の局面番号（判定はロープレ側の決定論チェック）。 */
const PHASE_DRILL = {
  1: { title: '冒頭フックを10秒で刺す', goal: '名乗りで終わらせず、開口10秒で電気代・無料診断・明細のどれかを出して質問する',
       customerRule: 'あなたは玄関を開けたら「はい、何ですか？」とだけ言う。用件を名乗るだけ・商品名を言うだけの相手には、二言目で「結構です」と切って終わらせる。開口で電気代や無料診断や明細について"質問"された場合だけ、一言答えて会話を続ける。' },
  2: { title: '値上げを相手の口から言わせる', goal: '値上げ・時間帯単価・燃料費調整の不利益に触れて、相手に不満を言わせる',
       customerRule: 'あなたは電気代が上がっている自覚がない。「別に変わってないけど」と返す。値上げや単価や燃料費調整の具体を出されて初めて「言われてみれば上がってるかも」と反応する。' },
  3: { title: '明細を見せてもらう合意を取る', goal: '"売る"でなく"見る"。明細を30秒見せてもらう合意まで運ぶ',
       customerRule: 'あなたは明細を見せてほしいと頼まれるまで、自分からは電気代の話を深めない。見積もり・工事費・kW・契約など"売り込み"を先にされたら一気に冷めて「そういうのは結構です」と断る。' },
  4: { title: '補助金と創蓄で前傾させる', goal: '補助金の"今だけ"、創って貯めて使う、で関心を前に倒す',
       customerRule: 'あなたは話は聞くが「で、それで何が変わるの」と醒めている。補助金や創蓄など"今やる理由"の具体が出るまで前のめりにならない。' },
  5: { title: '断られても最低1回は粘る', goal: '断られた直後に引かず、電気代・明細の確認に話を戻す',
       customerRule: 'あなたは開口10秒以内に必ず断る。相手が「失礼しました」などで引き下がったら、そのまま会話を終わらせる。電気代や明細の確認に話を戻して食い下がってきた場合だけ、少しだけ続ける。' },
  6: { title: '二択で日程を置く', goal: '「行っていいですか」ではなく、A/Bの二択で日程を先に押さえる',
       customerRule: 'あなたは話には乗るが、日程を"二択"で提示されない限り「じゃあまた今度で」とかわす。二択で聞かれたらどちらかを選ぶ。' },
};

/** その日の事実から、明日ロープレで潰すべき課題を1つ決める。 */
export function buildDrill(facts) {
  if (!facts || !facts.totalPings) return null;
  // ① 粘れる断りで引いていたら、そこが最優先（一番の取りこぼし）。
  const lost = (facts.objections || [])
    .filter(o => o.worth === 'press' && o.count > o.pressed)
    .sort((a, b) => (b.count - b.pressed) - (a.count - a.pressed))[0];
  if (lost) {
    const missed = lost.count - lost.pressed;
    return {
      kind: 'objection', checkId: 5,
      title: `「${lost.label}」を切り返す`,
      why: `今日、${lost.label}で${missed}件そのまま引いている。${lost.note}`,
      goal: PHASE_DRILL[5].goal,
      customerRule: `あなたは開口10秒以内に必ず「${lost.label}」の意味のことを言って断る。相手が「失礼しました」などで引き下がったら、そのまま会話を終わらせる。電気代や明細の確認に話を戻して食い下がってきた場合だけ、少しだけ続ける。`,
      difficulty: 'hard',
    };
  }
  // ② なければ、一番崩れている局面を課題にする。
  const w = facts.weakest; const d = w && PHASE_DRILL[w.id];
  if (!d) return null;
  return {
    kind: 'phase', checkId: w.id,
    title: d.title,
    why: `今日の${w.id}${w.phase}は ${w.done}/${w.of}（${w.rate}%）。ここが一番落ちている。`,
    goal: d.goal, customerRule: d.customerRule,
    difficulty: w.rate < 30 ? 'normal' : 'hard',
  };
}

/* ---- ② 言語化（LLM・参考）---- */
const SYSTEM = [
  'あなたは訪問販売のトップ営業を育てる「鬼教官」。ある営業マンの"一日分"の玄関先トークを見て、翌日すぐ直せる形で指導します。',
  '物差しは八賀式トークロジックの6局面：①冒頭フック（開口10秒で電気代/無料診断/明細を刺して質問し相手に喋らせる）②問題提起（値上げ・時間帯単価・燃料費調整の不利益を相手の口から言わせる）③明細ドライブ（"売る"でなく"見る"。明細を30秒見せてもらう合意）④価値提示（補助金の"今だけ"・創蓄）⑤切り返し（断られても最低1回は粘る）⑥2択クロージング（A/Bで日程を置く）。',
  '基本思想：売り込まない。気づきを渡して相手の口から課題を言わせる。最後は二択で日程を置く。明細を見る前に見積・工事費・kW・契約の話をするのは売り込み先行＝誤り。',
  '',
  '【断りの扱い】断りは入口だが、粘ってよい断りと引くべき断りがある。取り違えが一番の時間のロス。',
  '・粘れる＝「間に合ってます」「今忙しい」「主人がいないと」「電気は関係ない」。用件が伝わっていないだけで、短さを約束するか明細に戻せば続く。ここで引くのが最大の損失。',
  '・1回だけ＝「訪問販売お断り」「興味ない」。名乗り直しか気づき1つで反応を見て、変わらなければ引く。',
  '・引く＝「断固拒否（帰ってください等）」「持ち家でない」。前者は特定商取引法で再勧誘が禁止されており、粘ること自体が誤り。後者は粘っても数字にならないので時間を次の家へ。',
  '',
  '【書き方】数字は渡された集計が正本。数字を作り直したり盛ったりしない。',
  '人格否定・精神論（「気合」「もっと頑張る」等）は禁止。指摘は必ず"実際のセリフ"に紐づけ、直し方はそのまま口に出せる日本語で書く。',
  '一日の中で繰り返している癖を優先して取り上げる（1回だけの事故より、毎回やっている型崩れ）。',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '今日のトークの総括（2〜3文）。どこが効いてどこで落としたかを事実に即して' },
    mistakes: {
      type: 'array', description: '今日の間違い（2〜4件）。繰り返している癖を優先',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'string', description: '実際のセリフから短く引用（20〜60字）' },
          wrong: { type: 'string', description: '何が間違いか（1文）' },
          right: { type: 'string', description: 'その場でどう言うべきだったか。そのまま口に出せるセリフ' },
        },
        required: ['scene', 'wrong', 'right'], additionalProperties: false,
      },
    },
    fixes: {
      type: 'array', description: 'トークの修正指示（2〜3件）。明日から言い方を変える所',
      items: {
        type: 'object',
        properties: {
          phase: { type: 'string', description: '対象の局面（①冒頭フック〜⑥2択クロージング のいずれか）' },
          before: { type: 'string', description: '今日の言い方（実際のセリフに基づく）' },
          after: { type: 'string', description: '明日の言い方（そのまま口に出せるセリフ）' },
        },
        required: ['phase', 'before', 'after'], additionalProperties: false,
      },
    },
    tomorrow: { type: 'array', items: { type: 'string' }, description: '明日やること（1〜3個）。数えられる具体で。例「①の質問を全戸で口に出す」' },
    keep: { type: 'array', items: { type: 'string' }, description: '今日できていて続けるべき点（0〜2個）' },
  },
  required: ['summary', 'mistakes', 'fixes', 'tomorrow', 'keep'],
  additionalProperties: false,
};

/** 決定論の集計を渡して、指導文（参考）を作る。取れなければ null。 */
export async function buildDayCoach(facts) {
  if (!API_KEY || !facts || !facts.totalPings) return null;
  const f = facts;
  const lines = [
    `【${f.name || '本人'} / ${f.date || ''} の集計（この数字が正本）】`,
    `録音 ${f.recordings}件・訪問(ピンポン) ${f.totalPings}件・在宅 ${f.homeCount}件(${f.homeRate}%)・会話 ${f.convCount}件・見込み ${f.prospectCount}件・アポ ${f.apoCount}件`,
    `会話に入れた中でのアポ率 ${f.apoRate}%`,
    '',
    '【六局面の達成】※①の母数は在宅（相手が出てきた全戸）、②〜⑥の母数は会話に入れた訪問',
    ...f.phases.map(p => `${p.id}${p.phase}：${p.done}/${p.of}（${p.rate}%・母数=${p.baseLabel}）${p.req ? ' ※必須' : ''}`),
    f.weakest ? `→ 今日いちばん崩れている局面：${f.weakest.id}${f.weakest.phase}（${f.weakest.rate}%）` : '',
    '',
    '【断りの内訳（粘る価値つき）】',
    ...(f.objections.length ? f.objections.map(o => `「${o.label}」${o.count}件 / うち切り返した ${o.pressed}件 ・扱い=${o.worth === 'press' ? '粘れる' : o.worth === 'once' ? '1回だけ' : '引く'}（${o.note}）`) : ['（断りの記録なし）']),
    `粘れる断りなのに引いた：${f.gaveUpEarly}件 ／ 引くべき断りに粘った：${f.pushedTooFar}件`,
    '',
    '【抜粋（実際のトーク）】',
    ...f.samples.map((s, i) => `--- ${i + 1}. ${s.tag}${s.objection ? ` / 断り「${s.objection}」・切り返し${s.rebuttals}回` : ''}\n${s.text}`),
  ].filter(Boolean);

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: lines.join('\n').slice(0, 24000) }],
      }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[daycoach] Anthropic error:', j.error.message); return null; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    parsed.advisory = true;   // 正直表示：指導文は参考。数字と局面の判定は決定論が正本。
    return parsed;
  } catch (e) { console.warn('[daycoach] 例外:', e.message); return null; }
}
