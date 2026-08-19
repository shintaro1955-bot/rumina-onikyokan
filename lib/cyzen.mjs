/* ============================================================
   cyzen アダプタ（依存ゼロ）
   cyzenのCSV書き出し（ユーザーマスター／報告書／行動履歴）を読み、
   「担当者×日」の行動量インデックスを作る。
   → 鬼教官の分母（総ピンポン数＝cyzenの「本日の訪問件数（不在も含む）」）
     とアポ数を"確定値"として供給する。量=cyzen／質=鬼教官。

   置き場所：CYZEN_DATA_DIR（未設定ならcyzen連携オフ）
     user-master.csv               … ユーザーマスター(utf-8-sig)
     action-history.csv            … 行動履歴(Shift_JIS・任意・大容量)
     report/*.csv                  … 報告書各種(Shift_JIS)
   本番はAPI連携に差し替え予定。まずはCSVでPoC。
   ============================================================ */
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';

// 既定は永続領域配下（Railway Volume）。CSVは管理画面からアップロードできる。
export const DIR = process.env.CYZEN_DATA_DIR || join(DATA_DIR, 'cyzen');
const SKIP_HISTORY = /^(1|true|yes|on)$/i.test(process.env.CYZEN_SKIP_HISTORY || '');

let DB = null;   // { users:Map, day:Map, meta }

function readText(path, sjis) {
  const buf = readFileSync(path);
  if (sjis) { try { return new TextDecoder('shift_jis').decode(buf); } catch { return buf.toString('binary'); } }
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);   // BOM
  return s;
}

// RFC4180風CSVパーサ（引用符・改行・二重引用符に対応）
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const nfc = s => (s || '').normalize('NFC');
function toObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const hdr = rows[0].map(nfc);
  return rows.slice(1).filter(r => r.length > 1).map(r => {
    const o = {}; hdr.forEach((h, i) => { o[h] = r[i] ?? ''; }); return o;
  });
}
const D = s => (s || '').slice(0, 10);              // "2026-07-17 16:.." → "2026-07-17"
const num = s => { const m = String(s || '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };
const key = (code, date) => `${code}|${date}`;

function emptyDay() { return { visitsSelf: 0, apo: 0, shodan: 0, seiyaku: 0, haisen: 0, visitStamp: 0, gpsStamp: 0, workStart: null, workEnd: null, endReport: false }; }

function build() {
  const users = new Map();     // code -> {name, attr, group}
  const day = new Map();       // "code|date" -> dayRecord
  const getDay = (code, date) => { const k = key(code, date); let d = day.get(k); if (!d) { d = emptyDay(); d.code = code; d.date = date; day.set(k, d); } return d; };

  // ① ユーザーマスター
  const umPath = join(DIR, 'user-master.csv');
  let userCount = 0;
  if (existsSync(umPath)) {
    for (const r of toObjects(readText(umPath, false))) {
      const code = r['ユーザーコード']; if (!code) continue;
      users.set(code, {
        name: r['名前'] || '', attr: (r['メンバー属性'] || '').replace(/\s+/g, '/'),
        group: (r['グループ'] || '').split('\n')[0] || '',
        suspended: String(r['利用停止'] || '').trim() === '1',      // 除外条件：利用停止
        lastUse: D((r['最終利用日'] || '').replace(/年|月/g, '-').replace(/日/g, '')),  // 休職の近似判定用
      });
      userCount++;
    }
  }

  // ② 報告書（report/*.csv）— 報告書名でバケット分け
  const repDir = join(DIR, 'report');
  let reportRows = 0;
  if (existsSync(repDir)) {
    for (const fn of readdirSync(repDir).filter(f => f.toLowerCase().endsWith('.csv'))) {
      for (const r of toObjects(readText(join(repDir, fn), true))) {
        const code = r['ユーザーコード']; const date = D(r['報告日時'] || r['訪問日時']); if (!code || !date) continue;
        const name = nfc(r['報告書名'] || '');
        const d = getDay(code, date); reportRows++;
        if (name.includes('勤務終了')) { const v = num(r['本日の訪問件数（不在も含む）']); if (v != null) d.visitsSelf = Math.max(d.visitsSelf, v); d.workEnd = r['報告日時'] || d.workEnd; d.endReport = true; }
        else if (name.includes('アポ獲得')) d.apo++;
        else if (name.includes('出勤')) d.workStart = r['報告日時'] || d.workStart;
        else if (name.includes('成約') || name.includes('獲得（成約）')) d.seiyaku++;
        else if (name.includes('敗戦')) d.haisen++;
        else if (name.includes('提案中') || name.includes('新規商談')) d.shodan++;
      }
    }
  }

  // ③ 行動履歴（GPS打刻）— 任意。ステータスに「訪問」を含む打刻数＝打刻ベース訪問
  const ahPath = join(DIR, 'action-history.csv');
  let historyRows = 0, historyLoaded = false;
  if (!SKIP_HISTORY && existsSync(ahPath)) {
    try {
      const rows = parseCsv(readText(ahPath, true));
      const hdr = rows[0].map(nfc);
      const ci = name => hdr.findIndex(h => h.includes(name));
      const iCode = ci('ユーザーコード'), iStat = ci('ステータス'), iDate = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || row.length <= iCode) continue;
        const code = row[iCode], date = D(row[iDate]); if (!code || !date) continue;
        const d = getDay(code, date); d.gpsStamp++; historyRows++;
        const st = nfc(row[iStat] || '');
        if (st.includes('訪問')) d.visitStamp++;
      }
      historyLoaded = true;
    } catch (e) { console.error('[cyzen] 行動履歴の読み込みに失敗:', e.message); }
  }

  DB = { users, day, meta: { userCount, reportRows, historyRows, historyLoaded, days: day.size } };
  console.log(`✓ cyzen: 担当者${userCount}名 / 報告${reportRows}件 / 行動履歴${historyRows}打刻 / 稼働レコード${day.size}`);
  return DB;
}

// 同梱スナップショット（PIIなしの集計）。本番でCSV未取り込み(Volume無し等)でも
// これを読めば行動量・KPI・ランキングが動く。CSVを入れればそちらが優先。
const SNAPSHOT = new URL('../cyzen-snapshot/snapshot.json', import.meta.url).pathname;
function hasCsv() {
  if (!DIR || !existsSync(DIR)) return false;
  if (existsSync(join(DIR, 'user-master.csv'))) return true;
  const rep = join(DIR, 'report');
  return existsSync(rep) && readdirSync(rep).some(f => f.toLowerCase().endsWith('.csv'));
}
function hasSnapshot() { return existsSync(SNAPSHOT); }
function buildFromSnapshot() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const users = new Map(Object.entries(snap.users || {}));
  const day = new Map();
  let historyRows = 0;
  for (const rec of (snap.days || [])) { day.set(key(rec.code, rec.date), rec); historyRows += rec.gpsStamp || 0; }
  DB = { users, day, meta: { userCount: users.size, reportRows: null, historyRows, historyLoaded: historyRows > 0, days: day.size, source: 'snapshot' } };
  console.log(`✓ cyzen（同梱スナップショット）：担当者${users.size}名 / 稼働レコード${day.size}`);
  return DB;
}

function db() { if (DB) return DB; if (hasCsv()) return build(); if (hasSnapshot()) return buildFromSnapshot(); return null; }

/** 日次の稼働レコード一覧（期間の絞り込みは呼び出し側で行う）。 */
export function records() { const d = db(); return d ? [...d.day.values()] : []; }
/** 名簿（code -> {name, attr, group, suspended, lastUse}）。 */
export function usersMap() { const d = db(); return d ? d.users : new Map(); }
/** データ内で最も新しい稼働日（スナップショット基準日）。 */
export function latestDate() {
  const rs = records(); let m = null;
  for (const r of rs) if (r.date && (!m || r.date > m)) m = r.date;
  return m;
}

export function ensureDir() { try { mkdirSync(join(DIR, 'report'), { recursive: true }); } catch {} return DIR; }
export function reload() { DB = null; return status(); }
// データが実際に入っているか（CSV取り込み or 同梱スナップショット）
export function ready() { return hasCsv() || hasSnapshot(); }
export function status() {
  if (!ready()) return { ready: false, dir: DIR };
  const d = db();
  return { ready: true, dir: DIR, ...d.meta, bench: BENCH };
}

/* ---- 「あるべき姿」＝実データ（上位者の実績）から導出したベンチマーク ----
   訪問/日：中央値18.5・上位25%=31・上位10%=43
   アポ率 ：中央値0%・上位10%=5.5%（＝両立できている人の実在ライン）
   稼働   ：稼働時間 中央値6.7h・上位25%=9h
   成約率 ：上位クローザー 67〜70% */
export const BENCH = {
  visitsPerDay: 31,        // あるべき訪問数/日（上位25%）
  visitsPerDayMin: 18,     // これ未満は活動量不足（中央値）
  apoRate: 5.5,            // あるべきアポ率%（上位10%）
  apoRateMin: 3.0,         // これ未満は商談化不足
  workHours: 9,            // あるべき稼働時間/日（上位25%）
  activeDaysRatio: 0.6,    // 期間営業日に対する稼働率の下限
  closeRate: 67,           // あるべき成約率%（上位クローザー）
};

/* ---- 全営業のKPI一覧＋教育セグメント判定 ---- */
// E:記録なし(評価不能) / D:稼働低下 / A:活動量不足 / B:商談化不足 / C:クロージング不足 / S:良好
export function roster() {
  const d = db(); if (!d) return { ready: false, rows: [], summary: {} };
  const per = new Map();
  const dates = new Set();
  for (const rec of d.day.values()) {
    dates.add(rec.date);
    const active = rec.visitsSelf > 0 || rec.apo > 0 || rec.workStart || rec.workEnd;
    if (!active) continue;
    let p = per.get(rec.code);
    if (!p) { p = { code: rec.code, days: 0, visits: 0, apo: 0, seiyaku: 0, haisen: 0, hours: [], stamps: 0 }; per.set(rec.code, p); }
    p.days++; p.visits += rec.visitsSelf; p.apo += rec.apo; p.seiyaku += rec.seiyaku; p.haisen += rec.haisen; p.stamps += rec.visitStamp;
    if (rec.workStart && rec.workEnd) {
      const h = (Date.parse(rec.workEnd.replace(' ', 'T')) - Date.parse(rec.workStart.replace(' ', 'T'))) / 3600000;
      if (h > 0 && h < 20) p.hours.push(h);
    }
  }
  const periodDays = dates.size || 1;
  const rows = [];
  for (const [code, u] of d.users) {
    const p = per.get(code);
    const days = p ? p.days : 0, visits = p ? p.visits : 0, apo = p ? p.apo : 0;
    const vpd = days ? +(visits / days).toFixed(1) : 0;
    const apoRate = visits ? +(apo / visits * 100).toFixed(1) : 0;
    const closed = p ? p.seiyaku + p.haisen : 0;
    const closeRate = closed ? Math.round(p.seiyaku / closed * 100) : null;
    const hours = p && p.hours.length ? +(p.hours.reduce((a, b) => a + b, 0) / p.hours.length).toFixed(1) : null;
    const isCloser = /クローザー/.test(u.attr || '');
    let seg, why;
    if (!days) { seg = 'E'; why = '期間中の報告書なし＝評価不能（まず記録を上げる）'; }
    else if (days < periodDays * BENCH.activeDaysRatio * 0.5) { seg = 'D'; why = `稼働${days}日/${periodDays}日＝稼働そのものが低い`; }
    else if (closed >= 3 && closeRate != null && closeRate < 50) { seg = 'C'; why = `成約率${closeRate}%（あるべき${BENCH.closeRate}%）＝クロージング力`; }
    else if (vpd < BENCH.visitsPerDayMin) { seg = 'A'; why = `訪問${vpd}件/日（あるべき${BENCH.visitsPerDay}件）＝活動量不足`; }
    else if (apoRate < BENCH.apoRateMin) { seg = 'B'; why = `訪問は十分だがアポ率${apoRate}%（あるべき${BENCH.apoRate}%）＝トークの質`; }
    else { seg = 'S'; why = '量・質とも基準クリア'; }
    rows.push({ code, name: u.name, attr: u.attr, group: u.group, isCloser, days, visits, vpd, apo, apoRate, seiyaku: p ? p.seiyaku : 0, haisen: p ? p.haisen : 0, closeRate, hours, stamps: p ? p.stamps : 0, seg, why });
  }
  rows.sort((a, z) => (z.apo - a.apo) || (z.visits - a.visits));
  const summary = { periodDays, total: rows.length };
  for (const s of ['S', 'A', 'B', 'C', 'D', 'E']) summary[s] = rows.filter(r => r.seg === s).length;
  summary.evaluable = rows.filter(r => r.seg !== 'E').length;
  return { ready: true, rows, summary, bench: BENCH };
}

/* ---- 入力コンプライアンス：GPSで動いているのに勤務終了報告を出していない人 ----
   行動履歴(GPS)はアプリが自動記録＝稼働の物証。勤務終了報告は手入力＝サボれる。
   「稼働日(GPS) > 報告日」のギャップで“入力していない人”をフェアに名指しする。
   対象は利用停止でない現場職(アポインター/クローザー)・稼働3日以上のみ。 */
function complianceMessage(name, worked, reported, periodDays, level) {
  const head = `${name}さん、お疲れさまです。`;
  const ev = `直近${periodDays}日で、現場の稼働はGPSに${worked}日ぶん記録が残っています。`;
  if (level === 'none') return `${head}${ev}ただ、勤務終了報告（訪問件数）が1日も入っていません。動けているのに数字が残らないと、あなたの頑張りが評価にも改善にも一切つながりません。今日から1日1回、訪問件数だけでも入力をお願いします。まずは今日ぶんから。― Rumina`;
  if (level === 'low') return `${head}${ev}一方で報告が入っているのは${reported}日ぶんだけです。動いた日はしっかり記録に残しましょう。入力は1日1回・訪問件数だけでも大丈夫です。― Rumina`;
  return `${head}${ev}報告は${reported}日ぶん入っていて、あと一歩です。稼働した日は漏らさず入力しきりましょう。― Rumina`;
}
export function compliance(opts = {}) {
  const d = db(); if (!d) return { ready: false, rows: [], summary: {} };
  if (!d.meta.historyLoaded) return { ready: false, needHistory: true, rows: [], summary: {} };
  const GPS_MIN = opts.gpsMin ?? 5;
  const per = new Map(); const dates = new Set();
  for (const rec of d.day.values()) {
    dates.add(rec.date);
    const worked = rec.gpsStamp >= GPS_MIN;
    if (!worked && !rec.endReport) continue;
    let p = per.get(rec.code); if (!p) { p = { worked: 0, reported: 0, miss: 0, lastReported: null }; per.set(rec.code, p); }
    if (worked) p.worked++;
    if (rec.endReport) { p.reported++; if (!p.lastReported || rec.date > p.lastReported) p.lastReported = rec.date; }
    if (worked && !rec.endReport) p.miss++;
  }
  const periodDays = dates.size || 1;
  const rows = [];
  for (const [code, u] of d.users) {
    if (u.suspended) continue;
    if (!/アポインター|クローザー/.test(u.attr || '')) continue;
    const p = per.get(code); if (!p || p.worked < 3) continue;
    const rate = Math.round(p.reported / p.worked * 100);
    let level;
    if (p.reported === 0) level = 'none';
    else if (rate < 50) level = 'low';
    else if (rate < 80) level = 'warn';
    else continue;
    rows.push({ code, name: u.name, attr: (u.attr || '').split('/')[0], group: u.group,
      worked: p.worked, reported: p.reported, miss: p.miss, rate, level, lastReported: p.lastReported,
      message: complianceMessage(u.name, p.worked, p.reported, periodDays, level) });
  }
  rows.sort((a, z) => (z.miss - a.miss) || (a.rate - z.rate));
  const summary = { periodDays, target: rows.length,
    none: rows.filter(r => r.level === 'none').length,
    low: rows.filter(r => r.level === 'low').length,
    warn: rows.filter(r => r.level === 'warn').length };
  return { ready: true, rows, summary };
}

// 指定担当者・日の行動量（無ければ null）
export function dayActivity(code, date) {
  const d = db(); if (!d || !code) return null;
  const rec = d.day.get(key(code, date));
  if (!rec) return null;
  return { ...rec, name: (d.users.get(code) || {}).name || null, attr: (d.users.get(code) || {}).attr || null };
}
// その担当者の最も稼働した日（デモ/フォールバック用）
export function bestDay(code) {
  const d = db(); if (!d || !code) return null;
  let best = null;
  for (const rec of d.day.values()) {
    if (rec.code !== code) continue;
    if (!best || rec.visitsSelf > best.visitsSelf) best = rec;
  }
  if (!best) return null;
  return { ...best, name: (d.users.get(code) || {}).name || null, attr: (d.users.get(code) || {}).attr || null };
}
export function userName(code) { const d = db(); return d ? (d.users.get(code) || {}).name || null : null; }

// 氏名 → cyzenユーザーコード（SSOで来た本人のrepIdを補完するのに使う）
const normName = s => String(s || '').replace(/\s+/g, '').normalize('NFKC');
export function codeByName(name) {
  const d = db(); if (!d || !name) return null;
  const t = normName(name);
  for (const [code, u] of d.users) if (normName(u.name) === t) return code;
  return null;
}

// 個人の行動量サマリー（読み込み期間の合計。マイページ表示用）
export function personSummary(code) {
  const d = db(); if (!d || !code) return null;
  const u = d.users.get(code); if (!u) return null;
  let days = 0, visits = 0, apo = 0, seiyaku = 0, gpsStamp = 0, reported = 0, lastDate = null;
  const dates = new Set();
  for (const rec of d.day.values()) {
    if (rec.code !== code) continue;
    dates.add(rec.date);
    const active = rec.visitsSelf > 0 || rec.apo > 0 || rec.workStart || rec.workEnd || rec.gpsStamp >= 5;
    if (active) { days++; if (!lastDate || rec.date > lastDate) lastDate = rec.date; }
    visits += rec.visitsSelf; apo += rec.apo; seiyaku += rec.seiyaku; gpsStamp += rec.gpsStamp;
    if (rec.endReport) reported++;
  }
  if (!days) return { code, name: u.name, attr: u.attr, days: 0, visits: 0, apo: 0, empty: true };
  return {
    code, name: u.name, attr: u.attr, group: u.group,
    days, visits, apo, seiyaku, gpsStamp, reported, lastDate,
    visitsPerDay: +(visits / days).toFixed(1),
    apoRate: visits ? +(apo / visits * 100).toFixed(1) : 0,
    periodDays: dates.size, empty: false,
  };
}
