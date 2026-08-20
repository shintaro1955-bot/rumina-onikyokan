/* ============================================================
   Provider Adapter（外部サービスの抽象化）
   フラグON＋キーありなら本物のGoogle、無ければMock。UIからは常に同じ形。
   ============================================================ */
import { enabled } from './flags.mjs';
import * as gauth from './gauth.mjs';

const hasKey = (...ks) => ks.every(k => !!process.env[k]);
const MAPS_KEY = () => process.env.GOOGLE_MAPS_SERVER_API_KEY || '';

export function integrationStatus() {
  const s = (flag, real) => enabled(flag) ? (real ? 'connected' : 'flag-on-no-key') : 'mock';
  const sa = gauth.ready();
  return {
    maps: s('GOOGLE_MAPS', !!MAPS_KEY()),
    calendar: s('GOOGLE_CALENDAR', hasKey('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET')),
    drive: s('GOOGLE_DRIVE', sa && hasKey('GOOGLE_DRIVE_ROOT_FOLDER_ID')),
    solar: s('GOOGLE_SOLAR', !!MAPS_KEY()),
    weather: s('GOOGLE_WEATHER', !!MAPS_KEY()),
    vertexAi: s('VERTEX_AI', sa && !!gauth.projectId()),
    speechToText: s('SPEECH_TO_TEXT', sa),
    documentAi: s('DOCUMENT_AI', sa),
    firebasePush: s('FIREBASE_PUSH', hasKey('FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL')),
    bigquery: enabled('VERTEX_AI') || sa ? (sa ? 'connected' : 'mock') : 'mock',
    serviceAccount: sa,
  };
}
export function mapsBrowserKey() { return enabled('GOOGLE_MAPS') ? (process.env.GOOGLE_MAPS_BROWSER_API_KEY || '') : ''; }

function ruleCoach({ visitsPerDay = 0, apoRate = 0, closeRate = null }) {
  let text, evidence, module;
  if (visitsPerDay >= 25 && apoRate < 5.5) { text = '訪問数は十分です。件数より、最初の3分の質問順を改善しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = 'hook'; }
  else if (visitsPerDay < 18) { text = 'まず打席（訪問数）を増やしましょう。質の前に量が前提です。'; evidence = `訪問${visitsPerDay}件/日（目安18〜31）`; module = null; }
  else if (closeRate != null && closeRate < 50) { text = 'クロージングで取りこぼしています。2択で日程を置く型を固めましょう。'; evidence = `成約率${closeRate}%`; module = 'close'; }
  else { text = '量・質とも良いペース。この型を維持しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = null; }
  return { text, evidence, module, source: 'rule' };
}

/* AIコーチ：実＝Vertex AI(Gemini)／Mock＝ルールベース */
export const aiCoach = {
  async coach(kpis = {}) {
    if (enabled('VERTEX_AI') && gauth.ready() && gauth.projectId()) {
      try {
        const proj = gauth.projectId(), loc = gauth.location();
        const tok = await gauth.token('https://www.googleapis.com/auth/cloud-platform');
        const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${proj}/locations/${loc}/publishers/google/models/gemini-2.5-flash:generateContent`;
        const prompt = `あなたは訪問販売営業のコーチです。次のKPIから、断定しすぎず改善提案を1つだけ、日本語120字以内で返してください。根拠KPIも短く添える。\nKPI: 訪問${kpis.visitsPerDay ?? '-'}件/日, アポ率${kpis.apoRate ?? '-'}%, 成約率${kpis.closeRate ?? '-'}%`;
        const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 200, temperature: 0.4 } }) });
        const j = await r.json().catch(() => ({}));
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text: text.trim(), evidence: `訪問${kpis.visitsPerDay ?? '-'}件/日・アポ率${kpis.apoRate ?? '-'}%`, module: null, source: 'vertex-ai' };
      } catch (e) { console.error('[vertex-ai]', e.message); }
    }
    return ruleCoach(kpis);
  },
};

/* 住所→座標（実＝Geocoding API／Mock＝null） */
export const geocoding = {
  async geocode(address) {
    if (!enabled('GOOGLE_MAPS') || !MAPS_KEY() || !address) return null;
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
