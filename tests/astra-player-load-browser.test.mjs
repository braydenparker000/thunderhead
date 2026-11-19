// The player's code loads a piece at a time (app/player-load.js), in the real app at phone size: frames are drawn
// while it is evaluated, the player is made in a frame of its own, and a tap that comes before it has loaded is
// answered in its own frame by the player's veil, its fade already running, before the code is awaited
// (app/playing.js). Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only', timeout: 60_000 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

async function app(t) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.route((url) => !url.href.startsWith(base), (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.root);
  return { page, errors };
}

test('the player\'s code is evaluated in pieces, frames drawn between them, and the player made after', opts, async (t) => {
  const { page, errors } = await app(t);
  const got = await page.evaluate(async () => {
    const { PLAYER_GRAPH } = await import('/astra/src/app/player-graph.js');
    let frames = 0, on = true;
    const count = () => { frames++; if (on) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    const pieces = [], links = () => document.querySelectorAll('link[rel=modulepreload]').length, before = links();
    const { evaluateInPieces } = await import('/astra/src/app/player-load.js');
    await evaluateInPieces(PLAYER_GRAPH, { pieces: (p) => pieces.push(p) });
    const evaluated = frames;
    await window.astra.loadPlayer();
    on = false;
    return { modules: PLAYER_GRAPH.length, pieces: pieces.length, counted: pieces.reduce((n, p) => n + p[0], 0), evaluated, links: links() - before, player: !!window.astra.player?.engine };
  });
  assert.equal(got.counted, got.modules, 'every module once');
  assert.ok(got.pieces >= 5, `in pieces (${got.pieces})`);
  assert.ok(got.evaluated >= got.pieces - 1, `a frame between pieces (${got.evaluated} frames, ${got.pieces} pieces)`);
  assert.equal(got.links, 0, 'the preload links are gone once used');
  assert.ok(got.player);
  assert.deepEqual(errors, []);
});

test('a tap before the player has loaded: the veil is on screen, fading in, before the code is awaited', opts, async (t) => {
  const { page, errors } = await app(t);
  const got = await page.evaluate(async () => {
    const app = window.astra;
    let frames = 0;
    const count = () => { frames++; if (frames < 600) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    const load = app.loadPlayer.bind(app);
    let seen = null;
    app.loadPlayer = () => {
      const veil = document.querySelector('.ap-veil');
      seen ??= { frames, veil: !!veil?.isConnected, fading: !!veil?.getAnimations().length, urgent: !!app.playerUrgent };
      return load();
    };
    const started = frames;
    app.play({ meta: { id: 'tt0000701', type: 'movie', name: 'An Invented Film' }, source: { id: 's0', addonUrl: 'https://addon.example/manifest.json', stream: { url: 'https://films.example/a.mkv', name: 'Example' } }, sources: [] });
    const sync = { veil: !!document.querySelector('.ap-veil'), asked: !!seen };
    await new Promise((r) => { const wait = () => (app.player?.isOpen ? r() : setTimeout(wait, 20)); wait(); });
    const veilGone = !document.querySelector('.ap-veil');
    app.player.close('test');
    return { sync, seen, started, veilGone, feel: (await import('/astra/src/ui/feel-log.js')).feelEntries().map((e) => e.name) };
  });
  assert.deepEqual(got.sync, { veil: true, asked: false }, 'the veil in the tap\'s frame; the code not asked for yet');
  assert.ok(got.seen.frames - got.started >= 1, `asked for after the veil's first frame (${got.seen.frames - got.started} frames)`);
  assert.deepEqual([got.seen.veil, got.seen.fading, got.seen.urgent], [true, true, true]);
  assert.ok(got.veilGone, 'the veil goes once the player is open');
  assert.ok(got.feel.includes('player:veil'));
  assert.deepEqual(errors.filter((e) => !/films\.example|Failed to fetch|network/i.test(e)), []);
});
