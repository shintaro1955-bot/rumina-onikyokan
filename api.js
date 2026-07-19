/* ============================================================
   Rumina 鬼教官 — バックエンドAPIクライアント（Phase 1）
   Whisper未接続（キー無し）の場合は isReady=false を返し、
   UIはモックシミュレーションにフォールバックする。
   ============================================================ */
window.API = (function () {
  let ready = null;

  // Rumina Coach 連携：測定依頼リンク（?staff=<staff_code>&iv=<intervention_id>）から
  // 開いた場合のみ、解析完了時にCoachへ結果を送るための識別子をここで拾っておく。
  // 通常アクセス（クエリなし）では両方 null のまま＝Coach連携は一切発火しない。
  const params = new URLSearchParams(location.search);
  const COACH_STAFF = params.get('staff') || null;
  const COACH_IV = params.get('iv') || null;

  async function health() {
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      ready = !!j.whisperReady;
      return j;
    } catch { ready = false; return { whisperReady: false }; }
  }

  async function upload(file, { startHour = 9 } = {}) {
    const headers = { 'x-file-name': encodeURIComponent(file.name), 'x-start-hour': String(startHour) };
    if (COACH_IV) headers['x-intervention-id'] = COACH_IV;
    if (COACH_STAFF) headers['x-staff-code'] = COACH_STAFF;
    const r = await fetch('/api/audio/upload', { method: 'POST', headers, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'アップロードに失敗しました');
    return j; // { sessionId, fileName }
  }

  async function analyze(sessionId, gps) {
    const r = await fetch('/api/audio/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, gps: Array.isArray(gps) ? gps : undefined }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '解析の開始に失敗しました');
    return r.json();
  }

  // Plaud NotePin 文字起こしの取り込み（Whisper不要・即時レポート返却）
  async function importTranscript(exportData, { name, startHour, gps } = {}) {
    const r = await fetch('/api/audio/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ export: exportData, name, startHour, gps, interventionId: COACH_IV, staffCode: COACH_STAFF }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '取り込みに失敗しました');
    return j; // { analysis, pings, transcript, ... }
  }

  const status = id => fetch('/api/sessions/' + id).then(r => r.json());
  async function report(id) {
    const r = await fetch('/api/reports/' + id);
    if (!r.ok) throw new Error('レポートがまだ準備できていません');
    return r.json();
  }

  /* ---------- 認証・マイページ ---------- */
  async function me() { try { return await (await fetch('/api/me')).json(); } catch { return { user: null }; } }
  async function login(username, password) {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'ログインに失敗しました'); return j;
  }
  async function logout() { await fetch('/api/logout', { method: 'POST' }); }
  async function issueAccount(name, repId) {
    const r = await fetch('/api/admin/issue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, repId }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '発行に失敗しました'); return j;
  }
  async function myLatest() { try { const r = await fetch('/api/my/latest'); return r.ok ? r.json() : { submission: null }; } catch { return { submission: null }; } }

  /* ---------- 成功モデル（カルテの基準値） ---------- */
  async function getModel() { try { const r = await fetch('/api/model'); return r.ok ? (await r.json()).model : null; } catch { return null; } }
  async function registerModel(sessionId) {
    const r = await fetch('/api/model/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'モデル登録に失敗しました'); return j.model;
  }
  async function resetModel() {
    const r = await fetch('/api/model/reset', { method: 'POST' });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '初期化に失敗しました'); return j.model;
  }

  /* ---------- 診断ログ（録音の記録） ---------- */
  async function getLog() { const r = await fetch('/api/log'); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'ログの取得に失敗しました'); return j.reports || []; }
  async function getLogItem(id) { const r = await fetch('/api/log/' + encodeURIComponent(id)); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'ログ詳細の取得に失敗しました'); return j.report; }

  /* ---------- 録音・解析への同意 ---------- */
  async function getConsent() { try { const r = await fetch('/api/consent'); return r.ok ? r.json() : { ok: false }; } catch { return { ok: false }; } }
  async function postConsent() { const r = await fetch('/api/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agree: true }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '同意の記録に失敗しました'); return j; }
  async function getConsents() { const r = await fetch('/api/consents'); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '同意状況の取得に失敗しました'); return j; }

  /* ---------- cyzen（行動量） ---------- */
  async function cyzenStatus() { try { const r = await fetch('/api/cyzen/status'); return r.ok ? r.json() : { ready: false }; } catch { return { ready: false }; } }
  async function cyzenRoster() { const r = await fetch('/api/cyzen/roster'); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '名簿の取得に失敗しました'); return j; }
  async function cyzenUpload(file, kind) {
    const r = await fetch('/api/cyzen/upload?kind=' + encodeURIComponent(kind), {
      method: 'POST', headers: { 'x-file-name': encodeURIComponent(file.name) }, body: file,
    });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'アップロードに失敗しました'); return j;
  }

  /* ---------- B-6：LINE名寄せ ---------- */
  async function getLineUsers() { const r = await fetch('/api/admin/line-users'); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'LINEユーザー一覧の取得に失敗しました'); return j.users || []; }
  async function linkRep(username, repId) { const r = await fetch('/api/admin/link-rep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, repId }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '紐付けに失敗しました'); return j; }

  return { health, upload, analyze, importTranscript, status, report, isReady: () => ready, me, login, logout, issueAccount, myLatest, getModel, registerModel, resetModel, getLog, getLogItem, getConsent, postConsent, getConsents, getLineUsers, linkRep, cyzenStatus, cyzenRoster, cyzenUpload };
})();
