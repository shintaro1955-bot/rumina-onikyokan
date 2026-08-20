/* ============================================================
   Google サービスアカウント認証（依存ゼロ）
   SA鍵(JSON)から RS256 JWT を作り、アクセストークンを取得・キャッシュ。
   BigQuery / Vertex AI / Drive / Speech / Document AI 等の共通土台。
   鍵は環境変数から読む（値はコード/ログに出さない）：
     GOOGLE_SERVICE_ACCOUNT_JSON = SA鍵のJSONそのまま、または
     GOOGLE_SA_BASE64            = 上記をbase64したもの
   ============================================================ */
import { createSign } from 'node:crypto';

let cache = { token: null, exp: 0, scope: '' };

function sa() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw && process.env.GOOGLE_SA_BASE64) { try { raw = Buffer.from(process.env.GOOGLE_SA_BASE64, 'base64').toString('utf8'); } catch {} }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function ready() { return !!sa(); }
export function projectId() { const s = sa(); return process.env.GOOGLE_CLOUD_PROJECT_ID || (s && s.project_id) || null; }
export function location() { return process.env.GOOGLE_CLOUD_LOCATION || 'asia-northeast1'; }

const b64url = s => Buffer.from(s).toString('base64url');

/** 指定スコープのアクセストークンを取得（55分キャッシュ）。 */
export async function token(scope = 'https://www.googleapis.com/auth/cloud-platform') {
  if (cache.token && cache.scope === scope && Date.now() < cache.exp - 60000) return cache.token;
  const s = sa(); if (!s || !s.client_email || !s.private_key) throw new Error('service account 未設定');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: s.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(header + '.' + claim);
  const sig = signer.sign(s.private_key.replace(/\\n/g, '\n'), 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error('access token 取得失敗: ' + (j.error_description || j.error || res.status));
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, scope };
  return cache.token;
}
