// The lab's TorBox check (frontend/astra/src/lab/torbox-check.js, scrub.js) without a browser: every step's line
// against a stubbed Worker helper and the test film host (tests/fixtures/astra-host.mjs, read with node's fetch,
// probed by the engine itself); a phone signed out; no TorBox key in the Worker; the connection limit at a host
// that refuses a fifth; and a report with no address, hash, key or file name in it, whatever the steps said.
// The page itself, and an address a page may not read, are in astra-torbox-check-browser.test.mjs. Invented
// hosts, hashes and keys only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { astraHost } from './fixtures/astra-host.mjs';
import { until } from './fixtures/waits.mjs';
import { torboxCheck, checkReport, limitTest, hashIn, deviceLine } from '../frontend/astra/src/lab/torbox-check.js';
import { scrubSecrets, serverGroup } from '../frontend/astra/src/lab/scrub.js';
import { probe } from '../frontend/astra/src/engine/probe.js';
import { planPlayback } from '../frontend/astra/src/engine/plan.js';

const HASH = '0123456789abcdef0123456789abcdef01234567'; // invented
const KEY = 'tbk_invented_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const LINK = `https://addon.example/eyJzZXJ2aWNlIjoidG9yYm94Iiwia2V5IjoiaW52ZW50ZWQifQ/playback/${HASH}/torbox/0/Invented.Film.2024.1080p.mkv`;
const CAPS = { mse: () => true, native: () => true, opusEncode: true, software: false };
let host;
before(async () => { host = await astraHost(); });
after(() => host.close());

/** The Worker helper as the page will have it: parsed JSON, or an Error with the plain reason (and `.steps`). */
function stubApi({ session = true, torbox = { configured: true, ok: true, plan: 2 }, play } = {}) {
  const asked = [];
  const api = async (path, { method = 'GET', body } = {}) => {
    asked.push({ path, method, body });
    if (!session) throw new Error('not signed in');
    if (path === '/v1/astra/torbox') return torbox;
    if (path === '/v1/astra/play') { if (play instanceof Error) throw play; return play; }
    throw new Error('not found');
  };
  return { api, asked };
}
const run = (api, more = {}) => torboxCheck(LINK, { api, probe, plan: planPlayback, caps: CAPS, ...more });
const lines = (steps, id) => steps.find((s) => s.id === id).lines.join('\n');
const state = (steps) => Object.fromEntries(steps.map((s) => [s.id, s.state]));
const clean = (text, film) => {
  for (const secret of [LINK, HASH, KEY, film, 'Invented.Film', 'addon.example', '127.0.0.1', new URL(film).pathname, 'eyJzZXJ2aWNl'])
    assert.ok(!text.includes(secret), `the report holds ${secret}`);
};

test('every step from a signed-in phone, each with its line, and a report with no address, hash, key or file name', async () => {
  host.reset();
  const film = host.link('multi.mkv', 'tok_Invented0123456789abcdefABCDEF');
  const { api, asked } = stubApi({ play: { url: film, via: 'torbox', size: 939230, type: 'video/x-matroska', readable: true, steps: [
    { step: 'key', ok: true, ms: 12 }, { step: 'cached', ok: true, ms: 81, note: `cached (asked https://api.torbox.example/v1?token=${KEY} for ${HASH})` }, { step: 'link', ok: true, ms: 140 },
  ] } });
  const seen = [];
  const steps = await run(api, { onStep: (s) => seen.push(`${s.id}:${s.state}`) });
  assert.deepEqual(state(steps), { a: 'ok', b: 'ok', c: 'ok', d: 'ok', e: 'ok', f: 'info', g: 'ok' });
  assert.ok(seen.includes('d:run') && seen.indexOf('d:run') < seen.indexOf('d:ok'), 'each step is shown as it runs');
  assert.deepEqual(asked.map((a) => [a.path, a.method]), [['/v1/astra/torbox', 'GET'], ['/v1/astra/play', 'POST']]);
  assert.deepEqual(asked[1].body, { link: LINK, hash: HASH, mode: 'play' }, 'the link, the hash read from it, a tap');
  assert.match(lines(steps, 'b'), /key is set, accepted by TorBox, plan 2/);
  assert.match(lines(steps, 'c'), /via torbox · readable by a page · 939 kB · video\/x-matroska/);
  assert.match(lines(steps, 'c'), /^key ✓ 12 ms$/m);
  assert.match(lines(steps, 'd'), /First 64 KiB: 206, readable, 64 KiB read \(first byte \d+ ms/);
  assert.match(lines(steps, 'd'), /Last 64 KiB: 206, readable, 64 KiB read/);
  assert.match(lines(steps, 'd'), /File size: 939 kB/);
  assert.match(lines(steps, 'd'), /Server: not one of TorBox’s file servers/);
  assert.match(lines(steps, 'e'), /917 KiB in [\d.]+ s: [\d.]+ Mbit\/s/, 'a film under 2 MB is read whole');
  assert.match(lines(steps, 'f'), /Four at once: 206 206 206 206\.\nThe fifth, beside them: 206\./);
  assert.match(lines(steps, 'g'), /matroska/i);
  assert.match(lines(steps, 'g'), /Picture: H\.264 /);
  assert.match(lines(steps, 'g'), /Route: remux \(Astra unpacks it\)/);
  const report = checkReport(steps, { link: LINK, device: 'Chrome 131, Android 14' });
  clean(report, film);
  assert.match(report, /^Astra TorBox check, .* UTC, Chrome 131, Android 14\n\(a\) Signed in: ok/);
  assert.match(report, /\(g\) The film: ok/);
  await until(() => host.stats.open === 0, { message: 'nothing is left open' });
});

test('signed out: the check stops at the first step, and asks nothing else', async () => {
  const { api, asked } = stubApi({ session: false });
  const steps = await run(api);
  assert.deepEqual(state(steps), { a: 'bad', b: 'skip', c: 'skip', d: 'skip', e: 'skip', f: 'skip', g: 'skip' });
  assert.match(lines(steps, 'a'), /Not signed in on this phone/);
  assert.equal(asked.length, 1);
  assert.match(checkReport(steps, { link: LINK }), /\(a\) Signed in: FAILED\n {4}Not signed in/);
});

test('no TorBox key in the Worker: said so, and the add-on’s forward is still followed', async () => {
  host.reset();
  const film = host.url('multi.mkv');
  const { api } = stubApi({ torbox: { configured: false, ok: null, plan: null }, play: { url: film, via: 'follow', size: null, type: null, readable: true, steps: [{ step: 'key', ok: false, ms: 0, note: 'no key' }, { step: 'follow', ok: true, ms: 220 }] } });
  const steps = await run(api);
  assert.equal(state(steps).b, 'bad');
  assert.match(lines(steps, 'b'), /No TorBox key is set in the Worker/);
  assert.match(lines(steps, 'c'), /via follow · readable by a page/);
  assert.match(lines(steps, 'c'), /^key ✗ 0 ms: no key$/m);
  assert.match(lines(steps, 'd'), /File size: 939 kB/, 'the size from the answer itself when the Worker had none');
  // The Worker failing: its plain reason and its steps, and nothing read from the phone.
  const failing = Object.assign(new Error('TorBox does not have this film cached.'), { steps: [{ step: 'cached', ok: false, ms: 90 }] });
  const failed = await run(stubApi({ play: failing }).api);
  assert.deepEqual([state(failed).c, state(failed).d], ['bad', 'skip']);
  assert.match(lines(failed, 'c'), /TorBox does not have this film cached \(\d+ ms\)\.\ncached ✗ 90 ms/);
});

test('at a host that allows four connections, the fifth is refused, and all five end at once', async () => {
  host.reset();
  host.control.limit = 4;
  const said = await limitTest(fetch, host.url('multi.mkv'), 939230);
  assert.deepEqual(said.slice(0, 2), ['Four at once: 206 206 206 206.', 'The fifth, beside them: 429.']);
  await until(() => host.stats.open === 0, { message: 'all five ended' });
});

test('the scrubber takes out addresses, keys, hashes and file names; the server group is one label of the host', () => {
  const text = `failed at ${LINK} (redirect https://nexus-123.latm.tb-cdn.example/dl/x?token=${KEY}&id=7) key=${KEY} file Invented.Film.2024.mkv hash ${HASH.toUpperCase()}`;
  const out = scrubSecrets(text);
  for (const s of [HASH, HASH.toUpperCase(), KEY, 'Invented.Film', 'eyJzZXJ2aWNl', '/dl/x']) assert.ok(!out.includes(s), `left ${s}`);
  assert.match(out, /addon\.example\/…/, 'an address keeps its host by default');
  assert.ok(!scrubSecrets(text, { hosts: false }).includes('addon.example'), 'and not even that for the lab report');
  assert.equal(scrubSecrets('a note with x and y', { known: ['x and'] }), 'a note with [removed] y');
  assert.equal(scrubSecrets(`see ${encodeURIComponent(LINK)}`, { known: [LINK] }), 'see [removed]');
  assert.equal(serverGroup('https://nexus-123.latm.tb-cdn.example/dl/1'), 'latm');
  assert.equal(serverGroup('https://store-039.wnam.tb-cdn.example/x'), 'wnam');
  assert.equal(serverGroup('https://nexus.hare.tb-cdn.example/x'), 'hare');
  assert.equal(serverGroup('https://cdn.example/x'), '');
  assert.equal(hashIn(LINK), HASH);
  assert.equal(hashIn('https://addon.example/x?h=' + HASH), null, 'not from the query');
  assert.equal(deviceLine('Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'), 'Chrome 131, Android 14');
});
