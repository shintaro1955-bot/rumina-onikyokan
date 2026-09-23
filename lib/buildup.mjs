/* ============================================================
   底上げ一覧（誰がどの段で止まっているか・owner向け）

   ・基準は**固定ベンチマークではなくチーム自身の実データ**。
     代表値は平均ではなく**中央値**（訪問226件/21日と56件/1日が混在し、
     平均は外れ値に強く引っ張られるため）。目標は**上位25%＝トップ層**。
   ・段は下から順に見る（下が崩れているのに上を指導しても効かない）：
       稼働 → 行動量 → トーク → クロージング
   ・「訪問は十分あるのにアポ0」は**低調と断定しない**。cyzenのアポ計上漏れが
     実在する（営業教育部_RULE：1日70件訪問して"アポ0"と出る例）。記録側の
     問題として分けて出す。混ぜると誤指導になる。
   ・クローザーは物差しが違うので訪問/アポの段からは外す。
   ============================================================ */
import * as cyzen from './cyzen.mjs';

const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
function median(arr) {
  const a = arr.filter(x => num(x) !== null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(2);
}
function pct(arr, p) {
  const a = arr.filter(x => num(x) !== null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

/* 段ごとの処方。既存の道具に繋ぐ（新しい教材は作らない）。 */
const FIX = {
  稼働: { what: 'まず出る日を戻す。記録が無い人は休職・離脱の可能性もあるので、自動連絡ではなく人が確認する。', where: '入力チェック' },
  記録: { what: 'アポの計上が抜けている疑い。訪問数に対してアポ報告が0件。本人を責める前に、報告の出し方を確認する。', where: '入力チェック' },
  行動量: { what: '1日の訪問数を上げる。時間帯と回る順を決めて、母数を作るところから。', where: '玄関ナビ・行動量ランキング' },
  トーク: { what: '訪問は足りている。落ちているのは玄関先の型。録音を出させて、崩れている局面を潰す。', where: '鬼教官（一日のトークコーチ・弱点ロープレ）' },
  クロージング: { what: '商談までは作れている。詰めの型を直す。', where: '寺子屋・ロープレ道場' },
};

function statsOf(pool) {
  return {
    days: { median: median(pool.map(x => x.days)), top: pct(pool.map(x => x.days), 0.75) },
    vpd: { median: median(pool.map(x => x.vpd)), top: pct(pool.map(x => x.vpd), 0.75) },
    apoRate: { median: median(pool.filter(x => x.apo > 0).map(x => x.apoRate)), top: pct(pool.filter(x => x.apo > 0).map(x => x.apoRate), 0.75) },
    closeRate: { median: median(pool.filter(x => x.closeRate != null).map(x => x.closeRate)), top: pct(pool.filter(x => x.closeRate != null).map(x => x.closeRate), 0.75) },
    people: pool.length,
  };
}

/** チームの物差しだけを返す（個人の数字は含まない）。本人の目標ページ用。 */
export function teamStats({ ym = '' } = {}) {
  const r = cyzen.roster({ ym });
  if (!r.ready) return { ready: false };
  const pool = (r.rows || []).filter(x => x.days > 0 && !x.isCloser);
  if (!pool.length) return { ready: false };
  return { ready: true, ...statsOf(pool) };
}

/* その人の「止まっている段」の数字が、先週から動いたか。
   直近7日とその前の7日を比べる（cyzen.trends）。前週に稼働が無い人は
   比較にならないので「新規」として扱い、伸びたことにしない。 */
function trendOf(rung, t) {
  if (!t) return null;
  const mk = (now, prev, unit, digits = 1) => {
    if (!t.priDays) return { dir: 'new', label: '先週は稼働なし' };
    const d = +(now - prev).toFixed(digits);
    const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    return { dir, delta: d, now: `${now}${unit}`, prev: `${prev}${unit}`, sign: `${d > 0 ? '+' : ''}${d}${unit}` };
  };
  if (rung === '稼働') return mk(t.recDays, t.priDays, '日', 0);
  if (rung === '行動量') return mk(t.recVpd, t.priVpd, '件/日');
  if (rung === 'トーク') return mk(t.recApoRate, t.priApoRate, '%');
  return null;   // クロージングは週次の成約データを持たないので比較しない
}

/**
 * 底上げ一覧。ym（'2026-09'）を渡すとその月、無ければ全期間。
 */
export function buildup({ ym = '' } = {}) {
  const r = cyzen.roster({ ym });
  if (!r.ready) return { ready: false, rows: [], stats: null };
  const tr = cyzen.trends({ recentDays: 7 });
  const trendBy = new Map((tr.rows || []).map(x => [x.code, x]));

  // 母集団＝期間中に稼働のある人。クローザーは別物差しなので除く。
  const pool = (r.rows || []).filter(x => x.days > 0 && !x.isCloser);
  if (!pool.length) return { ready: true, rows: [], stats: null, total: 0 };

  const stats = statsOf(pool);

  const rows = [];
  for (const x of pool) {
    let rung = null, now = '', target = '', gap = '';

    // ① 稼働そのもの（下の段が崩れていたら上は見ない）
    if (stats.days.median && x.days < stats.days.median * 0.6) {
      rung = '稼働';
      now = `稼働${x.days}日`; target = `中央値${stats.days.median}日`;
      gap = `中央値まであと${Math.max(1, Math.ceil(stats.days.median - x.days))}日`;
    }
    // ② 行動量（訪問/日）
    else if (stats.vpd.median && x.vpd < stats.vpd.median) {
      rung = '行動量';
      now = `訪問${x.vpd}件/日`; target = `中央値${stats.vpd.median}件・トップ層${stats.vpd.top}件`;
      gap = `1日あと${Math.ceil(stats.vpd.median - x.vpd)}件`;
    }
    // ③ 記録の疑い（訪問は足りているのにアポ報告が1件も無い）
    else if (x.apo === 0) {
      rung = '記録';
      now = `訪問${x.visits}件・アポ報告0件`; target = '報告が上がっている状態'; gap = '—';
    }
    // ④ トークの質（アポ率）
    else if (stats.apoRate.median && x.apoRate < stats.apoRate.median) {
      rung = 'トーク';
      const need = Math.ceil(stats.apoRate.median / 100 * x.visits) - x.apo;
      now = `アポ率${x.apoRate}%`; target = `中央値${stats.apoRate.median}%・トップ層${stats.apoRate.top}%`;
      gap = need > 0 ? `同じ訪問数であとアポ${need}件` : 'あとわずか';
    }
    // ⑤ クロージング
    else if (stats.closeRate.median && x.closeRate != null && x.closeRate < stats.closeRate.median) {
      rung = 'クロージング';
      now = `成約率${x.closeRate}%`; target = `中央値${stats.closeRate.median}%`; gap = '—';
    }
    if (!rung) continue;   // 全段クリア＝底上げ対象ではない

    rows.push({
      code: x.code, name: x.name, group: x.group || null,
      days: x.days, visits: x.visits, vpd: x.vpd, apo: x.apo, apoRate: x.apoRate, closeRate: x.closeRate,
      rung, now, target, gap, fix: FIX[rung].what, where: FIX[rung].where,
      trend: trendOf(rung, trendBy.get(x.code)),
      // 効き幅＝同じ1段の改善でも、訪問母数が大きい人ほど件数として効く
      weight: x.visits,
    });
  }

  // 訪問数が多い人ほど、同じ1段の改善で効く件数が大きい＝先に手を入れる
  const order = { 記録: 0, 稼働: 1, 行動量: 2, トーク: 3, クロージング: 4 };
  rows.sort((a, b) => (order[a.rung] - order[b.rung]) || (b.weight - a.weight));

  const summary = {};
  for (const k of ['記録', '稼働', '行動量', 'トーク', 'クロージング']) summary[k] = rows.filter(x => x.rung === k).length;

  // 先週比の全体像。指導が効いているかを見る数字なので、比較できる人だけで数える。
  const cmp = rows.filter(x => x.trend && x.trend.dir !== 'new');
  const movement = {
    compared: cmp.length,
    up: cmp.filter(x => x.trend.dir === 'up').length,
    flat: cmp.filter(x => x.trend.dir === 'flat').length,
    down: cmp.filter(x => x.trend.dir === 'down').length,
    fresh: rows.filter(x => x.trend && x.trend.dir === 'new').length,
    anchor: tr.anchor || null,
  };

  return { ready: true, ym: ym || null, stats, rows, total: rows.length, pool: pool.length, summary, movement };
}
