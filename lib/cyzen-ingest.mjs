/* ============================================================
   cyzen API → 集計（users / day）への変換（ライブ取り込み）
   5分ごとに報告書を取り直して行動量ランキングを最新化する。
   ・報告書ベース：訪問件数(勤務終了)・アポ(アポ獲得)・成約/敗戦・出勤/終了時刻。
     これで「量＝訪問/アポ/稼働」が回る（ランキングの主軸）。
   ・GPS履歴(gpsStamp)は数十万件で5分取得は非現実的なので、ここでは扱わない。
     compliance等でGPSが要る集計はCSV/スナップショット側で担保する。
   ・安全弁：取得が空/失敗なら applyLive しない（既存データを壊さない）。
   ============================================================ */
import * as api from './cyzen-api.mjs';

const nfc = s => String(s || '').normalize('NFC');
const D = s => nfc(s).slice(0, 10);
const num = s => { const m = String(s ?? '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return o[k]; return undefined; };

function emptyDay(code, date) {
  return { code, date, visitsSelf: 0, apo: 0, shodan: 0, seiyaku: 0, haisen: 0, visitStamp: 0, gpsStamp: 0, workStart: null, workEnd: null, endReport: false };
}
// 報告書1件から「本日の訪問件数（不在も含む）」を取り出す
function visitCountOf(items) {
  for (const it of (items || [])) {
    const name = nfc(pick(it, 'item_name', 'name'));
    if (name.includes('訪問件数')) { const v = num(pick(it, 'item_value', 'value')); if (v != null) return v; }
  }
  return null;
}

export async function ingestReports({ days = 31 } = {}) {
  if (!api.ready()) return { ok: false, error: 'cyzen API 未設定' };
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);

  const usersArr = await api.fetchUsers();
  const idToCode = new Map();
  const users = new Map();
  for (const u of usersArr) {
    if (u.id != null) idToCode.set(String(u.id), u.code);
    users.set(u.code, { name: u.name, attr: u.attr, group: u.group, suspended: !!u.suspended, lastUse: u.lastUse });
  }

  const reports = await api.fetchReports(from, to);
  const day = new Map();
  const getDay = (code, date) => { const k = `${code}|${date}`; let d = day.get(k); if (!d) { d = emptyDay(code, date); day.set(k, d); } return d; };

  let mapped = 0, noCode = 0, noDate = 0, unmatchedName = 0, visitItemHit = 0;
  const defCounts = {};          // 報告書種別ごとの件数
  const itemNames = new Set();   // 報告書内の項目名（訪問件数フィールド特定用）
  const diagKeys = reports[0] ? Object.keys(reports[0]).slice(0, 20) : [];
  for (const r of reports) {
    const code = idToCode.get(String(pick(r, 'user_id'))) || pick(r, 'user_code');
    const date = D(pick(r, 'report_datetime', 'reported_at', 'created_at', 'updated_at'));
    if (!code) { noCode++; continue; }
    if (!date) { noDate++; continue; }
    const name = nfc(pick(r, 'report_definition_name', 'report_name') || '');
    defCounts[name || '(無名)'] = (defCounts[name || '(無名)'] || 0) + 1;
    const items = pick(r, 'report_items', 'items') || [];
    for (const it of items) { const n = nfc(pick(it, 'item_name', 'name')); if (n && itemNames.size < 60) itemNames.add(n); }
    const d = getDay(code, date); mapped++;
    if (name.includes('勤務終了')) { const v = visitCountOf(items); if (v != null) { d.visitsSelf = Math.max(d.visitsSelf, v); visitItemHit++; } d.endReport = true; d.workEnd = pick(r, 'report_datetime', 'created_at') || d.workEnd; }
    else if (name.includes('アポ獲得')) d.apo++;
    else if (name.includes('出勤')) d.workStart = pick(r, 'report_datetime', 'created_at') || d.workStart;
    else if (name.includes('成約') || name.includes('獲得（成約）')) d.seiyaku++;
    else if (name.includes('敗戦')) d.haisen++;
    else if (name.includes('提案中') || name.includes('新規商談')) d.shodan++;
    else unmatchedName++;
  }

  // 集計品質（全員分の検証用・個人情報なし）
  let totalVisits = 0, totalApo = 0, totalSeiyaku = 0, daysWithVisits = 0, daysWithApo = 0;
  for (const d of day.values()) {
    totalVisits += d.visitsSelf; totalApo += d.apo; totalSeiyaku += d.seiyaku;
    if (d.visitsSelf > 0) daysWithVisits++; if (d.apo > 0) daysWithApo++;
  }
  const meta = { userCount: users.size, reportRows: reports.length, historyRows: 0, historyLoaded: false, days: day.size, source: 'api', at: to.toISOString() };
  const diag = {
    users: users.size, reports: reports.length, mapped, noCode, noDate, unmatchedName,
    days: day.size, daysWithVisits, daysWithApo, totalVisits, totalApo, totalSeiyaku, visitItemHit,
    reportDefs: defCounts, itemNames: [...itemNames], reportKeys: diagKeys,
    sampleDay: [...day.values()].find(d => d.visitsSelf > 0 || d.apo > 0) || [...day.values()][0] || null,
  };
  return { ok: true, users, day, meta, diag };
}
