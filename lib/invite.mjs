/* ============================================================
   招待リンク

   いま研修が回らない理由は、アプリでも文面でもなく**入口**。
   対象35名のうちLINEで届くのが0名、Slackの個人DMで届くのが2名。
   残りはパートナー会社の方で、Fit Founderのアカウントを持っていない。
   さらに、届いたとしても「ポータルでLINEログイン→氏名を選ぶ」で落ちる。

   ?rk= の仕組みは既にあり、**氏名だけでログインできる**（server.mjs の
   verifyRkToken / userFromRk）。アカウントも自動で作られ、cyzenのコードも
   氏名から補完される。足りないのは「そのリンクを作る側」だけだった。

   これは持っている人がその人としてログインできる鍵（bearer）。だから
     ・期限を切る（既定14日）
     ・発行はowner専用、誰にいつ出したかを残す
     ・リンクで入っても研修の段は飛ばせない（STEP1〜4と承認はそのまま）
   転送されれば別人が代わりに受けられてしまうが、受かっても営業解禁には
   owner の承認（面談）が要るので、そこで止まる。
   ============================================================ */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, save } from './store.mjs';

const SECRET = process.env.RUMINA_SSO_SECRET || '';
const BASE = (process.env.PUBLIC_URL || process.env.APP_URL || '').replace(/\/$/, '');
const DAYS = Math.max(1, Number(process.env.INVITE_DAYS || 14));

export function config() {
  return { ready: !!(SECRET && BASE), secretSet: !!SECRET, baseSet: !!BASE, base: BASE || null, days: DAYS };
}

/** 氏名（と会社）で入れるリンクを作る。 */
export function issue({ name, corp = null, days = DAYS } = {}) {
  const driver = String(name || '').trim();
  if (!driver) return null;
  if (!SECRET || !BASE) return null;
  const payload = { driver, corp: corp || undefined, exp: Date.now() + days * 86400000, via: 'invite' };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${BASE}/?rk=${body}.${sig}`;
}

/** 誰にいつ出したかを残す。あとで「送ったのに来ていない」を追えるように。 */
export function record(actor, rows = []) {
  const db = getDb();
  db.training ||= {};
  const log = (db.training.invites ||= []);
  const at = new Date().toISOString();
  for (const r of rows) log.push({ at, by: actor, name: r.name, corp: r.corp || null, days: DAYS });
  if (log.length > 5000) log.splice(0, log.length - 5000);
  save();
  return { ok: true, count: rows.length };
}

export function history(limit = 200) {
  return ((getDb().training || {}).invites || []).slice(-limit).reverse();
}

/* 招待した人がその後どうなったか。
   「送ったのに来ない」を追えないと運用にならない。
   招待の記録と、アプリ側のアカウント・研修の状態を突き合わせて返す。 */
export function followUp(trainingLib) {
  const db = getDb();
  const log = ((db.training || {}).invites || []);
  const norm = x => String(x || '').replace(/\s+/g, '').normalize('NFKC');
  // 同じ人に複数回出していたら、最後の1回だけ見る
  const last = new Map();
  for (const r of log) last.set(norm(r.name), r);

  const users = Object.values(db.users || {});
  return [...last.values()].map(r => {
    const u = users.find(x => norm(x.name) === norm(r.name) || norm(x.username) === norm(r.name)) || null;
    let step = null, status = null, attempts = 0, read = 0;
    if (u) {
      try { const o = trainingLib.overview(u.username); step = o.unlocked; status = o.cert.status;
        attempts = Object.values(o.best || {}).reduce((n, b) => n + (b.attempts || 0), 0);
        read = Object.values(o.readProgress || {}).reduce((n, x) => n + (x.read || 0), 0); } catch (e) {}
    }
    const days = Math.floor((Date.now() - Date.parse(r.at)) / 86400000);
    const state = !u ? 'まだ開いていません'
      : (attempts === 0 && read === 0) ? '開いたが、まだ始めていません'
      : status === 'cleared' ? '営業解禁'
      : status === 'pending' ? '面談待ち'
      : `STEP${step} に進行中`;
    return { name: r.name, corp: r.corp || null, at: r.at, days, by: r.by,
             entered: !!u, username: u ? u.username : null, step, status, attempts, read, state };
  }).sort((a, b) => (a.entered === b.entered ? b.days - a.days : (a.entered ? 1 : -1)));
}

/** 配信の対象にリンクを付けて返す。 */
export function withLinks(items = []) {
  return items.map(x => ({ ...x, inviteUrl: issue({ name: x.name, corp: x.corp || null }) }));
}
