// The service worker's release list, the safe-update rule, the icon sprite, the install manifest
// and its Background Fetch handlers for Photos (a vm harness), without a browser (ARCHITECTURE.md
// §8, DESIGN-SYSTEM.md §13, PHOTOS.md §3.1, TESTING.md §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { APP_ROUTES, PORTED, precached, swJs } from '../scripts/site-config.mjs';
import { buildSprite } from '../scripts/icons.mjs';
import { checkDue, safeNow, safeToApply, safeWhenHidden, CHECK_EVERY_MS } from '../frontend/th/update-rules.js';
import { loadWorker } from './fixtures/sw-harness.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(REPO, 'frontend');

test('precache.json leaves out lab/, vendor/, Photos\' RAW engine, the route stubs, the ported folders and the worker scripts', () => {
  for (const p of ['index.html', 'signin/index.html', 'setup/setup.js', 'ui/icons.svg', 'config.js', 'manifest.webmanifest', '.well-known/change-password/index.html'])
    assert.ok(precached(p), p);
  for (const p of ['lab/feel/panel.js', 'lab/feel/panel.css', 'lab/stream/index.html', 'photos/engine/photos_engine.js', 'photos/engine/photos_engine_bg.wasm', 'vendor/x-1/x.js', 'music/index.html', 'astra/sw.js', 'assets/config.js', 'sw.js', 'sw-kill.js', 'precache.json', 'ui/csp.txt', ...APP_ROUTES.map((r) => `${r}/index.html`)])
    assert.ok(!precached(p), p);
});

test('sw.js and site-config.mjs name the same ported folders', () => {
  const sw = readFileSync(join(SITE, 'sw.js'), 'utf8');
  const list = JSON.parse(/const PORTED = (\[[^\]]*\]);/.exec(sw)[1].replaceAll("'", '"'));
  assert.deepEqual(list, PORTED.map((p) => `/${p}/`));
  // every shell route the worker answers with the shell is a stubbed route (or home)
  const shell = JSON.parse(/const SHELL = (\[[^\]]*\]);/.exec(sw)[1].replaceAll("'", '"'));
  for (const r of shell) if (r !== '/') assert.ok(APP_ROUTES.includes(r.slice(1, -1)) && !PORTED.includes(r.slice(1, -1)), r);
});

test('stage writes the build into sw.js and a precache list whose sizes match the staged files', () => {
  assert.throws(() => swJs('nothing here', 3));
  assert.match(swJs('const BUILD = 0;\nx', 412), /^const BUILD = 412;$/m);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  execFileSync(process.execPath, ['scripts/stage.mjs', sha], { cwd: REPO, env: { ...process.env, WORKER_URL: 'https://thunderhead-api.example.workers.dev' }, stdio: 'pipe' });
  const out = join(REPO, '.deploy/site');
  const { build, files } = JSON.parse(readFileSync(join(out, 'precache.json'), 'utf8'));
  assert.ok(build > 0);
  assert.match(readFileSync(join(out, 'sw.js'), 'utf8'), new RegExp(`^const BUILD = ${build};$`, 'm'));
  assert.match(readFileSync(join(out, 'config.js'), 'utf8'), new RegExp(`"build":${build}`));
  assert.ok(files.length > 20);
  for (const { path, size, hash } of files) {
    assert.ok(precached(path), path);
    assert.equal(statSync(join(out, path)).size, size, path);
    assert.equal(hash, createHash('sha256').update(readFileSync(join(out, path))).digest('hex'), `${path}: its hash, so a later release copies it unchanged`);
  }
  for (const page of ['index.html', 'signin/index.html', 'setup/index.html', 'recover/index.html', '404.html'])
    assert.ok(files.some((f) => f.path === page), page);
  assert.ok(!files.some(f => f.path.startsWith('lab/')), 'labs never enter the offline boot cache');
  // Compare every staged path with the pre-T1b membership rule, allowing only lab/ and Photos' RAW
  // engine (photos/engine/, 2.2 MB, needed only with the network: site-config.mjs) to leave, and
  // (2026-11-20) look/, Ink and Lamp, off unless chosen and kept for good once loaded (sw.js).
  const before = path => !['vendor', ...PORTED].includes(path.split('/')[0])
    && !APP_ROUTES.some(r => path === `${r}/index.html`)
    && !['sw.js', 'sw-kill.js', 'precache.json'].includes(path) && !path.endsWith('.txt');
  const paths = readdirSync(out, { recursive: true }).filter(path => statSync(join(out, path)).isFile());
  assert.deepEqual(files.map(f => f.path).sort(), paths.filter(path => before(path) && !path.startsWith('lab/') && !path.startsWith('photos/engine/') && !path.startsWith('look/')).sort(), 'all other precache members stay');
});

test('an update applies only when nothing plays, nothing is typed and nothing is open', () => {
  const calm = { visible: true, playing: false, typing: false, overlay: false, written: false, busy: false };
  assert.equal(safeToApply(calm), true);
  for (const key of ['playing', 'typing', 'overlay', 'busy']) assert.equal(safeToApply({ ...calm, [key]: true }), false, key);
  assert.equal(safeToApply({ ...calm, visible: false }), false);
  assert.equal(checkDue(0, CHECK_EVERY_MS - 1), false);
  assert.equal(checkDue(0, CHECK_EVERY_MS), true);
});

test('out of view is the safest moment, but never over something under way, playing or written', () => {
  const away = { visible: false, playing: false, typing: false, overlay: false, written: false, busy: false };
  assert.equal(safeWhenHidden(away), true);
  assert.equal(safeNow(away), true, 'a page out of view applies the waiting update');
  assert.equal(safeNow({ ...away, typing: true }), true, 'a field with focus and no text holds nothing to lose');
  for (const key of ['playing', 'written', 'overlay', 'busy']) {
    assert.equal(safeWhenHidden({ ...away, [key]: true }), false, key);
    assert.equal(safeNow({ ...away, [key]: true }), false, key);
  }
  assert.equal(safeNow({ ...away, visible: true, typing: true }), false, 'in view, focus in a field still waits');
});

test('what the shell counts as under way is each place\'s real class: memo, picked files, dictation, Remind, an old conversation, a place but home', () => {
  const update = readFileSync(join(SITE, 'th/update.js'), 'utf8');
  const busy = /const BUSY = '([^']+)';/.exec(update)[1].split(',').map((s) => s.trim());
  assert.deepEqual(busy, ['#ask.recording', '#ask.hasfiles', '#ask.listening', '#ask.finishing', '.remind', '#home.pastview', '#home[inert]']);
  assert.match(update, /busy: document\.querySelector\(BUSY\) !== null/);
  const where = {
    'th/attach/memo.js': /ask\.classList\.add\('recording'\)/,
    'th/attach/tray.js': /ask\.classList\.toggle\('hasfiles'/,
    'th/dictate/mic.js': /ask\.classList\.toggle\('listening'[\s\S]*ask\.classList\.toggle\('finishing'/,
    'th/attach/remind.js': /sheet\.className = 'remind'/,
    'th/convos/past.js': /home\.classList\.add\('pastview'\)/,
    'apps/home/home.js': /home\.inert=view!=='home'/,
  };
  for (const [file, set] of Object.entries(where)) assert.match(readFileSync(join(SITE, file), 'utf8'), set, file);
  // a stopped memo becomes a picked file (so #ask.hasfiles holds it until it is sent)
  assert.match(readFileSync(join(SITE, 'th/attach/memo.js'), 'utf8'), /add\(\[\{ id: uuidv7\(\), name, type/);
  // the page going out of view tries the waiting update
  assert.match(update, /visibilityState !== 'visible'\) return void tryApply\(\)/);
});

test('the kill switch clears th-* caches and unregisters (OPERATIONS.md §3.3)', () => {
  const kill = readFileSync(join(SITE, 'sw-kill.js'), 'utf8');
  assert.match(kill, /startsWith\('th-'\)/);
  assert.match(kill, /registration\.unregister\(\)/);
});

test('ui/icons.svg is built from ui/icons.txt, within budget, and the shell draws no inline paths', () => {
  const sprite = readFileSync(join(SITE, 'ui/icons.svg'), 'utf8');
  assert.equal(sprite, buildSprite(), 'ui/icons.svg is stale: run node scripts/icons.mjs');
  // The same measured budget as scripts/stage.mjs (2026-11-04, Photos: star, star-fill, flag, prohibit).
  assert.ok(Buffer.byteLength(sprite) <= 36_043, `sprite is ${Buffer.byteLength(sprite)} bytes`);
  for (const f of ['index.html', 'apps/home/home.js'])
    assert.doesNotMatch(readFileSync(join(SITE, f), 'utf8'), /<path\b/, `${f} still draws an inline icon`);
  for (const [, name] of readFileSync(join(SITE, 'index.html'), 'utf8').matchAll(/icons\.svg#([a-z-]+)/g))
    assert.match(sprite, new RegExp(`<symbol id="${name}"`), name);
});

test('the install manifest has scope /, and every icon it names exists', () => {
  const m = JSON.parse(readFileSync(join(SITE, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.scope, '/');
  assert.equal(m.start_url, '/');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(SITE, i.src)), i.src);
  for (const page of ['index.html', 'signin/index.html', 'setup/index.html', 'recover/index.html'])
    assert.match(readFileSync(join(SITE, page), 'utf8'), /<link rel="manifest" href="\/manifest.webmanifest">/, page);
});

// Photos' background uploads (PHOTOS.md §3.1, SECURITY.md §10): the worker sends the Worker the
// Drive id alone, with this phone's session; the notification names the file and nothing else.
const PHOTO = '019a0000-0000-7000-8000-0000000000b1';
const KEPT = { id: PHOTO, session: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=s9', name: 'DSCF0400.RAF', size: 1000, at: 1 };
function photosWorker({ patch = 200 } = {}) {
  const w = loadWorker(async (url, init) => {
    if (url === '/config.js') return new Response('export const CONFIG = {"api":"https://api.example.test"};');
    if (url === `https://api.example.test/v1/photos/${PHOTO}` && init.method === 'PATCH')
      return new Response(JSON.stringify({ photo: { id: PHOTO, drive_id: JSON.parse(init.body).drive_id } }), { status: patch });
    return new Response('{}', { status: 404 });
  });
  w.dbs.set('th-auth', new Map([['session', { token: 'th1_example-session' }]]));
  w.dbs.set('th-photos', new Map([[`bg:${PHOTO}`, KEPT]]));
  return w;
}
const ended = (status, body, id = PHOTO) => {
  const ui = [];
  return {
    ui,
    event: {
      registration: { id, matchAll: async () => [{ responseReady: Promise.resolve(new Response(body, { status })) }] },
      updateUI: async (o) => { ui.push(structuredClone(o)); },
    },
  };
};

test('a background upload that ends in Drive: its Drive id to the Worker, the notification says so, the page is told', async () => {
  const w = photosWorker();
  const { event, ui } = ended(200, JSON.stringify({ id: 'drive-file-9' }));
  await w.dispatch('backgroundfetchsuccess', event);
  const call = w.fetched.find((f) => f.method === 'PATCH');
  assert.equal(call.url, `https://api.example.test/v1/photos/${PHOTO}`);
  assert.equal(call.headers.Authorization, 'Bearer th1_example-session');
  assert.deepEqual(JSON.parse(call.body), { drive_id: 'drive-file-9' }, 'the Drive id, nothing else');
  assert.ok(!w.fetched.some((f) => f.url.includes('googleapis')), 'nothing goes to Drive from the worker');
  assert.deepEqual(ui, [{ title: 'In Drive: DSCF0400.RAF' }]);
  assert.equal(w.dbs.get('th-photos').has(`bg:${PHOTO}`), false, 'the session is forgotten');
  assert.deepEqual(w.told, [{ type: 'photos:upload', id: PHOTO, state: 'done', photo: { id: PHOTO, drive_id: 'drive-file-9' } }]);
});

test('a PATCH that does not go through keeps the Drive id for the page to finish', async () => {
  const w = photosWorker({ patch: 503 });
  await w.dispatch('backgroundfetchsuccess', ended(201, JSON.stringify({ id: 'drive-file-9' })).event);
  assert.deepEqual(w.dbs.get('th-photos').get(`bg:${PHOTO}`), { ...KEPT, drive_id: 'drive-file-9' });
  assert.equal(w.told[0].state, 'kept');
});

test('a failed, aborted or part-way (308) upload keeps its session and says it did not upload', async () => {
  for (const [type, status] of [['backgroundfetchfail', 500], ['backgroundfetchsuccess', 308], ['backgroundfetchabort', 0]]) {
    const w = photosWorker();
    const { event, ui } = ended(status || 200, '');
    await w.dispatch(type, event);
    assert.ok(!w.fetched.some((f) => f.method === 'PATCH'), `${type}: no PATCH`);
    assert.deepEqual(w.dbs.get('th-photos').get(`bg:${PHOTO}`), { ...KEPT, failed: true }, `${type}: the session kept`);
    assert.deepEqual(ui, type === 'backgroundfetchabort' ? [] : [{ title: 'Did not upload: DSCF0400.RAF' }], type);
    assert.deepEqual(w.told, [{ type: 'photos:upload', id: PHOTO, state: 'failed' }], type);
  }
});

test('a fetch that is not a photo\'s upload is left alone; a tap on its notification opens Photos', async () => {
  const w = photosWorker();
  await w.dispatch('backgroundfetchsuccess', ended(200, JSON.stringify({ id: 'x' }), 'something-else').event);
  assert.equal(w.fetched.length, 0);
  assert.equal(w.told.length, 0);
  assert.ok(w.listeners.has('backgroundfetchclick'));
});

// A release fetches only what changed (ARCHITECTURE.md §8.2): /precache.json lists each file with its size and
// hash; a file the release before kept whole has with the same hash is copied from its cache.
const sha = (s) => createHash('sha256').update(s).digest('hex');
function release(build, bodies, { short = '' } = {}) {
  const list = { build, files: Object.entries(bodies).map(([path, body]) => ({ path, size: Buffer.byteLength(body), hash: sha(body) })) };
  return async (url) => {
    if (url === '/precache.json') return new Response(JSON.stringify(list));
    const path = url.slice(1);
    if (!(path in bodies)) return new Response('missing', { status: 404 });
    return new Response(path === short ? bodies[path].slice(0, -1) : bodies[path]);
  };
}
const ONE = { 'index.html': '<!doctype html>one', 'th/a.js': 'export const a = 1;', 'config.js': 'export const CONFIG = {"build":1};' };
const TWO = { ...ONE, 'th/a.js': 'export const a = 2;', 'config.js': 'export const CONFIG = {"build":2};' };

test('a second release fetches only its changed files and copies the rest from the release before', async () => {
  const first = loadWorker(release(1, ONE), { build: 1 });
  await first.dispatch('install', {});
  assert.deepEqual(first.fetched.map((f) => f.url).sort(), ['/config.js', '/index.html', '/precache.json', '/th/a.js']);
  const second = loadWorker(release(2, TWO), { build: 2 });
  for (const [name, map] of first.stores) second.stores.set(name, map);
  await second.dispatch('install', {});
  assert.deepEqual(second.fetched.map((f) => f.url).sort(), ['/config.js', '/precache.json', '/th/a.js'], 'index.html came from th-1');
  const kept = second.stores.get('th-2');
  for (const [path, body] of Object.entries(TWO)) assert.equal(Buffer.from(kept.get(`/${path}`).bytes).toString(), body, path);
  assert.ok(kept.has('/precache.json'), 'the list goes in last, saying the release is whole');
});

test('a copy whose bytes are not the listed size is fetched; a half-uploaded file still fails the install whole', async () => {
  const first = loadWorker(release(1, ONE), { build: 1 });
  await first.dispatch('install', {});
  first.stores.get('th-1').get('/index.html').bytes = new TextEncoder().encode('<!doctype html>on');
  const second = loadWorker(release(2, TWO), { build: 2 });
  second.stores.set('th-1', first.stores.get('th-1'));
  await second.dispatch('install', {});
  assert.ok(second.fetched.some((f) => f.url === '/index.html'), 'the short copy is not trusted');
  const broken = loadWorker(release(2, TWO, { short: 'th/a.js' }), { build: 2 });
  broken.stores.set('th-1', first.stores.get('th-1'));
  await assert.rejects(broken.dispatch('install', {}), /\/th\/a\.js: 200, 18 of 19 bytes/);
  assert.ok(!broken.stores.get('th-2')?.has('/precache.json'), 'a failed install never says it is whole');
});

test('config.js comes from the release\'s cache, never waiting on the network; release.json is read fresh', async () => {
  const w = loadWorker(release(1, ONE), { build: 1 });
  await w.dispatch('install', {});
  w.fetched.length = 0;
  const ask = async (path) => {
    let answer;
    w.listeners.get('fetch')({ request: new Request(`https://site.example.test${path}`), respondWith: (p) => { answer = p; } });
    return answer;
  };
  assert.equal(await (await ask('/config.js')).text(), ONE['config.js']);
  assert.deepEqual(w.fetched, [], 'no network for config.js');
  await ask('/release.json').catch(() => {});
  assert.equal(w.fetched[0]?.url, 'https://site.example.test/release.json');
  assert.doesNotMatch(readFileSync(join(SITE, 'sw.js'), 'utf8'), /FRESH = \[[^\]]*config\.js/);
});

test('a subscription the push service replaced is made again with the same key and sent with the session', async () => {
  const w = loadWorker(async (url, init) => {
    if (url === '/config.js') return new Response('export const CONFIG = {"api":"https://api.example.test"};');
    return new Response(null, { status: url === 'https://api.example.test/v1/push/subscription' && init.method === 'PUT' ? 204 : 404 });
  });
  w.dbs.set('th-auth', new Map([['session', { token: 'th1_example-session' }]]));
  const key = new Uint8Array([4, 1, 2, 3]).buffer, asked = [];
  w.self.registration.pushManager = {
    subscribe: async (o) => { asked.push(o); return { toJSON: () => ({ endpoint: 'https://push.example.test/new', keys: { p256dh: 'BNew', auth: 'fresh' } }) }; },
  };
  await w.dispatch('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } } });
  assert.equal(asked[0].applicationServerKey, key);
  assert.equal(asked[0].userVisibleOnly, true);
  const put = w.fetched.find((f) => f.method === 'PUT');
  assert.equal(put.url, 'https://api.example.test/v1/push/subscription');
  assert.equal(put.headers.Authorization, 'Bearer th1_example-session');
  assert.deepEqual(JSON.parse(put.body), { endpoint: 'https://push.example.test/new', keys: { p256dh: 'BNew', auth: 'fresh' } });
});
