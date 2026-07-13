/* ============================================================
   Rumina 鬼教官 — モックデータ層
   後から実APIに差し替えやすいよう、型に沿った純データで保持する。
   ============================================================ */

// トップ営業ベンチマーク（仮基準値）
const TOP_BENCHMARK = {
  targetPings: 100,
  homeResponseRate: 35,        // %
  conversationRate: 20,        // %（会話発生率）
  averageConversationSeconds: 55,
  averageRebuttalCount: 1.8,
  appointmentRate: 3.5,        // %
  openingQuestionRate: 80,     // %（冒頭10秒以内に質問できた率）
};

// 断り文句マスタ
const OBJECTIONS = {
  BUSY: '今忙しい',
  ENOUGH: '間に合ってます',
  RENT: 'うちは持ち家じゃない',
  SPOUSE: '主人がいないと分からない',
  NORELATE: '電気は関係ない',
  NOINTEREST: '興味ない',
};

/* ---- 会話ログ（時間情報付き文字起こしの一部・レポート表示用サンプル） ---- */
const SAMPLE_TRANSCRIPT = [
  { t: '00:12:10', who: '営業', text: 'こんにちは、電気代の無料診断で回っています。' },
  { t: '00:12:15', who: 'お客様', text: '大丈夫です。' },
  { t: '00:12:17', who: '営業', text: 'ちなみに今、電気代って上がっていませんか？' },
  { t: '00:12:24', who: 'お客様', text: 'まあ…上がってはいるけど。' },
  { t: '00:12:27', who: '営業', text: '明細だけ、30秒で見させてもらえますか？' },
  { t: '00:12:33', who: 'お客様', text: '今ちょっと手が離せなくて。' },
  { t: '00:12:36', who: '営業', text: 'では夕方また寄りますね、失礼します。' },
];

/* ---- ピンポンイベント（1件ごとの訪問・レポートのタイムライン用） ---- */
function buildPingEvents() {
  const results = [];
  // hour帯ごとのざっくり生成。result: apo/prospect/talk/reject/nohome/intercom
  const plan = [
    { h: 9,  ping: 11, home: 3, talk: 2, apo: 0, prospect: 1 },
    { h: 10, ping: 12, home: 4, talk: 3, apo: 1, prospect: 1 },
    { h: 11, ping: 10, home: 3, talk: 2, apo: 0, prospect: 1 },
    { h: 12, ping: 4,  home: 1, talk: 0, apo: 0, prospect: 0 }, // 昼・薄い
    { h: 13, ping: 9,  home: 2, talk: 1, apo: 0, prospect: 0 },
    { h: 14, ping: 2,  home: 0, talk: 0, apo: 0, prospect: 0 }, // ★サボり疑いゾーン
    { h: 15, ping: 8,  home: 2, talk: 1, apo: 0, prospect: 1 },
    { h: 16, ping: 10, home: 3, talk: 2, apo: 0, prospect: 0 },
    { h: 17, ping: 9,  home: 4, talk: 2, apo: 1, prospect: 1 },
    { h: 18, ping: 3,  home: 2, talk: 1, apo: 0, prospect: 0 }, // 在宅率高いのに稼働薄い
  ];
  let id = 1;
  plan.forEach(p => {
    for (let i = 0; i < p.ping; i++) {
      let result = 'nohome';
      let reaction = '不在';
      if (i < p.apo) { result = 'apo'; reaction = '対面'; }
      else if (i < p.apo + p.prospect) { result = 'prospect'; reaction = '対面'; }
      else if (i < p.apo + p.prospect + p.talk) { result = 'talk'; reaction = '対面'; }
      else if (i < p.home) { result = 'reject'; reaction = 'インターホンのみ'; }
      results.push({
        id: 'pe' + id++,
        hour: p.h,
        result,
        reaction,
      });
    }
  });
  return results;
}
const PING_EVENTS = buildPingEvents();

/* ---- 時間帯別 活動密度（グラフ用） ---- */
const HOURLY = [
  { hour: 9,  ping: 11, home: 3, talk: 2 },
  { hour: 10, ping: 12, home: 4, talk: 3 },
  { hour: 11, ping: 10, home: 3, talk: 2 },
  { hour: 12, ping: 4,  home: 1, talk: 0 },
  { hour: 13, ping: 9,  home: 2, talk: 1 },
  { hour: 14, ping: 2,  home: 0, talk: 0 },
  { hour: 15, ping: 8,  home: 2, talk: 1 },
  { hour: 16, ping: 10, home: 3, talk: 2 },
  { hour: 17, ping: 9,  home: 4, talk: 2 },
  { hour: 18, ping: 3,  home: 2, talk: 1 },
];

/* ---- 断り文句ランキング TOP5 ---- */
const OBJECTION_RANKING = [
  { label: OBJECTIONS.ENOUGH,   count: 19 },
  { label: OBJECTIONS.BUSY,     count: 15 },
  { label: OBJECTIONS.NOINTEREST, count: 11 },
  { label: OBJECTIONS.SPOUSE,   count: 7 },
  { label: OBJECTIONS.RENT,     count: 5 },
];

/* ---- 当日の解析結果（主役データ／新人：田中） ---- */
const TODAY_ANALYSIS = {
  totalPings: 78,
  targetPings: 100,
  targetAchievementRate: 78,          // %
  workdayIndex: 14,                    // 22勤務中の14勤務目
  workdayCount: 22,
  homeResponseCount: 24,
  homeResponseRate: 26.8,             // %
  conversationCount: 14,
  conversationRate: 17.9,            // %
  averageConversationSeconds: 34,
  appointmentCount: 2,
  appointmentRate: 2.6,              // %
  prospectCount: 5,
  prospectRate: 6.4,
  averageRebuttalCount: 0.4,
  openingQuestionRate: 37,          // %
  silentTimeMinutes: 96,
  suspiciousIdleTimeMinutes: 17,     // GPS照合後の“実サボり”（45分の空白のうち移動を除いた分）
  suspiciousWindow: '14:20〜15:05',
  movingTimeMinutes: 196,
  gps: { connected: true, movingTimeMinutes: 196, stayTimeMinutes: 82, verifiedIdleMinutes: 17, visitClusters: 24 },
  quality: {
    engine: 'whisper', speakerSeparation: 'heuristic', gps: 'connected',
    estimatedFields: ['appointmentRate'],
    note: '話者分離：発話内容ベースの推定（音響分離ではない）。在宅・切り返し・お客様反応は会話構造から算出、精度は中。GPS照合済：空白は裏取り済み。',
  },
  objectionRanking: OBJECTION_RANKING,
  hourly: HOURLY,
  winTalk: {
    wins: [
      { ping: 'w1', result: 'apo', moves: ['冒頭フック', '明細ドライブ', '2択クロージング'], excerpt: 'こんにちは、電気の健康診断で回っています。明細だけ30秒見させてください…明日の夕方お伺いしていいですか', why: '冒頭10秒で「電気の健康診断／明細」に触れ、名乗りで終わらせず会話に入れた。「明細だけ確認」で警戒を下げた。最後は“AかB”の二択で日程を確定させた。' },
      { ping: 'w2', result: 'apo', moves: ['冒頭フック', '問題提起', 'クロージング'], excerpt: '今、電気代上がってませんか。夜トク8だと昼は高くて…', why: '「電気代が上がっている」を相手の口から引き出し、危機感を共有できた。会話終盤で自然に訪問の合意を取り付けた。' },
      { ping: 'w3', result: 'prospect', moves: ['冒頭フック', '創蓄・補助金'], excerpt: '補助金が今だけって聞くと気になるわね', why: 'エコキュートを入口に、創蓄・補助金という“今だけ”の価値を提示できた。' },
    ],
    topMoves: [{ move: '冒頭フック', count: 3 }, { move: '2択クロージング', count: 1 }, { move: '明細ドライブ', count: 1 }, { move: '問題提起', count: 1 }, { move: '創蓄・補助金', count: 1 }],
    summary: 'この日の勝ち筋は主に「冒頭フック」「2択クロージング」。この型を全員に写せば再現できる。',
  },
  coachScore: 62,                    // /100
};

/* ---- トップ営業との差分（表示用に計算） ---- */
function computeGap(a, b) {
  return {
    pings: a.totalPings - b.targetPings,                                  // -22
    homeResponseRate: +(a.homeResponseRate - b.homeResponseRate).toFixed(1), // -8.2
    conversationRate: +(a.conversationRate - b.conversationRate).toFixed(1),
    averageConversationSeconds: a.averageConversationSeconds - b.averageConversationSeconds, // -21
    averageRebuttalCount: +(a.averageRebuttalCount - b.averageRebuttalCount).toFixed(1),     // -1.4
    appointmentRate: +(a.appointmentRate - b.appointmentRate).toFixed(1),
    openingQuestionRate: a.openingQuestionRate - b.openingQuestionRate,   // -43
  };
}
const TODAY_GAP = computeGap(TODAY_ANALYSIS, TOP_BENCHMARK);

/* ============================================================
   鬼教官コメント生成（モックAI）
   ルールベースで、数字→厳しく具体的な指摘に変換する。
   甘やかさない／人格否定はしない／最後は勝たせる。
   ============================================================ */
function generateCoachComment(a, gap, bench) {
  const blocks = [];

  // 1. 冒頭の詰め（ピンポン数）
  const shortage = bench.targetPings - a.totalPings;
  const idlePhrase = a.gps?.connected
    ? `${a.suspiciousWindow}の空白はGPS照合済み。移動を除いた実サボりは${a.suspiciousIdleTimeMinutes}分だ。言い訳は効かない`
    : `特に${a.suspiciousWindow}の約${a.suspiciousIdleTimeMinutes}分間、会話も訪問ログも薄い`;
  blocks.push({
    tone: 'harsh',
    title: '行動量',
    text: `今日のピンポン数は${a.totalPings}件。100件目標に対して${shortage}件足りない。これは気合いの問題じゃない、行動設計の問題だ。${idlePhrase}。この時間を潰している限り、トップ営業との差は永遠に埋まらない。`,
  });

  // 2. 切り返し
  blocks.push({
    tone: 'harsh',
    title: '切り返し',
    text: `断られた後の切り返しが平均${a.averageRebuttalCount}回。トップ営業は${bench.averageRebuttalCount}回だ。つまり君は、断られた瞬間に営業を終了している。明日は最低1回、「ちなみに電気代だけ確認してもいいですか？」を必ず入れろ。`,
  });

  // 3. 冒頭質問率
  blocks.push({
    tone: 'harsh',
    title: '冒頭10秒',
    text: `冒頭10秒以内の質問率は${a.openingQuestionRate}%。トップは${bench.openingQuestionRate}%。会話が始まる前に切られているのは、名乗って終わっているからだ。開口一番で「電気代」「無料診断」「明細」のどれかを刺せ。`,
  });

  // 4. 良かった点（最後は勝たせる布石）
  blocks.push({
    tone: 'good',
    title: '光った点',
    text: `良かったのは、17時以降の在宅反応率が高いこと。この時間帯は在宅の母数が増える。ここに密度を寄せれば、同じ体力で数字は伸びる。伸びしろはちゃんとある。`,
  });

  // 5. 締め（勝たせる）
  blocks.push({
    tone: 'close',
    title: '結論',
    text: `君はサボっているんじゃない、勝ち方を知らないだけだ。今日の${a.totalPings}件を明日${bench.targetPings}件にするな。まず90件、そして切り返し1回。それだけで数字は動く。ここを直せば勝てる。`,
  });

  return blocks;
}
const COACH_COMMENT = generateCoachComment(TODAY_ANALYSIS, TODAY_GAP, TOP_BENCHMARK);

/* ---- 明日の改善アクション ---- */
const NEXT_ACTIONS = [
  { icon: '🌅', text: '午前中（〜12時）で45ピンポンを必ず完了させる', metric: '午前45件' },
  { icon: '⏱️', text: '14時台の無音・空白を15分以内に抑える（GPSログ提出）', metric: '空白<15分' },
  { icon: '🔁', text: '断られた後、最低1回は切り返す（電気代の確認を挟む）', metric: '切り返し≥1' },
  { icon: '🎯', text: '冒頭10秒以内に「電気代」「無料診断」「明細」のどれかを必ず入れる', metric: '冒頭質問80%' },
  { icon: '🌆', text: '17時以降は在宅率が高い。ラスト2時間を最重点で稼働する', metric: '夕方密度UP' },
];

/* ============================================================
   営業マン一覧
   ============================================================ */
// 営業名簿：初期は空。管理者マスタ（名簿編集）で本部長が自チームを登録する。
// ※デモ用のサンプル名簿が要る場合は管理者マスタの「サンプルを入れる」から復元できる。
const DEFAULT_REPS = [];

// デモ用サンプル名簿（初期表示には出さない。管理者マスタから任意で投入）
const SAMPLE_REPS = [
  { id: 's1', name: '佐藤 大輝', team: '第1営業部', role: 'エース', pings: 104, target: 100, achieve: 104, apo: 4, score: 94, idle: 8,  priority: 'low', current: false, homeResponseRate: 38, conversationRate: 22, averageConversationSeconds: 58, averageRebuttalCount: 1.9, openingQuestionRate: 82, appointmentRate: 3.8 },
  { id: 's2', name: '鈴木 健',   team: '第1営業部', role: '中堅',   pings: 92,  target: 100, achieve: 92,  apo: 3, score: 81, idle: 18, priority: 'mid', current: false, homeResponseRate: 34, conversationRate: 19, averageConversationSeconds: 50, averageRebuttalCount: 1.5, openingQuestionRate: 74, appointmentRate: 3.3 },
  { id: 's3', name: '伊藤 美咲', team: '第1営業部', role: '中堅',   pings: 88,  target: 100, achieve: 88,  apo: 3, score: 77, idle: 22, priority: 'mid', current: false, homeResponseRate: 32, conversationRate: 18, averageConversationSeconds: 47, averageRebuttalCount: 1.3, openingQuestionRate: 68, appointmentRate: 3.4 },
  { id: 's4', name: '田中 翔',   team: '第2営業部', role: '新人',   pings: 78,  target: 100, achieve: 78,  apo: 2, score: 62, idle: 45, priority: 'high', current: false, homeResponseRate: 26.8, conversationRate: 17.9, averageConversationSeconds: 34, averageRebuttalCount: 0.4, openingQuestionRate: 37, appointmentRate: 2.6 },
  { id: 's5', name: '高橋 蓮',   team: '第2営業部', role: '新人',   pings: 61,  target: 100, achieve: 61,  apo: 1, score: 48, idle: 72, priority: 'high', current: false, homeResponseRate: 22, conversationRate: 14, averageConversationSeconds: 30, averageRebuttalCount: 0.3, openingQuestionRate: 31, appointmentRate: 1.6 },
  { id: 's6', name: '渡辺 陸',   team: '第2営業部', role: '新人',   pings: 55,  target: 100, achieve: 55,  apo: 0, score: 41, idle: 96, priority: 'high', current: false, homeResponseRate: 19, conversationRate: 12, averageConversationSeconds: 26, averageRebuttalCount: 0.2, openingQuestionRate: 24, appointmentRate: 1.0 },
];

// 営業名簿：管理者マスタの編集をlocalStorageに永続化
function loadReps() {
  try { const s = JSON.parse(localStorage.getItem('rumina_reps_v1')); return Array.isArray(s) && s.length ? s : DEFAULT_REPS.map(r => ({ ...r })); }
  catch { return DEFAULT_REPS.map(r => ({ ...r })); }
}
function saveReps(list) { try { localStorage.setItem('rumina_reps_v1', JSON.stringify(list)); } catch {} if (window.RUMINA) window.RUMINA.SALES_REPS = list; }
function resetReps() { try { localStorage.removeItem('rumina_reps_v1'); } catch {} const d = DEFAULT_REPS.map(r => ({ ...r })); if (window.RUMINA) window.RUMINA.SALES_REPS = d; return d; }

/* ---- レーダー比較（本人 vs トップ）を任意のanalysisから生成（0-100正規化） ---- */
function buildRadar(a, b) {
  const n = (x, y) => Math.max(0, Math.round((x / y) * 100));
  return [
    { key: '行動量',   me: n(a.totalPings, b.targetPings), top: 100 },
    { key: '在宅反応', me: n(a.homeResponseRate, b.homeResponseRate), top: 100 },
    { key: '会話発生', me: n(a.conversationRate, b.conversationRate), top: 100 },
    { key: '会話時間', me: n(a.averageConversationSeconds, b.averageConversationSeconds), top: 100 },
    { key: '切り返し', me: n(a.averageRebuttalCount, b.averageRebuttalCount), top: 100 },
    { key: 'アポ率',   me: n(a.appointmentRate, b.appointmentRate), top: 100 },
    { key: '冒頭質問', me: n(a.openingQuestionRate, b.openingQuestionRate), top: 100 },
  ];
}

/* ---- 解析シミュレーション用ステージ ---- */
const ANALYZE_STAGES = [
  { key: 'split',     label: '音声分割', sub: '7時間の録音を12分単位に分割', chunks: 34 },
  { key: 'transcribe',label: '文字起こし', sub: 'チャンクごとにWhisperへ投入（想定）' },
  { key: 'segment',   label: 'ピンポン分割', sub: '訪問1件ごとに会話を切り出し' },
  { key: 'analyze',   label: 'AI解析', sub: 'KPI算出・トップ営業との差分検知' },
  { key: 'coach',     label: '鬼教官講評', sub: '弱点抽出と明日の改善アクション生成' },
];

/* ---- 鬼教官スコア（パイプラインと同一式：主要KPIのトップ比平均） ---- */
function computeScore(a, b) {
  const c = r => Math.max(0, Math.min(1.2, r || 0));
  const rs = [
    a.totalPings / b.targetPings,
    a.homeResponseRate / b.homeResponseRate,
    a.averageConversationSeconds / b.averageConversationSeconds,
    a.averageRebuttalCount / b.averageRebuttalCount,
    a.appointmentRate / b.appointmentRate,
    a.openingQuestionRate / b.openingQuestionRate,
  ].map(c);
  return Math.round(rs.reduce((x, y) => x + y, 0) / rs.length * 100);
}

/* ---- 結果突合（GPS総ピンポン数＋CRM確定アポ）の保存/反映 ---- */
function crmKey(a) { return 'crm:' + (a.date || 'd') + '|' + (a.salesRepName || '田中 翔'); }
function saveCrm(a, obj) { try { localStorage.setItem(crmKey(a), JSON.stringify(obj)); } catch {} }
function applyCrmConfirm(a) {
  let raw; try { raw = localStorage.getItem(crmKey(a)); } catch { return; }
  if (!raw) return;
  let o; try { o = JSON.parse(raw); } catch { return; }
  const T = o.totalPings || a.totalPings;
  a.totalPings = T;
  a.targetAchievementRate = Math.round(T / a.targetPings * 100);
  a.homeResponseRate = +(a.homeResponseCount / T * 100).toFixed(1);
  a.conversationRate = +(a.conversationCount / T * 100).toFixed(1);
  a.prospectRate = +(a.prospectCount / T * 100).toFixed(1);
  if (o.apo != null) a.appointmentCount = o.apo;
  a.appointmentRate = +(a.appointmentCount / T * 100).toFixed(1);
  a.quality = { ...(a.quality || {}), crmConfirmed: true,
    estimatedFields: ((a.quality || {}).estimatedFields || []).filter(f => !['appointmentRate', 'homeResponseRate', 'conversationRate'].includes(f)) };
}

/* ============================================================
   Fit Founder代表・八賀の「勝ちトークロジック」基準
   トップ営業の"数値"基準(TOP_BENCHMARK)に対し、こちらは
   "どう話すか"の質的な型（フェーズ）。営業マンのトーク特徴が
   このロジックからどこでズレているか（乖離）を可視化する。
   ============================================================ */
const HAGA_TALK_LOGIC = {
  author: 'Fit Founder 代表 八賀',
  title: '八賀式 訪販トークロジック（電気・太陽光・蓄電池）',
  principle: '売り込まない。「気づき」を渡して、相手の口から課題を言わせる。断りは“入口”、最後は二択で必ず日程を置く。',
  phases: [
    { key: 'hook', no: 1, name: '冒頭フック（開口10秒）', move: '冒頭フック',
      idea: '名乗りで終わらせない。10秒以内に「電気代／無料診断／明細」のどれかを刺し、相手に喋らせる。',
      phrases: ['こんにちは、電気の“健康診断”で回っています。', '今、電気代って上がっていませんか？'],
      kpi: 'openingQuestionRate', bench: 80 },
    { key: 'problem', no: 2, name: '問題提起（危機感の共有）', move: '問題提起',
      idea: '値上げ・時間帯単価など“相手ごと”の不利益を、相手の口から言わせて危機感を共有する。',
      phrases: ['夜トク8だと昼の単価が高くて…', '燃料費調整でこの1年、じわじわ上がってますよね。'],
      kpi: 'conversationRate', bench: TOP_BENCHMARK.conversationRate },
    { key: 'detail', no: 3, name: '明細ドライブ（明細を見せてもらう）', move: '明細ドライブ',
      idea: '“売る”のではなく“見る”。明細を30秒見せてもらう合意を取り、警戒を下げて会話を深める。',
      phrases: ['明細だけ、30秒見させてもらえますか？', '数字を見れば、下げられる余地があるか一目で分かります。'],
      kpi: 'averageConversationSeconds', bench: TOP_BENCHMARK.averageConversationSeconds },
    { key: 'value', no: 4, name: '価値提示（創蓄・補助金の“今だけ”）', move: '創蓄・補助金',
      idea: 'エコキュート／太陽光／蓄電池を入口に、補助金という“今だけ”の価値で前傾させる。',
      phrases: ['補助金が“今だけ”なんです。', '創って貯めて使う、で電気代の考え方ごと変わります。'],
      kpi: 'prospectRate', bench: 8 },
    { key: 'rebuttal', no: 5, name: '切り返し（断りへの粘り）', move: '切り返し',
      idea: '断られた瞬間に終わらない。最低1回「電気代だけ確認しても？」で粘りのターンを作る。',
      phrases: ['ちなみに電気代だけ、確認してもいいですか？', 'お手間は取らせません。見るだけで大丈夫です。'],
      kpi: 'averageRebuttalCount', bench: TOP_BENCHMARK.averageRebuttalCount },
    { key: 'close', no: 6, name: '2択クロージング（日程確定）', move: '2択クロージング',
      idea: '「行っていいですか？」ではなく、“AかB”の二択で日程を置いてくる。',
      phrases: ['明日の夕方と明後日の昼、どちらがご都合いいですか？', '明細を見る日だけ、先に押さえさせてください。'],
      kpi: 'appointmentRate', bench: TOP_BENCHMARK.appointmentRate },
  ],
};

// 八賀ロジックとの乖離を算出（勝ちトークのmove有無＋KPIのトップ基準比の二軸）
function buildTalkDeviation(a) {
  const used = new Set(((a.winTalk && a.winTalk.topMoves) || []).map(m => m.move));
  const rows = HAGA_TALK_LOGIC.phases.map(p => {
    const val = a[p.kpi];
    const ratio = (p.bench && val != null) ? val / p.bench : null;
    const hasMove = used.has(p.move);
    let status; // ok=再現できている / weak=あと一歩 / missing=型が出ていない
    if (hasMove && (ratio == null || ratio >= 0.9)) status = 'ok';
    else if (!hasMove && ratio != null && ratio < 0.7) status = 'missing';
    else status = 'weak';
    return { ...p, val, ratio: ratio == null ? null : +ratio.toFixed(2), hasMove, status };
  });
  const okc = rows.filter(r => r.status === 'ok').length;
  return {
    coverage: okc, total: rows.length,
    coveragePct: Math.round(okc / rows.length * 100),
    rows, gaps: rows.filter(r => r.status !== 'ok'),
  };
}

// 八賀ロジックをテキスト化（ダウンロード用）
function hagaLogicText() {
  const L = HAGA_TALK_LOGIC;
  let s = `${L.title}\n（監修：${L.author}）\n\n■ 基本思想\n${L.principle}\n\n`;
  L.phases.forEach(p => {
    s += `【${p.no}. ${p.name}】\n・狙い：${p.idea}\n・お手本トーク：\n`;
    p.phrases.forEach(ph => { s += `    「${ph}」\n`; });
    s += `・基準の型：${p.move}\n\n`;
  });
  s += `— Rumina 鬼教官 / Fit Founder\n`;
  return s;
}

window.RUMINA = {
  TOP_BENCHMARK, TODAY_ANALYSIS, NEXT_ACTIONS,
  SALES_REPS: loadReps(), DEFAULT_REPS, SAMPLE_REPS, SAMPLE_TRANSCRIPT, PING_EVENTS, ANALYZE_STAGES,
  computeGap, generateCoachComment, buildRadar, computeScore, saveCrm, applyCrmConfirm,
  saveReps, resetReps,
  HAGA_TALK_LOGIC, buildTalkDeviation, hagaLogicText,
};
