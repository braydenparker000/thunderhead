// Between a tap and the first picture (frontend/astra/src/app/ready.js, next-ready.js, addons/debrid.js,
// engine/source-tail.js): what is fetched ahead for a list of streams and a saver state, the press that
// starts a resolve the tap then takes (on a fake clock), the next episode made ready only for the same
// release group, and the film's tail asked for beside its start. TorBox, add-ons and hosts are stand-ins.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readyWork, soundOf, saverNow, ReadyAhead } from '../frontend/astra/src/app/ready.js';
import { NextReady, nextDueSoon, KEEP } from '../frontend/astra/src/app/next-ready.js';
import { forgetLists, resolveDebrid } from '../frontend/astra/src/addons/debrid.js';
import { HttpSource } from '../frontend/astra/src/engine/http-source.js';
import { TAIL } from '../frontend/astra/src/engine/source-tail.js';

/** A file host of `size` bytes that honours ranges and sends 64 KiB every `pace` ms; requests are in `calls`. */
function host({ pace = 2, size = 64 << 20 } = {}) {
  const calls = [];
  const fetchFn = async (url, { headers, signal }) => {
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(headers.Range);
    const from = +a, to = b ? +b + 1 : size, call = { from, to };
    calls.push(call);
    let at = from;
    const body = new ReadableStream({
      async pull(c) {
        await new Promise((r) => setTimeout(r, pace));
        if (signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
        if (at >= to) return c.close();
        const piece = new Uint8Array(Math.min(64 << 10, to - at)); at += piece.length; c.enqueue(piece);
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${to - 1}/${size}`, 'content-length': String(to - from) } });
  };
  return { calls, fetchFn };
}

const HASH = (n) => n.toString(16).padStart(40, '0');
const torrentio = (token, n) => ({ name: 'TB 1080p', title: `Film ${n}.mkv`, url: `https://torrentio.strem.fun/resolve/torbox/${token}/${HASH(n)}/Film%20${n}.mkv/0/Film%20${n}.mkv` });
const direct = { name: 'TB', title: 'x', url: 'https://api.torbox.app/v1/api/torrents/requestdl?token=tok-d&torrent_id=3&file_id=1' };
const plain = (title = 'Film 1080p AAC') => ({ name: 'Host', title, url: 'https://cdn.example/film.mp4' });
const off = { saveData: false, type: 'wifi' };

/** A TorBox stand-in: counts list pages and download-link requests. */
function torbox() {
  const calls = { list: 0, link: 0 };
  const fetchFn = async (url) => {
    const u = new URL(url), answer = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
    if (u.pathname.endsWith('/torrents/mylist')) { calls.list++; return answer([1, 2, 3].map((n) => ({ id: n, hash: HASH(n), files: [{ id: 7, short_name: `Film ${n}.mkv` }] }))); }
    if (u.pathname.endsWith('/torrents/requestdl')) { calls.link++; return answer(`https://cdn.example/${u.searchParams.get('torrent_id')}/7`); }
    throw Error('unexpected request');
  };
  return { calls, fetchFn };
}
const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => forgetLists());

test('what is fetched ahead for a list: one list per TorBox account, a connection, the converters labels ask for; nothing with the saver on or the switch off', () => {
  const list = [torrentio('tok-a', 1), torrentio('tok-a', 2), torrentio('tok-b', 1), direct, plain('Film DDP5.1 x264')];
  const work = readyWork(list, { connection: off });
  assert.equal(work.preconnect, true);
  assert.deepEqual(work.lists, [list[0].url, list[2].url], 'one read per account; a direct link needs none');
  assert.deepEqual(work.sounds, ['eac3']);
  assert.equal(work.metered, false);
  assert.equal(readyWork(list, { connection: { type: 'cellular' } }).metered, true);
  const none = { preconnect: false, lists: [], sounds: [], metered: false };
  assert.deepEqual(readyWork(list, { saver: true }), none, 'the data saver: nothing');
  assert.deepEqual(readyWork(list, { ahead: false }), none, 'the switch off: nothing');
  assert.deepEqual(readyWork([plain()], { connection: off }), none, 'nothing listed needs anything');
  assert.deepEqual(['Film TrueHD Atmos 7.1', 'DTS-HD MA', 'DD+ 5.1', 'DD5.1 x264', 'Dolby Digital', 'AAC 2.0', 'ADDED'].map((t) => soundOf({ title: t })), ['truehd', 'dts', 'eac3', 'ac3', 'ac3', null, null]);
});

test('the saver as the player would put it: the setting first, then the connection', () => {
  assert.equal(saverNow({ dataSaver: 'always' }, off), true);
  assert.equal(saverNow({ dataSaver: 'never' }, { saveData: true }), false);
  assert.equal(saverNow({ dataSaver: 'auto' }, { type: 'cellular' }), true);
  assert.equal(saverNow({ dataSaver: 'auto' }, off), false);
});

test('the Streams screen reads each account’s list once, and a tap then needs one request; with the switch off or the saver on, none', async () => {
  const tb = torbox(), app = { settings: {} };
  const ready = new ReadyAhead(app, { fetchFn: tb.fetchFn, prefs: () => ({ dataSaver: 'never' }), connection: off, doc: null });
  const list = [torrentio('tok-a', 1), torrentio('tok-a', 2)];
  ready.listed(list); ready.listed(list); ready.listed(list); // drawn again as add-ons answer
  await flush();
  assert.equal(tb.calls.list, 1, 'the list was read once');
  assert.equal(await resolveDebrid(list[1].url, { fetchFn: tb.fetchFn }), 'https://cdn.example/2/7');
  assert.deepEqual(tb.calls, { list: 1, link: 1 }, 'the tap asked only for the file’s link');
  forgetLists();
  for (const [settings, prefs] of [[{ readyAhead: false }, { dataSaver: 'never' }], [{}, { dataSaver: 'always' }]]) {
    const quiet = torbox(), r = new ReadyAhead({ settings }, { fetchFn: quiet.fetchFn, prefs: () => prefs, connection: off, doc: null });
    r.listed(list);
    assert.equal(r.pressed(list[0]), null, 'a press starts nothing');
    await flush();
    assert.deepEqual(quiet.calls, { list: 0, link: 0 });
  }
});

test('a press starts the resolve, the tap takes it; the answer is kept ten minutes and then asked afresh', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const tb = torbox(), ready = new ReadyAhead({ settings: {} }, { fetchFn: tb.fetchFn, prefs: () => ({ dataSaver: 'never' }), connection: off, doc: null });
  const s = torrentio('tok-a', 3);
  const pressed = ready.pressed(s);
  assert.ok(pressed, 'a finger came down: the resolve is under way');
  const tapped = resolveDebrid(s.url, { fetchFn: tb.fetchFn }); // the tap, while the answer is still on its way
  assert.equal(await tapped, 'https://cdn.example/3/7');
  assert.equal(await pressed, await tapped);
  assert.deepEqual(tb.calls, { list: 1, link: 1 }, 'asked once');
  assert.equal(ready.pressed(plain()), null, 'an address that needs no resolving: nothing');
  now += 9 * 60e3;
  await resolveDebrid(s.url, { fetchFn: tb.fetchFn });
  assert.equal(tb.calls.link, 1, 'within ten minutes: from memory');
  now += 2 * 60e3;
  await resolveDebrid(s.url, { fetchFn: tb.fetchFn });
  assert.deepEqual(tb.calls, { list: 2, link: 2 }, 'after ten minutes: asked again');
});

test('the next episode is made ready when its card is due or a known outro is near', () => {
  assert.equal(nextDueSoon(10, 1500, { cardDue: true }), true);
  const outro = [{ type: 'outro', start: 1400, end: 1490 }];
  assert.equal(nextDueSoon(1200, 1500, { segments: outro }), false);
  assert.equal(nextDueSoon(1281, 1500, { segments: outro }), true, 'two minutes before the outro');
  assert.equal(nextDueSoon(1490, 1500), false, 'neither: the card itself says when');
});

/** An app playing episode 1 of release group `group`, whose add-ons list `streams` for episode 2. */
function fakeApp(group, streams, settings = {}) {
  const asked = { collect: 0 };
  const next = { id: 'tt0000301:1:2' };
  class Streams { constructor(app, meta, video) { this.video = video; } async collect() { asked.collect++; return streams; } }
  return { asked, next, app: { settings, playing: { meta: { id: 'tt0000301', type: 'series' }, next }, player: { stream: { bingeGroup: group } }, screenTypes: { streams: Streams } } };
}
const src = (id, group) => ({ id, stream: { url: `https://cdn.example/${id}.mkv`, bingeGroup: group } });

test('the next episode: collected, and described only for the same release group; Next within ten minutes takes the list; nothing with the switch off or the saver on', async () => {
  let now = 0;
  const probed = [];
  const probe = async (url, { onSource }) => { probed.push(url); const s = { bytesFetched: 70_000, close() {} }; onSource(s); return { readable: true, source: s }; };
  const resolve = async (url) => url;
  const list = [src('a', 'other'), src('b', 'grp')];
  const f = fakeApp('grp', list);
  const nr = new NextReady(f.app, { probe, resolve, saver: () => false, now: () => now });
  const job = await nr.prepare();
  assert.deepEqual(probed, ['https://cdn.example/b.mkv'], 'the same release group’s file is described, nothing else');
  assert.equal(job.described, true);
  assert.equal(nr.spent, 70_000, 'what describing cost is counted');
  await nr.prepare();
  assert.equal(f.asked.collect, 1, 'once per episode');
  now = KEEP - 1;
  assert.equal(nr.take(f.next, 'grp'), list, 'Next takes what was collected');
  assert.equal(nr.take(f.next, 'grp'), null, 'once');
  // Too late, or another group playing by then: asked afresh.
  await nr.prepare(); now += KEEP + 1;
  assert.equal(nr.take(f.next, 'grp'), null);
  now = 0; await nr.prepare();
  assert.equal(nr.take(f.next, 'another'), null);
  // No stream of the same release: nothing described, nothing kept (the sources panel waits as before).
  const g = fakeApp('grp', [src('a', 'other')]), lone = new NextReady(g.app, { probe, resolve, saver: () => false });
  probed.length = 0;
  await lone.prepare();
  assert.deepEqual(probed, []);
  assert.equal(lone.take(g.next, 'grp'), null);
  // The switch off, or the saver on: not even the add-ons are asked.
  for (const [settings, saver] of [[{ readyAhead: false }, false], [{}, true]]) {
    const h = fakeApp('grp', list, settings), quiet = new NextReady(h.app, { probe, resolve, saver: () => saver });
    assert.equal(await quiet.prepare(), null);
    assert.equal(h.asked.collect, 0);
  }
});

test('a film described for the first time: its tail is asked for beside its start, and a read of the end waits for it', async () => {
  const h = host({ pace: 4 });
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn: h.fetchFn, memory: null, connection: null });
  source.probing = true;
  await source.open();
  const SIZE = source.size;
  assert.deepEqual(h.calls.map((c) => [c.from, c.to]), [[0, SIZE], [SIZE - TAIL, SIZE]], 'both ends asked at once');
  // The probe reads the end before the tail has arrived: it waits for it rather than starting a download.
  const end = await source.read(SIZE - 70_000, SIZE);
  assert.equal(end.length, 70_000);
  assert.equal(h.calls.length, 2);
  assert.ok(source.has(SIZE - 65536, SIZE), 'the subtitle hash’s chunk is in the reader');
  source.close();
  // A film opened again for playback (not described), and a small one, ask for no tail.
  for (const [probing, size] of [[false, 64 << 20], [true, 2 << 20]]) {
    const k = host({ pace: 1, size });
    const s = new HttpSource('https://files.example/film.mkv', { fetchFn: k.fetchFn, memory: null, connection: null });
    s.probing = probing;
    await s.open();
    await flush();
    assert.equal(k.calls.length, 1);
    s.close();
  }
});
