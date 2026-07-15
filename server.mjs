/* ============================================================
   Rumina 鬼教官 — Phase 1 サーバー
   静的SPA配信 ＋ 実Whisper解析API。依存パッケージゼロ（Node 18+）。
   環境変数：OPENAI_API_KEY（必須）, PORT, WHISPER_MODEL, VISIT_GAP_SEC ...
   ============================================================ */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline as streamPipeline } from 'node:stream/promises';

import * as whisper from './lib/whisper.mjs';
import { toChunks, probeDuration } from './lib/audio.mjs';
import { analyze, computeModelProfile, DOMAIN_PROMPT } from './lib/pipeline.mjs';
import { parsePlaud } from './lib/import-plaud.mjs';
import { fetchAppointments } from './lib/crm.mjs';
import { getDb, save, saveReport, getReport, UPLOAD_DIR } from './lib/store.mjs';
import { hashPassword, verifyPassword, signSession, verifySession, randomPassword } from './lib/auth.mjs';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = process.env.PORT || 4180;
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.WHISPER_MODEL || 'whisper-1';

// LINEログイン（LINE Developers の「LINEログイン」チャネル）
const LINE_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LINE_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LINE_CALLBACK = process.env.LINE_CALLBACK_URL || '';   // 未設定ならリクエストのホストから自動生成
const OWNER_LINE_ID = process.env.OWNER_LINE_ID || '';       // このLINEユーザーIDは管理者(owner)にする
const LINE_READY = !!(LINE_ID && LINE_SECRET);

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
// 登録済みの「成功モデル」基準（未登録なら undefined → pipeline側の初期MODEL_TALK）
function modelTalk() {
  const m = getDb().model;
  return (m && Array.isArray(m.profile) && m.profile.length) ? m.profile : undefined;
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
    user: userName || null,
    analysis: a, pings: result.pings || [], transcript: result.transcript || [],
  });
}

// 起動時：ownerが居なければ管理者アカウントを1つseed（＝モデル営業マン。既定は営業部長 川上）
(function seedOwner() {
  const db = getDb();
  if (Object.keys(db.users).length) return;
  const username = process.env.OWNER_USER || '川上';
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
    // ---------- API ----------
    if (path.startsWith('/api/')) {
      // 健康チェック（APIキーの有無を返す。UIが実接続可否を判定）
      if (path === '/api/health') return json(res, 200, { ok: true, whisperReady: !!API_KEY, model: MODEL, lineLoginReady: LINE_READY });

      /* ---------- 認証 ---------- */
      if (path === '/api/me') return json(res, 200, { user: currentUser(req) });

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

      // ① アップロード：ファイル本文を raw で受けて保存（multipart不要）
      if (path === '/api/audio/upload' && req.method === 'POST') {
        if (!API_KEY) return json(res, 400, { error: 'OPENAI_API_KEY が未設定です。.env を確認してください。' });
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
        const { analysis, pings, transcript } = analyze(segments, {
          durationSec: meta.durationSec, startHour: body.startHour ?? meta.startHour ?? 9,
          salesRep: rep, benchmark: BENCHMARK, date,
          gps: Array.isArray(body.gps) ? body.gps : null,
          diarize: meta.hasSpeakers ? 'acoustic' : 'heuristic',
          crmAppointmentCount: crm ? crm.count : undefined,
          modelTalk: modelTalk(),
        });
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
  const { analysis, pings, transcript } = analyze(segments, {
    durationSec: duration, startHour: s.startHour, salesRep: rep, benchmark: BENCHMARK,
    date: new Date().toISOString().slice(0, 10), gps: s.gps || null,
    diarize: process.env.DIARIZE,   // 未設定なら既定=heuristic、'none'で無効化
    modelTalk: modelTalk(),
  });

  s.stage = 'analyze';
  s.result = { sessionId: s.id, source: 'whisper', benchmark: BENCHMARK, analysis, pings, transcript };
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
