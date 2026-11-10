// Static server for the studio (no dependencies): node scripts/serve.mjs [port]
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 5190);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = normalize(join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  const ok = file.startsWith(root + sep) && (file.includes(`${sep}dist${sep}`) || file.endsWith('index.html'));
  if (!ok || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Web PLC Studio: http://localhost:${port}`));
