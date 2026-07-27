/************************************************************
 * Plaud → 鬼教官 自動取り込み（Google Apps Script）
 * ----------------------------------------------------------
 * Plaud NotePin が「設定 > ストレージ」で Google Drive に
 * 自動保存した文字起こしファイルを、定時に拾って鬼教官の
 * /api/audio/import へ自動POSTする。手動アップロード不要。
 *
 * ■ 使い方（初回セットアップ）
 *  1) このコードを script.google.com（新規プロジェクト）に貼る
 *  2) 下の CONFIG を埋める（FOLDER_ID / ENDPOINT / SECRET）
 *  3) メニュー「実行 > setUp」を1回実行（承認＋10分毎トリガー登録）
 *  4) 以降は自動。手動で試すなら runOnce を実行。
 *
 * ■ 営業マンの特定（どのファイルが誰か）
 *  - 監視フォルダの直下に「営業マン名」のサブフォルダを作り、
 *    Plaudの保存先をその人のサブフォルダにする（推奨）。
 *  - もしくはファイル名を「山田太郎_...txt」のように氏名で始める。
 *  - どちらも無ければ DEFAULT_REP_NAME を使う。
 *  ※ 鬼教官側は氏名で名簿(rep)に紐付け、その人のマイページに保存する。
 ************************************************************/

var CONFIG = {
  // Plaudの自動保存先フォルダ（URLの /folders/ 以降のID）。サブフォルダも走査する。
  FOLDER_ID: 'ここにDriveフォルダIDを貼る',
  // 鬼教官の取り込みエンドポイント（本番URL）
  ENDPOINT: 'https://rumina-onikyokan-production.up.railway.app/api/audio/import',
  // 鬼教官の環境変数 INGEST_SECRET と同じ値
  SECRET: 'ここに合言葉を貼る',
  // 氏名が判定できないときの既定の営業マン名
  DEFAULT_REP_NAME: 'インポート',
};

var PROP_KEY = 'onikyokan_seen_ids';   // 取り込み済みファイルIDの記録

/** 10分毎トリガーを登録（初回だけ実行）。 */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runOnce').timeBased().everyMinutes(10).create();
  Logger.log('セットアップ完了：10分毎に runOnce が動きます。');
}

/** メインの取り込み処理（トリガー or 手動で実行）。 */
function runOnce() {
  var root = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  var seen = loadSeen();
  var picked = [];
  collectFiles(root, null, picked);   // {file, repName} を集める（サブフォルダ名=氏名）

  var sent = 0;
  picked.forEach(function (item) {
    var file = item.file;
    var id = file.getId();
    if (seen[id]) return;                                   // 取り込み済みはスキップ
    var text = readText(file);
    if (!text) { seen[id] = true; return; }                 // 中身が取れないものは記録だけして飛ばす
    var repName = item.repName || repFromFileName(file.getName()) || CONFIG.DEFAULT_REP_NAME;
    try {
      var ok = postToOnikyokan(text, repName);
      if (ok) { seen[id] = true; sent++; }
    } catch (e) {
      Logger.log('POST失敗 ' + file.getName() + ' : ' + e);
    }
  });
  saveSeen(seen);
  Logger.log('取り込み ' + sent + '件 / 走査 ' + picked.length + '件');
}

/** フォルダを再帰走査。直下のサブフォルダ名を営業マン名として引き継ぐ。 */
function collectFiles(folder, repName, out) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (isTranscript(f)) out.push({ file: f, repName: repName });
  }
  var subs = folder.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    collectFiles(sub, sub.getName(), out);   // サブフォルダ名＝氏名
  }
}

/** 文字起こしとして扱えるファイルか（txt / docx / gdoc）。 */
function isTranscript(file) {
  var mt = file.getMimeType();
  var name = (file.getName() || '').toLowerCase();
  return mt === MimeType.PLAIN_TEXT ||
    mt === MimeType.GOOGLE_DOCS ||
    mt === MimeType.MICROSOFT_WORD ||
    /\.(txt|md|docx)$/.test(name);
}

/** ファイルから本文テキストを取り出す（txtはそのまま、docx/gdocはGoogleドキュメント経由）。 */
function readText(file) {
  var mt = file.getMimeType();
  try {
    if (mt === MimeType.PLAIN_TEXT) return file.getBlob().getDataAsString('UTF-8');
    if (mt === MimeType.GOOGLE_DOCS) return DocumentApp.openById(file.getId()).getBody().getText();
    if (mt === MimeType.MICROSOFT_WORD) {
      // DOCX → Googleドキュメントに変換して本文を取得（変換ファイルは即削除）
      var doc = Drive.Files.copy({ title: file.getName(), mimeType: MimeType.GOOGLE_DOCS }, file.getId());
      var text = DocumentApp.openById(doc.id).getBody().getText();
      DriveApp.getFileById(doc.id).setTrashed(true);
      return text;
    }
    return file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    Logger.log('読み取り失敗 ' + file.getName() + ' : ' + e);
    return '';
  }
}

/** ファイル名の先頭「氏名_...」から氏名を拾う（無ければ空）。 */
function repFromFileName(name) {
  var m = String(name || '').match(/^([^_\/]+)_/);
  return m ? m[1].trim() : '';
}

/** 鬼教官へPOST。成功で true。 */
function postToOnikyokan(text, repName) {
  var res = UrlFetchApp.fetch(CONFIG.ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ export: text, name: repName, secret: CONFIG.SECRET }),
  });
  var code = res.getResponseCode();
  if (code === 200) return true;
  Logger.log('鬼教官応答 ' + code + ' : ' + res.getContentText().slice(0, 300));
  return false;
}

function loadSeen() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function saveSeen(obj) {
  // 肥大化防止：直近2000件だけ保持
  var keys = Object.keys(obj);
  if (keys.length > 2000) { var trimmed = {}; keys.slice(-2000).forEach(function (k) { trimmed[k] = true; }); obj = trimmed; }
  PropertiesService.getScriptProperties().setProperty(PROP_KEY, JSON.stringify(obj));
}
