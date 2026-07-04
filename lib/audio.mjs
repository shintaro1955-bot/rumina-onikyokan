/* ============================================================
   音声前処理ヘルパー（ffmpeg / ffprobe・全て任意）
   ffmpeg が無い環境でも、25MB以下の録音は分割なしで動く。
   ============================================================ */
import { spawn } from 'node:child_process';
import { stat, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, extname, basename } from 'node:path';

const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // Whisper上限25MBに対し安全側で24MB

function run(cmd, args) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(cmd, args);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', code => resolve({ code, out, err }));
    p.on('error', () => resolve({ code: -1, out, err }));
  });
}

export async function hasFfmpeg() {
  const { code } = await run('ffmpeg', ['-version']);
  return code === 0;
}

/** 録音長（秒）。ffprobe が無ければ null（後段は文字起こしの最終セグメントで代替）。 */
export async function probeDuration(path) {
  const { code, out } = await run('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]);
  if (code !== 0) return null;
  const d = parseFloat(out.trim());
  return Number.isFinite(d) ? d : null;
}

/**
 * Whisperに投げるチャンク配列を返す。
 * - 24MB以下：分割せずそのまま1チャンク（ffmpeg不要）
 * - 24MB超  ：ffmpegで再エンコード分割（無ければエラーを投げ、UIで案内）
 * @returns {Promise<Array<{path:string, offsetSec:number}>>}
 */
export async function toChunks(path, { chunkSec = 600 } = {}) {
  const { size } = await stat(path);
  if (size <= WHISPER_MAX_BYTES) return [{ path, offsetSec: 0 }];

  if (!(await hasFfmpeg())) {
    throw Object.assign(
      new Error('ファイルが25MBを超えています。分割にはffmpegが必要です（`brew install ffmpeg`）。または25MB以下でお試しください。'),
      { code: 'NEED_FFMPEG' }
    );
  }
  const dir = join(dirname(path), 'chunks');
  await mkdir(dir, { recursive: true });
  const pattern = join(dir, 'chunk_%03d.mp3');
  // 64kbps mono mp3 に落として分割（各 chunkSec 秒 → 約5MB/10分で上限内に収まる）
  const { code, err } = await run('ffmpeg', [
    '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k',
    '-f', 'segment', '-segment_time', String(chunkSec), '-reset_timestamps', '1', pattern,
  ]);
  if (code !== 0) throw new Error('ffmpeg分割に失敗: ' + err.slice(-300));
  const files = (await readdir(dir)).filter(f => extname(f) === '.mp3').sort();
  return files.map((f, i) => ({ path: join(dir, f), offsetSec: i * chunkSec }));
}

/**
 * 無音区間の検出（任意・精度向上用）。ffmpeg が無ければ [] を返し、
 * 後段は文字起こしセグメントのギャップのみでピンポン分割する。
 * @returns {Promise<Array<{start:number,end:number}>>}
 */
export async function detectSilence(path, { db = -30, minSec = 0.7 } = {}) {
  if (!(await hasFfmpeg())) return [];
  const { err } = await run('ffmpeg', ['-i', path, '-af', `silencedetect=noise=${db}dB:d=${minSec}`, '-f', 'null', '-']);
  const silences = [];
  let start = null;
  for (const line of err.split('\n')) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) start = parseFloat(s[1]);
    if (e && start != null) { silences.push({ start, end: parseFloat(e[1]) }); start = null; }
  }
  return silences;
}
