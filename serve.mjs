import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = process.env.PORT || 4180;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' || path === '') path = '/index.html';
  try {
    const buf = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    // SPAフォールバック：未知パスはindexを返す
    try {
      const buf = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(buf);
    } catch { res.writeHead(404); res.end('not found'); }
  }
}).listen(PORT, () => console.log(`Rumina 鬼教官 → http://localhost:${PORT}`));
