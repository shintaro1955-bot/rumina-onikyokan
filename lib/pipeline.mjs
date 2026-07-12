/* ============================================================
   解析パイプライン（Phase 1）
   Whisperの文字起こし → ピンポン分割(無音ギャップ) → KPI抽出
   → UI互換の AnalysisResult を生成。

   ★正直表示：話者分離(diarization)とGPSが未接続のPhase 1では、
   話者に依存するKPI（在宅反応率/切り返し/アポ）は「推定値」。
   result.quality.estimatedFields と phase1:true で明示する。
   ============================================================ */
import { reconcile } from './gps.mjs';
import { diarize } from './diarize.mjs';

// 断り文句 辞書（一次分類。外れたものだけ将来LLMへ回す＝コスト最適化）
const OBJECTION_DICT = [
  { label: '間に合ってます', re: /(間に合|足りて|もう(入れ|付け)|うち(は)?いい)/ },
  { label: '今忙しい', re: /(忙し|今ちょっと|手が離せ|時間がな|後にして)/ },
  { label: '興味ない', re: /(興味(が)?な|いらな|結構です|必要な)/ },
  { label: '主人がいないと分からない', re: /(主人|旦那|夫|妻|家族|相談し)/ },
  { label: 'うちは持ち家じゃない', re: /(賃貸|持ち家じゃ|借家|大家|アパート)/ },
  { label: '電気は関係ない', re: /(関係な|うちは電気|オール電化じゃ)/ },
];
const OPENING_KW = /(電気代|無料診断|電気の健康診断|明細|検針|エコキュート|太陽光|蓄電池|認定)/;
const APPOINTMENT_RE = /(じゃあ|見て(みる|ます)|来て|お願い|大丈夫です(よ)?|何時|何日|曜日|明日|明後日|来週)/;
const PROSPECT_RE = /(考え|検討|気にな|安くな|どれくらい|いくら|詳しく)/;
// 時間トークン（2つ以上出たら“2択クロージング”とみなす）
const TIME_RE = /(月曜|火曜|水曜|木曜|金曜|土曜|日曜|午前|午後|夕方|夜|朝|明日|明後日|今週|来週|\d+時|何時)/g;

/* ---- 勝ちトーク分析（太陽光蓄電池ドメイン）：なぜアポ/見込みになったかを型で言語化 ---- */
function winMoves(p) {
  const t = p.text || '', m = [];
  if (p.opening) m.push({ key: '冒頭フック', good: '冒頭10秒で「電気の健康診断／明細／電気代」に触れ、名乗りで終わらせず会話に入れた' });
  if (/(明細|検針票|30秒|見させて|拝見|確認させて)/.test(t)) m.push({ key: '明細ドライブ', good: '「明細だけ確認」で警戒を下げ、具体の数字に踏み込めた' });
  if (/(上がって|高く|夜トク|賦課金|値上げ|昼.{0,4}円)/.test(t)) m.push({ key: '問題提起', good: '「電気代が上がっている」を相手の口から引き出し、危機感を共有できた' });
  if (/(太陽光|蓄電池|創蓄|補助金|給湯省エネ|自家消費|貯めて使う|おひさま)/.test(t)) m.push({ key: '創蓄・補助金', good: 'エコキュートを入口に、創蓄・補助金という“今だけ”の価値を提示できた' });
  if (p.objectionType && p.rebuttalCount >= 1) m.push({ key: '切り返し', good: `「${p.objectionType}」の断りを${p.rebuttalCount}回切り返して会話に復帰した` });
  const times = (t.match(TIME_RE) || []).length;
  if (p.appointmentCreated && times >= 2) m.push({ key: '2択クロージング', good: '最後は“AかB”の二択で日程を提示し、断りようのない形でアポを確定させた' });
  else if (p.appointmentCreated) m.push({ key: 'クロージング', good: '会話終盤で自然に訪問・日程の合意を取り付けた' });
  return m;
}
function winTalkAnalysis(pings) {
  const wins = pings.filter(p => p.result === 'apo' || p.result === 'prospect').map(p => {
    const mv = winMoves(p);
    return { ping: p.id, result: p.result, moves: mv.map(x => x.key),
      excerpt: (p.text || '').slice(0, 100),
      why: mv.length ? mv.map(x => x.good).join('。') + '。' : '会話が続き、相手の関心を引き出せた。' };
  });
  const freq = {};
  wins.forEach(w => w.moves.forEach(k => (freq[k] = (freq[k] || 0) + 1)));
  const topMoves = Object.entries(freq).map(([k, n]) => ({ move: k, count: n })).sort((a, b) => b.count - a.count);
  const summary = topMoves.length
    ? `この録音の勝ち筋は主に「${topMoves.slice(0, 2).map(x => x.move).join('」「')}」。この型を全員に写せば再現できる。`
    : 'アポ・見込みが取れた訪問がまだありません。';
  return { wins, topMoves, summary };
}

/**
 * @param {Array<{startSec,endSec,text,confidence}>} segments  絶対秒の文字起こし
 * @param {{durationSec:number|null, startHour:number, salesRep:object, benchmark:object}} ctx
 */
export function analyze(segments, ctx) {
  const VISIT_GAP = +(process.env.VISIT_GAP_SEC || 60);   // これ以上の無音=別訪問（SPEC §5）
  const IDLE_GAP = +(process.env.IDLE_GAP_SEC || 1200);   // 20分以上の空白=サボり疑い候補
  const startHour = ctx.startHour ?? 9;
  const b = ctx.benchmark;

  // ---- ⓪ 話者分離（既定＝ヒューリスティック。'none'で無効化） ----
  const diarMethod = ctx.diarize === undefined ? 'heuristic' : ctx.diarize;
  segments = diarize(segments, diarMethod);
  const diarized = diarMethod !== 'none';

  // ---- ① ピンポン分割（無音ギャップでクラスタ化） ----
  const clusters = [];
  let cur = null;
  for (const s of segments) {
    if (!cur || s.startSec - cur.endSec > VISIT_GAP) {
      cur = { startSec: s.startSec, endSec: s.endSec, speechSec: 0, segs: [] };
      clusters.push(cur);
    }
    cur.endSec = s.endSec;
    cur.speechSec += Math.max(0, s.endSec - s.startSec);
    cur.segs.push(s);
  }

  // ---- ② PingEvent 化＋各種フラグ（話者分離済みなら会話構造から実算出） ----
  const pings = clusters.map((c, i) => {
    const text = c.segs.map(s => s.text).join(' ');
    const salesSegs = c.segs.filter(s => s.speaker === 'sales');
    const custSegs = c.segs.filter(s => s.speaker === 'customer');
    const custSec = custSegs.reduce((x, s) => x + Math.max(0, s.endSec - s.startSec), 0);

    // 在宅反応：お客様の発話が実際にあったか（話者分離ありの主判定）。無ければ会話長で近似。
    const customerSpoke = diarized ? custSec >= 3 : c.speechSec >= 10;
    const conversation = diarized ? (customerSpoke && c.speechSec >= 10) : c.speechSec >= 10;
    const reaction = customerSpoke ? '対面' : (c.speechSec > 0 ? 'インターホンのみ' : '不在');

    // 冒頭質問：営業の最初の一手（分離ありは sales セグに限定）
    const openingSrc = (diarized ? salesSegs : c.segs).filter(s => s.startSec - c.startSec <= 10).map(s => s.text).join(' ');
    const opening = customerSpoke && (/[?？]/.test(openingSrc) || OPENING_KW.test(openingSrc));

    // 断り：お客様セグメントから検出（分離ありは cust に限定）
    const objSrc = diarized ? custSegs.map(s => s.text).join(' ') : text;
    const objection = OBJECTION_DICT.find(o => o.re.test(objSrc));

    // 切り返し：お客様の断りターンの直後に営業ターンが続いた回数（分離あり＝実カウント）
    let rebuttals = 0;
    if (objection && diarized) {
      for (let k = 0; k < c.segs.length - 1; k++) {
        if (c.segs[k].speaker === 'customer' && objection.re.test(c.segs[k].text) && c.segs[k + 1].speaker === 'sales') rebuttals++;
      }
    } else if (objection) {
      rebuttals = c.segs.filter(s => o_after(s, c, objection)).length;
    }

    const appointment = APPOINTMENT_RE.test(text) && conversation;
    const prospect = !appointment && PROSPECT_RE.test(text) && customerSpoke;
    return {
      id: 'pe' + (i + 1),
      hour: startHour + Math.floor(c.startSec / 3600),
      startSec: c.startSec, endSec: c.endSec, durationSec: Math.round(c.endSec - c.startSec),
      speechSec: Math.round(c.speechSec), customerSpeechSec: Math.round(custSec),
      result: appointment ? 'apo' : prospect ? 'prospect' : conversation ? 'talk' : 'reject',
      customerReaction: reaction,
      objectionType: objection ? objection.label : null,
      rebuttalCount: rebuttals,
      appointmentCreated: appointment,
      prospectLevel: appointment ? 3 : prospect ? 2 : conversation ? 1 : 0,
      opening, conversation, customerSpoke, text,
    };
  });

  // ---- ③ KPI集計 ----
  const totalPings = pings.length;
  const convPings = pings.filter(p => p.conversation);
  const homeResp = pings.filter(p => p.customerSpoke).length;         // 在宅＝お客様が実際に応答した件数
  const apo = pings.filter(p => p.appointmentCreated).length;
  const prospect = pings.filter(p => p.result === 'prospect').length;
  const openCount = pings.filter(p => p.opening).length;
  const rebuttalTotal = pings.reduce((x, p) => x + p.rebuttalCount, 0);
  const objected = pings.filter(p => p.objectionType).length;
  const totalSpeech = pings.reduce((x, p) => x + p.speechSec, 0);
  const dur = ctx.durationSec || (segments.length ? segments[segments.length - 1].endSec : 0);

  // サボり疑い：クラスタ間ギャップのうち IDLE_GAP 超の合計
  let idleSec = 0, biggest = { gap: 0, at: 0 };
  for (let i = 1; i < clusters.length; i++) {
    const gap = clusters[i].startSec - clusters[i - 1].endSec;
    if (gap > IDLE_GAP) { idleSec += gap; if (gap > biggest.gap) biggest = { gap, at: clusters[i - 1].endSec }; }
  }

  // 断り文句ランキング TOP5
  const objMap = {};
  pings.forEach(p => { if (p.objectionType) objMap[p.objectionType] = (objMap[p.objectionType] || 0) + 1; });
  const objectionRanking = Object.entries(objMap).map(([label, count]) => ({ label, count }))
    .sort((a, z) => z.count - a.count).slice(0, 5);

  // 時間帯別 活動密度
  const hourMap = {};
  pings.forEach(p => {
    const h = (hourMap[p.hour] ||= { hour: p.hour, ping: 0, home: 0, talk: 0 });
    h.ping++; if (p.customerSpoke) h.home++; if (p.conversation) h.talk++;
  });
  const hourly = Object.values(hourMap).sort((a, z) => a.hour - z.hour);

  // ---- Phase 2：GPS照合（あれば空白を裏取り＋総ピンポン数を自動算出） ----
  const gps = ctx.gps ? reconcile(ctx.gps, segments) : null;
  const suspiciousIdle = gps ? gps.verifiedIdleMinutes : Math.round(idleSec / 60);

  // 総ピンポン数：GPSの停止クラスタ数が会話数以上なら自動採用（不在も含む真の分母）
  const pingCountFromGps = !!(gps && gps.totalStops >= totalPings);
  const denom = pingCountFromGps ? gps.totalStops : totalPings;

  // 確定アポ数：CRMから渡されれば自動採用（文面推定を上書き）
  const crmApo = ctx.crmAppointmentCount;
  const apoConfirmed = crmApo != null && Number.isFinite(crmApo);
  const apoCount = apoConfirmed ? crmApo : apo;

  const rate = (x, y) => y ? +(x / y * 100).toFixed(1) : 0;
  const avgConv = convPings.length ? Math.round(convPings.reduce((x, p) => x + p.speechSec, 0) / convPings.length) : 0;

  const analysis = {
    salesRepName: ctx.salesRep?.name || '対象営業マン',
    team: ctx.salesRep?.team || '', date: ctx.date || '',
    totalPings: denom,
    conversationPings: totalPings,        // 会話が録れた件数（参考）
    targetPings: b.targetPings,
    targetAchievementRate: rate(denom, b.targetPings),
    workdayIndex: ctx.salesRep?.workdayIndex ?? null,
    workdayCount: ctx.salesRep?.workdayCount ?? 22,
    homeResponseCount: homeResp,
    homeResponseRate: rate(homeResp, denom),
    conversationCount: convPings.length,
    conversationRate: rate(convPings.length, denom),
    averageConversationSeconds: avgConv,
    appointmentCount: apoCount,
    appointmentRate: rate(apoCount, denom),
    prospectCount: prospect,
    prospectRate: rate(prospect, denom),
    averageRebuttalCount: objected ? +(rebuttalTotal / objected).toFixed(1) : 0,
    openingQuestionRate: rate(openCount, totalPings),
    silentTimeMinutes: Math.max(0, Math.round((dur - totalSpeech) / 60)),
    suspiciousIdleTimeMinutes: suspiciousIdle,
    suspiciousWindow: biggest.gap ? clock(startHour, biggest.at) + '〜' + clock(startHour, biggest.at + biggest.gap) : '—',
    movingTimeMinutes: gps ? gps.movingTimeMinutes : null,
    gps: gps ? { connected: true, movingTimeMinutes: gps.movingTimeMinutes, stayTimeMinutes: gps.stayTimeMinutes, verifiedIdleMinutes: gps.verifiedIdleMinutes, visitClusters: gps.visitClusters, noAnswerStops: gps.noAnswerStops, totalStops: gps.totalStops } : { connected: false },
    objectionRanking,
    hourly,
    winTalk: winTalkAnalysis(pings),
    // 総合スコア：主要KPIのトップ比平均（0-100）※確定後の分母/アポで計算
    coachScore: coachScore({ totalPings: denom, homeResponseRate: rate(homeResp, denom), averageConversationSeconds: avgConv, averageRebuttalCount: objected ? rebuttalTotal / objected : 0, appointmentRate: rate(apoCount, denom), openingQuestionRate: rate(openCount, totalPings) }, b),
    phase1: true,
    quality: (() => {
      // 正直表示：分母(総ピンポン数)がGPS確定ならば率は推定から外れる。アポ判定はCRM確定まで文面推定。
      const est = [];
      if (!pingCountFromGps) est.push('homeResponseRate', 'conversationRate');
      if (!apoConfirmed) est.push('appointmentRate');
      if (diarMethod === 'none') est.push('averageRebuttalCount', 'customerReaction');
      if (!gps) est.push('suspiciousIdleTimeMinutes');
      const notes = [];
      notes.push(diarMethod === 'acoustic' ? '話者分離：音響（確定）。'
        : diarMethod === 'heuristic' ? '話者分離：発話内容ベースの推定（音響ではない・精度中）。'
        : '話者分離：未接続。会話系KPIは推定。');
      notes.push(pingCountFromGps ? `総ピンポン数：GPS停止クラスタから自動算出（${gps.totalStops}件＝訪問${gps.visitClusters}+不在${gps.noAnswerStops}）。`
        : '総ピンポン数：会話数ベース。GPS/カウンターで確定要。');
      notes.push(apoConfirmed ? 'アポ数：CRMから自動取得（確定）。' : 'アポ率：文面判定＝CRM/結果入力で確定。');
      notes.push(gps ? 'GPS照合済：空白は移動/接客/実サボりに裏取り済み。' : 'GPS未接続：サボりは要裏取り。');
      return {
        engine: 'whisper',
        speakerSeparation: diarMethod,
        gps: gps ? 'connected' : 'none',
        pingCountSource: pingCountFromGps ? 'gps' : 'transcript',
        crm: apoConfirmed ? 'connected' : 'none',
        hasDuration: ctx.durationSec != null,
        lowConfRatio: +(segments.filter(s => s.confidence < 0.6).length / Math.max(1, segments.length)).toFixed(2),
        estimatedFields: est,
        note: notes.join(' '),
      };
    })(),
  };
  return { analysis, pings, transcript: segments };
}

// 断り語セグメント以降で、そのクラスタ内に発話が続いたか（切り返しの近似カウント）
function o_after(seg, cluster, obj) {
  if (!obj.re.test(seg.text)) return false;
  return cluster.segs.some(s => s.startSec > seg.endSec);
}

function coachScore(a, b) {
  const ratios = [
    a.totalPings / b.targetPings,
    a.homeResponseRate / b.homeResponseRate,
    a.averageConversationSeconds / b.averageConversationSeconds,
    a.averageRebuttalCount / b.averageRebuttalCount,
    a.appointmentRate / b.appointmentRate,
    a.openingQuestionRate / b.openingQuestionRate,
  ].map(r => Math.max(0, Math.min(1.2, r || 0)));
  return Math.round(ratios.reduce((x, y) => x + y, 0) / ratios.length * 100);
}

function clock(startHour, sec) {
  const total = startHour * 3600 + sec;
  const h = Math.floor(total / 3600) % 24, m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const DOMAIN_PROMPT = '電気代 明細 無料診断 検針票 kWh 東京電力 関西電力 オール電化 太陽光 蓄電池 インターホン 訪問';
