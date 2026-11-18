// When the software decoder cannot open a film, libmedia's own words reached the screen ("[packages/avplayer/src/
// AVPlayer.ts][line 1858] [fatal]: open stream failed, ret: -2097152, taskId: …", on the owner's phone). The viewer now
// reads one plain sentence, by why the film came to the software decoder, and libmedia's words stay in the engine's log
// for the report (software.js plainly, player-start.js). libmedia is stood in for by a page-made AVPlayer whose load()
// fails that way; hevc.mkv (scripts/astra/fixtures.sh) goes to the software decoder in a browser with no HEVC decoder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
const RAW = '[packages/avplayer/src/AVPlayer.ts][line 1858] [fatal]: open stream failed, ret: -2097152, taskId: 1f2e3d';
let site, host, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

test('a film the software decoder cannot open: a plain sentence on screen, libmedia\'s words in the log', opts, async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  const r = await page.evaluate(async ([url, raw]) => {
    // libmedia as the engine sees it, whose load() fails as the real one did.
    class Loader {}
    window.AVPlayer = class { static setLogLevel() {} static IOLoader = { CustomIOLoader: Loader }; static Instances = []; static async stopPipelines() {}
      on() {} async load() { throw new Error(raw); } async destroy() {} };
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    const p = new AstraPlayer(video, document.createElement('div')), seen = [];
    p.addEventListener('error', (e) => seen.push(e.detail.message));
    await p.load({ url });
    for (let i = 0; i < 100 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50));
    return { mode: p.mode, video: p.info?.video?.[0]?.codec, seen, logged: p.log.filter((l) => l.kind === 'error').map((l) => String(l.detail?.detail)) };
  }, [host.url('hevc.mkv'), RAW]);
  if (r.mode !== 'software') return t.skip(`this browser plays HEVC itself (${r.mode})`);
  assert.equal(r.video, 'hevc');
  assert.deepEqual(r.seen, ['This phone\'s browser cannot decode this film\'s picture, and Astra\'s software decoder could not read the file either.']);
  assert.ok(!r.seen.some((m) => /packages|ret:|taskId/.test(m)), 'none of libmedia\'s words on screen');
  assert.ok(r.logged.some((d) => d.includes('open stream failed, ret: -2097152')), `libmedia's words in the log (${JSON.stringify(r.logged)})`);
  assert.deepEqual(errors, []);
});
