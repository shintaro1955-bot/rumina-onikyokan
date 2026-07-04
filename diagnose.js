/* ============================================================
   Rumina 鬼教官 — 自動診断エンジン
   AnalysisResult × TopSalesBenchmark から
   「何がダメか（弱点）」「何に気をつけるべきか（注意/伸びしろ）」を
   閾値ルールで自動判定・自動生成する。
   実APIの解析結果が入っても同じ関数がそのまま機能する設計。
   ============================================================ */
(function () {
  const R = window.RUMINA;

  // 弱点判定の閾値（トップ営業比 何割を切ったら指摘するか）
  const TH = {
    pings:      { warn: 0.90, crit: 0.80 },
    homeRate:   { warn: 0.90, crit: 0.75 },
    convSec:    { warn: 0.90, crit: 0.70 },
    rebuttal:   { warn: 0.80, crit: 0.50 },
    opening:    { warn: 0.90, crit: 0.60 },
    apoRate:    { warn: 1.00, crit: 0.60 },
  };
  const sev = (ratio, th) => ratio < th.crit ? 'critical' : ratio < th.warn ? 'warn' : null;

  function diagnose(a, b, hourly, objections) {
    const W = []; // 何がダメか
    const C = []; // 何に気をつけるべきか

    /* ---------- 弱点（ダメ）判定 ---------- */
    // 1. 行動量
    let r = a.totalPings / b.targetPings, s = sev(r, TH.pings);
    if (s) W.push({ severity: s, metric: '行動量',
      finding: `ピンポン ${a.totalPings}件 / 目標${b.targetPings}件（達成${Math.round(r*100)}%・${b.targetPings-a.totalPings}件不足）`,
      cause: '稼働時間に空白帯があり、訪問数が物理的に積み上がっていない。',
      fix: `午前中に${Math.ceil(b.targetPings*0.45)}件を先取りし、時間帯ごとのノルマで管理する。` });

    // 2. 在宅反応率
    r = a.homeResponseRate / b.homeResponseRate; s = sev(r, TH.homeRate);
    if (s) W.push({ severity: s, metric: '在宅反応',
      finding: `在宅反応率 ${a.homeResponseRate}%（トップ${b.homeResponseRate}%・${(a.homeResponseRate-b.homeResponseRate).toFixed(1)}pt）`,
      cause: '在宅の多い時間帯・エリアを外して回っている可能性。ルート設計の問題。',
      fix: '在宅率の高い夕方以降に訪問密度を寄せ、日中は集合住宅など反応母数の多い面を回る。' });

    // 3. 平均会話時間
    r = a.averageConversationSeconds / b.averageConversationSeconds; s = sev(r, TH.convSec);
    if (s) W.push({ severity: s, metric: '会話の深さ',
      finding: `平均会話 ${a.averageConversationSeconds}秒（トップ${b.averageConversationSeconds}秒・${a.averageConversationSeconds-b.averageConversationSeconds}秒）`,
      cause: '話が続く前に切られている。冒頭で相手の関心を掴めていない。',
      fix: '一言目を「名乗り」から「質問」に変える。相手に喋らせて会話時間を伸ばす。' });

    // 4. 切り返し回数
    r = a.averageRebuttalCount / b.averageRebuttalCount; s = sev(r, TH.rebuttal);
    if (s) W.push({ severity: s, metric: '切り返し',
      finding: `切り返し平均 ${a.averageRebuttalCount}回（トップ${b.averageRebuttalCount}回）`,
      cause: '断られた瞬間に営業を終了している。粘りのターンが発生していない。',
      fix: '断り後に最低1回、「電気代だけ確認してもいいですか？」で必ず粘る。' });

    // 5. 冒頭質問率
    r = a.openingQuestionRate / b.openingQuestionRate; s = sev(r, TH.opening);
    if (s) W.push({ severity: s, metric: '冒頭10秒',
      finding: `冒頭質問率 ${a.openingQuestionRate}%（トップ${b.openingQuestionRate}%・${a.openingQuestionRate-b.openingQuestionRate}pt）`,
      cause: '開口一番で用件を言い切り、質問を投げていない。会話開始前に切られる主因。',
      fix: '冒頭10秒に「電気代」「無料診断」「明細」のどれかを必ず刺す。' });

    // 6. アポ率
    r = a.appointmentRate / b.appointmentRate; s = sev(r, TH.apoRate);
    if (s) W.push({ severity: s, metric: 'クロージング',
      finding: `アポ率 ${a.appointmentRate}%（トップ${b.appointmentRate}%）`,
      cause: '会話は起きているのに次アポに繋げられていない。締めの一手が弱い。',
      fix: '会話終盤に「明細だけ見る日」を提案し、日時を2択で置いてくる。' });

    /* ---------- 注意（気をつけるべき）判定 ---------- */
    // A. サボり疑い時間帯（GPS接続時は裏取り済みで断定／未接続時は誤判定リスクを明示）
    if (a.gps?.connected) {
      if (a.suspiciousIdleTimeMinutes >= 10) C.push({ level: 'risk', label: '実サボり（GPS確定）',
        note: `GPS照合の結果、${a.suspiciousWindow}の空白のうち移動を除いた実サボりは${a.suspiciousIdleTimeMinutes}分。移動${a.gps.movingTimeMinutes}分・接客${a.gps.stayTimeMinutes}分・訪問${a.gps.visitClusters}件は裏取り済み。ここは明日ゼロにしろ。` });
    } else if (a.suspiciousIdleTimeMinutes >= 20) {
      C.push({ level: 'risk', label: '空白時間',
        note: `${a.suspiciousWindow}に約${a.suspiciousIdleTimeMinutes}分の空白。ただし移動・昼食・電波断の可能性もある。詰める前にGPS/明細で裏取りし、自分で先に潰せ。` });
    }

    // B. 無音・録音品質（データ信頼性の注意）
    if (a.silentTimeMinutes >= 60) C.push({ level: 'risk', label: 'データ信頼性',
      note: `無音が計${a.silentTimeMinutes}分。マイクが会話を拾えていない区間があると、数字が実態より低く出る。録音位置とGPSログを併せて確認する。` });

    // C. 断り文句の偏り（弱点の型）
    if (objections && objections.length) {
      const total = objections.reduce((x, o) => x + o.count, 0);
      const top = objections[0];
      if (total > 0 && top.count / total >= 0.25) C.push({ level: 'risk', label: '崩せない断り',
        note: `断りの${Math.round(top.count/total*100)}%が「${top.label}」に集中。この一言への切り返しスクリプトを1本、丸暗記で用意しておけ。` });
    }

    // D. 夕方の伸びしろ（活かせる面＝機会）
    if (hourly && hourly.length) {
      const late = hourly.filter(h => h.hour >= 17);
      const lateHome = late.reduce((x, h) => x + h.home, 0);
      const latePing = late.reduce((x, h) => x + h.ping, 0);
      if (latePing > 0 && lateHome / latePing >= 0.35) C.push({ level: 'tip', label: '伸びしろ',
        note: `17時以降の在宅反応が濃い（${lateHome}/${latePing}）のに訪問数が薄い。明日はラスト2時間を最重点に寄せれば同じ体力で数字が伸びる。` });

      // E. 昼の失速
      const noon = hourly.filter(h => h.hour === 12 || h.hour === 13);
      const avgOther = hourly.filter(h => h.hour !== 12 && h.hour !== 13).reduce((x, h) => x + h.ping, 0) / Math.max(1, hourly.length - 2);
      const noonAvg = noon.reduce((x, h) => x + h.ping, 0) / Math.max(1, noon.length);
      if (noon.length && noonAvg < avgOther * 0.6) C.push({ level: 'tip', label: '昼の失速',
        note: `12〜13時台の訪問密度が他時間帯の半分以下。昼の1時間を捨てている。軽食は移動中に済ませ、昼こそ在宅を拾え。` });
    }

    // 重大度でソート（弱点：critical→warn）
    const order = { critical: 0, warn: 1 };
    W.sort((x, y) => order[x.severity] - order[y.severity]);

    const grade =
      a.coachScore >= 90 ? 'S' : a.coachScore >= 80 ? 'A' :
      a.coachScore >= 65 ? 'B' : a.coachScore >= 50 ? 'C' : 'D';

    return {
      grade,
      criticalCount: W.filter(w => w.severity === 'critical').length,
      warnCount: W.filter(w => w.severity === 'warn').length,
      weaknesses: W,
      cautions: C,
    };
  }

  R.diagnose = diagnose;

  // 現在表示中のセッション。mock でも実API結果でも同じ導出を通す。
  R.loadAnalysis = function (a) {
    const b = R.TOP_BENCHMARK;
    R.applyCrmConfirm(a);              // 保存済みの結果突合（GPS総数/CRMアポ）を反映
    a.coachScore = R.computeScore(a, b); // スコアは常に同一式で再計算
    const gap = R.computeGap(a, b);
    window.SESSION = {
      analysis: a,
      gap,
      coach: R.generateCoachComment(a, gap, b),
      diagnosis: diagnose(a, b, a.hourly || [], a.objectionRanking || []),
      radar: R.buildRadar(a, b),
    };
    return window.SESSION;
  };

  // 初期表示は mock（田中翔）
  R.loadAnalysis(R.TODAY_ANALYSIS);
})();
