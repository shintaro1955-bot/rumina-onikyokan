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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.CYZEN_DATA_DIR || '';
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

function emptyDay() { return { visitsSelf: 0, apo: 0, shodan: 0, seiyaku: 0, haisen: 0, visitStamp: 0, gpsStamp: 0, workStart: null, workEnd: null }; }

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
      users.set(code, { name: r['名前'] || '', attr: (r['メンバー属性'] || '').replace(/\s+/g, '/'), group: (r['グループ'] || '').split('\n')[0] || '' });
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
        if (name.includes('勤務終了')) { const v = num(r['本日の訪問件数（不在も含む）']); if (v != null) d.visitsSelf = Math.max(d.visitsSelf, v); d.workEnd = r['報告日時'] || d.workEnd; }
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

function db() { if (!DB && DIR && existsSync(DIR)) build(); return DB; }

export function ready() { return !!(DIR && existsSync(DIR)); }
export function status() {
  if (!ready()) return { ready: false };
  const d = db();
  return { ready: true, ...d.meta };
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
