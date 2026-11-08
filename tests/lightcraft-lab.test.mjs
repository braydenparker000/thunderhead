// The LightCraft test page (/lab/lightcraft/, engine/lightcraft-web/README.md): the committed build matches
// its recorded hashes; on a phone-sized screen the page asks for the desktop layout and starts LightCraft
// under its own CSP with no violation; and a real RAF (raw.pixls.us's public CC0 X-E5 sample, downloaded
// at test time into a temp directory, never committed) picked with Import Photos… imports and opens in Detail without
// the app panicking, which at the pinned commit it did until patches/web-clock.diff.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { check, LIGHTCRAFT } from '../scripts/lightcraft-web.mjs';

const SAMPLE = {
  url: 'https://raw.pixls.us/getfile.php/8509/nice/Fujifilm%20-%20X-E5%20-%2014bit%20lossy%20compressed%20%283:2%29.RAF',
  sha256: '28f56cc9784164209e92fae209bdcc78267bd692aa2fb964595485f7e93692ab',
};
const live = Boolean(process.env.SITE_URL);
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

test('the committed LightCraft build matches its recorded hashes and pin', () => {
  const { build, bad } = check();
  assert.deepEqual(bad, []);
  assert.equal(build.lightcraft.rev, LIGHTCRAFT.rev);
});

/** The CC0 sample (shared with photos-engine.test.mjs's temp copy), or why it is not there. */
function sample() {
  const dir = join(tmpdir(), 'th-photos-engine-sample');
  const file = join(dir, 'xe5-8509.raf');
  const ok = () => existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') === SAMPLE.sha256;
  if (ok()) return { file };
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('curl', ['-sSfL', '--max-time', '180', '-o', file, SAMPLE.url], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    return { why: `offline or the sample host is unreachable (${String(/** @type {Error} */ (e).message).split('\n')[0]})` };
  }
  return ok() ? { file } : { why: 'the downloaded sample does not match its SHA-256' };
}

/** A phone-sized page on /lab/lightcraft/, with what it logged and any CSP violation. */
async function open() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], logs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.log(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(`${base}/lab/lightcraft/?workers=1`);
  await page.waitForFunction(() => globalThis.lightcraft, null, { timeout: 60_000 });
  const cmd = (id, params = {}) => page.evaluate(async ([i, p]) => JSON.parse(await globalThis.lightcraft.command(i, JSON.stringify(p))), [id, params]);
  return { context, page, errors, logs, cmd };
}

test('starts with the desktop layout on a phone, under its CSP', { skip: live && 'local only', timeout: 120_000 }, async () => {
  const { context, page, errors, logs, cmd } = await open();
  // egui's zoom is set from the canvas so the UI is 980 points wide (patches/desktop-layout.diff)
  assert.equal(await page.evaluate(() => globalThis.lightcraftLayoutWidth), 980);
  assert.ok((await cmd('library.info')).photos > 0, 'the demo library is open');
  assert.deepEqual(logs.filter((l) => /CSP violation|panicked/.test(l)), []);
  assert.deepEqual(errors, []);
  await context.close();
});

const got = live ? { why: 'local only' } : process.env.TH_OFFLINE ? { why: 'TH_OFFLINE is set' } : sample();
test('an X-E5 RAF picked with Import Photos… imports and opens in Detail without a panic', { skip: got.why ?? false, timeout: 300_000 }, async () => {
  const { context, page, errors, logs, cmd } = await open();
  const before = (await cmd('library.state')).visibleCount;
  // File ▸ Import Photos… opens the browser's file picker, as the owner's tap does
  const chooser = page.waitForEvent('filechooser', { timeout: 30_000 });
  await cmd('file.addPhotos');
  await (await chooser).setFiles(got.file);
  let state;
  for (let i = 0; i < 600 && (state = await cmd('library.state')).visibleCount <= before; i++) await page.waitForTimeout(200);
  assert.equal(state.visibleCount, before + 1, 'the RAF is in the library');
  await cmd('library.select', { ids: [state.selection.active] });
  await cmd('view.detail');
  for (let i = 0, quiet = 0; i < 1200 && quiet < 5; i++) {
    const s = await cmd('web.stats');
    quiet = s.renderQueue || s.rendersInFlight ? 0 : quiet + 1;
    await page.waitForTimeout(100);
  }
  // a failed render of the photo logs `render Main, PhotoId(n), …: why` (ui-egui render.rs)
  assert.deepEqual(logs.filter((l) => /panicked|CSP violation|render Main, PhotoId/.test(l)), []);
  assert.deepEqual(errors, []);
  await context.close();
});
