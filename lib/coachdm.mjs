/* ============================================================
   個別コーチング通知（本人へのDM）
   狙い：順位と「次に届く順位」を示し、必要な件数を具体で渡して数を追わせる。
   ・本人にだけ届く（グループには出さない＝下を晒さない）。
   ・比較の物差しは**中央値**を使う（_RULE.md：本人へ「平均以下」通知をしない）。
     「平均より下」ではなく「あと◯件で◯位」という前向きな差分で提示する。
   ・数字はすべてこちらで計算する。文面のばらつきを避けるため決定論で組み立てる。
   ============================================================ */
import { buildFacts } from './digest.mjs';

/** 目標順位の刻み。既定5＝「5つ上」を当面の目標にする。 */
const STEP = Number(process.env.COACH_RANK_STEP || 5);

/**
 * 指導対象（基準未達）ごとの本人向けメッセージを作る。
 * @param {{all?:boolean}} opts all=true なら全員分（未達者以外も）作る
 */
export function buildPersonalMessages(opts = {}) {
  const f = buildFacts();
  if (!f) return { ok: false, error: 'cyzenのデータがありません' };

  const ranked = f.ranked;
  const total = ranked.length;
  const targets = opts.all ? ranked : ranked.filter(r => r.vpd < f.threshold);

  const messages = targets.map(me => {
    const i = me.rank - 1;
    const oneUp = ranked[i - 1] || null;                       // すぐ上の人
    const goal = ranked[Math.max(0, i - STEP)] || ranked[0];   // STEP上の目標順位

    // 「あと何件/日」で届くか。1日あたりの必要増分で示す（行動に落ちる形にする）。
    const toOneUp = oneUp ? +(oneUp.vpd - me.vpd + 0.1).toFixed(1) : 0;
    const toGoal = +(Math.max(0, goal.vpd - me.vpd) + 0.1).toFixed(1);
    const toMedian = +(Math.max(0, f.medianVpd - me.vpd)).toFixed(1);
    // 1日の訪問可能時間を8hとして、必要増分を「1時間あたり何件」に噛み砕く
    const perHour = (n) => Math.max(1, Math.ceil(n / 8));

    const L = [];
    L.push('【あなたの行動量】');
    L.push(`直近${f.window.days}日（${f.window.from}〜${f.window.to}）`);
    L.push('');
    L.push(`■ いまの順位：${total}人中 ${me.rank}位`);
    L.push(`　訪問 ${me.vpd}件/日（${f.window.days}日で計${me.visits}件・稼働${me.days}日）`);
    L.push('');
    if (oneUp && toOneUp > 0) {
      L.push(`■ すぐ抜ける相手：${me.rank - 1}位`);
      L.push(`　あと ${toOneUp}件/日 で並ぶ`);
    }
    L.push(`■ 目指す順位：${goal.rank}位`);
    L.push(`　あと ${toGoal}件/日（1時間あたり+${perHour(toGoal)}件のペース）`);
    L.push('');
    L.push('■ 弱いのはここ');
    L.push(`　訪問数。中央値 ${f.medianVpd}件/日 に対して ${toMedian}件/日 足りていない。`);
    L.push('　トークの質を上げる前に、まず母数だ。量が足りなければ確率は掛けようがない。');
    L.push('');
    L.push('必ず数は追っていけ。明日はまず午前に前倒しで積め。');

    return {
      code: me.code, name: me.name, rank: me.rank, total,
      vpd: me.vpd, goalRank: goal.rank, needPerDay: toGoal,
      below: me.vpd < f.threshold,
      message: L.join('\n'),
    };
  });

  return { ok: true, window: f.window, medianVpd: f.medianVpd, threshold: f.threshold, count: messages.length, messages };
}
