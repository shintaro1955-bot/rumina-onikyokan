/* ============================================================
   歩行行動量（GPS打刻から算出）
   cyzenの行動履歴（緯度経度つき打刻）から、隣接点の距離を積み上げて
   「歩いた距離」と「車などでの移動距離」を速度で分離する。

   訪問数だけでは見えない働き方の差（歩いているのに訪問が少ない＝ルート設計、
   歩かず数を稼げている＝効率）を可視化するのが狙い。
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR as CYZEN_DIR } from './cyzen.mjs';

const FILE = () => join(CYZEN_DIR, 'action-history.csv');
/* 歩行とみなす上限速度(m/s)。2.0=時速7.2km。これを超えたら車・電車扱い。 */
const WALK_MAX_MS = Number(process.env.WALK_MAX_SPEED || 2.0);
/* 空白がこれ以上なら連続移動とみなさない（滞在をまたぐため） */
const GAP_MAX_SEC = Number(process.env.WALK_GAP_MAX || 1800);
/* 1区間がこれ以上は測位エラーとして捨てる */
const JUMP_MAX_M = Number(process.env.WALK_JUMP_MAX || 20000);

export const ready = () => existsSync(FILE());

let CACHE = null;
export function reload() { CACHE = null; return ready(); }

function readText(p) {
  const buf = readFileSync(p);
  // cyzenの書き出しはShift-JIS。UTF-8で化ける場合はcp932で読み直す。
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((t.match(/�/g) || []).length > 50) t = new TextDecoder('shift_jis').decode(buf);
  return t;
}
function parseCsv(text) {
  const rows = []; let f = '', row = [], q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const R = 6371000;
function haversine(la1, lo1, la2, lo2) {
  const p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
  const dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 打刻を「担当者×日」でまとめ、日ごとの歩行/車移動距離を出す（重いので1回だけ）。 */
function build() {
  const rows = parseCsv(readText(FILE()));
  const head = (rows.shift() || []).map(h => h.trim());
  const ix = n => head.indexOf(n);
  const iT = ix('日時'), iC = ix('ユーザーコード'), iN = ix('ユーザー名'),
        iG = ix('グループ名'), iLa = ix('緯度'), iLo = ix('経度');
  if (iT < 0 || iLa < 0 || iLo < 0) return { day: new Map(), users: new Map() };

  // 担当者×日 → 打刻の並び
  const bucket = new Map();
  const users = new Map();
  for (const r of rows) {
    const la = parseFloat(r[iLa]), lo = parseFloat(r[iLo]);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const ts = (r[iT] || '').trim(); if (!ts) continue;
    const date = ts.slice(0, 10);
    const code = (r[iC] || '').trim() || (r[iN] || '').trim();
    if (!code) continue;
    if (!users.has(code)) users.set(code, { code, name: (r[iN] || '').trim(), group: (r[iG] || '').trim() });
    const k = `${code}|${date}`;
    let b = bucket.get(k); if (!b) { b = []; bucket.set(k, b); }
    b.push([Date.parse(ts.replace(' ', 'T')), la, lo]);
  }

  const day = new Map();
  for (const [k, pts] of bucket) {
    pts.sort((a, b) => a[0] - b[0]);
    let walk = 0, ride = 0;
    for (let i = 1; i < pts.length; i++) {
      const [t0, la0, lo0] = pts[i - 1], [t1, la1, lo1] = pts[i];
      const dt = (t1 - t0) / 1000;
      if (!(dt > 0) || dt > GAP_MAX_SEC) continue;
      const m = haversine(la0, lo0, la1, lo1);
      if (m > JUMP_MAX_M) continue;
      if (m / dt <= WALK_MAX_MS) walk += m; else ride += m;
    }
    const [code, date] = k.split('|');
    day.set(k, { code, date, walkM: walk, rideM: ride, points: pts.length });
  }
  return { day, users };
}
function db() { if (!CACHE && ready()) CACHE = build(); return CACHE; }

/** データ内で最も新しい日付。 */
export function latestDate() {
  const d = db(); if (!d) return null;
  let m = null; for (const r of d.day.values()) if (!m || r.date > m) m = r.date;
  return m;
}

/**
 * 担当者ごとの歩行指標。
 * @param {{days?:number, visitsByCode?:Map<string,{visits:number}>}} opts
 *   days … 直近N日に絞る（既定30）。visitsByCode … 訪問数を渡すと歩行効率も出す。
 */
export function stats(opts = {}) {
  const d = db();
  if (!d) return { ready: false, rows: [] };
  const days = opts.days || 30;
  const latest = latestDate();
  let from = null;
  if (latest) {
    const t = new Date(latest + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (days - 1));
    from = t.toISOString().slice(0, 10);
  }
  const per = new Map();
  for (const rec of d.day.values()) {
    if (from && (rec.date < from || rec.date > latest)) continue;
    if (rec.walkM <= 0 && rec.rideM <= 0) continue;
    let p = per.get(rec.code);
    if (!p) { p = { code: rec.code, walkM: 0, rideM: 0, days: 0, points: 0 }; per.set(rec.code, p); }
    p.walkM += rec.walkM; p.rideM += rec.rideM; p.days++; p.points += rec.points;
  }
  const rows = [...per.values()].map(p => {
    const u = d.users.get(p.code) || {};
    const walkKm = +(p.walkM / 1000).toFixed(1);
    const rideKm = +(p.rideM / 1000).toFixed(1);
    const total = p.walkM + p.rideM;
    const v = opts.visitsByCode && opts.visitsByCode.get(p.code);
    const visits = v ? v.visits : null;
    return {
      code: p.code, name: u.name || p.code, group: u.group || '',
      days: p.days, walkKm, rideKm,
      walkPerDay: +(walkKm / p.days).toFixed(1),
      ridePerDay: +(rideKm / p.days).toFixed(1),
      walkRatio: total > 0 ? Math.round(p.walkM / total * 100) : 0,   // 移動のうち歩きの割合(%)
      visits,
      // 歩行効率：1km歩くごとに何件訪問したか。低いほどルート設計に伸びしろ。
      visitsPerKm: (visits != null && walkKm > 0) ? +(visits / walkKm).toFixed(1) : null,
    };
  }).sort((a, z) => z.walkKm - a.walkKm);

  const totalWalk = +(rows.reduce((n, r) => n + r.walkKm, 0)).toFixed(0);
  const med = (xs => { if (!xs.length) return 0; const a = [...xs].sort((p, q) => p - q), m = a.length >> 1;
    return +(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2).toFixed(1); })(rows.map(r => r.walkPerDay));
  return { ready: true, window: { from, to: latest, days }, count: rows.length, totalWalkKm: totalWalk, medianWalkPerDay: med, rows };
}
