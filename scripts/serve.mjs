// Serves frontend/ for local checks and the browser tests the way the Azure Storage static
// website does: files as they are, index.html for folders, 404.html (status 404) for anything
// missing. Like Azure, it sends no security headers; the pages carry their CSP in a <meta> tag.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_ROUTES, CONTENT_TYPES, configJs, keptLab, labJson, precacheJson, precached, swJs, withApi } from './site-config.mjs';

const ROOT = fileURLToPath(new URL('../frontend/', import.meta.url));
const TYPES = CONTENT_TYPES;

/** A file as stage.mjs would publish it for that API address. */
async function staged(path, api, build) {
  if (path === 'config.js') return Buffer.from(configJs({ api, build }));
  const body = await readFile(join(ROOT, path));
  if (path === 'sw.js') return Buffer.from(swJs(body.toString('utf8'), build));
  return api && path.endsWith('.html') ? Buffer.from(withApi(body.toString('utf8'), api, path)) : body;
}

async function precacheList(api, build) {
  const list = [];
  for (const e of await readdir(ROOT, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const path = relative(ROOT, join(e.parentPath, e.name)).replaceAll('\\', '/');
    if (precached(path)) list.push({ path, size: (await staged(path, api, build)).length });
  }
  return precacheJson(build, list);
}

/** /lab/offline.json as stage.mjs writes it: the editor's own files with their sizes and hashes. */
async function labList(api, build) {
  const list = [];
  for (const e of await readdir(ROOT, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const path = relative(ROOT, join(e.parentPath, e.name)).replaceAll('\\', '/');
    if (!keptLab(path)) continue;
    const body = await staged(path, api, build);
    list.push({ path, size: body.length, hash: createHash('sha256').update(body).digest('hex') });
  }
  return labJson(build, list);
}

/** `api`: serve the site as staged for that API address (config.js and CSP); `build`: the release
 * number in sw.js, precache.json and config.js (a test serves build A, then B). */
export function serve(port = 0, { api = '', build = 1 } = {}) {
  const opts = { api, build, up: true }, asked = /** @type {string[]} */ ([]);
  const server = createServer(async (req, res) => {
    if (!opts.up) { req.socket.destroy(); return; }   // no signal: the connection just drops
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    if (path.startsWith('..')) { res.writeHead(400).end(); return; }
    if (path === '' || path.endsWith('/')) path += 'index.html';
    asked.push(path);
    try {
      if (path === 'precache.json') { res.writeHead(200, { 'content-type': TYPES['.json'] }).end(await precacheList(opts.api, opts.build)); return; }
      if (path === 'lab/offline.json') { res.writeHead(200, { 'content-type': TYPES['.json'] }).end(await labList(opts.api, opts.build)); return; }
      // like stage.mjs: an app route without its own page gets the shell
      if (!existsSync(join(ROOT, path)) && APP_ROUTES.some(r => path === `${r}/index.html`)) path = 'index.html';
      const body = await staged(path, opts.api, opts.build);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
    }
  });
  /** Every path asked for, in order (a test empties it and reads what a step fetched). */
  server.asked = asked;
  /** Switch to another release without restarting (the service worker update test). */
  server.release = (build) => { opts.build = build; };
  /** With `false` every request fails as it does with no signal, for pages and the service worker alike (a browser's
   * own offline switch does not always reach the worker); `true` brings it back. */
  server.signal = (up) => { opts.up = up; };
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.env.PORT) || 8080);
  console.log(`http://127.0.0.1:${server.address().port}`);
}
