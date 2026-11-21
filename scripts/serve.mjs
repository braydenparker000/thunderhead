// Serves frontend/ for local checks and the browser tests the way the Azure Storage static
// website does: files as they are, index.html for folders, 404.html (status 404) for anything
// missing. Like Azure, it sends no security headers; the pages carry their CSP in a <meta> tag.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_ROUTES, CONTENT_TYPES, configJs, keptLab, labBuildJs, labJson, lookTag, precacheJson, precached, swJs, TAGGED, themeJs, withApi } from './site-config.mjs';

const ROOT = fileURLToPath(new URL('../frontend/', import.meta.url));
const TYPES = CONTENT_TYPES;

/** The tests' phone has chosen a look, Classic unless a test says otherwise: most of them were written on
 * it, and the default is Ink and Lamp. Once per storage (a later choice in Settings stands), and not where
 * a test sets `th.t.look` itself to be a phone that has chosen nothing. @param {string} look */
const chosen = (look) => look ? `try{if(!localStorage.getItem('th.t.look')){localStorage.setItem('th.t.look','1');if(!localStorage.getItem('th.s.appearance.look'))localStorage.setItem('th.s.appearance.look','${look}')}}catch{}\n` : '';

/** A file as stage.mjs would publish it for that API address. */
async function staged(path, api, build, look = '') {
  if (path === 'config.js') return Buffer.from(configJs({ api, build }));
  // The look's folder as published, look/<hash>/ (scripts/look-config.mjs), named in ui/theme.js.
  const body = await readFile(join(ROOT, path.replace(TAGGED, 'look/')));
  if (path === 'ui/theme.js') return Buffer.from(chosen(look) + themeJs(body.toString('utf8'), lookTag(join(ROOT, 'look'))));
  if (path === 'sw.js') return Buffer.from(swJs(body.toString('utf8'), build));
  if (path === 'lab/engine/build.js') return Buffer.from(labBuildJs(body.toString('utf8'), `b${build}`));
  return api && path.endsWith('.html') ? Buffer.from(withApi(body.toString('utf8'), api, path)) : body;
}

/** /precache.json as stage.mjs writes it: each file with its size and hash. */
async function precacheList(api, build, look) {
  const list = [];
  for (const e of await readdir(ROOT, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const path = relative(ROOT, join(e.parentPath, e.name)).replaceAll('\\', '/');
    if (!precached(path)) continue;
    const body = await staged(path, api, build, look);
    list.push({ path, size: body.length, hash: createHash('sha256').update(body).digest('hex') });
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
 * number in sw.js, precache.json and config.js (a test serves build A, then B); `look`: the look the
 * phone has chosen (`chosen` above), '' for none. */
export function serve(port = 0, { api = '', build = 1, look = 'classic' } = {}) {
  const opts = { api, build, look, up: true }, asked = /** @type {string[]} */ ([]), files = /** @type {Map<string, Buffer>} */ (new Map());
  const server = createServer(async (req, res) => {
    if (!opts.up) { req.socket.destroy(); return; }   // no signal: the connection just drops
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    if (path.startsWith('..')) { res.writeHead(400).end(); return; }
    if (path === '' || path.endsWith('/')) path += 'index.html';
    asked.push(path);
    try {
      if (path === 'precache.json') { res.writeHead(200, { 'content-type': TYPES['.json'] }).end(await precacheList(opts.api, opts.build, opts.look)); return; }
      if (path === 'lab/offline.json') { res.writeHead(200, { 'content-type': TYPES['.json'] }).end(await labList(opts.api, opts.build)); return; }
      // like stage.mjs: an app route without its own page gets the shell
      if (!existsSync(join(ROOT, path)) && APP_ROUTES.some(r => path === `${r}/index.html`)) path = 'index.html';
      const body = files.get(path.replace(TAGGED, 'look/')) ?? await staged(path, opts.api, opts.build, opts.look);
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
  /** Files served as if they were in frontend/ (path → bytes; the look's by their source path, look/…): a
   * test's own daily pictures and their list, which the repository does not hold yet. */
  server.files = files;
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.env.PORT) || 8080, { look: '' });
  console.log(`http://127.0.0.1:${server.address().port}`);
}
