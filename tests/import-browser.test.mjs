// The phone data move (MIGRATION.md §5.3), end to end in Chromium on two local origins standing in
// for the old site and the new one: invented data is written through the apps' own storage code,
// exported with phone-data.js (the same file the old site's /export/ runs), imported on the other
// origin by /import/, and read back by the unchanged apps' code with no upgrade (open question 10).
// A second import changes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let server, browser, oldSite, newSite;
before(async () => {
  server = await serve(0);
  const port = server.address().port;
  oldSite = `http://127.0.0.1:${port}`;
  newSite = `http://localhost:${port}`; // another origin, so its storage starts empty
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function page(base, path) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.route(url => !url.href.startsWith(base), r => r.abort());
  await p.goto(base + path, { waitUntil: 'load' });
  return { p, errors };
}

/** What the unchanged apps' own code reads on this origin. */
const readBack = p => p.evaluate(async () => {
  const { LibraryDb } = await import('/music/src/library/db.js');
  const music = await LibraryDb.open();
  const tracks = await music.allTracks();
  const playlists = await music.getState('playlists');
  const { storedFeed } = await import('/podcasts/core.js');
  return {
    tracks: tracks.length, rated: tracks.filter(t => t.rating).length, plays: tracks.reduce((n, t) => n + (t.plays || 0), 0),
    wave: tracks[0]?.wave instanceof Float32Array ? tracks[0].wave.length : null,
    playlists: playlists?.length ?? null, r2cache: await music.getState('r2:index') ?? null,
    feed: (await storedFeed('https://feeds.example.invalid/show.xml'))?.show?.title ?? null,
    local: ['jarvis.guitar.v2', 'mymedia.saved.v1', 'astra.v2.library', 'cp-settings'].map(k => localStorage.getItem(k)),
  };
});

test('export on the old origin, import on the new one: the apps read the same data, and a second import changes nothing', async () => {
  // 1. The "old site": invented data in every kind of store the export reads.
  const old = await page(oldSite, '/404.html');
  await old.p.evaluate(async () => {
    const { LibraryDb } = await import('/music/src/library/db.js');
    const db = await LibraryDb.open();
    await db.updateTrack({ id: 'r2_a', title: 'Song A', rating: 5, plays: 12, wave: new Float32Array([0.1, 0.5, 0.9]) });
    await db.updateTrack({ id: 'r2_b', title: 'Song B', rating: 0, plays: 3 });
    await db.setState('playlists', [{ name: 'Morning', ids: ['r2_a'] }]);
    await db.setState('r2:index', { big: 'catalog cache' });
    const { saveFeed } = await import('/podcasts/core.js');
    await saveFeed({ show: { feedUrl: 'https://feeds.example.invalid/show.xml', title: 'Invented Show' }, episodes: [] });
    localStorage.setItem('jarvis.guitar.v2', JSON.stringify({ songs: [{ id: 1 }, { id: 2 }] }));
    localStorage.setItem('mymedia.saved.v1', JSON.stringify(['v1', 'v2', 'v3']));
    localStorage.setItem('astra.v2.library', JSON.stringify({ a: 1 }));
    localStorage.setItem('cp-settings', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('unrelated.key', 'stays behind');
  });
  const before = await readBack(old.p);
  const exported = await old.p.evaluate(async () => (await import('/import/phone-data.js')).collect('Test phone'));
  assert.equal(exported.format, 'th-phone-export/2');
  assert.equal(exported.local['unrelated.key'], undefined, 'only the listed keys leave');
  const state = exported.idb.find(d => d.name === 'claude-player').stores.find(s => s.name === 'state');
  assert.deepEqual(state.records.map(r => r.key), ['playlists'], 'the r2: catalog cache is not exported');
  assert.deepEqual(old.errors, []);

  // 2. The "new site": /import/ with that file.
  const dir = await mkdtemp(join(tmpdir(), 'th-export-'));
  const file = join(dir, 'export.json');
  await writeFile(file, JSON.stringify(exported));
  const neu = await page(newSite, '/import/');
  await neu.p.setInputFiles('#file', file);
  await neu.p.waitForFunction(() => !document.querySelector('#go').disabled);
  const shownBefore = await neu.p.$$eval('#counts li', li => li.map(x => x.textContent));
  await neu.p.click('#go');
  await neu.p.waitForFunction(() => /Imported from the old site/.test(document.querySelector('#line').textContent));
  const shownAfter = await neu.p.$$eval('#counts li', li => li.map(x => x.textContent));
  assert.deepEqual(shownAfter, shownBefore, 'counts read back on the new site equal the file’s');
  assert.ok(shownBefore.some(l => /^Music: 2 songs · 1 rated · 15 plays · 1 lists/.test(l)), shownBefore.join(' | '));

  // 3. The unchanged apps' code finds the same data (minus the cache) without an upgrade.
  const after = await readBack(neu.p);
  assert.deepEqual({ ...after, r2cache: null }, { ...before, r2cache: null });
  assert.equal(after.r2cache, null);
  assert.equal(after.wave, 3, 'binary values survive');

  // 4. A second import of the same file keeps what is there.
  await neu.p.evaluate(async () => {
    const { LibraryDb } = await import('/music/src/library/db.js');
    await (await LibraryDb.open()).updateTrack({ id: 'r2_c', title: 'Played on the new site', plays: 1 });
  });
  await neu.p.click('#go');
  await neu.p.waitForFunction(() => /Kept what was already here/.test(document.querySelector('#line').textContent));
  assert.equal((await readBack(neu.p)).tracks, 3, 'newer use on the new site is not erased');
  assert.deepEqual(neu.errors, []);
  await old.p.close(); await neu.p.close();
});
