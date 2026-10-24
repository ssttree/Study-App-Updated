// Serves the built app (the dist folder) on Railway. Railway sets PORT.
// Everything runs in the browser, so this only hands out files.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT) || 3000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // The PDF reader's worker is a .mjs module; browsers refuse to run it under any other type.
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

async function findFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = join(root, clean);
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const s = await stat(full);
    if (s.isFile()) return full;
  } catch {
    /* fall through */
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    let file = await findFile(path);
    if (!file) {
      // Missing files with an extension are real 404s; anything else is the app.
      if (extname(path)) return res.writeHead(404).end('Not found');
      file = join(root, 'index.html');
    }
    const name = file.slice(root.length);
    // Hashed files never change, so browsers can keep them. The page and the
    // service worker must always be checked so updates arrive.
    const cache = name.startsWith(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(port, () => {
  console.log(`Study App running on port ${port}`);
});
