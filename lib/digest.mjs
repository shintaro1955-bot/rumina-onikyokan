/* ============================================================
   毎晩の「行動量ダイジェスト」生成（LINE配信用）
   営業教育部 _RULE.md / SKILL.md の禁止事項に従う：
     ・本人へ「平均以下」通知をしない → 判定は**中央値**（平均は使わない）
     ・下を晒さず伸びを晒す → グループ配信は**伸びた人だけ実名**。低調は人数のみ
     ・除外条件を守る → クローザー／記録なし／利用停止／クールダウン
   集計期間は**直近1ヶ月**（データ内の最新日を基準にした30日窓）。
   数字は必ずこちらで計算してLLMに渡す（集計をLLMに委ねない）。
   ============================================================ */
import * as cyzen from './cyzen.mjs';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.DIGEST_MODEL || 'claude-opus-4-8';
const URL = 'https://api.anthropic.com/v1/messages';
/* 中央値の何割を下回ったら指導対象か。0.7＝中央値から30%下。 */
const ALERT_RATIO = Number(process.env.RANKING_ALERT_RATIO || 0.7);
/* 集計する期間（日）。既定30＝直近1ヶ月。 */
const WINDOW_DAYS = Number(process.env.RANKING_WINDOW_DAYS || 30);
/* 休職の近似：最終利用日がこの日数以上前なら対象外にする。 */
const DORMANT_DAYS = Number(process.env.RANKING_DORMANT_DAYS || 21);

const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q), m = a.length >> 1;
  return +(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2).toFixed(1);
};
const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 期間内のレコードを担当者ごとに集計する。 */
function aggregate(records, from, to) {
  const per = new Map();
  for (const r of records) {
    if (!r.date || r.date < from || r.date > to) continue;
    const active = r.visitsSelf > 0 || r.apo > 0 || r.workStart || r.workEnd;
    if (!active) continue;
    let p = per.get(r.code);
    if (!p) { p = { code: r.code, days: 0, visits: 0, apo: 0 }; per.set(r.code, p); }
    p.days++; p.visits += r.visitsSelf; p.apo += r.apo;
  }
  for (const p of per.values()) p.vpd = p.days ? +(p.visits / p.days).toFixed(1) : 0;
  return per;
}

/** 集計だけを行う（配信文面は含まない）。 */
export function buildFacts() {
  if (!cyzen.ready()) return null;
  const latest = cyzen.latestDate();
  if (!latest) return null;

  const records = cyzen.records();
  const users = cyzen.usersMap();
  const to = latest, from = addDays(latest, -(WINDOW_DAYS - 1));
  // 「伸び」は直近2週の比較。前週は30日窓の外ではなく“直近週の1つ前の週”を見る。
  const lastWeekFrom = addDays(to, -6);                    // 直近1週間
  const prevTo = addDays(lastWeekFrom, -1);                // その前日まで
  const prevFrom = addDays(prevTo, -6);                    // さらに1週間前

  const cur = aggregate(records, from, to);
  const wkNow = aggregate(records, lastWeekFrom, to);
  const wkPrev = aggregate(records, prevFrom, prevTo);

  /* --- 除外条件（_RULE.md / SKILL.md）--- */
  const excluded = { closer: 0, suspended: 0, dormant: 0, noVisit: 0 };
  const rows = [];
  for (const [code, agg] of cur) {
    const u = users.get(code) || {};
    if (/クローザー/.test(u.attr || '')) { excluded.closer++; continue; }        // 訪問しないのが正常
    if (u.suspended) { excluded.suspended++; continue; }                          // 利用停止
    if (u.lastUse && u.lastUse < addDays(to, -DORMANT_DAYS)) { excluded.dormant++; continue; } // 休職の近似
    if (agg.visits <= 0) { excluded.noVisit++; continue; }                        // 訪問実績なし
    rows.push({ code, name: u.name || code, attr: u.attr || '', ...agg });
  }
  if (!rows.length) return null;

  /* --- 判定は中央値（平均は使わない）--- */
  const medVpd = median(rows.map(r => r.vpd));
  const threshold = +(medVpd * ALERT_RATIO).toFixed(1);
  const byVpd = [...rows].sort((a, z) => z.vpd - a.vpd);
  const top = byVpd[0];

  /* --- 伸び（直近1週 vs 前1週の訪問/日の差）。配信で称える主役 --- */
  const growth = rows.map(r => {
    const a = wkNow.get(r.code), b = wkPrev.get(r.code);
    if (!a || !b || !a.days || !b.days) return null;
    return { name: r.name, now: a.vpd, prev: b.vpd, delta: +(a.vpd - b.vpd).toFixed(1) };
  }).filter(g => g && g.delta > 0).sort((a, z) => z.delta - a.delta).slice(0, 3);

  /* --- 指導対象：人数と、上長画面用の明細（配信では実名を出さない）--- */
  const below = byVpd.filter(r => r.vpd < threshold).sort((a, z) => a.vpd - z.vpd)
    .map(r => ({
      name: r.name, vpd: r.vpd, visits: r.visits, days: r.days,
      gapToTop: +(top.vpd - r.vpd).toFixed(1),
      shortfall: +(medVpd - r.vpd).toFixed(1),      // 中央値まであと何件/日
    }));

  return {
    window: { from, to, days: WINDOW_DAYS },
    memberCount: rows.length,
    medianVpd: medVpd, threshold, alertRatio: ALERT_RATIO,
    top3: byVpd.slice(0, 3).map(r => ({ name: r.name, vpd: r.vpd, visits: r.visits, days: r.days })),
    growth,
    belowCount: below.length,
    below,                       // ※上長画面用。配信文面には実名を出さないこと
    excluded,
    totalVisits: rows.reduce((n, r) => n + r.visits, 0),
  };
}

/** 決定論の文面（APIキーが無くても必ず配信できる）。実名は「伸び」と「トップ」だけ。 */
export function fallbackMessage(f) {
  const L = [];
  L.push('【行動量】今日の締め');
  L.push(`直近${f.window.days}日（${f.window.from}〜${f.window.to}） 対象${f.memberCount}名`);
  L.push('');
  if (f.growth.length) {
    L.push('■ 今週伸びた人');
    f.growth.forEach((g, i) => L.push(`${i + 1}. ${g.name} ${g.prev}→${g.now}件/日（+${g.delta}）`));
    L.push('');
  }
  L.push('■ 訪問数トップ3（件/日）');
  f.top3.forEach((t, i) => L.push(`${i + 1}. ${t.name} ${t.vpd}件/日（計${t.visits}件）`));
  L.push('');
  L.push(`■ 基準（中央値${f.medianVpd}件/日の70%＝${f.threshold}件/日）に届いていない：${f.belowCount}名`);
  if (f.belowCount) L.push('　→ 該当者には個別に明日の一手を送ります。');
  L.push('');
  L.push('明日、まず午前の訪問数を積め。量が土台だ。');
  return L.join('\n');
}

const SYSTEM = [
  'あなたは訪問販売の営業教育AI「鬼教官」。優しくないが人格否定は絶対にしない。',
  'これはLINEの社内グループに流す短い日次メッセージ。Markdownの表や見出し記号(#, *)は使わない。',
  '**最重要の禁止事項：基準に届いていない人の名前を絶対に書かない。人数だけ書く。**',
  '称えるのは「伸びた人」と「トップ3」だけ。下位を晒すことは会社の規則で禁止されている。',
  '与えられた数字だけを使い、集計し直したり推測で補ってはいけない。',
].join(' ');

/** Claudeで鬼教官の口調の配信文を作る。失敗したら決定論の文面を返す。 */
export async function buildMessage() {
  const f = buildFacts();
  if (!f) return { ok: false, error: 'cyzenのデータがありません（または対象者0名）' };
  const fallback = fallbackMessage(f);
  if (!API_KEY) return { ok: true, message: fallback, facts: f, generatedBy: 'rule' };

  // 配信用に渡すのは「実名を出してよい情報」だけ。below（実名）は渡さない。
  const safe = {
    window: f.window, memberCount: f.memberCount,
    medianVpd: f.medianVpd, threshold: f.threshold,
    top3: f.top3, growth: f.growth,
    belowCount: f.belowCount, totalVisits: f.totalVisits,
  };

  const user = [
    '次の集計から、今夜21時にLINEの社内グループへ流すメッセージを書いてください。',
    '',
    '【必ず守る】',
    '・基準未達者の名前は書かない。「◯名」と人数だけ。その後に「該当者には個別に連絡する」と一言。',
    '・実名を出すのは「今週伸びた人」と「訪問数トップ3」だけ。',
    '・基準は中央値から30%下。「平均」という言葉は使わない。',
    '',
    '【構成】',
    '1) 集計期間と対象人数（1行）',
    '2) 今週伸びた人（前週比の改善幅。いれば必ず最初に称える）',
    '3) 訪問数トップ3',
    '4) 基準未達の人数のみ',
    '5) 明日の行動を促す締めを一言',
    '',
    '【書き方】全体700文字以内。改行多め、箇条書き中心。鬼教官の口調だが人格否定はしない。',
    '',
    '【集計結果（この数字以外は使わない）】',
    JSON.stringify(safe, null, 1),
  ].join('\n');

  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    });
    const j = await res.json();
    if (j.error) { console.warn('[digest] Anthropic error:', j.error.message); return { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' }; }
    let text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    // 保険：万一LLMが未達者の実名を書いても外へ出さない（規則違反を機械的に防ぐ）
    // 称賛枠（伸び・トップ3）に載る人は実名で出してよい＝「伸びを晒す」側。
    // 規則違反になるのは、称賛でない文脈で未達者の実名が出た場合だけ。
    const praised = new Set([...f.growth.map(g => g.name), ...f.top3.map(t => t.name)]);
    const leaked = f.below.filter(b => b.name && !praised.has(b.name) && text.includes(b.name));
    if (leaked.length) {
      console.warn('[digest] 未達者の実名が生成文に混入したため決定論の文面に差し替え:', leaked.length);
      return { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback(leak-guard)' };
    }
    return text
      ? { ok: true, message: text, facts: f, generatedBy: MODEL }
      : { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' };
  } catch (e) {
    console.warn('[digest] 失敗:', e.message);
    return { ok: true, message: fallback, facts: f, generatedBy: 'rule-fallback' };
  }
}
