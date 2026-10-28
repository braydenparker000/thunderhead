// Serves frontend/ for local checks and the browser tests the way the Azure Storage static
// website does: files as they are, index.html for folders, 404.html (status 404) for anything
// missing. Like Azure, it sends no security headers; the pages carry their CSP in a <meta> tag.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { APP_ROUTES, configJs, withApi } from './site-config.mjs';

const ROOT = fileURLToPath(new URL('../frontend/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

/** `api`: serve the site as staged for that API address (config.js and CSP), for the tests. */
export function serve(port = 0, { api = '' } = {}) {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    if (path.startsWith('..')) { res.writeHead(400).end(); return; }
    if (path === '' || path.endsWith('/')) path += 'index.html';
    try {
      if (api && path === 'config.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }).end(configJs({ api })); return; }
      // like stage.mjs: an app route without its own page gets the shell
      if (!existsSync(join(ROOT, path)) && APP_ROUTES.some(r => path === `${r}/index.html`)) path = 'index.html';
      let body = await readFile(join(ROOT, path));
      if (api && path.endsWith('.html')) body = withApi(body.toString('utf8'), api);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(ROOT, '404.html')));
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.env.PORT) || 8080);
  console.log(`http://127.0.0.1:${server.address().port}`);
}
