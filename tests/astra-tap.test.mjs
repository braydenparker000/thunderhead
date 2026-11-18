// Between a tap and the first picture (frontend/astra/src/app/ready.js, next-ready.js, addons/debrid.js,
// engine/source-tail.js): what is done ahead for a list of streams and a saver state (only a connection to
// the owner's server), the press that asks the server ahead and the tap that takes its answer (on a fake
// clock), the next episode made ready only for the same release group and only from a direct address, and the
// film's tail asked for beside its start. The server, add-ons and hosts are stand-ins.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readyWork, soundOf, saverNow, ReadyAhead } from '../frontend/astra/src/app/ready.js';
import { NextReady, nextDueSoon, KEEP } from '../frontend/astra/src/app/next-ready.js';
import { forgetAnswers, resolveStream } from '../frontend/astra/src/addons/debrid.js';
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
const torrentio = (n) => ({ name: 'TB 1080p', title: `Film ${n}.mkv`, url: `https://addon.example/resolve/torbox/invented-key/${HASH(n)}/null/0/Film%20${n}.mkv` });
const plain = (title = 'Film 1080p AAC') => ({ name: 'Host', title, url: 'https://cdn.example/film.mp4' });
const local = { name: 'Local', title: 'x', url: 'http://127.0.0.1:9/film.mkv' };
const off = { saveData: false, type: 'wifi' };

/** The owner's server's stand-in: counts asks by mode; ahead answers an address only for what is "in the account". */
function server(owned = () => true) {
  const calls = { ahead: 0, play: 0 };
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls[body.mode]++;
    const url2 = body.mode === 'play' || owned(body) ? `https://cdn.example/${body.hash.slice(-1)}/7` : null;
    return new Response(JSON.stringify({ url: url2, via: url2 ? 'torbox' : null, steps: [] }), { status: 200 });
  };
  const resolve = (stream, o = {}) => resolveStream(stream, { ...o, fetchFn, read: async () => ({ api: 'https://api.example', token: 'invented-session' }) });
  return { calls, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => forgetAnswers());

test('what is done ahead for a list: a connection to the server when a link could be asked about, the converters labels ask for; nothing with the saver on or the switch off', () => {
  const list = [torrentio(1), torrentio(2), plain('Film DDP5.1 x264')];
  const work = readyWork(list, { connection: off });
  assert.deepEqual(work, { preconnect: true, sounds: ['eac3'], metered: false });
  assert.equal(readyWork(list, { connection: { type: 'cellular' } }).metered, true);
  const none = { preconnect: false, sounds: [], metered: false };
  assert.deepEqual(readyWork(list, { saver: true }), none, 'the data saver: nothing');
  assert.deepEqual(readyWork(list, { ahead: false }), none, 'the switch off: nothing');
  assert.deepEqual(readyWork([local], { connection: off }), none, 'a local player’s link: nothing to ask the server');
  assert.deepEqual(['Film TrueHD Atmos 7.1', 'DTS-HD MA', 'DD+ 5.1', 'DD5.1 x264', 'Dolby Digital', 'AAC 2.0', 'ADDED'].map((t) => soundOf({ title: t })), ['truehd', 'dts', 'eac3', 'ac3', 'ac3', null, null]);
});

test('the saver as the player would put it: the setting first, then the connection', () => {
  assert.equal(saverNow({ dataSaver: 'always' }, off), true);
  assert.equal(saverNow({ dataSaver: 'never' }, { saveData: true }), false);
  assert.equal(saverNow({ dataSaver: 'auto' }, { type: 'cellular' }), true);
  assert.equal(saverNow({ dataSaver: 'auto' }, off), false);
});

test('listing opens one connection to the server, signed in, and asks it nothing; with the switch off or the saver on, not even that', async () => {
  const doc = { head: { links: [], querySelector() { return null; }, append(l) { this.links.push(l.href); } }, createElement: () => ({}) };
  const sv = server();
  const ready = new ReadyAhead({ settings: {} }, { resolve: sv.resolve, origin: async () => 'https://api.example', prefs: () => ({ dataSaver: 'never' }), connection: off, doc });
  const list = [torrentio(1), torrentio(2)];
  ready.listed(list); ready.listed(list); ready.listed(list); // drawn again as add-ons answer
  await flush();
  assert.deepEqual(doc.head.links, ['https://api.example'], 'one connection, to the server only');
  assert.deepEqual(sv.calls, { ahead: 0, play: 0 }, 'nothing asked before a press');
  const out = new ReadyAhead({ settings: {} }, { resolve: sv.resolve, origin: async () => '', prefs: () => ({ dataSaver: 'never' }), connection: off, doc });
  out.listed(list);
  await flush();
  assert.equal(doc.head.links.length, 1, 'signed out: no connection');
  for (const [settings, prefs] of [[{ readyAhead: false }, { dataSaver: 'never' }], [{}, { dataSaver: 'always' }]]) {
    const quiet = server(), r = new ReadyAhead({ settings }, { resolve: quiet.resolve, origin: async () => 'https://api.example', prefs: () => prefs, connection: off, doc: null });
    r.listed(list);
    assert.equal(r.pressed(list[0]), null, 'a press starts nothing');
    await flush();
    assert.deepEqual(quiet.calls, { ahead: 0, play: 0 });
  }
});

test('a press asks ahead and the tap takes its address; one not in the account yet is asked to play at the tap; kept 45 minutes', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const sv = server((body) => body.hash !== HASH(9));
  const ready = new ReadyAhead({ settings: {} }, { resolve: sv.resolve, origin: async () => '', prefs: () => ({ dataSaver: 'never' }), connection: off, doc: null });
  const s = torrentio(3);
  const pressed = ready.pressed(s);
  assert.ok(pressed, 'a finger came down: the ask is under way');
  const tapped = await sv.resolve(s, { mode: 'play' }); // the tap, while the answer is still on its way
  assert.equal(tapped.url, 'https://cdn.example/3/7');
  assert.equal(await pressed, tapped);
  assert.deepEqual(sv.calls, { ahead: 1, play: 0 }, 'asked once, ahead');
  assert.equal(ready.pressed(local), null, 'a local player’s link: nothing');
  const fresh = torrentio(9);
  assert.equal((await ready.pressed(fresh)).via, 'addon', 'not in the account: no address ahead, nothing added');
  assert.equal((await sv.resolve(fresh, { mode: 'play' })).url, 'https://cdn.example/9/7');
  assert.deepEqual(sv.calls, { ahead: 2, play: 1 }, 'the tap asked to play');
  now += 44 * 60e3;
  await sv.resolve(s, { mode: 'play' });
  assert.equal(sv.calls.play, 1, 'within 45 minutes: from memory');
  now += 2 * 60e3;
  await sv.resolve(s, { mode: 'play' });
  assert.equal(sv.calls.play, 2, 'after 45 minutes: asked again');
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

test('the next episode: collected, and described only for the same release group and a direct address; Next within ten minutes takes the list; nothing with the switch off or the saver on', async () => {
  let now = 0;
  const probed = [];
  const probe = async (url, { onSource }) => { probed.push(url); const s = { bytesFetched: 70_000, close() {} }; onSource(s); return { readable: true, source: s }; };
  const asked = [];
  // The server's answer ahead: a direct address for b (in the account), none for c (it would need adding).
  const resolve = async (stream, o) => { asked.push([stream.url, o.mode]); return /\/c\.mkv$/.test(stream.url) ? { url: stream.url, via: 'addon' } : { url: stream.url.replace('cdn.example', 'files.example'), via: 'torbox' }; };
  const list = [src('a', 'other'), src('b', 'grp')];
  const f = fakeApp('grp', list);
  const nr = new NextReady(f.app, { probe, resolve, saver: () => false, now: () => now });
  const job = await nr.prepare();
  assert.deepEqual(probed, ['https://files.example/b.mkv'], 'the same release group’s file is described from its direct address, nothing else');
  assert.deepEqual(asked, [['https://cdn.example/b.mkv', 'ahead']], 'asked ahead: nothing is added');
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
  // No direct address ahead (not in the account yet): the add-on's link is never opened before a tap.
  const c = fakeApp('grp', [src('c', 'grp')]), unowned = new NextReady(c.app, { probe, resolve, saver: () => false });
  probed.length = 0;
  const cjob = await unowned.prepare();
  assert.deepEqual([probed, cjob.described, cjob.all.length], [[], false, 1], 'collected, not described');
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
  const end = await source.read(SIZE - 30_000, SIZE);
  assert.equal(end.length, 30_000);
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
