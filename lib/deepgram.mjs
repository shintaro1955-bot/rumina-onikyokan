/* ============================================================
   TranscriptionProvider — Deepgram 実装（話者分離つき）
   Whisper版と同じ transcribe(chunk, opts) を実装。違いは:
     ・diarize（音響話者分離）で speaker が実測で付く
     ・keyterm（用語ブースト）で商材・電力会社名の誤認を減らす
     ・smart_format / numerals で「38件」「4.5kW」等を数字表記に整形
   speaker は Deepgram の話者番号(0,1,2…)のまま返し、
   全チャンク結合後に assignRoles() で sales/customer へ確定させる。
   ============================================================ */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const DG_URL = 'https://api.deepgram.com/v1/listen';
const API_KEY = process.env.DEEPGRAM_API_KEY || '';
const MODEL = process.env.DEEPGRAM_MODEL || 'nova-3';

export const ready = () => !!API_KEY;
export const model = () => MODEL;

/** 用語ブースト。太陽光・蓄電池の訪販ドメインで誤認しやすい語を優先させる。 */
export const KEYTERMS = [
  '電気健康診断', '検針票', '明細', 'kWh', '再エネ賦課金', '託送料金',
  '東京電力', '関西電力', '中部電力', '九州電力', '東北電力',
  'オール電化', '太陽光', '蓄電池', 'エコキュート', 'パワコン', 'V2H', '卒FIT',
  '補助金', '助成金', '一般社団法人', '加盟事業者', 'フィットファウンダー',
  'インターホン', '見積', '訪問', 'ご提案',
  '協会', '助成金支援協会', '圏内', '施工実績', '電気代', '無料診断',
];

const MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
  '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.webm': 'audio/webm',
};

/** 機能フラグを組み立てる。drop に入れた機能は外す（モデル/言語が非対応だった時の縮退用）。 */
function buildQuery(opts, drop = new Set()) {
  const p = new URLSearchParams();
  p.set('model', opts.model || MODEL);
  p.set('language', opts.lang || 'ja');
  p.set('punctuate', 'true');
  // 話者分離：推奨は diarize_model=latest。非対応環境では旧来の diarize=true に落とす。
  if (drop.has('diarize_model')) p.set('diarize', 'true');
  else p.set('diarize_model', 'latest');
  if (!drop.has('utterances')) p.set('utterances', 'true');       // 発話単位でまとめて返す
  if (!drop.has('smart_format')) p.set('smart_format', 'true');   // 句読点・単位・日付の整形
  if (!drop.has('numerals')) p.set('numerals', 'true');           // 「さんじゅうはち」→「38」
  if (!drop.has('keyterm')) for (const k of (opts.keyterms || KEYTERMS)) p.append('keyterm', k);
  return p.toString();
}

/** 400が返ったとき、メッセージ中に出てくる機能名を1つ特定して縮退対象にする。 */
function offendingFeature(msg) {
  const s = String(msg || '').toLowerCase();
  for (const f of ['keyterm', 'numerals', 'smart_format', 'utterances', 'diarize_model']) {
    if (s.includes(f)) return f;
  }
  return null;
}

/**
 * @param {{path:string, offsetSec:number}} chunk
 * @param {{lang?:string, model?:string, keyterms?:string[], apiKey?:string}} opts
 * @returns {Promise<Array<{startSec:number,endSec:number,text:string,speaker:number|null,confidence:number}>>}
 */
export async function transcribe(chunk, opts = {}) {
  const key = opts.apiKey || API_KEY;
  if (!key) throw Object.assign(new Error('DEEPGRAM_API_KEY 未設定'), { fatal: true });
  const buf = await readFile(chunk.path);
  const ctype = MIME[extname(chunk.path).toLowerCase()] || 'application/octet-stream';

  const drop = new Set();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${DG_URL}?${buildQuery(opts, drop)}`, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': ctype },
        body: buf,
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`retryable ${res.status}`);
      if (!res.ok) {
        const t = await res.text();
        // モデル/言語が特定機能に非対応 → その機能だけ外して再試行（全体を落とさない）
        const f = res.status === 400 && offendingFeature(t);
        if (f && !drop.has(f)) {
          drop.add(f);
          console.warn(`[deepgram] ${f} 非対応のため外して再試行します`);
          continue;
        }
        throw Object.assign(new Error(`Deepgram ${res.status}: ${t.slice(0, 300)}`), { fatal: true });
      }
      const json = await res.json();
      return mapResponse(json, chunk.offsetSec || 0);
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr || new Error('Deepgram: 文字起こしに失敗しました');
}

/** Deepgramの応答を共通のセグメント配列へ。utterances優先、無ければwordsを話者で束ねる。 */
export function mapResponse(json, offsetSec = 0) {
  const r = json && json.results;
  if (!r) return [];
  if (Array.isArray(r.utterances) && r.utterances.length) {
    return r.utterances
      .filter(u => (u.transcript || '').trim())
      .map(u => ({
        startSec: +(u.start || 0) + offsetSec,
        endSec: +(u.end || 0) + offsetSec,
        text: String(u.transcript).trim(),
        speaker: Number.isInteger(u.speaker) ? u.speaker : null,
        confidence: u.confidence ?? 0,
      }));
  }
  const words = r.channels?.[0]?.alternatives?.[0]?.words || [];
  const out = [];
  for (const w of words) {
    const sp = Number.isInteger(w.speaker) ? w.speaker : null;
    const last = out[out.length - 1];
    const token = w.punctuated_word || w.word || '';
    if (last && last.speaker === sp && (+w.start - last.endSec) < 1.0) {
      last.text += token;
      last.endSec = +w.end + offsetSec;
      last._n++; last._c += (w.confidence ?? 0);
      last.confidence = last._c / last._n;
    } else {
      out.push({
        startSec: +w.start + offsetSec, endSec: +w.end + offsetSec,
        text: token, speaker: sp, confidence: w.confidence ?? 0, _n: 1, _c: (w.confidence ?? 0),
      });
    }
  }
  return out.map(({ _n, _c, ...s }) => s);
}

/* 営業らしさの語彙。装着録音なので基本は「最も長く喋る話者＝営業」だが、
   同程度に喋る相手がいる場合の判定材料に使う。 */
const SALES_HINT = /(と申します|ご提案|お伺い|失礼いた|ご案内|弊社|当社|補助金|助成金|診断|検針票|よろしいでしょうか|させていただ)/;

/**
 * Deepgramの話者番号を 'sales' / 'customer' に確定させる。
 * 前提：1日を通した装着録音では、全訪問に共通して登場し最も長く喋るのが営業本人。
 * @param {Array} segments transcribe() の結果（全チャンク結合済み）
 * @returns {{segments:Array, salesSpeaker:number|null, stats:Array}}
 */
export function assignRoles(segments) {
  const byId = new Map();
  for (const s of segments) {
    if (!Number.isInteger(s.speaker)) continue;
    const st = byId.get(s.speaker) || { id: s.speaker, sec: 0, hits: 0, chars: 0 };
    st.sec += Math.max(0, (s.endSec - s.startSec));
    st.chars += (s.text || '').length;
    if (SALES_HINT.test(s.text || '')) st.hits++;
    byId.set(s.speaker, st);
  }
  const stats = [...byId.values()].sort((a, b) => b.sec - a.sec);
  if (!stats.length) return { segments: segments.map(s => ({ ...s })), salesSpeaker: null, stats };

  let sales = stats[0];
  // 首位と僅差（1.2倍以内）の相手がいるときは、営業語彙が多い方を採用する。
  if (stats[1] && stats[0].sec < stats[1].sec * 1.2 && stats[1].hits > stats[0].hits) sales = stats[1];

  return {
    segments: segments.map(s => ({
      ...s,
      speakerRaw: s.speaker,
      speaker: Number.isInteger(s.speaker) ? (s.speaker === sales.id ? 'sales' : 'customer') : null,
    })),
    salesSpeaker: sales.id,
    stats,
  };
}

/** 「営業: …」形式の読みやすい文字起こしに整形（LLM採点・画面表示用）。 */
export function toLabeledText(segments) {
  return segments.map(s => {
    const who = s.speaker === 'sales' ? '営業' : s.speaker === 'customer' ? '客' : '不明';
    return `${who}: ${s.text}`;
  }).join('\n');
}
