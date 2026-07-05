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
import { analyze, DOMAIN_PROMPT } from './lib/pipeline.mjs';
import { parsePlaud } from './lib/import-plaud.mjs';
import { fetchAppointments } from './lib/crm.mjs';
import { getDb, save } from './lib/store.mjs';
import { hashPassword, verifyPassword, signSession, verifySession, randomPassword } from './lib/auth.mjs';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = process.env.PORT || 4180;
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.WHISPER_MODEL || 'whisper-1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

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

// 起動時：ownerが居なければ社長アカウントを1つseed（＝モデル営業マン）
(function seedOwner() {
  const db = getDb();
  if (Object.keys(db.users).length) return;
  const username = process.env.OWNER_USER || '社長';
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
      if (path === '/api/health') return json(res, 200, { ok: true, whisperReady: !!API_KEY, model: MODEL });

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

      // 自分の最新レポート
      if (path === '/api/my/latest' && req.method === 'GET') {
        const me = currentUser(req);
        if (!me) return json(res, 401, { error: '未ログイン' });
        return json(res, 200, { submission: getDb().submissions[me.username] || null });
      }

      // ① アップロード：ファイル本文を raw で受けて保存（multipart不要）
      if (path === '/api/audio/upload' && req.method === 'POST') {
        if (!API_KEY) return json(res, 400, { error: 'OPENAI_API_KEY が未設定です。.env を確認してください。' });
        const id = randomUUID();
        const fileName = decodeURIComponent(req.headers['x-file-name'] || 'recording.m4a');
        const dir = join(ROOT, 'uploads', id);
        await mkdir(dir, { recursive: true });
        const dest = join(dir, fileName.replace(/[^\w.\-]/g, '_'));
        await streamPipeline(req, createWriteStream(dest));
        SESSIONS.set(id, {
          id, fileName, path: dest, status: 'queued', stage: null, progress: { done: 0, total: 0 },
          salesRepId: req.headers['x-sales-rep-id'] || null, uploadedAt: new Date().toISOString(),
          startHour: +(req.headers['x-start-hour'] || 9), result: null, error: null,
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
        });
        const result = { sessionId: id, source: 'plaud', device: meta.device, benchmark: BENCHMARK, analysis, pings, transcript };
        SESSIONS.set(id, { id, status: 'done', result });
        // ログイン中なら本人の最新レポートとして保存（マイページ用）
        const me = currentUser(req);
        if (me) { getDb().submissions[me.username] = { at: new Date().toISOString(), name: me.name, analysis }; save(); }
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
  });

  s.stage = 'analyze';
  s.result = { sessionId: s.id, benchmark: BENCHMARK, analysis, pings, transcript };
  s.status = 'done'; s.stage = 'coach';
}

server.listen(PORT, () => {
  console.log(`Rumina 鬼教官 (Phase 1) → http://localhost:${PORT}`);
  console.log(API_KEY ? '✓ Whisper 接続可（OPENAI_API_KEY 検出）' : '⚠ OPENAI_API_KEY 未設定 → モックUIのみ動作');
});
