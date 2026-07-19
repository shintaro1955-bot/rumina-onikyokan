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
    <h1 class="text-xl font-semibold text-neutral-900">${title}</h1>
    ${sub ? `<p class="text-sm text-neutral-500 mt-1">${sub}</p>` : ''}</div>`;
}
function card(inner, cls = '') { return `<div class="bg-white border border-[#E8EFEA] rounded-2xl shadow-[0_1px_3px_rgba(16,40,30,0.05)] ${cls}">${inner}</div>`; }
function statCell(label, value, unit, sub, accent) {
  return `<div class="p-4">
    <div class="text-xs text-neutral-500 mb-1">${label}</div>
    <div class="text-xl font-semibold tabular-nums ${accent || 'text-neutral-900'}">${value}<span class="text-xs text-neutral-500 ml-0.5">${unit || ''}</span></div>
    ${sub ? `<div class="text-[11px] text-neutral-500 mt-0.5">${sub}</div>` : ''}</div>`;
}
function section(title, body, sub) {
  return `<section class="mt-8">
    <div class="mb-3"><h2 class="text-sm font-semibold text-neutral-700">${title}</h2>${sub ? `<p class="text-xs text-neutral-500 mt-0.5">${sub}</p>` : ''}</div>
    ${body}</section>`;
}

/* 鬼教官コメント */
function coachPanel() {
  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const blocks = SESSION.coach.map(b => `
    <div class="border-l-2 ${border[b.tone] || 'border-neutral-600'} pl-4">
      <div class="text-xs text-neutral-500 mb-1">${b.title}</div>
      <p class="text-[15px] leading-relaxed text-neutral-800">${b.text}</p>
    </div>`).join('');
  return section('鬼教官の講評', card(`
    <div class="flex items-center gap-3 px-5 pt-5">
      <img src="/assets/rumina.png" alt="Dr.Rumina" class="w-12 h-12 rounded-full object-cover object-top border border-emerald-200 shadow-sm">
      <div><div class="text-sm font-semibold text-neutral-900">Rumina 鬼教官</div><div class="text-xs text-neutral-500">甘やかさない。だが必ず勝たせる。</div></div>
    </div>
    <div class="p-5 space-y-5">${blocks}</div>`));
}

/* 自動診断 */
function diagnosisSection() {
  const d = SESSION.diagnosis;
  const sevTxt = { critical: 'text-rose-600', warn: 'text-amber-600' };
  const sevTag = { critical: '危険', warn: '要改善' };
  const weak = d.weaknesses.map(w => `
    <div class="pb-4 border-b border-neutral-200 last:border-0 last:pb-0">
      <div class="text-sm text-neutral-900 mb-1">${w.metric} <span class="${sevTxt[w.severity]} text-xs ml-1">${sevTag[w.severity]}</span></div>
      <div class="text-[13px] text-neutral-600 tabular-nums">${w.finding}</div>
      <div class="text-xs text-neutral-500 mt-1.5">原因　${w.cause}</div>
      <div class="text-xs text-emerald-600/90 mt-0.5">処方　${w.fix}</div>
    </div>`).join('') || '<div class="text-sm text-neutral-500">大きな弱点なし。</div>';
  const caut = d.cautions.map(c => `
    <div class="pb-3 border-b border-neutral-200 last:border-0 last:pb-0">
      <div class="text-xs ${c.level === 'tip' ? 'text-emerald-600' : 'text-amber-600'} mb-0.5">${c.label}</div>
      <div class="text-[13px] text-neutral-600 leading-relaxed">${c.note}</div>
    </div>`).join('') || '<div class="text-sm text-neutral-500">特筆なし。</div>';
  const head = `<span class="text-xs text-neutral-500">総合 ${d.grade} ・ 危険 ${d.criticalCount} ・ 要改善 ${d.warnCount} ・ 注意 ${d.cautions.length}</span>`;
  const body = `<div class="grid md:grid-cols-2 gap-4">
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-3">何がダメか</div><div class="space-y-4">${weak}</div></div>`)}
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-3">何に気をつけるべきか</div><div class="space-y-3">${caut}</div></div>`)}
  </div>`;
  return `<section class="mt-8">
    <div class="mb-3 flex items-baseline justify-between"><h2 class="text-sm font-semibold text-neutral-700">自動診断</h2>${head}</div>
    ${body}</section>`;
}

/* ---------- ⓪ 目標設定 ---------- */
function gInput(id, label, val, hint) {
  return `<label class="block">
    <div class="text-xs text-neutral-500 mb-1">${label}</div>
    <input id="${id}" type="number" step="any" value="${val}" oninput="updateGoal()"
      class="w-full bg-transparent border border-neutral-200 rounded-md px-3 py-2 text-neutral-900 tabular-nums focus:border-emerald-400/60 focus:outline-none">
    <div class="text-[10px] text-neutral-500 mt-1">${hint}</div>
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
      <div class="text-[10px] text-neutral-500">※ 見込み計算を動かすのは ピンポン/在宅/会話発生/アポ率。冒頭質問・切り返しはその裏の行動目標。</div>
      <button onclick="resetGoal()" class="text-xs text-neutral-500 hover:text-neutral-700 underline">トップ営業の型にリセット</button>
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
      <div class="w-20 text-xs text-neutral-600 text-right shrink-0">${l.stage}</div>
      <div class="flex-1 h-5 rounded bg-neutral-200 overflow-hidden">
        <div class="h-full ${hole ? 'bg-rose-500/70' : 'bg-emerald-500/70'}" style="width:${w}%"></div>
      </div>
      <div class="w-16 text-right text-xs tabular-nums ${hole ? 'text-rose-600' : 'text-emerald-600'}">${hole ? '−' : '+'}${Math.abs(l.period)}件</div>
    </div>`;
  }).join('');
  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const blocks = r.narrative.map(x => `
    <div class="border-l-2 ${border[x.tone]} pl-3">
      <div class="text-[11px] text-neutral-500 mb-0.5">${x.title}</div>
      <p class="text-[13px] leading-relaxed text-neutral-800">${x.text}</p>
    </div>`).join('');
  const behind = !r.onTrack, col = behind ? 'text-rose-600' : 'text-emerald-600';
  return card(`
    <div class="grid grid-cols-3 divide-x divide-neutral-200 border-b border-neutral-200">
      ${statCell('必要ペース', r.neededPerDay.toFixed(1), '件/日')}
      ${statCell('現状の見込み', r.projectedPeriod, '件', '', col)}
      ${statCell('目標との差', behind ? '−' + r.gapPeriod : '達成', behind ? '件' : '', '', col)}
    </div>
    <div class="p-5 border-b border-neutral-200">
      <div class="text-xs text-neutral-500 mb-3">不足の内訳（期間・アポ換算）　<span class="text-neutral-500">赤=穴 / 緑=目標超過</span></div>
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
    .map(([l, v, u]) => `<div class="flex justify-between py-1.5 text-sm"><span class="text-neutral-600">${l}</span><span class="tabular-nums ${v < 0 ? 'text-rose-600' : 'text-emerald-600'}">${v < 0 ? '' : '+'}${v}${u}</span></div>`).join('');
  return `
  <div class="flex items-start justify-between gap-4 mb-6">
    <div>
      <div class="text-xs text-neutral-500">田中 翔 ・ 第2営業部 ・ ${a.workdayIndex}/${a.workdayCount}勤務目</div>
      <h1 class="text-xl font-semibold text-neutral-900 mt-0.5">本日のサマリー</h1>
    </div>
    <button onclick="nav('upload')" class="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition shrink-0">稼働終了・録音を出稿</button>
  </div>

  <div class="grid lg:grid-cols-3 gap-4">
    ${card(`<div class="p-5 flex flex-col items-center justify-center h-full"><div class="text-xs text-neutral-500 mb-1">鬼教官スコア</div><div class="text-5xl font-semibold text-emerald-600 tabular-nums">${a.coachScore}</div><div class="text-xs text-neutral-500 mt-1">/ 100</div></div>`)}
    ${card(`<div class="p-5 flex flex-col items-center justify-center h-full"><div class="text-xs text-neutral-500 mb-1">100ピンポン達成</div>${C.pingGauge(a.totalPings, a.targetPings)}</div>`)}
    ${card(`<div class="p-5"><div class="text-xs text-neutral-500 mb-2">トップ営業との差分</div>${gaps}</div>`)}
  </div>

  ${coachPanel()}
  ${diagnosisSection()}

  <div class="mt-8">
    <button onclick="nav('report')" class="text-sm text-emerald-600 hover:text-emerald-600">詳細レポートを開く →</button>
  </div>`;
}

/* ---------- ② 録音アップロード ---------- */
/* 録音・解析への同意ゲート（未同意なら出稿画面の代わりに表示） */
function consentGate() {
  return `
  ${h1('録音・解析への同意', '出稿の前に一度だけ。装着録音（Plaud NotePin 等）の内容をコーチング目的で解析・保存します。')}
  <div class="max-w-xl">
    ${card(`<div class="p-6 space-y-4">
      <div class="text-sm text-neutral-800 leading-relaxed">
        私は、自分の営業活動の録音（音声・文字起こし）が、<b>営業教育・コーチングを目的</b>に、Rumina 鬼教官で
        <b>文字起こし・解析され、会社の管理下で保存される</b>ことに同意します。
      </div>
      <ul class="text-[13px] text-neutral-600 leading-relaxed list-disc pl-5 space-y-1">
        <li>保存されるもの：文字起こし全文・訪問ごとの結果・KPI／カルテ（診断ログ）。</li>
        <li>お客様への録音の告知は、会社の方針に従い自分が適切に行います。</li>
        <li>音声ファイルは会社の運用設定に従って保持／自動削除されます。</li>
        <li>目的外の利用はしません。同意状況は管理者が記録・監査します。</li>
      </ul>
      <label class="flex items-start gap-2 text-sm text-neutral-800">
        <input id="consentChk" type="checkbox" onchange="document.getElementById('consentBtn').disabled=!this.checked" class="mt-1 accent-emerald-600">
        上記に同意します（同意日時と版が記録されます）
      </label>
      <div class="flex items-center gap-3">
        <button id="consentBtn" onclick="acceptConsent()" disabled class="px-5 py-2.5 rounded-md bg-emerald-500 disabled:bg-neutral-200 disabled:text-neutral-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">同意して続ける</button>
        <span id="consentMsg" class="text-xs text-neutral-500">版：${window.__consentVersion || '—'}</span>
      </div>
    </div>`)}
  </div>`;
}
async function acceptConsent() {
  const msg = document.getElementById('consentMsg');
  if (msg) { msg.textContent = '記録中…'; msg.className = 'text-xs text-neutral-500'; }
  try {
    const j = await API.postConsent();
    window.__consent = { ok: true, consent: j.consent, version: j.consent.version };
    nav('upload');
  } catch (e) { if (msg) { msg.textContent = e.message; msg.className = 'text-xs text-rose-600'; } }
}
window.acceptConsent = acceptConsent;

function viewUpload() {
  // 未同意（ログイン中）なら同意ゲートを先に出す
  if (window.__user && !(window.__consent && window.__consent.ok)) return consentGate();
  const audioNote = window.__audioPurge
    ? '音声は解析後に自動削除される運用です（文字起こしのみ保存）。'
    : '音声は解析後も保存されます（不要なら管理者が自動削除に設定できます）。';
  return `
  ${h1('稼働終了・録音を出稿', '日報の代わりに、その日の録音を出すだけ。AIが分析 → イシュー → 改善提案まで自動。録音機は Plaud NotePin を標準。')}
  <div class="max-w-xl space-y-8">

    <div class="space-y-3">
      <div class="text-sm font-semibold text-neutral-700">① Plaud NotePin の文字起こしを取り込む</div>
      <div class="text-xs text-neutral-500">NotePinの書き出し（JSON / テキスト）をそのまま投入。Whisper不要・APIキー不要で即解析。話者ラベルがあれば在宅・切り返しも確定値に。</div>
      <label class="block border border-dashed border-emerald-400/30 hover:border-emerald-400/60 rounded-lg p-6 text-center cursor-pointer transition">
        <input id="plaudFile" type="file" accept=".json,.txt,application/json,text/plain" class="hidden">
        <div class="text-sm text-neutral-800">Plaud書き出しファイルを選択</div>
        <div class="text-xs text-neutral-500 mt-1">.json / .txt　・　想定フォーマット: SPEC-plaud-import.md</div>
      </label>
      <div class="flex items-center gap-3">
        <button onclick="trySample()" class="px-3 py-1.5 rounded-md border border-neutral-300 hover:border-emerald-400/50 text-xs text-neutral-700 transition">サンプル（NotePin想定・1日分＋GPS）で試す</button>
        <div id="importInfo" class="text-xs text-neutral-500"></div>
      </div>
    </div>

    <div class="border-t border-neutral-200"></div>

    <div class="space-y-3">
      <div class="text-sm font-semibold text-neutral-700">② 音声を解析する（Whisper）</div>
      <div id="apiBadge" class="text-xs text-neutral-500">接続状態を確認中…</div>
      <label id="drop" class="block cursor-pointer border border-dashed border-neutral-300 hover:border-emerald-400/50 rounded-lg p-8 text-center transition">
        <input id="file" type="file" accept=".mp3,.m4a,.wav,.mp4,audio/*,video/mp4" class="hidden">
        <div class="text-sm text-neutral-800">音声ファイルをドロップ、またはクリック</div>
        <div class="text-xs text-neutral-500 mt-1">mp3 / m4a / wav / mp4　・　最大7時間</div>
      </label>
      <label class="block">
        <div class="text-xs text-neutral-500 mb-1">GPSログ（任意・JSON）— サボりを裏取り</div>
        <input id="gpsFile" type="file" accept=".json,application/json" class="block w-full text-xs text-neutral-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-neutral-100 file:text-neutral-700">
        <div id="gpsInfo" class="text-[10px] text-neutral-500 mt-1">[{ "t":秒, "lat":.., "lng":.. }] の配列</div>
      </label>
      <div id="fileMeta" class="hidden border border-neutral-200 rounded-lg p-4 text-sm">
        <div id="fName" class="text-neutral-800 truncate"></div>
        <div id="fInfo" class="text-xs text-neutral-500 mt-0.5"></div>
      </div>
      <button id="startBtn" onclick="startAnalyze()" disabled class="w-full py-3 rounded-md bg-emerald-500 disabled:bg-neutral-200 disabled:text-neutral-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">解析を開始する</button>
      <p class="text-xs text-neutral-500">※ Whisper接続時は実解析、未接続時はモックが走ります。</p>
    </div>

    <div class="text-[11px] text-neutral-400 border-t border-neutral-200 pt-3">🔒 録音・解析に同意済み（版 ${window.__consentVersion || '—'}）。${audioNote}</div>
  </div>`;
}

/* ---------- ③ 解析中 ---------- */
function viewAnalyzing() {
  const stages = R.ANALYZE_STAGES.map((s, i) => `
    <div id="stg-${s.key}" class="border border-neutral-200 rounded-lg p-4 opacity-40 transition">
      <div class="flex items-center gap-3">
        <div id="stg-ic-${s.key}" class="w-6 h-6 rounded-full border border-neutral-300 flex items-center justify-center text-neutral-500 text-xs">${i + 1}</div>
        <div class="flex-1"><div class="text-sm text-neutral-800">${s.label}</div><div class="text-[11px] text-neutral-500">${s.sub}</div></div>
        <div id="stg-pct-${s.key}" class="text-xs tabular-nums text-neutral-500">0%</div>
      </div>
      <div class="mt-3 h-1 rounded-full bg-neutral-200 overflow-hidden"><div id="stg-bar-${s.key}" class="h-full bg-emerald-500 transition-all duration-200" style="width:0%"></div></div>
    </div>`).join('');
  return `
  <div class="max-w-xl">
    <div class="mb-5"><h1 class="text-xl font-semibold text-neutral-900">解析中</h1><p class="text-sm text-neutral-500 mt-1" id="chunkInfo">録音を分割して読み込んでいます…</p></div>
    <div class="space-y-3">${stages}</div>
  </div>`;
}

/* データ品質バナー（話者分離の方式で表示を変える＝正直表示） */
function qualityBanner(a) {
  const q = a.quality; if (!q) return '';
  const est = (q.estimatedFields || []);
  const fieldsJa = { homeResponseRate: '在宅反応率', conversationRate: '会話発生率', appointmentRate: 'アポ率', averageRebuttalCount: '切り返し', customerReaction: 'お客様反応', suspiciousIdleTimeMinutes: 'サボり' };
  if (!est.length) return `<div class="border border-emerald-400/25 text-emerald-600/90 rounded-lg px-4 py-2.5 text-[12px] mb-4">全KPI確定：${q.note}</div>`;
  const estLabel = `推定値として残るのは ${est.map(f => fieldsJa[f] || f).join(' / ')}。下の「結果を確定」で総ピンポン数とアポ数を入れると確定します。`;
  return `<div class="border border-amber-400/25 text-amber-700 rounded-lg px-4 py-2.5 text-[12px] mb-4">${q.note} ${estLabel}</div>`;
}

/* 結果突合（GPS総ピンポン数＋CRM確定アポ）パネル */
function crmPanel(a) {
  const autoPing = a.quality?.pingCountSource === 'gps';
  const autoCrm = a.quality?.crm === 'connected';
  const done = a.quality?.crmConfirmed || (autoPing && autoCrm);
  const auto = [autoPing ? `総ピンポン ${a.totalPings}件 GPS自動` : '', autoCrm ? `アポ ${a.appointmentCount}件 CRM自動` : ''].filter(Boolean).join(' ・ ');
  return card(`<div class="p-4">
    <div class="flex items-center justify-between mb-1">
      <div class="text-sm font-semibold text-neutral-700">結果を確定（GPS / CRM 突合）</div>
      ${done ? '<span class="text-xs text-emerald-600">確定済</span>' : '<span class="text-xs text-amber-600">未確定</span>'}
    </div>
    <div class="text-xs text-neutral-500 mb-3">${auto ? `<span class="text-emerald-600/90">自動取得：${auto}</span>。手動で上書きも可。` : 'GPS/カウンターの総ピンポン数と、CRMの確定アポ数を入れると、在宅率・会話率・アポ率が推定→確定になる。'}</div>
    <div class="flex flex-wrap items-end gap-3">
      <label class="text-xs text-neutral-500">総ピンポン数（GPS/カウンター）<input id="crmPings" type="number" value="${a.totalPings}" class="mt-1 block w-32 bg-transparent border border-neutral-200 rounded px-2 py-1 text-neutral-900 tabular-nums focus:border-emerald-400/60 focus:outline-none"></label>
      <label class="text-xs text-neutral-500">確定アポ数（CRM）<input id="crmApo" type="number" value="${a.appointmentCount}" class="mt-1 block w-24 bg-transparent border border-neutral-200 rounded px-2 py-1 text-neutral-900 tabular-nums focus:border-emerald-400/60 focus:outline-none"></label>
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

/* 勝ちトーク分析（なぜアポが取れたか） */
function winTalkSection(a) {
  const w = a.winTalk; if (!w || !w.wins || !w.wins.length) return '';
  const chip = k => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 mr-1 mb-1 inline-block">${k}</span>`;
  const wins = w.wins.map(x => `
    <div class="border border-neutral-200 rounded-lg p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[11px] px-2 py-0.5 rounded-full ${x.result === 'apo' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${x.result === 'apo' ? 'アポ獲得' : '見込み'}</span>
        <span class="text-xs text-neutral-500">この訪問で効いた型</span>
      </div>
      <div class="mb-2">${x.moves.map(chip).join('') || '<span class="text-xs text-neutral-500">—</span>'}</div>
      <div class="text-[13px] text-neutral-800 leading-relaxed">${x.why}</div>
      ${x.excerpt ? `<div class="text-[11px] text-neutral-500 mt-1.5">「${x.excerpt}…」</div>` : ''}
    </div>`).join('');
  const top = w.topMoves.slice(0, 6).map(m => `<div class="flex justify-between text-sm py-1"><span class="text-neutral-700">${m.move}</span><span class="text-neutral-500 tabular-nums">${m.count}回</span></div>`).join('');
  return section('勝ちトーク分析 — なぜアポが取れたか',
    `<div class="border border-emerald-200 rounded-lg p-4 mb-4 text-[13px] text-neutral-800" style="background:#f2f9f4">${w.summary}</div>
     <div class="grid lg:grid-cols-2 gap-4 items-start">
       <div class="space-y-3">${wins}</div>
       ${card(`<div class="p-5"><div class="text-sm font-semibold text-neutral-700 mb-2">効いた勝ち筋（頻度）</div>${top || '<div class="text-sm text-neutral-500">—</div>'}<div class="text-[11px] text-neutral-500 mt-3">この型を「モデルの必勝パターン」として全員に展開できます。</div></div>`)}
     </div>`,
    'アポ・見込みになった訪問だけを取り出し、決め手をAIが言語化（太陽光蓄電池ドメイン）。');
}

/* ---------- ダウンロードユーティリティ ---------- */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = filename; document.body.appendChild(el); el.click();
  document.body.removeChild(el); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 上長への提出書 ---------- */
function submitKey(a) { return 'submit:' + (a.date || 'd') + '|' + (a.salesRepName || '田中 翔'); }
function loadSubmit(a) { try { return JSON.parse(localStorage.getItem(submitKey(a))) || {}; } catch { return {}; } }
function saveSubmit(a, obj) { try { localStorage.setItem(submitKey(a), JSON.stringify(obj)); } catch {} }
function submitSaveField() {
  const a = SESSION.analysis, o = loadSubmit(a);
  o.self = (document.getElementById('subSelf') || {}).value || '';
  o.ask = (document.getElementById('subAsk') || {}).value || '';
  o.topics = Array.from(document.querySelectorAll('input[data-topic]:checked')).map(el => el.getAttribute('data-topic'));
  saveSubmit(a, o);
}
function downloadSubmitText() {
  const a = SESSION.analysis, d = SESSION.diagnosis, gaps = R.modelGaps(a), s = loadSubmit(a);
  const fid = a.talkFidelity || {};
  let t = `日報・改善提出書（上長宛）\nFit Founder / Rumina 鬼教官\n\n提出日：${a.date || '2026-07-03'}\n営業：${a.salesRepName || '田中 翔'}\n鬼教官スコア：${a.coachScore}/100（判定 ${d.grade}）\n\n`;
  t += `■ トップ営業との主要乖離\n`;
  (d.weaknesses || []).slice(0, 3).forEach(w => { t += `・${w.metric}：${w.finding}\n  → ${w.fix}\n`; });
  if (!(d.weaknesses || []).length) t += `（大きな弱点なし）\n`;
  t += `\n■ 成功モデル乖離カルテ（総合再現率 ${fid.overall != null ? fid.overall + '%' : '—'}）\n`;
  gaps.forEach(r => { t += `・${r.name}：あなた${r.repRate}% / モデル${r.modelRate}%（${r.gap}pt）\n  → ${r.tip}\n`; });
  if (!gaps.length) t += `（すべての型が基準値以上）\n`;
  t += `\n■ 自己所見\n${s.self || '（未記入）'}\n\n■ 上長へ相談したいこと\n`;
  (s.topics || []).forEach(x => { t += `・${x}\n`; });
  if (s.ask) t += `${s.ask}\n`;
  if (!(s.topics || []).length && !s.ask) t += `（未記入）\n`;
  t += `\n■ 上長アドバイス欄\n\n\n\n（承認：　　　　　　　　印）\n\n— Rumina 鬼教官 / Fit Founder\n`;
  downloadText(`提出書_${a.salesRepName || '田中翔'}_${(a.date || '2026-07-03').replace(/-/g, '')}.txt`, t);
}

function viewSubmit() {
  const a = SESSION.analysis, b = R.TOP_BENCHMARK, d = SESSION.diagnosis;
  const gaps = R.modelGaps(a), fid = a.talkFidelity || {}, saved = loadSubmit(a);
  const kpi = [
    ['総ピンポン', a.totalPings + '件', b.targetPings + '件'],
    ['在宅反応率', a.homeResponseRate + '%', b.homeResponseRate + '%'],
    ['会話発生率', a.conversationRate + '%', b.conversationRate + '%'],
    ['アポ率', a.appointmentRate + '%', b.appointmentRate + '%'],
    ['切り返し平均', a.averageRebuttalCount + '回', b.averageRebuttalCount + '回'],
    ['冒頭質問率', a.openingQuestionRate + '%', b.openingQuestionRate + '%'],
  ].map(r => `<tr class="border-t border-neutral-200"><td class="py-1.5 text-neutral-600">${r[0]}</td><td class="py-1.5 text-right tabular-nums text-neutral-900">${r[1]}</td><td class="py-1.5 text-right tabular-nums text-neutral-500">${r[2]}</td></tr>`).join('');
  const topWeak = (d.weaknesses || []).slice(0, 3).map(w => `<li class="text-[13px] text-neutral-700 leading-relaxed py-0.5"><span class="text-rose-600 font-semibold">${w.metric}</span>：${w.finding}<div class="text-[12px] text-neutral-500">→ ${w.fix}</div></li>`).join('') || '<li class="text-sm text-neutral-500">大きな弱点はありません。</li>';
  const gapList = gaps.map(r => `<li class="text-[13px] text-neutral-700 leading-relaxed py-0.5"><span class="${r.gap <= -30 ? 'text-rose-600' : 'text-amber-600'} font-semibold">${r.name}</span>：あなた${r.repRate}% / モデル${r.modelRate}%（${r.gap}pt）<div class="text-[12px] text-emerald-700">→ ${r.tip}</div></li>`).join('') || '<li class="text-sm text-neutral-500">すべての型が基準値以上です。</li>';
  const topicOpts = gaps.map(r => { const v = r.name + ' の型づくり'; return `<label class="flex items-start gap-2 text-[13px] text-neutral-700 py-1"><input type="checkbox" data-topic="${v}" ${(saved.topics || []).includes(v) ? 'checked' : ''} onchange="submitSaveField()" class="mt-1 accent-emerald-600"> ${r.name} をどう埋めればいいか</label>`; }).join('') || '<div class="text-sm text-neutral-500">特に指摘なし</div>';

  return `
  <div class="flex items-center justify-between mb-4 no-print">
    <button onclick="nav('report')" class="text-sm text-neutral-500 hover:text-neutral-800">← レポートに戻る</button>
    <div class="flex flex-wrap gap-2">
      <button onclick="downloadSubmitText()" class="px-3 py-1.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100">提出書をテキストDL</button>
      <button onclick="window.print()" class="px-4 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold">印刷 / PDFで保存</button>
    </div>
  </div>

  <div id="submitSheet" class="border border-neutral-300 rounded-lg p-6 md:p-8 bg-white">
    <div class="flex items-start justify-between border-b-2 border-emerald-600 pb-3 mb-5 gap-3">
      <div>
        <div class="text-[11px] font-semibold tracking-wide text-emerald-700">FIT FOUNDER ・ RUMINA 鬼教官</div>
        <h1 class="text-xl font-bold text-neutral-900 mt-0.5">日報・改善提出書（上長宛）</h1>
      </div>
      <div class="text-right text-[12px] text-neutral-600 shrink-0">
        <div>提出日：${a.date || '2026-07-03'}</div>
        <div>営業：${a.salesRepName || '田中 翔'}</div>
        <div class="mt-1">鬼教官スコア <span class="text-lg font-bold text-emerald-600 tabular-nums">${a.coachScore}</span>/100 ・ 判定 <span class="font-bold">${d.grade}</span></div>
      </div>
    </div>

    <div class="text-sm font-semibold text-neutral-700 mb-1">① 本日の実績サマリー</div>
    <table class="w-full text-sm mb-5"><thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal pb-1">項目</th><th class="text-right font-normal">本人</th><th class="text-right font-normal">トップ営業</th></tr></thead><tbody>${kpi}</tbody></table>

    <div class="text-sm font-semibold text-neutral-700 mb-1">② トップ営業との主要乖離</div>
    <ul class="mb-5 space-y-0.5 list-disc list-inside">${topWeak}</ul>

    <div class="text-sm font-semibold text-neutral-700 mb-1">③ 成功モデル乖離カルテ（総合再現率 ${fid.overall != null ? fid.overall + '%' : '—'}）</div>
    <ul class="mb-5 space-y-0.5 list-disc list-inside">${gapList}</ul>

    <div class="text-sm font-semibold text-neutral-700 mb-1">④ 自己所見（本人記入）</div>
    <textarea id="subSelf" rows="3" oninput="submitSaveField()" placeholder="今日うまくいった点・課題・明日どう変えるかを自分の言葉で。" class="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm text-neutral-900 focus:border-emerald-400/60 focus:outline-none mb-5">${saved.self || ''}</textarea>

    <div class="text-sm font-semibold text-neutral-700 mb-1">⑤ 上長へ相談したいこと（アドバイスをもらいたい点）</div>
    <div class="border border-neutral-200 rounded-md p-3 mb-2">${topicOpts}</div>
    <textarea id="subAsk" rows="2" oninput="submitSaveField()" placeholder="上記以外に相談したいこと（例：14時台の空白の潰し方、断り『間に合ってます』の切り返し）" class="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm text-neutral-900 focus:border-emerald-400/60 focus:outline-none mb-5">${saved.ask || ''}</textarea>

    <div class="text-sm font-semibold text-neutral-700 mb-1">⑥ 上長アドバイス・承認欄</div>
    <div class="border border-neutral-300 rounded-md h-28 mb-2"></div>
    <div class="text-right text-[12px] text-neutral-500">承認：＿＿＿＿＿＿＿＿　印</div>

    <div class="text-[11px] text-neutral-400 mt-4 pt-3 border-t border-neutral-200">※ 数値・判定は解析上の目安です。ダウンロード / 印刷（PDF保存）して上長へ提出してください。— Rumina 鬼教官 / Fit Founder</div>
  </div>`;
}

/* cyzen照合（量の確定）— 行動量はcyzen、トーク品質は鬼教官 */
function cyzenSection(a) {
  const c = a.cyzen; if (!c || !c.matched) return '';
  const conv = a.conversationPings ?? a.conversationCount ?? 0;
  const gap = c.visits - c.visitStamp;
  const cell = (label, val, unit, sub, cls) => `<div class="px-4 py-3">
    <div class="text-[11px] text-neutral-500">${label}</div>
    <div class="text-xl font-semibold tabular-nums ${cls || 'text-neutral-900'}">${val}<span class="text-xs text-neutral-400 ml-0.5">${unit || ''}</span></div>
    ${sub ? `<div class="text-[11px] text-neutral-500 mt-0.5">${sub}</div>` : ''}</div>`;
  const work = (c.workStart || c.workEnd)
    ? `${(c.workStart || '').slice(11, 16) || '—'}〜${(c.workEnd || '').slice(11, 16) || '—'}`
    : '—';
  return section('cyzen照合 — 行動量の確定',
    `${card(`<div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-neutral-200">
      ${cell('訪問数（cyzen確定）', c.visits, '件', '本日の訪問件数(不在含む)', 'text-emerald-600')}
      ${cell('アポ（cyzen確定）', c.apo, '件', c.seiyaku || c.haisen ? `成約${c.seiyaku} / 敗戦${c.haisen}` : '', 'text-emerald-600')}
      ${cell('録音で会話が録れた', conv, '件', '鬼教官（質の母数）')}
      ${cell('稼働', work, '', `GPS打刻 ${c.gpsStamp}`)}
    </div>`)}
    <div class="mt-3 grid lg:grid-cols-2 gap-3">
      ${card(`<div class="p-4">
        <div class="text-sm font-semibold text-neutral-700 mb-1">申告 vs 打刻の裏取り</div>
        <div class="text-[13px] text-neutral-800 leading-relaxed">自己申告の訪問 <b>${c.visits}件</b> に対し、cyzenで「訪問」を打刻したのは <b>${c.visitStamp}件</b>。
        ${gap > 0 ? `<span class="text-amber-600">差 ${gap}件は打刻されていません</span>（申告精度・打刻運用の是正余地）。` : '打刻と申告が一致しています。'}</div>
      </div>`)}
      ${card(`<div class="p-4">
        <div class="text-sm font-semibold text-neutral-700 mb-1">照合キー</div>
        <div class="text-[13px] text-neutral-700 leading-relaxed">営業コード <b>${c.code}</b>（${c.name || '—'}）${c.attr ? `<span class="text-[11px] text-neutral-500"> ・ ${c.attr}</span>` : ''}<br>
        照合日：<b>${c.date}</b> ${c.exact ? '<span class="text-emerald-600">（録音日と一致）</span>' : `<span class="text-amber-600">（録音日 ${c.requestedDate} のcyzen記録が無いため直近の稼働日で表示）</span>`}</div>
      </div>`)}
    </div>`,
    '訪問数・アポはcyzen（全営業の“量”）で確定。この下のカルテは録音から鬼教官が出す“質”。量×質で1人を見る。');
}

/* 成功モデル乖離カルテ（健康診断のカルテ形式） */
// 再現率→医療風の判定ランク
function karteJudge(f) {
  if (f >= 90) return { g: 'A', label: '正常', badge: 'bg-emerald-600 text-white', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (f >= 70) return { g: 'B', label: '軽度', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-400', text: 'text-emerald-700' };
  if (f >= 50) return { g: 'C', label: '要注意', badge: 'bg-amber-100 text-amber-700 border border-amber-200', dot: 'bg-amber-400', text: 'text-amber-700' };
  return { g: 'D', label: '要改善', badge: 'bg-rose-100 text-rose-700 border border-rose-200', dot: 'bg-rose-500', text: 'text-rose-700' };
}
function talkFidelitySection(a) {
  const t = a.talkFidelity; if (!t || !t.moves || !t.moves.length) return '';
  const oj = karteJudge(t.overall);
  const w = t.weakest;
  const model = window.__model || null;
  const isOwner = !!(window.__user && window.__user.role === 'owner');
  const baseline = model
    ? `基準値：<span class="text-emerald-700 font-medium">${model.by} さんの録音</span>（${(model.at || '').slice(0, 10)} ・ 会話${model.denom}訪問から算出）`
    : `基準値：<span class="text-neutral-600 font-medium">初期値</span>（成功モデル未登録 — 川上さんの録音を登録すると実データ基準に）`;

  // 検査表の行（型 = 検査項目、あなた = 測定値、モデル = 基準値）
  const rows = t.moves.map(m => {
    const j = karteJudge(m.fidelity);
    const gapTxt = m.gap < 0 ? `${m.gap}pt` : `+${m.gap}pt`;
    return `<tr class="border-t border-[#E8EFEA] align-top">
      <td class="py-3 pr-2"><div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${j.dot} shrink-0"></span><span class="text-sm font-medium text-neutral-800">${m.key}</span></div></td>
      <td class="py-3 px-2 text-right tabular-nums"><span class="text-base font-semibold ${j.text}">${m.repRate}<span class="text-[11px] text-neutral-400">%</span></span></td>
      <td class="py-3 px-2 text-right tabular-nums text-neutral-500">${m.modelRate}<span class="text-[11px] text-neutral-400">%</span></td>
      <td class="py-3 px-2 text-right tabular-nums ${m.gap < 0 ? 'text-rose-600' : 'text-emerald-600'}">${gapTxt}</td>
      <td class="py-3 px-2 text-center"><span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${j.badge}">${j.g}・${j.label}</span></td>
      <td class="py-3 pl-2 text-[12px] text-neutral-600 leading-relaxed min-w-[180px]">${m.fidelity >= 90 ? '基準を満たしています。この型を維持。' : m.tip}</td>
    </tr>`;
  }).join('');

  const abList = ['A 正常 90%+', 'B 軽度 70–89%', 'C 要注意 50–69%', 'D 要改善 〜49%']
    .map((s, i) => { const cs = ['text-emerald-600', 'text-emerald-500', 'text-amber-600', 'text-rose-600']; return `<span class="${cs[i]}">${s}</span>`; })
    .join('<span class="text-neutral-300 mx-1.5">/</span>');

  const inner = `
    <div class="rounded-2xl border border-[#E8EFEA] bg-white overflow-hidden shadow-[0_1px_3px_rgba(16,40,30,0.05)]">
      <!-- カルテ ヘッダー -->
      <div class="px-5 sm:px-6 py-4 border-b border-[#E8EFEA]" style="background:linear-gradient(180deg,#F4FBF7,#ffffff)">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div class="text-[11px] font-semibold tracking-wide text-emerald-700">RUMINA 鬼教官 ・ 成功モデル乖離ドック</div>
            <h3 class="text-lg font-bold text-neutral-900 mt-0.5">トーク型 健康診断カルテ</h3>
            <div class="text-[12px] text-neutral-500 mt-1">受診者：<span class="text-neutral-700 font-medium">${a.salesRepName || '田中 翔'}</span>　診断日：${a.date || '2026-07-03'}　検体：会話が成立した ${t.denom} 訪問</div>
            <div class="text-[11px] text-neutral-500 mt-1">${baseline}</div>
          </div>
          <div class="text-center shrink-0">
            <div class="text-[11px] text-neutral-500 mb-0.5">総合判定</div>
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl text-xl font-bold ${oj.badge}">${oj.g}</span>
              <div class="text-left"><div class="text-2xl font-bold text-neutral-900 tabular-nums leading-none">${t.overall}<span class="text-sm text-neutral-400">%</span></div><div class="text-[11px] ${oj.text}">${oj.label}</div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 検査表 -->
      <div class="px-5 sm:px-6 pt-4 pb-2 overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead><tr class="text-[11px] text-neutral-400">
            <th class="text-left font-normal pb-1">検査項目（型）</th>
            <th class="text-right font-normal pb-1 px-2">あなた</th>
            <th class="text-right font-normal pb-1 px-2">成功モデル</th>
            <th class="text-right font-normal pb-1 px-2">乖離</th>
            <th class="text-center font-normal pb-1 px-2">判定</th>
            <th class="text-left font-normal pb-1 pl-2">所見・処方</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="text-[11px] text-neutral-500 mt-2 pb-1">判定基準：${abList}</div>
      </div>

      <!-- Dr.Rumina 総合所見 -->
      ${w ? `<div class="mx-5 sm:mx-6 mb-5 mt-2 rounded-xl border border-emerald-100 p-4 flex gap-3 items-start" style="background:#f2f9f4">
        <img src="/assets/rumina.png" alt="Dr.Rumina" class="w-11 h-11 rounded-full object-cover object-top border border-emerald-200 shrink-0" onerror="this.style.display='none'">
        <div>
          <div class="text-[12px] font-semibold text-emerald-800 mb-0.5">Dr.ルミナの総合所見</div>
          <div class="text-[13px] text-neutral-800 leading-relaxed">最も乖離が大きいのは <b class="text-rose-600">${w.key}</b>（あなた ${w.repRate}% / 成功モデル ${w.modelRate}%）。ここが総合判定 ${oj.g} の主因です。まずは「${w.tip}」を明日の全訪問で意識。1項目でも B 以上に上げれば、アポ率は必ず動きます。</div>
        </div>
      </div>` : ''}

      ${isOwner ? `<div class="mx-5 sm:mx-6 mb-5 -mt-1 flex flex-wrap items-center gap-2 border-t border-[#E8EFEA] pt-4">
        <span class="text-[12px] text-neutral-600 mr-1">この録音をモデル基準にする：</span>
        <button onclick="registerModelFromReport()" class="px-3.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-[13px] font-semibold transition">この録音を成功モデルに登録</button>
        ${model ? `<button onclick="resetModelBaseline()" class="px-3 py-1.5 rounded-md border border-neutral-300 text-[13px] text-neutral-600 hover:bg-neutral-100 transition">初期値に戻す</button>` : ''}
        <span id="modelActionMsg" class="text-[12px] text-neutral-500"></span>
      </div>` : ''}
    </div>`;

  return section('成功モデルとの乖離カルテ',
    inner,
    '成功モデル（川上）の勝ちの型を"基準値"に、あなたのトークを健康診断。どの型がどれだけ足りていないかをカルテで可視化。');
}

/* 成功モデル登録（owner）：いま開いている録音の型を"基準値"に採用 */
async function registerModelFromReport() {
  const msg = document.getElementById('modelActionMsg');
  const sid = window.__lastSessionId;
  if (!sid) { if (msg) { msg.textContent = 'この画面の録音IDが取得できません。録音を解析し直してから登録してください。'; msg.className = 'text-[12px] text-rose-600'; } return; }
  if (msg) { msg.textContent = '登録中…'; msg.className = 'text-[12px] text-neutral-500'; }
  try {
    const model = await API.registerModel(sid);
    window.__model = model;
    if (msg) { msg.textContent = `成功モデルを更新しました（会話${model.denom}訪問から基準を算出）。次回以降の解析はこの基準で診断されます。`; msg.className = 'text-[12px] text-emerald-600'; }
  } catch (e) {
    if (msg) { msg.textContent = '登録に失敗しました：' + e.message; msg.className = 'text-[12px] text-rose-600'; }
  }
}
window.registerModelFromReport = registerModelFromReport;

/* 成功モデルを初期値へ戻す（owner） */
async function resetModelBaseline() {
  const msg = document.getElementById('modelActionMsg');
  if (msg) { msg.textContent = '初期化中…'; msg.className = 'text-[12px] text-neutral-500'; }
  try {
    await API.resetModel();
    window.__model = null;
    if (msg) { msg.textContent = '基準値を初期値に戻しました。'; msg.className = 'text-[12px] text-emerald-600'; }
  } catch (e) {
    if (msg) { msg.textContent = '初期化に失敗しました：' + e.message; msg.className = 'text-[12px] text-rose-600'; }
  }
}
window.resetModelBaseline = resetModelBaseline;

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
  const cmpRows = cmp.map(r => `<tr class="border-t border-neutral-200">
    <td class="py-2 text-neutral-600">${r[0]}</td>
    <td class="py-2 text-right tabular-nums text-neutral-900">${r[1]}</td>
    <td class="py-2 text-right tabular-nums text-neutral-500">${r[2]}</td>
    <td class="py-2 text-right tabular-nums ${r[3].startsWith('-') ? 'text-rose-600' : 'text-emerald-600'}">${r[3]}</td></tr>`).join('');
  const actions = R.NEXT_ACTIONS.map((x, i) => `
    <div class="flex items-start gap-3 py-2.5 border-b border-neutral-200 last:border-0">
      <span class="text-xs text-neutral-500 tabular-nums mt-0.5">${i + 1}</span>
      <div class="flex-1 text-sm text-neutral-800">${x.text}</div>
      <span class="text-xs text-emerald-600 whitespace-nowrap">${x.metric}</span>
    </div>`).join('');

  const gpsBlock = a.gps?.connected ? section('GPS照合（サボり裏取り＋総ピンポン数）',
    card(`<div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-neutral-200">
      ${statCell('総ピンポン', a.gps.totalStops ?? a.gps.visitClusters, '件', `訪問${a.gps.visitClusters}＋不在${a.gps.noAnswerStops ?? 0}`)}
      ${statCell('移動', a.gps.movingTimeMinutes, '分')}
      ${statCell('接客（滞在）', a.gps.stayTimeMinutes, '分')}
      ${statCell('実サボり', a.gps.verifiedIdleMinutes, '分', '', 'text-rose-600')}
    </div>`),
    `停止クラスタから総ピンポン数を自動算出。空白は移動を除いて実サボり${a.gps.verifiedIdleMinutes}分と確定。`) : '';

  return `
  <div class="flex items-end justify-between mb-6">
    <div><div class="text-xs text-neutral-500">解析レポート ・ ${a.date || '2026-07-03'}</div><h1 class="text-xl font-semibold text-neutral-900 mt-0.5">${a.salesRepName || '田中 翔'} の1日</h1></div>
    <div class="text-right"><div class="text-xs text-neutral-500">鬼教官スコア</div><div class="text-2xl font-semibold text-emerald-600 tabular-nums">${a.coachScore}<span class="text-sm text-neutral-500">/100</span></div></div>
  </div>

  ${qualityBanner(a)}
  ${crmPanel(a)}

  <div class="mt-4"></div>
  ${card(`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-neutral-200">
    ${statCell('総ピンポン', a.totalPings, '件', `達成 ${a.targetAchievementRate}%`)}
    ${statCell('在宅反応', a.homeResponseCount, '件', `${a.homeResponseRate}%`)}
    ${statCell('会話発生', a.conversationCount, '件', `平均${a.averageConversationSeconds}秒`)}
    ${statCell('アポ', a.appointmentCount, '件', `${a.appointmentRate}%`)}
    ${statCell('見込み', a.prospectCount, '件', `${a.prospectRate}%`)}
    ${statCell('サボり', a.suspiciousIdleTimeMinutes, '分', a.gps?.connected ? 'GPS確定' : a.suspiciousWindow, a.gps?.connected ? 'text-rose-600' : '')}
  </div>`)}

  ${cyzenSection(a)}
  ${gpsBlock}
  ${winTalkSection(a)}
  ${talkFidelitySection(a)}
  ${diagnosisSection()}

  ${section('時間帯別 活動密度', card(`<div class="p-5">${C.hourlyDensity(a.hourly || [], idleHours)}<div class="text-[11px] text-neutral-500 mt-1">赤 = 活動が薄い時間帯</div></div>`))}

  <div class="grid lg:grid-cols-2 gap-4 mt-8">
    ${card(`<div class="p-5"><div class="text-sm font-semibold text-neutral-700 mb-3">トップ営業との型比較</div>${C.radarChart(SESSION.radar)}<div class="text-[11px] text-neutral-500 text-center">緑=本人 / 灰=トップ</div></div>`)}
    ${card(`<div class="p-5"><div class="text-sm font-semibold text-neutral-700 mb-4">断り文句ランキング</div><div class="space-y-3">${C.objectionBars(a.objectionRanking || [])}</div></div>`)}
  </div>

  ${section('トップ営業比較', card(`<div class="p-5"><table class="w-full text-sm">
    <thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal pb-1">項目</th><th class="text-right font-normal">本人</th><th class="text-right font-normal">トップ</th><th class="text-right font-normal">差分</th></tr></thead>
    <tbody>${cmpRows}</tbody></table></div>`))}

  ${coachPanel()}
  ${section('明日の改善アクション', card(`<div class="px-5 py-2">${actions}</div>`))}

  <div class="mt-8 flex flex-wrap gap-3">
    <button onclick="nav('submit')" class="px-5 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">上長へ提出書を作成 →</button>
    <button onclick="nav('issues')" class="px-5 py-2.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 transition">チームのイシュー・改善提案を見る</button>
    <button onclick="nav('upload')" class="px-5 py-2.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 transition">別の録音を出稿</button>
  </div>`;
}

/* ---------- ⑤ 営業マン一覧 ---------- */
function viewReps() {
  const prTxt = { high: ['最優先', 'text-rose-600'], mid: ['要観察', 'text-amber-600'], low: ['良好', 'text-emerald-600'] };
  const rows = R.SALES_REPS.slice().sort((x, y) => y.score - x.score).map(r => {
    const scoreCol = r.score >= 85 ? 'text-emerald-600' : r.score >= 65 ? 'text-amber-600' : 'text-rose-600';
    return `<tr class="border-t border-neutral-200">
      <td class="py-3">
        <div class="text-neutral-900">${r.name} ${r.current ? '<span class="text-[10px] text-emerald-600 ml-1">本人</span>' : ''}</div>
        <div class="text-[11px] text-neutral-500">${r.team} ・ ${r.role}</div>
      </td>
      <td class="py-3 text-right tabular-nums text-neutral-700">${r.pings}<span class="text-neutral-500 text-xs">/${r.target}</span></td>
      <td class="py-3 text-right tabular-nums ${r.achieve >= 100 ? 'text-emerald-600' : 'text-neutral-700'}">${r.achieve}%</td>
      <td class="py-3 text-right tabular-nums text-neutral-700">${r.apo}</td>
      <td class="py-3 text-right tabular-nums ${scoreCol}">${r.score}</td>
      <td class="py-3 text-right tabular-nums ${r.idle >= 40 ? 'text-rose-600' : 'text-neutral-600'}">${r.idle}分</td>
      <td class="py-3 text-right text-xs ${prTxt[r.priority][1]}">${prTxt[r.priority][0]}</td>
    </tr>`;
  }).join('');
  if (!R.SALES_REPS.length) {
    return `${h1('営業マン一覧', '鬼教官スコア順 ・ 改善優先度でサボり・失速を可視化')}
      ${card(`<div class="p-8 text-center text-sm text-neutral-700">まだ営業マンが登録されていません。<div class="mt-3"><button onclick="nav('admin')" class="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">管理者マスタで登録する</button></div></div>`)}`;
  }
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
  if (c.empty) {
    const msg = c.reason === 'no-reps'
      ? '営業名簿が空です。まず「管理者マスタ（名簿編集）」で営業マンを登録してください。'
      : 'トップ群（スコア80以上）と下位群（65未満）の両方が揃うと、比較・イシュー分析が出ます。名簿を追加してください。';
    return `${h1('イシュー分析', 'トップ営業 vs 下位営業を比較し、組織のどこで負けているかを炙り出す。')}
      ${card(`<div class="p-8 text-center text-sm text-neutral-700">${msg}<div class="mt-3"><button onclick="nav('admin')" class="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">管理者マスタを開く</button></div></div>`)}`;
  }
  const sev = { critical: 'text-rose-600', warn: 'text-amber-600', watch: 'text-neutral-600' };

  const groupCard = (title, p, apo, accent) => card(`<div class="p-5">
    <div class="text-xs text-neutral-500 mb-1">${title}（${p.members.length}名）</div>
    <div class="text-sm text-neutral-800">${p.members.map(m => m.name).join('・')}</div>
    <div class="flex gap-6 mt-3">
      <div><div class="text-[11px] text-neutral-500">平均スコア</div><div class="text-lg font-semibold tabular-nums ${accent}">${p.score}</div></div>
      <div><div class="text-[11px] text-neutral-500">アポ/日</div><div class="text-lg font-semibold tabular-nums text-neutral-800">${apo}</div></div>
    </div></div>`);

  const issues = c.issues.map((x, i) => `
    <div class="border border-neutral-200 rounded-lg p-5">
      <div class="flex items-baseline justify-between mb-1">
        <div class="text-sm text-neutral-900">${i + 1}. ${x.stage} <span class="${sev[x.severity]} text-xs ml-1">${x.severity === 'critical' ? '最重要' : x.severity === 'warn' ? '重要' : '要観察'}</span></div>
        <div class="text-xs text-rose-600 tabular-nums">チーム月 約${x.teamMonthly}件の損失</div>
      </div>
      <div class="text-[13px] text-neutral-600">${x.driver}</div>
      <div class="text-xs text-amber-600/90 mt-1.5">特に足を引っ張っている　${x.worstReps.join('・')}</div>
      <div class="text-xs text-neutral-500 mt-1.5">原因　${x.cause}</div>
      <div class="text-xs text-emerald-600/90 mt-0.5">処方　${x.fix}</div>
    </div>`).join('');

  const border = { harsh: 'border-rose-400/50', good: 'border-emerald-400/50', warn: 'border-amber-400/50', close: 'border-neutral-600' };
  const narrative = c.narrative.map(x => `
    <div class="border-l-2 ${border[x.tone]} pl-4">
      <div class="text-xs text-neutral-500 mb-1">${x.title}</div>
      <p class="text-[15px] leading-relaxed text-neutral-800">${x.text}</p>
    </div>`).join('');

  const gapRows = c.gaps.map(g => {
    const behind = g.gap < 0;
    return `<tr class="border-t border-neutral-200">
      <td class="py-2 text-neutral-600">${g.label}</td>
      <td class="py-2 text-right tabular-nums text-emerald-600">${g.top}${g.unit}</td>
      <td class="py-2 text-right tabular-nums text-neutral-700">${g.bottom}${g.unit}</td>
      <td class="py-2 text-right tabular-nums ${behind ? 'text-rose-600' : 'text-neutral-600'}">${behind ? '' : '+'}${g.gap}${g.unit}</td>
      <td class="py-2 pl-4 w-28"><div class="h-1.5 rounded-full bg-neutral-200 overflow-hidden"><div class="h-full ${g.ratio < 70 ? 'bg-rose-500/70' : 'bg-neutral-500'}" style="width:${Math.min(g.ratio, 100)}%"></div></div></td>
    </tr>`;
  }).join('');

  return `
  ${h1('イシュー分析', 'トップ営業 vs 下位営業を比較し、組織のどこで負けているかを炙り出す。')}

  ${card(`<div class="p-5 flex flex-wrap items-center justify-between gap-4">
    <div><div class="text-xs text-neutral-500">下位${c.bottomCount}名の機会損失（トップ群との差）</div>
    <div class="text-3xl font-semibold text-rose-600 tabular-nums">月 約${c.teamMonthlyTotal}<span class="text-base text-neutral-500 ml-1">件のアポ</span></div></div>
    <div class="text-xs text-neutral-500 max-w-xs text-right">1人あたり1日${c.perDayGap.toFixed(1)}件の差。個人の才能差ではなく、埋められる“型の差”。</div>
  </div>`)}

  <div class="grid sm:grid-cols-2 gap-4 mt-4">
    ${groupCard('トップ群', c.top, c.topApoPerDay, 'text-emerald-600')}
    ${groupCard('下位群', c.bottom, c.bottomApoPerDay, 'text-rose-600')}
  </div>

  ${section('イシュー（アポ損失インパクト順）', `<div class="space-y-3">${issues}</div>`, 'アポ損失をファネルに分解し、影響の大きい順に並べた。')}

  ${section('鬼教官の総括', card(`<div class="p-5 space-y-5">${narrative}</div>`))}

  ${section('KPI比較（トップ群 / 下位群）', card(`<div class="p-5"><table class="w-full text-sm">
    <thead><tr class="text-xs text-neutral-500"><th class="text-left font-normal pb-1">指標</th><th class="text-right font-normal">トップ群</th><th class="text-right font-normal">下位群</th><th class="text-right font-normal">差</th><th class="text-right font-normal pl-4">トップ比</th></tr></thead>
    <tbody>${gapRows}</tbody></table></div>`), '緑=トップ群 / 灰=下位群 ・ バーは下位群のトップ到達率')}`;
}

/* ---------- 管理者マスタ（営業名簿の編集） ---------- */
const REP_FIELDS = [
  { k: 'name', label: '名前', t: 'text', w: 'w-28' },
  { k: 'team', label: '部署', t: 'text', w: 'w-24' },
  { k: 'role', label: '役割', t: 'text', w: 'w-16' },
  { k: 'pings', label: 'ピンポン', t: 'num', w: 'w-16' },
  { k: 'apo', label: 'アポ', t: 'num', w: 'w-14' },
  { k: 'homeResponseRate', label: '在宅%', t: 'num', w: 'w-14' },
  { k: 'conversationRate', label: '会話%', t: 'num', w: 'w-14' },
  { k: 'averageConversationSeconds', label: '会話秒', t: 'num', w: 'w-14' },
  { k: 'averageRebuttalCount', label: '切返', t: 'num', w: 'w-14' },
  { k: 'openingQuestionRate', label: '冒頭%', t: 'num', w: 'w-14' },
  { k: 'appointmentRate', label: 'アポ率%', t: 'num', w: 'w-16' },
  { k: 'score', label: 'スコア', t: 'num', w: 'w-14' },
  { k: 'idle', label: 'サボ分', t: 'num', w: 'w-14' },
  { k: 'priority', label: '優先度', t: 'sel', w: 'w-20', opts: ['high', 'mid', 'low'] },
];
function viewAdmin() {
  const reps = R.SALES_REPS;
  const cell = (r, i, f) => {
    const id = `rep-${i}-${f.k}`;
    if (f.t === 'sel') return `<select id="${id}" onchange="adminSave()" class="${f.w} bg-white border border-neutral-300 rounded px-1.5 py-1 text-sm">${f.opts.map(o => `<option value="${o}" ${r[f.k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    return `<input id="${id}" type="${f.t === 'num' ? 'number' : 'text'}" step="any" value="${r[f.k] ?? ''}" oninput="adminSave()" class="${f.w} bg-white border border-neutral-300 rounded px-1.5 py-1 text-sm ${f.t === 'num' ? 'tabular-nums text-right' : ''}">`;
  };
  const rows = reps.map((r, i) => `<tr class="border-t border-neutral-200">
    ${REP_FIELDS.map(f => `<td class="px-1.5 py-1">${cell(r, i, f)}</td>`).join('')}
    <td class="px-1.5 py-1 text-right whitespace-nowrap"><button onclick="issueRep(${i})" class="text-xs text-emerald-600 hover:underline mr-2">ログイン発行</button><button onclick="adminDelete(${i})" class="text-xs text-rose-600 hover:underline">削除</button></td>
  </tr>`).join('');
  return `
  ${h1('管理者マスタ（営業名簿）', '営業マンの追加・編集・削除。ここが「営業マン一覧」と「イシュー分析」の元データ。変更は自動保存。')}
  <div class="flex flex-wrap gap-2 mb-3">
    <button onclick="adminAdd()" class="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">＋ 営業マンを追加</button>
    <button onclick="adminReset()" class="px-3 py-1.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 transition">名簿を空にする</button>
    <button onclick="adminSample()" class="px-3 py-1.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 transition">サンプルを入れる</button>
    <span id="adminSaved" class="text-xs text-emerald-600 self-center"></span>
  </div>
  <div id="issueResult" class="mb-3"></div>
  ${card(`<div class="overflow-x-auto"><table class="text-sm min-w-[1040px]">
    <thead><tr class="text-xs text-neutral-500 bg-neutral-50">${REP_FIELDS.map(f => `<th class="px-1.5 py-2 text-left font-normal whitespace-nowrap">${f.label}</th>`).join('')}<th class="px-1.5"></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`)}
  <p class="text-xs text-neutral-500 mt-3">※ ピンポン等の実績値は、通常は録音の解析結果から入ります。ここでの手入力はデモ/調整用です。</p>`;
}
function adminRead() {
  return R.SALES_REPS.map((r, i) => {
    const o = { ...r };
    REP_FIELDS.forEach(f => { const el = document.getElementById(`rep-${i}-${f.k}`); if (!el) return; o[f.k] = f.t === 'num' ? (parseFloat(el.value) || 0) : el.value; });
    o.target = 100; o.achieve = Math.round((o.pings || 0) / 100 * 100);
    return o;
  });
}
function adminSave() {
  R.saveReps(adminRead());
  const s = document.getElementById('adminSaved'); if (s) { s.textContent = '保存しました'; setTimeout(() => { if (s) s.textContent = ''; }, 1200); }
}
function adminAdd() {
  const list = adminRead();
  list.push({ id: 'r' + list.length + '_' + Math.floor(performance.now()), name: '新規 営業', team: '第2営業部', role: '新人', pings: 0, target: 100, achieve: 0, apo: 0, score: 50, idle: 0, priority: 'mid', current: false, homeResponseRate: 0, conversationRate: 0, averageConversationSeconds: 0, averageRebuttalCount: 0, openingQuestionRate: 0, appointmentRate: 0 });
  R.saveReps(list); render();
}
function adminDelete(i) { const list = adminRead(); list.splice(i, 1); R.saveReps(list); render(); }
function adminReset() { R.resetReps(); render(); }
function adminSample() { R.saveReps(R.SAMPLE_REPS.map(r => ({ ...r }))); render(); }
window.adminSave = adminSave; window.adminAdd = adminAdd; window.adminDelete = adminDelete; window.adminReset = adminReset; window.adminSample = adminSample;

/* ---------- ルーター ---------- */
/* ---------- 診断ログ（録音の記録・owner専用） ---------- */
function viewLog() {
  return `
  ${h1('診断ログ（録音の記録）', '出稿・解析した録音を1件ずつ保存。文字起こし全文・訪問ごとの判定・KPI／カルテまで残ります。')}
  ${card(`<div class="p-4 text-[12px] text-neutral-600 leading-relaxed">
    <span class="font-semibold text-neutral-700">保存されるもの</span>：① 文字起こし全文（実際に話した会話）／② 訪問ごとの結果（アポ・見込み・断り文句・切り返し）／③ KPIと成功モデル乖離カルテ。
    <span class="font-semibold text-neutral-700 ml-1">保存先</span>：サーバーの永続領域（本番は Railway Volume の <code>/data</code>）。再デプロイでも消えません。
    <span class="font-semibold text-neutral-700 ml-1">音声ファイル</span>：文字起こし後も同領域に保持（不要なら運用で削除可）。
  </div>`)}
  <div id="consentWrap" class="mt-4"></div>
  <div id="logWrap" class="mt-4 text-sm text-neutral-500">読み込み中…</div>
  <div id="logDetail" class="mt-4"></div>`;
}
async function loadConsents() {
  const box = document.getElementById('consentWrap'); if (!box) return;
  let data; try { data = await API.getConsents(); } catch { box.innerHTML = ''; return; }
  const list = data.consents || [];
  const done = list.filter(c => c.current).length;
  const rows = list.map(c => `<tr class="border-t border-neutral-200">
    <td class="px-3 py-1.5 text-neutral-800">${c.name}</td>
    <td class="px-3 py-1.5 text-neutral-500">${c.role === 'owner' ? '管理者' : '営業'}</td>
    <td class="px-3 py-1.5">${c.current
      ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">同意済</span>'
      : (c.consent ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">要再同意（版が古い）</span>' : '<span class="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">未同意</span>')}</td>
    <td class="px-3 py-1.5 text-[11px] text-neutral-400">${c.consent ? (c.consent.at || '').replace('T', ' ').slice(0, 16) + ' ・ 版' + c.consent.version : '—'}</td>
  </tr>`).join('');
  box.innerHTML = card(`<div class="p-4">
    <div class="flex items-center justify-between mb-2"><div class="text-sm font-semibold text-neutral-700">録音・解析への同意状況（監査）</div><div class="text-[12px] text-neutral-500">${done}/${list.length} 名 同意済 ・ 現行版 ${data.version}</div></div>
    <div class="overflow-x-auto"><table class="w-full text-sm min-w-[520px]"><thead><tr class="text-xs text-neutral-500 bg-neutral-50">
      <th class="px-3 py-1.5 text-left font-normal">氏名</th><th class="px-3 py-1.5 text-left font-normal">役割</th><th class="px-3 py-1.5 text-left font-normal">同意</th><th class="px-3 py-1.5 text-left font-normal">取得日時・版</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div>`);
}
async function loadLog() {
  const wrap = document.getElementById('logWrap'); if (!wrap) return;
  let reports = [];
  try { reports = await API.getLog(); } catch (e) { wrap.innerHTML = `<div class="text-sm text-rose-600">${e.message}</div>`; return; }
  if (!reports.length) { wrap.innerHTML = `<div class="text-sm text-neutral-500 p-6 text-center border border-neutral-200 rounded-xl bg-white">まだ録音の記録がありません。「② 稼働終了・録音を出稿」から解析すると、ここに残ります。</div>`; return; }
  const badge = o => o == null ? '—' : `<span class="tabular-nums ${o >= 70 ? 'text-emerald-600' : o >= 45 ? 'text-amber-600' : 'text-rose-600'}">${o}%</span>`;
  const rows = reports.map(r => `<tr class="border-t border-neutral-200 hover:bg-emerald-50/40 cursor-pointer" onclick="openLogItem('${r.id}')">
    <td class="px-3 py-2 text-neutral-800">${r.name || '—'}</td>
    <td class="px-3 py-2 text-neutral-500">${r.date || '—'}</td>
    <td class="px-3 py-2 text-neutral-500">${r.source === 'plaud' ? 'NotePin' : r.source === 'whisper' ? '音声解析' : (r.source || '—')}</td>
    <td class="px-3 py-2 text-right tabular-nums text-neutral-700">${r.pings ?? '—'}</td>
    <td class="px-3 py-2 text-right tabular-nums text-neutral-700">${r.score ?? '—'}</td>
    <td class="px-3 py-2 text-right">${badge(r.overall)}</td>
    <td class="px-3 py-2 text-[11px]">${r.audio === 'purged' ? '<span class="text-neutral-400">削除済</span>' : r.audio === 'kept' ? '<span class="text-neutral-600">保持</span>' : '<span class="text-neutral-300">音声なし</span>'}</td>
    <td class="px-3 py-2 text-[11px] text-neutral-400 whitespace-nowrap">${(r.at || '').replace('T', ' ').slice(0, 16)}</td>
    <td class="px-3 py-2 text-right text-[12px] text-emerald-600 whitespace-nowrap">文字起こし →</td>
  </tr>`).join('');
  wrap.innerHTML = `${card(`<div class="overflow-x-auto"><table class="w-full text-sm min-w-[760px]">
    <thead><tr class="text-xs text-neutral-500 bg-neutral-50">
      <th class="px-3 py-2 text-left font-normal">受診者</th><th class="px-3 py-2 text-left font-normal">稼働日</th><th class="px-3 py-2 text-left font-normal">出所</th>
      <th class="px-3 py-2 text-right font-normal">ピンポン</th><th class="px-3 py-2 text-right font-normal">スコア</th><th class="px-3 py-2 text-right font-normal">再現率</th>
      <th class="px-3 py-2 text-left font-normal">音声</th><th class="px-3 py-2 text-left font-normal">記録時刻</th><th class="px-3"></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`)}
    <div class="text-[11px] text-neutral-400 mt-2">${reports.length}件（新しい順）。行をクリックすると文字起こし全文が開きます。</div>`;
}
async function openLogItem(id) {
  const box = document.getElementById('logDetail'); if (!box) return;
  box.innerHTML = `<div class="text-sm text-neutral-500 p-4">読み込み中…</div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let rec; try { rec = await API.getLogItem(id); } catch (e) { box.innerHTML = `<div class="text-sm text-rose-600 p-4">${e.message}</div>`; return; }
  const segs = rec.transcript || [];
  const clock = s => { const t = Math.max(0, Math.round(s)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const spkClass = sp => sp === 'sales' ? 'text-emerald-700' : sp === 'customer' ? 'text-neutral-800' : 'text-neutral-500';
  const spkLabel = sp => sp === 'sales' ? '営業' : sp === 'customer' ? 'お客様' : '—';
  const lines = segs.map(s => `<div class="flex gap-2 py-1 border-b border-neutral-100 last:border-0">
    <span class="text-[11px] text-neutral-400 tabular-nums shrink-0 w-10">${clock(s.startSec)}</span>
    <span class="text-[11px] shrink-0 w-12 ${spkClass(s.speaker)}">${spkLabel(s.speaker)}</span>
    <span class="text-[13px] text-neutral-800 leading-relaxed">${(s.text || '').replace(/</g, '&lt;')}</span>
  </div>`).join('') || '<div class="text-sm text-neutral-500">文字起こしがありません。</div>';
  const pv = (rec.pings || []).map(p => `<span class="text-[11px] px-2 py-0.5 rounded-full border mr-1 mb-1 inline-block ${p.result === 'apo' ? 'bg-emerald-600 text-white border-emerald-600' : p.result === 'prospect' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : p.result === 'talk' ? 'bg-neutral-100 text-neutral-600 border-neutral-200' : 'bg-neutral-50 text-neutral-400 border-neutral-200'}">${clock(p.startSec)} ${p.result === 'apo' ? 'アポ' : p.result === 'prospect' ? '見込み' : p.result === 'talk' ? '会話' : '不在/断り'}${p.objectionType ? '・' + p.objectionType : ''}</span>`).join('') || '<span class="text-sm text-neutral-500">—</span>';
  box.innerHTML = card(`<div class="p-5">
    <div class="flex items-center justify-between mb-1 gap-3 flex-wrap">
      <div class="text-sm font-semibold text-neutral-800">${rec.salesRepName || '—'} ・ ${rec.date || ''} の文字起こし</div>
      <button onclick="document.getElementById('logDetail').innerHTML=''" class="text-xs text-neutral-500 hover:text-neutral-800">閉じる ✕</button>
    </div>
    <div class="text-[11px] text-neutral-400 mb-3">出所 ${rec.source === 'plaud' ? 'NotePin' : '音声解析'} ・ 記録 ${(rec.at || '').replace('T', ' ').slice(0, 16)} ・ ${segs.length}発話</div>
    <div class="text-[12px] font-semibold text-neutral-600 mb-1">訪問ごとの判定</div>
    <div class="mb-4">${pv}</div>
    <div class="text-[12px] font-semibold text-neutral-600 mb-1">会話ログ（文字起こし全文）</div>
    <div class="max-h-[420px] overflow-y-auto border border-neutral-200 rounded-lg p-3 bg-white">${lines}</div>
  </div>`);
}
window.openLogItem = openLogItem;

/* ---------- 全営業KPI（cyzen）＋教育セグメント・owner専用 ---------- */
const SEG = {
  S: { label: '良好', cls: 'bg-emerald-600 text-white', desc: '量・質とも基準クリア' },
  A: { label: 'A 活動量不足', cls: 'bg-amber-100 text-amber-700 border border-amber-200', desc: '訪問数が足りない → 行動量の管理' },
  B: { label: 'B 商談化不足', cls: 'bg-rose-100 text-rose-700 border border-rose-200', desc: '訪問はあるがアポ率が低い → 鬼教官でトーク矯正' },
  C: { label: 'C クロージング', cls: 'bg-rose-100 text-rose-700 border border-rose-200', desc: '成約率が低い → クロージング教育' },
  D: { label: 'D 稼働低下', cls: 'bg-neutral-200 text-neutral-700', desc: 'そもそも稼働日数が少ない → 稼働管理' },
  E: { label: 'E 記録なし', cls: 'bg-neutral-100 text-neutral-400 border border-neutral-200', desc: '報告書が無く評価不能 → まず入力の徹底' },
};
function viewCyzen() {
  return `
  ${h1('全営業KPI（cyzen）', 'cyzenの行動データから全営業の「量」を集計し、教育セグメントを自動判定。誰に何を教えるべきかがここで決まる。')}
  <div id="cyzenWrap" class="text-sm text-neutral-500">読み込み中…</div>
  <div id="cyzenUpload" class="mt-6"></div>`;
}
async function loadCyzen() {
  const wrap = document.getElementById('cyzenWrap');
  const up = document.getElementById('cyzenUpload');
  if (up) up.innerHTML = card(`<div class="p-4">
    <div class="text-sm font-semibold text-neutral-700 mb-1">cyzen CSVを取り込む</div>
    <div class="text-[12px] text-neutral-500 mb-3">cyzenの書き出しをそのままアップロード。サーバーの永続領域に保存され、即座に集計へ反映されます。</div>
    <div class="grid sm:grid-cols-3 gap-3">
      ${[['user', 'ユーザーマスター', '担当者の名簿'], ['report', '報告書（複数可）', '出勤/勤務終了/アポ獲得 等'], ['history', '行動履歴', 'GPS打刻（大容量・任意）']]
      .map(([k, t, d]) => `<label class="block border border-dashed border-emerald-400/40 hover:border-emerald-400/70 rounded-lg p-3 text-center cursor-pointer transition">
        <input type="file" accept=".csv" ${k === 'report' ? 'multiple' : ''} class="hidden" onchange="uploadCyzen(this,'${k}')">
        <div class="text-[13px] text-neutral-800">${t}</div><div class="text-[11px] text-neutral-500 mt-0.5">${d}</div></label>`).join('')}
    </div>
    <div id="cyzenUpMsg" class="text-[12px] text-neutral-500 mt-2"></div>
  </div>`);
  if (!wrap) return;
  let data;
  try { data = await API.cyzenRoster(); } catch (e) { wrap.innerHTML = `<div class="text-sm text-rose-600">${e.message}</div>`; return; }
  if (!data.ready || !data.rows.length) {
    wrap.innerHTML = `<div class="text-sm text-neutral-500 p-6 text-center border border-neutral-200 rounded-xl bg-white">cyzenデータが未取り込みです。下の「cyzen CSVを取り込む」からアップロードしてください。</div>`;
    return;
  }
  const s = data.summary, b = data.bench;
  const segCard = k => `<div class="px-4 py-3">
    <div class="text-[11px] text-neutral-500">${SEG[k].label}</div>
    <div class="text-2xl font-semibold tabular-nums ${k === 'S' ? 'text-emerald-600' : k === 'E' ? 'text-neutral-400' : k === 'D' ? 'text-neutral-600' : 'text-rose-600'}">${s[k]}<span class="text-xs text-neutral-400 ml-0.5">名</span></div>
    <div class="text-[11px] text-neutral-500 mt-0.5">${SEG[k].desc}</div></div>`;
  const rows = data.rows.filter(r => r.seg !== 'E').map(r => `<tr class="border-t border-neutral-200 hover:bg-emerald-50/40">
    <td class="px-3 py-2"><span class="text-[11px] px-2 py-0.5 rounded-full ${SEG[r.seg].cls}">${r.seg}</span></td>
    <td class="px-3 py-2 text-neutral-800">${r.name || '—'}</td>
    <td class="px-3 py-2 text-[11px] text-neutral-500">${(r.attr || '').split('/').slice(0, 2).join('/')}</td>
    <td class="px-3 py-2 text-right tabular-nums">${r.days}</td>
    <td class="px-3 py-2 text-right tabular-nums">${r.visits}</td>
    <td class="px-3 py-2 text-right tabular-nums ${r.vpd >= b.visitsPerDay ? 'text-emerald-600' : r.vpd < b.visitsPerDayMin ? 'text-rose-600' : ''}">${r.vpd}</td>
    <td class="px-3 py-2 text-right tabular-nums">${r.apo}</td>
    <td class="px-3 py-2 text-right tabular-nums ${r.apoRate >= b.apoRate ? 'text-emerald-600' : r.apoRate < b.apoRateMin ? 'text-rose-600' : ''}">${r.apoRate}%</td>
    <td class="px-3 py-2 text-right tabular-nums">${r.closeRate == null ? '—' : r.closeRate + '%'}</td>
    <td class="px-3 py-2 text-[11px] text-neutral-600">${r.why}</td>
  </tr>`).join('');
  wrap.innerHTML = `
    ${card(`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-neutral-200">
      ${['S', 'A', 'B', 'C', 'D', 'E'].map(segCard).join('')}
    </div>`)}
    <div class="mt-3 text-[12px] text-neutral-600">対象 ${s.total}名 ・ 期間${s.periodDays}日 ・ <b>評価できたのは ${s.evaluable}名</b>（残り${s.E}名は報告書が無く評価不能）</div>
    ${card(`<div class="p-4 mt-3">
      <div class="text-sm font-semibold text-neutral-700 mb-1">あるべき姿（実データの上位者から導出）</div>
      <div class="text-[13px] text-neutral-700 leading-relaxed">訪問 <b>${b.visitsPerDay}件/日</b>（下限${b.visitsPerDayMin}）・ アポ率 <b>${b.apoRate}%</b>（下限${b.apoRateMin}%）・ 稼働 <b>${b.workHours}h/日</b>・ 成約率 <b>${b.closeRate}%</b>
      <div class="text-[11px] text-neutral-500 mt-1">※ 社内の実在の上位者が到達している水準。理想論ではなく「同じ会社で現に出ている数字」。</div></div>
    </div>`)}
    <div class="mt-4">${card(`<div class="overflow-x-auto"><table class="w-full text-sm min-w-[900px]">
      <thead><tr class="text-xs text-neutral-500 bg-neutral-50">
        <th class="px-3 py-2 text-left font-normal">判定</th><th class="px-3 py-2 text-left font-normal">氏名</th><th class="px-3 py-2 text-left font-normal">属性</th>
        <th class="px-3 py-2 text-right font-normal">稼働日</th><th class="px-3 py-2 text-right font-normal">訪問</th><th class="px-3 py-2 text-right font-normal">訪問/日</th>
        <th class="px-3 py-2 text-right font-normal">アポ</th><th class="px-3 py-2 text-right font-normal">アポ率</th><th class="px-3 py-2 text-right font-normal">成約率</th>
        <th class="px-3 py-2 text-left font-normal">所見</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`)}</div>`;
}
async function uploadCyzen(input, kind) {
  const msg = document.getElementById('cyzenUpMsg');
  const files = Array.from(input.files || []); if (!files.length) return;
  if (msg) { msg.textContent = `アップロード中…（${files.length}件）`; msg.className = 'text-[12px] text-neutral-500 mt-2'; }
  try {
    for (const f of files) await API.cyzenUpload(f, kind);
    if (msg) { msg.textContent = `✓ ${files.length}件を取り込みました。集計を更新します。`; msg.className = 'text-[12px] text-emerald-600 mt-2'; }
    input.value = '';
    setTimeout(loadCyzen, 400);
  } catch (e) { if (msg) { msg.textContent = e.message; msg.className = 'text-[12px] text-rose-600 mt-2'; } }
}
window.uploadCyzen = uploadCyzen;

/* ---------- LINE名寄せ（LINE↔kintone↔鬼教官・owner専用） ---------- */
function viewLinkRep() {
  return `
  ${h1('LINE名寄せ（個別コーチング連携）', 'LINEログインした営業を kintone の営業コードに紐付けると、Rumina bot が本人の最新診断を使って個別にコーチングできます。')}
  ${card(`<div class="p-4 text-[12px] text-neutral-600 leading-relaxed">
    <span class="font-semibold text-neutral-700">仕組み</span>：LINE userId ↔ 営業コード(repId) ↔ 鬼教官の測定データ を1本の線でつなぎます。
    紐付けると、botが「あなたについて教えて？」に対して本人のカルテ（総合再現率・最弱の型・処方）で答えられます。
    <span id="botReadyNote" class="ml-1"></span>
  </div>`)}
  <div id="linkWrap" class="mt-4 text-sm text-neutral-500">読み込み中…</div>`;
}
async function loadLinkRep() {
  const note = document.getElementById('botReadyNote');
  if (note) note.innerHTML = window.__botReady
    ? '<span class="text-emerald-600">bot連携：有効</span>'
    : '<span class="text-amber-600">bot連携：未設定（環境変数 BOT_API_SECRET を設定すると有効）</span>';
  const wrap = document.getElementById('linkWrap'); if (!wrap) return;
  let users = [];
  try { users = await API.getLineUsers(); } catch (e) { wrap.innerHTML = `<div class="text-sm text-rose-600">${e.message}</div>`; return; }
  if (!users.length) { wrap.innerHTML = `<div class="text-sm text-neutral-500 p-6 text-center border border-neutral-200 rounded-xl bg-white">まだLINEでログインした人がいません。スタッフが「LINEでログイン」すると、ここに表示されます。</div>`; return; }
  const mask = id => id ? id.slice(0, 6) + '…' + id.slice(-4) : '—';
  const rows = users.map(u => `<tr class="border-t border-neutral-200">
    <td class="px-3 py-2 text-neutral-800">${u.name}</td>
    <td class="px-3 py-2 text-[11px] text-neutral-400 font-mono">${mask(u.lineId)}</td>
    <td class="px-3 py-2">${u.repId
      ? `<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">紐付け済 ${u.repId}</span>`
      : `<span class="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">未紐付け</span>`}</td>
    <td class="px-3 py-2 text-[11px] ${u.hasLatest ? 'text-emerald-600' : 'text-neutral-400'}">${u.hasLatest ? '測定あり' : '測定なし'}</td>
    <td class="px-3 py-2 whitespace-nowrap">
      <input id="rep-${u.username}" value="${u.repId || ''}" placeholder="営業コード" class="w-28 border border-neutral-300 rounded px-2 py-1 text-sm">
      <button onclick="saveLink('${u.username.replace(/'/g, "\\'")}')" class="ml-1 px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-semibold transition">保存</button>
      <span id="linkmsg-${u.username}" class="ml-2 text-[11px]"></span>
    </td>
  </tr>`).join('');
  wrap.innerHTML = card(`<div class="overflow-x-auto"><table class="w-full text-sm min-w-[720px]">
    <thead><tr class="text-xs text-neutral-500 bg-neutral-50">
      <th class="px-3 py-2 text-left font-normal">氏名（LINE表示名）</th><th class="px-3 py-2 text-left font-normal">LINE ID</th>
      <th class="px-3 py-2 text-left font-normal">紐付け状態</th><th class="px-3 py-2 text-left font-normal">測定</th>
      <th class="px-3 py-2 text-left font-normal">kintone 営業コード</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`);
}
async function saveLink(username) {
  const el = document.getElementById('rep-' + username), msg = document.getElementById('linkmsg-' + username);
  const repId = (el && el.value || '').trim();
  if (!repId) { if (msg) { msg.textContent = 'コードを入力'; msg.className = 'ml-2 text-[11px] text-rose-600'; } return; }
  if (msg) { msg.textContent = '保存中…'; msg.className = 'ml-2 text-[11px] text-neutral-500'; }
  try { await API.linkRep(username, repId); if (msg) { msg.textContent = '✓ 紐付けました'; msg.className = 'ml-2 text-[11px] text-emerald-600'; } setTimeout(loadLinkRep, 600); }
  catch (e) { if (msg) { msg.textContent = e.message; msg.className = 'ml-2 text-[11px] text-rose-600'; } }
}
window.saveLink = saveLink;

const VIEWS = { login: viewLogin, my: viewMy, goal: viewGoal, home: viewHome, upload: viewUpload, analyzing: viewAnalyzing, report: viewReport, submit: viewSubmit, reps: viewReps, issues: viewIssues, admin: viewAdmin, log: viewLog, linkrep: viewLinkRep, cyzen: viewCyzen };
function nav(v) { currentView = v; render(); if (v === 'upload') bindUpload(); if (v === 'log') { loadLog(); loadConsents(); } if (v === 'linkrep') loadLinkRep(); if (v === 'cyzen') loadCyzen(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
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
    info.innerHTML = '<span class="text-neutral-600">取り込み中…</span>';
    try {
      const text = await f.text();
      let payload = text; try { payload = JSON.parse(text); } catch {} // JSONならオブジェクトで、それ以外はテキストで送る
      const rep = await API.importTranscript(payload, { name: f.name.replace(/\.[^.]+$/, ''), gps: selectedGps });
      R.loadAnalysis(rep.analysis);
      window.__mySubmission = { at: new Date().toISOString(), analysis: rep.analysis };
      info.innerHTML = '<span class="text-emerald-600">取り込み完了</span> — レポートを表示します';
      setTimeout(() => nav('report'), 400);
    } catch (err) {
      info.innerHTML = `<span class="text-rose-600">失敗：${err.message}</span>`;
    }
  });

  const badge = document.getElementById('apiBadge');
  const info = await API.health(); window.__whisperReady = info.whisperReady;
  if (badge) badge.innerHTML = info.whisperReady
    ? '<span class="text-emerald-600">● Whisper接続済</span> — 音声アップロードで実解析します'
    : '<span class="text-amber-600">● デモモード</span> — OPENAI_API_KEY 未設定のため、音声アップロードはモック解析（サンプル/Plaud取り込みは動きます）';
}

/* ---------- 解析中ステージ制御 ---------- */
function setStageActive(key, pct) {
  const stg = document.getElementById('stg-' + key); if (!stg) return;
  stg.classList.remove('opacity-40');
  document.getElementById('stg-ic-' + key).className = 'w-6 h-6 rounded-full border border-emerald-400/50 flex items-center justify-center text-emerald-600 text-xs';
  document.getElementById('stg-bar-' + key).style.width = pct + '%';
  document.getElementById('stg-pct-' + key).textContent = Math.round(pct) + '%';
}
function setStageDone(key) {
  const ic = document.getElementById('stg-ic-' + key); if (!ic) return;
  document.getElementById('stg-' + key).classList.remove('opacity-40');
  document.getElementById('stg-bar-' + key).style.width = '100%';
  ic.className = 'w-6 h-6 rounded-full border border-emerald-400/50 flex items-center justify-center text-emerald-600 text-xs'; ic.textContent = '✓';
  const p = document.getElementById('stg-pct-' + key); p.textContent = '100%'; p.className = 'text-xs tabular-nums text-emerald-600';
}
function driveStages(stageKey, progress) {
  const order = R.ANALYZE_STAGES.map(s => s.key), idx = order.indexOf(stageKey);
  order.forEach((k, i) => { if (i < idx) setStageDone(k); else if (i === idx) setStageActive(k, (k === 'transcribe' && progress && progress.total) ? Math.round(progress.done / progress.total * 100) : 55); });
  const ci = document.getElementById('chunkInfo');
  if (ci && stageKey === 'transcribe' && progress && progress.total) ci.textContent = `${progress.done}/${progress.total} チャンク処理済み`;
}
function analyzeError(msg) {
  const ci = document.getElementById('chunkInfo');
  if (ci) ci.innerHTML = `<span class="text-rose-600">解析に失敗しました：${msg}</span> <button onclick="nav('upload')" class="text-emerald-600 underline ml-1">戻る</button>`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 解析の入口 ---------- */
async function startAnalyze() {
  nav('analyzing');
  if (window.__whisperReady && selectedFile) {
    try { await realAnalyze(selectedFile); }
    catch (e) { if (/同意/.test(e.message)) { window.__consent = { ok: false }; nav('upload'); return; } analyzeError(e.message); }
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
  window.__lastSessionId = rep.sessionId || sessionId;
  window.__mySubmission = { at: new Date().toISOString(), analysis: rep.analysis };
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
  if (info) info.innerHTML = '<span class="text-neutral-600">サンプルを取り込み中…</span>';
  try {
    const [sample, gps] = await Promise.all([
      fetch('/samples/plaud-fullday.json').then(r => r.json()),
      fetch('/samples/plaud-fullday-gps.json').then(r => r.json()).catch(() => null),
    ]);
    const rep = await API.importTranscript(sample, { name: '田中 翔（サンプル）', gps });
    R.loadAnalysis(rep.analysis);
    window.__lastSessionId = rep.sessionId || null;
    window.__mySubmission = { at: new Date().toISOString(), analysis: rep.analysis };
    if (info) info.innerHTML = '<span class="text-emerald-600">取り込み完了</span>';
    setTimeout(() => nav('report'), 300);
  } catch (e) {
    if (/同意/.test(e.message)) { window.__consent = { ok: false }; nav('upload'); return; }
    if (info) info.innerHTML = `<span class="text-rose-600">失敗：${e.message}</span>`;
  }
}
window.trySample = trySample;

/* ============================================================
   ログイン / マイページ / モデル乖離
   ============================================================ */
function viewLogin() {
  return `<div class="min-h-[72vh] flex items-center justify-center">
    <div class="w-full max-w-sm">
      <div class="text-center mb-6">
        <img src="/assets/rumina.png" alt="Dr.Rumina" class="w-24 h-24 rounded-full object-cover object-top mx-auto mb-3 border border-emerald-200 shadow-sm">
        <div class="text-lg font-semibold text-neutral-900">Rumina 鬼教官</div><div class="text-xs text-emerald-600">マイページにログイン</div></div>
      ${card(`<div class="p-6 space-y-3">
        ${window.__lineReady ? `
        <a href="/api/line/login" class="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-white text-sm font-semibold transition" style="background:#06C755">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.5 2 2 5.7 2 10.2c0 4 3.6 7.4 8.5 8 .3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 6-3.5 8.2-6C21.6 13.9 22 12.1 22 10.2 22 5.7 17.5 2 12 2z"/></svg>
          LINEでログイン
        </a>
        <div class="flex items-center gap-3 py-1"><div class="flex-1 h-px bg-neutral-200"></div><span class="text-[11px] text-neutral-400">または</span><div class="flex-1 h-px bg-neutral-200"></div></div>` : ''}
        <label class="block"><div class="text-xs text-neutral-500 mb-1">ユーザー名（名前）</div><input id="loginUser" class="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" placeholder="例：田中 翔"></label>
        <label class="block"><div class="text-xs text-neutral-500 mb-1">パスワード</div><input id="loginPw" type="password" class="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm" onkeydown="if(event.key==='Enter')doLogin()"></label>
        <button onclick="doLogin()" class="w-full py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">ログイン</button>
        <div id="loginErr" class="text-xs text-rose-600"></div>
      </div>`)}
      <p class="text-[11px] text-neutral-400 text-center mt-3">${window.__lineReady ? 'LINEでログインすると自動でアカウントが作成されます。' : 'アカウントは管理者が発行します。'}</p>
      ${new URLSearchParams(location.search).has('lineerror') ? '<p class="text-[11px] text-rose-600 text-center mt-1">LINEログインに失敗しました。もう一度お試しください。</p>' : ''}
    </div></div>`;
}
async function doLogin() {
  const u = document.getElementById('loginUser').value, p = document.getElementById('loginPw').value;
  const err = document.getElementById('loginErr'); if (err) err.textContent = '';
  try { await API.login(u, p); await boot(); } catch (e) { if (err) err.textContent = e.message; }
}
async function doLogout() { await API.logout(); window.__user = null; window.__mySubmission = null; await boot(); }

// モデル（川上）との乖離を算出
function modelDeviation(a) {
  const b = R.TOP_BENCHMARK, g = R.computeGap(a, b);
  const items = [
    { k: '冒頭質問率', me: a.openingQuestionRate, top: b.openingQuestionRate, d: g.openingQuestionRate, u: '%' },
    { k: '切り返し', me: a.averageRebuttalCount, top: b.averageRebuttalCount, d: g.averageRebuttalCount, u: '回' },
    { k: '会話時間', me: a.averageConversationSeconds, top: b.averageConversationSeconds, d: g.averageConversationSeconds, u: '秒' },
    { k: '在宅反応率', me: a.homeResponseRate, top: b.homeResponseRate, d: g.homeResponseRate, u: '%' },
    { k: '行動量', me: a.totalPings, top: b.targetPings, d: g.pings, u: '件' },
    { k: 'アポ率', me: a.appointmentRate, top: b.appointmentRate, d: g.appointmentRate, u: '%' },
  ];
  const behind = items.filter(x => x.d < 0).sort((x, y) => (x.d / Math.max(1, x.top)) - (y.d / Math.max(1, y.top)));
  return { items, behind };
}
function deviateNarrate(a) {
  const { behind } = modelDeviation(a), out = [];
  if (!behind.length) { out.push({ tone: 'good', title: '結論', text: 'モデル（川上）とほぼ同じ型で動けている。この水準を維持しろ。' }); return out; }
  const t = behind[0], s = behind[1];
  out.push({ tone: 'harsh', title: '結論', text: `君はモデル（川上）と${behind.length}項目で乖離している。最大は「${t.k}」——君${t.me}${t.u}に対し川上は${t.top}${t.u}。ここが全ての起点だ。` });
  if (s) out.push({ tone: 'warn', title: '次の乖離', text: `次が「${s.k}」（君${s.me}${s.u} / 川上${s.top}${s.u}）。ここも川上との差が大きい。` });
  out.push({ tone: 'close', title: 'やること', text: `全部を一度に真似るな。まず「${t.k}」だけを川上の水準に寄せろ。1項目でいい。それが最短で差を詰める。` });
  return out;
}
function deviationSection(a) {
  const { items } = modelDeviation(a);
  const rows = items.map(x => {
    const neg = x.d < 0, w = Math.min(Math.abs(x.d) / (Math.abs(x.d) + Math.abs(x.top) * 0.5) * 100, 100);
    return `<div class="flex items-center gap-3 py-1.5">
      <div class="w-20 text-xs text-neutral-600 shrink-0">${x.k}</div>
      <div class="flex-1 text-xs text-neutral-500 tabular-nums">君 ${x.me}${x.u} / 川上 ${x.top}${x.u}</div>
      <div class="flex-1 h-1.5 rounded-full bg-neutral-200 overflow-hidden"><div class="h-full ${neg ? 'bg-rose-500/70' : 'bg-emerald-500/70'}" style="width:${w}%"></div></div>
      <div class="w-16 text-right text-xs tabular-nums ${neg ? 'text-rose-600' : 'text-emerald-600'}">${neg ? '' : '+'}${x.d}${x.u}</div>
    </div>`;
  }).join('');
  const border = { harsh: 'border-rose-400/60', good: 'border-emerald-400/60', warn: 'border-amber-400/60', close: 'border-neutral-400' };
  const blocks = deviateNarrate(a).map(x => `<div class="border-l-2 ${border[x.tone]} pl-3"><div class="text-xs text-neutral-500 mb-0.5">${x.title}</div><p class="text-[14px] leading-relaxed text-neutral-800">${x.text}</p></div>`).join('');
  return section('モデル（川上）との乖離', card(`<div class="p-5 space-y-1 border-b border-neutral-200">${rows}</div><div class="p-5 space-y-3">${blocks}</div>`), 'モデル営業マン＝川上のKPIを基準に、どこがどれだけ離れているかをAIが言語化。');
}

function viewMy() {
  const u = window.__user || { name: '' };
  const sub = window.__mySubmission;
  if (!sub || !sub.analysis) {
    return `${h1('マイページ', `${u.name} さん`)}
      ${card(`<div class="p-8 text-center"><div class="text-sm text-neutral-700 mb-3">まだ今日の録音がありません。</div>
        <button onclick="nav('upload')" class="px-5 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">稼働終了・録音を出稿する</button></div>`)}`;
  }
  const a = sub.analysis; R.loadAnalysis(a);
  return `
  <div class="flex items-end justify-between mb-6">
    <div><div class="text-xs text-neutral-500">マイページ ・ 直近の稼働（${(sub.at || '').slice(0, 10)}）</div><h1 class="text-xl font-semibold text-neutral-900 mt-0.5">${u.name} さん</h1></div>
    <div class="text-right"><div class="text-xs text-neutral-500">鬼教官スコア</div><div class="text-2xl font-semibold text-emerald-600 tabular-nums">${a.coachScore}<span class="text-sm text-neutral-500">/100</span></div></div>
  </div>
  ${card(`<div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-neutral-200">
    ${statCell('総ピンポン', a.totalPings, '件', `達成 ${a.targetAchievementRate}%`)}
    ${statCell('在宅反応', a.homeResponseCount, '件', `${a.homeResponseRate}%`)}
    ${statCell('アポ', a.appointmentCount, '件', `${a.appointmentRate}%`)}
    ${statCell('サボり', a.suspiciousIdleTimeMinutes, '分', a.gps?.connected ? 'GPS確定' : '')}
  </div>`)}
  ${deviationSection(a)}
  ${coachPanel()}
  <div class="mt-8 flex flex-wrap gap-3">
    <button onclick="nav('upload')" class="px-5 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition">新しい録音を出稿</button>
    <button onclick="nav('report')" class="px-5 py-2.5 rounded-md border border-neutral-300 text-sm text-neutral-700 hover:bg-neutral-100 transition">詳しい分析レポート</button>
  </div>`;
}

async function issueRep(i) {
  const r = R.SALES_REPS[i], box = document.getElementById('issueResult');
  try {
    const res = await API.issueAccount(r.name, r.id);
    if (box) box.innerHTML = `<div class="border border-emerald-400/50 bg-emerald-50 rounded-md px-4 py-3 text-sm text-neutral-800">「${res.username}」のログインを発行しました ―― ユーザー名：<b>${res.username}</b>／初期パスワード：<b class="tabular-nums">${res.password}</b><div class="text-xs text-neutral-500 mt-1">この初期パスワードは一度だけ表示。本人に伝えてください。</div></div>`;
  } catch (e) { if (box) box.innerHTML = `<div class="text-sm text-rose-600">発行失敗：${e.message}</div>`; }
}

/* ---------- 認証ゲート / ロール ---------- */
function applyRole(user) {
  const owner = !!(user && user.role === 'owner');
  document.querySelectorAll('[data-owner]').forEach(el => { el.style.display = owner ? '' : 'none'; });
  const badge = document.getElementById('userBadge');
  if (badge) badge.innerHTML = user ? `<div class="text-xs text-neutral-700 font-medium">${user.name}</div><div class="text-[10px] text-neutral-400 mb-1">${owner ? '管理者（モデル）' : '営業'}</div><button onclick="doLogout()" class="text-[11px] text-neutral-500 hover:text-neutral-800 underline">ログアウト</button>` : '';
}
async function boot() {
  const { user } = await API.me(); window.__user = user;
  try { const h = await API.health(); window.__lineReady = !!h.lineLoginReady; window.__audioPurge = !!h.audioPurge; window.__consentVersion = h.consentVersion || ''; window.__botReady = !!h.botApiReady; }
  catch { window.__lineReady = false; window.__audioPurge = false; window.__botReady = false; }
  try { window.__model = await API.getModel(); } catch { window.__model = null; }
  try { window.__consent = user ? await API.getConsent() : { ok: false }; } catch { window.__consent = { ok: false }; }
  document.body.classList.toggle('logged-out', !user);
  applyRole(user);
  if (!user) { currentView = 'login'; render(); return; }
  if (user.role !== 'owner') { const { submission } = await API.myLatest(); window.__mySubmission = submission; }
  if (!['home', 'my', 'goal', 'upload', 'report', 'submit', 'issues', 'reps', 'admin', 'log', 'linkrep', 'cyzen'].includes(currentView) || currentView === 'login') currentView = user.role === 'owner' ? 'home' : 'my';
  render();
}
window.doLogin = doLogin; window.doLogout = doLogout; window.issueRep = issueRep;
window.nav = nav; window.startAnalyze = startAnalyze;
boot();
