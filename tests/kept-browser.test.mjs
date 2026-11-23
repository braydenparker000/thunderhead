// A sign-out nobody chose keeps the owner's unsent work (th/kept.js, SIGN-IN.md §11.3): for `expired` and
// `unauthorized` only, the outbox and the draft are copied to `th-kept` under the username before the wipe,
// come back at that owner's next sign-in (sign-in, recovery, setup) and are dropped unread when someone else
// signs in, or after 30 days. A revocation, an unknown reason and a sign-out by hand keep nothing; a sign-out
// by hand wins any race; one wipe runs at a time; nothing writes `th-data` once a wipe has begun. In Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const MSG = { id: '0190a000-0000-7000-8000-000000000001', body: 'An invented thought written on the bus', created_at: 1, state: 'queued', tries: 0 };
const MSG2 = { id: '0190a000-0000-7000-8000-000000000002', body: 'And a second one', created_at: 2, state: 'queued', tries: 0 };
const DAY = 86_400_000;

/** A page signed in as `username` with `outbox` waiting and a draft in the bar. */
async function seeded({ username = 'example-owner', outbox = [MSG], draft = 'half a sentence', page = null, init = null } = {}) {
  if (!page) {
    page = await browser.newPage({ serviceWorkers: 'block' });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    if (init) await page.addInitScript(init);
  }
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(async ([u, box, d]) => {
    const { kv } = await import('/th/idb.js');
    await kv('th-auth').set('session', { session_id: 's1', token: 't', signed_in_at: Date.now(), ...(u ? { username: u } : {}) });
    for (const m of box) await kv('th-data').set(`chat.outbox.${m.id}`, m);
    await kv('th-data').set('chat.cache', { seq: 1 });
    if (d) localStorage.setItem('th.p.draft', d);
  }, [username, outbox, draft]);
  return page;
}

/** What the phone holds now. */
const holds = (page) => page.evaluate(async () => {
  const { kv } = await import('/th/idb.js');
  const dbs = (await indexedDB.databases()).map((d) => d.name);
  return {
    dbs,
    outbox: dbs.includes('th-data') ? await kv('th-data').list('chat.outbox.') : [],
    draft: localStorage.getItem('th.p.draft'),
    kept: (await kv('th-kept').get('unsent')) ?? null,
  };
});

/** Starts a signed-in call that the server answers 401 `code` (with `reason`); not awaited, as the page leaves. */
const answer401 = (page, code, reason) => page.evaluate(([c, r]) => {
  globalThis.__401 = (async () => {
    const [{ signedIn }, { ApiError }] = await Promise.all([import('/th/client.js'), import('/th/api.js')]);
    return signedIn(() => { throw new ApiError(401, { code: c, message: c, ...(r ? { details: { reason: r } } : {}) }); });
  })();
}, [code, reason ?? null]);
async function forcedOut(page, code = 'session_expired', reason) {
  await answer401(page, code, reason);
  await page.waitForURL(/\/signin\//);
}

const signIn = (page, username) => page.evaluate((u) => import('/th/session.js').then((m) => m.store.write({ session_id: 's2', token: 't2', signed_in_at: Date.now(), username: u })), username);

test('expired: the outbox and draft are kept, and come back to the same owner at sign-in', opts, async () => {
  const page = await seeded();
  await forcedOut(page, 'session_expired');
  let now = await holds(page);
  assert.ok(!now.dbs.includes('th-data') && !now.dbs.includes('th-auth'), 'the rest is wiped');
  assert.equal(now.draft, null, 'the draft is not in the bar while signed out');
  assert.deepEqual(now.kept.outbox, [MSG]);
  await signIn(page, ' Example-Owner ');
  now = await holds(page);
  assert.deepEqual(now.outbox, [MSG], 'back in the outbox, to send');
  assert.equal(now.draft, 'half a sentence');
  assert.ok(!now.dbs.includes('th-kept'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('each reason: kept only for expired and unauthorized; every revocation and an unknown reason keep nothing', opts, async () => {
  const cases = [
    ['session_expired', null, true], ['unauthorized', null, true],
    ...['signed_out_here', 'signed_out_elsewhere', 'password_changed', 'recovery_used', 'reset_used', 'device_limit', 'a_new_reason', null].map((r) => ['session_revoked', r, false]),
  ];
  for (const [code, reason, keeps] of cases) {
    const page = await seeded();
    await forcedOut(page, code, reason);
    const now = await holds(page);
    assert.equal(now.kept !== null, keeps, `${code} ${reason}`);
    assert.ok(!now.dbs.includes('th-data'), `${code} ${reason}: th-data wiped`);
    if (!keeps) assert.ok(!now.dbs.includes('th-kept'), `${code} ${reason}: nothing kept`);
    await page.close();
  }
});

test('a session with no username keeps nothing', opts, async () => {
  const page = await seeded({ username: null });
  await forcedOut(page, 'session_expired');
  assert.ok(!(await holds(page)).dbs.includes('th-kept'));
  await page.close();
});

test('someone else signing in on this phone never gets it', opts, async () => {
  const page = await seeded();
  await forcedOut(page);
  await signIn(page, 'another-person');
  const now = await holds(page);
  assert.deepEqual(now.outbox, []);
  assert.equal(now.draft, null);
  assert.ok(!now.dbs.includes('th-kept'), 'dropped unread');
  await page.close();
});

test('a sign-out by hand removes the unsent work and anything kept', opts, async () => {
  const page = await seeded();
  await page.evaluate(() => import('/th/idb.js').then(({ kv }) => kv('th-kept').set('unsent', { owner: 'example-owner', outbox: [], draft: 'older', at: Date.now() })));
  await page.evaluate(() => import('/th/session.js').then((m) => m.wipe()));
  const now = await holds(page);
  assert.equal(now.draft, null);
  assert.ok(!now.dbs.includes('th-kept') && !now.dbs.includes('th-data'));
  await page.close();
});

test('a sign-out by hand that starts while a kept-worthy wipe is half done still keeps nothing', opts, async () => {
  // The first wipe stops at its push step until the sign-out by hand has begun.
  const page = await seeded({
    init: () => {
      const sw = navigator.serviceWorker, real = sw.getRegistration.bind(sw);
      let first = true;
      globalThis.__gate = new Promise((r) => { globalThis.__open = r; });
      sw.getRegistration = (...a) => (first ? ((first = false), (globalThis.__gated = true), globalThis.__gate.then(() => real(...a))) : real(...a));
    },
  });
  await answer401(page, 'unauthorized');
  await page.waitForFunction(() => globalThis.__gated === true);
  await page.evaluate(async () => {
    const { wipe } = await import('/th/session.js');
    globalThis.__hand = wipe();
    globalThis.__open();
  });
  await page.waitForURL(/\/signin\//);
  await until(async () => !(await holds(page)).dbs.includes('th-auth'), { message: 'signed out' });
  assert.ok(!(await holds(page)).dbs.includes('th-kept'), 'nothing kept');
  await page.close();
});

test('inside home with the socket open: Sign out, and the 401 its revocation brings, keep nothing', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  let out = false, meOut = 0;
  const api = await mockApi(page, { me: () => (out && ++meOut ? [401, { error: { code: 'unauthorized', message: 'x', request_id: 't' } }] : [200, { session_id: 's1', label: 'Phone', notices: [], recovery_confirmed: true }]) });
  // The server revokes, closes the socket at once (4401), and answers the sign-out a moment later.
  let answered = false;
  await page.route(`${API}/v1/auth/signout`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    out = true;
    for (const ws of api.state.chat.sockets) ws.close({ code: 4401, reason: 'revoked' });
    await until(() => meOut > 0, { message: 'the socket’s bye reached /me' }).catch(() => {});
    answered = true;
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });
  await seeded({ page, outbox: [{ ...MSG, state: 'failed', tries: 4 }] });
  await page.evaluate((token) => import('/th/idb.js').then(({ kv }) => kv('th-auth').set('session', { session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' })), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await until(() => api.state.chat.sockets.length > 0, { message: 'the socket is open' });
  page.evaluate(() => import('/th/client.js').then((m) => m.signOutHere())).catch(() => {});
  // Both the sign-out and the 401 leave for /signin/; whichever lands, wait for it to settle there.
  await until(async () => /\/signin\//.test(page.url()) && (await holds(page).then((h) => !h.dbs.includes('th-auth'), () => false)), { message: 'signed out, on /signin/' });
  await page.waitForLoadState('load');
  assert.ok(answered);
  assert.ok(meOut > 0, 'the socket’s bye asked /me, which answered 401 unauthorized beside the sign-out');
  const now = await holds(page);
  assert.ok(!now.dbs.includes('th-kept'), 'nothing kept');
  assert.ok(!now.dbs.includes('th-data'));
  await context.close();
});

test('two 401s at once keep the whole copy, and never replace a fuller one with less', opts, async () => {
  const page = await seeded({ outbox: [MSG2] });
  // An earlier kept record of this owner holds MSG; this wipe adds MSG2 and keeps both.
  await page.evaluate((m) => import('/th/idb.js').then(({ kv }) => kv('th-kept').set('unsent', { owner: 'example-owner', outbox: [m], draft: null, at: Date.now() })), MSG);
  await page.evaluate(async () => {
    const [{ signedIn }, { ApiError }] = await Promise.all([import('/th/client.js'), import('/th/api.js')]);
    const no = () => { throw new ApiError(401, { code: 'session_expired', message: 'x' }); };
    signedIn(no);
    signedIn(no);
  });
  await page.waitForURL(/\/signin\//);
  await until(async () => !(await holds(page)).dbs.includes('th-auth'), { message: 'signed out' });
  const { kept } = await holds(page);
  assert.deepEqual(kept.outbox.map((m) => m.id).sort(), [MSG.id, MSG2.id]);
  assert.equal(kept.draft, 'half a sentence');
  await page.close();
});

test('a copy whose files cannot be written keeps the words and the draft', opts, async () => {
  const page = await seeded({
    init: () => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v, k) {
        if (this.transaction.db.name === 'th-kept' && v?.outbox?.some((m) => m.files)) throw new DOMException('no room', 'QuotaExceededError');
        return put.call(this, v, k);
      };
    },
    outbox: [],
  });
  await page.evaluate(async (m) => {
    const { kv } = await import('/th/idb.js');
    await kv('th-data').set(`chat.outbox.${m.id}`, { ...m, files: [{ id: 'f1', name: 'a.jpg', blob: new Blob([new Uint8Array(8)]) }] });
    await kv('th-data').set('chat.outbox.0190a000-0000-7000-8000-000000000003', { id: '0190a000-0000-7000-8000-000000000003', body: '', files: [{ id: 'f2', blob: new Blob([]) }] });
  }, MSG);
  await forcedOut(page);
  const { kept } = await holds(page);
  assert.deepEqual(kept.outbox, [MSG], 'the words without their files; a photo alone goes');
  assert.equal(kept.draft, 'half a sentence');
  await page.close();
});

test('a kept record over 30 days old is dropped unread at the next page start', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(([m, day]) => import('/th/idb.js').then(({ kv }) => kv('th-kept').set('unsent', { owner: 'example-owner', outbox: [m], draft: 'x', at: Date.now() - 31 * day })), [MSG, DAY]);
  await page.goto(`${base}/signin/`);
  await until(async () => !(await holds(page)).dbs.includes('th-kept'), { message: 'dropped at the start' });
  // One of 29 days stays.
  await page.evaluate(([m, day]) => import('/th/idb.js').then(({ kv }) => kv('th-kept').set('unsent', { owner: 'example-owner', outbox: [m], draft: 'x', at: Date.now() - 29 * day })), [MSG, DAY]);
  await page.reload();
  await page.evaluate(() => import('/th/session.js'));
  assert.ok((await holds(page)).kept);
  await page.close();
});

test('once a wipe has begun, an outbox write in this page never makes th-data again', opts, async () => {
  const page = await seeded();
  await page.evaluate(async (m) => {
    const [{ wipe }, { outbox }] = await Promise.all([import('/th/session.js'), import('/th/chat/store.js')]);
    const during = outbox.put({ ...m, id: `${m.id.slice(0, -1)}9` }).catch(() => {});
    await wipe();
    await during;
    await outbox.put(m).catch(() => {});
  }, MSG);
  assert.ok(!(await holds(page)).dbs.includes('th-data'));
  await page.close();
});

for (const path of ['recover', 'setup']) {
  test(`the ${path} sign-in gives the kept work back to the same owner`, opts, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await mockApi(page, path === 'setup' ? { setup: 'open', setup_fp: 'ready' } : {});
    await page.goto(`${base}/no-such-page`);
    await page.evaluate((m) => import('/th/idb.js').then(({ kv }) => kv('th-kept').set('unsent', { owner: 'example-owner', outbox: [m], draft: 'half a sentence', at: Date.now() })), MSG);
    await page.goto(`${base}/${path}/`);
    if (path === 'recover') {
      await page.fill('#username', 'example-owner');
      await page.fill('#code', '7kq2m xw4tr 9dhpa 3nb6e qy8vc');
      await page.fill('#new-password', 'another long example passphrase');
      await page.click('#go');
    } else {
      await page.waitForFunction(() => document.querySelector('#fp')?.textContent !== '…');
      await page.click('#done');
      await page.waitForSelector('#s2:not([hidden])');
      await page.fill('#username', 'example-owner');
      await page.fill('#new-password', 'a long example passphrase');
      await page.click('#create');
    }
    await page.waitForSelector('#recovery-code');
    const now = await holds(page);
    assert.deepEqual(now.outbox, [MSG]);
    assert.equal(now.draft, 'half a sentence');
    assert.ok(!now.dbs.includes('th-kept'));
    await page.close();
  });
}
