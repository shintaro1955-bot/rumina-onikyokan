/* ============================================================
   Feature Flags（外部連携の段階的有効化）
   すべて既定 false。キー未設定でもアプリ全体は動く（Mockで代替）。
   ============================================================ */
const NAMES = ['GOOGLE_MAPS', 'GOOGLE_CALENDAR', 'GOOGLE_DRIVE', 'GOOGLE_SOLAR', 'GOOGLE_WEATHER', 'VERTEX_AI', 'SPEECH_TO_TEXT', 'DOCUMENT_AI', 'FIREBASE_PUSH'];
const on = v => /^(1|true|yes|on)$/i.test(v || '');
export function enabled(name) { return on(process.env['FEATURE_' + name]); }
export function flags() { const o = {}; for (const n of NAMES) o[n] = enabled(n); return o; }
