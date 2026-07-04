/* ============================================================
   CRM連携（確定アポ数の自動取得）
   本番：kintone / Salesforce / HubSpot 等のAPIを叩く実装をここに。
   既定：samples/crm-sample.json から 営業マン名（＋日付）で引くモック。
   接続できない/データ無しなら null → 文面推定のまま。
   ============================================================ */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * @returns {Promise<{count:number, source:string}|null>}
 */
export async function fetchAppointments(repName, date) {
  try {
    const raw = await readFile(join(ROOT, 'samples', 'crm-sample.json'), 'utf8');
    const map = JSON.parse(raw);
    // "名前|日付" を優先、無ければ "名前" で引く
    const hit = map[`${repName}|${date}`] ?? map[repName];
    if (hit == null) return null;
    return { count: typeof hit === 'number' ? hit : hit.count, source: 'crm-mock' };
  } catch {
    return null;
  }
}
