/* ============================================================
   毎晩の「行動量ダイジェスト」生成（LINE配信用）
   ・cyzenの行動データから、トップと平均、そして基準を下回るメンバーを抽出する。
   ・「平均から30%下」= 平均訪問/日 × 0.7 未満（RANKING_ALERT_RATIO で変更可）。
   ・文面はClaudeが鬼教官の口調で作る。キー未設定でも決定論の文面で必ず配信できる。
   ・数字は必ずこちらで計算したものを渡す（LLMに集計させない＝数字がブレないため）。
   ============================================================ */
import * as cyzen from './cyzen.mjs';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.DIGEST_MODEL || 'claude-opus-4-8';
const URL = 'https://api.anthropic.com/v1/messages';
/* 平均の何割を下回ったら「鬼教官行き」にするか。0.7＝平均から30%下。 */
const ALERT_RATIO = Number(process.env.RANKING_ALERT_RATIO || 0.7);
/* 配信に載せる「鬼教官行き」の最大人数（多すぎると読まれないため） */
const ALERT_MAX = Number(process.env.RANKING_ALERT_MAX || 10);

/** 集計だけを行う（配信文面は含まない）。 */
export function buildFacts() {
  const r = cyzen.roster();
  if (!r.ready) return null;
  const active = (r.rows || []).filter(x => x.days > 0);
  if (!active.length) return null;

  /* 行動量の母数は「訪問実績のある人」に限る。
     訪問0件には“クローザー（訪問しないのが正常）”が混ざるため、
     一緒に平均を取ると基準が下振れし、本当に指導すべき人が埋もれる。 */
  const rows = active.filter(x => x.visits > 0);
  if (!rows.length) return null;
  const zeroVisit = active.filter(x => x.visits === 0);

  const byVpd = [...rows].sort((a, z) => z.vpd - a.vpd);
  const top = byVpd[0];
  const avgVpd = +(rows.reduce((n, x) => n + x.vpd, 0) / rows.length).toFixed(1);
  const threshold = +(avgVpd * ALERT_RATIO).toFixed(1);
  const bench = (r.bench || {}).visitsPerDay || 31;

  // 基準を下回った人＝鬼教官行き。少ない順（＝深刻な順）に並べる。
  const below = byVpd.filter(x => x.vpd < threshold).sort((a, z) => a.vpd - z.vpd)
    .map(x => ({
      name: x.name, vpd: x.vpd, visits: x.visits, days: x.days, apo: x.apo, seg: x.seg,
      gapToTop: +(top.vpd - x.vpd).toFixed(1),                 // トップとの差（件/日）
      ratioOfTop: Math.round(x.vpd / top.vpd * 100),           // トップを100とした時の水準
      shortfallPerDay: +(avgVpd - x.vpd).toFixed(1),           // 平均に届くまであと何件/日
    }));

  return {
    periodDays: r.summary.periodDays,
    memberCount: rows.length,                 // 訪問実績のある人＝行動量の母数
    notRecorded: r.summary.E || 0,
    zeroVisit: {                              // 訪問0件（別枠。クローザーは訪問しないのが正常）
      count: zeroVisit.length,
      closers: zeroVisit.filter(x => x.isCloser).length,
      names: zeroVisit.filter(x => !x.isCloser).slice(0, 5).map(x => x.name),
    },
    avgVpd, threshold, alertRatio: ALERT_RATIO, bench,
    top3: byVpd.slice(0, 3).map(x => ({ name: x.name, vpd: x.vpd, visits: x.visits, days: x.days })),
    totalVisits: rows.reduce((n, x) => n + x.visits, 0),
    reachedBench: rows.filter(x => x.vpd >= bench).length,
    below, belowCount: below.length,
  };
}

/** 決定論の文面（APIキーが無い/失敗したときでも必ず配信できるようにする）。 */
export function fallbackMessage(f) {
  const L = [];
  L.push('【行動量ランキング】今日の締め');
  L.push(`集計 ${f.periodDays}営業日 ・ 対象${f.memberCount}名 ・ 平均${f.avgVpd}件/日`);
  L.push('');
  L.push('■ トップ3（訪問/日）');
  f.top3.forEach((t, i) => L.push(`${i + 1}. ${t.name} ${t.vpd}件/日（計${t.visits}件）`));
  L.push('');
  if (!f.below.length) {
    L.push(`■ 鬼教官行き：なし`);
    L.push(`全員が基準（平均の${Math.round(f.alertRatio * 100)}%＝${f.threshold}件/日）を上回っている。この状態を続けろ。`);
  } else {
    L.push(`■ 鬼教官行き（平均から30%下＝${f.threshold}件/日 未満）：${f.belowCount}名`);
    f.below.slice(0, ALERT_MAX).forEach(b => {
      L.push(`・${b.name} ${b.vpd}件/日（トップと-${b.gapToTop}件/日、トップの${b.ratioOfTop}%）`);
      L.push(`　→ 平均まであと${b.shortfallPerDay}件/日`);
    });
    if (f.below.length > ALERT_MAX) L.push(`ほか${f.below.length - ALERT_MAX}名`);
  }
  const z = f.zeroVisit || { count: 0, closers: 0, names: [] };
  if (z.count) {
    L.push('');
    L.push(`■ 訪問記録ゼロ：${z.count}名（うちクローザー${z.closers}名は訪問しないのが正常）`);
    if (z.names.length) L.push(`　要確認：${z.names.join('、')}${z.count - z.closers > z.names.length ? ' ほか' : ''}`);
  }
  if (f.notRecorded) { L.push(''); L.push(`※記録なし${f.notRecorded}名は評価対象外。まずcyzenに記録を上げること。`); }
  return L.join('\n');
}

const SYSTEM = [
  'あなたは訪問販売の営業教育AI「鬼教官」。優しくないが人格否定は絶対にしない。',
  '数字と行動にだけ厳しく踏み込み、最後は必ず「勝たせる」視点で締める。',
  'これはLINEに流す短い日次メッセージ。Markdownの表や見出し記号(#, *)は使わない。',
  '与えられた数字だけを使う。数字を足したり丸めたり、推測で補ってはいけない。',
].join(' ');

/** Claudeで鬼教官の口調の配信文を作る。失敗したら決定論の文面を返す。 */
export async function buildMessage() {
  const f = buildFacts();
  if (!f) return { ok: false, error: 'cyzenのデータがありません' };
  const fallback = fallbackMessage(f);
  if (!API_KEY) return { ok: true, message: fallback, facts: f, generatedBy: 'rule' };

  const user = [
    '次の集計結果から、今夜21時にLINEへ流す「行動量ランキング」の短いメッセージを書いてください。',
    '',
    '【必ず入れる要素】',
    '1) トップ3の名前と訪問/日',
    '2) 平均訪問/日と、今回の基準値（平均から30%下）',
    `3) 基準を下回った「鬼教官行き」のメンバー（最大${ALERT_MAX}名）。各人について「トップとの差」と「平均まであと何件/日」を必ず明記する`,
    '4) 最後に一言、明日の行動を促す締め',
    '',
    '【書き方】',
    '・全体で900文字以内。LINEなので改行を多めに、箇条書き中心。',
    '・鬼教官の口調。ただし人格否定はしない。数字と行動にだけ厳しく。',
    '・記録なしの人がいる場合は「評価対象外＝まず記録を上げろ」と一行添える。',
    '',
    '【集計結果（この数字以外は使わない）】',
    JSON.stringify(f, null, 1),
  ].join('\n');

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[digest] Anthropic error:', j.error.message); return { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' }; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return text
      ? { ok: true, message: text, facts: f, generatedBy: MODEL }
      : { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' };
  } catch (e) {
    console.warn('[digest] 失敗:', e.message);
    return { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' };
  }
}
