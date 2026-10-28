// Drives the sign-in pages, the shell's sign-in gate and the Settings pages in Chromium at phone
// size against a mocked Worker (tests/fixtures/mock-api.mjs), with the site served as staged for
// that API address. CSP violations show up as console errors, so every test also proves the pages
// fit their CSP. Local only: a live site has no mocked API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, RECOVERY, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open(path, { theme = 'light', mock = {}, session = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(t => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, mock);
  if (session) {
    await page.goto(`${base}/no-such-page`);
    await page.evaluate(([token]) => new Promise((resolve, reject) => {
      const req = indexedDB.open('th-auth', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), [TOKEN]);
    errors.length = 0; // the 404 page used to reach the origin
  }
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { page, errors, api };
}
const session = page => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('th-auth', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => {
    const get = req.result.transaction('kv').objectStore('kv').get('session');
    get.onsuccess = () => { req.result.close(); resolve(get.result ?? null); };
  };
}));

test('sign-in pages load clean in day and night, carry the API in their CSP, and fit a phone', opts, async () => {
  for (const theme of ['light', 'dark']) {
    for (const path of ['/signin/', '/setup/', '/recover/']) {
      const { page, errors } = await open(path, { theme, mock: { setup: path === '/setup/' ? 'open' : 'done' } });
      assert.equal(page.url(), base + path, `${path} stays put`);
      const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
      assert.match(csp, new RegExp(`connect-src ${API.replace(/\./g, '\\.')};`));
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `${path}: no sideways scroll`);
      assert.deepEqual(errors, [], `${path} ${theme}`);
      await page.close();
    }
  }
});

test('the sign-in form is password-manager friendly', opts, async () => {
  const { page } = await open('/signin/');
  assert.equal(await page.getAttribute('#username', 'autocomplete'), 'username');
  assert.equal(await page.getAttribute('#current-password', 'autocomplete'), 'current-password');
  assert.equal(await page.getAttribute('#current-password', 'name'), 'password');
  assert.equal(await page.getAttribute('#current-password', 'minlength'), null, 'no minlength: an old password can always be typed');
  await page.fill('#current-password', 'secret words');
  await page.click('#show');
  assert.equal(await page.getAttribute('#current-password', 'type'), 'text');
  assert.equal(await page.getAttribute('#show', 'aria-pressed'), 'true');
  await page.close();
});

test('a wrong password keeps both fields and selects the password; the third lights Forgot password', opts, async () => {
  const { page, errors, api } = await open('/signin/', { mock: { login: () => [401, { error: { code: 'wrong_username_or_password', message: 'x', request_id: 't' } }] } });
  await page.fill('#username', 'example-owner');
  for (let i = 1; i <= 3; i++) {
    await page.fill('#current-password', 'wrong password number ' + i);
    await page.click('#go');
    await page.waitForFunction(() => document.querySelector('#go').textContent === 'Sign in' && !document.querySelector('#go').disabled);
    assert.equal(await page.textContent('#line'), "That username and password don't match.");
    assert.equal(await page.inputValue('#username'), 'example-owner');
    assert.equal(await page.evaluate(() => { const p = document.querySelector('#current-password'); return p.selectionEnd - p.selectionStart; }), ('wrong password number ' + i).length);
    assert.equal(await page.$eval('#forgot', el => el.classList.contains('hot')), i >= 3);
  }
  const login = api.calls.find(c => c.call === 'POST /v1/auth/login');
  assert.ok(login.body.device && typeof login.body.device === 'object', 'device hints sent');
  assert.match(login.client, /^\d+\.dev$/, 'TH-Client sent');
  assert.deepEqual(errors.filter(e => !/401/.test(e)), []);
  await page.close();
});

test('too many tries count down 3, 2, 1, then Sign in, disabled throughout', opts, async () => {
  const { page } = await open('/signin/', { mock: { login: () => [429, { error: { code: 'rate_limited', message: 'x', request_id: 't', retry_after: 3, scope: 'source' } }] } });
  await page.fill('#username', 'example-owner');
  await page.fill('#current-password', 'some password');
  await page.click('#go');
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 4500) {
    const [text, disabled] = await page.$eval('#go', b => [b.textContent, b.disabled]);
    if (seen.at(-1)?.[0] !== text) seen.push([text, disabled]);
    if (text === 'Sign in') break;
    await page.waitForTimeout(100);
  }
  assert.deepEqual(seen.map(s => s[0]).filter(t => t !== 'Signing in…'), ['Try again in 3 s', 'Try again in 2 s', 'Try again in 1 s', 'Sign in']);
  assert.ok(seen.filter(s => s[0].startsWith('Try')).every(s => s[1]), 'disabled while counting');
  assert.equal(await page.textContent('#line'), 'Too many tries from here. Wait a moment.');
  assert.equal(await page.textContent('#sr'), 'You can try again now.');
  await page.close();
});

test('signing in stores the session and goes to next; an outside next lands on Home', opts, async () => {
  for (const [next, want] of [['/settings/agents/', '/settings/agents/'], ['//evil.example', '/']]) {
    const { page } = await open(`/signin/?next=${encodeURIComponent(next)}`);
    await page.fill('#username', 'example-owner');
    await page.fill('#current-password', 'right password here');
    await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/signin/')), page.click('#go')]);
    assert.equal(new URL(page.url()).pathname, want);
    assert.equal((await session(page))?.token, TOKEN);
    await page.close();
  }
});

test('a signed-out reason shows above the form, with the recovery link where it matters', opts, async () => {
  const { page } = await open('/signin/?reason=password_changed');
  assert.match(await page.textContent('#reason'), /Your password was changed on another device/);
  assert.equal(await page.getAttribute('#reason a', 'href'), '/recover/');
  await page.close();
});

test('Home without a session goes to /signin/ with next; an open setup goes on to /setup/', opts, async () => {
  const { page } = await open('/settings/devices/');
  await page.waitForURL(u => u.pathname === '/signin/');
  assert.equal(new URL(page.url()).searchParams.get('next'), '/settings/devices/');
  await page.close();
  const fresh = await open('/', { mock: { setup: 'open' } });
  await fresh.page.waitForURL(u => u.pathname === '/setup/');
  await fresh.page.close();
});

test('setup: fingerprint, wait for it, create the account, confirm the recovery code', opts, async () => {
  const { page, errors, api } = await open('/setup/', { mock: { setup: 'open', setup_fp: 'missing' } });
  const fp = await page.textContent('#fp');
  assert.match(fp, /^thfp_[A-Za-z0-9_-]{43}$/);
  await page.click('#done');
  await page.waitForFunction(() => /Waiting for the fingerprint/.test(document.querySelector('#wait').textContent));
  api.state.setup_fp = 'ready';
  await page.waitForSelector('#s2:not([hidden])', { timeout: 8000 });
  assert.equal(api.calls.find(c => c.query.includes('fp=')).query, `?fp=${fp}`);
  assert.equal(await page.getAttribute('#new-password', 'autocomplete'), 'new-password');
  await page.fill('#username', 'example-owner');
  await page.fill('#new-password', 'a long example passphrase');
  await page.click('#create');
  await page.waitForSelector('#recovery-code');
  assert.equal(await page.textContent('#recovery-code'), RECOVERY);
  const setup = api.calls.find(c => c.call === 'POST /v1/auth/setup');
  assert.match(setup.body.setup_code, /^[0-9A-HJKMNP-TV-Z]{25}$/);
  const go = page.locator('#s3 button[type=submit]');
  assert.ok(await go.isDisabled());
  await page.fill('#confirm-code', 'qy8vc');
  await go.click();
  await page.waitForSelector('#s4:not([hidden])');
  assert.deepEqual(api.calls.find(c => c.call === 'POST /v1/auth/recovery-code/confirm').body, { last5: 'QY8VC' });
  assert.equal((await session(page))?.token, TOKEN);
  assert.deepEqual(errors, []);
  await page.close();
});

test('recovery with the code signs in and shows the new code once', opts, async () => {
  const { page, api } = await open('/recover/');
  await page.fill('#username', 'example-owner');
  await page.fill('#code', '7kq2m xw4tr 9dhpa 3nb6e qy8vc');
  await page.fill('#new-password', 'another long example passphrase');
  await page.click('#go');
  await page.waitForSelector('#recovery-code');
  assert.equal(api.calls.find(c => c.call === 'POST /v1/auth/recover').body.code, '7KQ2MXW4TR9DHPA3NB6EQY8VC');
  await page.fill('#confirm-code', 'QY8VC');
  await Promise.all([page.waitForURL(u => u.pathname === '/'), page.click('#done button[type=submit]')]);
  await page.close();
});

test('the reset tab shows a fingerprint and the pending time', opts, async () => {
  const usable = Date.now() + 23 * 3_600_000 + 30 * 60_000;
  const { page, errors } = await open('/recover/#reset', { mock: { reset: 'pending', usable_after: usable } });
  await page.waitForFunction(() => /Your reset will be ready/.test(document.querySelector('#rstate').textContent));
  assert.match(await page.textContent('#rstate'), /\(23 h (29|30) min\)\. Any signed-in device can cancel it\./);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a new-device notice sits on Home with the gold edge; Not me signs that device out', opts, async () => {
  const notice = { id: 'n1', kind: 'new_device', created_at: Date.now(), expires_at: null, about_session_id: 's2', args: { label: 'Windows · Edge', region: 'Region', country: 'XX', at: Date.now() } };
  const { page, errors, api } = await open('/', { session: true, mock: { me: () => [200, { session_id: 's1', label: 'Android phone · Chrome', notices: [notice], recovery_confirmed: true }] } });
  await page.waitForSelector('.notice');
  assert.match(await page.textContent('.notice .q'), /^New sign-in: Windows · Edge · Region, XX · today \d\d:\d\d$/);
  assert.ok(await page.$eval('#edge', e => e.classList.contains('gold')));
  await page.waitForTimeout(300);
  await page.click('.notice button.yes');
  await page.waitForFunction(() => !document.querySelector('.notice') || document.querySelector('.notice').classList.contains('gone'));
  assert.deepEqual(api.calls.find(c => c.call === 'POST /v1/auth/notices/n1/ack').body, { answer: 'not_me' });
  assert.equal(api.calls.find(c => c.call === 'GET /v1/auth/me').auth, `Bearer ${TOKEN}`);
  assert.ok(!(await page.$eval('#edge', e => e.classList.contains('gold'))));
  assert.deepEqual(errors, []);
  await page.close();
});

test('Devices: this device first, sign out another after a confirm, sign out everywhere wipes', opts, async () => {
  const { page, errors, api } = await open('/settings/devices/', { session: true });
  await page.waitForSelector('.spage .srow');
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#app').scrollLeft, Math.round(document.querySelector('.spage').getBoundingClientRect().left)]), [0, 0], 'the page sits flush, nothing scrolled sideways');
  const rows = await page.$$eval('.spage .srow', rs => rs.map(r => r.textContent));
  assert.match(rows[0], /This device/);
  assert.match(rows[1], /Windows · Edge.*Region, XX · approximate.*yesterday|2 days ago/);
  await page.waitForTimeout(300);
  await page.click('.spage .srow .sbtn');
  await page.waitForSelector('.csheet.on');
  assert.equal(await page.textContent('.csheet h2'), 'Sign out Windows · Edge?');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep', 'focus starts on Keep');
  await page.click('.csheet .btn.danger');
  await page.waitForFunction(() => document.querySelectorAll('.spage .srow').length === 1);
  assert.ok(api.calls.some(c => c.call === 'DELETE /v1/auth/sessions/s2'));
  await page.click('.spage .btn.danger:has-text("Sign out everywhere")');
  await page.click('.csheet .btn.danger');
  await page.waitForURL(u => u.pathname === '/signin/');
  assert.deepEqual(api.calls.find(c => c.call === 'POST /v1/auth/signout').body, { scope: 'all' });
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  assert.ok(!dbs.includes('th-auth') && !dbs.includes('th-data'), `wiped: ${dbs}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Agents: a new key needs the password and shows once', opts, async () => {
  const { page, errors, api } = await open('/settings/agents/?new=mind:chat', { session: true });
  await page.waitForSelector('#agent-name');
  assert.equal(await page.inputValue('#agent-name'), 'mind-chat');
  assert.ok(await page.isChecked('#role-mind-chat'));
  await page.check('#role-ci');
  assert.equal(await page.inputValue('#agent-name'), 'ci', 'the name follows the role until typed');
  await page.fill('#current-password', 'wrong');
  await page.waitForTimeout(300);
  await page.click('.sform button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.sform .line')?.textContent === "That's not your current password.");
  await page.fill('#current-password', 'right password here');
  await page.click('.sform button[type=submit]');
  await page.waitForSelector('#agent-token');
  assert.equal(await page.textContent('#agent-token'), 'test-agent-token-shown-once');
  assert.match(await page.textContent('.srec'), /TH_CI_TOKEN.*You won't see it again\./s);
  assert.deepEqual(api.calls.find(c => c.call === 'POST /v1/auth/agents' && c.body.current_password === 'right password here').body, { name: 'ci', role: 'ci', current_password: 'right password here' });
  await page.click('.srec .btn:has-text("Done")');
  assert.equal(await page.$('#agent-token'), null, 'gone from the page');
  assert.match(await page.textContent('.slist'), /ci.*CI.*ci.*CI.*never used/s);
  assert.deepEqual(errors.filter(e => !/401/.test(e)), []);
  await page.close();
});

test('a revoked session wipes this device and says why on /signin/', opts, async () => {
  const { page } = await open('/', { session: true, mock: { me: () => [401, { error: { code: 'session_revoked', message: 'x', request_id: 't', details: { reason: 'signed_out_elsewhere' } } }] } });
  await page.waitForURL(u => u.pathname === '/signin/');
  assert.equal(new URL(page.url()).searchParams.get('reason'), 'signed_out_elsewhere');
  assert.equal(await page.textContent('#reason'), 'This device was signed out from another device.');
  assert.equal(await session(page), null);
  await page.close();
});

test('Account: change password keeps the password manager in the loop', opts, async () => {
  const { page, errors, api } = await open('/settings/password/', { session: true });
  await page.waitForSelector('#password');
  assert.equal(await page.inputValue('#username'), 'example-owner');
  assert.ok(await page.isChecked('#sign-out-others'), 'sign out others is on by default');
  await page.fill('#current-password', 'right password here');
  await page.fill('#new-password', 'a brand new long passphrase');
  await page.click('#password button[type=submit]');
  await page.waitForFunction(() => /Password changed\./.test(document.querySelector('#password').textContent));
  assert.deepEqual(api.calls.find(c => c.call === 'POST /v1/auth/password').body, { current_password: 'right password here', new_password: 'a brand new long passphrase', sign_out_others: true });
  assert.deepEqual(errors, []);
  await page.close();
});
