// The lab's "Server speed" (frontend/astra/src/lab/server-speed.js) without a browser: each of TorBox's server groups
// is timed from the phone by reading its test file's first 1 MB, three at a time, twenty groups at most, fastest
// first; a group the page cannot read is said so and goes last; and the report's lines carry the group, the region,
// the speed and the first byte's time, the film's own group marked, and never an address. The page itself is in
// astra-torbox-check-browser.test.mjs. Invented hosts and groups only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeServers, speedLines, fastest, PIECE, MAX, AT_ONCE } from '../frontend/astra/src/lab/server-speed.js';

const group = (g, region = `Invented ${g}`) => ({ group: g, region, url: `https://speed.${g}.tb-cdn.example/test/1mb.bin` });

/** A file host: each group answers its 1 MB after `delay[g]` ms (or refuses with `refuse`), counting what is open. */
function files(delay = {}, refuse = new Set()) {
  const seen = { open: 0, peak: 0, asked: [] };
  const fetchFn = async (url, init) => {
    const g = new URL(url).hostname.split('.')[1];
    seen.asked.push({ g, range: init.headers.Range, credentials: init.credentials });
    if (refuse.has(g)) throw new TypeError('Failed to fetch');
    seen.open++; seen.peak = Math.max(seen.peak, seen.open);
    await new Promise((r) => setTimeout(r, delay[g] ?? 5));
    seen.open--;
    return new Response(new Uint8Array(PIECE), { status: 206, headers: { 'content-length': String(PIECE) } });
  };
  return { seen, fetchFn };
}

test('each group is read for 1 MB, three at a time, twenty at most, and the table is fastest first', async () => {
  const servers = Array.from({ length: 25 }, (_, i) => group(`g${i}`));
  const f = files({ g0: 40, g1: 5, g2: 20 });
  const heard = [];
  const rows = await timeServers(servers, { fetchFn: f.fetchFn, onRow: (row) => heard.push(row.group) });
  assert.equal(rows.length, MAX, 'twenty groups at most: 20 MB');
  assert.equal(f.seen.asked.length, MAX);
  assert.ok(f.seen.peak <= AT_ONCE, `at most ${AT_ONCE} at once (saw ${f.seen.peak})`);
  assert.ok(f.seen.asked.every((a) => a.range === `bytes=0-${PIECE - 1}` && a.credentials === 'omit'));
  assert.equal(heard.length, MAX, 'each row heard as it ends');
  assert.deepEqual(rows.map((r) => r.mbps), [...rows.map((r) => r.mbps)].sort((a, b) => b - a));
  assert.ok(rows.every((r) => r.mbps > 0 && r.first >= 0 && r.region.startsWith('Invented')));
});

test('a group the page cannot read is said so and goes last; a stop ends it', async () => {
  const f = files({}, new Set(['bad']));
  const rows = await timeServers([group('bad'), group('latm'), group('wnam')], { fetchFn: f.fetchFn });
  assert.deepEqual(rows.map((r) => r.group).at(-1), 'bad');
  assert.deepEqual([rows.at(-1).mbps, rows.at(-1).error], [null, 'not readable by the page']);
  const stop = new AbortController();
  stop.abort();
  assert.deepEqual(await timeServers([group('latm')], { fetchFn: files().fetchFn, signal: stop.signal }), []);
  assert.deepEqual(fastest([{ mbps: null }, { mbps: 3 }, { mbps: 9 }]).map((r) => r.mbps), [9, 3, null]);
});

test('the report’s lines: group, region, speed, first byte, the film’s group marked, and no address', () => {
  const rows = [{ group: 'latm', region: 'Invented South', mbps: 41.5, first: 120 }, { group: 'wnam', region: '', mbps: null, first: null, error: 'not readable by the page' }];
  const lines = speedLines(rows, 'latm');
  assert.match(lines[0], /^Server speed \(1 MB from each/);
  assert.equal(lines[1], '    latm (Invented South): 41.5 Mbit/s, first byte 120 ms  ← your film’s server in the last check');
  assert.equal(lines[2], '    wnam: not readable by the page');
  assert.ok(!lines.join('\n').includes('tb-cdn') && !lines.join('\n').includes('https:'));
  assert.deepEqual(speedLines([], 'latm'), []);
});
