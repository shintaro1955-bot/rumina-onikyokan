/* ============================================================
   営業解禁の突合（合格していない人が現場に出ていないか）

   このアプリはアポ登録も訪問記録も持っていないので、**ピンポンを物理的に
   止めることはできない**。止められるのはアプリの画面までで、それは既にやった。
   では何ができるか——**現場に出た事実は cyzen に残る**。
   研修の認定と cyzen の訪問実績を突き合わせれば、
   「解禁されていないのに回っている人」は必ず見つかる。見つけて止めるのは人の仕事。

   ここが「状態を出すだけ」から一歩進める線。検知して、名指しで出して、
   監査に残す。そこまでは機械にできる。

   3つに分ける（混ぜると対処が変わってしまう）：
   ・違反   … アカウントがあり、解禁されていないのに訪問がある → 今すぐ止める
   ・未登録 … cyzenに訪問はあるが、アプリのアカウントが無い → まずアカウントを出す
   ・解禁済 … 問題なし
   ============================================================ */
import { getDb } from './store.mjs';
import * as cyzen from './cyzen.mjs';
import * as training from './training.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, '').normalize('NFKC');

/** 直近days日に訪問（または稼働）がある人を cyzen から拾う。 */
function movers(days = 14) {
  const latest = cyzen.latestDate();
  if (!latest) return { ready: false, rows: [], from: null, to: null };
  const t = new Date(latest + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (days - 1));
  const from = t.toISOString().slice(0, 10);
  const per = new Map();
  for (const rec of cyzen.records()) {
    if (rec.date < from || rec.date > latest) continue;
    const moving = (rec.visitsSelf > 0) || (rec.visitStamp > 0);
    if (!moving) continue;                       // 勤務打刻だけの日は「現場に出た」と断定しない
    const u = cyzen.usersMap().get(rec.code) || {};
    if (!u.name) continue;
    let p = per.get(rec.code);
    if (!p) { p = { code: rec.code, name: u.name, group: u.group || null, days: 0, visits: 0, last: rec.date }; per.set(rec.code, p); }
    p.days++; p.visits += (rec.visitsSelf || 0);
    if (rec.date > p.last) p.last = rec.date;
  }
  return { ready: true, rows: [...per.values()], from, to: latest };
}

/**
 * 突合。owner向け。
 * @param {{days?:number}} opts 直近何日ぶんの訪問を見るか（既定14日）
 */
export function fieldCheck({ days = 14 } = {}) {
  if (!cyzen.ready()) return { ready: false, why: 'cyzenのデータがありません' };
  const m = movers(days);
  if (!m.ready) return { ready: false, why: 'cyzenの日付が取れません' };

  // アプリのアカウント（氏名とcyzenコードの両方で引けるようにする）
  const users = Object.values(getDb().users || {}).filter(u => u.role !== 'owner');
  const byCode = new Map(), byName = new Map();
  for (const u of users) {
    if (u.repId) byCode.set(String(u.repId), u);
    if (u.name) byName.set(norm(u.name), u);
  }

  const violation = [], unregistered = [], cleared = [];
  for (const r of m.rows) {
    const u = byCode.get(String(r.code)) || byName.get(norm(r.name)) || null;
    if (!u) { unregistered.push({ ...r }); continue; }
    let c = null;
    try { c = training.certPublic(u.username); } catch (e) { c = null; }
    const status = c ? c.status : 'locked';
    if (status === 'cleared') { cleared.push({ ...r, username: u.username }); continue; }
    let step = 1;
    try { step = training.unlockedStep(u.username); } catch (e) {}
    violation.push({
      ...r, username: u.username, status, step,
      why: status === 'suspended' ? '認定が停止中です' : `STEP${step}が終わっていません`,
    });
  }

  // 件数の多い順＝影響の大きい順に手を入れる
  violation.sort((a, b) => b.visits - a.visits);
  unregistered.sort((a, b) => b.visits - a.visits);

  return {
    ready: true, from: m.from, to: m.to, days,
    violation, unregistered, cleared,
    summary: {
      moved: m.rows.length,
      violation: violation.length,
      unregistered: unregistered.length,
      cleared: cleared.length,
      visitsByViolation: violation.reduce((n, x) => n + x.visits, 0),
    },
    note: 'このアプリは訪問そのものを止められません。出た事実はcyzenに残るので、突き合わせて名指しで出しています。止めるのは人の判断です。',
  };
}

/** 本人ぶん（未解禁なのに訪問がある人に見せる警告）。他人の情報は返さない。
    cyzen上の氏名とアプリのユーザー名は一致しないことがある（LINE表示名で作られた等）ので、
    **両方で引く**。片方だけで照合すると、紐付いているのに検知できない。 */
export function myViolation({ name = '', username = '' } = {}) {
  const f = fieldCheck({});
  if (!f.ready) return null;
  const n = norm(name), u = String(username || '');
  return f.violation.find(v => (u && v.username === u) || (n && norm(v.name) === n)) || null;
}
