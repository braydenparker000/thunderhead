// Starts the real Worker under `wrangler dev --local` (workerd with local SQLite Durable Objects)
// on a free port with synthetic secrets, for th's end-to-end test (RUNTIME.md §5.3 acceptance).
// Everything is throwaway: a temp state dir and env file, removed on stop. Synthetic values only;
// the setup code is the backend's test fixture (backend/tests/fixtures.ts).
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const BACKEND = fileURLToPath(new URL('../../backend/', import.meta.url));
export const WRANGLER = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
export const SETUP_CODE = '0123456789ABCDEFGHJKMNPQR';
export const USERNAME = 'example-owner';
export const PASSWORD = 'correct horse battery staple 42';
const DEVICE = {platform: 'Android', browser: 'Chrome', standalone: false};

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); });
});

export const available = () => existsSync(WRANGLER);

/** @returns {Promise<{url: string, call: Function, stop: () => Promise<void>, log: () => string}>} */
export async function startWorker({timeoutMs = 120_000, vars = {}} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'th-e2e-'));
  const envFile = join(dir, '.env');
  writeFileSync(envFile, [
    'AUTH_PEPPER=e2e-pepper-not-a-real-secret-0123456789',
    'IP_HASH_KEY=e2e-ip-hash-key-not-a-real-secret-0123',
    `AUTH_SETUP_FP=thfp_${createHash('sha256').update(SETUP_CODE).digest('base64url')}`,
    'AUTH_RESET_FP=none',
    'ROUTINE_CHAT_URL=none',
    'ROUTINE_CHAT_TOKEN=none',
    'ROUTINE_NIGHT_URL=none',
    'ROUTINE_NIGHT_TOKEN=none',
    'ROUTINE_REFLEX_URL=none',
    'ROUTINE_REFLEX_TOKEN=none',
    'R2_SIGN_ACCESS_KEY_ID=none',
    'R2_SIGN_SECRET=none',
    'MUSIC_UPLOAD_PUBLIC_KEYS=none',
    // A test's own values (e.g. an upload tool's public key) after the defaults: the last one wins.
    ...Object.entries(vars).map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n'));
  const port = await freePort();
  const inspector = await freePort();
  const child = spawn(process.execPath, [WRANGLER, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', String(inspector), '--persist-to', join(dir, 'state'), '--env-file', envFile,
    '--var', 'AUTH_HIBP:off', '--show-interactive-dev-session=false'],
  {cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', CI: '1'}});
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
    }
    rmSync(dir, {recursive: true, force: true});
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) { await stop(); throw new Error(`wrangler dev exited (${child.exitCode}):\n${log.slice(-2000)}`); }
    try { if ((await fetch(`${url}/v1/health`)).status === 200) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { await stop(); throw new Error(`wrangler dev did not start in ${timeoutMs} ms:\n${log.slice(-2000)}`); }
    await new Promise(r => setTimeout(r, 300));
  }
  /** One call to the Worker as the owner's device (or anyone with a token). */
  const call = async (method, path, {token, body} = {}) => {
    const headers = {'CF-Connecting-IP': '192.0.2.77'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();
    return {status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers};
  };
  return {url, call, stop, log: () => log};
}

/** The owner's first device and an agent key per role, as SETUP.md does it by hand. */
export async function setupOwner(w, roles = ['mind:chat']) {
  const setup = await w.call('POST', '/v1/auth/setup', {body: {setup_code: SETUP_CODE, username: USERNAME, password: PASSWORD, device: DEVICE}});
  if (setup.status !== 201) throw new Error(`setup: ${setup.status} ${JSON.stringify(setup.body)}`);
  const device = setup.body.token;
  const keys = {};
  for (const role of roles) {
    const r = await w.call('POST', '/v1/auth/agents', {token: device, body: {name: role.replace(':', '-'), role, current_password: PASSWORD}});
    if (r.status !== 201) throw new Error(`agent ${role}: ${r.status} ${JSON.stringify(r.body)}`);
    keys[role] = r.body.token;
  }
  return {device, keys};
}
