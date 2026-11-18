// A TorBox link's limits in a real browser (engine/source-gate.js, source-renew.js): the engine plays a 40-second
// VP9 film from another origin (tests/fixtures/astra-host.mjs, paced like a far host, counting the requests open at
// once) and never holds more than three over a start, a far seek, a preview drag and a network change; a link that
// dies while the film plays is renewed through `renew` and the film plays on from where it was, with no error;
// and without `renew` the same death stops the film with the reader's error, as before. The film is made here
// with ffmpeg (about 15 MB, skipped without it). Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (a film made here)', timeout: 120_000 };
let site, host, browser, base, why = '';

before(async () => {
  if (live) return;
  const dir = mkdtempSync(join(tmpdir(), 'astra-renew-'));
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=40',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-minrate', '3M', '-maxrate', '3M', '-g', '48', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', join(dir, 'long.webm')]);
  } catch { why = 'ffmpeg is not installed, so the film cannot be made'; return; }
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost({ root: dir + '/' });
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  if (!await page.evaluate(() => MediaSource.isTypeSupported('video/webm; codecs="vp09.00.10.08"'))) why = 'this browser has no VP9 decoder';
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** A page of the real site holding one engine player (`window.p`) on a muted video, the host paced like a far one. */
async function player(t) {
  host.reset();
  Object.assign(host.control, { bps: 1_500_000, delay: 40 });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    (await import('/astra/src/engine/source-stream.js')).TIMING.quiet = 600; // a network change notices a silent download sooner
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    window.seen = { errors: [], renewals: 0, times: [] };
    window.p.addEventListener('error', (e) => window.seen.errors.push(e.detail.message));
    video.addEventListener('timeupdate', () => window.seen.times.push(video.currentTime));
  });
  /** Loads `url`; `fresh`, when given, is the address `renew` hands back. */
  const load = (url, fresh = null) => page.evaluate(([url, fresh]) => {
    window.p.load({ url, autoplay: true, renew: fresh && (async () => { window.seen.renewals++; return fresh; }) });
  }, [url, fresh]);
  const at = (time, timeout = 30_000) => page.waitForFunction((time) => { const v = window.p.video; return v.videoWidth > 0 && v.readyState >= 2 && !v.seeking && v.currentTime >= time; }, time, { timeout, polling: 40 });
  const seen = () => page.evaluate(() => ({ ...window.seen, t: window.p.video.currentTime, url: window.p.url, source: window.p.probed?.source?.url, log: window.p.log.filter((e) => e.kind === 'renew').map((e) => e.detail) }));
  return { page, errors, load, at, seen };
}

test('never more than three requests to the film at once: a start, a far seek, a preview drag and a network change', opts, async (t) => {
  if (why) return t.skip(why);
  const p = await player(t);
  host.stats.peak = 0;
  await p.load(host.url('long.webm'));
  await p.at(3);
  await p.page.evaluate(() => { window.p.video.currentTime = 30; });
  await p.at(31.5);
  // A drag across the bar: a preview asked every 40 ms, each ending the one before, then one that rests.
  const pictures = await p.page.evaluate(async () => {
    let got = 0, controller = null;
    const asks = [];
    for (let i = 0; i < 14; i++) {
      controller?.abort(); controller = new AbortController();
      asks.push(window.p.previewAt(2 + i * 2.6, { signal: controller.signal }).then((b) => { if (b) got++; }));
      await new Promise((r) => setTimeout(r, 40));
    }
    await Promise.all(asks);
    if (await window.p.previewAt(20)) got++;
    return got;
  });
  assert.ok(pictures >= 1, 'the drag fetched and showed key frames');
  // A network change: the running download goes silent, then the phone says it is online again.
  const before = host.stats.requests;
  host.control.bps = 1;
  await new Promise((r) => setTimeout(r, 900));
  host.control.bps = 1_500_000;
  await p.page.evaluate(() => dispatchEvent(new Event('online')));
  await p.at((await p.seen()).t + 2);
  assert.ok(host.stats.requests > before, 'the silent download was asked again');
  assert.ok(host.stats.peak <= 3, `at most three requests open at once on the host (${host.stats.peak})`);
  assert.ok(await p.page.evaluate(() => window.p.probed.source.gate.peak) <= 3);
  assert.deepEqual([(await p.seen()).errors, p.errors], [[], []]);
});

test('a link that dies while the film plays is renewed: it plays on from where it was, with no error', opts, async (t) => {
  if (why) return t.skip(why);
  const p = await player(t);
  const first = host.link('long.webm', 'first'), fresh = host.link('long.webm', 'fresh');
  await p.load(first, fresh);
  await p.at(1);
  // A short reach, so the film needs the host again within seconds of playing (2 MiB, about five seconds of it).
  await p.page.evaluate(() => window.p.probed.source.setReadAhead(2 << 20, { seconds: 2, keep: 20 }));
  host.kill(first, 403);
  const from = (await p.seen()).t;
  await p.at(from + 9, 40_000);
  const s = await p.seen();
  assert.equal(s.renewals, 1, 'renew was asked once');
  assert.ok(host.stats.ranges.length && s.source === fresh && s.url === fresh, 'the reader and the player read from the fresh address');
  assert.deepEqual(s.log, ['a fresh address'], 'the log says so, without the address');
  assert.ok(s.times.every((x, i) => i === 0 || x >= s.times[i - 1]), 'the position never went back');
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

test('without renew, the same death stops the film with the reader’s error, as before', opts, async (t) => {
  if (why) return t.skip(why);
  const p = await player(t);
  const first = host.link('long.webm', 'alone');
  await p.load(first);
  await p.at(1);
  await p.page.evaluate(() => window.p.probed.source.setReadAhead(2 << 20, { seconds: 2, keep: 20 }));
  host.kill(first, 403);
  await p.page.waitForFunction(() => window.seen.errors.length > 0, null, { timeout: 40_000 });
  const s = await p.seen();
  assert.match(s.errors[0], /403/);
  assert.equal(s.renewals, 0);
  assert.equal(s.source, first);
});
