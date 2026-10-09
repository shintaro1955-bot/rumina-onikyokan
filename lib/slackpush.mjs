/* ============================================================
   Slack（秘書bot ミオ）へ通知を渡す

   LINEは本人がポータルで連携しないと届かない。実測で、配信の対象84名が
   全員「LINE未連携」だった。社内のSlackのほうが先に全員いる。

   ただし鬼教官からSlackへ直接投げない。ミオに渡す。
     ・bot名義が1つで済む（受け手は「ミオから来た」で分かる）
     ・送信窓(8〜21時)・1人1日の上限・記録→送信→失敗で取消 が
       ミオ側に既にある。同じものを2つ持たない。
     ・Slackの鍵を鬼教官に持たせない。
     ・名寄せ（cyzenの氏名 → Slackの人）もミオが持つ。同姓同名は引かない。

   既定は下書き。送るには live を立てる。
   ============================================================ */
const URL_BASE = (process.env.HISHO_URL || '').replace(/\/$/, '');
const SECRET = process.env.HISHO_SECRET || process.env.INGEST_SECRET || '';

export function config() {
  return { urlSet: !!URL_BASE, secretSet: !!SECRET, ready: !!(URL_BASE && SECRET), url: URL_BASE || null };
}

/** 配信管制の pick をそのまま渡す。live=false（既定）は誰に届くかを返すだけ。 */
export async function push(items = [], { live = false } = {}) {
  if (!URL_BASE || !SECRET) {
    return { ok: false, why: 'Slack（ミオ）の宛先が設定されていません。HISHO_URL と HISHO_SECRET が要ります。' };
  }
  const body = {
    dryRun: !live,
    items: items.map(p => ({ name: p.name, reason: p.reason, message: p.message })),
  };
  try {
    const res = await fetch(`${URL_BASE}/api/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hisho-secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, why: j.error || `ミオが ${res.status} を返しました` };
    return { ok: true, ...j };
  } catch (e) {
    return { ok: false, why: `ミオにつながりません：${e.message}` };
  }
}
