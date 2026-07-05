/* ============================================================
   Rumina 鬼教官 — バックエンドAPIクライアント（Phase 1）
   Whisper未接続（キー無し）の場合は isReady=false を返し、
   UIはモックシミュレーションにフォールバックする。
   ============================================================ */
window.API = (function () {
  let ready = null;

  async function health() {
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      ready = !!j.whisperReady;
      return j;
    } catch { ready = false; return { whisperReady: false }; }
  }

  async function upload(file, { startHour = 9 } = {}) {
    const r = await fetch('/api/audio/upload', {
      method: 'POST',
      headers: { 'x-file-name': encodeURIComponent(file.name), 'x-start-hour': String(startHour) },
      body: file,
    });
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
      body: JSON.stringify({ export: exportData, name, startHour, gps }),
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

  return { health, upload, analyze, importTranscript, status, report, isReady: () => ready, me, login, logout, issueAccount, myLatest };
})();
