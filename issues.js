/* ============================================================
   Rumina 鬼教官 — イシュー分析（トップ営業 vs 下位営業）
   グループ平均を比較し、アポ損失をファネルに分解して
   「組織のどこが負けているか（イシュー）」を炙り出す。
   ============================================================ */
(function () {
  const R = window.RUMINA;

  const KPIS = [
    { key: 'pings', label: '行動量（ピンポン）', unit: '件', dir: 1 },
    { key: 'homeResponseRate', label: '在宅反応率', unit: '%', dir: 1 },
    { key: 'conversationRate', label: '会話発生率', unit: '%', dir: 1 },
    { key: 'averageConversationSeconds', label: '平均会話時間', unit: '秒', dir: 1 },
    { key: 'openingQuestionRate', label: '冒頭質問率', unit: '%', dir: 1 },
    { key: 'averageRebuttalCount', label: '切り返し回数', unit: '回', dir: 1 },
    { key: 'appointmentRate', label: 'アポ率', unit: '%', dir: 1 },
  ];

  const avg = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length;
  const round = (x, d = 1) => +x.toFixed(d);

  function profileOf(members) {
    const p = { members };
    KPIS.forEach(k => (p[k.key] = round(avg(members, k.key), k.key === 'averageConversationSeconds' || k.key === 'pings' ? 0 : 1)));
    p.score = Math.round(avg(members, 'score'));
    return p;
  }

  /**
   * @param {Array} reps 全営業マン（フルKPI付き）
   * @param {{topMin?:number, bottomMax?:number, periodDays?:number}} opts
   */
  function compare(reps, opts = {}) {
    const topMin = opts.topMin ?? 80;       // スコアこれ以上＝トップ群
    const bottomMax = opts.bottomMax ?? 65; // スコアこれ未満＝下位群
    const periodDays = opts.periodDays ?? 22;

    const sorted = reps.slice().sort((a, b) => b.score - a.score);
    const topMembers = sorted.filter(r => r.score >= topMin);
    const bottomMembers = sorted.filter(r => r.score < bottomMax);
    const top = profileOf(topMembers);
    const bottom = profileOf(bottomMembers);

    // KPIギャップ（下位 − トップ）
    const gaps = KPIS.map(k => ({
      key: k.key, label: k.label, unit: k.unit,
      top: top[k.key], bottom: bottom[k.key],
      gap: round(bottom[k.key] - top[k.key], 1),
      // トップ比の到達率（下位はトップの何%か）
      ratio: top[k.key] ? Math.round(bottom[k.key] / top[k.key] * 100) : 0,
    }));

    // アポ損失のファネル分解（トップ→下位）
    const F = window.GOALS.funnel;
    const G = F(top.pings, top.homeResponseRate, top.conversationRate, top.appointmentRate);
    const A = F(bottom.pings, bottom.homeResponseRate, bottom.conversationRate, bottom.appointmentRate);
    const s0 = G.pings * G.home * G.convGivenHome * G.apoGivenConv;
    const s1 = A.pings * G.home * G.convGivenHome * G.apoGivenConv;
    const s2 = A.pings * A.home * G.convGivenHome * G.apoGivenConv;
    const s3 = A.pings * A.home * A.convGivenHome * G.apoGivenConv;
    const s4 = A.pings * A.home * A.convGivenHome * A.apoGivenConv;

    const worst = (metric, n = 2) => bottomMembers.slice().sort((x, y) => x[metric] - y[metric]).slice(0, n).map(r => r.name);
    const stageDefs = [
      { key: 'action', stage: '行動量', perDay: s0 - s1, metric: 'pings',
        driver: `下位のピンポンは平均${bottom.pings}件、トップは${top.pings}件`,
        cause: '訪問母数が足りず、確率を掛ける前の分母が小さい。ルート設計と稼働管理の問題。',
        fix: '午前ノルマ（例：45件）を全員に課し、日報で時間帯別ピンポンを可視化する。' },
      { key: 'home', stage: '在宅反応', perDay: s1 - s2, metric: 'homeResponseRate',
        driver: `在宅反応率 下位${bottom.homeResponseRate}% / トップ${top.homeResponseRate}%`,
        cause: '在宅の薄い時間帯・エリアを回っている。会えていない。',
        fix: 'トップのルート・時間帯配分を共有し、夕方以降に密度を寄せる。' },
      { key: 'talk', stage: '会話化', perDay: s2 - s3, metric: 'openingQuestionRate',
        driver: `冒頭質問率 下位${bottom.openingQuestionRate}% / トップ${top.openingQuestionRate}%・会話時間 下位${bottom.averageConversationSeconds}秒`,
        cause: '会えても冒頭で切られ、会話に入れていない。名乗りで終わっている。',
        fix: 'トップの冒頭10秒スクリプトを全員暗唱。「電気代/無料診断/明細」を必ず刺す。' },
      { key: 'close', stage: 'クロージング', perDay: s3 - s4, metric: 'averageRebuttalCount',
        driver: `切り返し 下位${bottom.averageRebuttalCount}回 / トップ${top.averageRebuttalCount}回・アポ率 下位${bottom.appointmentRate}%`,
        cause: '会話は起きているのに、断りから復帰できずアポに落とせていない。',
        fix: '断り→切り返しのロープレを毎朝。終盤は日時2択で置いてくる型を徹底。' },
    ];
    const bottomCount = bottomMembers.length;
    const issues = stageDefs
      .map(d => ({
        ...d,
        perDay: round(Math.max(0, d.perDay), 2),
        teamMonthly: Math.round(Math.max(0, d.perDay) * periodDays * bottomCount),
        worstReps: worst(d.metric),
      }))
      .filter(d => d.perDay > 0)
      .sort((a, b) => b.perDay - a.perDay)
      .map((d, i) => ({ ...d, severity: i === 0 ? 'critical' : i === 1 ? 'warn' : 'watch' }));

    const perDayGap = round(G.apo - A.apo, 2);
    const teamMonthlyTotal = Math.round(perDayGap * periodDays * bottomCount);

    return {
      periodDays, top, bottom,
      topApoPerDay: round(G.apo, 2), bottomApoPerDay: round(A.apo, 2),
      perDayGap, teamMonthlyTotal, bottomCount,
      gaps, issues,
      narrative: narrate({ top, bottom, perDayGap, teamMonthlyTotal, bottomCount, periodDays, issues }),
    };
  }

  function narrate(x) {
    const out = [];
    const top = x.issues[0], second = x.issues[1];
    out.push({ tone: 'harsh', title: '結論',
      text: `下位${x.bottomCount}名はトップ群に比べ、1人あたり1日${x.perDayGap.toFixed(1)}件のアポを落としている。チーム全体では月あたり約${x.teamMonthlyTotal}件の機会損失だ。これは個人の才能差ではなく、埋められる“型の差”だ。` });
    if (top) out.push({ tone: 'harsh', title: `最大のイシュー：${top.stage}`,
      text: `一番効くのが「${top.stage}」。ここだけでチーム月約${top.teamMonthly}件を落としている。${top.driver}。特に ${top.worstReps.join('・')} が全体を下げている。${top.cause} → ${top.fix}` });
    if (second) out.push({ tone: 'warn', title: `次のイシュー：${second.stage}`,
      text: `次に効くのが「${second.stage}」でチーム月約${second.teamMonthly}件。${second.driver}。${second.fix}` });
    out.push({ tone: 'close', title: '打ち手',
      text: `全員を一度に底上げしようとするな。まず「${top ? top.stage : '行動量'}」だけをトップ水準に寄せる。${top ? top.worstReps[0] : ''}を筆頭に、この一点を今週の全体テーマにすれば、チームの数字は動く。` });
    return out;
  }

  window.ISSUES = { compare, KPIS };
})();
