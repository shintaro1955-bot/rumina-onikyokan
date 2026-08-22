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

/* 打刻の緯度経度・日時・担当者を、APIの項目名の揺れを吸収して取り出す */
function pick(h) {
  const lat = Number(h.latitude ?? h.lat ?? h.gps_latitude);
  const lon = Number(h.longitude ?? h.lon ?? h.lng ?? h.gps_longitude);
  const ts = h.created_at || h.datetime || h.date_time || h.recorded_at || h.date;
  const uid = h.user_id ?? h.userId ?? h.user?.id;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ts || uid == null) return null;
  const t = Date.parse(String(ts).replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  return { uid: String(uid), t, lat, lon };
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
  for (const h of rows) {
    const p = pick(h);
    if (!p) continue;
    const k = p.uid + '|' + jstDay(p.t);
    let b = bucket.get(k); if (!b) { b = []; bucket.set(k, b); }
    b.push(p);
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
    const [uid, date] = k.split('|');
    db.days[k] = { uid, date, walkM: Math.round(walk), rideM: Math.round(ride), points: pts.length };
    const u = users.get(uid);
    if (u && (u.name || u.code)) db.users[uid] = u;
    touched++;
  }
  db.updatedAt = new Date().toISOString();
  save(db);
  return { ok: true, histories: rows.length, days: touched, users: db.users ? Object.keys(db.users).length : 0 };
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
