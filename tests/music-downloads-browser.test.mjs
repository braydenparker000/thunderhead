// Music's downloads in Chromium at phone size (MUSIC.md "Downloads", owner 2026-11-26), through the real
// music/sw.js (th/music/downloads.js, its songs through th/music/bridge.js) over an invented library from a
// mock new Worker and a mock bucket; no network, and the old Worker is never reached:
// - a playlist's menu Download arrives as one zip named after it: its songs numbered in the stored order,
//   each with its album's cover embedded and its audio pages as stored (tests/fixtures/ogg-read.mjs), its
//   .m3u8, and skipped.txt for the song the library no longer has; a song kept on the phone costs no
//   request, every other song exactly one; the bytes are counted as Downloads;
// - while it runs, a second ask is refused (by the page, and by the worker);
// - a menu opened just after the zip's line: the line never stands over the menu;
// - over 200 MB (the catalogue's sizes, faked here) the confirm dialog asks first, and Cancel starts nothing;
// - the playing song's menu Download arrives as "Artist - Title.opus", its cover embedded, its audio as stored.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';
import { readZip } from './fixtures/zip-read.mjs';
import { TAGS, tonePackets, writeOgg } from './fixtures/ogg-make.mjs';
import { assertEmbedded } from './fixtures/ogg-read.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 180_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
const MB = 1024 * 1024;

/** A small PNG of one colour (the albums' invented covers). */
function png(rgb) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0]);
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const COVERS = { 'Low Tide': png([30, 90, 160]), 'Sea Glass': png([40, 160, 120]) };
/** A tiny Ogg Opus song of its own: the fixture's tone, with the song's own comments and serial number, so no two are alike. */
const tone = tonePackets();
const opus = (title, artist, i) => {
  const comments = [`TITLE=${title}`, `ARTIST=${artist}`].map((c) => Buffer.from(c));
  const tags = Buffer.concat([Buffer.from(TAGS.subarray(0, 16)), Buffer.from([comments.length, 0, 0, 0]), ...comments.flatMap((c) => [Buffer.from([c.length, 0, 0, 0]), c])]);
  const total = tone.packets.reduce((n, p) => n + p.samples, 0);
  return Buffer.from(writeOgg({ head: tone.head.bytes, tags, packets: tone.packets, serial: 0x1000 + i, endGranule: total - tone.packets.at(-1).discard }));
};

/** Invented songs. */
const SONGS = [
  ['Morning Static', 'Cobalt Field', 'Low Tide', 1, 1],
  ['Paper Lanterns', 'Cobalt Field', 'Low Tide', 2, 1],
  ['Slow Orbit', 'Cobalt Field', 'Low Tide', 1, 2],
  ['Quiet Harbour', 'Juniper Gate', 'Sea Glass', 1, 1],
].map(([title, artist, album, track, disc], i) => {
  const hex = (i + 1).toString(16).padStart(64, String.fromCharCode(97 + i));
  return { id: `r2_native_${hex}`, title, artist, album, track, disc, bytes: opus(title, artist, i), cover: COVERS[album] };
});
const [S1, S2, S3] = SONGS;
const GONE = `r2_native_${'f'.repeat(64)}`;

let site, mock, browser, base, api;
/** Every request the bucket answered, by song id: its range, or 'whole'. */
const bucket = new Map();
/** Songs the bucket holds back until released: id -> release(). */
const held = new Map();

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    if (url.pathname === '/v1/music/catalog') {
      const tracks = SONGS.map((s) => ({
        id: s.id, sha256: s.id.slice(10), size: s.bytes.length, audioKey: `native/audio/${s.id.slice(10)}.opus`, mimeType: 'audio/ogg',
        path: `${s.title}.opus`, folder: 'Cloudflare R2/Invented', coverKey: `native/art/${s.album}.png`, r2Identity: { size: s.bytes.length, etag: 'e1', lastModified: '2026-10-01T00:00:00.000Z' },
        metadata: { title: s.title, artist: s.artist, album: s.album, albumArtist: s.artist, track: s.track, disc: s.disc, dur: 200, codec: 'opus' },
      }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: tracks.length, generatedAt: '2026-11-26T00:00:00.000Z', tracks }));
    }
    if (url.pathname === '/v1/media/sign') {
      let body = '';
      req.on('data', (d) => (body += d)).on('end', () => {
        const items = JSON.parse(body).refs.map((ref) => ({ ref, url: `${api}/r2/${ref.replace(/^music:/, '').replace('#art', '/art')}`, expires_at: Date.now() + 3_600_000 }));
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items, errors: [] }));
      });
      return;
    }
    const art = SONGS.find((s) => url.pathname === `/r2/${s.id}/art`);
    if (art) {
      res.writeHead(200, { ...cors, 'Content-Type': 'image/png', 'Content-Length': String(art.cover.length) });
      return res.end(art.cover);
    }
    const song = SONGS.find((s) => url.pathname === `/r2/${s.id}`);
    if (song) {
      (bucket.get(song.id) ?? bucket.set(song.id, []).get(song.id)).push(req.headers.range ?? 'whole');
      await held.get(song.id)?.promise;
      const b = song.bytes;
      const head = { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (!range) {
        res.writeHead(200, { ...head, 'Content-Length': String(b.length) });
        return res.end(b);
      }
      const a = Number(range[1]), z = range[2] ? Math.min(Number(range[2]), b.length - 1) : b.length - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${z}/${b.length}`, 'Content-Length': String(z - a + 1) });
      return res.end(b.subarray(a, z + 1));
    }
    res.writeHead(404, cors).end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Holds the bucket's answers for a song until the returned function is called. */
function hold(id) {
  let release;
  const promise = new Promise((r) => (release = r));
  held.set(id, { promise });
  return () => { held.delete(id); release(); };
}
/** Whole-song requests by song id (a download asks for the whole song; the library's own reads of a song's tags and
 * the player's of its start ask for a range, and are not counted here). */
const requests = () => Object.fromEntries([...bucket].map(([id, r]) => [id, r.filter((x) => x === 'whole').length]).filter(([, n]) => n));

test('downloads: a playlist as a numbered zip with its .m3u8, one at a time, the 200 MB ask, the playing song as its file', opts, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'th-downloads-'));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', acceptDownloads: true });
  const oldCalls = [];
  await context.route(`${OLD}/**`, (route) => { oldCalls.push(route.request().url()); return route.abort(); });
  const errors = [];
  // Signed in (the session as the shell keeps it), and Music's worker installed.
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
  // (navigator.serviceWorker.ready never settles here: this page is outside the worker's scope. Its registration's
  // worker is waited for instead.)
  await first.evaluate(() => navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }).then(() => {}));
  await until(() => first.evaluate(async () => (await navigator.serviceWorker.getRegistration('/music/'))?.active?.state === 'activated'), { message: 'Music\'s worker never became active' });
  await first.close();
  oldCalls.length = 0;

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && window.__cp?.ctx?.library?.tracks?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });

  /** A view's centre: by id, the header's menu ('header-menu'), or the cover's three dots ('cover-menu'); only a view
   * shown with every view above it (a header the list has let go keeps its menu's entries, hidden with it in the pool),
   * and only where a tap reaches it (input.js hitTest): not under the Undo bar, which stands above everything for its
   * 5 s and takes a tap itself, nor in a menu's end that its growing height still cuts off. Read after the page's next
   * frame, so two reads are always a frame apart (on a loaded runner a frame can take 150 ms, and two reads within one
   * frame read alike while the view still moves). */
  const where = (what) => page.evaluate(async (what) => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    const { ctx } = window.__cp;
    const { hitTest } = await import('/music/src/input.js');
    const shown = (x) => { for (let p = x; p; p = p.parent) if (p.visibility !== 0) return false; return x.width > 0; };
    let v = null;
    if (what === 'header-menu') v = ctx.listWidget.libList.active.get(-1)?.findViewById('menu');
    else if (what === 'cover-menu') v = ctx.listWidget.items.get(0)?.findViewById('menu');
    else ctx.root.walk((x) => { if (!v && x.id === what && shown(x)) v = x; });
    if (!v || !shown(v)) return null;
    const a = v.getLocationIn(null), at = { x: a.x + v.width / 2, y: a.y + v.height / 2 };
    // The tap lands on it or in it, or on the nearest view above it that takes taps (a row holding a line of text).
    const hit = hitTest(ctx.root, at.x, at.y);
    for (let h = hit; h; h = h.parent) if (h === v) return at;
    let own = v;
    while (own && !(own.clickable || own.longClickable || typeof own.onPointerDown === 'function')) own = own.parent;
    return hit && hit === own ? at : null;
  }, what);
  /** Taps a view once it is shown, reachable and has stopped moving (a menu grows into place): two reads alike. */
  const tap = async (what) => {
    let last = null;
    const c = await until(async () => {
      const now = await where(what);
      const still = now && last && now.x === last.x && now.y === last.y;
      last = now;
      return still && now;
    }, { message: `nothing to tap: ${what}` });
    await page.mouse.click(c.x, c.y);
  };
  /** The texts shown: each view visible with every view above it. */
  const shownText = () => page.evaluate(() => {
    const out = [], shown = (x) => { for (let p = x; p; p = p.parent) if (p.visibility !== 0) return false; return x.width > 0; };
    window.__cp.ctx.root.walk((v) => { if (typeof v.text === 'string' && v.text && shown(v)) out.push(v.text); });
    return out;
  });
  const says = (text) => until(async () => (await shownText()).includes(text), { message: `never said "${text}"` });
  const atRest = () => until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && lw.libList.source === lw.stack[lw.stack.length - 1]; }), { message: 'the list never came to rest' });
  const dialogs = () => page.evaluate(() => window.__cp.ctx.dialogs?.length ?? 0);
  /** One dialog open and come in: its enter scene (dialog.js, started as it opens) has ended, so its buttons are where
   * a tap finds them. */
  const dialogUp = () => until(() => page.evaluate(() => { const d = window.__cp.ctx.dialogs ?? []; return d.length === 1 && !d[0].host.scenes.running; }), { message: 'nothing was asked' });
  const saved = async (d) => { const path = join(dir, d.suggestedFilename()); await d.saveAs(path); return new Uint8Array(await readFile(path)); };

  // A song kept on the phone from playing it (library/played-cache.js): it costs no request.
  await page.evaluate(async ([src, bytes]) => {
    const b = Uint8Array.from(bytes);
    await (await caches.open('claude-player-played')).put(src, new Response(b, { headers: { 'content-type': 'audio/ogg', 'content-length': String(b.length) } }));
  }, [`${OLD}/music/library/audio/${S2.id}`, [...S2.bytes]]);

  // A playlist in its stored order, with a song the library no longer has.
  await page.evaluate(([ids]) => {
    const { ctx } = window.__cp;
    const pl = ctx.playlists.create('Road Trip: Vol/1');
    ctx.playlists.reorder(pl, ids);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
    ctx.bus.post('bus_gui', 'cmd_nav_to_playlist', null, { playlist: pl });
  }, [[S3.id, S1.id, GONE, S2.id]]);
  await atRest();
  bucket.clear();

  // Download from the playlist's menu; the first song is held back so the download is still running.
  const releaseFirst = hold(S3.id);
  await tap('header-menu');
  const arriving = page.waitForEvent('download', { timeout: 60_000 });
  await tap('pl_download');
  await says('Downloading Road Trip: Vol/1…');
  await until(() => bucket.get(S3.id)?.includes('whole'), { message: 'the first song was never asked for' });

  // A second ask while it runs: the page says so, and the worker refuses one asked of it directly.
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_pl_download', null, {}));
  await says('A download is already running.');
  const refused = await page.evaluate((src) => new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    navigator.serviceWorker.controller.postMessage({ type: 'th-music-download', job: { name: 'Other.zip', zip: true, files: [{ src, name: 'a.opus', size: 1 }] } }, [ch.port2]);
  }), `${OLD}/music/library/audio/${S1.id}`);
  assert.deepEqual(refused, { error: 'busy' });

  releaseFirst();
  const zipDl = await arriving;
  assert.equal(zipDl.suggestedFilename(), 'Road Trip Vol 1.zip');
  const zip = readZip(await saved(zipDl));
  const names = ['01 - Cobalt Field - Slow Orbit.opus', '02 - Cobalt Field - Morning Static.opus', '03 - Cobalt Field - Paper Lanterns.opus'];
  assert.deepEqual(zip.entries.map((e) => e.name), [...names, 'Road Trip Vol 1.m3u8', 'skipped.txt']);
  for (const [i, s] of [S3, S1, S2].entries()) assertEmbedded(zip.entries[i].data, s.bytes, s.cover, names[i]);
  assert.equal(Buffer.from(zip.entries[3].data).toString(), `#EXTM3U\r\n${names.map((n) => `#EXT-X-RATING:0\r\n${n}\r\n`).join('')}`);
  assert.match(Buffer.from(zip.entries[4].data).toString(), /1 song is no longer in the library/);
  await says('Saved, 1 song could not be added');
  // One request for each song not on the phone, none for the one that is.
  assert.deepEqual(requests(), { [S3.id]: 1, [S1.id]: 1 });
  // Counted in Settings › Data use as Music's Downloads.
  await until(() => page.evaluate(() => /"music\.downloads":\[/.test(localStorage.getItem('th.p.data') ?? '')), { timeout: 30_000, message: 'the bytes were never counted as Downloads' });

  // Over 200 MB (the catalogue's sizes): the confirm dialog asks first; Cancel starts nothing.
  await page.evaluate(async ([a, b]) => {
    const { ctx } = window.__cp, lw = ctx.listWidget;
    ctx.library.byId.get(a).size = 150 * 1024 * 1024;
    ctx.library.byId.get(b).size = 100 * 1024 * 1024;
    const m = await import('/music/src/list/sources.js');
    lw.open(m.currentCategorySource(ctx, lw.libList, lw.nav, 'album', ctx.library.byId.get(a)));
  }, [S1.id, S3.id]);
  await atRest();
  const before = { downloads, asked: requests() };
  await tap('header-menu');
  // The zip's line ("Saved, 1 song could not be added") never stands over the menu: gone if it had been up a second,
  // else placed clear of it (read once the menu and the bar are at rest and drawn where they are laid out).
  const atMenu = await until(() => page.evaluate(() => {
    const { ctx } = window.__cp, u = ctx.undoBar, m = ctx.listWidget.menuItem, ph = ctx.root.findViewById('menu_placeholder');
    if (!m || m.closing || ph.scenes.running || m.v.scenes?.running || u.anim) return null;
    const f = u.frame;
    if (!u.current || f.visibility !== 0) return { bar: null };
    if (f.lp.bottomMargin !== u.place()) return null;
    const drawn = (v) => { for (let p = v; p; p = p.parent) if (p._dirty || p._dom?.x !== p.left + p.translationX || p._dom?.y !== p.top + p.translationY) return false; return true; };
    if (!drawn(f) || !drawn(m.v)) return null;
    const r = (v) => { const b = v.el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return { bar: r(f), menu: r(m.v) };
  }), { message: 'the menu and the bar never came to rest' });
  if (atMenu.bar) {
    const { bar, menu } = atMenu;
    assert.ok(bar.bottom <= menu.top || bar.top >= menu.bottom || bar.right <= menu.left || bar.left >= menu.right, `the bar ${JSON.stringify(bar)} clear of the menu ${JSON.stringify(menu)}`);
  }
  await tap('pl_download');
  await dialogUp();
  await says('Cobalt Field - Low Tide: 3 songs, about 250 MB. Download?');
  await tap('button2');
  await until(async () => (await dialogs()) === 0, { message: 'Cancel did not close the question' });
  await outlast(page, 300);
  assert.deepEqual({ downloads, asked: requests() }, before, 'Cancel started nothing');
  assert.ok(!(await shownText()).some((t) => t.startsWith('Downloading')), 'no download began');

  // The playing song's menu: the song as its own file.
  await page.evaluate(async ([id, mb]) => {
    const { ctx, player } = window.__cp;
    ctx.library.byId.get(id).size = mb;
    player.setQueue([ctx.library.byId.get(id)], 0);
    ctx.topNav.navigate('nav_main');
  }, [S1.id, S1.bytes.length]);
  await until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'aa' && !!lw.items.get(0); }), { message: 'the player never showed' });
  await tap('cover-menu');
  const one = page.waitForEvent('download', { timeout: 60_000 });
  await tap('download_song');
  const songDl = await one;
  assert.equal(songDl.suggestedFilename(), 'Cobalt Field - Morning Static.opus');
  assertEmbedded(await saved(songDl), S1.bytes, S1.cover, 'the playing song');
  await says('Saved to Downloads');

  assert.deepEqual(oldCalls, [], 'nothing went to the old Worker');
  assert.deepEqual(errors, []);
  await context.close();
  await rm(dir, { recursive: true, force: true });
});
