/* ============================================================
   Provider Adapter（外部サービスの抽象化）
   フラグON＋キーありなら本物のGoogle、無ければMock。UIからは常に同じ形。
   ============================================================ */
import { enabled } from './flags.mjs';
import * as gauth from './gauth.mjs';

const hasKey = (...ks) => ks.every(k => !!process.env[k]);
// 電気健康診断アプリと同じ環境変数名も受ける（同じ鍵を差すだけで動くように）
const MAPS_KEY = () => process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY || '';
export function mapsBrowserKey() { return process.env.GOOGLE_MAPS_BROWSER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY || ''; }

export function integrationStatus() {
  const sa = gauth.ready();
  return {
    // Maps系は鍵があれば有効（フラグ不要＝電気診断アプリと同じ運用）
    maps: MAPS_KEY() ? 'connected' : 'mock',
    geocoding: MAPS_KEY() ? 'connected' : 'mock',
    staticMap: MAPS_KEY() ? 'connected' : 'mock',
    streetView: MAPS_KEY() ? 'connected' : 'mock',
    solar: MAPS_KEY() ? 'connected' : 'mock',
    weather: enabled('GOOGLE_WEATHER') && MAPS_KEY() ? 'connected' : 'mock',
    // AIはClaude優先（電気診断アプリと同じ鍵）→ 無ければVertex → 無ければルール
    aiCoach: ANTHROPIC_KEY() ? 'claude' : (enabled('VERTEX_AI') && sa && gauth.projectId() ? 'vertex-ai' : 'rule'),
    calendar: enabled('GOOGLE_CALENDAR') && sa ? 'connected' : 'mock',
    drive: enabled('GOOGLE_DRIVE') && sa && hasKey('GOOGLE_DRIVE_ROOT_FOLDER_ID') ? 'connected' : 'mock',
    speechToText: enabled('SPEECH_TO_TEXT') && (sa || ANTHROPIC_KEY()) ? 'connected' : 'mock',
    documentAi: enabled('DOCUMENT_AI') && (sa || ANTHROPIC_KEY()) ? 'connected' : 'mock',
    firebasePush: enabled('FIREBASE_PUSH') && hasKey('FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL') ? 'connected' : 'mock',
    bigquery: sa ? 'connected' : 'mock',
    serviceAccount: sa,
  };
}

function ruleCoach({ visitsPerDay = 0, apoRate = 0, closeRate = null }) {
  let text, evidence, module;
  if (visitsPerDay >= 25 && apoRate < 5.5) { text = '訪問数は十分です。件数より、最初の3分の質問順を改善しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = 'hook'; }
  else if (visitsPerDay < 18) { text = 'まず打席（訪問数）を増やしましょう。質の前に量が前提です。'; evidence = `訪問${visitsPerDay}件/日（目安18〜31）`; module = null; }
  else if (closeRate != null && closeRate < 50) { text = 'クロージングで取りこぼしています。2択で日程を置く型を固めましょう。'; evidence = `成約率${closeRate}%`; module = 'close'; }
  else { text = '量・質とも良いペース。この型を維持しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = null; }
  return { text, evidence, module, source: 'rule' };
}

/* AIコーチ：Claude(Anthropic)優先 → Vertex AI → ルール。電気診断アプリと同じ鍵を再利用。 */
export const aiCoach = {
  async coach(kpis = {}) {
    const ev = `訪問${kpis.visitsPerDay ?? '-'}件/日・アポ率${kpis.apoRate ?? '-'}%`;
    const prompt = `あなたは訪問販売営業のコーチです。次のKPIから、断定しすぎず改善提案を1つだけ、日本語110字以内で。精神論は禁止、具体行動を1つ。\nKPI: 訪問${kpis.visitsPerDay ?? '-'}件/日, アポ率${kpis.apoRate ?? '-'}%, 成約率${kpis.closeRate ?? '-'}%`;
    if (ANTHROPIC_KEY()) {
      try {
        const model = process.env.RUMINA_COACH_MODEL || 'claude-haiku-4-5';
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
        });
        const j = await r.json().catch(() => ({}));
        const text = j?.content?.[0]?.text;
        if (text) return { text: text.trim(), evidence: ev, module: null, source: 'claude' };
      } catch (e) { console.error('[claude-coach]', e.message); }
    }
    if (enabled('VERTEX_AI') && gauth.ready() && gauth.projectId()) {
      try {
        const proj = gauth.projectId(), loc = gauth.location();
        const tok = await gauth.token('https://www.googleapis.com/auth/cloud-platform');
        const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${proj}/locations/${loc}/publishers/google/models/gemini-2.5-flash:generateContent`;
        const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, temperature: 0.4 } }) });
        const j = await r.json().catch(() => ({}));
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text: text.trim(), evidence: ev, module: null, source: 'vertex-ai' };
      } catch (e) { console.error('[vertex-ai]', e.message); }
    }
    return ruleCoach(kpis);
  },
};

/* 住所→座標（実＝Geocoding API／Mock＝null）。Maps鍵があれば有効。 */
export const geocoding = {
  async geocode(address) {
    if (!MAPS_KEY() || !address) return null;
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=ja&region=jp&key=${MAPS_KEY()}`);
      const j = await r.json().catch(() => ({}));
      const loc = j?.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng, source: 'google' } : null;
    } catch (e) { console.error('[geocoding]', e.message); return null; }
  },
};

/* 天気（実＝Google Weather API／Mock＝null） */
export const weather = {
  async today(lat, lng) {
    if (!enabled('GOOGLE_WEATHER') || !MAPS_KEY() || lat == null) return null;
    try {
      const r = await fetch(`https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=${lat}&location.longitude=${lng}&key=${MAPS_KEY()}`);
      const j = await r.json().catch(() => ({}));
      if (j && j.weatherCondition) return { condition: j.weatherCondition?.description?.text || null, tempC: j.temperature?.degrees ?? null, source: 'google' };
      return null;
    } catch (e) { console.error('[weather]', e.message); return null; }
  },
};

/* ルート最適化（実＝Route Optimization／Mock＝順序そのまま） */
export const route = {
  async optimize(stops = []) { return { order: stops.map((_, i) => i), source: enabled('GOOGLE_MAPS') && MAPS_KEY() ? 'google-todo' : 'mock' }; },
};

/* カレンダー（実装は次段・現状Mock） */
export const calendar = { async nextEvent() { return null; }, async createEvent() { return { mock: true }; } };
