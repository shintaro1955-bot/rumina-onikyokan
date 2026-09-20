/* ============================================================
 * roleplay.js — 鬼教官「ロープレモード」
 *   人間ペアのロープレを録音→事後採点（入口3局面・チェック①〜⑦）。
 *   採点は決定論のキーワード辞書（LLMに点数を委ねない＝正直表示の一線）。
 *   現場提出（submissions）とは別物として扱い、ローカルに履歴保存。
 * ============================================================ */
(function () {
  // ---- チェック①〜⑥（八賀式トークロジック＝基本トークフロー）----
  const CHECKS = [
    { id: 1, req: true, phase: '冒頭フック', t: '冒頭フック：10秒で電気代/無料診断/明細を刺して質問した', theme: '名乗りで終わらせない。「電気の健康診断で回っています」「今、電気代上がってませんか？」で相手に喋らせる。',
      top: 'こんにちは、電気の健康診断で回っています。今、電気代って上がっていませんか？',
      test: s => { const h = firstN(s, 150); return /(電気代|健康診断|無料診断|診断|明細)/.test(h) && /(？|\?|ですか|ませんか|どう|いかが|上がって|高く)/.test(h); } },
    { id: 2, req: false, phase: '問題提起', t: '問題提起：値上げ・単価の不利益に触れて危機感を共有した', theme: '値上げ・時間帯単価・燃料費調整を"相手ごと"に。相手の口から不満を言わせる。',
      top: '燃料費調整でこの1年、じわじわ上がってますよね。夜トク系だと昼の単価が高くて。',
      test: s => /(値上げ|上がって|単価|燃料費調整|時間帯|夜トク|従量|プラン|高く|上昇)/.test(s) },
    { id: 3, req: false, phase: '明細ドライブ', t: '明細ドライブ：明細を見せてもらう合意を取りにいった', theme: '"売る"でなく"見る"。「明細だけ30秒見せてもらえますか？」で警戒を下げる。',
      top: '明細だけ、30秒見させてもらえますか？数字を見れば下げられる余地が一目で分かります。',
      test: s => /(明細|検針票|請求書)/.test(s) && /(見|確認|拝見|見せ|30秒|チェック)/.test(s) },
    { id: 4, req: false, phase: '価値提示', t: '価値提示：補助金の"今だけ"／創蓄で前傾させた', theme: '補助金の"今だけ"、創って貯めて使う。太陽光・蓄電池・エコキュートを入口に。',
      top: '補助金が"今だけ"なんです。創って貯めて使う、で電気代の考え方ごと変わります。',
      test: s => /(補助金|助成金|今だけ|創蓄|創って|蓄電池|太陽光|エコキュート|オール電化)/.test(s) },
    { id: 5, req: false, phase: '切り返し', t: '切り返し：断られても最低1回粘った（電気代だけ確認）', theme: '断りは入口。「ちなみに電気代だけ確認しても？」「見るだけで大丈夫です」で1ターン粘る。',
      top: 'ちなみに電気代だけ、確認してもいいですか？お手間は取らせません、見るだけで大丈夫です。',
      test: s => /(電気代だけ|確認だけ|見るだけ|お手間|一目|ちなみに)/.test(s) && /(確認|見|いいですか|大丈夫|だけ)/.test(s) },
    { id: 6, req: false, phase: '2択クロージング', t: '2択クロージング：二択で日程を置きにいった', theme: '「行っていいですか」でなく、A/Bの二択で日程を先に押さえる。',
      top: '明日の夕方と明後日の昼、どちらがご都合いいですか？明細を見る日だけ先に押さえさせてください。',
      test: s => /(どちら|どっち)/.test(s) && /(日|曜|夕方|昼|午前|午後|明日|明後日|来週|都合|時)/.test(s) },
  ];
  const RAIL = [
    { ph: '① 冒頭フック', time: '開口10秒', say: '「電気の健康診断で回っています。今、電気代って上がっていませんか？」', weapon: '無料診断／明細', ng: '名乗りで終わる／目的を言わない' },
    { ph: '② 問題提起', time: '〜30秒', say: '「燃料費調整でこの1年上がってますよね。夜トク系だと昼の単価が高くて。」', weapon: '値上げ・単価の事実', ng: '一方的に説明して相手に喋らせない' },
    { ph: '③ 明細ドライブ', time: '〜1分', say: '「明細だけ30秒、見させてもらえますか？下げられる余地が一目で分かります。」', weapon: '明細を"見る"合意', ng: '明細を見る前に商品を売り込む' },
    { ph: '④ 価値提示', time: '1-2分', say: '「補助金が"今だけ"なんです。創って貯めて使う、で考え方ごと変わります。」', weapon: '補助金の"今だけ"／創蓄', ng: 'いきなり見積・工事費・kW' },
    { ph: '⑤ 切り返し', time: '断りの度に', say: '「ちなみに電気代だけ確認しても？見るだけで大丈夫です。」', weapon: '粘りのひとターン', ng: '断られて即引く' },
    { ph: '⑥ 2択クロージング', time: '締め', say: '「明日の夕方と明後日の昼、どちらがご都合いいですか？」', weapon: '二択で日程確定', ng: '「行っていいですか？」の一択' },
  ];
  const SCENARIOS = {
    '警戒': ['「間に合ってます」と即断りから入る', '「どちら様？」と身分を確認してくる'],
    '多忙': ['「今忙しいので手短に」と急かす', 'ドアを半分だけ開けて対応'],
    '価格重視': ['「で、いくらなの？」とすぐ価格を聞く', '「他社の方が安かった」と比較を出す'],
  };
  const SAMPLE = `営業: こんにちは、電気の健康診断で回っています。今、電気代って上がっていませんか？
客: あー、まあ上がってはいるけど…間に合ってます。
営業: 燃料費調整でこの1年じわじわ上がってますよね。夜トク系だと昼の単価が高くて。
客: そうそう、昼が高いのよね。
営業: 明細だけ30秒、見させてもらえますか？下げられる余地があるか一目で分かります。
客: 明細ねえ…どこだったかな。
営業: 実は補助金が"今だけ"で、創って貯めて使う、で電気代の考え方ごと変わるんです。
客: へえ、でも今ちょっと忙しくて。
営業: ちなみに電気代だけ確認してもいいですか？お手間は取らせません、見るだけで大丈夫です。
客: うーん、まあ見るだけなら。
営業: ありがとうございます。明日の夕方と明後日の昼、どちらがご都合いいですか？`;

  // ---- 採点（決定論：八賀式トークロジック）----
  function salesText(t) { const ls = t.split(/\n+/); const s = ls.filter(l => /^\s*(営業|営|S\d|SALES)/i.test(l)); return s.length ? s.join('\n') : t; }
  function firstN(s, n) { return String(s).slice(0, n); }
  // 明細ドライブ（"見る"合意）が来た位置。
  function firstDriveIdx(s) { const m = s.search(/(明細|検針票|請求書)/); return m < 0 ? Infinity : m; }
  // 逆指標＝明細を見る前の「売り込み（見積・工事費・kW・価格・契約）」。
  function firstSellIdx(s) { const m = s.search(/(お見積|見積り|工事費|設置し|何kw|\dkwh|価格は|お安く|パネルを付|ご契約|月々|導入しま)/i); return m < 0 ? Infinity : m; }
  function score(transcript) {
    const s = salesText(transcript);
    const items = CHECKS.map(c => ({ ...c, ok: c.test(s) }));
    const sellBeforeDrive = firstSellIdx(s) < firstDriveIdx(s);
    const met = items.filter(i => i.ok).length;
    const reqOk = items.find(i => i.id === 1).ok;
    const pass = reqOk && met >= 4 && !sellBeforeDrive; // ①冒頭フック必須＋6局面中4つ以上＋売り込み先行なし
    const kpis = [
      { k: '冒頭フック', on: items[0].ok }, { k: '問題提起', on: items[1].ok },
      { k: '明細ドライブ', on: items[2].ok }, { k: '切り返し', on: items[4].ok },
      { k: '2択クロージング', on: items[5].ok }, { k: '売り込み先行（逆指標）', on: !sellBeforeDrive },
    ];
    return { items, met, total: CHECKS.length, reqOk, pass, sellBeforeDrive, kpis };
  }
  function coach(r) {
    if (r.pass) { const nx = r.items.find(i => !i.ok); return 'いい流れだ。冒頭フックで相手に喋らせて、明細まで運べている。' + (nx ? `次は「${nx.phase}」を1つ足せ。` : 'この八賀式の型を現場で崩すな。'); }
    if (!r.reqOk) return '不合格。冒頭10秒で「電気代・診断・明細」のどれかを刺して質問しろ。名乗りで終わるな——相手に喋らせるのが入口だ。';
    if (r.sellBeforeDrive) return '明細を見る前に見積や工事費を出した瞬間、売り込みになる。八賀式は"売る"でなく"見る"。明細ドライブが先だ。';
    return '型のどこかが抜けている。落ちた局面は下の「次にやること」だけでいい。特に②問題提起と③明細ドライブ＝相手に喋らせる所を厚くしろ。';
  }

  // ---- 状態・履歴 ----
  const KEY = 'onikyokan_roleplay_v1';
  const S = { step: 'setup', rep: '', partner: '', ctype: '警戒', transcript: '', result: null, recSec: 0, timer: null,
    ai: { turns: [], recording: false, busy: false, note: '' },
    av: { persona: 'shufu', difficulty: 'normal', product: 'solar', turns: [], state: 'idle', note: '' } };
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
        <div class="flex flex-wrap justify-end gap-2.5 mt-4"><button onclick="RP.startAvatar('shufu')" class="${btnP}">AIお客様と会話（顔つき・ハンズフリー）</button><button onclick="RP.startAi()" class="${btnG}">押して話す（顔なし）</button><button onclick="RP.start()" class="${btnG}">人ペアを録音</button></div>
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
        <span class="text-[11px] tracking-wide opacity-80 block">八賀式トーク 判定</span><span class="text-xl">${pass ? '合格' : 'もう一歩（不合格）'}</span></div>
      ${card(`<div class="p-5"><div class="flex items-baseline gap-2.5"><span class="text-3xl font-extrabold text-emerald-600">${r.met}/${r.total}</span><span class="text-neutral-500 text-[13px]">六局面の達成（①冒頭フック必須／4局面以上で合格）</span></div>
        <div class="flex gap-2 flex-wrap mt-2.5">${r.kpis.map(k => `<span class="text-[11.5px] rounded-full px-2.5 py-1 border ${k.on ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}">${k.k} ${k.on ? '○' : '×'}</span>`).join('')}</div></div>`)}
      <div class="bg-neutral-900 text-neutral-100 rounded-xl px-4 py-3.5 text-[13.5px] my-4"><span class="font-semibold text-emerald-300">鬼教官</span>　${coach(r)}</div>
      ${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">録音からの講評（できていない点・練習ポイント・ヒアリング力）<span class="text-[10.5px] text-neutral-400 ml-1">参考</span></div>
        <div id="rp_fb" class="text-[13px] text-neutral-500">録音を読み解いています…</div></div>`)}
      ${card(`<div class="p-5"><div class="text-sm font-semibold mb-2">チェック（①〜⑦）</div>
        ${r.items.map(i => `<div class="flex gap-2.5 py-2.5 border-b border-[#EEF3F0] last:border-0 text-[13.5px]"><div class="w-6 text-center font-extrabold ${i.ok ? 'text-emerald-600' : 'text-rose-600'}">${i.ok ? '✓' : '✕'}</div>
          <div><div class="font-semibold">${i.id}. ${i.t}${i.req ? '<span class="text-[10.5px] text-rose-600 border border-rose-200 rounded px-1.5 ml-1.5">必須</span>' : ''}</div>
          <div class="text-neutral-500 text-[12px] mt-0.5">${i.ok ? 'トップ例：' + i.top : 'できていない'}</div></div></div>`).join('')}
        ${r.sellBeforeDrive ? `<div class="flex gap-2.5 py-2.5 text-[13.5px]"><div class="w-6 text-center font-extrabold text-rose-600">✕</div><div><div class="font-semibold">逆指標：明細を見る前に売り込んだ</div><div class="text-neutral-500 text-[12px] mt-0.5">八賀式は"売る"でなく"見る"。明細ドライブが先。</div></div></div>` : ''}</div>`)}
      ${r.items.filter(i => !i.ok).length ? `<div class="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[13px] my-3 text-neutral-700"><span class="font-semibold text-amber-700">次にやること（落ちた局面だけ）</span><br>${r.items.filter(i => !i.ok).map(i => '・' + i.theme).join('<br>')}</div>` : ''}
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

  // ---- AIお客様とのロープレ（押して話す）----
  function bubble(role, text) {
    const mine = role === 'sales';
    return `<div class="flex ${mine ? 'justify-end' : 'justify-start'} mb-2">
      <div class="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13.5px] ${mine ? 'bg-emerald-600 text-white' : 'bg-white border border-[#E3DED2] text-neutral-800'}">
        <div class="text-[10.5px] mb-0.5 ${mine ? 'text-emerald-100' : 'text-neutral-400'}">${mine ? (S.rep || '営業') : 'お客様（' + S.ctype + '）'}</div>${text.replace(/</g, '&lt;')}</div></div>`;
  }
  function viewAi() {
    const a = S.ai;
    const label = a.busy ? '…考え中' : (a.recording ? '● 録音中（もう一度押して送信）' : '押して話す');
    const bcls = a.recording ? 'bg-rose-600' : 'bg-emerald-600';
    const log = a.turns.length
      ? a.turns.map(t => bubble(t.role, t.text)).join('')
      : `<div class="text-neutral-400 text-[13px] text-center py-6">「押して話す」を押して、玄関先の第一声から始めてください。<br>名乗り3点（社名・目的・商材）を忘れずに。</div>`;
    return `<div class="max-w-[860px] mx-auto">
      <h1 class="text-xl font-bold mb-1">AIお客様とロープレ</h1>
      <p class="text-neutral-500 text-[13px] mb-4">${S.rep || '—'}（お客様＝${S.ctype}）／玄関〜診断の入口3局面。話し終えたらボタンをもう一度押すと、お客様が返します。</p>
      ${card(`<div class="p-4"><div id="rp_ailog" class="max-h-[46vh] overflow-auto px-1">${log}</div></div>`)}
      <div class="mt-3 flex items-center gap-2.5">
        <button onclick="RP.talk()" ${a.busy ? 'disabled' : ''} class="flex-1 px-5 py-4 rounded-xl ${bcls} text-white font-bold text-base ${a.busy ? 'opacity-60' : ''}">${label}</button>
        <button onclick="RP.endAi()" class="px-4 py-4 rounded-xl bg-white border border-neutral-200 text-emerald-700 font-semibold text-sm">終了して採点</button>
      </div>
      ${a.note ? `<div class="text-[12px] text-amber-700 mt-2">${a.note}</div>` : ''}
      <div class="mt-3">${card(`<div class="p-4"><div class="text-[12.5px] font-semibold mb-1.5">マイクが使えないときは打ち込みで送れます</div>
        <div class="flex gap-2"><input id="rp_aitype" placeholder="営業のセリフを入力" class="flex-1 border border-neutral-200 rounded-lg px-3 py-2.5 text-sm">
        <button onclick="RP.talkText()" class="${btnG}">送る</button></div></div>`)}</div>
      <div class="mt-3">${card(`<div class="p-4"><div class="text-sm font-semibold mb-2">台本レール</div>${railHtml()}</div>`)}</div>
      <div class="mt-3"><button onclick="RP.tab('setup')" class="${btnG}">やめて戻る</button></div>
    </div>`;
  }

  // ---- 顔つき・ハンズフリーのAI会話（アバター）----
  // お客様・難易度・商材の3行セレクタ。難易度/商材の切替は動画・マイクを触らず #av_sel だけ更新。
  function avRowsHtml() {
    const a = S.av;
    const row = (title, items, activeKey, fn) => `<div class="flex items-center gap-1.5 flex-wrap mb-1.5"><span class="text-[11px] text-neutral-400 w-11 shrink-0">${title}</span>${items.map(x => `<button ${x.disabled ? 'disabled' : `onclick="${fn}('${x.key}')"`} class="px-2.5 py-1 rounded-full text-[12px] border ${x.key === activeKey ? 'bg-emerald-600 text-white border-emerald-600' : x.disabled ? 'bg-neutral-100 border-neutral-200 text-neutral-400' : 'bg-white border-neutral-200 text-neutral-700'}">${x.label}${x.disabled ? '（近日）' : ''}</button>`).join('')}</div>`;
    const personas = Object.values(PERSONAS).map(x => ({ key: x.key, label: x.label, disabled: !x.ready }));
    return row('お客様', personas, a.persona, 'RP.setPersona')
      + row('難易度', Object.values(DIFFICULTIES), a.difficulty, 'RP.setDifficulty')
      + row('商材', Object.values(PRODUCTS), a.product, 'RP.setProduct');
  }
  function viewAvatar() {
    const p = PERSONAS[S.av.persona] || PERSONAS.shufu;
    return `<div class="max-w-[860px] mx-auto">
      <h1 class="text-xl font-bold mb-1">AIお客様と会話（顔つき）</h1>
      <p class="text-neutral-500 text-[13px] mb-3">「会話をはじめる」を押したら、あとは<b>話しかけるだけ</b>——黙ると相手が返し、そのまま会話が続きます。お客様・難易度・商材を選べます。</p>
      <div id="av_sel" class="mb-3">${avRowsHtml()}</div>
      <div class="relative rounded-2xl overflow-hidden bg-black mx-auto" style="aspect-ratio:3/4;max-width:340px">
        <video id="av_idle" src="${p.idle}" poster="${p.poster || ''}" muted loop playsinline autoplay preload="auto" class="absolute inset-0 w-full h-full object-cover"></video>
        <video id="av_talk" src="${p.talking}" muted loop playsinline autoplay preload="auto" class="absolute inset-0 w-full h-full object-cover" style="opacity:0;transition:opacity .18s"></video>
        <div id="av_status" class="absolute bottom-0 inset-x-0 text-center text-white text-[12.5px] py-2" style="background:linear-gradient(transparent,rgba(0,0,0,.65))">準備中…</div>
      </div>
      <audio id="av_audio" playsinline preload="auto" style="display:none"></audio>
      <div id="av_note" class="text-[12px] text-amber-700 mt-2 text-center">${S.av.note || ''}</div>
      ${!S.av.started
        ? `<div class="mt-3 text-center"><button onclick="RP.avStart()" class="px-8 py-4 rounded-xl bg-emerald-600 text-white font-bold text-base">▶ 会話をはじめる</button>
            <div class="text-[11px] text-neutral-400 mt-1.5">押すとマイクが始まり、あとは話しかけるだけで会話が続きます。</div></div>`
        : `<div class="mt-3 text-center"><button id="av_talkbtn" onclick="RP.avManualToggle()" class="px-6 py-2.5 rounded-full bg-white border border-neutral-200 text-emerald-700 font-semibold text-[13px]">うまく拾わない時は押して話す</button></div>`}
      <div class="mt-3">${card(`<div class="p-4"><div id="av_log" class="max-h-[28vh] overflow-auto px-1"><div class="text-neutral-400 text-[13px] text-center py-4">${S.av.started ? '話しかけてください。名乗り3点（社名・目的・商材）を忘れずに。' : '「会話をはじめる」を押してスタート。'}</div></div></div>`)}</div>
      ${S.av.started ? `<div class="mt-3">${card(`<div class="p-4"><div class="text-[12.5px] font-semibold mb-1.5">打ち込みでも送れます</div>
        <div class="flex gap-2"><input id="av_type" placeholder="営業のセリフを入力" class="flex-1 border border-neutral-200 rounded-lg px-3 py-2.5 text-sm">
        <button onclick="RP.avTalkText()" class="${btnG}">送る</button></div></div>`)}</div>` : ''}
      <div class="mt-3">${card(`<div class="p-4"><div class="text-sm font-semibold mb-2">台本レール</div>${railHtml()}</div>`)}</div>
      <div class="mt-3 flex justify-between gap-3">
        <button onclick="RP.avBack()" class="${btnG}">メニュー（他のモード）</button>
        <button onclick="RP.endAvatar()" class="${btnP}">終了して採点</button>
      </div>
    </div>`;
  }

  // ---- ビュー本体（鬼教官の VIEWS.roleplay から呼ばれる）----
  window.viewRoleplay = function () {
    if (S.step === 'history') return viewHistory();
    if (S.step === 'avatar') return viewAvatar();
    if (S.step === 'ai') return viewAi();
    if (S.step === 'rec') return viewRec();
    if (S.step === 'result') return viewResult();
    return viewSetup();
  };

  // ---- 録音（MediaRecorderがあれば実録音・無ければ計測のみ）----
  let mediaRec = null, chunks = [];
  // ---- AIロープレ用（1ターンごとに録音→送信）----
  let aiStream = null, aiRec = null, aiChunks = [];
  function blobB64(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); }); }
  // ja-JP の声を性別ヒントで選ぶ（環境で名前が違うので当たれば使う・無ければ既定）。
  function pickVoice(gender) {
    try {
      const all = window.speechSynthesis.getVoices() || [];
      const vs = all.filter(v => /ja[-_]?JP|Japanese|日本/i.test(v.lang + ' ' + v.name));
      if (!vs.length) return null;
      const fem = /(Kyoko|Female|女性|Haruka|Ayumi|Nanami|Sayaka|Mizuki|O-ren|Otome)/i;
      const mal = /(Otoya|Male|男性|Ichiro|Hattori|Daichi|Keita|Ryo)/i;
      if (gender === 'female') { const f = vs.find(v => fem.test(v.name)); if (f) return f; const nm = vs.find(v => !mal.test(v.name)); if (nm) return nm; }
      if (gender === 'male') { const m = vs.find(v => mal.test(v.name)); if (m) return m; }
      return vs[0];
    } catch (e) { return null; }
  }
  function speak(text, opts = {}) {
    try {
      if (!window.speechSynthesis) { if (opts.onend) setTimeout(opts.onend, 400); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP'; u.rate = opts.rate || 1.02;
      const v = pickVoice(opts.gender); if (v) u.voice = v;
      if (opts.onend) u.onend = opts.onend;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) { if (opts.onend) setTimeout(opts.onend, 400); }
  }
  function scrollLog() { const el = document.getElementById('rp_ailog'); if (el) el.scrollTop = el.scrollHeight; }

  // ---- 顔つき・ハンズフリー（アバター）用 ----
  // お客様（顔・声・UI）。性格の中身はサーバ(persona.mjs)側。
  const PERSONAS = {
    shufu: { key: 'shufu', label: '主婦', hint: '昼間の在宅主婦', gender: 'female', ttsVoice: 'aura-2-izanami-ja',
      idle: '/assets/roleplay/shufu/idle.mp4', talking: '/assets/roleplay/shufu/talking.mp4', poster: '/assets/roleplay/shufu/poster.png', ready: true },
    danna: { key: 'danna', label: '旦那', hint: '休日在宅の夫', gender: 'male', ttsVoice: 'aura-2-fujin-ja',
      idle: '/assets/roleplay/danna/idle.mp4', talking: '/assets/roleplay/danna/talking.mp4', poster: '/assets/roleplay/danna/poster.png', ready: true },
  };
  // 難易度（"強いお客様"はここで選ぶ）
  const DIFFICULTIES = {
    normal: { key: 'normal', label: 'ふつう' },
    hard: { key: 'hard', label: '手強い' },
    boss: { key: 'boss', label: '門前払い' },
  };
  // 商材（シナリオ）
  const PRODUCTS = {
    solar: { key: 'solar', label: '太陽光・蓄電池' },
    ecocute: { key: 'ecocute', label: 'エコキュート・オール電化' },
    shindan: { key: 'shindan', label: '電気の無料診断' },
  };
  let avStream = null, avRec = null, avChunks = [], avCtx = null, avAnalyser = null, avBuf = null;
  let avLoopOn = false, avRaf = null, avRecStart = 0, avLastLoud = 0, avMime = '', avManual = false;
  // 感度は開始時に周囲の雑音を測って自動調整する（固定だと騒音で"まだ喋ってる"と誤認して録りっぱなしになる）。
  let avSpeakTh = 0.05, avSilenceTh = 0.03;
  const SILENCE_MS = 800, REC_MAX_MS = 12000, MIN_REC_MS = 400;
  // ---- ストリーミング文字起こし（Deepgram live）。話しながら認識→止めた瞬間に即返答。失敗時はVADにフォールバック ----
  let dgWs = null, dgProc = null, dgSrc = null, dgGain = null, dgActive = false, dgFinal = '', dgKeepAlive = null;
  const DG_ENDPOINT_MS = 600, DG_UTT_MS = 1000;
  let avSrcNode = null;   // 現在再生中のTTS音源（WebAudio）。次の発話や終了で止める。
  // 端末が録れる音声形式を選ぶ（iOS Safari は webm 非対応で mp4 になる。webm決め打ちだと文字起こしが失敗する）。
  function pickRecMime() {
    try {
      const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/ogg;codecs=opus', 'audio/ogg'];
      if (window.MediaRecorder && MediaRecorder.isTypeSupported) { for (const c of cands) { if (MediaRecorder.isTypeSupported(c)) return c; } }
    } catch (e) {}
    return '';
  }
  // サーバ(Deepgram)へ渡す拡張子。server.mjs/deepgram の MIME表に合わせる。
  function extForMime(m) { m = m || ''; if (/mp4|m4a|aac/i.test(m)) return 'm4a'; if (/ogg/i.test(m)) return 'ogg'; if (/wav/i.test(m)) return 'wav'; return 'webm'; }
  // iOSは最初のユーザー操作の中で一度発話しないと以後の自動読み上げが無音になる。無音で解錠する。
  function primeSpeech() { try { if (!window.speechSynthesis) return; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'ja-JP'; window.speechSynthesis.speak(u); } catch (e) {} }
  // 本物の声(OpenAI TTS)で喋らせる。<audio>にGETのストリーミングURLを差して、
  // 生成されたそばから鳴らす（待ちを最小化）。iOSは _avInit で <audio> を AudioContext に繋いで解錠済み。
  // 音声が取れないときはブラウザ読み上げにフォールバック。onstart=鳴り出し／onend=鳴り終わり。
  function speakServer(text, opts = {}) {
    const a = document.getElementById('av_audio');
    if (!a) { if (opts.onstart) opts.onstart(); speak(text, { gender: opts.gender, onend: opts.onend }); return; }
    let started = false, done = false, guard = null;
    const finish = () => { if (done) return; done = true; if (guard) clearTimeout(guard); if (opts.onend) opts.onend(); };
    const fallback = () => { if (started || done) return; if (guard) clearTimeout(guard); if (opts.onstart) opts.onstart(); speak(text, { gender: opts.gender, onend: finish }); };
    a.onplaying = () => { if (!started) { started = true; if (guard) clearTimeout(guard); if (opts.onstart) opts.onstart(); } };
    a.onended = finish;
    a.onerror = () => { if (started) finish(); else fallback(); };
    // 保険：音声が鳴り出しも失敗もせず固まった時、会話を止めないでブラウザ読み上げに切替える。
    guard = setTimeout(() => { if (!started && !done) fallback(); }, 4500);
    try {
      a.src = '/api/roleplay/tts?voice=' + encodeURIComponent(opts.voice || 'aura-2-izanami-ja') + '&text=' + encodeURIComponent(text);
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => fallback());
    } catch (e) { fallback(); }
  }
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
    scoreSample() { S.transcript = SAMPLE; S.result = score(SAMPLE); S.step = 'result'; render(); window.scrollTo(0, 0); RP._loadFeedback(); },
    scorePaste() { const el = document.getElementById('rp_tr'); const t = (el && el.value.trim()) || SAMPLE; S.transcript = t; S.result = score(t); S.step = 'result'; render(); window.scrollTo(0, 0); RP._loadFeedback(); },
    save() { const h = hist(); h.push({ rep: S.rep, partner: S.partner, ctype: S.ctype, met: S.result.met, pass: S.result.pass }); localStorage.setItem(KEY, JSON.stringify(h)); S.step = 'history'; render(); window.scrollTo(0, 0); },
    // ロープレ道場を開いたら即・顔つき会話を開始する（設定画面を挟まない）。
    // マイク解錠は「ロープレ道場」タップのユーザー操作で成立する。他モードはメニューから。
    reset() {
      RP._avTeardown();
      const p = PERSONAS.shufu;
      const cur = S.av || {};
      S.av = { persona: p.key, difficulty: cur.difficulty || 'normal', product: cur.product || 'solar', turns: [], state: 'idle', started: false, note: '' };
      S.step = 'avatar';
    },

    // ---- 顔つき・ハンズフリー会話（アバター）----
    startAvatar(personaKey) {
      RP._avTeardown();
      const p = PERSONAS[personaKey] || PERSONAS.shufu;
      if (!p.ready) { RP._avNote(p.label + 'は準備中です。'); return; }
      const cur = S.av || {};
      S.av = { persona: p.key, difficulty: cur.difficulty || 'normal', product: cur.product || 'solar', turns: [], state: 'idle', started: false, note: '' };
      S.step = 'avatar'; render(); window.scrollTo(0, 0);
    },
    // 1回押したら会話開始。この操作の中でマイク・音声を解錠し、以後はハンズフリーで続く。
    avStart() {
      if (S.av.started) return;
      S.av.started = true; S.av.state = 'idle'; render(); window.scrollTo(0, 0);
      try { ['av_idle', 'av_talk'].forEach(id => { const v = document.getElementById(id); if (v) { v.muted = true; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } }); } catch (e) {}
      try { window.speechSynthesis && window.speechSynthesis.getVoices(); } catch (e) {}
      primeSpeech();
      setTimeout(() => RP._avInit(), 120);
    },
    setPersona(key) { RP.startAvatar(key); },   // 顔が変わるので作り直し
    setDifficulty(key) {
      if (!DIFFICULTIES[key] || S.av.difficulty === key) return;
      S.av.difficulty = key; S.av.turns = [];
      RP._avRenderChips(); RP._avRenderLog(); RP._avNote('難易度：' + DIFFICULTIES[key].label + '（会話をリセット）');
    },
    setProduct(key) {
      if (!PRODUCTS[key] || S.av.product === key) return;
      S.av.product = key; S.av.turns = [];
      RP._avRenderChips(); RP._avRenderLog(); RP._avNote('商材：' + PRODUCTS[key].label + '（会話をリセット）');
    },
    _avRenderChips() { const el = document.getElementById('av_sel'); if (el) el.innerHTML = avRowsHtml(); },
    async _avInit() {
      RP._avStatus();
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { RP._avNote('この端末はマイクに対応していません。下の入力欄で会話できます。'); return; }
      try { avStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { RP._avNote('マイクが使えません。下の入力欄で会話できます。'); return; }
      // AudioContext（マイク解析＋<audio>再生の解錠に共用）
      try {
        avCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (avCtx.state === 'suspended') { try { await avCtx.resume(); } catch (e) {} }
        try { const a = document.getElementById('av_audio'); if (a && avCtx.createMediaElementSource) { avCtx.createMediaElementSource(a).connect(avCtx.destination); } } catch (e) {}
      } catch (e) {}
      // まずストリーミング（話しながら認識→止めた瞬間に返答）を試す。繋がればそれで進む。
      const streamOk = await RP._startStream();
      if (streamOk) { S.av.state = 'listening'; RP._avNote(''); RP._avStatus(); return; }
      // フォールバック：VAD＋録音バッチ（周囲雑音で感度を自動調整）。
      if (!window.MediaRecorder) { RP._avNote('この端末は録音に対応していません。下の入力欄で会話できます。'); return; }
      avMime = pickRecMime();
      try {
        if (!avCtx) { avCtx = new (window.AudioContext || window.webkitAudioContext)(); if (avCtx.state === 'suspended') { try { await avCtx.resume(); } catch (e) {} } }
        const src = avCtx.createMediaStreamSource(avStream);
        avAnalyser = avCtx.createAnalyser(); avAnalyser.fftSize = 512;
        src.connect(avAnalyser); avBuf = new Uint8Array(avAnalyser.fftSize);
      } catch (e) { RP._avNote('音声の解析を開始できませんでした。「話す」ボタンで会話できます。'); }
      try {
        if (avAnalyser) {
          const samples = []; const t0 = Date.now();
          while (Date.now() - t0 < 420) {
            avAnalyser.getByteTimeDomainData(avBuf);
            let s = 0; for (let i = 0; i < avBuf.length; i++) { const v = (avBuf[i] - 128) / 128; s += v * v; }
            samples.push(Math.sqrt(s / avBuf.length));
            await new Promise(r => setTimeout(r, 25));
          }
          samples.sort((a, b) => a - b);
          const noise = samples[Math.floor(samples.length / 2)] || 0.01;   // 中央値＝環境ノイズ
          avSpeakTh = Math.min(0.12, Math.max(0.03, noise * 3));
          avSilenceTh = Math.min(0.08, Math.max(0.018, noise * 1.8));
        }
      } catch (e) {}
      S.av.state = 'listening'; RP._avNote(''); RP._avStatus();
      avLoopOn = true; RP._avLoop();
    },
    // ---- ストリーミング（Deepgram live）----
    async _startStream() {
      try {
        if (!window.WebSocket || !avCtx || !avStream) return false;
        const tj = await (await fetch('/api/roleplay/stt-token', { method: 'POST' })).json().catch(() => null);
        if (!tj || !tj.ok || !tj.access_token) return false;
        const rate = Math.round(avCtx.sampleRate || 48000);
        const qp = 'model=nova-2&language=ja&encoding=linear16&sample_rate=' + rate + '&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=' + DG_ENDPOINT_MS + '&utterance_end_ms=' + DG_UTT_MS + '&vad_events=true';
        const url = 'wss://api.deepgram.com/v1/listen?' + qp + '&access_token=' + encodeURIComponent(tj.access_token);
        const ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
        dgFinal = '';
        const opened = await new Promise(resolve => {
          let settled = false;
          const to = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 4000);
          ws.onopen = () => { if (settled) return; settled = true; clearTimeout(to); resolve(true); };
          ws.onerror = () => { if (settled) return; settled = true; clearTimeout(to); resolve(false); };
          ws.onclose = () => { if (settled) return; settled = true; clearTimeout(to); resolve(false); };
        });
        if (!opened) { try { ws.close(); } catch (e) {} return false; }
        dgWs = ws; dgActive = true;
        ws.onmessage = ev => RP._dgOnMessage(ev);
        ws.onerror = () => {};
        ws.onclose = () => { dgActive = false; };
        RP._dgStartCapture();
        // 客が喋っている間などは音声を送らないので、切れないようKeepAliveを送る。
        dgKeepAlive = setInterval(() => { try { if (dgWs && dgWs.readyState === 1 && S.av.state !== 'listening') dgWs.send(JSON.stringify({ type: 'KeepAlive' })); } catch (e) {} }, 5000);
        return true;
      } catch (e) { return false; }
    },
    _dgStartCapture() {
      try {
        dgSrc = avCtx.createMediaStreamSource(avStream);
        dgProc = avCtx.createScriptProcessor ? avCtx.createScriptProcessor(4096, 1, 1) : avCtx.createJavaScriptNode(4096, 1, 1);
        dgGain = avCtx.createGain(); dgGain.gain.value = 0;   // 無音でdestinationへ（processorを動かすため）
        dgProc.onaudioprocess = (e) => {
          if (!dgWs || dgWs.readyState !== 1) return;
          if (S.av.state !== 'listening') return;             // 考え中/客の発話中は送らない＝エコー防止
          const f32 = e.inputBuffer.getChannelData(0);
          const i16 = new Int16Array(f32.length);
          for (let i = 0; i < f32.length; i++) { let s = f32[i]; s = s < -1 ? -1 : s > 1 ? 1 : s; i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
          try { dgWs.send(i16.buffer); } catch (er) {}
        };
        dgSrc.connect(dgProc); dgProc.connect(dgGain); dgGain.connect(avCtx.destination);
      } catch (e) {}
    },
    _dgOnMessage(ev) {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'Results') {
        if (S.av.state !== 'listening') return;               // 処理中/発話中の結果は無視
        const alt = m.channel && m.channel.alternatives && m.channel.alternatives[0];
        const tr = (alt && alt.transcript || '').trim();
        if (m.is_final) { if (tr) dgFinal = (dgFinal + ' ' + tr).trim(); RP._dgLive(dgFinal); }
        else { RP._dgLive((dgFinal + ' ' + tr).trim()); }
        if (m.speech_final) RP._dgTurnEnd();
      } else if (m.type === 'UtteranceEnd') {
        if (S.av.state === 'listening') RP._dgTurnEnd();
      }
    },
    _dgLive(t) { const el = document.getElementById('av_status'); if (el && S.av.state === 'listening') el.textContent = t ? ('聞き取り中… ' + t.slice(-40)) : 'どうぞ話しかけてください（聞いています）'; },
    _dgTurnEnd() {
      const text = (dgFinal || '').trim(); dgFinal = '';
      if (!text || text.length < 2) { RP._dgLive(''); return; }
      RP._avReply(text);   // processing→speaking→listening。listening外では音声を送らない。
    },
    _dgTeardown() {
      try { if (dgKeepAlive) clearInterval(dgKeepAlive); } catch (e) {} dgKeepAlive = null;
      try { if (dgProc) { dgProc.disconnect(); dgProc.onaudioprocess = null; } } catch (e) {} dgProc = null;
      try { if (dgGain) dgGain.disconnect(); } catch (e) {} dgGain = null;
      try { if (dgSrc) dgSrc.disconnect(); } catch (e) {} dgSrc = null;
      try { if (dgWs) { if (dgWs.readyState === 1) dgWs.send(JSON.stringify({ type: 'CloseStream' })); dgWs.close(); } } catch (e) {} dgWs = null;
      dgActive = false; dgFinal = '';
    },
    _avLoop() {
      if (!avLoopOn) return;
      let rms = 0;
      try { avAnalyser.getByteTimeDomainData(avBuf); let s = 0; for (let i = 0; i < avBuf.length; i++) { const v = (avBuf[i] - 128) / 128; s += v * v; } rms = Math.sqrt(s / avBuf.length); } catch (e) {}
      const now = Date.now();
      if (S.av.state === 'listening') {
        if (rms > avSpeakTh) RP._avStartRec();
      } else if (S.av.state === 'recording') {
        if (rms > avSilenceTh) avLastLoud = now;
        if (!avManual && now - avRecStart > MIN_REC_MS && now - avLastLoud > SILENCE_MS) RP._avStopRec();
        else if (now - avRecStart > REC_MAX_MS) RP._avStopRec();   // 手動でも安全上限で止める
      }
      avRaf = setTimeout(() => RP._avLoop(), 60);
    },
    _avStartRec() {
      try {
        avRec = avMime ? new MediaRecorder(avStream, { mimeType: avMime }) : new MediaRecorder(avStream);
        avChunks = [];
        avRec.ondataavailable = e => { if (e.data && e.data.size) avChunks.push(e.data); };
        avRec.onstop = () => RP._avProcess();
        avRec.start(); S.av.state = 'recording'; avRecStart = Date.now(); avLastLoud = Date.now(); RP._avStatus();
      } catch (e) { S.av.state = 'listening'; }
    },
    _avStopRec() {
      if (S.av.state !== 'recording') return;
      S.av.state = 'processing'; RP._avStatus();
      try { avRec.stop(); } catch (e) { S.av.state = 'listening'; RP._avStatus(); }
    },
    avManualToggle() {
      if (dgActive) { RP._avNote('そのまま話しかけてください（自動で聞き取っています）。'); return; }
      if (!avStream) { RP._avNote('マイクが使えません。下の入力欄で会話できます。'); return; }
      if (S.av.state === 'speaking' || S.av.state === 'processing') return;
      if (S.av.state === 'recording') { avManual = false; RP._avStopRec(); }
      else { avManual = true; RP._avStartRec(); }
    },
    async _avProcess() {
      avManual = false;
      try {
        const mt = (avRec && avRec.mimeType) || avMime || 'audio/webm';
        const blob = new Blob(avChunks, { type: mt });
        if (blob.size < 2500) { S.av.state = 'listening'; RP._avStatus(); return; }   // ノイズ/短すぎ
        const b64 = await blobB64(blob);
        const r = await fetch('/api/roleplay/stt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: b64, ext: extForMime(mt) }) });
        const j = await r.json();
        const text = ((j && j.ok && j.text) || '').trim();
        if (!text || text.length < 2) { S.av.state = 'listening'; RP._avNote('うまく聞き取れませんでした。もう一度どうぞ。'); RP._avStatus(); return; }
        RP._avNote('');
        await RP._avReply(text);
      } catch (e) { S.av.state = 'listening'; RP._avStatus(); }
    },
    async _avReply(salesLine) {
      S.av.turns.push({ role: 'sales', text: salesLine }); RP._avRenderLog();
      S.av.state = 'processing'; RP._avStatus();
      let reply = '';
      try {
        const history = S.av.turns.slice(0, -1).map(t => ({ role: t.role, text: t.text }));
        const r = await fetch('/api/roleplay/reply', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ persona: S.av.persona, difficulty: S.av.difficulty, product: S.av.product, history, salesText: salesLine }) });
        const j = await r.json();
        reply = ((j && j.ok && j.reply) || '').trim();
      } catch (e) {}
      if (!reply) { S.av.note = 'お客様の返答を作れませんでした（AIお客様が未設定かも）。'; RP._avNote(S.av.note); S.av.state = 'listening'; RP._avStatus(); return; }
      S.av.turns.push({ role: 'customer', text: reply }); RP._avRenderLog();
      const p = PERSONAS[S.av.persona] || PERSONAS.shufu;
      S.av.state = 'processing'; RP._avStatus();   // 声を用意する間は「考え中」
      speakServer(reply, {
        voice: p.ttsVoice, gender: p.gender,
        onstart: () => { S.av.state = 'speaking'; RP._avShowTalking(true); RP._avStatus(); },
        onend: () => { RP._avShowTalking(false); if (S.av.state === 'speaking') { S.av.state = 'listening'; RP._avStatus(); } },
      });
    },
    avTalkText() {
      const el = document.getElementById('av_type'); const t = el && el.value.trim();
      if (!t || S.av.state === 'processing' || S.av.state === 'speaking') return; if (el) el.value = '';
      RP._avReply(t);
    },
    _avShowTalking(on) {
      const t = document.getElementById('av_talk'); if (!t) return;
      t.style.opacity = on ? '1' : '0';
      // 両動画は最初から再生しっぱなし（隠れている間もmutedループ）。表示時に頭出しだけする。
      if (on) { try { t.currentTime = 0; const pr = t.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} }
    },
    _avStatus() {
      const el = document.getElementById('av_status');
      const m = { idle: '準備中…', listening: 'どうぞ話しかけてください（聞いています）', recording: '聞き取り中…（話し終わったら少し待つ）', processing: '…考え中', speaking: 'お客様が話しています' };
      if (el) el.textContent = m[S.av.state] || '';
      const btn = document.getElementById('av_talkbtn');
      if (btn) {
        const rec = S.av.state === 'recording', busy = S.av.state === 'processing' || S.av.state === 'speaking';
        btn.textContent = rec ? '■ 話し終わったらタップ' : '話す（押して録音）';
        btn.className = 'px-6 py-3 rounded-xl ' + (rec ? 'bg-rose-600' : 'bg-emerald-600') + ' text-white font-bold text-sm' + (busy ? ' opacity-60' : '');
        btn.disabled = busy;
      }
    },
    _avNote(msg) { S.av.note = msg || ''; const el = document.getElementById('av_note'); if (el) el.textContent = S.av.note; },
    _avRenderLog() {
      const el = document.getElementById('av_log'); if (!el) return;
      el.innerHTML = S.av.turns.length ? S.av.turns.map(t => bubble(t.role, t.text)).join('')
        : '<div class="text-neutral-400 text-[13px] text-center py-4">玄関先の第一声からどうぞ。名乗り3点（社名・目的・商材）を忘れずに。</div>';
      el.scrollTop = el.scrollHeight;
    },
    _avTeardown() {
      avLoopOn = false; avManual = false; try { clearTimeout(avRaf); } catch (e) {}
      RP._dgTeardown();
      try { if (avSrcNode) avSrcNode.stop(); } catch (e) {} avSrcNode = null;
      try { const a = document.getElementById('av_audio'); if (a) { a.pause(); a.removeAttribute('src'); a.load(); } } catch (e) {}
      try { if (avRec && avRec.state !== 'inactive') avRec.stop(); } catch (e) {}
      try { if (avStream) avStream.getTracks().forEach(t => t.stop()); } catch (e) {} avStream = null;
      try { if (avCtx) avCtx.close(); } catch (e) {} avCtx = null;
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    },
    avBack() { RP._avTeardown(); S.step = 'setup'; render(); window.scrollTo(0, 0); },
    endAvatar() {
      RP._avTeardown();
      const t = S.av.turns.map(x => (x.role === 'sales' ? '営業: ' : '客: ') + x.text).join('\n');
      S.transcript = t || SAMPLE; S.result = score(S.transcript); S.step = 'result'; render(); window.scrollTo(0, 0);
      RP._loadFeedback();
    },

    // ---- AIお客様とのロープレ ----
    async startAi() {
      S.ai = { turns: [], recording: false, busy: false, note: '' };
      S.step = 'ai'; render(); window.scrollTo(0, 0);
      try { if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) aiStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { aiStream = null; S.ai.note = 'マイクが使えないため、下の入力欄から打ち込みで進めてください。'; render(); }
    },
    talk() {
      if (S.ai.busy) return;
      if (!aiStream) { S.ai.note = 'マイクが使えません。下の入力欄から打ち込んでください。'; render(); return; }
      if (!S.ai.recording) {
        try {
          { const m = pickRecMime(); aiRec = m ? new MediaRecorder(aiStream, { mimeType: m }) : new MediaRecorder(aiStream); } aiChunks = [];
          aiRec.ondataavailable = e => { if (e.data && e.data.size) aiChunks.push(e.data); };
          aiRec.onstop = () => { RP._sttThenReply(); };
          aiRec.start(); S.ai.recording = true; S.ai.note = ''; render();
        } catch (e) { S.ai.note = '録音を開始できませんでした。打ち込みで進めてください。'; render(); }
      } else {
        S.ai.recording = false; S.ai.busy = true; render();   // onstop → _sttThenReply
        try { aiRec.stop(); } catch (e) { S.ai.busy = false; render(); }
      }
    },
    async _sttThenReply() {
      try {
        const mt = (aiRec && aiRec.mimeType) || 'audio/webm';
        const blob = new Blob(aiChunks, { type: mt });
        const b64 = await blobB64(blob);
        const r = await fetch('/api/roleplay/stt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: b64, ext: extForMime(mt) }) });
        const j = await r.json();
        const text = ((j && j.ok && j.text) || '').trim();
        if (!text) { S.ai.busy = false; S.ai.note = '聞き取れませんでした。もう一度話すか、打ち込んでください。'; render(); return; }
        await RP._advance(text);
      } catch (e) { S.ai.busy = false; S.ai.note = '通信に失敗しました。'; render(); }
    },
    talkText() {
      const el = document.getElementById('rp_aitype'); const t = el && el.value.trim();
      if (!t || S.ai.busy) return; if (el) el.value = '';
      RP._advance(t);
    },
    async _advance(salesLine) {
      S.ai.turns.push({ role: 'sales', text: salesLine }); S.ai.busy = true; S.ai.note = ''; render(); scrollLog();
      try {
        const history = S.ai.turns.slice(0, -1).map(t => ({ role: t.role, text: t.text }));
        const r = await fetch('/api/roleplay/reply', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ctype: S.ctype, history, salesText: salesLine }) });
        const j = await r.json();
        const reply = ((j && j.ok && j.reply) || '').trim();
        if (reply) { S.ai.turns.push({ role: 'customer', text: reply }); speak(reply); }
        else S.ai.note = 'お客様の返答を作れませんでした（AIお客様が未設定かもしれません）。';
      } catch (e) { S.ai.note = '通信に失敗しました。'; }
      S.ai.busy = false; render(); scrollLog();
    },
    endAi() {
      try { if (aiStream) aiStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      aiStream = null;
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
      const t = S.ai.turns.map(x => (x.role === 'sales' ? '営業: ' : '客: ') + x.text).join('\n');
      S.transcript = t || SAMPLE; S.result = score(S.transcript); S.step = 'result'; render(); window.scrollTo(0, 0);
    },

    // 録音の文字起こしから講評（できていない点/練習/ヒアリング力）を取得して結果画面に出す。参考値。
    async _loadFeedback() {
      const el = document.getElementById('rp_fb'); if (!el) return;
      if (!S.transcript || S.transcript === SAMPLE) { el.innerHTML = '<span class="text-neutral-400">サンプルのため講評は省略します。実際の会話で出ます。</span>'; return; }
      let d;
      try { d = await (await fetch('/api/roleplay/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: S.transcript }) })).json(); }
      catch (e) { el.innerHTML = '<span class="text-neutral-400">講評を取得できませんでした。</span>'; return; }
      if (!d || !d.ok) { el.innerHTML = '<span class="text-neutral-400">' + ((d && d.error) || '講評を生成できませんでした。') + '</span>'; return; }
      const list = (title, arr, cls) => (arr && arr.length) ? `<div class="mb-2.5"><div class="text-[12.5px] font-semibold ${cls} mb-1">${title}</div><ul class="list-disc pl-5 text-[13px] text-neutral-700 space-y-0.5">${arr.map(x => `<li>${String(x).replace(/</g, '&lt;')}</li>`).join('')}</ul></div>` : '';
      el.innerHTML =
        (d.summary ? `<div class="text-[13.5px] text-neutral-800 mb-3">${String(d.summary).replace(/</g, '&lt;')}</div>` : '')
        + list('ヒアリング力で伸ばす', d.hearing, 'text-emerald-700')
        + list('できていない・弱い点', d.notDone, 'text-rose-600')
        + list('次に練習すること', d.practice, 'text-amber-700')
        + list('できていた点', d.good, 'text-neutral-500')
        + '<div class="text-[10.5px] text-neutral-400 mt-1">※ AIによる参考講評。合否の確定は上のチェックが正本です。</div>';
    },

    _score: score, // テスト用
  };
})();
