/* ============================================================
   cyzen 連携API クライアント
   CSV書き出しの代わりにAPIから直接取る。取得したデータは lib/cyzen.mjs と
   同じ形（users / day）に詰めるので、集計・画面・配信は一切変更不要。

   仕様（cyzen APIリファレンス 2023-12-20）：
   ・ベース https://ext.cyzen.cloud/webapi/v0
   ・認証   Authorization: bearer <static_token> ＋ company_id クエリ
   ・制限   1トークン秒間5回／1リクエスト200件（next_* でページング）
   ・履歴   from_date〜to_date は15日以内。未指定なら直近15日
   ・上限超過は HTTP 503（将来429）
   ============================================================ */
const BASE = process.env.CYZEN_API_BASE || 'https://ext.cyzen.cloud/webapi/v0';
const TOKEN = process.env.CYZEN_API_TOKEN || '';
const COMPANY = process.env.CYZEN_COMPANY_ID || '';

export const ready = () => !!(TOKEN && COMPANY);

/* 秒間5回制限。安全側に見て200ms間隔を空ける（＝毎秒5回ちょうど）。 */
let lastCall = 0;
async function throttle() {
  const wait = 200 - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

/** 1リクエスト。503（上限超過）と5xxはバックオフして再試行する。 */
async function call(path, params = {}, attempt = 0) {
  await throttle();
  const q = new URLSearchParams({ company_id: COMPANY, ...params });
  const res = await fetch(`${BASE}/${path}?${q}`, {
    headers: { Authorization: `bearer ${TOKEN}` },
  });
  if (res.status === 503 || res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`cyzen ${path}: ${res.status}（再試行上限）`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));   // 1,2,4,8秒
    return call(path, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`cyzen ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  // HTTP200でもエラーが入る場合がある（仕様2章）
  if (j && j.errors && j.errors.length) {
    const e = j.errors[0];
    throw new Error(`cyzen ${path}: ${e.err_code} ${e.err_msg}`);
  }
  return j;
}

/** 疎通確認。グループ取得が通れば認証・company_idとも正しい。 */
export async function ping() {
  if (!ready()) return { ok: false, error: 'CYZEN_API_TOKEN / CYZEN_COMPANY_ID が未設定です' };
  try {
    const j = await call('groups');
    const rows = j.Result || j.result || j.groups || [];
    return { ok: true, groups: Array.isArray(rows) ? rows.length : 0, base: BASE };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** ページングを畳んで全件取る。nextKeyのフィールド名はエンドポイントごとに違う。 */
async function fetchAll(path, params, listKey, nextKey, max = 60) {
  const out = [];
  let next = null;
  for (let i = 0; i < max; i++) {
    const p = { ...params };
    if (next) p[nextKey] = next;
    const j = await call(path, p);
    const rows = j[listKey] || j.Result || j.result || [];
    if (Array.isArray(rows)) out.push(...rows);
    next = j[nextKey];
    if (!next) break;
  }
  return out;
}

const ymd = d => d.toISOString().slice(0, 10);
const dt = d => d.toISOString().slice(0, 19);          // UTC YYYY-MM-DDThh:mm:ss

/** 期間を15日以内の窓に割る（履歴APIの制約）。 */
export function splitWindows(fromDate, toDate, days = 14) {
  const out = [];
  let s = new Date(fromDate);
  const end = new Date(toDate);
  while (s <= end) {
    const e = new Date(Math.min(+new Date(s.getTime() + days * 86400000), +end));
    out.push([new Date(s), e]);
    s = new Date(e.getTime() + 86400000);
  }
  return out;
}

/** ユーザー名簿（メンバ属性つき）を取る。 */
export async function fetchUsers() {
  const rows = await fetchAll('users', {}, 'users', 'next_user_id');
  return rows.map(u => ({
    code: u.user_code, name: u.user_name || '',
    attr: (u.user_tags || []).map(t => t.user_tag_name).filter(Boolean).join('/'),
    group: (u.groups || []).map(g => g.group_name).filter(Boolean)[0] || '',
    suspended: u.account_status === 0,
    lastUse: (u.updated_at || '').slice(0, 10),
  })).filter(u => u.code);
}

/** 打刻履歴（＝行動量の元）を期間で取る。15日ずつ自動分割。 */
export async function fetchHistories(fromDate, toDate) {
  const out = [];
  for (const [s, e] of splitWindows(fromDate, toDate)) {
    const rows = await fetchAll('histories',
      { from_date: dt(s), to_date: dt(new Date(e.getTime() + 86399000)) },
      'histories', 'next_history_created_at');
    out.push(...rows);
  }
  return out;
}

/** 報告書（アポ獲得・成約など）を期間で取る。 */
export async function fetchReports(fromDate, toDate) {
  const out = [];
  for (const [s, e] of splitWindows(fromDate, toDate)) {
    const rows = await fetchAll('reports',
      { from_date: dt(s), to_date: dt(new Date(e.getTime() + 86399000)) },
      'reports', 'next_report_id');
    out.push(...rows);
  }
  return out;
}

export const info = () => ({ base: BASE, configured: ready(), companySet: !!COMPANY, tokenSet: !!TOKEN });

/** 取得できる実データの規模を確認する（中身は返さず件数と例だけ）。 */
export async function probe() {
  if (!ready()) return { ok: false, error: '未設定' };
  const out = { base: BASE };
  // ① ユーザー（素の取得と、追加項目つきの両方を試す）
  for (const [label, params] of [['plain', {}], ['field_all', { field: 'ALL' }]]) {
    try {
      const j = await call('users', params);
      const rows = j.users || j.Result || [];
      out[`users_${label}`] = Array.isArray(rows) ? rows.length : 0;
      if (Array.isArray(rows) && rows[0]) out[`userKeys_${label}`] = Object.keys(rows[0]);
    } catch (e) { out[`users_${label}_error`] = e.message.slice(0, 160); }
  }
  // ② グループ
  try {
    const j = await call('groups');
    const rows = j.groups || j.Result || [];
    out.groups = rows.length;
    out.groupNames = rows.map(g => g.group_name).filter(Boolean).slice(0, 10);
  } catch (e) { out.groupsError = e.message.slice(0, 160); }
  // ③ 履歴：直近14日と、7月ぶん（実データがある期間）の両方を見る
  for (const [label, from, to] of [
    ['last14d', new Date(Date.now() - 13 * 86400000), new Date()],
    ['july', new Date('2026-07-01T00:00:00Z'), new Date('2026-07-14T23:59:59Z')],
  ]) {
    try {
      const j = await call('histories', { from_date: dt(from), to_date: dt(to) });
      const rows = j.histories || j.Result || [];
      out[`histories_${label}`] = rows.length;
      if (rows[0]) out.historyKeys = Object.keys(rows[0]).slice(0, 16);
    } catch (e) { out[`histories_${label}_error`] = e.message.slice(0, 160); }
  }
  // ④ 報告書
  try {
    const j = await call('reports', { from_date: dt(new Date(Date.now() - 13 * 86400000)), to_date: dt(new Date()) });
    const rows = j.reports || j.Result || [];
    out.reports14d = rows.length;
    if (rows[0]) out.reportKeys = Object.keys(rows[0]).slice(0, 16);
  } catch (e) { out.reportsError = e.message.slice(0, 160); }
  return { ok: true, ...out };
}
