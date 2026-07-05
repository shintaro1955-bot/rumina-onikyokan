/* ============================================================
   認証（依存ゼロ）
   - パスワード：scryptハッシュ（salt付き）
   - セッション：HMAC署名Cookie（改ざん検知＋有効期限）
   本番は SESSION_SECRET を必ず環境変数で設定すること。
   ============================================================ */
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DAY = 86400000;

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}
export function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const h = scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(h), b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// { username, role } を署名して token 化（7日）
export function signSession(obj, days = 7) {
  const payload = { ...obj, exp: nowMs() + days * DAY };
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
  return p + '.' + sig;
}
export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  const expSig = createHmac('sha256', SECRET).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (obj.exp && obj.exp < nowMs()) return null;
    return obj;
  } catch { return null; }
}

export function randomPassword(len = 8) {
  const cs = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = randomBytes(len);
  return Array.from(buf, b => cs[b % cs.length]).join('');
}

// Date.now() 相当（環境により制限されるのを避けてラップ）
function nowMs() { return new Date().getTime(); }
