/* ============================================================
   今日の自分と、今日のみんな（トップ画面の指標）

   出すもの：訪問・アポ・歩いた距離 の3つを、
   「自分の今日」「今日動いているみんなの平均」「あと何件/何km足りないか」で並べる。

   決めごと：
   ・母集団は**その日に実際に動いている人**（その日の記録があり訪問か稼働がある）。
     月全体の平均を出すと、今日の感覚と合わない。
   ・歩行距離はGPS打刻から出すので**実測がある人が限られる**（本番で73/132）。
     平均は実測がある人だけで取り、無ければ距離の行そのものを出さない。
   ・クローザーは訪問・アポの物差しが違うので母集団から外す。
   ============================================================ */
import * as cyzen from './cyzen.mjs';
import * as walk from './walk.mjs';
import * as walkIngest from './walk-ingest.mjs';

const avg = (xs) => xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;

/* 上位p%の水準。値の大きい順に並べて上位p%の中の「一番下」を取る＝その層に入る境界。
   母数が小さいと1人の当たり日に振り回されるので、最低でも上位5件は見る。 */
function topPct(xs, p = 0.02) {
  const a = xs.filter(v => typeof v === 'number' && isFinite(v)).sort((x, y) => y - x);
  if (a.length < 10) return null;                    // 母数が少なすぎる時は出さない
  const n = Math.max(5, Math.round(a.length * p));
  return +a[Math.min(a.length - 1, n - 1)].toFixed(1);
}

/* 直近N日で一番成績がいい人（アポ数）。追いかける先を実名で見せる。
   営業教育部_RULE「示す数字はトップの実績と全体の傾向。追いかける先を見せる」に沿う。
   ※低調な人の名前は出さない。ここで出すのはトップだけ。 */
export function topPerformer(days = 30) {
  const latest = cyzen.latestDate();
  if (!latest) return null;
  const t = new Date(latest + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (days - 1));
  const from = t.toISOString().slice(0, 10);
  const per = new Map();
  for (const rec of cyzen.records()) {
    if (rec.date < from || rec.date > latest) continue;
    const moving = (rec.visitsSelf > 0) || (rec.visitStamp > 0) || !!rec.workStart || !!rec.workEnd;
    if (!moving) continue;
    const u = cyzen.usersMap().get(rec.code) || {};
    if (/クローザー/.test(u.attr || '')) continue;
    let p = per.get(rec.code);
    if (!p) { p = { code: rec.code, name: u.name || null, days: 0, visits: 0, apo: 0 }; per.set(rec.code, p); }
    p.days++; p.visits += (rec.visitsSelf || 0); p.apo += (rec.apo || 0);
  }
  // 稼働が少なすぎる人の「当たり日」で決めない
  const pool = [...per.values()].filter(p => p.name && p.days >= 5);
  if (!pool.length) return null;
  pool.sort((a, b) => b.apo - a.apo || b.visits - a.visits);
  const w = pool[0];
  return {
    name: w.name, days: w.days, apo: w.apo, visits: w.visits,
    visitsPerDay: +(w.visits / w.days).toFixed(1),
    apoPerDay: +(w.apo / w.days).toFixed(1),
    apoRate: w.visits ? +(w.apo / w.visits * 100).toFixed(1) : null,
  };
}

/* 直近N日の「人ごとの1日あたり平均」を集める。
   ※「人×日」の上位2%を取ると、誰かの一発大きい1日を拾ってしまい、
     誰も継続していない水準（実測で訪問72件/日）が"あるべき姿"になってしまう。
     続けられる水準を出すため、人単位の平均で見る。 */
function recentPerPerson(days = 30) {
  const latest = cyzen.latestDate();
  if (!latest) return { visits: [], apo: [], from: null, to: null, count: 0 };
  const t = new Date(latest + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (days - 1));
  const from = t.toISOString().slice(0, 10);
  const per = new Map();
  for (const rec of cyzen.records()) {
    if (rec.date < from || rec.date > latest) continue;
    const moving = (rec.visitsSelf > 0) || (rec.visitStamp > 0) || !!rec.workStart || !!rec.workEnd;
    if (!moving) continue;
    const u = cyzen.usersMap().get(rec.code) || {};
    if (/クローザー/.test(u.attr || '')) continue;
    let p = per.get(rec.code); if (!p) { p = { d: 0, v: 0, a: 0 }; per.set(rec.code, p); }
    p.d++; p.v += (rec.visitsSelf || 0); p.a += (rec.apo || 0);
  }
  // 稼働が少ない人の当たり日で基準が動かないよう、5日以上出ている人だけ
  const pool = [...per.values()].filter(p => p.d >= 5);
  return {
    visits: pool.map(p => +(p.v / p.d).toFixed(1)),
    apo: pool.map(p => +(p.a / p.d).toFixed(1)),
    from, to: latest, count: pool.length,
  };
}

/**
 * @param {{name?:string, code?:string, date?:string}} opts 本人の氏名か担当者コード。
 */
export function todayGap({ name = '', code = '', date = '' } = {}) {
  if (!cyzen.ready()) return { ready: false };
  const day = date || cyzen.latestDate();
  if (!day) return { ready: false };

  // その日に動いている人（訪問がある、または勤務の記録がある）
  const actives = [];
  for (const rec of cyzen.records()) {
    if (rec.date !== day) continue;
    const moving = (rec.visitsSelf > 0) || (rec.visitStamp > 0) || !!rec.workStart || !!rec.workEnd;
    if (!moving) continue;
    const u = cyzen.usersMap().get(rec.code) || {};
    if (/クローザー/.test(u.attr || '')) continue;
    actives.push({ code: rec.code, name: u.name || null, visits: rec.visitsSelf || 0, apo: rec.apo || 0 });
  }
  if (!actives.length) return { ready: true, date: day, people: 0, found: false };

  // 歩いた距離（実測がある人だけ）。
  // 本番のデータ源は cyzen APIから貯めている walk-ingest。CSV版(walk.mjs)は旧経路のフォールバック。
  const kmBy = new Map();
  if (walkIngest.ready()) {
    for (const r of (walkIngest.dayStats(day).rows || [])) if (r.code) kmBy.set(r.code, r.walkKm);
  } else if (walk.ready()) {
    for (const [c, km] of walk.kmByCodeOn(day)) kmBy.set(c, km);
  }
  const kmVals = [];
  for (const a of actives) { const km = kmBy.get(a.code); if (km != null && km > 0) { a.walkKm = km; kmVals.push(km); } }

  // 距離の目安：今日の実測が5人未満だとその日の平均は当てにならない。
  // その場合は直近30日の「1日あたり歩行距離」の平均を目安にする（GPSが薄い午前中でも出せる）。
  let walkTeam = kmVals.length >= 5 ? avg(kmVals) : null;
  let walkBasis = walkTeam != null ? 'today' : null;
  let walkWhy = null;
  if (walkTeam == null) {
    const src = walkIngest.ready() ? walkIngest : (walk.ready() ? walk : null);
    if (!src) walkWhy = 'GPSの歩行データがありません';
    else {
      try {
        const st = src.stats({ days: 30 });
        const per = (st.rows || []).map(r => r.walkPerDay).filter(v => v > 0);
        if (per.length >= 5) { walkTeam = avg(per); walkBasis = 'recent30'; }
        else walkWhy = `直近30日で歩行の実測がある人が${per.length}人しかありません`;
      } catch (e) { walkWhy = '歩行データの集計に失敗：' + e.message; }
    }
  }
  // あるべき姿＝上位2%の水準（直近30日の人×日から）。歩行はその日の実測から。
  const pd = recentPerPerson(30);
  let walkAll = [];
  if (walkIngest.ready()) { try { walkAll = ((walkIngest.stats({ days: 30 }) || {}).rows || []).map(r => r.walkPerDay).filter(v => v > 0); } catch (e) {} }
  const top = {
    visits: topPct(pd.visits),
    apo: topPct(pd.apo),
    walkKm: topPct(walkAll),
    samplePeople: pd.count, from: pd.from, to: pd.to,
  };

  const team = {
    visits: avg(actives.map(a => a.visits)),
    apo: avg(actives.map(a => a.apo)),
    walkKm: walkTeam,
    walkBasis,                 // today=今日の実測 / recent30=直近30日の1日あたり
    walkWhy,                   // 出せない時の理由（画面には出さず、調査用）
    walkPeople: kmVals.length,
    people: actives.length,
  };

  // 本人
  const key = String(name || '').replace(/\s+/g, '');
  const me = actives.find(a => (code && a.code === code) || (key && String(a.name || '').replace(/\s+/g, '') === key)) || null;

  const short = (mine, t) => (mine == null || t == null) ? null : +(Math.max(0, t - mine)).toFixed(1);
  const shortTo = (t) => me ? {
    visits: short(me.visits, t.visits),
    apo: short(me.apo, t.apo),
    walkKm: (me.walkKm != null && t.walkKm != null) ? short(me.walkKm, t.walkKm) : null,
  } : null;

  const gapTop = shortTo(top);
  return {
    ready: true, date: day, found: !!me, people: actives.length,
    best: topPerformer(30),   // 追いかける先（実名・トップのみ）
    me: me ? { visits: me.visits, apo: me.apo, walkKm: me.walkKm ?? null } : null,
    team, top,
    short: shortTo(team),   // みんなの平均との差（参考）
    shortTop: gapTop,       // あるべき姿（上位2%）との差＝主指標
    focus: me ? focusOf(me, top) : null,
  };
}

/* 乖離のうち、いま手を入れるべき一段を決める（下から順に見る）。
   行動量が足りない人にトークを教えても効かない。 */
function focusOf(me, top) {
  if (top.visits != null && me.visits < top.visits * 0.6) {
    return { rung: '行動量', why: `訪問が上位2%の水準(${top.visits}件)の6割に届いていません。まず母数を作る。`, action: 'field' };
  }
  if (top.apo != null && me.visits > 0 && me.apo === 0) {
    return { rung: 'トーク', why: '訪問はしているのにアポが0件。玄関先の型が崩れている可能性が高い。', action: 'roleplay' };
  }
  if (top.visits != null && me.visits < top.visits) {
    return { rung: '行動量', why: `上位2%は1日${top.visits}件。あと${+(top.visits - me.visits).toFixed(1)}件で同じ土俵に立てます。`, action: 'field' };
  }
  if (top.apo != null && me.apo < top.apo) {
    return { rung: 'トーク', why: `訪問数は足りています。上位2%はこの訪問数からアポ${top.apo}件を作ります。差はトークの型。`, action: 'roleplay' };
  }
  return { rung: '維持', why: '訪問もアポも上位2%の水準にあります。この型を崩さないこと。', action: 'roleplay' };
}
