/* ============================================================
   TranscriptionProvider — Whisper 実装（Phase 1）
   SPEC §4 の共通インターフェースに準拠。
   他エンジンへ差し替える場合はこのファイルと同じ形の
   transcribe(chunk, opts) を実装すればよい。
   ============================================================ */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * @param {{path:string, offsetSec:number}} chunk  音声チャンク（offsetSec=日内絶対秒への補正量）
 * @param {{lang:string, prompt?:string, model?:string, apiKey:string}} opts
 * @returns {Promise<Array<{startSec:number,endSec:number,text:string,speaker:null,confidence:number}>>}
 */
export async function transcribe(chunk, opts) {
  const buf = await readFile(chunk.path);
  const form = new FormData();
  form.append('file', new Blob([buf]), basename(chunk.path));
  form.append('model', opts.model || 'whisper-1');
  form.append('language', opts.lang || 'ja');
  form.append('response_format', 'verbose_json');   // segments + timestamps を取得
  form.append('temperature', '0');
  if (opts.prompt) form.append('prompt', opts.prompt); // ドメイン語彙バイアス（誤認対策）

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {     // 指数バックオフでリトライ
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        body: form,
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`retryable ${res.status}`);
      if (!res.ok) {
        const t = await res.text();
        throw Object.assign(new Error(`Whisper ${res.status}: ${t.slice(0, 300)}`), { fatal: true });
      }
      const json = await res.json();
      const off = chunk.offsetSec || 0;
      const segs = json.segments || [];
      if (segs.length) {
        return segs.map(s => ({
          startSec: +(s.start + off).toFixed(2),
          endSec: +(s.end + off).toFixed(2),
          text: (s.text || '').trim(),
          speaker: null,                                  // Whisper単体は話者を出さない（SPEC §9-B）
          confidence: s.no_speech_prob != null ? 1 - s.no_speech_prob : 0.9,
        })).filter(s => s.text);
      }
      // segmentsが無い応答フォーマットのフォールバック
      return json.text ? [{ startSec: off, endSec: off, text: json.text.trim(), speaker: null, confidence: 0.8 }] : [];
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export const name = 'whisper';
