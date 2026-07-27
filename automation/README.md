# Plaud → 鬼教官 自動取り込み（手動アップロード不要化）

Plaud NotePin の文字起こしを Google Drive 経由で鬼教官に自動流し込みし、
毎回の「録音を出稿」操作を無くすための仕組み。

```
Plaud（録音→自動文字起こし）
  → Google Drive 自動保存（Plaudアプリ側で有効化）
  → GAS が10分毎にフォルダを走査
  → 鬼教官 /api/audio/import へ自動POST（合言葉つき）
  → 話者分離→KPI→鬼教官の講評(Claude) まで自動生成
```

## セットアップ手順

### 1. Plaud側：Google Drive 自動保存をON
Plaudアプリ → 設定 > ストレージ → Google Drive を連携し、保存先フォルダを1つ決める。
（できれば営業マンごとにサブフォルダを分ける＝そのフォルダ名を氏名にする）

### 2. 鬼教官側：環境変数を設定（Railway）
- `INGEST_SECRET` … 好きなランダム文字列（GASと共有する合言葉）
- `ANTHROPIC_API_KEY` … Claude APIキー（AI講評を使う場合。未設定ならルールベース講評になる）
- （任意）`CRITIQUE_MODEL` … 既定 `claude-opus-4-8`。コスト優先なら `claude-sonnet-5`

`/api/health` の `ingestReady` / `critiqueReady` が `true` になれば設定完了。

### 3. GAS側：スクリプトを登録
1. https://script.google.com で新規プロジェクト
2. `plaud-to-onikyokan.gs` の中身を貼り付け
3. サービス「Drive API」を追加（DOCX変換に使用）: エディタ左「サービス+」→ Drive API
4. `CONFIG` を編集：
   - `FOLDER_ID` … 手順1のDriveフォルダID（URLの `/folders/` の後ろ）
   - `ENDPOINT` … `https://rumina-onikyokan-production.up.railway.app/api/audio/import`
   - `SECRET` … 手順2の `INGEST_SECRET` と同じ値
5. 関数 `setUp` を1回実行（承認ダイアログを許可）→ 10分毎トリガー登録
6. すぐ試すなら `runOnce` を実行し、実行ログで「取り込み N件」を確認

## 営業マンの紐付け
- **推奨**：監視フォルダ直下に氏名のサブフォルダ（例 `山田太郎/`）を作り、その中に保存 → 氏名で名簿(rep)に自動紐付け
- または ファイル名を `山田太郎_2026-07-18.txt` のように氏名で始める
- どちらも無ければ `DEFAULT_REP_NAME`（既定「インポート」）扱い

## 補足
- 取り込み済みファイルは記録され、二重取り込みしない。
- 在宅率・アポ率の「確定」は GPS(cyzen) / 確定アポ(kintone) の突合が別途必要（未突合は推定値のまま）。
- 音声(Whisper)解析は不要：Plaudが文字起こし済みのため、取り込みはAPIキー無しでも動く（AI講評だけ `ANTHROPIC_API_KEY` を使う）。
