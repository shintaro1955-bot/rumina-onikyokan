/* ============================================================
   個別コーチング通知：アポ版（本人へのDM）
   狙い：「訪問はできているのにアポが取れていない」層＝量OK・質NGだけを叩く。

   物差し＝**トップ営業との差分**（鬼教官の本来の考え方）。
   アポは母数が薄く中央値が0になりがちなので「平均以下」では切れない。
   代わりに『トップ層の決定率で回っていたら何件取れていたはず（期待アポ）』を出し、
   実績がその半分未満で、かつ十分な訪問量がある人だけを名指しする。

   的の絞り方（撃ち間違い防止）：
     - クローザー／休職／利用停止／訪問ゼロは buildFacts で既に除外済み。
     - 「量はある」ゲート：訪問/日が基準(中央値×0.7)以上・窓内訪問が下限以上・稼働日数下限以上。
     - 期待アポが下限(既定2件)以上＝率を語れるだけの母数がある人だけ。
     - トップ層の決定率が算出できない（誰も取れていない）ときは名指ししない。
   ・本人にだけ届く（グループには出さない）。数字は決定論で計算（LLMに委ねない）。
   ・量が足りない人はこの通知の対象外（そちらは行動量コーチ coachdm が担当）。
   ============================================================ */
import { buildFacts } from './digest.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';

/* 実績が期待アポの何割未満なら指導対象か。0.5＝トップ率で回った場合の半分未満。 */
const APO_SHORTFALL = Number(process.env.APO_SHORTFALL || 0.5);
/* 率を評価するのに最低限必要な窓内訪問数。これ未満はサンプル不足で判定しない。 */
const APO_VISIT_FLOOR = Number(process.env.APO_VISIT_FLOOR || 20);
/* 最低稼働日数。これ未満は判定しない。 */
const APO_DAY_FLOOR = Number(process.env.APO_DAY_FLOOR || 5);
/* 期待アポの下限。これ未満（＝母数が薄い人）は率で叩かない。 */
const APO_MIN_EXPECTED = Number(process.env.APO_MIN_EXPECTED || 2);
/* 「トップ層」を量OK母集団の上位何割で定義するか。0.25＝上位25%の平均を標準率にする。 */
const APO_TOP_FRAC = Number(process.env.APO_TOP_FRAC || 0.25);
/* 量OK母集団がこれ未満ならトップ率が不安定なので判定を止める（誤爆防止）。 */
const APO_MIN_ELIGIBLE = Number(process.env.APO_MIN_ELIGIBLE || 8);

/* 寺子屋（社内研修）の案内。DATA_DIR/terakoya.json に置く。無ければ案内しない。 */
function terakoya() {
  try {
    const p = join(DATA_DIR, 'terakoya.json');
    if (!existsSync(p)) return null;
    const t = JSON.parse(readFileSync(p, 'utf8'));
    const sessions = (t.sessions || []).filter(s => s && s.date);
    if (!sessions.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const next = sessions.filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
              || sessions.sort((a, b) => b.date.localeCompare(a.date))[0];
    return { ...t, next };
  } catch (e) { console.warn('[coachapo] terakoya.json 読込失敗:', e.message); return null; }
}
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDate(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(${WD[d.getUTCDay()]})`;
}
/** 訪問100件あたりのアポ数（＝アポ率×100）。小数1桁。 */
const per100Of = (apo, visits) => (visits > 0 ? +(apo / visits * 100).toFixed(1) : 0);

/**
 * 「訪問はあるのにアポが取れていない」人ごとの本人向けメッセージを作る。
 * @param {{all?:boolean}} opts all=true なら量OK母集団の全員（下回っていない人も参考出力）
 */
export function buildApoMessages(opts = {}) {
  const f = buildFacts();
  if (!f) return { ok: false, error: 'cyzenのデータがありません' };

  // 量はある人だけを土台にする（訪問が中央値ラインに乗っていて、サンプルも足りる）。
  const eligible = f.ranked.filter(r =>
    r.vpd >= f.threshold && r.visits >= APO_VISIT_FLOOR && r.days >= APO_DAY_FLOOR
  ).map(r => ({ ...r, per100: per100Of(r.apo, r.visits) }));

  if (eligible.length < APO_MIN_ELIGIBLE) {
    return { ok: true, window: f.window, eligibleCount: eligible.length, count: 0, messages: [],
      note: `判定対象（量が足りている人）が${eligible.length}名で、トップ率が安定しないため今回は名指しを止めました。` };
  }

  // トップ層の決定率（＝標準率）。上位25%の per100 の平均。単一外れ値に振られにくい。
  const topN = Math.max(1, Math.round(eligible.length * APO_TOP_FRAC));
  const topRates = [...eligible].sort((a, b) => b.per100 - a.per100).slice(0, topN);
  const stdRate = +(topRates.reduce((s, r) => s + r.per100, 0) / topN).toFixed(1);   // 訪問100件あたり
  const topPer100 = topRates[0].per100;

  if (stdRate <= 0) {
    return { ok: true, window: f.window, eligibleCount: eligible.length, stdRate, count: 0, messages: [],
      note: '量OK母集団の誰もアポを取れておらず、トップ率が出せないため今回は名指しを止めました。' };
  }

  // 各人の期待アポ（トップ率で回った場合）と、その充足率。
  const scored = eligible.map(e => {
    const expected = +(e.visits * stdRate / 100).toFixed(1);
    const fill = expected > 0 ? e.apo / expected : 1;               // 実績 ÷ 期待
    return { ...e, expected, fill };
  });

  // 対象＝十分な母数（期待アポ≥下限）があるのに、実績が期待の半分未満。
  const targets = (opts.all
      ? scored.filter(s => s.expected >= APO_MIN_EXPECTED)
      : scored.filter(s => s.expected >= APO_MIN_EXPECTED && s.apo < s.expected * APO_SHORTFALL))
    .sort((a, b) => a.fill - b.fill);

  const T = terakoya();
  const messages = targets.map(me => {
    const below = me.apo < me.expected * APO_SHORTFALL;
    const short = Math.max(0, Math.round(me.expected - me.apo));    // トップ率なら「あと何件」

    const L = [];
    L.push(`${me.name} さん`);
    L.push('');
    L.push('【あなたの動き】');
    L.push(`直近${f.window.days}日（${f.window.from}〜${f.window.to}）`);
    L.push('');
    L.push(`■ 訪問数：${me.vpd}件/日（計${me.visits}件・稼働${me.days}日）`);
    L.push('　ここは足りている。よく回れている。');
    L.push('');
    L.push(`■ アポ：${me.apo}件`);
    L.push(`　トップ層は訪問100件あたり ${stdRate}件（最高 ${topPer100}件）決めている。`);
    L.push(`　お前の${me.visits}件なら、その決め方で ${me.expected}件は取れている数字だ。`);
    L.push('');
    if (below) {
      L.push('■ 問題は量じゃない。質だ。');
      if (me.apo <= 0) {
        L.push(`　これだけ回れているのにアポはゼロ。トップなら${me.expected}件だ。足は動いている、刺さっていないだけだ。`);
      } else {
        L.push(`　${me.visits}件も回って${me.apo}件。トップの決め方なら${me.expected}件、あと${short}件は取れていた。`);
      }
      L.push('　足で稼ぐ段階は終わってる。次に上げるのは"刺さり"だ。');
      L.push('');
      L.push('■ 明日やること');
      L.push('　名乗った直後の最初のひと言と、断られた後の一手。差はここで出る。');
      L.push('　次の訪問10件、"入口の15秒"だけ意識して回れ。回数は変えるな、中身を変えろ。');
    } else {
      L.push('■ アポの取り切りは基準に乗っている。量も質も足りている。この状態を落とすな。');
    }
    L.push('');
    if (T && below) {
      L.push(`■ ${T.name || '寺子屋'}に入れ`);
      if (T.description) L.push(`　${T.description}`);
      const n = T.next;
      L.push(`　次回 ${fmtDate(n.date)}${n.time ? ' ' + n.time : ''}${n.place ? ' ／ ' + n.place : ''}`);
      if (n.theme) L.push(`　テーマ：${n.theme}`);
      if (T.howToJoin) L.push(`　参加：${T.howToJoin}`);
      L.push('');
    }
    L.push(below ? '回れているのは価値だ。あとは決め方だけ。数字は必ず追え。'
                 : 'いいペースだ。そのまま積め。');

    return {
      code: me.code, name: me.name, vpd: me.vpd, visits: me.visits, days: me.days,
      apo: me.apo, per100: me.per100, expected: me.expected, fill: +me.fill.toFixed(2),
      short, stdRate, topPer100, below,
      message: L.join('\n'),
    };
  });

  return {
    ok: true, window: f.window, eligibleCount: eligible.length,
    stdRate, topPer100, shortfall: APO_SHORTFALL, threshold: f.threshold,
    count: messages.length, messages,
  };
}
