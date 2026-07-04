/* ============================================================
   Rumina 鬼教官 — 目標設定＆逆算エンジン
   「期間アポ目標」に対して、なぜ届かないのかを
   行動→在宅→会話→クロージングのファネルに分解し、
   各段が期間で何件のアポを削っているかを算出して言語化する。
   ============================================================ */
(function () {
  const R = window.RUMINA;
  const KEY = 'rumina_goals_v1';

  // 既定目標＝トップ営業ベンチマーク（＝“型のコピー”の到達点）
  function defaults() {
    const b = R.TOP_BENCHMARK;
    return {
      targetApoPeriod: 60,          // 期間(勤務日数)での目標アポ数
      periodDays: 22,               // 勤務数
      pings: b.targetPings,         // 1日ピンポン目標
      homeResponseRate: b.homeResponseRate,
      conversationRate: b.conversationRate,
      averageConversationSeconds: b.averageConversationSeconds,
      averageRebuttalCount: b.averageRebuttalCount,
      openingQuestionRate: b.openingQuestionRate,
      appointmentRate: b.appointmentRate,
    };
  }

  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s ? { ...defaults(), ...s } : defaults(); }
    catch { return defaults(); }
  }
  function save(g) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {} }

  // アポのファネル分解（テレスコープ：pings×home×(conv|home)×(apo|conv) = pings×apoRate）
  function funnel(pings, homeRate, convRate, apoRate) {
    const home = homeRate / 100;
    const convGivenHome = homeRate > 0 ? convRate / homeRate : 0;
    const apoGivenConv = convRate > 0 ? apoRate / convRate : 0;
    return { pings, home, convGivenHome, apoGivenConv,
      apo: pings * home * convGivenHome * apoGivenConv };
  }

  /**
   * 目標アポに対する不足を要因分解する。
   * @param {object} a 現状の AnalysisResult（当日を1日ペースの代理として使用）
   * @param {object} g 目標
   */
  function backcast(a, g) {
    const periodDays = Math.max(1, g.periodDays);
    const neededPerDay = g.targetApoPeriod / periodDays;

    const G = funnel(g.pings, g.homeResponseRate, g.conversationRate, g.appointmentRate);
    const A = funnel(a.totalPings, a.homeResponseRate, a.conversationRate, a.appointmentRate);

    // 目標の“行動設計上限”（この目標値でやり切ったときの1日アポ）
    const designPerDay = G.apo;
    const actualPerDay = A.apo;
    const feasible = designPerDay * periodDays >= g.targetApoPeriod - 1e-6;

    // ウォーターフォール：目標設計値→実測値へ1段ずつ差し替え、各段の逸失を測る
    const s0 = G.pings * G.home * G.convGivenHome * G.apoGivenConv;                    // = designPerDay
    const s1 = A.pings * G.home * G.convGivenHome * G.apoGivenConv;
    const s2 = A.pings * A.home * G.convGivenHome * G.apoGivenConv;
    const s3 = A.pings * A.home * A.convGivenHome * G.apoGivenConv;
    const s4 = A.pings * A.home * A.convGivenHome * A.apoGivenConv;                    // = actualPerDay

    // 各段の逸失は符号付き（正=目標に対する穴／負=目標超過の“貯金”）。
    // 合計は必ず designPerDay - actualPerDay に一致する（加法的・整合）。
    const raw = [
      { key: 'action', stage: '行動量',       perDay: s0 - s1,
        driver: `ピンポン ${a.totalPings}件（目標${g.pings}件）`,
        cause: '訪問母数そのものが足りず、確率を掛ける前の分母が小さい。',
        fix: `午前で${Math.ceil(g.pings * 0.45)}件を先取りし、時間帯ノルマで積む。` },
      { key: 'home', stage: '在宅反応',       perDay: s1 - s2,
        driver: `在宅反応率 ${a.homeResponseRate}%（目標${g.homeResponseRate}%）`,
        cause: '在宅の薄い時間帯・エリアを回っている。会えていない。',
        fix: '在宅率の高い夕方以降に密度を寄せ、日中は反応母数の多い面を回る。' },
      { key: 'talk', stage: '会話化',         perDay: s2 - s3,
        driver: `冒頭質問率 ${a.openingQuestionRate}%（目標${g.openingQuestionRate}%）・平均会話${a.averageConversationSeconds}秒`,
        cause: '会えても冒頭で切られ、会話に入れていない。名乗りで終わっている。',
        fix: '一言目を質問に変える（「電気代」「明細」「無料診断」を10秒以内に刺す）。' },
      { key: 'close', stage: 'クロージング',   perDay: s3 - s4,
        driver: `切り返し ${a.averageRebuttalCount}回（目標${g.averageRebuttalCount}回）・アポ率 ${a.appointmentRate}%`,
        cause: '会話は起きているのに、断りから復帰できずアポに落とせていない。',
        fix: '断り後に最低1回粘り、終盤は日時を2択で置いてくる。' },
    ];
    const losses = raw
      .map(x => ({ ...x, perDay: +x.perDay.toFixed(2), period: Math.round(x.perDay * periodDays) }))
      .sort((x, y) => y.perDay - x.perDay);

    const projectedPeriod = Math.round(actualPerDay * periodDays);
    const gapPeriod = g.targetApoPeriod - projectedPeriod;      // 正=不足

    return {
      periodDays,
      targetApoPeriod: g.targetApoPeriod,
      neededPerDay: +neededPerDay.toFixed(2),
      actualPerDay: +actualPerDay.toFixed(2),
      designPerDay: +designPerDay.toFixed(2),
      projectedPeriod,
      gapPeriod,
      onTrack: gapPeriod <= 0,
      feasible,
      losses,
      narrative: narrate({ periodDays, target: g.targetApoPeriod, neededPerDay, actualPerDay, projectedPeriod, gapPeriod, onTrack: gapPeriod <= 0, feasible, designPerDay, losses }),
    };
  }

  // 鬼教官トーンの言語化（ルールベース＝安定・説明可能）
  function narrate(x) {
    const holes = x.losses.filter(l => l.period > 0);   // 穴だけ（貯金は除く）
    const top = holes[0], second = holes[1];
    const out = [];

    // 結論：不足 / 達成ペースで語り分け
    if (!x.onTrack) {
      out.push({ tone: 'harsh', title: '結論',
        text: `目標は${x.periodDays}勤務で${x.target}アポ。1日あたり${x.neededPerDay.toFixed(1)}件が必要だ。だが今のペースは${x.actualPerDay.toFixed(1)}件／日、このままなら期間で${x.projectedPeriod}件しか積めない。${x.gapPeriod}件足りない。これは運じゃない、構造の問題だ。` });
    } else {
      out.push({ tone: 'good', title: '結論',
        text: `目標${x.target}アポに対し、今のペースなら${x.projectedPeriod}件。達成ラインには乗っている。ただし惰性で守るな。下の穴を埋めれば、同じ勤務数で更に${holes.reduce((s, h) => s + h.period, 0)}件を上積みできる。` });
    }

    if (top) out.push({ tone: 'harsh', title: `最大の穴：${top.stage}`,
      text: `一番アポを削っているのは「${top.stage}」。ここだけで1日${top.perDay.toFixed(1)}件、期間で約${top.period}件を落としている。${top.driver}。${top.cause} → ${top.fix}` });

    if (second) out.push({ tone: 'warn', title: `次の穴：${second.stage}`,
      text: `次に効くのが「${second.stage}」で期間約${second.period}件。${second.cause} ${second.fix}` });

    if (!x.feasible) out.push({ tone: 'warn', title: '目標設計の警告',
      text: `今の目標値をすべて達成しても、行動設計上は1日${x.designPerDay.toFixed(1)}件＝期間${Math.round(x.designPerDay * x.periodDays)}件が上限だ。${x.target}件に届かせたいなら、ピンポン目標かアポ率の目標自体を引き上げないと数字が合わない。` });

    out.push({ tone: 'close', title: 'やること',
      text: top
        ? `全部を一度に直すな。まず「${top.stage}」だけを目標値まで戻せ。それだけで期間${top.period}件が動く。ここを直せば届く。`
        : `全項目が目標を満たしている。次は目標値そのものを引き上げて、上のステージを狙え。` });
    return out;
  }

  window.GOALS = { defaults, load, save, backcast, funnel, current: load() };
})();
