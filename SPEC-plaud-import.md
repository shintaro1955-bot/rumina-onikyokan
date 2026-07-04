# Plaud NotePin 取り込み — 想定フォーマット仕様 v1.0

NotePin（ウェアラブルAIレコーダー）の書き出しを鬼教官に取り込むための**想定フォーマット**。
実機の書き出しが確定したら `lib/import-plaud.mjs` のパーサをこの仕様に合わせて微調整する。

Whisperを介さずこのフォーマットから直接 `segments[]` を作れるため、**文字起こし費用ゼロ**で
ピンポン分割・話者分離・KPI抽出・イシュー分析まで通る。

---

## 1. JSON形式（推奨）

```jsonc
{
  "device": "PLAUD NotePin",
  "recordingId": "rec_20260703_tanaka",
  "startedAt": "2026-07-03T09:02:00+09:00",   // 録音開始の絶対時刻（時間帯KPIの基準）
  "durationSec": 4000,                          // 録音長（秒）。無ければ最終セグメントendで代用
  "language": "ja",
  "speakers": [                                 // 音響話者分離のラベル一覧（任意）
    { "id": "S1", "label": "話者1" },
    { "id": "S2", "label": "話者2" }
  ],
  "segments": [
    {
      "start": 610,        // 録音開始からの秒。数値 or "HH:MM:SS"/"MM:SS" 文字列も可
      "end": 615,
      "speaker": "S1",     // 話者ID（無ければ null → うちのヒューリスティック話者分離にフォールバック）
      "text": "こんにちは、電気代の無料診断で回っています。",
      "confidence": 0.95   // 任意。低信頼セグメントはKPIで減点に使える
    }
  ],
  "summary": "…"           // PlaudのAI要約（任意・KPIには未使用）
}
```

### フィールド対応（別名も許容）
| 標準キー | 別名（受け付ける） |
|---|---|
| `start` | `startSec`, `begin`, `t` |
| `end` | `endSec`, `stop` |
| `speaker` | `speaker_id`, `speakerLabel` |
| `text` | `content` |
| `confidence` | `conf` |

トップは `{ segments: [...] }` / `{ transcript: [...] }` / セグメントの生配列 のいずれも可。

---

## 2. プレーンテキスト形式（フォールバック）

タイムスタンプ付きの素の書き出しも取り込める。

```
[00:10:10] 話者1: こんにちは、電気代の無料診断で回っています。
[00:10:16] 話者2: 今忙しいので結構です。
[00:10:20] 話者1: ちなみに明細だけ確認させてもらえますか？
```
- 先頭 `[HH:MM:SS]` or `[MM:SS]` を開始秒に変換（endは次行の開始で補完）
- `話者N:` / `Speaker N:` / `営業:` / `お客様:` の接頭辞は話者として解釈（無くても可）

---

## 3. 話者ラベル → 役割（sales / customer）の対応付け

NotePinの音響分離は「声の違い」は分けるが、**どれが営業でどれが客かは判定しない**。
本アダプタは次の手がかりで役割を推定する：

1. **1日を通して最も長く・多くの訪問に登場する声＝営業マン**（訪販では営業だけが全訪問に共通して喋る）
2. 補強として営業側の語彙（電気代/無料診断/明細/ちなみに…）のヒット数で検証

→ 話者ラベルがある書き出しは `speakerSeparation: 'acoustic'`（音響・確定）として扱う。
話者ラベルが無い書き出しは、うちの `heuristic` 話者分離にフォールバックする。
`営業:` / `お客様:` のように役割が明示されていれば、それを最優先で採用する。

> 正直表示：話者分離が音響でも、**アポ率は「文面判定」なので推定のまま**（CRM/結果入力で確定）。

---

## 4. 取り込みAPI

```
POST /api/audio/import
Body: {
  "name": "田中 翔",          // 任意（レポート表示名）
  "startHour": 9,             // 任意（startedAtから自動取得）
  "export": <上記JSON or 文字列>,
  "gps": [ { "t":秒, "lat":.., "lng":.. } ]   // 任意（Phase 2照合）
}
→ 200 { sessionId, analysis, pings, transcript }   // Whisper不要なので即時返却
```

サンプル：[`samples/plaud-sample.json`](samples/plaud-sample.json)
