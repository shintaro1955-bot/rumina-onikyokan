/* ============================================================
   Rumina 鬼教官 — アプリ本体（バニラSPA）
   デザイン方針：フラット／ニュートラル／余白多め／アクセントは緑のみ。
   ============================================================ */
const R = window.RUMINA, C = window.CHARTS;
const app = document.getElementById('app');
let currentView = 'goal';

/* ---------- 共通パーツ ---------- */
function h1(title, sub) {
  return `<div class="mb-6">
    <h1 class="text-xl font-semibold text-neutral-100">${title}</h1>
    ${sub ? `<p class="text-sm text-neutral-500 mt-1">${sub}</p>` : ''}</div>`;
}
function card(inner, cls = '') { return `<div class="border border-white/10 rounded-lg ${cls}">${inner}</div>`; }
function statCell(label, value, unit, sub, accent) {
  return `<div class="p-4">
    <div class="text-xs text-neutral-500 mb-1">${label}</div>
    <div class="text-xl font-semibold tabular-nums ${accent || 'text-neutral-100'}">${value}<span class="text-xs text-neutral-500 ml-0.5">${unit || ''}</span></div>
    ${sub ? `<div class="text-[11px] text-neutral-600 mt-0.5">${sub}</div>` : ''}</div>`;
}
function section(title, body, sub) {
  return `<section class="mt-8">
    <div class="mb-3"><h2 class="text-sm font-semibold text-neutral-300">${title}</h2>${sub ? `<p class="text-xs text-neutral-500 mt-0.5">${sub}</p>` : ''}</div>
    ${body}</section>`;
}

/* 鬼教官コメント */
function coachPanel() {
  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const blocks = SESSION.coach.map(b => `
    <div class="border-l-2 ${border[b.tone] || 'border-neutral-600'} pl-4">
      <div class="text-xs text-neutral-500 mb-1">${b.title}</div>
      <p class="text-[15px] leading-relaxed text-neutral-200">${b.text}</p>
    </div>`).join('');
  return section('鬼教官の講評', card(`<div class="p-5 space-y-5">${blocks}</div>`), '甘やかさない。だが必ず勝たせる。');
}

/* 自動診断 */
function diagnosisSection() {
  const d = SESSION.diagnosis;
  const sevTxt = { critical: 'text-rose-400', warn: 'text-amber-400' };
  const sevTag = { critical: '危険', warn: '要改善' };
  const weak = d.weaknesses.map(w => `
    <div class="pb-4 border-b border-white/5 last:border-0 last:pb-0">
      <div class="text-sm text-neutral-100 mb-1">${w.metric} <span class="${sevTxt[w.severity]} text-xs ml-1">${sevTag[w.severity]}</span></div>
      <div class="text-[13px] text-neutral-400 tabular-nums">${w.finding}</div>
      <div class="text-xs text-neutral-500 mt-1.5">原因　${w.cause}</div>
      <div class="text-xs text-emerald-400/90 mt-0.5">処方　${w.fix}</div>
    </div>`).join('') || '<div class="text-sm text-neutral-500">大きな弱点なし。</div>';
  const caut = d.cautions.map(c => `
    <div class="pb-3 border-b border-white/5 last:border-0 last:pb-0">
      <div class="text-xs ${c.level === 'tip' ? 'text-emerald-400' : 'text-amber-400'} mb-0.5">${c.label}</div>
      <div class="text-[13px] text-neutral-400 leading-relaxed">${c.note}</div>
    </div>`).join('') || '<div class="text-sm text-neutral-500">特筆なし。</div>';
  const head = `<span class="text-xs text-neutral-500">総合 ${d.grade} ・ 危険 ${d.criticalCount} ・ 要改善 ${d.warnCount} ・ 注意 ${d.cautions.length}</span>`;
  const body = `<div class="grid md:grid-cols-2 gap-4">
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-3">何がダメか</div><div class="space-y-4">${weak}</div></div>`)}
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-3">何に気をつけるべきか</div><div class="space-y-3">${caut}</div></div>`)}
  </div>`;
  return `<section class="mt-8">
    <div class="mb-3 flex items-baseline justify-between"><h2 class="text-sm font-semibold text-neutral-300">自動診断</h2>${head}</div>
    ${body}</section>`;
}

/* ---------- ⓪ 目標設定 ---------- */
function gInput(id, label, val, hint) {
  return `<label class="block">
    <div class="text-xs text-neutral-500 mb-1">${label}</div>
    <input id="${id}" type="number" step="any" value="${val}" oninput="updateGoal()"
      class="w-full bg-transparent border border-white/10 rounded-md px-3 py-2 text-neutral-100 tabular-nums focus:border-emerald-400/60 focus:outline-none">
    <div class="text-[10px] text-neutral-600 mt-1">${hint}</div>
  </label>`;
}
function viewGoal() {
  const g = GOALS.current, a = SESSION.analysis, b = R.TOP_BENCHMARK;
  return `
  ${h1('目標を決める', '期間のアポ目標を入れると、なぜ届かないかを鬼教官が「行動→在宅→会話→クロージング」に分解して言語化する。')}
  <div class="grid lg:grid-cols-5 gap-6">
    <div class="lg:col-span-2 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        ${gInput('g_target', '期間アポ目標（件）', g.targetApoPeriod, 'この期間で取りたい総数')}
        ${gInput('g_days', '勤務数（日）', g.periodDays, '例：月22勤務')}
      </div>
      <div class="text-xs text-neutral-500 pt-1">1日あたりの行動目標（既定＝トップ営業の型）</div>
      <div class="grid grid-cols-2 gap-3">
        ${gInput('g_pings', 'ピンポン/日', g.pings, `トップ${b.targetPings}・現状${a.totalPings}`)}
        ${gInput('g_home', '在宅反応率 %', g.homeResponseRate, `トップ${b.homeResponseRate}・現状${a.homeResponseRate}`)}
        ${gInput('g_conv', '会話発生率 %', g.conversationRate, `トップ${b.conversationRate}・現状${a.conversationRate}`)}
        ${gInput('g_apo', 'アポ率 %', g.appointmentRate, `トップ${b.appointmentRate}・現状${a.appointmentRate}`)}
        ${gInput('g_open', '冒頭質問率 %', g.openingQuestionRate, `トップ${b.openingQuestionRate}・現状${a.openingQuestionRate}`)}
        ${gInput('g_reb', '切り返し回数', g.averageRebuttalCount, `トップ${b.averageRebuttalCount}・現状${a.averageRebuttalCount}`)}
      </div>
      <div class="text-[10px] text-neutral-600">※ 見込み計算を動かすのは ピンポン/在宅/会話発生/アポ率。冒頭質問・切り返しはその裏の行動目標。</div>
      <button onclick="resetGoal()" class="text-xs text-neutral-500 hover:text-neutral-300 underline">トップ営業の型にリセット</button>
    </div>
    <div id="goalResult" class="lg:col-span-3">${goalResultHTML()}</div>
  </div>
  <div class="mt-8">
    <button onclick="nav('report')" class="px-5 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">この目標でレポートを見る</button>
  </div>`;
}

function goalResultHTML() {
  const r = GOALS.backcast(SESSION.analysis, GOALS.current);
  const maxAbs = Math.max(1, ...r.losses.map(l => Math.abs(l.period)));
  const bars = r.losses.map(l => {
    const hole = l.period > 0, w = Math.abs(l.period) / maxAbs * 100;
    return `<div class="flex items-center gap-3">
      <div class="w-20 text-xs text-neutral-400 text-right shrink-0">${l.stage}</div>
      <div class="flex-1 h-5 rounded bg-neutral-800 overflow-hidden">
        <div class="h-full ${hole ? 'bg-rose-500/70' : 'bg-emerald-500/70'}" style="width:${w}%"></div>
      </div>
      <div class="w-16 text-right text-xs tabular-nums ${hole ? 'text-rose-400' : 'text-emerald-400'}">${hole ? '−' : '+'}${Math.abs(l.period)}件</div>
    </div>`;
  }).join('');
  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const blocks = r.narrative.map(x => `
    <div class="border-l-2 ${border[x.tone]} pl-3">
      <div class="text-[11px] text-neutral-500 mb-0.5">${x.title}</div>
      <p class="text-[13px] leading-relaxed text-neutral-200">${x.text}</p>
    </div>`).join('');
  const behind = !r.onTrack, col = behind ? 'text-rose-400' : 'text-emerald-400';
  return card(`
    <div class="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
      ${statCell('必要ペース', r.neededPerDay.toFixed(1), '件/日')}
      ${statCell('現状の見込み', r.projectedPeriod, '件', '', col)}
      ${statCell('目標との差', behind ? '−' + r.gapPeriod : '達成', behind ? '件' : '', '', col)}
    </div>
    <div class="p-5 border-b border-white/10">
      <div class="text-xs text-neutral-500 mb-3">不足の内訳（期間・アポ換算）　<span class="text-neutral-600">赤=穴 / 緑=目標超過</span></div>
      <div class="space-y-2">${bars}</div>
    </div>
    <div class="p-5">
      <div class="text-xs text-neutral-500 mb-3">鬼教官の分析</div>
      <div class="space-y-4">${blocks}</div>
    </div>`);
}

function readGoalInputs() {
  const v = id => parseFloat(document.getElementById(id).value) || 0;
  GOALS.current = {
    targetApoPeriod: v('g_target'), periodDays: v('g_days'), pings: v('g_pings'),
    homeResponseRate: v('g_home'), conversationRate: v('g_conv'), openingQuestionRate: v('g_open'),
    averageRebuttalCount: v('g_reb'), appointmentRate: v('g_apo'),
    averageConversationSeconds: GOALS.current.averageConversationSeconds,
  };
  GOALS.save(GOALS.current);
}
function updateGoal() { readGoalInputs(); document.getElementById('goalResult').innerHTML = goalResultHTML(); }
function resetGoal() { GOALS.current = GOALS.defaults(); GOALS.save(GOALS.current); render(); }
window.updateGoal = updateGoal; window.resetGoal = resetGoal;

/* ---------- ① ホーム ---------- */
function viewHome() {
  const a = SESSION.analysis, g = SESSION.gap;
  const gaps = [['ピンポン数', g.pings, '件'], ['在宅反応率', g.homeResponseRate, '%'], ['平均会話', g.averageConversationSeconds, '秒'], ['切り返し', g.averageRebuttalCount, '回'], ['冒頭質問率', g.openingQuestionRate, '%']]
    .map(([l, v, u]) => `<div class="flex justify-between py-1.5 text-sm"><span class="text-neutral-400">${l}</span><span class="tabular-nums ${v < 0 ? 'text-rose-400' : 'text-emerald-400'}">${v < 0 ? '' : '+'}${v}${u}</span></div>`).join('');
  return `
  <div class="flex items-start justify-between gap-4 mb-6">
    <div>
      <div class="text-xs text-neutral-500">田中 翔 ・ 第2営業部 ・ ${a.workdayIndex}/${a.workdayCount}勤務目</div>
      <h1 class="text-xl font-semibold text-neutral-100 mt-0.5">本日のサマリー</h1>
    </div>
    <button onclick="nav('upload')" class="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition shrink-0">録音をアップロード</button>
  </div>

  <div class="grid lg:grid-cols-3 gap-4">
    ${card(`<div class="p-5 flex flex-col items-center justify-center h-full"><div class="text-xs text-neutral-500 mb-1">鬼教官スコア</div><div class="text-5xl font-semibold text-emerald-400 tabular-nums">${a.coachScore}</div><div class="text-xs text-neutral-500 mt-1">/ 100</div></div>`)}
    ${card(`<div class="p-5 flex flex-col items-center justify-center h-full"><div class="text-xs text-neutral-500 mb-1">100ピンポン達成</div>${C.pingGauge(a.totalPings, a.targetPings)}</div>`)}
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-2">トップ営業との差分</div>${gaps}</div>`)}
  </div>

  ${coachPanel()}
  ${diagnosisSection()}

  <div class="mt-8">
    <button onclick="nav('report')" class="text-sm text-emerald-400 hover:text-emerald-300">詳細レポートを開く →</button>
  </div>`;
}

/* ---------- ② 録音アップロード ---------- */
function viewUpload() {
  return `
  ${h1('録音の取り込み', '録音機は Plaud NotePin を標準。①文字起こしを取り込む（Whisper不要）／②音声を解析、の2通り。')}
  <div class="max-w-xl space-y-8">

    <div class="space-y-3">
      <div class="text-sm font-semibold text-neutral-300">① Plaud NotePin の文字起こしを取り込む</div>
      <div class="text-xs text-neutral-500">NotePinの書き出し（JSON / テキスト）をそのまま投入。Whisper不要・APIキー不要で即解析。話者ラベルがあれば在宅・切り返しも確定値に。</div>
      <label class="block border border-dashed border-emerald-400/30 hover:border-emerald-400/60 rounded-lg p-6 text-center cursor-pointer transition">
        <input id="plaudFile" type="file" accept=".json,.txt,application/json,text/plain" class="hidden">
        <div class="text-sm text-neutral-200">Plaud書き出しファイルを選択</div>
        <div class="text-xs text-neutral-500 mt-1">.json / .txt　・　想定フォーマット: SPEC-plaud-import.md</div>
      </label>
      <div class="flex items-center gap-3">
        <button onclick="trySample()" class="px-3 py-1.5 rounded-md border border-white/15 hover:border-emerald-400/50 text-xs text-neutral-300 transition">サンプル（NotePin想定・1日分＋GPS）で試す</button>
        <div id="importInfo" class="text-xs text-neutral-500"></div>
      </div>
    </div>

    <div class="border-t border-white/10"></div>

    <div class="space-y-3">
      <div class="text-sm font-semibold text-neutral-300">② 音声を解析する（Whisper）</div>
      <div id="apiBadge" class="text-xs text-neutral-500">接続状態を確認中…</div>
      <label id="drop" class="block cursor-pointer border border-dashed border-white/15 hover:border-emerald-400/50 rounded-lg p-8 text-center transition">
        <input id="file" type="file" accept=".mp3,.m4a,.wav,.mp4,audio/*,video/mp4" class="hidden">
        <div class="text-sm text-neutral-200">音声ファイルをドロップ、またはクリック</div>
        <div class="text-xs text-neutral-500 mt-1">mp3 / m4a / wav / mp4　・　最大7時間</div>
      </label>
      <label class="block">
        <div class="text-xs text-neutral-500 mb-1">GPSログ（任意・JSON）— サボりを裏取り</div>
        <input id="gpsFile" type="file" accept=".json,application/json" class="block w-full text-xs text-neutral-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-white/10 file:text-neutral-200">
        <div id="gpsInfo" class="text-[10px] text-neutral-600 mt-1">[{ "t":秒, "lat":.., "lng":.. }] の配列</div>
      </label>
      <div id="fileMeta" class="hidden border border-white/10 rounded-lg p-4 text-sm">
        <div id="fName" class="text-neutral-200 truncate"></div>
        <div id="fInfo" class="text-xs text-neutral-500 mt-0.5"></div>
      </div>
      <button id="startBtn" onclick="startAnalyze()" disabled class="w-full py-3 rounded-md bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-600 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">解析を開始する</button>
      <p class="text-xs text-neutral-600">※ Whisper接続時は実解析、未接続時はモックが走ります。</p>
    </div>
  </div>`;
}

/* ---------- ③ 解析中 ---------- */
function viewAnalyzing() {
  const stages = R.ANALYZE_STAGES.map((s, i) => `
    <div id="stg-${s.key}" class="border border-white/10 rounded-lg p-4 opacity-40 transition">
      <div class="flex items-center gap-3">
        <div id="stg-ic-${s.key}" class="w-6 h-6 rounded-full border border-white/15 flex items-center justify-center text-neutral-500 text-xs">${i + 1}</div>
        <div class="flex-1"><div class="text-sm text-neutral-200">${s.label}</div><div class="text-[11px] text-neutral-500">${s.sub}</div></div>
        <div id="stg-pct-${s.key}" class="text-xs tabular-nums text-neutral-500">0%</div>
      </div>
      <div class="mt-3 h-1 rounded-full bg-neutral-800 overflow-hidden"><div id="stg-bar-${s.key}" class="h-full bg-emerald-500 transition-all duration-200" style="width:0%"></div></div>
    </div>`).join('');
  return `
  <div class="max-w-xl">
    <div class="mb-5"><h1 class="text-xl font-semibold text-neutral-100">解析中</h1><p class="text-sm text-neutral-500 mt-1" id="chunkInfo">録音を分割して読み込んでいます…</p></div>
    <div class="space-y-3">${stages}</div>
  </div>`;
}

/* データ品質バナー（話者分離の方式で表示を変える＝正直表示） */
function qualityBanner(a) {
  const q = a.quality; if (!q) return '';
  const est = (q.estimatedFields || []);
  const fieldsJa = { homeResponseRate: '在宅反応率', conversationRate: '会話発生率', appointmentRate: 'アポ率', averageRebuttalCount: '切り返し', customerReaction: 'お客様反応', suspiciousIdleTimeMinutes: 'サボり' };
  if (!est.length) return `<div class="border border-emerald-400/25 text-emerald-300/90 rounded-lg px-4 py-2.5 text-[12px] mb-4">全KPI確定：${q.note}</div>`;
  const estLabel = `推定値として残るのは ${est.map(f => fieldsJa[f] || f).join(' / ')}。下の「結果を確定」で総ピンポン数とアポ数を入れると確定します。`;
  return `<div class="border border-amber-400/25 text-amber-200/90 rounded-lg px-4 py-2.5 text-[12px] mb-4">${q.note} ${estLabel}</div>`;
}

/* 結果突合（GPS総ピンポン数＋CRM確定アポ）パネル */
function crmPanel(a) {
  const autoPing = a.quality?.pingCountSource === 'gps';
  const autoCrm = a.quality?.crm === 'connected';
  const done = a.quality?.crmConfirmed || (autoPing && autoCrm);
  const auto = [autoPing ? `総ピンポン ${a.totalPings}件 GPS自動` : '', autoCrm ? `アポ ${a.appointmentCount}件 CRM自動` : ''].filter(Boolean).join(' ・ ');
  return card(`<div class="p-4">
    <div class="flex items-center justify-between mb-1">
      <div class="text-sm font-semibold text-neutral-300">結果を確定（GPS / CRM 突合）</div>
      ${done ? '<span class="text-xs text-emerald-400">確定済</span>' : '<span class="text-xs text-amber-400">未確定</span>'}
    </div>
    <div class="text-xs text-neutral-500 mb-3">${auto ? `<span class="text-emerald-400/90">自動取得：${auto}</span>。手動で上書きも可。` : 'GPS/カウンターの総ピンポン数と、CRMの確定アポ数を入れると、在宅率・会話率・アポ率が推定→確定になる。'}</div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="text-xs text-neutral-500">総ピンポン数（GPS/カウンター）<input id="crmPings" type="number" value="${a.totalPings}" class="mt-1 block w-32 bg-transparent border border-white/10 rounded px-2 py-1 text-neutral-100 tabular-nums focus:border-emerald-400/60 focus:outline-none"></label>
      <label class="text-xs text-neutral-500">確定アポ数（CRM）<input id="crmApo" type="number" value="${a.appointmentCount}" class="mt-1 block w-24 bg-transparent border border-white/10 rounded px-2 py-1 text-neutral-100 tabular-nums focus:border-emerald-400/60 focus:outline-none"></label>
      <button onclick="confirmResults()" class="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">確定する</button>
    </div>
  </div>`);
}
function confirmResults() {
  const a = SESSION.analysis;
  const T = Math.max(1, parseInt(document.getElementById('crmPings').value) || a.totalPings);
  const apo = Math.max(0, parseInt(document.getElementById('crmApo').value) || 0);
  R.saveCrm(a, { totalPings: T, apo });
  R.loadAnalysis(a);   // applyCrmConfirm＋スコア再計算（冪等）
  render();
}
window.confirmResults = confirmResults;

/* ---------- ④ レポート ---------- */
function viewReport() {
  const a = SESSION.analysis, g = SESSION.gap, b = R.TOP_BENCHMARK;
  const idleHours = (a.hourly || []).filter(h => h.ping <= 2).map(h => h.hour);
  const cmp = [
    ['総ピンポン', a.totalPings + '件', b.targetPings + '件', g.pings + '件'],
    ['在宅反応率', a.homeResponseRate + '%', b.homeResponseRate + '%', g.homeResponseRate + '%'],
    ['会話発生率', a.conversationRate + '%', b.conversationRate + '%', g.conversationRate + '%'],
    ['平均会話時間', a.averageConversationSeconds + '秒', b.averageConversationSeconds + '秒', g.averageConversationSeconds + '秒'],
    ['切り返し平均', a.averageRebuttalCount + '回', b.averageRebuttalCount + '回', g.averageRebuttalCount + '回'],
    ['アポ率', a.appointmentRate + '%', b.appointmentRate + '%', g.appointmentRate + '%'],
    ['冒頭質問率', a.openingQuestionRate + '%', b.openingQuestionRate + '%', g.openingQuestionRate + '%'],
  ];
  const cmpRows = cmp.map(r => `<tr class="border-t border-white/5">
    <td class="py-2 text-neutral-400">${r[0]}</td>
    <td class="py-2 text-right tabular-nums text-neutral-100">${r[1]}</td>
    <td class="py-2 text-right tabular-nums text-neutral-500">${r[2]}</td>
    <td class="py-2 text-right tabular-nums ${r[3].startsWith('-') ? 'text-rose-400' : 'text-emerald-400'}">${r[3]}</td></tr>`).join('');
  const actions = R.NEXT_ACTIONS.map((x, i) => `
    <div class="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span class="text-xs text-neutral-600 tabular-nums mt-0.5">${i + 1}</span>
      <div class="flex-1 text-sm text-neutral-200">${x.text}</div>
      <span class="text-xs text-emerald-400 whitespace-nowrap">${x.metric}</span>
    </div>`).join('');

  const gpsBlock = a.gps?.connected ? section('GPS照合（サボり裏取り＋総ピンポン数）',
    card(`<div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/10">
      ${statCell('総ピンポン', a.gps.totalStops ?? a.gps.visitClusters, '件', `訪問${a.gps.visitClusters}＋不在${a.gps.noAnswerStops ?? 0}`)}
      ${statCell('移動', a.gps.movingTimeMinutes, '分')}
      ${statCell('接客（滞在）', a.gps.stayTimeMinutes, '分')}
      ${statCell('実サボり', a.gps.verifiedIdleMinutes, '分', '', 'text-rose-400')}
    </div>`),
    `停止クラスタから総ピンポン数を自動算出。空白は移動を除いて実サボり${a.gps.verifiedIdleMinutes}分と確定。`) : '';

  return `
  <div class="flex items-end justify-between mb-6">
    <div><div class="text-xs text-neutral-500">解析レポート ・ ${a.date || '2026-07-03'}</div><h1 class="text-xl font-semibold text-neutral-100 mt-0.5">${a.salesRepName || '田中 翔'} の1日</h1></div>
    <div class="text-right"><div class="text-xs text-neutral-500">鬼教官スコア</div><div class="text-2xl font-semibold text-emerald-400 tabular-nums">${a.coachScore}<span class="text-sm text-neutral-500">/100</span></div></div>
  </div>

  ${qualityBanner(a)}
  ${crmPanel(a)}

  <div class="mt-4"></div>
  ${card(`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-white/10">
    ${statCell('総ピンポン', a.totalPings, '件', `達成 ${a.targetAchievementRate}%`)}
    ${statCell('在宅反応', a.homeResponseCount, '件', `${a.homeResponseRate}%`)}
    ${statCell('会話発生', a.conversationCount, '件', `平均${a.averageConversationSeconds}秒`)}
    ${statCell('アポ', a.appointmentCount, '件', `${a.appointmentRate}%`)}
    ${statCell('見込み', a.prospectCount, '件', `${a.prospectRate}%`)}
    ${statCell('サボり', a.suspiciousIdleTimeMinutes, '分', a.gps?.connected ? 'GPS確定' : a.suspiciousWindow, a.gps?.connected ? 'text-rose-400' : '')}
  </div>`)}

  ${gpsBlock}
  ${diagnosisSection()}

  ${section('時間帯別 活動密度', card(`<div class="p-5">${C.hourlyDensity(a.hourly || [], idleHours)}<div class="text-[11px] text-neutral-600 mt-1">赤 = 活動が薄い時間帯</div></div>`))}

  <div class="grid lg:grid-cols-2 gap-4 mt-8">
    ${card(`<div class="p-5"><div class="text-sm font-semibold text-neutral-300 mb-3">トップ営業との型比較</div>${C.radarChart(SESSION.radar)}<div class="text-[11px] text-neutral-600 text-center">緑=本人 / 灰=トップ</div></div>`)}
    ${card(`<div class="p-5"><div class="text-sm font-semibold text-neutral-300 mb-4">断り文句ランキング</div><div class="space-y-3">${C.objectionBars(a.objectionRanking || [])}</div></div>`)}
  </div>

  ${section('トップ営業比較', card(`<div class="p-5"><table class="w-full text-sm">
    <thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal pb-1">項目</th><th class="text-right font-normal">本人</th><th class="text-right font-normal">トップ</th><th class="text-right font-normal">差分</th></tr></thead>
    <tbody>${cmpRows}</tbody></table></div>`))}

  ${coachPanel()}
  ${section('明日の改善アクション', card(`<div class="px-5 py-2">${actions}</div>`))}`;
}

/* ---------- ⑤ 営業マン一覧 ---------- */
function viewReps() {
  const prTxt = { high: ['最優先', 'text-rose-400'], mid: ['要観察', 'text-amber-400'], low: ['良好', 'text-emerald-400'] };
  const rows = R.SALES_REPS.slice().sort((x, y) => y.score - x.score).map(r => {
    const scoreCol = r.score >= 85 ? 'text-emerald-400' : r.score >= 65 ? 'text-amber-400' : 'text-rose-400';
    return `<tr class="border-t border-white/5">
      <td class="py-3">
        <div class="text-neutral-100">${r.name} ${r.current ? '<span class="text-[10px] text-emerald-400 ml-1">本人</span>' : ''}</div>
        <div class="text-[11px] text-neutral-500">${r.team} ・ ${r.role}</div>
      </td>
      <td class="py-3 text-right tabular-nums text-neutral-300">${r.pings}<span class="text-neutral-600 text-xs">/${r.target}</span></td>
      <td class="py-3 text-right tabular-nums ${r.achieve >= 100 ? 'text-emerald-400' : 'text-neutral-300'}">${r.achieve}%</td>
      <td class="py-3 text-right tabular-nums text-neutral-300">${r.apo}</td>
      <td class="py-3 text-right tabular-nums ${scoreCol}">${r.score}</td>
      <td class="py-3 text-right tabular-nums ${r.idle >= 40 ? 'text-rose-400' : 'text-neutral-400'}">${r.idle}分</td>
      <td class="py-3 text-right text-xs ${prTxt[r.priority][1]}">${prTxt[r.priority][0]}</td>
    </tr>`;
  }).join('');
  return `
  ${h1('営業マン一覧', '鬼教官スコア順 ・ 改善優先度でサボり・失速を可視化')}
  ${card(`<div class="overflow-x-auto"><table class="w-full text-sm min-w-[680px]">
    <thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal px-5 py-3">営業マン</th><th class="text-right font-normal">ピンポン</th><th class="text-right font-normal">達成率</th><th class="text-right font-normal">アポ</th><th class="text-right font-normal">スコア</th><th class="text-right font-normal">サボり</th><th class="text-right font-normal px-5">優先度</th></tr></thead>
    <tbody class="[&_td:first-child]:pl-5 [&_td:last-child]:pr-5">${rows}</tbody>
  </table></div>`)}`;
}

/* ---------- ⑥ イシュー分析（トップ vs 下位） ---------- */
function viewIssues() {
  const c = ISSUES.compare(R.SALES_REPS);
  const sev = { critical: 'text-rose-400', warn: 'text-amber-400', watch: 'text-neutral-400' };

  const groupCard = (title, p, apo, accent) => card(`<div class="p-5">
    <div class="text-xs text-neutral-500 mb-1">${title}（${p.members.length}名）</div>
    <div class="text-sm text-neutral-200">${p.members.map(m => m.name).join('・')}</div>
    <div class="flex gap-6 mt-3">
      <div><div class="text-[11px] text-neutral-500">平均スコア</div><div class="text-lg font-semibold tabular-nums ${accent}">${p.score}</div></div>
      <div><div class="text-[11px] text-neutral-500">アポ/日</div><div class="text-lg font-semibold tabular-nums text-neutral-200">${apo}</div></div>
    </div></div>`);

  const issues = c.issues.map((x, i) => `
    <div class="border border-white/10 rounded-lg p-5">
      <div class="flex items-baseline justify-between mb-1">
        <div class="text-sm text-neutral-100">${i + 1}. ${x.stage} <span class="${sev[x.severity]} text-xs ml-1">${x.severity === 'critical' ? '最重要' : x.severity === 'warn' ? '重要' : '要観察'}</span></div>
        <div class="text-xs text-rose-400 tabular-nums">チーム月 約${x.teamMonthly}件の損失</div>
      </div>
      <div class="text-[13px] text-neutral-400">${x.driver}</div>
      <div class="text-xs text-amber-300/90 mt-1.5">特に足を引っ張っている　${x.worstReps.join('・')}</div>
      <div class="text-xs text-neutral-500 mt-1.5">原因　${x.cause}</div>
      <div class="text-xs text-emerald-400/90 mt-0.5">処方　${x.fix}</div>
    </div>`).join('');

  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const narrative = c.narrative.map(x => `
    <div class="border-l-2 ${border[x.tone]} pl-4">
      <div class="text-xs text-neutral-500 mb-1">${x.title}</div>
      <p class="text-[15px] leading-relaxed text-neutral-200">${x.text}</p>
    </div>`).join('');

  const gapRows = c.gaps.map(g => {
    const behind = g.gap < 0;
    return `<tr class="border-t border-white/5">
      <td class="py-2 text-neutral-400">${g.label}</td>
      <td class="py-2 text-right tabular-nums text-emerald-400">${g.top}${g.unit}</td>
      <td class="py-2 text-right tabular-nums text-neutral-300">${g.bottom}${g.unit}</td>
      <td class="py-2 text-right tabular-nums ${behind ? 'text-rose-400' : 'text-neutral-400'}">${behind ? '' : '+'}${g.gap}${g.unit}</td>
      <td class="py-2 pl-4 w-28"><div class="h-1.5 rounded-full bg-neutral-800 overflow-hidden"><div class="h-full ${g.ratio < 70 ? 'bg-rose-500/70' : 'bg-neutral-500'}" style="width:${Math.min(g.ratio, 100)}%"></div></div></td>
    </tr>`;
  }).join('');

  return `
  ${h1('イシュー分析', 'トップ営業 vs 下位営業を比較し、組織のどこで負けているかを炙り出す。')}

  ${card(`<div class="p-5 flex flex-wrap items-center justify-between gap-4">
    <div><div class="text-xs text-neutral-500">下位${c.bottomCount}名の機会損失（トップ群との差）</div>
    <div class="text-3xl font-semibold text-rose-400 tabular-nums">月 約${c.teamMonthlyTotal}<span class="text-base text-neutral-500 ml-1">件のアポ</span></div></div>
    <div class="text-xs text-neutral-500 max-w-xs text-right">1人あたり1日${c.perDayGap.toFixed(1)}件の差。個人の才能差ではなく、埋められる“型の差”。</div>
  </div>`)}

  <div class="grid sm:grid-cols-2 gap-4 mt-4">
    ${groupCard('トップ群', c.top, c.topApoPerDay, 'text-emerald-400')}
    ${groupCard('下位群', c.bottom, c.bottomApoPerDay, 'text-rose-400')}
  </div>

  ${section('イシュー（アポ損失インパクト順）', `<div class="space-y-3">${issues}</div>`, 'アポ損失をファネルに分解し、影響の大きい順に並べた。')}

  ${section('鬼教官の総括', card(`<div class="p-5 space-y-5">${narrative}</div>`))}

  ${section('KPI比較（トップ群 / 下位群）', card(`<div class="p-5"><table class="w-full text-sm">
    <thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal pb-1">指標</th><th class="text-right font-normal">トップ群</th><th class="text-right font-normal">下位群</th><th class="text-right font-normal">差</th><th class="text-right font-normal pl-4">トップ比</th></tr></thead>
    <tbody>${gapRows}</tbody></table></div>`), '緑=トップ群 / 灰=下位群 ・ バーは下位群のトップ到達率')}`;
}

/* ---------- ルーター ---------- */
const VIEWS = { goal: viewGoal, home: viewHome, upload: viewUpload, analyzing: viewAnalyzing, report: viewReport, reps: viewReps, issues: viewIssues };
function nav(v) { currentView = v; render(); if (v === 'upload') bindUpload(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function render() {
  app.innerHTML = VIEWS[currentView]();
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('nav-active', el.dataset.nav === currentView));
}

/* ---------- アップロード挙動 ---------- */
let selectedFile = null, selectedGps = null;
async function bindUpload() {
  const input = document.getElementById('file'), meta = document.getElementById('fileMeta'), btn = document.getElementById('startBtn');
  const drop = document.getElementById('drop'), gpsInput = document.getElementById('gpsFile');
  function show(f) {
    selectedFile = f || null;
    const sizeMB = f ? f.size / 1e6 : 214;
    document.getElementById('fName').textContent = f ? f.name : 'sample_field_recording_0703.m4a';
    document.getElementById('fInfo').textContent = f ? `${sizeMB.toFixed(1)}MB ・ ${window.__whisperReady ? 'Whisperで実解析' : 'デモ（モック解析）'}` : 'デモ用サンプル ・ モック解析';
    meta.classList.remove('hidden'); btn.disabled = false;
  }
  input.addEventListener('change', e => show(e.target.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('border-emerald-400'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('border-emerald-400'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('border-emerald-400'); show(e.dataTransfer.files[0]); });

  gpsInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { selectedGps = JSON.parse(await f.text()); document.getElementById('gpsInfo').textContent = `GPS ${selectedGps.length}点を読み込みました`; }
    catch { selectedGps = null; document.getElementById('gpsInfo').textContent = 'JSONの解析に失敗しました'; }
  });

  // Plaud NotePin 文字起こしの取り込み → 即レポート
  document.getElementById('plaudFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const info = document.getElementById('importInfo');
    info.innerHTML = '<span class="text-neutral-400">取り込み中…</span>';
    try {
      const text = await f.text();
      let payload = text; try { payload = JSON.parse(text); } catch {} // JSONならオブジェクトで、それ以外はテキストで送る
      const rep = await API.importTranscript(payload, { name: f.name.replace(/\.[^.]+$/, ''), gps: selectedGps });
      R.loadAnalysis(rep.analysis);
      info.innerHTML = '<span class="text-emerald-400">取り込み完了</span> — レポートを表示します';
      setTimeout(() => nav('report'), 400);
    } catch (err) {
      info.innerHTML = `<span class="text-rose-400">失敗：${err.message}</span>`;
    }
  });

  const badge = document.getElementById('apiBadge');
  const info = await API.health(); window.__whisperReady = info.whisperReady;
  if (badge) badge.innerHTML = info.whisperReady
    ? '<span class="text-emerald-400">Whisper接続済</span> — アップロードで実解析します'
    : '<span class="text-neutral-400">デモモード</span> — サーバー未接続/APIキー未設定のためモック解析';
}

/* ---------- 解析中ステージ制御 ---------- */
function setStageActive(key, pct) {
  const stg = document.getElementById('stg-' + key); if (!stg) return;
  stg.classList.remove('opacity-40');
  document.getElementById('stg-ic-' + key).className = 'w-6 h-6 rounded-full border border-emerald-400/50 flex items-center justify-center text-emerald-400 text-xs';
  document.getElementById('stg-bar-' + key).style.width = pct + '%';
  document.getElementById('stg-pct-' + key).textContent = Math.round(pct) + '%';
}
function setStageDone(key) {
  const ic = document.getElementById('stg-ic-' + key); if (!ic) return;
  document.getElementById('stg-' + key).classList.remove('opacity-40');
  document.getElementById('stg-bar-' + key).style.width = '100%';
  ic.className = 'w-6 h-6 rounded-full border border-emerald-400/50 flex items-center justify-center text-emerald-400 text-xs'; ic.textContent = '✓';
  const p = document.getElementById('stg-pct-' + key); p.textContent = '100%'; p.className = 'text-xs tabular-nums text-emerald-400';
}
function driveStages(stageKey, progress) {
  const order = R.ANALYZE_STAGES.map(s => s.key), idx = order.indexOf(stageKey);
  order.forEach((k, i) => { if (i < idx) setStageDone(k); else if (i === idx) setStageActive(k, (k === 'transcribe' && progress && progress.total) ? Math.round(progress.done / progress.total * 100) : 55); });
  const ci = document.getElementById('chunkInfo');
  if (ci && stageKey === 'transcribe' && progress && progress.total) ci.textContent = `${progress.done}/${progress.total} チャンク処理済み`;
}
function analyzeError(msg) {
  const ci = document.getElementById('chunkInfo');
  if (ci) ci.innerHTML = `<span class="text-rose-400">解析に失敗しました：${msg}</span> <button onclick="nav('upload')" class="text-emerald-400 underline ml-1">戻る</button>`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 解析の入口 ---------- */
async function startAnalyze() {
  nav('analyzing');
  if (window.__whisperReady && selectedFile) {
    try { await realAnalyze(selectedFile); } catch (e) { analyzeError(e.message); }
  } else { mockAnalyze(); }
}
async function realAnalyze(file) {
  driveStages('split');
  const { sessionId } = await API.upload(file, { startHour: 9 });
  await API.analyze(sessionId, selectedGps);
  while (true) {
    await sleep(1200);
    const st = await API.status(sessionId);
    if (st.status === 'failed') throw new Error(st.error || '不明なエラー');
    driveStages(st.stage || 'split', st.progress);
    if (st.status === 'done') break;
  }
  const rep = await API.report(sessionId);
  R.loadAnalysis(rep.analysis);
  R.ANALYZE_STAGES.forEach(s => setStageDone(s.key));
  await sleep(400); nav('report');
}
function mockAnalyze() {
  R.loadAnalysis(R.TODAY_ANALYSIS);
  const stages = R.ANALYZE_STAGES; let si = 0;
  (function runStage() {
    if (si >= stages.length) { setTimeout(() => nav('report'), 500); return; }
    const s = stages[si]; setStageActive(s.key, 0);
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(100, p + Math.random() * 22 + 8); setStageActive(s.key, p);
      if (s.key === 'split') { const ci = document.getElementById('chunkInfo'); if (ci) ci.textContent = `${Math.round(p / 100 * 34)}/34 チャンク処理済み`; }
      if (p >= 100) { clearInterval(iv); setStageDone(s.key); si++; setTimeout(runStage, 300); }
    }, 160);
  })();
}

/* サンプル（NotePin想定・1日分＋GPS）をワンクリック取り込み */
async function trySample() {
  const info = document.getElementById('importInfo');
  if (info) info.innerHTML = '<span class="text-neutral-400">サンプルを取り込み中…</span>';
  try {
    const [sample, gps] = await Promise.all([
      fetch('/samples/plaud-fullday.json').then(r => r.json()),
      fetch('/samples/plaud-fullday-gps.json').then(r => r.json()).catch(() => null),
    ]);
    const rep = await API.importTranscript(sample, { name: '田中 翔（サンプル）', gps });
    R.loadAnalysis(rep.analysis);
    if (info) info.innerHTML = '<span class="text-emerald-400">取り込み完了</span>';
    setTimeout(() => nav('report'), 300);
  } catch (e) {
    if (info) info.innerHTML = `<span class="text-rose-400">失敗：${e.message}</span>`;
  }
}
window.trySample = trySample;

window.nav = nav; window.startAnalyze = startAnalyze;
render();
