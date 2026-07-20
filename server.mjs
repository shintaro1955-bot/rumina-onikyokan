/* ============================================================
   Rumina 鬼教官 — Phase 1 サーバー
   静的SPA配信 ＋ 実Whisper解析API。依存パッケージゼロ（Node 18+）。
   環境変数：OPENAI_API_KEY（必須）, PORT, WHISPER_MODEL, VISIT_GAP_SEC ...
   ============================================================ */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { pipeline as streamPipeline } from 'node:stream/promises';

import * as whisper from './lib/whisper.mjs';
import { toChunks, probeDuration } from './lib/audio.mjs';
import { analyze, computeModelProfile, DOMAIN_PROMPT } from './lib/pipeline.mjs';
import { parsePlaud } from './lib/import-plaud.mjs';
import { fetchAppointments } from './lib/crm.mjs';
import { getDb, save, saveReport, getReport, UPLOAD_DIR } from './lib/store.mjs';
import * as cyzen from './lib/cyzen.mjs';
import { hashPassword, verifyPassword, signSession, verifySession, randomPassword } from './lib/auth.mjs';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = process.env.PORT || 4180;
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.WHISPER_MODEL || 'whisper-1';

// 録音・解析への同意（版）。文言を更新したら版を上げると全員に再同意を求められる。
const CONSENT_VERSION = process.env.CONSENT_VERSION || '2026-07-15';
// 文字起こし後に音声ファイルを自動削除するか（既定=保持）。個人情報を残さない運用に。
const PURGE_AUDIO = /^(1|true|yes|on)$/i.test(process.env.PURGE_AUDIO_AFTER_ANALYZE || '');
// LINE bot 個別コーチング連携：この共有シークレット付きでのみ /api/coach-context を許可
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

// LINEログイン（LINE Developers の「LINEログイン」チャネル）
const LINE_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LINE_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LINE_CALLBACK = process.env.LINE_CALLBACK_URL || '';   // 未設定ならリクエストのホストから自動生成
const OWNER_LINE_ID = process.env.OWNER_LINE_ID || '';       // このLINEユーザーIDは管理者(owner)にする
const LINE_READY = !!(LINE_ID && LINE_SECRET);

// Fit Founderポータルからの本人引き継ぎ（?rk=）の共有秘密。ポータル側と同じ値にすること。
const SSO_SECRET = process.env.RUMINA_SSO_SECRET || '';

// Rumina Coach 連携（任意）。Coachの測定依頼リンク（?staff=&iv=）経由でアクセスした
// セッションのみ、測定完了時に解析結果をCoachのwebhookへ送る。未設定なら何も送らない。
const COACH_WEBHOOK_URL = (process.env.COACH_WEBHOOK_URL || '').replace(/\/$/, '');
const COACH_WEBHOOK_SECRET = process.env.COACH_WEBHOOK_SECRET || '';

/** 測定完了をCoachへ通知する（fire-and-forget。失敗しても鬼教官側の処理は止めない）。 */
async function notifyCoach(interventionId, analysis) {
  if (!COACH_WEBHOOK_URL || !interventionId) return;
  try {
    const url = `${COACH_WEBHOOK_URL}/webhook/oni?secret=${encodeURIComponent(COACH_WEBHOOK_SECRET)}&iv=${encodeURIComponent(interventionId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysis }),
    });
    if (!res.ok) console.error(`[coach] webhook failed ${res.status}: ${await res.text().catch(() => '')}`);
  } catch (e) {
    console.error(`[coach] webhook error: ${e.message}`);
  }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// トップ営業ベンチマーク（本番はチームのトップN平均を日次更新。SPEC §7）
const BENCHMARK = { targetPings: 100, homeResponseRate: 35, conversationRate: 20, averageConversationSeconds: 55, averageRebuttalCount: 1.8, appointmentRate: 3.5, openingQuestionRate: 80 };

// Phase 1：セッションはメモリ保持（本番はDB/オブジェクトストレージへ）
const SESSIONS = new Map();

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((r, j) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); req.on('error', j); });

/* ---------- 認証ヘルパー ---------- */
const COOKIE = 'rk_session';
function parseCookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function setSessionCookie(req, res, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/;${secure} Max-Age=${7 * 86400}`);
}
function clearSessionCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); }
function currentUser(req) {
  const s = verifySession(parseCookies(req)[COOKIE]);
  if (!s) return null;
  const u = getDb().users[s.username];
  return u ? { username: u.username, name: u.name, role: u.role, repId: u.repId } : null;
}
// LINEコールバックURL（未設定ならリクエストのホストから組み立て）
function lineCallback(req) {
  if (LINE_CALLBACK) return LINE_CALLBACK;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/line/callback`;
}
// 重複しないユーザー名を作る（LINE表示名ベース）
function uniqueUsername(db, base) {
  let u = base || 'LINEユーザー', n = 1;
  while (db.users[u]) u = `${base}_${++n}`;
  return u;
}
/* ---------- Fit Founderポータルからの本人引き継ぎ（?rk=...） ----------
   ポータルでLINEログイン＋本人選択を終えた人がアプリを開くとURLに ?rk= が付く。
   共有秘密(RUMINA_SSO_SECRET)でHMAC検証し、通れば鬼教官側も本人としてログイン済みにする。
   ポータルの名簿を通っている＝実在の営業マンが確定しているので、承認待ちにはしない。 */
function verifyRkToken(token) {
  if (!token || !SSO_SECRET) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const expected = createHmac('sha256', SSO_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || new Date().getTime() > payload.exp) return null;   // 10分で失効
  if (!payload.lineId && !payload.driver) return null;
  return payload;
}
/** rkのlineId／氏名で既存ユーザーを探し、無ければ作る。見つかった場合はlineIdを補完する。 */
function userFromRk(rk) {
  const db = getDb();
  let user = rk.lineId ? Object.values(db.users).find(u => u.lineId === rk.lineId) : null;
  if (!user && rk.driver) {
    const norm = s => String(s || '').replace(/\s+/g, '').normalize('NFKC');
    // 氏名一致で拾うのは「まだ誰のLINEとも紐付いていないアカウント」だけ。
    // 既に別のlineIdが入っているアカウントは同姓同名の別人の可能性があるので触らない。
    user = Object.values(db.users).find(u => !u.lineId &&
      (norm(u.name) === norm(rk.driver) || norm(u.username) === norm(rk.driver)));
    if (user && rk.lineId) { user.lineId = rk.lineId; save(); }   // 既存アカウントに紐付け
  }
  if (!user) {
    const uname = uniqueUsername(db, (rk.driver || 'LINEユーザー').trim());
    user = { username: uname, name: (rk.driver || uname).trim(), role: 'rep', repId: null,
             lineId: rk.lineId || null, isModel: false, pending: false, viaPortal: true };
    db.users[uname] = user; save();
  } else if (user.pending) { user.pending = false; save(); }   // ポータル経由なら承認待ちを解除
  return user;
}

// 登録済みの「成功モデル」基準（未登録なら undefined → pipeline側の初期MODEL_TALK）
function modelTalk() {
  const m = getDb().model;
  return (m && Array.isArray(m.profile) && m.profile.length) ? m.profile : undefined;
}
/* cyzen照合：営業コード(repId=cyzenユーザーコード)と稼働日から、その日の行動量を引く。
   その日の記録が無ければ直近の最活動日にフォールバック（PoC表示用。exact=falseで明示）。 */
function cyzenForRep(repId, date) {
  if (!cyzen.ready() || !repId) return null;
  let rec = cyzen.dayActivity(repId, date), exact = true;
  if (!rec) { rec = cyzen.bestDay(repId); exact = false; }
  if (!rec) return null;
  return {
    matched: true, exact, code: repId, name: rec.name, attr: rec.attr,
    date: rec.date, requestedDate: date,
    visits: rec.visitsSelf, apo: rec.apo, shodan: rec.shodan, seiyaku: rec.seiyaku, haisen: rec.haisen,
    visitStamp: rec.visitStamp, gpsStamp: rec.gpsStamp,
    workStart: rec.workStart, workEnd: rec.workEnd,
  };
}
// 解析コンテキストにcyzenの確定値を足す（分母＝訪問件数、アポ数）
function withCyzen(ctx, repId, date) {
  const c = cyzenForRep(repId, date);
  if (!c) return ctx;
  return {
    ...ctx,
    cyzen: c,
    confirmedPings: c.visits > 0 ? c.visits : undefined,
    crmAppointmentCount: c.apo > 0 ? c.apo : ctx.crmAppointmentCount,
  };
}

// 録音・解析への同意が最新版で取得済みか
function hasConsent(me) {
  if (!me) return false;
  const c = getDb().consents[me.username];
  return !!(c && c.version === CONSENT_VERSION && c.agree !== false);
}
// LINE bot 個別コーチング用の要約（最新測定から伸びしろと一言処方を作る）
function coachContext(user, sub) {
  const a = (sub && sub.analysis) || {};
  const tf = a.talkFidelity || {};
  const w = tf.weakest || null;
  const grade = tf.overall != null ? (tf.overall >= 90 ? 'A' : tf.overall >= 70 ? 'B' : tf.overall >= 50 ? 'C' : 'D') : null;
  const message = w
    ? `${user.name}さんの直近の診断：総合再現率${tf.overall}%（判定${grade}）。いちばんの伸びしろは「${w.key}」（あなた${w.repRate}% / モデル${w.modelRate}%）。今日はここだけ意識：${w.tip}`
    : `${user.name}さんの直近スコアは${a.coachScore != null ? a.coachScore + '点' : '未測定'}。まずは会話が成立した訪問を増やしていきましょう。`;
  return {
    found: true, name: user.name, repId: user.repId || null, at: sub ? sub.at : null,
    latest: sub ? {
      date: a.date || null, coachScore: a.coachScore ?? null, overall: tf.overall ?? null, grade,
      weakest: w ? { key: w.key, repRate: w.repRate, modelRate: w.modelRate, tip: w.tip } : null,
      appointmentRate: a.appointmentRate ?? null, totalPings: a.totalPings ?? null,
    } : null,
    message,
  };
}
// 診断ログを永続化（1録音=1レコード。文字起こし全文・訪問明細・KPIを保存）
function persistReport(id, result, userName) {
  const a = result.analysis || {};
  saveReport({
    id, at: new Date().toISOString(),
    salesRepName: a.salesRepName || null, date: a.date || null,
    source: result.source || 'whisper',
    coachScore: a.coachScore ?? null,
    overall: a.talkFidelity ? a.talkFidelity.overall : null,
    pingCount: Array.isArray(result.pings) ? result.pings.length : null,
    audio: result.source === 'plaud' ? 'none' : (result.audioRetained === false ? 'purged' : 'kept'),
    user: userName || null,
    analysis: a, pings: result.pings || [], transcript: result.transcript || [],
  });
}

// 起動時：ownerが居なければ管理者アカウントを1つseed（＝モデル営業マン。既定は owner）
(function seedOwner() {
  const db = getDb();
  if (Object.keys(db.users).length) return;
  const username = process.env.OWNER_USER || 'owner';
  const pw = process.env.OWNER_PASSWORD || 'rumina2026';
  const { salt, hash } = hashPassword(pw);
  db.users[username] = { username, name: username, role: 'owner', repId: 'owner', salt, hash, isModel: true };
  save();
  console.log(`✓ 初期オーナー作成：ユーザー名「${username}」／初期パスワード「${pw}」（本番はOWNER_PASSWORDで指定・変更を）`);
})();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  try {
    // ---------- ポータルからの本人引き継ぎ ----------
    // URLに ?rk= が付いていたら本人として即ログインし、rkを外して同じ画面へ送り直す。
    // （rkはURL＝履歴やリファラに残るため、Cookieに移し替えて以後は使わない）
    if (url.searchParams.has('rk') && !path.startsWith('/api/')) {
      const rk = verifyRkToken(url.searchParams.get('rk'));
      url.searchParams.delete('rk');
      const clean = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams : '');
      if (rk) {
        const user = userFromRk(rk);
        setSessionCookie(req, res, signSession({ username: user.username, role: user.role }));
      }
      res.writeHead(302, { Location: clean || '/' });
      return res.end();
    }

    // ---------- API ----------
    if (path.startsWith('/api/')) {
      // 健康チェック（APIキーの有無を返す。UIが実接続可否を判定）
      if (path === '/api/health') return json(res, 200, { ok: true, whisperReady: !!API_KEY, model: MODEL, lineLoginReady: LINE_READY, consentVersion: CONSENT_VERSION, audioPurge: PURGE_AUDIO, botApiReady: !!BOT_API_SECRET, cyzenReady: cyzen.ready(), ssoReady: !!SSO_SECRET,
        // ポータルと同じ共有秘密かを、値を出さずに突き合わせるための指紋（固定文字列のHMAC先頭12桁）
        ssoFingerprint: SSO_SECRET ? createHmac('sha256', SSO_SECRET).update('rumina-sso-fingerprint-v1').digest('hex').slice(0, 12) : null });

      // cyzen連携の状態（owner専用）
      if (path === '/api/cyzen/status' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        return json(res, 200, cyzen.status());
      }

      // cyzen CSVアップロード（owner専用）：kind=user|history|report
      if (path === '/api/cyzen/upload' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const kind = url.searchParams.get('kind') || 'report';
        const raw = decodeURIComponent(req.headers['x-file-name'] || 'upload.csv');
        const safe = raw.replace(/[\/\\]/g, '_');
        const dir = cyzen.ensureDir();
        const dest = kind === 'user' ? join(dir, 'user-master.csv')
          : kind === 'history' ? join(dir, 'action-history.csv')
          : join(dir, 'report', safe.toLowerCase().endsWith('.csv') ? safe : safe + '.csv');
        await streamPipeline(req, createWriteStream(dest));
        const st = cyzen.reload();
        return json(res, 200, { ok: true, kind, saved: safe, status: st });
      }

      // cyzenデータの再読込（owner専用）
      if (path === '/api/cyzen/reload' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        return json(res, 200, cyzen.reload());
      }

      // 全営業KPI一覧＋教育セグメント（owner専用）
      if (path === '/api/cyzen/roster' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        return json(res, 200, cyzen.roster());
      }

      /* ---------- 認証 ---------- */
      if (path === '/api/me') return json(res, 200, { user: currentUser(req) });

      /* ---------- 録音・解析への同意 ---------- */
      // 自分の同意状況（最新版を満たしているか）
      if (path === '/api/consent' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me) return json(res, 401, { error: '未ログイン' });
        const c = getDb().consents[me.username] || null;
        return json(res, 200, { version: CONSENT_VERSION, consent: c, ok: hasConsent(me) });
      }
      // 同意を記録（版・日時・端末を保存）
      if (path === '/api/consent' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me) return json(res, 401, { error: '未ログイン' });
        const body = await readBody(req);
        if (body.agree === false) return json(res, 400, { error: '同意が必要です' });
        const rec = { version: CONSENT_VERSION, at: new Date().toISOString(), name: me.name, ua: String(req.headers['user-agent'] || '').slice(0, 200), agree: true };
        getDb().consents[me.username] = rec; save();
        return json(res, 200, { ok: true, consent: rec });
      }
      // 同意の取得状況一覧（owner専用・監査用）
      if (path === '/api/consents' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const db = getDb();
        const consents = Object.values(db.users).map(u => ({
          username: u.username, name: u.name, role: u.role,
          consent: db.consents[u.username] || null,
          current: !!(db.consents[u.username] && db.consents[u.username].version === CONSENT_VERSION),
        }));
        return json(res, 200, { version: CONSENT_VERSION, consents });
      }

      if (path === '/api/login' && req.method === 'POST') {
        const { username, password } = await readBody(req);
        const u = getDb().users[String(username || '').trim()];
        if (!u || !verifyPassword(password, u.salt, u.hash)) return json(res, 401, { error: 'ユーザー名またはパスワードが違います' });
        setSessionCookie(req, res, signSession({ username: u.username, role: u.role }));
        return json(res, 200, { user: { username: u.username, name: u.name, role: u.role, repId: u.repId } });
      }

      if (path === '/api/logout' && req.method === 'POST') { clearSessionCookie(res); return json(res, 200, { ok: true }); }

      /* ---------- LINEログイン（全スタッフ・初回自動作成） ---------- */
      if (path === '/api/line/login' && req.method === 'GET') {
        if (!LINE_READY) return json(res, 400, { error: 'LINEログインが未設定です' });
        const state = randomUUID();
        const cb = lineCallback(req);
        // CSRF：stateを短命Cookieに置き、コールバックで突合
        res.setHeader('Set-Cookie', `rk_lstate=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
        const q = new URLSearchParams({ response_type: 'code', client_id: LINE_ID, redirect_uri: cb, state, scope: 'profile openid', bot_prompt: 'aggressive' });
        res.writeHead(302, { Location: 'https://access.line.me/oauth2/v2.1/authorize?' + q });
        return res.end();
      }

      if (path === '/api/line/callback' && req.method === 'GET') {
        const code = url.searchParams.get('code'), state = url.searchParams.get('state');
        const saved = parseCookies(req).rk_lstate;
        res.setHeader('Set-Cookie', 'rk_lstate=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        if (!code || !state || !saved || state !== saved) { res.writeHead(302, { Location: '/?lineerror=state' }); return res.end(); }
        try {
          const cb = lineCallback(req);
          const tr = await fetch('https://api.line.me/oauth2/v2.1/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cb, client_id: LINE_ID, client_secret: LINE_SECRET }),
          });
          const tj = await tr.json();
          if (!tr.ok || !tj.access_token) throw new Error('token');
          const pr = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${tj.access_token}` } });
          const pj = await pr.json();
          if (!pr.ok || !pj.userId) throw new Error('profile');

          const db = getDb();
          let user = Object.values(db.users).find(u => u.lineId === pj.userId);
          if (!user) {
            const isOwner = !!OWNER_LINE_ID && OWNER_LINE_ID === pj.userId;
            const uname = uniqueUsername(db, (pj.displayName || 'LINEユーザー').trim());
            user = { username: uname, name: (pj.displayName || uname).trim(), role: isOwner ? 'owner' : 'rep', repId: null, lineId: pj.userId, isModel: isOwner || false, pending: !isOwner };
            db.users[uname] = user; save();
          }
          setSessionCookie(req, res, signSession({ username: user.username, role: user.role }));
          res.writeHead(302, { Location: '/' }); return res.end();
        } catch (e) {
          res.writeHead(302, { Location: '/?lineerror=auth' }); return res.end();
        }
      }

      // 管理者：名簿からアカウント発行（owner専用）
      if (path === '/api/admin/issue' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const { name, repId } = await readBody(req);
        const uname = String(name || '').trim();
        if (!uname) return json(res, 400, { error: '名前が必要です' });
        const pw = randomPassword();
        const { salt, hash } = hashPassword(pw);
        const db = getDb();
        db.users[uname] = { username: uname, name: uname, role: 'rep', repId: repId || null, salt, hash };
        save();
        return json(res, 200, { username: uname, password: pw });   // 初期パスワードは一度だけ返す
      }

      // 管理者：LINEログインで自動作成された保留中(repId未設定)のユーザー一覧（owner専用）
      // Rumina Coach 連携のため、氏名(表示名)を見てkintoneの営業コード(staff_code)を
      // 割り当てる下準備の一覧を返す。
      if (path === '/api/admin/pending-line-users' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const db = getDb();
        const pending = Object.values(db.users)
          .filter(u => u.lineId && !u.repId)
          .map(u => ({ username: u.username, name: u.name, lineId: u.lineId }));
        return json(res, 200, { pending });
      }

      // 管理者：LINEログイン済みユーザーに kintoneの営業コード(repId)を割り当てる（owner専用）
      if (path === '/api/admin/link-rep' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const { username, repId } = await readBody(req);
        const db = getDb();
        const u = db.users[String(username || '')];
        if (!u) return json(res, 404, { error: 'ユーザーが見つかりません' });
        if (!repId) return json(res, 400, { error: 'repId(営業コード)が必要です' });
        u.repId = String(repId).trim();
        u.pending = false;
        save();
        return json(res, 200, { ok: true, username: u.username, repId: u.repId });
      }

      // Rumina Coach 連携：営業コード(repId) → LINE userId の対応表を返す（共有シークレット認証）。
      // repIdが割り当て済み(=/api/admin/link-rep 済み)のユーザーのみ含む。
      if (path === '/api/rep-line-map' && req.method === 'GET') {
        const secret = url.searchParams.get('secret') || '';
        if (!COACH_WEBHOOK_SECRET || secret !== COACH_WEBHOOK_SECRET) return json(res, 401, { error: 'Unauthorized' });
        const db = getDb();
        const map = Object.values(db.users)
          .filter(u => u.repId && u.lineId)
          .map(u => ({ repId: u.repId, name: u.name, lineId: u.lineId }));
        return json(res, 200, { map });
      }

      // 自分の最新レポート
      if (path === '/api/my/latest' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me) return json(res, 401, { error: '未ログイン' });
        return json(res, 200, { submission: getDb().submissions[me.username] || null });
      }

      /* ---------- 成功モデル（カルテの“基準値”） ---------- */
      // 現在登録されている成功モデルを返す（未登録なら null＝初期値運用）
      if (path === '/api/model' && req.method === 'GET') {
        return json(res, 200, { model: getDb().model || null });
      }

      // 成功モデル登録（owner専用）：解析済みセッションの録音を“基準”に採用
      if (path === '/api/model/register' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const { sessionId } = await readBody(req);
        const s = SESSIONS.get(sessionId);
        if (!s || !s.result || !Array.isArray(s.result.pings)) return json(res, 404, { error: 'この録音の解析結果が見つかりません（解析直後に登録してください）' });
        const { profile, denom } = computeModelProfile(s.result.pings);
        if (denom < 3) return json(res, 400, { error: `会話が成立した訪問が${denom}件しかありません（3件以上の録音で登録してください）` });
        const model = { profile, denom, by: me.name, at: new Date().toISOString(), source: s.result.source || 'whisper' };
        getDb().model = model; save();
        return json(res, 200, { model });
      }

      // 成功モデルを初期値へ戻す（owner専用）
      if (path === '/api/model/reset' && req.method === 'POST') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        getDb().model = null; save();
        return json(res, 200, { model: null });
      }

      /* ---------- 診断ログ（録音の記録） ---------- */
      // 一覧（owner専用）：軽量メタのみ。新しい順。
      if (path === '/api/log' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        return json(res, 200, { reports: getDb().reports || [] });
      }
      // 詳細（owner専用）：文字起こし全文・訪問明細・KPIまで
      const mLog = path.match(/^\/api\/log\/(.+)$/);
      if (mLog && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const rec = getReport(decodeURIComponent(mLog[1]));
        return rec ? json(res, 200, { report: rec }) : json(res, 404, { error: 'ログが見つかりません' });
      }

      /* ---------- B-6：LINE↔kintone↔鬼教官 名寄せ・個別コーチング ---------- */
      // LINEログイン済みユーザー一覧（owner専用）：名寄せUIの元データ
      if (path === '/api/admin/line-users' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me || me.role !== 'owner') return json(res, 403, { error: '権限がありません' });
        const db = getDb();
        const users = Object.values(db.users).filter(u => u.lineId).map(u => ({
          username: u.username, name: u.name, role: u.role, lineId: u.lineId,
          repId: u.repId || null, pending: !!u.pending, hasLatest: !!db.submissions[u.username],
        }));
        return json(res, 200, { users });
      }

      // LINE bot 個別コーチング連携：lineId or repId から本人の最新診断＋一言処方を返す。
      // 共有シークレット(BOT_API_SECRET)必須。botが「あなたについて教えて？」等で叩く想定。
      if (path === '/api/coach-context' && req.method === 'GET') {
        if (!BOT_API_SECRET || (url.searchParams.get('secret') || '') !== BOT_API_SECRET) return json(res, 401, { error: 'Unauthorized' });
        const lineId = url.searchParams.get('lineId') || '', repId = url.searchParams.get('repId') || '', name = url.searchParams.get('name') || '';
        if (!lineId && !repId && !name) return json(res, 400, { error: 'lineId か repId か name が必要です' });
        const db = getDb();
        // lineId(鬼教官に直接ログイン済み) → repId → name(ポータルのLINEログインで本人選択済みの氏名／botが橋渡し)の順で照合
        const user = Object.values(db.users).find(u => (lineId && u.lineId === lineId) || (repId && u.repId === repId) || (name && u.name === name));
        if (!user) return json(res, 404, { found: false, error: 'このLINE/営業コード/氏名に紐づくユーザーが未登録です' });
        return json(res, 200, coachContext(user, db.submissions[user.username] || null));
      }

      // ① アップロード：ファイル本文を raw で受けて保存（multipart不要）
      if (path === '/api/audio/upload' && req.method === 'POST') {
        if (!API_KEY) return json(res, 400, { error: 'OPENAI_API_KEY が未設定です。.env を確認してください。' });
        const meUp = currentUser(req);
        if (meUp && !hasConsent(meUp)) return json(res, 403, { error: '録音・解析への同意が必要です。', needConsent: true });
        const id = randomUUID();
        const fileName = decodeURIComponent(req.headers['x-file-name'] || 'recording.m4a');
        const dir = join(UPLOAD_DIR, id);
        await mkdir(dir, { recursive: true });
        const dest = join(dir, fileName.replace(/[^\w.\-]/g, '_'));
        await streamPipeline(req, createWriteStream(dest));
        SESSIONS.set(id, {
          id, fileName, path: dest, status: 'queued', stage: null, progress: { done: 0, total: 0 },
          userName: (currentUser(req) || {}).username || null,
          salesRepId: req.headers['x-sales-rep-id'] || null, uploadedAt: new Date().toISOString(),
          startHour: +(req.headers['x-start-hour'] || 9), result: null, error: null,
          // Rumina Coach 連携：測定依頼リンク（?staff=&iv=）から来た場合のみ設定される
          interventionId: req.headers['x-intervention-id'] || null,
          staffCode: req.headers['x-staff-code'] || null,
        });
        return json(res, 200, { sessionId: id, fileName });
      }

      // Plaud NotePin 文字起こし取り込み（Whisper不要・即時解析）
      if (path === '/api/audio/import' && req.method === 'POST') {
        const meImp = currentUser(req);
        if (meImp && !hasConsent(meImp)) return json(res, 403, { error: '録音・解析への同意が必要です。', needConsent: true });
        const body = await readBody(req);
        if (!body.export) return json(res, 400, { error: 'export（Plaud書き出し）がありません' });
        let parsed;
        try { parsed = parsePlaud(body.export); }
        catch (e) { return json(res, 400, { error: '書き出しの解析に失敗しました：' + e.message }); }
        const { segments, meta } = parsed;
        if (!segments.length) return json(res, 400, { error: '有効なセグメントがありません' });
        const id = randomUUID();
        const rep = { name: body.name || meta.recordingId || 'インポート', team: '', workdayCount: 22 };
        const date = new Date().toISOString().slice(0, 10);
        const crm = await fetchAppointments(rep.name, date);   // CRMから確定アポ数を自動取得
        const meCz = currentUser(req);
        const repCode = body.repId || (meCz && getDb().users[meCz.username] || {}).repId || null;
        const { analysis, pings, transcript } = analyze(segments, withCyzen({
          durationSec: meta.durationSec, startHour: body.startHour ?? meta.startHour ?? 9,
          salesRep: rep, benchmark: BENCHMARK, date,
          gps: Array.isArray(body.gps) ? body.gps : null,
          diarize: meta.hasSpeakers ? 'acoustic' : 'heuristic',
          crmAppointmentCount: crm ? crm.count : undefined,
          modelTalk: modelTalk(),
        }, repCode, date));
        const result = { sessionId: id, source: 'plaud', device: meta.device, benchmark: BENCHMARK, analysis, pings, transcript };
        SESSIONS.set(id, { id, status: 'done', result });
        // ログイン中なら本人の最新レポートとして保存（マイページ用）
        const me = currentUser(req);
        if (me) { getDb().submissions[me.username] = { at: new Date().toISOString(), name: me.name, analysis }; save(); }
        // 診断ログを永続化（文字起こし全文つき）
        persistReport(id, result, me ? me.username : null);
        // Rumina Coach 連携：測定依頼リンク（?staff=&iv=）経由でインポートした場合のみ送信
        if (body.interventionId) notifyCoach(body.interventionId, analysis);
        return json(res, 200, result);
      }

      // ②〜④ 解析実行（transcribe→segment→extract を一括起動・非同期）
      if (path === '/api/audio/analyze' && req.method === 'POST') {
        const { sessionId, gps } = await readBody(req);
        const s = SESSIONS.get(sessionId);
        if (!s) return json(res, 404, { error: 'session not found' });
        if (Array.isArray(gps) && gps.length) s.gps = gps;   // Phase 2：位置ログ（任意）
        runPipeline(s).catch(e => { s.status = 'failed'; s.error = e.message; });
        return json(res, 202, { sessionId, status: 'processing' });
      }

      // ステータス・ポーリング
      const mSess = path.match(/^\/api\/sessions\/(.+)$/);
      if (mSess && req.method === 'GET') {
        const s = SESSIONS.get(mSess[1]);
        if (!s) return json(res, 404, { error: 'not found' });
        return json(res, 200, { id: s.id, status: s.status, stage: s.stage, progress: s.progress, error: s.error });
      }

      // レポート取得
      const mRep = path.match(/^\/api\/reports\/(.+)$/);
      if (mRep && req.method === 'GET') {
        const s = SESSIONS.get(mRep[1]);
        if (!s || !s.result) return json(res, 404, { error: 'report not ready' });
        return json(res, 200, s.result);
      }

      return json(res, 404, { error: 'unknown api route' });
    }

    // ---------- 静的SPA ----------
    let file = path === '/' ? '/index.html' : path;
    try {
      const buf = await readFile(join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      const buf = await readFile(join(ROOT, 'index.html')); // SPAフォールバック
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(buf);
    }
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

/* ---------- パイプライン本体 ---------- */
async function runPipeline(s) {
  s.status = 'transcribing'; s.stage = 'split';
  const duration = await probeDuration(s.path);           // ffprobeが無ければ null
  const chunks = await toChunks(s.path);                  // 24MB以下なら1チャンク（ffmpeg不要）
  s.progress = { done: 0, total: chunks.length };

  // ③ 文字起こし（チャンクを順次Whisperへ。並列にする場合はここをPromise poolに）
  s.stage = 'transcribe';
  let segments = [];
  for (const ch of chunks) {
    const segs = await whisper.transcribe(ch, { lang: 'ja', prompt: DOMAIN_PROMPT, model: MODEL, apiKey: API_KEY });
    segments = segments.concat(segs);
    s.progress.done++;
  }
  segments.sort((a, b) => a.startSec - b.startSec);

  // ⑤⑥ ピンポン分割＋KPI抽出
  s.status = 'analyzing'; s.stage = 'segment';
  const rep = { name: s.fileName.replace(/\.[^.]+$/, ''), team: '', workdayCount: 22 };
  const runDate = new Date().toISOString().slice(0, 10);
  const repCode = (s.userName && getDb().users[s.userName] || {}).repId || null;
  const { analysis, pings, transcript } = analyze(segments, withCyzen({
    durationSec: duration, startHour: s.startHour, salesRep: rep, benchmark: BENCHMARK,
    date: runDate, gps: s.gps || null,
    diarize: process.env.DIARIZE,   // 未設定なら既定=heuristic、'none'で無効化
    modelTalk: modelTalk(),
  }, repCode, runDate));

  // 文字起こし済み → 音声の自動削除（PURGE_AUDIO_AFTER_ANALYZE=on のとき）
  let audioRetained = true;
  if (PURGE_AUDIO) {
    try { await rm(join(UPLOAD_DIR, s.id), { recursive: true, force: true }); audioRetained = false; }
    catch (e) { console.error('[purge] 音声削除に失敗:', e.message); }
  }

  s.stage = 'analyze';
  s.result = { sessionId: s.id, source: 'whisper', audioRetained, benchmark: BENCHMARK, analysis, pings, transcript };
  s.status = 'done'; s.stage = 'coach';
  // 本人の最新レポート＋診断ログを永続化（文字起こし全文つき）
  if (s.userName) { const u = getDb().users[s.userName]; if (u) { getDb().submissions[u.username] = { at: new Date().toISOString(), name: u.name, analysis }; save(); } }
  persistReport(s.id, s.result, s.userName || null);
  notifyCoach(s.interventionId, analysis); // fire-and-forget（Coach連携時のみ・未設定なら何もしない）
}

server.listen(PORT, () => {
  console.log(`Rumina 鬼教官 (Phase 1) → http://localhost:${PORT}`);
  console.log(API_KEY ? '✓ Whisper 接続可（OPENAI_API_KEY 検出）' : '⚠ OPENAI_API_KEY 未設定 → モックUIのみ動作');
});
