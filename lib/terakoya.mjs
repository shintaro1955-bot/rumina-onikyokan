/* ============================================================
   FF寺子屋 — 対象者への個別案内（本人へのDM）
   対象者リストは人事・KPI側で確定済み（基準期間=7月の週平均 vs 直近週を比較し、
   役割に応じた指標＝アポインター:アポ獲得数／クローザー:クロ成約数 が
   低下したまま戻っていない、かつcyzen上で稼働継続している人）。
   ここでは**選定はしない**。渡されたCSVを読み、本人への文面を作るだけ。

   方針（_RULE.md / SKILL.md）：
     ・本人へのDMのみ。グループに実名を出さない。
     ・下がった指標は事実として具体的に示すが、**上がっている指標は必ず認める**
       （「実態と乖離がある」と言われないため。人格ではなく数字と行動の話に留める）
     ・出退勤の記録が無い人は自動送信せず「要確認」に回す（休職・離脱の可能性）
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.mjs';

const LIST = process.env.TERAKOYA_LIST || join(DATA_DIR, 'terakoya-targets.csv');
const CONF = join(DATA_DIR, 'terakoya.json');
// 運用で差し替えたい場合は DATA_DIR/terakoya.json を置く。無ければ同梱の既定値を使う。
const CONF_DEFAULT = new URL('../data/terakoya.default.json', import.meta.url).pathname;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const num = v => { const n = parseFloat(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0; };

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
  const head = rows.shift() || [];
  return rows.filter(r => r.some(x => (x || '').trim()))
    .map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

/** 寺子屋の開催情報（日程が無ければ null＝案内文を出さない安全弁）。 */
export function schedule() {
  try {
    const path = existsSync(CONF) ? CONF : (existsSync(CONF_DEFAULT) ? CONF_DEFAULT : null);
    if (!path) return null;
    const t = JSON.parse(readFileSync(path, 'utf8'));
    const ss = (t.sessions || []).filter(s => s && s.date);
    if (!ss.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const next = ss.filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
      || ss.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    return { ...t, next };
  } catch (e) { console.warn('[terakoya] 設定読込失敗:', e.message); return null; }
}
const fmtDate = ymd => {
  const d = new Date(ymd + 'T00:00:00Z');   // 日付のみを扱うのでUTC固定（曜日ズレ防止）
  return `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(${WD[d.getUTCDay()]})`;
};

export const ready = () => existsSync(LIST);

/**
 * 対象者ごとの本人向け文面を作る。
 * @returns {{ok:boolean, count:number, needsReview:number, targets:Array}}
 */
export function buildInvites() {
  if (!existsSync(LIST)) return { ok: false, error: `対象者リストがありません（${LIST}）` };
  const rows = parseCsv(readFileSync(LIST, 'utf8')).filter(r => r['氏名']);
  if (!rows.length) return { ok: false, error: '対象者リストが空です' };
  const T = schedule();

  const targets = rows.map(r => {
    const name = r['氏名'], cause = r['要因分類'] || '', role = r['役割区分'] || '';
    const apoB = num(r['基準週平均アポ獲得数']), apoN = num(r['直近週アポ獲得数']);
    const kB = num(r['基準週平均成約数(クロ側)']), kN = num(r['直近週成約数(クロ側)']);
    const workDays = num(r['8月出退勤日数']);
    const lastIn = r['最終出勤日時'] || '';

    // 出退勤の記録が無い＝休職・離脱の可能性。自動送信せず人が確認する。
    const needsReview = workDays <= 0;

    // 下がった指標（要因分類に対応）と、上がっている指標
    const isApo = /アポ低下/.test(cause);
    const down = isApo
      ? { label: 'アポ獲得数', base: apoB, now: apoN }
      : { label: 'クロージング成約数', base: kB, now: kN };
    const other = isApo
      ? { label: 'クロージング成約数', base: kB, now: kN }
      : { label: 'アポ獲得数', base: apoB, now: apoN };
    const improved = other.now > other.base;
    const drop = +(down.base - down.now).toFixed(1);

    const L = [];
    L.push(`${name} さん`);
    L.push('');
    L.push('Ruminaです。7月と直近週の数字を見ています。');
    L.push('');
    L.push('■ 落ちたまま戻っていない指標');
    L.push(`　${down.label}：7月の週平均 ${down.base} → 直近週(8/5〜8/9) ${down.now}`);
    if (drop > 0) L.push(`　週あたり ${drop} 件ぶん落ちたままです。`);
    if (improved) {
      L.push('');
      L.push('■ 上がっているところ');
      L.push(`　${other.label}：${other.base} → ${other.now}。ここは伸びています。`);
      L.push('　だからこそ、落ちた方を戻せば数字は一気に変わります。');
    }
    L.push('');
    if (T) {
      const n = T.next;
      L.push(`■ ${T.name || 'FF寺子屋'}に入ってください`);
      if (T.description) L.push(`　${T.description}`);
      L.push(`　次回 ${fmtDate(n.date)} ${n.time || ''}`.trimEnd());
      if (n.theme) L.push(`　テーマ：${n.theme}`);
      if (n.teacher) L.push(`　講師：${n.teacher}`);
      const link = n.url || (T.howToJoin || '').match(/https?:\/\/\S+/)?.[0];
      if (link) L.push(`　参加URL：${link}`);
    } else {
      L.push('■ FF寺子屋に入ってください（日程は追ってご案内します）');
    }
    L.push('');
    L.push('稼働は続いています。動けているなら、戻せます。');

    return {
      name, company: r['所属会社'] || '', role, cause,
      down, other, improved, drop, workDays, lastIn,
      needsReview,
      reviewReason: needsReview ? `8月の出退勤記録が0日（最終出勤：${lastIn || 'なし'}）。休職・離脱の可能性があるため要確認` : null,
      message: L.join('\n'),
    };
  });

  return {
    ok: true,
    count: targets.length,
    needsReview: targets.filter(t => t.needsReview).length,
    scheduleReady: !!T,
    targets,
  };
}
