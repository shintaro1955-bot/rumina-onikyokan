# Rumina 鬼教官 — Phase 1（Whisper実接続）

営業録音を解析し、トップ営業との差分・弱点・翌日の改善を「鬼教官」がフィードバックするアプリ。
このリポジトリは **MVP UI ＋ Phase 1（Whisper実解析バックエンド）** を含む。

## 動かし方

### 1. モックUIだけ見る（キー不要）
```bash
node serve.mjs          # or preview: rumina-onikyokan
# → http://localhost:4180  （録音アップロードは常にモック解析）
```

### 2. Whisperで実解析する（Phase 1）
```bash
cp .env.example .env
#  .env の OPENAI_API_KEY を自分のキーに書き換える
export $(grep -v '^#' .env | xargs)   # 環境変数を読み込む（zsh/bash）
node server.mjs
# → http://localhost:4180  録音アップロード画面に「● Whisper接続済」と出る
```
- **25MB以下**の mp3 / m4a / wav / mp4 はそのまま解析可（ffmpeg不要）。
- **25MB超**の長時間録音は分割に `ffmpeg` が必要：`brew install ffmpeg`。
- `ffprobe` があると録音長を正確に取得（無音時間の精度向上）。

## 構成
```
index.html          SPAシェル
data.js             型・モックデータ・ベンチマーク・派生関数
diagnose.js         自動診断エンジン（何がダメ/何に気をつけるか）＋SESSION
charts.js           自作SVGチャート（ゲージ/レーダー/活動密度/ランキング）
api.js              バックエンドAPIクライアント
app.js              画面・ルーター・解析フロー（実/モック自動振り分け）
serve.mjs           静的配信のみ（キー不要のデモ用）
server.mjs          Phase 1 サーバー（静的配信＋実Whisper API）
lib/whisper.mjs     TranscriptionProvider（Whisper実装）
lib/audio.mjs       ffmpeg/ffprobeヘルパー（任意）
lib/pipeline.mjs    ピンポン分割＋KPI抽出（AnalysisResult生成）
SPEC-audio-api.md   音声処理API接続仕様書 v1.0
```

## デプロイ（Railway）
依存パッケージゼロのNode常駐サーバー。`package.json`（start=`node server.mjs`）＋`railway.json`＋`nixpacks.toml`（ffmpeg同梱）を同梱済み。

**GitHub連携（推奨）**
1. `git init && git add -A && git commit -m "init"` → GitHubへpush
2. Railway → New Project → **Deploy from GitHub repo** → 本リポジトリを選択
3. **Variables** に `OPENAI_API_KEY` を設定（音声解析用。Plaud取り込み・モックのみなら不要）
   - 任意：`DIARIZE`(既定heuristic/`none`可)、`VISIT_GAP_SEC`、`IDLE_GAP_SEC`
4. Nixpacksが自動ビルド→`node server.mjs`起動。**Settings → Networking → Generate Domain** で公開URL

**データ永続化（Volume・重要）**
ユーザー／登録した成功モデル／診断ログ（文字起こし全文）は `DATA_DIR` 配下に保存する。RailwayはVolumeを付けないと再デプロイで全部消えるので、本番は必ず：
1. サービスの **Settings → Volumes → New Volume**、Mount path を `/data` に
2. **Variables** に `DATA_DIR=/data` を追加
3. 再デプロイ後、`/data/db.json`（ユーザー/モデル/索引）・`/data/reports/<id>.json`（1録音=1診断ログ）・`/data/uploads/`（音声）に永続化される

**Railway CLI**
```bash
npm i -g @railway/cli && railway login
railway init && railway up
railway variables set OPENAI_API_KEY=sk-xxxx
railway domain
```

**本番前の注意（重要）**
- 永続化はVolume（上記）が前提。未設定だと `./data` に落ちて再デプロイで消える。`SESSIONS`（解析中の一時状態）はメモリ保持＝**単一インスタンス前提**（確定した診断ログはディスクに保存済み）。
- スケール（複数インスタンス）時は、セッション/確定/同意を **Postgres（Neon/Supabase）**、音声を **Cloudflare R2 / S3** に移す。
- `PORT` はRailwayが注入（`server.mjs`は`process.env.PORT`対応済み）。`OPENAI_API_KEY`はサーバのみ・クライアントに出さない。
- ログイン/マルチテナント・**録音同意の保存**・Whisperのコスト上限は本番ローンチ前に。

## 録音機：Plaud NotePin（標準デバイス）
携帯の常時録音ではなく、ウェアラブルAIレコーダー **Plaud NotePin** を装着して1日録る運用。
取り込みは2通り（アップロード画面）：
- **① 文字起こしを取り込む**（`lib/import-plaud.mjs`）：NotePinの書き出し（JSON/テキスト）を投入。
  **Whisper不要・APIキー不要で即解析**。話者ラベルがあれば音響話者分離として扱い、在宅・切り返し・お客様反応が確定値に。
  想定フォーマット：[`SPEC-plaud-import.md`](SPEC-plaud-import.md)、サンプル：[`samples/plaud-sample.json`](samples/plaud-sample.json)。
- **② 音声を解析**：生音声をWhisperへ（従来どおり）。
- 役割推定：NotePinの話者ラベルは「声の違い」しか分けないため、**1日を通して最も喋る声＝営業マン**として sales/customer に対応付ける。
- **ワンクリック体験**：アップロード画面「サンプル（NotePin想定・1日分＋GPS）で試す」で
  [`samples/plaud-fullday.json`](samples/plaud-fullday.json)＋[`samples/plaud-fullday-gps.json`](samples/plaud-fullday-gps.json)を即取り込み（キー不要）。

### 率は「総ピンポン数」で確定する（重要な正直表示）
文字起こしに写るのは**会話が録れた訪問だけ**。不在・インターホンのみは音声に残らないので、
取り込み直後の在宅率/会話率/アポ率は「会話数が分母」＝過大に出る（例：在宅100%・アポ36%）。
→ **自動**：GPSがあれば総ピンポン数を停止クラスタから自動算出（訪問＋不在）、CRM（`lib/crm.mjs`）が
あれば確定アポ数を自動取得。両方揃えば手入力ゼロで率が確定し、バナーが緑「全KPI確定」に。
→ **手動**：レポートの「結果を確定（GPS / CRM 突合）」に総ピンポン数・確定アポ数を入れて上書きも可。
確定は端末に保存され、同じ営業マン・日付なら再取り込み時も反映。

## Phase 3：話者分離（在宅/切り返し/お客様反応を実算出）
Whisperは話者を出さないため、`lib/diarize.mjs` で各セグメントに `speaker='sales'|'customer'` を付与する。
- 既定 **heuristic**（依存ゼロ）：役割語彙＋ターン構造＋訪問の口開け仮定で話者推定。音響分離ではないが、
  在宅反応・切り返し・お客様反応を「会話の順番」から実算出できる。精度は中。
- **acoustic**（差し替え）：AssemblyAI/Deepgram/pyannote の音響話者ラベルを繋ぐと確定値に。`acousticDiarize` を実装して `DIARIZE=acoustic`。
- 無効化：`DIARIZE=none`。
- 話者分離の方式に応じて `quality.speakerSeparation` と「推定値として残る項目」がレポート上部のバナーに正直表示される
  （none→在宅/アポ/切り返し/反応/サボりが推定 → heuristic→アポ率のみ → acoustic＋GPS→全確定）。

## Phase 2：GPS照合（サボり裏取り）
録音アップロード画面で **GPSログ（JSON・任意）** を一緒に投入すると、空白時間を
「移動 / 接客（滞在）/ 実サボり」に自動で裏取りする。移動は免罪、停止＋無会話だけが実サボり。
- 形式：`[{ "t": 秒(録音開始からの経過), "lat": 緯度, "lng": 経度 }, ...]`
- 停止判定：半径25m以内に40秒以上滞在（`lib/gps.mjs` で調整可）
- GPS接続時は `サボり疑い` が推定値から**確定値**に変わり、レポートに「GPS照合」ブロックが出る。

## Phase 1 の正直な限界（重要）
話者分離(diarization)とGPSが未接続のため、**話者に依存するKPIは推定値**：
`在宅反応率 / アポ率 / 切り返し回数 / お客様反応`。
レポートに黄色い注意バーで明示される。**確定扱い・人事評価に使う前に、GPS/明細で裏取りすること。**
確実に取れるのは：文字起こし全文・総ピンポン数（無音境界ベース）・会話時間・冒頭質問率・断り文句・無音時間。

次段階（Phase 2〜）は `SPEC-audio-api.md` の §11 を参照。
