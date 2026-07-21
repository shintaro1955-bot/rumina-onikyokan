/* ============================================================
 * roleplay.js — 鬼教官「ロープレモード」
 *   人間ペアのロープレを録音→事後採点（入口3局面・チェック①〜⑦）。
 *   採点は決定論のキーワード辞書（LLMに点数を委ねない＝正直表示の一線）。
 *   現場提出（submissions）とは別物として扱い、ローカルに履歴保存。
 * ============================================================ */
(function () {
  // ---- チェック①〜⑦（武装トークの入口3局面）----
  const CHECKS = [
    { id: 1, req: true, t: '名乗り3点（社名・目的・商材）を名乗った', theme: '冒頭60秒で「フィットファウンダーの◯◯です／省エネ設備のご提案で／お伺いしました」を固定文言で。',
      top: 'こんにちは。フィットファウンダーの田中と申します。太陽光や蓄電池など省エネ設備のご提案でお伺いしております。',
      test: s => /(フィットファウンダー|fit ?founder|ファウンダー)/i.test(s) && /(ご提案|ご案内|お伺い|伺っ|参りました)/.test(s) && /(太陽光|蓄電池|省エネ|オール電化|給湯)/.test(s) },
    { id: 2, req: false, t: '工事マップで地域の施工実績を提示した', theme: '「この5km圏内だけで◯件」など、地域実績を数字で先出しする。',
      top: '実はこの地域で施工させていただいたお宅が多く、この近くだけで◯件の実績がございます。',
      test: s => /(施工実績|この地域|この辺|近く|圏内|\d+\s*件|マップ|工事の実績|実績が)/.test(s) },
    { id: 3, req: false, t: '診断への橋渡しをした（玄関で商品を売り込んでいない）', theme: '商品説明ではなく「その場で無料の電気健康診断ができる」で入る。',
      top: '今日は売り込みではなく、今の電気代が適正か、その場で無料の健康診断ができるのでそのご案内です。',
      test: s => /(健康診断|電気代|診断|無料で|その場で|適正)/.test(s) },
    { id: 4, req: false, t: '協会パンフで加盟の事実を提示した', theme: '「一般社団法人◯◯協会に加盟しており」と加盟の事実をパンフで見せる。',
      top: '当社は一般社団法人の助成金支援協会に加盟しておりまして、補助金を活用したご提案を専門にしています。',
      test: s => /(協会|一般社団法人|加盟|補助金|助成金)/.test(s) },
    { id: 5, req: false, t: '「国の機関ではない」を自分から言えた', theme: '誤認を自分から訂正。「国の機関ではなく、当社はその加盟事業者です」。',
      top: '補助金の活用を支援する一般社団法人で、国の機関ではありません。当社はその加盟事業者です。',
      test: s => /(国の機関|行政|公的機関|自治体|役所).{0,8}(では|じゃ).{0,4}(ない|ありませ)/.test(s) },
    { id: 6, req: false, t: '診断アプリでお客様の数字を画面で見せた', theme: '画面を相手に向け、「◯◯様のお宅は平均より高め」をお客様に言わせる。',
      top: 'こちらの画面をご覧ください。同じ地域の平均と比べると、この項目が高めに出ています。',
      test: s => /(アプリ|画面|ご覧|こちらを見|診断結果|グラフ|数字|平均と比)/.test(s) },
    { id: 7, req: false, t: '明細なしでもAI推定に切り替えて診断を続けた', theme: '「検針票がなくても、人数と使い方でAIが推定できます（推定値ですが傾向はわかります）」。',
      top: '検針票がなくても大丈夫です。ご家族の人数と使い方から、AIが推定でお出しできます。',
      test: s => /(推定|検針票がなく|明細がなく|なくても大丈夫|概算)/.test(s) },
  ];
  const RAIL = [
    { ph: '① 玄関', time: '0-60秒', say: '「フィットファウンダーの◯◯と申します。太陽光や蓄電池など省エネ設備のご提案でお伺いしております。」', weapon: '工事案件マップ', ng: '「調査です」「点検で回っています」等の目的隠し／協会名だけの名乗り' },
    { ph: '② 着座', time: '1-3分', say: '「一般社団法人の協会に加盟しておりまして、補助金を活用したご提案を専門にしています。国の機関ではなく、当社はその加盟事業者です。」', weapon: '協会加盟パンフ', ng: '「協会から来ました」／公的機関と誤認させる説明' },
    { ph: '③ 診断', time: '3-10分', say: '「今の電気代が適正か、その場で無料の健康診断ができます。検針票がなくてもAIが推定できます。」', weapon: '電気健康診断アプリ', ng: '診断結果が出る前に商品説明を始める' },
  ];
  const SCENARIOS = {
    '警戒': ['「間に合ってます」と即断りから入る', '「どちら様？」と身分を確認してくる'],
    '多忙': ['「今忙しいので手短に」と急かす', 'ドアを半分だけ開けて対応'],
    '価格重視': ['「で、いくらなの？」とすぐ価格を聞く', '「他社の方が安かった」と比較を出す'],
  };
  const SAMPLE = `営業: こんにちは。フィットファウンダーの田中と申します。太陽光や蓄電池など、省エネ設備のご提案でお伺いしております。
客: あー、間に合ってます。
営業: 実はこちらの地域で施工させていただいたお宅が多くございまして、この近くだけで38件の実績がございます。
客: へえ、そうなんだ。
営業: 今日は売り込みではなく、今の電気代が適正かどうか、その場で無料の健康診断ができるのでそのご案内です。2〜3分で結果が出ます。
客: 診断だけ？
営業: はい。当社は一般社団法人の助成金支援協会に加盟しておりまして、補助金を活用したご提案を専門にしています。こちらがそのご案内です。
客: 協会って国の関係？
営業: 補助金の活用を支援する団体ですね。えー、まあそういう感じです。
営業: それでは診断ですね。検針票かお手元のアプリの明細はございますか。こちらの画面をご覧ください、同じ地域の平均と比べるとこの項目が高めに出ています。
客: 明細は今ちょっと無いなあ。
営業: そうですか…。では、また改めてお持ちしますね。`;

  // ---- 採点（決定論）----
  function salesText(t) { const ls = t.split(/\n+/); const s = ls.filter(l => /^\s*(営業|営|S\d|SALES)/i.test(l)); return s.length ? s.join('\n') : t; }
  function firstDiagIdx(s) { const m = s.search(/(健康診断|電気代|診断|その場で)/); return m < 0 ? Infinity : m; }
  // 逆指標＝診断前の「売り込み」。名乗りの商材告知（①で必須）は含めない。
  function firstProductIdx(s) { const m = s.search(/(設置し|工事費|お見積|載せ|おすすめ|導入しま|何kw|\dkwh|価格は|お安く|パネルを付|ご契約|月々)/i); return m < 0 ? Infinity : m; }
  function score(transcript) {
    const s = salesText(transcript);
    const items = CHECKS.map(c => ({ ...c, ok: c.test(s) }));
    const productBeforeDiag = firstProductIdx(s) < firstDiagIdx(s);
    const met = items.filter(i => i.ok).length;
    const reqOk = items.find(i => i.id === 1).ok;
    const pass = reqOk && met >= 6 && !productBeforeDiag; // 全10で8/10=80%に比例（入口7→6）
    const kpis = [
      { k: '名乗り3点', on: items[0].ok }, { k: 'マップ言及', on: items[1].ok },
      { k: '協会・補助金', on: items[3].ok }, { k: 'アプリ提示', on: items[5].ok },
      { k: '診断前の商品言及（逆指標）', on: !productBeforeDiag },
    ];
    return { items, met, total: CHECKS.length, reqOk, pass, productBeforeDiag, kpis };
  }
  function coach(r) {
    if (r.pass) { const nx = r.items.find(i => !i.ok); return 'いい入りだ。名乗り3点・診断ファーストは合格ラインを越えている。' + (nx ? '次は「' + nx.t.replace(/（.*/, '') + '」を1つ足せ。' : 'この型を現場で崩すな。'); }
    if (!r.reqOk) return '不合格。名乗り3点（社名・目的・商材）が欠けている。ここは自由演技禁止だ。固定文言を暗記して、明日はまずそこだけ完璧にしろ。';
    if (r.productBeforeDiag) return '診断より先に商品名を出した瞬間、売り込みになる。武器が全部効かなくなる。診断が終わるまで商品の話をするな。';
    return '入口で武器を出し切れていない。落ちた項目は下の「明日のテーマ」だけやればいい。全部やり直す必要はない。';
  }

  // ---- 状態・履歴 ----
  const KEY = 'onikyokan_roleplay_v1';
  const S = { step: 'setup', rep: '', partner: '', ctype: '警戒', transcript: '', result: null, recSec: 0, timer: null };
  function hist() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }

  // ---- 部品（Tailwind・鬼教官native）----
  const btnP = 'px-5 py-3 rounded-lg bg-emerald-600 text-white font-semibold text-sm';
  const btnG = 'px-5 py-3 rounded-lg bg-white border border-neutral-200 text-emerald-700 font-semibold text-sm';
  const railHtml = () => RAIL.map(r => `<div class="border border-[#E8EFEA] rounded-xl overflow-hidden mb-2.5">
      <div class="flex justify-between bg-emerald-50 text-emerald-800 text-[13px] font-semibold px-3 py-2"><span>${r.ph}</span><span>${r.time}</span></div>
      <div class="px-3 py-2.5 text-[12.5px]"><div>${r.say}</div><div class="text-neutral-500 mt-1">武器：${r.weapon}</div><div class="text-rose-600 mt-1">NG：${r.ng}</div></div>
    </div>`).join('');

  function viewSetup() {
    return `<div class="max-w-[860px] mx-auto">
      <h1 class="text-xl font-bold mb-1">ロープレ練習を始める</h1>
      <p class="text-neutral-500 text-[13px] mb-5">相手役（お客様役）とのロープレを録音し、入口3局面（玄関〜診断）を採点します。対象：C量産型の主対象／タブレット。</p>
      <div class="flex gap-2 mb-4 text-[13px]">
        <button onclick="RP.tab('setup')" class="px-3 py-1.5 rounded-lg ${S.step !== 'history' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-neutral-500'}">練習</button>
        <button onclick="RP.tab('history')" class="px-3 py-1.5 rounded-lg ${S.step === 'history' ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-neutral-500'}">履歴・伸び</button>
      </div>
      ${card(`<div class="p-5">
        <div class="mb-3.5"><label class="block text-[12.5px] font-semibold text-neutral-600 mb-1.5">練習する営業マン</label><input id="rp_rep" oninput="RP.set('rep',this.value)" value="${S.rep}" placeholder="氏名" class="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"></div>
        <div class="mb-3.5"><label class="block text-[12.5px] font-semibold text-neutral-600 mb-1.5">お客様役（相手）</label><input id="rp_pt" oninput="RP.set('partner',this.value)" value="${S.partner}" placeholder="同僚・講師の氏名" class="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm"></div>
        <div class="mb-3.5"><label class="block text-[12.5px] font-semibold text-neutral-600 mb-1.5">お客様タイプ（難易度の目安）</label>
          <div class="flex gap-2 flex-wrap">${Object.keys(SCENARIOS).map(t => `<button onclick="RP.setType('${t}')" class="px-3.5 py-2 rounded-full text-[13px] border ${S.ctype === t ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-neutral-200'}">${t}</button>`).join('')}</div></div>
        <div class="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[12.5px] text-neutral-700"><span class="font-semibold text-amber-700">お客様役へのシナリオカード</span><br>${SCENARIOS[S.ctype].map(x => '・' + x).join('<br>')}</div>
        <div class="flex justify-end mt-4"><button onclick="RP.start()" class="${btnP}">録音してロープレ開始</button></div>
      </div>`)}
      <div class="mt-4">${card(`<div class="p-5"><div class="text-sm font-semibold mb-3">この局面で出す武器（台本レール）</div>${railHtml()}</div>`)}</div>
    </div>`;
  }
  function viewRec() {
    return `<div class="max-w-[860px] mx-auto">
      <h1 class="text-xl font-bold mb-1">ロープレ録音中</h1>
      <p class="text-neutral-500 text-[13px] mb-4">${S.rep || '—'} × ${S.partner || 'お客様役'}（${S.ctype}）／台本レールを見ながら進めてください。</p>
      <div class="flex items-center gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-3 mb-4">
        <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse"></span><span class="text-rose-700 text-sm">録音中</span>
        <span class="flex-1"></span><span id="rp_timer" class="font-bold tabular-nums">00:00</span></div>
      ${railHtml()}
      <div class="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[12.5px] text-neutral-700 mb-4"><span class="font-semibold text-amber-700">お客様役</span>：${SCENARIOS[S.ctype].join(' ／ ')}</div>
      ${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">ロープレを終了して採点</div>
        <p class="text-neutral-500 text-[12.5px] mb-3">※ 本番は録音を自動で文字起こし（鬼教官のWhisper）します。このプロトタイプ段階では、停止後に「サンプルで採点」または文字起こしの貼り付けで採点できます。</p>
        <div class="flex justify-between gap-3"><button onclick="RP.tab('setup')" class="${btnG}">戻る</button><button onclick="RP.stop()" class="px-5 py-3 rounded-lg bg-rose-600 text-white font-semibold text-sm">■ 停止して採点へ</button></div>
        <div id="rp_after"></div>
      </div>`)}
    </div>`;
  }
  function viewResult() {
    const r = S.result, pass = r.pass;
    return `<div class="max-w-[860px] mx-auto">
      <h1 class="text-xl font-bold mb-1">採点結果</h1>
      <p class="text-neutral-500 text-[13px] mb-4">${S.rep || '—'} × ${S.partner || 'お客様役'}（${S.ctype}） <span class="text-[10.5px] bg-indigo-50 text-indigo-800 rounded px-1.5 py-0.5">ロープレ（現場ではない）</span></p>
      <div class="rounded-2xl px-4 py-4 mb-4 font-bold ${pass ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-700'}">
        <span class="text-[11px] tracking-wide opacity-80 block">入口3局面 判定</span><span class="text-xl">${pass ? '合格' : 'もう一歩（不合格）'}</span></div>
      ${card(`<div class="p-5"><div class="flex items-baseline gap-2.5"><span class="text-3xl font-extrabold text-emerald-600">${r.met}/${r.total}</span><span class="text-neutral-500 text-[13px]">アセット提示（①必須／6つ以上で合格）</span></div>
        <div class="flex gap-2 flex-wrap mt-2.5">${r.kpis.map(k => `<span class="text-[11.5px] rounded-full px-2.5 py-1 border ${k.on ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}">${k.k} ${k.on ? '○' : '×'}</span>`).join('')}</div></div>`)}
      <div class="bg-neutral-900 text-neutral-100 rounded-xl px-4 py-3.5 text-[13.5px] my-4"><span class="font-semibold text-emerald-300">鬼教官</span>　${coach(r)}</div>
      ${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">チェック（①〜⑦）</div>
        ${r.items.map(i => `<div class="flex gap-2.5 py-2.5 border-b border-[#EEF3F0] last:border-0 text-[13.5px]"><div class="w-6 text-center font-extrabold ${i.ok ? 'text-emerald-600' : 'text-rose-600'}">${i.ok ? '✓' : '✕'}</div>
          <div><div class="font-semibold">${i.id}. ${i.t}${i.req ? '<span class="text-[10.5px] text-rose-600 border border-rose-200 rounded px-1.5 ml-1.5">必須</span>' : ''}</div>
          <div class="text-neutral-500 text-[12px] mt-0.5">${i.ok ? 'トップ例：' + i.top : 'できていない'}</div></div></div>`).join('')}
        ${r.productBeforeDiag ? `<div class="flex gap-2.5 py-2.5 text-[13.5px]"><div class="w-6 text-center font-extrabold text-rose-600">✕</div><div><div class="font-semibold">逆指標：診断より前に商品名を出した</div><div class="text-neutral-500 text-[12px] mt-0.5">診断が終わるまで商品の話をしない</div></div></div>` : ''}</div>`)}
      ${r.items.filter(i => !i.ok).length ? `<div class="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[13px] my-3 text-neutral-700"><span class="font-semibold text-amber-700">明日のテーマ（落ちた項目だけ）</span><br>${r.items.filter(i => !i.ok).map(i => '・' + i.theme).join('<br>')}</div>` : ''}
      <div class="mt-3">${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">文字起こし</div><div class="bg-[#FBFDFC] border border-[#E8EFEA] rounded-xl p-3 text-[12.5px] max-h-56 overflow-auto whitespace-pre-wrap">${S.transcript.replace(/</g, '&lt;')}</div></div>`)}</div>
      <div class="flex justify-between gap-3 mt-4"><button onclick="RP.tab('setup')" class="${btnG}">もう一度練習</button><button onclick="RP.save()" class="${btnP}">記録して履歴へ</button></div>
    </div>`;
  }
  function viewHistory() {
    const h = hist();
    if (!h.length) return `<div class="max-w-[860px] mx-auto"><h1 class="text-xl font-bold mb-1">履歴・伸び</h1><p class="text-neutral-500 text-[13px]">まだ記録がありません。ロープレを採点して「記録して履歴へ」を押すと溜まります。</p><div class="mt-3"><button onclick="RP.tab('setup')" class="${btnG}">練習に戻る</button></div></div>`;
    const w = 760, ht = 120, pad = 24, xs = i => pad + i * ((w - pad * 2) / Math.max(1, h.length - 1)), ys = v => ht - pad - (v / 7) * (ht - pad * 2);
    const pts = h.map((r, i) => `${xs(i)},${ys(r.met)}`).join(' ');
    return `<div class="max-w-[860px] mx-auto"><h1 class="text-xl font-bold mb-1">履歴・伸び</h1>
      <p class="text-neutral-500 text-[13px] mb-4">アセット提示（0〜7）の推移。ロープレ室の物差しは現場（鬼教官）と同じです。</p>
      ${card(`<div class="p-5"><svg viewBox="0 0 ${w} ${ht}" width="100%">
        <line x1="${pad}" y1="${ys(6)}" x2="${w - pad}" y2="${ys(6)}" stroke="#cfe3d6" stroke-dasharray="4 4"/>
        <polyline points="${pts}" fill="none" stroke="#16A34A" stroke-width="2.5"/>
        ${h.map((r, i) => `<circle cx="${xs(i)}" cy="${ys(r.met)}" r="4" fill="${r.pass ? '#16A34A' : '#a66b25'}"/>`).join('')}
        <text x="${pad}" y="${ys(6) - 6}" font-size="10" fill="#525252">合格ライン 6</text></svg></div>`)}
      <div class="mt-3">${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">記録</div>${h.slice().reverse().map(r => `<div class="flex items-center gap-3 py-2.5 border-b border-[#EEF3F0] last:border-0 text-[13px]"><span class="font-extrabold text-emerald-600 w-12">${r.met}/7</span><span class="flex-1">${r.rep || '—'} × ${r.partner || '—'}（${r.ctype}）</span><span class="text-neutral-500">${r.pass ? '合格' : '不合格'}</span></div>`).join('')}</div>`)}</div>
      <div class="mt-3"><button onclick="RP.tab('setup')" class="${btnG}">練習に戻る</button></div></div>`;
  }

  // ---- ビュー本体（鬼教官の VIEWS.roleplay から呼ばれる）----
  window.viewRoleplay = function () {
    if (S.step === 'history') return viewHistory();
    if (S.step === 'rec') return viewRec();
    if (S.step === 'result') return viewResult();
    return viewSetup();
  };

  // ---- 録音（MediaRecorderがあれば実録音・無ければ計測のみ）----
  let mediaRec = null, chunks = [];
  window.RP = {
    set(k, v) { S[k] = v; },
    setType(t) { S.ctype = t; render(); },
    tab(step) { S.step = step === 'history' ? 'history' : 'setup'; render(); window.scrollTo(0, 0); },
    start() {
      S.step = 'rec'; S.recSec = 0; render(); window.scrollTo(0, 0);
      S.timer = setInterval(() => { S.recSec++; const m = String(Math.floor(S.recSec / 60)).padStart(2, '0'), s = String(S.recSec % 60).padStart(2, '0'); const t = document.getElementById('rp_timer'); if (t) t.textContent = `${m}:${s}`; }, 1000);
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(st => { try { mediaRec = new MediaRecorder(st); chunks = []; mediaRec.ondataavailable = e => chunks.push(e.data); mediaRec.start(); } catch (e) {} }).catch(() => {});
      }
    },
    stop() {
      if (S.timer) { clearInterval(S.timer); S.timer = null; }
      try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (e) {}
      const after = document.getElementById('rp_after');
      if (after) after.innerHTML = `<div class="mt-4 pt-4 border-t border-[#E8EFEA]"><div class="text-sm font-semibold mb-2">文字起こしを採点</div>
        <p class="text-neutral-500 text-[12.5px] mb-2">本番は録音を自動で文字起こしします。ここではサンプル、または実際の文字起こしを貼り付けて採点します（「営業:」「客:」で話者を分けると精度が上がります）。</p>
        <textarea id="rp_tr" placeholder="ここに文字起こしを貼り付け" class="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm min-h-[120px]"></textarea>
        <div class="flex gap-2.5 mt-2.5"><button onclick="RP.scoreSample()" class="${btnG}">サンプルで採点</button><button onclick="RP.scorePaste()" class="${btnP}">この文字起こしで採点</button></div></div>`;
      after && after.scrollIntoView({ behavior: 'smooth' });
    },
    scoreSample() { S.transcript = SAMPLE; S.result = score(SAMPLE); S.step = 'result'; render(); window.scrollTo(0, 0); },
    scorePaste() { const el = document.getElementById('rp_tr'); const t = (el && el.value.trim()) || SAMPLE; S.transcript = t; S.result = score(t); S.step = 'result'; render(); window.scrollTo(0, 0); },
    save() { const h = hist(); h.push({ rep: S.rep, partner: S.partner, ctype: S.ctype, met: S.result.met, pass: S.result.pass }); localStorage.setItem(KEY, JSON.stringify(h)); S.step = 'history'; render(); window.scrollTo(0, 0); },
    reset() { S.step = 'setup'; },
    _score: score, // テスト用
  };
})();
