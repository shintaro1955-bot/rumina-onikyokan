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
  return {
    ready: true, date: day, found: !!me, people: actives.length,
    me: me ? { visits: me.visits, apo: me.apo, walkKm: me.walkKm ?? null } : null,
    team,
    short: me ? {
      visits: short(me.visits, team.visits),
      apo: short(me.apo, team.apo),
      walkKm: (me.walkKm != null && team.walkKm != null) ? short(me.walkKm, team.walkKm) : null,
    } : null,
  };
}
