// Music's wide covers with filler sides shown as their square (library/cover-crop.js, cover-fit.js; owner,
// 2026-11-26), in Chromium at phone size over an invented library whose covers are drawn here (no network: the
// covers come from a route on the old Worker's art addresses, which the page's CSP allows):
// - a 16:9 cover with plain bars and one with a blurred stretched copy of its picture show square in the Albums
//   grid (256 × 256 thumbnails), in the player (the 360 px square of the full cover) and in the lock screen's
//   MediaSession artwork; a genuinely wide picture stays wide everywhere; a square one is untouched;
// - "Show Full Cover" in the playing song's menu shows that cover whole, and it stays so after a reload;
// - Settings › Album Art › "Crop wide covers to the centre" off shows every cover whole, at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (an invented library)', timeout: 180_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';

/** An RGB PNG drawn by px(x, y). */
function png(W, H, px) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rows.set(px(x, y), y * (W * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
/** A detailed picture (rings over a checker), S px across, at its own (u, v). */
const picture = (S) => (u, v) => {
  const ring = Math.hypot(u - S / 2, v - S / 2) % 24 < 12, chk = ((u >> 3) + (v >> 3)) & 1;
  return [cl(60 + 150 * ring + 30 * chk), cl(40 + 120 * chk + 40 * Math.sin(u / 5)), cl(200 - 120 * ring + 30 * Math.cos(v / 7))];
};
const W = 640, H = 360, OX = (W - H) / 2;
const sq = picture(H);
const COVERS = {
  // The square picture on plain bars.
  'Tidal Plain': png(W, H, (x, y) => (x >= OX && x < OX + H ? sq(x - OX, y) : [20, 22, 34])),
  // The square picture over itself stretched to the width, blurred and darkened.
  'Moss Blur': png(W, H, (x, y) => {
    if (x >= OX && x < OX + H) return sq(x - OX, y);
    const k = W / H, s = [0, 0, 0];
    let n = 0;
    for (let dy = -10; dy <= 10; dy += 2) for (let dx = -10; dx <= 10; dx += 2) {
      const c = sq(Math.min(H - 1, Math.max(0, (x + dx) / k)), Math.min(H - 1, Math.max(0, (y + dy + (H * k - H) / 2) / k)));
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++;
    }
    return s.map((v) => cl((0.7 * v) / n));
  }),
  // A genuinely wide picture.
  'Open Field': png(W, H, (x, y) => picture(W)(x, y + (W - H) / 2)),
  'Box Kite': png(300, 300, picture(300)),
};
const ALBUMS = Object.keys(COVERS);

let site, browser, base;
before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

test('wide covers with filler sides show square in the grid, the player and MediaSession; Show Full Cover and the setting show them whole', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const asked = [];
  await context.route(`${OLD}/**`, (route) => {
    const url = new URL(route.request().url()), name = decodeURIComponent(url.pathname.split('/').pop());
    const headers = { 'access-control-allow-origin': '*' };
    if (!url.pathname.startsWith('/music/library/art/') || !COVERS[name]) return route.fulfill({ status: 404, headers });
    asked.push(name);
    return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'image/png' }, body: COVERS[name] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /** The demo page with the invented library (three songs per album, each album one shared cover), on the Albums list. */
  const open = async () => {
    await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });
    await page.evaluate(async ([albums, old]) => {
      const { ctx } = window.__cp;
      await ctx.library.r2Ready?.catch(() => {});
      const songs = albums.flatMap((album, a) => [1, 2, 3].map((n) => ({
        id: `inv_cover_${a}_${n}`, title: `${album} Song ${n}`, artist: 'Wren Hollow', album, albumArtist: 'Wren Hollow', track: n, remote: true,
        artUrl: `${old}/music/library/art/${encodeURIComponent(album)}`, coverKey: `art/${album}`, src: `${old}/music/library/audio/r2_inv${a}${n}aaaaaaaaaaaa`, durationMs: 200_000, added: 1000 + a * 10 + n,
      })));
      ctx.library.withUserData(songs);
      ctx.library.setTracks(songs);
      ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
      const m = await import('/music/src/list/sources.js'), lw = ctx.listWidget;
      lw.open(m.categorySource(ctx, lw.libList, lw.nav, m.homeCategory(3)));
    }, [ALBUMS, OLD]);
  };
  /** Natural sizes ("WxH") of what each Albums grid item shows, by album; null for one not yet shown. */
  const grid = () => page.evaluate(async (albums) => {
    const size = (url) => new Promise((r) => { const i = new Image(); i.onload = () => r(`${i.naturalWidth}x${i.naturalHeight}`); i.onerror = () => r('error'); i.src = url; });
    const out = Object.fromEntries(albums.map((a) => [a, null]));
    for (const v of window.__cp.ctx.listWidget.libList.active.values()) if (v.title?.text in out && v.image?.art?.url) out[v.title.text] = await size(v.image.art.url);
    return out;
  }, ALBUMS);
  const gridIs = (want, message) => until(async () => { const g = await grid(); return JSON.stringify(g) === JSON.stringify(want) && g; }, { timeout: 30_000, message });
  /** The playing song's cover and the MediaSession artwork, natural sizes. */
  const player = () => page.evaluate(async () => {
    const size = (url) => new Promise((r) => { if (!url) return r(null); const i = new Image(); i.onload = () => r(`${i.naturalWidth}x${i.naturalHeight}`); i.onerror = () => r('error'); i.src = url; });
    const t = window.__cp.player.track, art = navigator.mediaSession.metadata?.artwork?.[0];
    return { art: await size(t?.art?.url), session: art?.src === t?.art?.url ? await size(art?.src) : null };
  });

  await page.goto(`${base}/music/?demo`);
  await open();
  // The grid: the two covers with filler sides square, the wide picture wide, the square one as it is.
  await gridIs({ 'Tidal Plain': '256x256', 'Moss Blur': '256x256', 'Open Field': '256x144', 'Box Kite': '256x256' }, 'the grid never showed the covers as expected');
  assert.deepEqual([...new Set(asked)].sort(), [...ALBUMS].sort(), 'each cover read once');

  // The player and the lock screen: the full cover's square.
  await page.evaluate(() => {
    const { ctx, player } = window.__cp;
    player.setQueue([ctx.library.tracks.find((t) => t.album === 'Tidal Plain')], 0);
    ctx.topNav.navigate('nav_main');
  });
  await until(async () => (await player()).session === '360x360', { message: 'the player and MediaSession never had the square cover' });
  assert.deepEqual(await player(), { art: '360x360', session: '360x360' });

  // "Show Full Cover" in the playing song's menu, tapped where the app's hit test reaches it.
  const where = (what) => page.evaluate(async (what) => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    const { ctx } = window.__cp;
    const { hitTest } = await import('/music/src/input.js');
    const shown = (x) => { for (let p = x; p; p = p.parent) if (p.visibility !== 0) return false; return x.width > 0; };
    let v = null;
    if (what === 'cover-menu') v = ctx.listWidget.items.get(0)?.findViewById('menu');
    else ctx.root.walk((x) => { if (!v && x.id === what && shown(x)) v = x; });
    if (!v || !shown(v)) return null;
    const a = v.getLocationIn(null), at = { x: a.x + v.width / 2, y: a.y + v.height / 2, text: v.text ?? null };
    const hit = hitTest(ctx.root, at.x, at.y);
    for (let h = hit; h; h = h.parent) if (h === v) return at;
    let own = v;
    while (own && !(own.clickable || own.longClickable || typeof own.onPointerDown === 'function')) own = own.parent;
    return hit && hit === own ? at : null;
  }, what);
  /** Taps a view once it is shown, reachable and still (two reads a frame apart alike); its text. */
  const tap = async (what) => {
    let last = null;
    const c = await until(async () => {
      const now = await where(what);
      const still = now && last && now.x === last.x && now.y === last.y;
      last = now;
      return still && now;
    }, { message: `nothing to tap: ${what}` });
    await page.mouse.click(c.x, c.y);
    return c.text;
  };
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.mode === 'aa' && !!window.__cp.ctx.listWidget.items.get(0)), { message: 'the player never showed' });
  await tap('cover-menu');
  assert.equal(await tap('cover_fit'), 'Show Full Cover');
  await until(async () => { const p = await player(); return p.art === '640x360' && p.session === '640x360'; }, { message: 'the cover never showed whole' });
  // Kept on the phone (cp-cover-fit), and the menu now offers the crop back.
  await until(() => page.evaluate(() => JSON.parse(localStorage.getItem('cp-cover-fit') ?? '{}')['cover:art/Tidal Plain']?.o === 'full'), { message: 'the choice was never kept' });
  await tap('cover-menu');
  assert.equal((await until(() => where('cover_fit'), { message: 'the menu never opened again' })).text, 'Crop Cover');

  // After a reload: still whole; the other covers as before.
  await page.reload();
  await open();
  await gridIs({ 'Tidal Plain': '256x144', 'Moss Blur': '256x256', 'Open Field': '256x144', 'Box Kite': '256x256' }, 'the choice did not outlast a reload');

  // Settings › Album Art: the crop off shows every cover whole, without a reload.
  await page.evaluate(() => { window.__samePage = true; window.__cp.ctx.settingsUi.open('aa'); });
  await until(() => page.evaluate(() => performance.now() - window.__cp.ctx.settingsUi.openedAt > 450), { message: 'Settings never took taps' });
  const row = page.locator('.cps-row', { hasText: 'Crop wide covers to the centre' });
  assert.equal(await row.locator('.cps-switch.on').count(), 1, 'on by default');
  await row.click();
  await until(() => page.evaluate(() => JSON.parse(localStorage.getItem('cp-settings') ?? '{}').cp_crop_wide_covers === false), { message: 'the setting was never kept' });
  await page.locator('.cps-bar-btn[aria-label="Close"]').click();
  await until(() => page.evaluate(() => !window.__cp.ctx.settingsUi.isOpen && !window.__cp.ctx.settingsUi.closing), { message: 'Settings never closed' });
  await gridIs({ 'Tidal Plain': '256x144', 'Moss Blur': '256x144', 'Open Field': '256x144', 'Box Kite': '256x256' }, 'the covers never showed whole');
  assert.equal(await page.evaluate(() => window.__samePage), true, 'no reload');

  assert.deepEqual(errors, []);
  await context.close();
});
