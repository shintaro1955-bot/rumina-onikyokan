/* ============================================================
   取引が終わった会社の人を、名簿・配信の対象から外す（依存ゼロ）

   オーナー指示：
     2026-10-01「アフターホームは取引終了。対象者・名簿から外して」
     KARMA（脱退済み 2026-09-20）、G.WORTH（2026-10-01「はずす」）も外す。

   ・判定は会社名だけで行う。cyzenでは「メンバー属性」（例 アポインター/パートナー/アフターホーム株式会社）、
     アプリのアカウントではポータル由来の corp に会社名が入っている。
   ・表記ゆれ（全角半角・大小文字・空白・ドット）は exKey でそろえ、部分一致で見る
     （「ｱﾌﾀｰﾎｰﾑ」「アフターホーム株式会社」「Ｇ．ＷＯＲＴＨ」「g worth」も同じ扱い）。
   ・過去の記録データ（CSV・スナップショット・db.json）は消さない。読む時点・送る時点で外す。

   上書き：環境変数 EXCLUDE_COMPANIES（JSON配列、またはカンマ・読点区切り）。
     未設定なら既定値。空文字を入れると「誰も外さない」。
   ============================================================ */

export const EXCLUDE_DEFAULT = ['アフターホーム', 'KARMA', 'G.WORTH'];

/** 外す会社の一覧（呼ぶたびに環境変数を読む）。 */
export function excludedCompanies() {
  const raw = process.env.EXCLUDE_COMPANIES;
  if (raw == null) return EXCLUDE_DEFAULT;
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String).filter(x => x.trim()); } catch (e) {}
  }
  return s.split(/[,、，]/).map(x => x.trim()).filter(Boolean);
}

/** 突き合わせ用に会社名をそろえる（NFKC・小文字・空白とドット類を除去）。 */
export function exKey(v) {
  return String(v || '').normalize('NFKC').toLowerCase().replace(/[\s.．・･。]/g, '');
}

/** 会社名（または会社名を含む属性文字列）が除外対象か。 */
export function isExcludedCompany(v) {
  const t = exKey(v);
  if (!t) return false;
  return excludedCompanies().map(exKey).filter(Boolean).some(x => t.includes(x));
}
