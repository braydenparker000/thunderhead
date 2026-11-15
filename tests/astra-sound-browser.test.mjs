// Astra's even loudness and headphone surround (frontend/astra/src/enhance/leveller.js, headphone.js) on
// real films played by the real engine in a real browser, from the file host on another origin
// (tests/fixtures/astra-host.mjs), and the Sound tab's two switches (player/sound-menu.js).
// surround-left.mkv (5.1 AAC, a 700 Hz and noise burst every 0.5 s in the left surround only, 6 s) was made with:
//   ffmpeg -f lavfi -i testsrc2=size=320x180:rate=12:duration=6 -f lavfi -i "aevalsrc='if(lt(mod(t\,0.5)\,0.04)\,
//     0.5*sin(2*PI*700*t)*sin(PI*mod(t\,0.5)/0.04)+0.3*(random(0)*2-1)*sin(PI*mod(t\,0.5)/0.04)\,0)':s=48000:d=6"
//     -filter_complex "[1]pan=5.1|BL=c0[a]" -map 0:v -map "[a]" -c:v libx264 -preset veryslow -profile:v main
//     -pix_fmt yuv420p -b:v 30k -g 24 -bf 2 -c:a aac -b:a 64k surround-left.mkv
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)' };
let site, host, browser, base, h264 = false;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** A page of the real site with `film(url)` (plays a film through the engine), `level(analyser)` (dB) and `record(ctx, nodes)` (raw channels). */
async function page(t) {
  host.reset();
  const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  t.after(() => p.close());
  await p.goto(`${base}/astra/lab/`);
  await p.evaluate(() => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.level = (a) => { const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return 10 * Math.log10(b.reduce((s, x) => s + x * x, 0) / b.length + 1e-18); };
    window.film = async (url) => {
      const { AstraPlayer } = await import('/astra/src/engine/player.js');
      const video = Object.assign(document.createElement('video'), { playsInline: true });
      document.body.append(video);
      const player = new AstraPlayer(video, document.createElement('div'));
      const ready = new Promise((r) => player.addEventListener('ready', r, { once: true }));
      player.load({ url, autoplay: false });
      await ready;
      await video.play();
      await new Promise((r) => { const on = () => (video.currentTime > 0.3 ? r() : setTimeout(on, 50)); on(); });
      return { video, player };
    };
    // Records each node's first two channels side by side for `ms` of the sound's own time (exactly that many samples,
    // however late the page's thread runs): [[left, right] per node], Float32Arrays.
    window.record = async (ctx, nodes, ms) => {
      const merge = ctx.createChannelMerger(nodes.length * 2), sp = ctx.createScriptProcessor(4096, nodes.length * 2, 1), got = nodes.map(() => [[], []]);
      const frames = Math.round((ms / 1000) * ctx.sampleRate);
      nodes.forEach((n, i) => { const s = ctx.createChannelSplitter(2), two = Object.assign(ctx.createGain(), { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' }); n.connect(two); two.connect(s); s.connect(merge, 0, 2 * i); s.connect(merge, 1, 2 * i + 1); });
      let have = 0;
      await new Promise((done) => {
        sp.onaudioprocess = (e) => {
          if (have >= frames) return;
          got.forEach((pair, i) => pair.forEach((ch, side) => ch.push(new Float32Array(e.inputBuffer.getChannelData(2 * i + side)))));
          if ((have += e.inputBuffer.length) >= frames) done();
        };
        merge.connect(sp); sp.connect(ctx.destination);
      });
      sp.disconnect(); merge.disconnect();
      const join = (parts) => { const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out.subarray(0, frames); };
      return got.map((pair) => pair.map(join));
    };
    // Waits for a node's sound to settle after a change: a limiter just built takes up to a second or so to reach its
    // steady gain, which a fixed 300 ms covered only on a quiet machine. Settled: two half-second stretches (a whole
    // period of either film's sound) within 0.1 dB of each other.
    window.steady = async (ctx, node) => {
      for (let i = 0, last = NaN; i < 16; i++) { const [[l]] = await record(ctx, [node], 500), now = db(l); if (Math.abs(now - last) < 0.1) return; last = now; }
    };
    // Enough of the film left to settle and measure (`s` seconds), else back near its start (its sound repeats), playing.
    window.room = async (video, s) => {
      if (video.duration - video.currentTime >= s) return;
      video.currentTime = 0.3;
      await new Promise((r) => { const on = () => (!video.seeking && video.currentTime > 0.6 ? r() : setTimeout(on, 50)); on(); });
    };
    window.db = (x) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / x.length + 1e-18);
    // The lag (in samples) at which `b` best matches `a`: positive when b comes later.
    window.lag = (a, b, most = 64) => { let best = 0, at = 0; for (let d = -most; d <= most; d++) { let s = 0; for (let i = most; i < a.length - most; i++) s += a[i] * b[i + d]; if (s > best) { best = s; at = d; } } return at; };
  });
  return { page: p, errors };
}

test('even loudness: two films 12 dB apart end up within 1.5 dB, smoothly; the volume stays the owner\'s', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { SoundChain } = await import('/astra/src/enhance/sound-chain.js');
    const { startLevel } = await import('/astra/src/enhance/loudness.js');
    const { Sound } = await import('/astra/src/enhance/sound.js');
    const ctx = new AudioContext(), out = { loud: [], quiet: [] };
    // The same film twice, one through +6 dB and one through -6 dB in front of its chain: a loud film and a quiet one.
    const films = await Promise.all([film(url), film(url)]);
    const sides = [2, 0.5].map((g, i) => {
      const src = ctx.createMediaElementSource(films[i].video), pre = ctx.createGain(); pre.gain.value = g;
      const chain = new SoundChain(ctx), a = ctx.createAnalyser(), b = ctx.createAnalyser(); a.fftSize = b.fftSize = 16384;
      src.connect(pre); pre.connect(chain.in); chain.out.connect(ctx.destination);
      pre.connect(a); chain.out.connect(b);
      chain.film(`film${i}`, startLevel({}, `film${i}`)); chain.apply({ loudness: true }, 2);
      return { chain, a, b };
    });
    for (const f of films) f.video.currentTime = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 14000) { out.loud.push([sides[0].chain.level.gate.seconds, sides[0].chain.level.db]); out.quiet.push([sides[1].chain.level.gate.seconds, sides[1].chain.level.db]); await wait(250); }
    let before = 0, after = 0;
    for (let i = 0; i < 8; i++) { before += level(sides[0].a) - level(sides[1].a); after += level(sides[0].b) - level(sides[1].b); await wait(120); }
    out.before = before / 8; out.after = after / 8;
    out.gains = sides.map((s) => s.chain.level.db); out.integrated = sides.map((s) => s.chain.level.gate.integrated);
    // The element's volume at 0.25 on a Sound: the meter takes it back out, so the gain is what it is at full volume.
    for (const f of films) f.video.pause();
    const third = await film(url); third.video.volume = 0.25;
    const sound = new Sound(third.video); sound.mode = third.player.mode;
    sound.film('film2', { db: 0, known: false }); sound.set({ loudness: true });
    await wait(9000);
    out.volume = { db: sound.chain.level.db, integrated: sound.chain.level.gate.integrated, settings: sound.state().settings };
    return out;
  }, host.url('multi.mkv'));
  const steps = (list) => list.slice(1).map(([s, g], i) => [s, Math.abs(g - list[i][1])]);
  t.diagnostic(`input apart ${r.before.toFixed(2)} dB, after the chains ${r.after.toFixed(2)} dB; gains ${r.gains.map((g) => g.toFixed(2))}; measured ${r.integrated.map((l) => l.toFixed(2))} LUFS; at volume 0.25: ${r.volume.db.toFixed(2)} dB (${r.volume.integrated.toFixed(2)} LUFS)`);
  assert.ok(Math.abs(r.before - 12) < 1, `the two films arrive 12 dB apart (${r.before.toFixed(2)})`);
  assert.ok(Math.abs(r.after) < 1.5, `and leave the chains within 1.5 dB (${r.after.toFixed(2)})`);
  for (const [s, d] of [...steps(r.loud), ...steps(r.quiet)]) if (s >= 10.5) assert.ok(d <= 0.5 * 0.25 + 0.06, `once settled at most 1 dB per 2 s (${d.toFixed(3)} dB in 0.25 s at ${s} s)`);
  assert.ok(Math.abs(r.integrated[0] - r.integrated[1] - 12) < 0.5, 'the meter tells them 12 LU apart');
  assert.ok(Math.abs(r.volume.integrated - r.integrated[0] + 6) < 1, `at volume 0.25 the film measures as the film, not 12 dB quieter (${r.volume.integrated.toFixed(2)})`);
  assert.equal(r.volume.settings.loudness, true);
  assert.deepEqual(errors, []);
});

test('headphone surround: the centre in both ears alike, the left surround louder and earlier on the left; off is today\'s mix exactly', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async ([centre, left]) => {
    const { Sound } = await import('/astra/src/enhance/sound.js');
    const out = {};
    const take = async (url, run) => {
      const { video, player } = await film(url);
      const sound = new Sound(video); sound.mode = player.mode;
      sound.set({ delay: 0.001 }); await wait(100); sound.set({ delay: 0 });
      await run(sound, video); player.destroy();
    };
    // Each film: the chain's output beside the plain path (the element's sound mixed by the browser), recorded together.
    // Settled first (and with film enough left for it), then recorded.
    const both = async (sound, video) => { await room(video, 4); await steady(sound.ctx, sound.chain.out); const [[l, r], [pl, pr]] = await record(sound.ctx, [sound.chain.out, sound.source], 1500); return { l, r, pl, pr }; };
    // The channel count comes from a worklet the switch loads: waited for, on a busy machine as long as it takes.
    const six = async (sound) => { for (let i = 0; i < 300 && sound.state().channels !== 6; i++) await wait(50); };
    await take(centre, async (sound, video) => {
      sound.set({ headphones: true }); await six(sound);
      const on = await both(sound, video); out.centre = { l: db(on.l), r: db(on.r), lag: lag(on.l, on.r), plain: db(on.pl), channels: sound.state().channels };
      sound.set({ dialogue: 1 }); const lifted = await both(sound, video); out.centre.lifted = db(lifted.l);
      sound.set({ headphones: false, dialogue: 0 });
      const off = await both(sound, video); out.centreOff = { diff: db(off.l.map((v, i) => v - off.pl[i])), plain: db(off.pl) };
    });
    await take(left, async (sound, video) => {
      const plain = await both(sound, video); out.leftPlain = { l: db(plain.l), r: db(plain.r), diff: db(plain.l.map((v, i) => v - plain.pl[i])), ref: db(plain.pl) };
      sound.set({ headphones: true }); await six(sound);
      const on = await both(sound, video); out.left = { l: db(on.l), r: db(on.r), lag: lag(on.l, on.r), sum: 10 * Math.log10(10 ** (db(on.l) / 10) + 10 ** (db(on.r) / 10)) };
      sound.set({ headphones: false });
      const off = await both(sound, video); out.leftOff = { diff: db(off.l.map((v, i) => v - off.pl[i])), r: db(off.r.map((v, i) => v - off.pr[i])), ref: db(off.pl) };
    });
    return out;
  }, [host.url('centre.mkv'), host.url('surround-left.mkv')]);
  t.diagnostic(`centre: L ${r.centre.l.toFixed(2)} R ${r.centre.r.toFixed(2)} dB (plain ${r.centre.plain.toFixed(2)}), lag ${r.centre.lag}; dialogue +1: ${(r.centre.lifted - r.centre.l).toFixed(2)} dB`);
  t.diagnostic(`left surround: L ${r.left.l.toFixed(2)} R ${r.left.r.toFixed(2)} dB, right ear later by ${r.left.lag} samples; plain L ${r.leftPlain.l.toFixed(2)} R ${r.leftPlain.r.toFixed(2)}`);
  assert.equal(r.centre.channels, 6);
  assert.ok(Math.abs(r.centre.l - r.centre.r) < 0.5, `the centre is as loud in both ears (${r.centre.l.toFixed(2)} / ${r.centre.r.toFixed(2)})`);
  assert.equal(r.centre.lag, 0, 'and reaches both at once');
  assert.ok(Math.abs(r.centre.lifted - r.centre.l - 4) < 1, 'dialogue still lifts the placed centre by 4 dB');
  assert.ok(r.left.l - r.left.r > 4, `the left surround is clearly louder on the left (${(r.left.l - r.left.r).toFixed(2)} dB)`);
  assert.ok(r.left.lag >= 8 && r.left.lag <= 40, `and reaches the left ear first (${r.left.lag} samples)`);
  assert.ok(Math.abs(r.left.sum - r.leftPlain.l) < 2, `placed, the surround is about as loud as in the plain mix (${r.left.sum.toFixed(2)} vs ${r.leftPlain.l.toFixed(2)} dB, both ears)`);
  assert.ok(r.leftPlain.r < -80 && r.leftPlain.diff < r.leftPlain.ref - 80, 'before: the plain mix, left only');
  assert.ok(r.leftOff.diff < r.leftOff.ref - 80 && r.leftOff.r < -80, `off again: exactly the plain mix (${r.leftOff.diff.toFixed(1)} dB of difference)`);
  assert.ok(r.centreOff.diff < r.centreOff.plain - 80, `and for the centre film (${r.centreOff.diff.toFixed(1)} dB of difference)`);
  assert.deepEqual(errors, []);
});

test('the Sound tab: Even loudness is saved and remembers each title\'s gain; Headphone surround is offered only for 5.1 the page receives', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  host.reset();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    window.film = async (url, id) => {
      const ready = new Promise((r) => p.engine.addEventListener('ready', r, { once: true }));
      p.open({ stream: { url, name: 'Example 1080p' }, meta: { id, title: id } });
      await ready;
      await new Promise((r) => { const on = () => (p.video.currentTime > 0.3 ? r() : setTimeout(on, 50)); on(); });
      p.menus.audioTab = 'sound'; p.menus.openModal('audio');
      return [...document.querySelectorAll('.ap-sound .ap-label')].map((e) => e.textContent);
    };
  });
  const labels = await page.evaluate((u) => film(u, 'tt-one'), host.url('multi.mkv'));
  assert.ok(labels.includes('Even loudness'), 'the switch is there');
  assert.ok(!labels.includes('Headphone surround'), 'stereo: nothing to place');
  await page.locator('[aria-label="Even loudness"]').click();
  const on = await page.evaluate(() => { const s = p.extras.sound.sound; return { settings: s.state().settings, level: s.chain?.level && { db: s.chain.level.db, known: s.chain.level.known, id: s.chain.level.id }, saved: JSON.parse(localStorage.getItem('astra.v2.player')).loudness, checked: document.querySelector('[aria-label="Even loudness"]').getAttribute('aria-checked') }; });
  assert.equal(on.settings.loudness, true);
  assert.equal(on.saved, true, 'saved as a pref');
  assert.equal(on.checked, 'true');
  assert.deepEqual(on.level, { db: 5, known: false, id: 'tt-one' }, 'a film never measured starts from the guess');
  // What the leveller hands on once a film has settled is remembered under the title's id.
  await page.evaluate(() => { const l = p.extras.sound.sound.chain.level; l.gate.blocks = 300; l.db = 4.2; l.settle(); l.gate.reset(); });
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).levels), { 'tt-one': 4.2 });
  const centre = await page.evaluate((u) => film(u, 'tt-two'), host.url('centre.mkv'));
  assert.ok(centre.includes('Headphone surround'), '5.1 the page receives: offered');
  assert.match(await page.locator('.ap-sound').textContent(), /For headphones: places the film's speakers around you\./);
  await page.locator('[aria-label="Headphone surround"]').click();
  const placed = await page.evaluate(async () => { for (let i = 0; i < 40 && p.extras.sound.sound.state().channels !== 6; i++) await wait(50); const s = p.extras.sound.sound; return { settings: s.state().settings, key: s.chain.key }; });
  assert.equal(placed.settings.headphones, true);
  assert.match(placed.key, /^6,true/, 'the chain places the six channels');
  await page.evaluate((u) => film(u, 'tt-one'), host.url('multi.mkv'));
  const again = await page.evaluate(() => { const l = p.extras.sound.sound.chain.level; return { db: l.db, known: l.known, id: l.id }; });
  assert.deepEqual(again, { db: 4.2, known: true, id: 'tt-one' }, 'the next play starts at its remembered gain');
  assert.deepEqual(errors, []);
});
