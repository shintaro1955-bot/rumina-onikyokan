/* ============================================================
   歩行距離のライブ取り込み（cyzen APIのGPS履歴から）

   GPS履歴は月あたり数十万件あり、毎回まるごと取ると重い。
   そこで「直近数日ぶんだけ取り、担当者×日ごとの距離に畳んで貯める」。
   1日ぶんに畳んでしまえば1件100バイト程度なので、何ヶ月ぶんでも軽い。

   距離は walk.mjs と同じ考え方で、隣り合う打刻の速度から
   歩き（時速7.2km以下）と車などの移動を分けて積み上げる。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';
import * as api from './cyzen-api.mjs';

const FILE = join(DATA_DIR, 'walk-daily.json');

/* 歩行とみなす上限速度(m/s)。2.0=時速7.2km。これを超えたら車・電車扱い。 */
const WALK_MAX_MS = Number(process.env.WALK_MAX_SPEED || 2.0);
/* 空白がこれ以上なら連続移動とみなさない（滞在をまたぐため） */
const GAP_MAX_SEC = Number(process.env.WALK_GAP_MAX || 1800);
/* 1区間がこれ以上は測位エラーとして捨てる */
const JUMP_MAX_M = Number(process.env.WALK_JUMP_MAX || 20000);
/* 1回の取り込みで遡る日数。既定2日（当日＋前日）。後から届く打刻を拾い直すため。 */
const BACK_DAYS = Math.max(1, Number(process.env.WALK_INGEST_DAYS || 2));

const R = 6371000;
function haversine(la1, lo1, la2, lo2) {
  const p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
  const dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); }
  catch (e) { return { days: {}, users: {}, updatedAt: null }; }
}
function save(db) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  writeFileSync(FILE, JSON.stringify(db));
}

export const ready = () => existsSync(FILE);
export const file = () => FILE;

/* cyzenの日時は "2026-08-31 11:30:00" のように時差が付かない形で来ることがある。
   そのまま Date.parse するとサーバーのタイムゾーン（本番はUTC）で読まれて9時間ずれ、
   日付の区切りが狂う。時差の表記が無ければ日本時間として読む。 */
function parseTs(ts) {
  const str = String(ts).trim();
  if (!str) return NaN;
  const hasTz = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(str);
  const t = Date.parse(str.replace(' ', 'T') + (hasTz ? '' : '+09:00'));
  return Number.isFinite(t) ? t : NaN;
}

/* 打刻の緯度経度・日時・担当者を、APIの項目名の揺れを吸収して取り出す。
   cyzenの実際の項目名は history_latitude / history_longitude / create_at
   （created_at ではない）。他は将来の変更に備えた別名。 */
function pick(h, miss) {
  const lat = Number(h.history_latitude ?? h.latitude ?? h.lat ?? h.gps_latitude);
  const lon = Number(h.history_longitude ?? h.longitude ?? h.lon ?? h.lng ?? h.gps_longitude);
  const ts = h.create_at || h.created_at || h.datetime || h.date_time || h.recorded_at || h.date;
  const uid = h.user_id ?? h.userId ?? h.user?.id;
  if (miss) {
    if (!Number.isFinite(lat)) miss.lat++;
    if (!Number.isFinite(lon)) miss.lon++;
    if (!ts) miss.ts++;
    if (uid == null) miss.uid++;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ts || uid == null) return null;
  const t = parseTs(ts);
  if (!Number.isFinite(t)) return null;
  return { uid: String(uid), t, lat, lon, area: areaOf(h.address || h.spot_address || ''),
           rid: (h.report_id != null && h.report_id !== '') ? String(h.report_id) : '' };
}

/* 打刻の所在地から「市区町村」までを取り出す。
   個人の移動経路そのものは残さない。エリア別の傾向を見るのが目的なので、
   番地までは要らないし、持つと用途を超える（2026-09-01）。
   例: 「神奈川県川崎市中原区小杉町1-2-3」→「神奈川県川崎市中原区」 */
export function areaOf(address) {
  const a = String(address || '').replace(/\s+/g, '').replace(/^日本[,、]?/, '');
  if (!a) return '';
  const m = a.match(/^(.+?[都道府県])(.+?[市区町村])?(.+?[区町村])?/);
  if (!m) return '';
  const pref = m[1] || '';
  let city = m[2] || '';
  // 政令市は「川崎市中原区」まで取る（市だけだと粗すぎる）
  if (/市$/.test(city) && m[3] && /区$/.test(m[3])) city += m[3];
  return (pref + city) || '';
}


/* 打刻が「ルート自動記録（既定4分ごと）」で取れているのか、
   それとも報告書の提出時など出来事のときだけ点いているのかを見分ける。
   ・間隔の中央値が4分前後 → ルート自動記録が動いている
   ・間隔が数十分〜数時間 → 出来事のときだけ＝距離は実際の歩行を大きく下回る
   位置の値は一切返さず、間隔と件数の統計だけを返す。 */
function shapeOf(rows, bucket) {
  const gaps = [];
  for (const pts of bucket.values()) {
    pts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < pts.length; i++) gaps.push((pts[i].t - pts[i - 1].t) / 1000);
  }
  gaps.sort((a, b) => a - b);
  const q = (f) => (gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * f))]) : null);
  let withReport = 0;
  const status = {};
  for (const h of rows) {
    if (h.report_id != null && h.report_id !== '') withReport++;
    const k = String(h.status_id ?? '-');
    status[k] = (status[k] || 0) + 1;
  }
  return {
    gapMedianSec: q(0.5), gapP25Sec: q(0.25), gapP75Sec: q(0.75),
    under6min: gaps.length ? Math.round(gaps.filter((g) => g <= 360).length / gaps.length * 100) : 0,
    pointsPerUserDay: bucket.size ? +(rows.length / bucket.size).toFixed(1) : 0,
    withReportPct: rows.length ? Math.round(withReport / rows.length * 100) : 0,
    status,
  };
}

/* 日本時間の YYYY-MM-DD（打刻の並びを日でまとめるため） */
function jstDay(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 直近 BACK_DAYS 日ぶんのGPS履歴を取り、担当者×日の距離に畳んで保存する。
 * 取り直した日は上書きするので、何度走らせても二重計上にならない。
 */
export async function ingestWalk({ days = BACK_DAYS } = {}) {
  if (!api.ready()) return { ok: false, error: 'cyzen API未設定' };
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);

  let rows = [];
  try { rows = await api.fetchHistories(from, to); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 120) }; }
  // 打刻には報告書IDが付いている（約半数）。同じ期間の報告書を引いて種類を突き合わせ、
  // 「アポ獲得報告が出た場所（市区町村）」を数えられるようにする。報告書が取れなくても距離集計は続ける。
  const apoReport = new Set();
  try {
    const reps = await api.fetchReports(from, to);
    for (const r of reps) {
      const id = r.report_id ?? r.id; if (id == null || id === '') continue;
      const name = String(r.report_definition_name ?? r.report_name ?? '').normalize('NFKC');
      if (name.includes('アポ獲得')) apoReport.add(String(id));
    }
  } catch (e) { /* 報告書が引けない日はエリア別アポを空のままにする */ }
  if (!rows.length) return { ok: false, error: 'GPS履歴が0件' };

  // 担当者コード・氏名を引くためのユーザー表
  let users = new Map();
  try {
    const us = await api.fetchUsers();
    for (const u of us) {
      const id = String(u.id ?? u.user_id ?? '');
      if (id) users.set(id, { code: u.code || u.user_code || '', name: u.name || u.user_name || '', group: u.group_name || u.group || '' });
    }
  } catch (e) {}

  // 担当者×日ごとに打刻を並べる
  const bucket = new Map();
  // 1件も読めなかったときに原因を言えるよう、どの項目で落ちたかを数える
  const miss = { lat: 0, lon: 0, ts: 0, uid: 0 };
  for (const h of rows) {
    const p = pick(h, miss);
    if (!p) continue;
    const k = p.uid + '|' + jstDay(p.t);
    let b = bucket.get(k); if (!b) { b = []; bucket.set(k, b); }
    b.push(p);
  }
  // 打刻はあるのに1件も読めない＝APIの項目名が想定と違う。項目名だけを返す（値は返さない）。
  if (!bucket.size && rows.length) {
    return { ok: false, error: '項目名が不一致', histories: rows.length, days: 0, users: 0,
             miss, keys: Object.keys(rows[0] || {}).slice(0, 40) };
  }

  const db = load();
  let touched = 0;
  for (const [k, pts] of bucket) {
    pts.sort((a, b) => a.t - b.t);
    let walk = 0, ride = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dt = (b.t - a.t) / 1000;
      if (!(dt > 0) || dt > GAP_MAX_SEC) continue;
      const m = haversine(a.lat, a.lon, b.lat, b.lon);
      if (m > JUMP_MAX_M) continue;
      if (m / dt <= WALK_MAX_MS) walk += m; else ride += m;
    }
    // その日どのエリアにいたかを打刻数で数える（経路ではなく、居た場所の分布）
    const areaCount = {};
    for (const p of pts) { if (p.area) areaCount[p.area] = (areaCount[p.area] || 0) + 1; }
    const [uid, date] = k.split('|');
    const apoAreas = {};
    for (const p of pts) if (p.rid && apoReport.has(p.rid) && p.area) apoAreas[p.area] = (apoAreas[p.area] || 0) + 1;
    db.days[k] = { uid, date, walkM: Math.round(walk), rideM: Math.round(ride), points: pts.length, areas: areaCount, apoAreas };
    const u = users.get(uid);
    if (u && (u.name || u.code)) db.users[uid] = u;
    touched++;
  }
  db.updatedAt = new Date().toISOString();
  save(db);
  const ds = [...bucket.keys()].map((k) => k.split('|')[1]).sort();
  return { ok: true, histories: rows.length, days: touched,
           users: db.users ? Object.keys(db.users).length : 0,
           span: ds.length ? ds[0] + '〜' + ds[ds.length - 1] : null,
           shape: shapeOf(rows, bucket) };
}

/**
 * 担当者ごとの歩行指標。walk.mjs の stats() と同じ形で返すので、
 * CSVがある環境と無い環境で画面側を変えなくてよい。
 */
export function stats({ days = 30, visitsByCode = null } = {}) {
  const db = load();
  const all = Object.values(db.days || {});
  if (!all.length) return { ready: false, rows: [] };

  let latest = null;
  for (const r of all) if (!latest || r.date > latest) latest = r.date;
  let from = null;
  if (latest) {
    const t = new Date(latest + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (days - 1));
    from = t.toISOString().slice(0, 10);
  }

  const per = new Map();
  for (const r of all) {
    if (from && (r.date < from || r.date > latest)) continue;
    if (r.walkM <= 0 && r.rideM <= 0) continue;
    let p = per.get(r.uid);
    if (!p) { p = { uid: r.uid, walkM: 0, rideM: 0, days: 0, points: 0 }; per.set(r.uid, p); }
    p.walkM += r.walkM; p.rideM += r.rideM; p.days++; p.points += r.points;
  }

  const rows = [...per.values()].map((p) => {
    const u = (db.users || {})[p.uid] || {};
    const walkKm = +(p.walkM / 1000).toFixed(1);
    const rideKm = +(p.rideM / 1000).toFixed(1);
    const total = p.walkM + p.rideM;
    const v = visitsByCode && u.code ? visitsByCode.get(u.code) : null;
    const visits = v ? v.visits : null;
    return {
      code: u.code || p.uid, name: u.name || u.code || p.uid, group: u.group || '',
      days: p.days, walkKm, rideKm,
      walkPerDay: +(walkKm / p.days).toFixed(1),
      ridePerDay: +(rideKm / p.days).toFixed(1),
      walkRatio: total > 0 ? Math.round(p.walkM / total * 100) : 0,
      visits,
      visitsPerKm: (visits != null && walkKm > 0) ? +(visits / walkKm).toFixed(1) : null,
    };
  }).sort((a, z) => z.walkKm - a.walkKm);

  const totalWalk = +(rows.reduce((n, r) => n + r.walkKm, 0)).toFixed(0);
  const med = ((xs) => { if (!xs.length) return 0; const a = [...xs].sort((p, q) => p - q), m = a.length >> 1;
    return +(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2).toFixed(1); })(rows.map((r) => r.walkPerDay));

  return {
    ready: true, source: 'api',
    window: { from, to: latest, days },
    count: rows.length, totalWalkKm: totalWalk, medianWalkPerDay: med,
    updatedAt: db.updatedAt || null,
    rows,
  };
}

/** 指定した年月（JST・'YYYY-MM'）だけの集計。月が替われば自然にゼロから積み直る。 */
export function monthStats(ym, visitsByCode = null) {
  const db = load();
  const all = Object.values(db.days || {}).filter((r) => String(r.date || '').slice(0, 7) === ym);
  if (!all.length) return { ready: false, ym, rows: [], totalWalkKm: 0, count: 0 };

  const per = new Map();
  let from = null, to = null;
  for (const r of all) {
    if (r.walkM <= 0 && r.rideM <= 0) continue;
    if (!from || r.date < from) from = r.date;
    if (!to || r.date > to) to = r.date;
    let p = per.get(r.uid);
    if (!p) { p = { uid: r.uid, walkM: 0, rideM: 0, days: 0 }; per.set(r.uid, p); }
    p.walkM += r.walkM; p.rideM += r.rideM; p.days++;
  }
  const rows = [...per.values()].map((p) => {
    const u = (db.users || {})[p.uid] || {};
    const walkKm = +(p.walkM / 1000).toFixed(1);
    const v = visitsByCode && u.code ? visitsByCode.get(u.code) : null;
    return {
      code: u.code || p.uid, name: u.name || u.code || p.uid, group: u.group || '',
      days: p.days, walkKm, rideKm: +(p.rideM / 1000).toFixed(1),
      walkPerDay: +(walkKm / p.days).toFixed(1),
      visits: v ? v.visits : null,
    };
  }).sort((a, z) => z.walkKm - a.walkKm);

  return {
    ready: true, ym, source: 'api',
    window: { from, to, days: rows.length ? 0 : 0 },
    count: rows.length,
    totalWalkKm: +(rows.reduce((n, r) => n + r.walkKm, 0)).toFixed(0),
    updatedAt: db.updatedAt || null,
    rows,
  };
}

/* 人ごとの「どのエリアで動いたか」。ym を渡せばその月、無ければ直近days日。
   打刻数の比率で出す。件数そのものではなく比率にするのは、打刻の密度が
   端末や設定で変わるため（絶対数だと人の間で比べられない）。 */
export function areaStats({ ym = '', days = 30, top = 3 } = {}) {
  const db = load();
  const all = Object.values(db.days || {});
  const rows = ym
    ? all.filter((r) => String(r.date || '').slice(0, 7) === ym)
    : (() => {
        const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        return all.filter((r) => String(r.date || '') >= from);
      })();
  const per = new Map();
  for (const r of rows) {
    if (!r.areas) continue;
    let p = per.get(r.uid);
    if (!p) { p = { uid: r.uid, total: 0, areas: {}, days: 0 }; per.set(r.uid, p); }
    p.days++;
    for (const [a, n] of Object.entries(r.areas)) { p.areas[a] = (p.areas[a] || 0) + n; p.total += n; }
  }
  const out = [];
  for (const p of per.values()) {
    const u = (db.users || {})[p.uid] || {};
    const list = Object.entries(p.areas)
      .map(([area, n]) => ({ area, share: Math.round(n / p.total * 100) }))
      .sort((a, z) => z.share - a.share).slice(0, top);
    if (!list.length) continue;
    out.push({ code: u.code || p.uid, name: u.name || u.code || p.uid, days: p.days, areas: list, main: list[0].area });
  }
  out.sort((a, z) => z.days - a.days);
  return { ready: out.length > 0, ym: ym || null, days: ym ? null : days, count: out.length, rows: out, updatedAt: db.updatedAt || null };
}

/** アポ獲得報告が多く上がっているエリア（市区町村）。
 *  ym（YYYY-MM）を指定すればその月、無ければ直近 days 日。
 *  各エリアに「誰が何件」を添えるので、ノウハウ共有の宛先が分かる。 */
export function hotAreas({ ym = '', days = 30, top = 5 } = {}) {
  const db = load();
  const all = Object.values(db.days || {});
  const rows = ym
    ? all.filter((r) => String(r.date || '').slice(0, 7) === ym)
    : (() => { const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); return all.filter((r) => String(r.date || '') >= from); })();
  const per = new Map();
  let totalApo = 0;
  for (const r of rows) {
    if (!r.apoAreas) continue;
    for (const [area, n] of Object.entries(r.apoAreas)) {
      let a = per.get(area);
      if (!a) { a = { area, apo: 0, people: {}, days: new Set() }; per.set(area, a); }
      a.apo += n; totalApo += n; a.days.add(r.date);
      a.people[r.uid] = (a.people[r.uid] || 0) + n;
    }
  }
  const out = [...per.values()].map((a) => ({
    area: a.area, apo: a.apo, days: a.days.size,
    share: totalApo ? Math.round(a.apo / totalApo * 100) : 0,
    people: Object.entries(a.people).map(([uid, n]) => { const u = (db.users || {})[uid] || {}; return { name: u.name || u.code || uid, code: u.code || uid, apo: n }; })
      .sort((x, y) => y.apo - x.apo).slice(0, 5),
  })).sort((x, y) => y.apo - x.apo).slice(0, top);
  return { ready: out.length > 0, ym: ym || null, days: ym ? null : days, totalApo, count: per.size, rows: out, updatedAt: db.updatedAt || null };
}

/** 通算（記録が始まってからの全期間）。月が替わってもリセットしない。 */
export function careerStats() {
  const db = load();
  const all = Object.values(db.days || {});
  if (!all.length) return { ready: false, rows: [], totalWalkKm: 0 };
  const per = new Map();
  let since = null;
  for (const r of all) {
    if (r.walkM <= 0) continue;
    if (!since || r.date < since) since = r.date;
    let p = per.get(r.uid);
    if (!p) { p = { uid: r.uid, walkM: 0, days: 0 }; per.set(r.uid, p); }
    p.walkM += r.walkM; p.days++;
  }
  const rows = [...per.values()].map((p) => {
    const u = (db.users || {})[p.uid] || {};
    return { code: u.code || p.uid, name: u.name || u.code || p.uid,
             walkKm: +(p.walkM / 1000).toFixed(1), days: p.days };
  }).sort((a, z) => z.walkKm - a.walkKm);
  return { ready: true, since, count: rows.length,
           totalWalkKm: +(rows.reduce((n, r) => n + r.walkKm, 0)).toFixed(0), rows };
}
