// The player's cover items (list/list-widget.js AAItemView.bind) in Chromium, the demo songs' page: a
// song with no full cover yet shows its thumbnail at once (the one on the record, else thumbFor's), and
// the full cover replaces it once decoded. The library is a stand-in with invented images. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 120_000 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

test("a player item shows the song's thumbnail while its full cover is missing, then the full cover", opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.ctx?.library, null, { timeout: 60_000 });
  const got = await page.evaluate(async () => {
    const { AAItemView } = await import('/music/src/list/list-widget.js');
    const picture = async (color) => {
      const c = new OffscreenCanvas(8, 8), g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 8, 8);
      return { url: URL.createObjectURL(await c.convertToBlob({ type: 'image/png' })), width: 8, height: 8 };
    };
    const small = await picture('#c03'), full = await picture('#03c');
    const asked = [];
    let giveFull;
    const ctx = Object.create(window.__cp.ctx);
    ctx.library = {
      customArt: new Map(),
      thumbFor: () => (asked.push('thumb'), Promise.resolve(small)),
      artFor: () => (asked.push('art'), new Promise((r) => { giveFull = r; })),
    };
    const shown = [];
    // A player item (useThumb unset), with no views but its image.
    const item = Object.assign(Object.create(AAItemView.prototype), { ctx, image: { setArt: (a) => shown.push(a?.url ?? null) }, findViewById: () => null });
    const song = { id: 'r2_native_invented0001', title: 'Invented song', remote: true, artId: 'https://old.example.test/music/library/art/r2_native_invented0001' };
    item.bind(song);
    for (let i = 0; i < 100 && shown.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const before = { shown: shown.map((u) => (u === small.url ? 'small' : u)), asked: [...asked] };
    giveFull(full);
    for (let i = 0; i < 100 && song.art !== full; i++) await new Promise((r) => setTimeout(r, 10));
    const after = { shown: shown.at(-1) === full.url, art: song.art === full, thumbKept: song.thumb === small };
    // A song whose record already has its thumbnail: shown in the same bind.
    shown.length = 0;
    item.bind({ ...song, id: 'r2_native_invented0002', thumb: small });
    return { before, after, atOnce: shown[0] === small.url };
  });
  assert.deepEqual(got, {
    before: { shown: [null, 'small'], asked: ['thumb', 'art'] },
    after: { shown: true, art: true, thumbKept: true },
    atOnce: true,
  });
  assert.deepEqual(errors, []);
  await context.close();
});
