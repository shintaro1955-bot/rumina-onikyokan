/* ============================================================
   Provider Adapter（外部サービスの抽象化）
   キーが無い/フラグOFFのときは Mock で動く。UIからは常に同じ形。
   実接続はキー投入＋フラグONで各Providerの real 実装に差し替える。
   ============================================================ */
import { enabled } from './flags.mjs';

const hasKey = (...ks) => ks.every(k => !!process.env[k]);

/* 各連携の状態（connected / mock / off）。管理画面・同期バッジ用。 */
export function integrationStatus() {
  const s = (flag, ...keys) => enabled(flag) ? (hasKey(...keys) ? 'connected' : 'flag-on-no-key') : 'mock';
  return {
    maps: s('GOOGLE_MAPS', 'GOOGLE_MAPS_SERVER_API_KEY'),
    calendar: s('GOOGLE_CALENDAR', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'),
    drive: s('GOOGLE_DRIVE', 'GOOGLE_DRIVE_ROOT_FOLDER_ID'),
    solar: s('GOOGLE_SOLAR', 'GOOGLE_MAPS_SERVER_API_KEY'),
    weather: s('GOOGLE_WEATHER', 'GOOGLE_MAPS_SERVER_API_KEY'),
    vertexAi: s('VERTEX_AI', 'GOOGLE_CLOUD_PROJECT_ID'),
    speechToText: s('SPEECH_TO_TEXT', 'GOOGLE_CLOUD_PROJECT_ID'),
    documentAi: s('DOCUMENT_AI', 'GOOGLE_CLOUD_PROJECT_ID'),
    firebasePush: s('FIREBASE_PUSH', 'FIREBASE_PROJECT_ID'),
  };
}

/* AIコーチ（実＝Vertex AI／Mock＝ルールベース）。KPIから改善提案を1つ返す。 */
export const aiCoach = {
  async coach(kpis = {}) {
    // Mock：数値を解釈したルールベース（実接続時はVertex AIへ）
    const { visitsPerDay = 0, apoRate = 0, closeRate = null } = kpis;
    let text, evidence, module;
    if (visitsPerDay >= 25 && apoRate < 5.5) { text = '訪問数は十分です。件数より、最初の3分の質問順を改善しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = 'hook'; }
    else if (visitsPerDay < 18) { text = 'まず打席（訪問数）を増やしましょう。質の前に量が前提です。'; evidence = `訪問${visitsPerDay}件/日（目安18〜31）`; module = null; }
    else if (closeRate != null && closeRate < 50) { text = 'クロージングで取りこぼしています。2択で日程を置く型を固めましょう。'; evidence = `成約率${closeRate}%`; module = 'close'; }
    else { text = '量・質とも良いペース。この型を維持しましょう。'; evidence = `訪問${visitsPerDay}件/日・アポ率${apoRate}%`; module = null; }
    return { text, evidence, module, source: enabled('VERTEX_AI') ? 'vertex-ai' : 'rule' };
  },
};

/* 天気（実＝Google Weather／Mock＝null＝未接続表示） */
export const weather = { async today() { return enabled('GOOGLE_WEATHER') ? null : null; } };

/* カレンダー（実＝Google Calendar／Mock＝次の予定なし） */
export const calendar = { async nextEvent() { return null; }, async createEvent() { return { mock: true }; } };

/* ルート最適化（実＝Routes/Route Optimization／Mock＝訪問順そのまま） */
export const route = { async optimize(stops = []) { return { order: stops.map((_, i) => i), source: enabled('GOOGLE_MAPS') ? 'google' : 'mock' }; } };
