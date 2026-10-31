// A skip in the ported player keeps something playing until the new song sounds (Android keeps the
// media session, and with it the lock screen and headset controls, only while an element plays).
// The real music page, its worker and bridge (frontend/music/sw.js, frontend/th/music/bridge.js)
// run against a mock new Worker whose signing answers slowly and a mock bucket of 60-second tones.
// During a skip to a song nothing has signed yet, some deck must always be playing with data until
// the new one plays; the outgoing one is silent meanwhile and lets go once the new one is heard.
// Checked before the audio engine joins (fades on the elements' volume, also with the page hidden)
// and after (in the engine). In DJ shuffle a skip keeps the next songs planned, and the worker signs
// the next songs ahead in one request.
// Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
const N = 16;
const SECONDS = 60;
const hex = (i) => (i + 10).toString(16).repeat(64).slice(0, 64);
const idOf = (i) => `r2_native_${hex(i)}`;
const name = (i) => `Tone ${String(i).padStart(2, '0')}`;

/** A mono 16-bit WAV tone (8 kHz): a synthetic song the browser decodes without a codec. */
function tone(freq) {
  const rate = 8000;
  const n = rate * SECONDS;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return buf;
}
const files = Array.from({ length: N }, (_, i) => tone(220 + 20 * i));

let site, mock, browser, base, api;
const state = { signDelay: 0, signs: [] };

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    if (url.pathname === '/v1/music/catalog') {
      const tracks = files.map((f, i) => ({
        id: idOf(i), sha256: hex(i), size: f.length, audioKey: `native/audio/${hex(i)}.wav`, mimeType: 'audio/wav',
        // A cover of its own, so drawing a row never reads (and signs) the song's audio for an embedded one.
        coverKey: `native/art/${hex(i)}.jpg`, path: `${name(i)}.wav`, folder: 'Cloudflare R2/Test', r2Identity: { size: f.length, etag: `e${i}`, lastModified: '2026-10-01T00:00:00.000Z' },
        metadata: { title: name(i), artist: `Artist ${i}`, album: `Album ${i}`, dur: SECONDS, codec: 'wav', sr: 8000 },
      }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-skip"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: N, generatedAt: '2026-10-29T00:00:00.000Z', tracks }));
    }
    if (url.pathname === '/v1/media/sign') {
      let body = '';
      req.on('data', (d) => (body += d)).on('end', () => {
        const { refs } = JSON.parse(body);
        state.signs.push(refs);
        const at = (ref) => files.findIndex((_, i) => ref.startsWith(`music:${idOf(i)}`));
        const items = refs.map((ref) => ({ ref, url: `${api}/r2/${ref.endsWith('#art') ? 'art' : at(ref)}.wav?X-Amz-Signature=test`, expires_at: Date.now() + 3 * 3_600_000 }));
        setTimeout(() => {
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ items, errors: [] }));
        }, refs.every((ref) => ref.endsWith('#art')) ? 0 : state.signDelay);
      });
      return;
    }
    const m = /^\/r2\/(\d+)\.wav$/.exec(url.pathname);
    if (m) {
      const buf = files[+m[1]];
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const head = { ...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', ETag: `"e${m[1]}"`, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag' };
      if (!range) {
        res.writeHead(200, { ...head, 'Content-Length': String(buf.length) });
        return res.end(buf);
      }
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': String(b - a + 1) });
      return res.end(buf.subarray(a, b + 1));
    }
    res.writeHead(404, cors).end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** The music page under its worker, signed in, with the tones as its library. */
async function boot({ slowEngine = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.route(`${OLD}/**`, (route) => route.abort());
  const first = await context.newPage();
  await first.goto(`${base}/no-such-page`);
  await first.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  await first.goto(`${base}/music/`, { waitUntil: 'load' });
  await first.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
  await first.close();
  const page = await context.newPage();
  // Before the engine has loaded, the decks play straight to the output and fade on their volume.
  if (slowEngine) await page.addInitScript(() => { AudioWorklet.prototype.addModule = () => new Promise(() => {}); });
  // The lock screen's and headset's actions, as the page sets them.
  await page.addInitScript(() => {
    window.__actions = {};
    const set = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (name, fn) => { window.__actions[name] = fn; set(name, fn); };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/`, { waitUntil: 'load' });
  await page.waitForFunction((n) => !!navigator.serviceWorker.controller && window.__cp?.player?.queue?.length >= n, N, { timeout: 30_000 });
  return { context, page, errors };
}

/** Plays from track `from` until it sounds. */
async function playFrom(page, from) {
  await page.evaluate((i) => { const p = __cp.player; p.shuffle = 0; p.repeat = 1; p.order = null; p.load(i, true); }, from);
  await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 1.5; }, null, { timeout: 30_000 });
}

/**
 * A skip to the track `ahead` places on (a list tap; Next does the same load), watched every 20 ms until the new
 * deck plays: whether some deck played with data at each look, the outgoing deck's level once its
 * fade-out is over (the element's volume, or the engine's output), and what the lock screen says.
 */
function watchSkip(page, ahead) {
  return page.evaluate(async (k) => {
    const p = __cp.player, dsp = __cp.dsp, old = p.audio, target = p.indexAt(k), want = p.queue[target].title;
    const analyser = dsp.bypass ? null : dsp.nodes?.analyser;
    const buf = new Float32Array(2048);
    const out = { gaps: [], heldLoud: [], states: new Set(), heardAt: null, released: null, maxPeakWhileWaiting: 0 };
    const t0 = performance.now();
    p.load(target, true);
    const fresh = p.audio;
    while (performance.now() - t0 < 10_000) {
      const t = Math.round(performance.now() - t0);
      const live = p.decks.some((d) => !d.paused && d.readyState >= 2 && d.getAttribute('src'));
      out.states.add(navigator.mediaSession.playbackState);
      if (fresh._heard && out.heardAt === null) out.heardAt = t;
      if (out.heardAt !== null) {
        if (old.paused || !old.getAttribute('src')) { out.released = t - out.heardAt; break; }
        if (t - out.heardAt > 2000) break;
      } else {
        if (!live) out.gaps.push(t);
        // Past the 400 ms fade (and the 500 ms it may wait): the outgoing deck is silent.
        if (t > 1200 && old !== p.audio && !old.paused) {
          if (dsp.bypass && old.volume > 0.001) out.heldLoud.push([t, old.volume]);
          if (analyser) {
            analyser.getFloatTimeDomainData(buf);
            for (const v of buf) out.maxPeakWhileWaiting = Math.max(out.maxPeakWhileWaiting, Math.abs(v));
          }
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { ...out, states: [...out.states], current: p.audio === fresh, playing: !fresh.paused, track: p.track?.title, want };
  }, ahead);
}

test('a skip to a song not signed yet keeps a deck playing, silently, until the new song plays', opts, async () => {
  const { context, page, errors } = await boot({ slowEngine: true });
  try {
    await playFrom(page, 0);
    assert.equal(await page.evaluate(() => __cp.dsp.bypass), true, 'no engine yet');
    state.signDelay = 2500;
    const r = await watchSkip(page, 8);
    assert.equal(r.track, r.want);
    assert.ok(r.heardAt !== null && r.heardAt > 2000, `the new song sounded after the slow signing (${r.heardAt} ms)`);
    assert.equal(r.gaps.length, 0, `no deck played from ${r.gaps[0]} to ${r.gaps.at(-1)} ms`);
    assert.deepEqual(r.heldLoud, [], 'the outgoing deck is silent while it waits');
    assert.ok(r.released !== null && r.released < 1000, `the outgoing deck lets go once the new one plays (${r.released} ms)`);
    assert.deepEqual(r.states, ['playing']);
    assert.ok(r.current && r.playing);

    // With the screen off the page gets no animation frames: a skip's fades still end where they should.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      window.requestAnimationFrame = () => 1;
    });
    const hidden = await page.evaluate(async () => {
      const p = __cp.player, old = p.audio;
      p.step(1);
      const fresh = p.audio;
      const t0 = performance.now();
      while (performance.now() - t0 < 8000 && !(fresh._heard && fresh.volume === 1 && !old.getAttribute('src'))) await new Promise((r) => setTimeout(r, 50));
      return { heard: fresh._heard, volume: fresh.volume, oldLetGo: !old.getAttribute('src'), switched: fresh !== old };
    });
    assert.deepEqual(hidden, { heard: true, volume: 1, oldLetGo: true, switched: true }, 'the new song at full volume, the old deck let go');
    assert.deepEqual(errors, []);
  } finally {
    state.signDelay = 0;
    await context.close();
  }
});

test('the same through the audio engine, and with Next pressed twice', opts, async () => {
  const { context, page, errors } = await boot();
  state.signs.length = 0;
  try {
    await playFrom(page, 1);
    // A pause lets the engine take the decks; play again.
    await page.evaluate(() => __cp.player.pause());
    await page.waitForFunction(() => !__cp.dsp.bypass && __cp.player.decks.every((d) => d.paused), null, { timeout: 15_000 });
    await page.evaluate(() => __cp.player.play());
    await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 3; }, null, { timeout: 30_000 });
    state.signDelay = 2500;
    const r = await watchSkip(page, 8);
    assert.equal(r.track, r.want);
    assert.ok(r.heardAt !== null && r.heardAt > 2000, `the new song sounded after the slow signing (${r.heardAt} ms)`);
    assert.equal(r.gaps.length, 0, `no deck played from ${r.gaps[0]} to ${r.gaps.at(-1)} ms`);
    assert.ok(r.maxPeakWhileWaiting < 0.001, `the engine's output is silent while the outgoing deck waits (peak ${r.maxPeakWhileWaiting})`);
    assert.ok(r.released !== null && r.released < 1000, `the outgoing deck lets go once the new one plays (${r.released} ms)`);
    assert.deepEqual(r.states, ['playing']);

    // Next twice, 150 ms apart, to songs not signed yet: the song that was playing goes on, silent,
    // until the newest sounds.
    const twice = await page.evaluate(async () => {
      const p = __cp.player, gaps = [], a = p.indexAt(4), b = p.indexAt(6), want = p.queue[b].title;
      const t0 = performance.now();
      p.load(a, true);
      await new Promise((r) => setTimeout(r, 150));
      p.load(b, true);
      const fresh = p.audio;
      while (performance.now() - t0 < 10_000 && !fresh._heard) {
        if (!p.decks.some((d) => !d.paused && d.readyState >= 2 && d.getAttribute('src'))) gaps.push(Math.round(performance.now() - t0));
        await new Promise((r) => setTimeout(r, 20));
      }
      return { gaps, heard: fresh._heard, track: p.track?.title, want, at: Math.round(performance.now() - t0) };
    });
    assert.equal(twice.track, twice.want);
    assert.ok(twice.heard && twice.at > 2000, `the newest song plays after the slow signing (${twice.at} ms)`);
    assert.equal(twice.gaps.length, 0, `no deck played from ${twice.gaps[0]} to ${twice.gaps.at(-1)} ms`);
    state.signDelay = 0;

    // DJ shuffle: Next early in a song plans again from the new one, keeping the 3 songs planned after it
    // (th/music/dj.js), and the player keeps that plan.
    const dj = await page.evaluate(async () => {
      const p = __cp.player;
      p.command('cmd_player_set_shuffle', { arg1: 5 });
      p.indexAt(1);
      const before = [...p.order], at = before.indexOf(p.index);
      p.step(1);
      p.indexAt(1);
      return { before: before.slice(at + 1, at + 5), after: p.order.slice(0, 4), n: p.order.length, unique: new Set(p.order).size, q: p.queue.length };
    });
    assert.deepEqual(dj.after, dj.before);
    assert.equal(dj.n, dj.q);
    assert.equal(dj.unique, dj.q);
    // The worker was asked to sign the next songs ahead, together.
    assert.ok(state.signs.some((refs) => refs.filter((r) => !r.endsWith('#art')).length >= 3), `one request signed the next songs: ${state.signs.map((r) => r.length)}`);

    // The headset and lock screen: next and previous, never the 10-second jumps (MUSIC.md §5.7); Stop
    // pauses where it is and lets both decks go; Play goes on from there.
    const actions = await page.evaluate(() => Object.fromEntries(Object.entries(__actions).map(([k, v]) => [k, typeof v])));
    assert.equal(actions.nexttrack, 'function');
    assert.equal(actions.previoustrack, 'function');
    assert.equal(actions.stop, 'function');
    assert.equal(actions.seekforward, 'object', 'seekforward cleared (null)');
    assert.equal(actions.seekbackward, 'object', 'seekbackward cleared (null)');
    await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 2; }, null, { timeout: 30_000 });
    const stopped = await page.evaluate(async () => {
      const p = __cp.player, at = p.positionMs();
      __actions.stop();
      await new Promise((r) => setTimeout(r, 600));
      return { at, now: p.positionMs(), state: p.state, decks: p.decks.map((d) => ({ paused: d.paused, src: !!d.getAttribute('src'), current: d === p.audio, preload: d.preload, ready: d.readyState })) };
    });
    assert.equal(stopped.state, 2, 'paused');
    assert.ok(stopped.decks.every((d) => d.paused && (d.current ? d.preload === 'none' : !d.src)), JSON.stringify(stopped.decks));
    assert.ok(Math.abs(stopped.now - stopped.at) < 1500, `where it was (${stopped.at} → ${stopped.now} ms)`);
    await page.evaluate(() => __actions.play());
    await page.waitForFunction((at) => { const p = __cp.player, a = p.audio; return !a.paused && a.readyState >= 3 && p.positionMs() > at; }, stopped.now, { timeout: 30_000 });
    assert.deepEqual(errors, []);
  } finally {
    state.signDelay = 0;
    await context.close();
  }
});
