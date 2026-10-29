// What the site needs at deploy but the repository doesn't hold: config.js (API address, build,
// commit, repository address) and the API host in the CSP's connect-src of the shell and the
// sign-in pages (SECURITY.md §4.1). Used by stage.mjs for real and by serve.mjs for the tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UI = fileURLToPath(new URL('../frontend/ui/', import.meta.url));
const SHELL = readFileSync(`${UI}csp.txt`, 'utf8').trim();
const SIGNIN = readFileSync(`${UI}csp-signin.txt`, 'utf8').trim();

/** App routes without a page of their own: each gets a copy of the shell (storage hosting has no
 * SPA fallback). An existing page (e.g. astra/) is never overwritten. */
export const APP_ROUTES = ['music', 'guitar', 'podcasts', 'media', 'study', 'settings', 'settings/password', 'settings/agents', 'settings/devices'];

/** The content type of every file kind the site may hold. stage.mjs refuses any other kind, and
 * deploy.sh uploads each kind with exactly this type, so nothing depends on the uploader guessing
 * (a guessed gzip content-encoding would break the player's own decompression of `.json.gz`). */
export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.wasm': 'application/wasm', '.gz': 'application/gzip',
};

/** The API's origin, checked: https only (plain http only for a local test host). */
export function apiOrigin(raw) {
  if (!raw) return '';
  const u = new URL(raw);
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error(`API address must be https: ${raw}`);
  return u.origin;
}

/** @param {{ api?: string, build?: number, commit?: string, repo_url?: string }} c */
export function configJs({ api = '', build = 0, commit = 'dev', repo_url = '' } = {}) {
  const value = { api: apiOrigin(api), build, commit, repo_url };
  return `// Written by scripts/stage.mjs at deploy. Public values only.\nexport const CONFIG = ${JSON.stringify(value)};\n`;
}

/** Adds the API host to the CSP of the shell and sign-in pages; other pages are left alone. */
export function withApi(html, api) {
  const origin = apiOrigin(api);
  if (!origin) return html;
  return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/, (m, a, csp, b) => {
    if (csp === SHELL) return a + csp.replace("connect-src 'self'", `connect-src 'self' ${origin}`) + b;
    if (csp === SIGNIN) return a + csp.replace("connect-src 'none'", `connect-src ${origin}`) + b;
    return m;
  });
}
