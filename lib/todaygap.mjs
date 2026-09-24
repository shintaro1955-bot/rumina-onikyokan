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

  // 歩いた距離（実測がある人だけ）
  const kmBy = walk.ready() ? walk.kmByCodeOn(day) : new Map();
  const kmVals = [];
  for (const a of actives) { const km = kmBy.get(a.code); if (km != null && km > 0) { a.walkKm = km; kmVals.push(km); } }

  const team = {
    visits: avg(actives.map(a => a.visits)),
    apo: avg(actives.map(a => a.apo)),
    walkKm: kmVals.length >= 5 ? avg(kmVals) : null,   // 実測が少なすぎる日は距離の比較を出さない
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
