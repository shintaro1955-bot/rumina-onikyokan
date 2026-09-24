/* ============================================================
   先週からの動きを本人に知らせる（上がった人も、下がった人も）

   営業教育部_RULE の線：
   ・名指しは**本人へのDM**で行う。グループに個人の低調な数値は貼らない
     → ここで作るのは本人宛てだけ。「今週のびた人」(Today) は上がった人のみ。
   ・確度が保証できない個人数値は突きつけない
     → 主軸は**訪問/日**（本人の勤務終了報告＝計上率が高い）。
       アポは計上漏れが残るので、アポ報告がある人にだけ添える。
   ・休職・離脱の可能性がある者へ指導連絡を自動送信しない
     → 稼働が急に落ちた人は送らず「要確認」に回す。人が見る。
   ・人格否定はしない。事実と次の一手だけ書く。
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getDb } from './store.mjs';
import * as cyzen from './cyzen.mjs';
import { resolveLineIds } from './reminders.mjs';
import { teamStats } from './buildup.mjs';

const ON = /^(1|true|yes|on)$/i.test(process.env.WEEKLY_ENABLED || '');
const TOKEN = process.env.LINE_MESSAGING_TOKEN || '';
const STATE_FILE = join(DATA_DIR, 'weekly.json');

export function config() { return { enabled: ON, canSend: !!(ON && TOKEN), tokenSet: !!TOKEN }; }

function nowJst() { return new Date(Date.now() + 9 * 3600 * 1000); }
function jstWeek(d = nowJst()) {   // 送信の重複防止は「週」単位
  const t = new Date(d); const day = (t.getUTCDay() + 6) % 7;   // 月曜始まり
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10);
}
function loadState() { try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {} return { week: '', sent: {} }; }
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('[weekly] state保存失敗:', e.message); } }
function weekState() {
  const s = loadState(); const w = jstWeek();
  if (s.week !== w) { s.week = w; s.sent = {}; saveState(s); }
  return s;
}

/* 1人ぶんの「先週からの動き」を組み立てる。判定は決定論。 */
function shape(t, bench) {
  const d = +(t.recVpd - t.priVpd).toFixed(1);
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  // 休職・離脱の疑い：稼働日数が半分以下まで落ちて、今週2日以下
  const atRisk = t.priDays > 0 && t.recDays <= 2 && t.recDays <= t.priDays * 0.5;
  const med = bench && bench.ready ? bench.vpd.median : null;
  return {
    code: t.code, name: t.name,
    recDays: t.recDays, priDays: t.priDays,
    recVpd: t.recVpd, priVpd: t.priVpd, deltaVpd: d, dir, atRisk,
    recApo: t.recApo, recApoRate: t.recApoRate, priApoRate: t.priApoRate,
    median: med,
  };
}

/** 本人向けの文面。事実 → 次の一手。断定や叱責はしない。 */
export function messageFor(m) {
  const L = [`${m.name}さん、おつかれさまです。`];
  if (m.dir === 'up') {
    L.push(`先週から訪問が増えています。1日あたり ${m.priVpd}件 → ${m.recVpd}件。`);
    if (m.recApo) L.push(`直近7日のアポは${m.recApo}件でした。`);
    L.push('この動きはそのまま続けてください。');
  } else if (m.dir === 'down') {
    L.push(`先週から訪問が減っています。1日あたり ${m.priVpd}件 → ${m.recVpd}件。`);
    if (m.median != null) L.push(`チームの中央値は${m.median}件です。`);
    const back = Math.max(1, Math.ceil(m.priVpd - m.recVpd));
    L.push(`まずは1日あと${back}件、戻すところから。`);
  } else {
    L.push(`直近7日の訪問は1日あたり ${m.recVpd}件で、先週と同じくらいです。`);
    if (m.median != null && m.recVpd < m.median) L.push(`チームの中央値は${m.median}件です。あと${Math.ceil(m.median - m.recVpd)}件上げられると景色が変わります。`);
    else L.push('この調子で続けてください。');
  }
  L.push('詳しい内訳はアプリの My Performance で見られます。');
  return L.join('\n');
}

/** 全員ぶんの動きを出す。送る相手・送らない相手（要確認）を仕分ける。 */
export async function targets() {
  const tr = cyzen.trends({ recentDays: 7 });
  if (!tr.ready) return { ready: false, rows: [], reachable: [], unreachable: [], review: [] };
  const bench = teamStats({});
  // 比較できる人だけ（前週に稼働があること）
  const rows = (tr.rows || []).filter(r => r.name && r.priDays > 0).map(r => shape(r, bench));

  const review = rows.filter(r => r.atRisk);                 // 休職・離脱の疑い＝自動送信しない
  const sendable = rows.filter(r => !r.atRisk);
  const { byName, byCode, source } = await resolveLineIds(sendable.map(r => r.name));
  const reachable = [], unreachable = [];
  for (const r of sendable) {
    const lineId = byName.get(r.name) || (byCode ? byCode.get(String(r.code)) : null) || null;
    const message = messageFor(r);
    if (lineId) reachable.push({ ...r, lineId, message }); else unreachable.push({ ...r, message });
  }
  const up = rows.filter(r => r.dir === 'up').length, down = rows.filter(r => r.dir === 'down').length;
  return { ready: true, anchor: tr.anchor, rows, reachable, unreachable, review, source, summary: { up, down, flat: rows.length - up - down, review: review.length } };
}

/** 本人ぶん（マイページ用）。他人の数値は返さない。 */
export function mine({ name } = {}) {
  const tr = cyzen.trends({ recentDays: 7 });
  if (!tr.ready || !name) return { ready: false };
  const t = (tr.rows || []).find(r => r.name === name);
  if (!t) return { ready: true, found: false, anchor: tr.anchor };
  const m = shape(t, teamStats({}));
  return { ready: true, found: true, anchor: tr.anchor, ...m, comparable: t.priDays > 0 };
}

async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
}

/** 1回分。live=false（既定）は下書きだけ返す。1人につき週1通まで。 */
export async function runOnce({ live = false } = {}) {
  const t = await targets();
  if (!t.ready) return { ...t, wouldSend: [], sent: 0, note: 'cyzenのデータがありません。' };
  const st = weekState();
  const out = [], skipped = [];
  for (const r of t.reachable) {
    if (st.sent[r.name]) { skipped.push({ name: r.name, why: '今週送信済み' }); continue; }
    out.push(r);
  }
  const canSend = !!(ON && TOKEN) && live;
  let sent = 0; const failed = [];
  if (canSend) {
    for (const r of out) {
      try { await pushLine(r.lineId, r.message); st.sent[r.name] = Date.now(); sent++; }
      catch (e) { failed.push({ name: r.name, error: e.message }); }
    }
    saveState(st);
  }
  return {
    ...t, live, enabled: ON, tokenSet: !!TOKEN,
    wouldSend: out.map(r => ({ name: r.name, dir: r.dir, delta: r.deltaVpd, message: r.message })),
    skipped, sent, failed,
    note: canSend ? `${sent}件送信しました。`
      : (!live ? '下書きです（送信していません）。' : !ON ? 'WEEKLY_ENABLED=on が未設定です。' : 'LINEの送信設定がありません。'),
  };
}
