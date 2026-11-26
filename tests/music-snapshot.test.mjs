// Music's library snapshot in parts (frontend/music/src/library/snapshot.js): the single record of before
// (every song with its inline waveform) moves to the new form with nothing lost, waveforms kept apart by
// song id; a move cut off at any write leaves the phone its library, and the next start finishes it; a
// later snapshot replaces the old one's parts and the waveforms no song has. And the library's sort with
// the shown order as a hint (library.js sortTracks) gives the plain sort's order. Invented songs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, saveSnapshot, readWave, touchSnapshot, HEAD, OLD, PART } from '../frontend/music/src/library/snapshot.js';

globalThis.location ??= { href: 'https://site.invalid/music/' };
const { sortTracks, compareTracks } = await import('../frontend/music/src/library/library.js');

/** The `state` store as a Map, with the LibraryDb calls snapshot.js makes; fail(op, key) throws to cut a write off. */
function fakeDb(fail = () => false) {
  const m = new Map();
  const clone = (v) => structuredClone(v);
  const check = (op, k) => { if (fail(op, k)) throw new Error(`cut off at ${op} ${k}`); };
  return {
    m,
    async getState(k) { return m.has(k) ? clone(m.get(k)) : undefined; },
    async setState(k, v) { check('set', k); m.set(k, clone(v)); },
    async deleteState(k) { check('delete', k); m.delete(k); },
    async putStates(pairs) { for (const [k] of pairs) check('set', k); for (const [k, v] of pairs) m.set(k, clone(v)); },
    async deleteStates(keys) { for (const k of keys) check('delete', k); for (const k of keys) m.delete(k); },
    async stateKeys(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

const wave = (i) => Buffer.from(Array.from({ length: 100 }, (_, k) => (i * 7 + k * 13) % 256)).toString('base64');
const song = (i) => ({ id: 'song' + i, remote: true, title: `Invented ${i}`, artist: `Band ${i % 9}`, album: `Album ${i % 40}`, albumArtist: '', track: i % 12, disc: 1, durationMs: 1000 * (100 + i), plays: i % 5, rating: i % 6, ...(i % 3 ? { waveB64: wave(i) } : {}) });
const oldRecord = (n) => ({ generatedAt: 'gen-1', savedAt: 1234, tracks: Array.from({ length: n }, (_, i) => song(i)) });

test('the old single record moves to parts with its waveforms kept apart; nothing is lost', async () => {
  const db = fakeDb();
  const old = oldRecord(1203);
  db.m.set(OLD, structuredClone(old));
  db.m.set('u:song4', { rating: 5, plays: 9 });
  const first = await readSnapshot(db);
  assert.equal(first.old, true);
  assert.equal(first.tracks.length, 1203);
  await saveSnapshot(db, first);
  assert.equal(db.m.has(OLD), false, 'the old record goes once the new form is written');
  const head = db.m.get(HEAD);
  assert.equal(head.v, 2);
  assert.equal(head.count, 1203);
  assert.equal(head.parts, Math.ceil(1203 / PART));
  assert.ok([...db.m.keys()].filter((k) => k.startsWith('r2:p:')).length === head.parts);
  assert.deepEqual(db.m.get('u:song4'), { rating: 5, plays: 9 }, "a song's own data stays");
  const again = await readSnapshot(db, () => {});
  assert.equal(again.old, false);
  assert.equal(again.generatedAt, 'gen-1');
  assert.equal(again.savedAt, 1234);
  assert.deepEqual(again.tracks.map((t) => t.id), old.tracks.map((t) => t.id), 'every song, in order');
  for (const [i, t] of again.tracks.entries()) {
    const was = old.tracks[i];
    const { waveB64, ...rest } = was;
    assert.deepEqual({ ...t, waveB64: undefined }, { ...rest, waveB64: undefined }, 'the same fields (plays, rating)');
    assert.equal(t.waveB64, waveB64 ? true : undefined);
    assert.equal(await readWave(db, t.id), waveB64 ?? null, 'the waveform kept apart, intact');
  }
  // Parts are read one by one, each passed on as it comes.
  let parts = 0;
  await readSnapshot(db, (p) => { parts++; assert.ok(p.length <= PART); });
  assert.equal(parts, head.parts);
});

for (const at of ['part', 'wave', 'head', 'cleanup', 'old']) {
  test(`a move cut off at the ${at} write leaves the library whole, and the next start finishes it`, async () => {
    let armed = true;
    const fail = (op, k) => armed && ((at === 'part' && op === 'set' && /^r2:p:.*:0001$/.test(k)) || (at === 'wave' && op === 'set' && k.startsWith('r2:w:')) ||
      (at === 'head' && op === 'set' && k === HEAD) || (at === 'cleanup' && op === 'delete' && k.startsWith('r2:')) || (at === 'old' && op === 'delete' && k === OLD));
    const db = fakeDb(fail);
    const old = oldRecord(1100);
    db.m.set(OLD, structuredClone(old));
    const first = await readSnapshot(db);
    await saveSnapshot(db, first).catch(() => {});
    // The next start: the library is all there, waveforms included (inline in the old record, or apart).
    const next = await readSnapshot(db);
    assert.deepEqual(next.tracks.map((t) => t.id), old.tracks.map((t) => t.id));
    for (const [i, t] of next.tracks.entries()) {
      const w = old.tracks[i].waveB64;
      if (next.old) assert.equal(t.waveB64, w);
      else assert.equal(t.waveB64 === true ? await readWave(db, t.id) : undefined, w);
    }
    armed = false;
    if (next.old) await saveSnapshot(db, next);
    else await readSnapshot(db); // (deletes an old record left behind)
    await new Promise((r) => setTimeout(r, 0));
    const done = await readSnapshot(db);
    assert.equal(done.old, false);
    assert.equal(db.m.has(OLD), false);
    const head = db.m.get(HEAD);
    assert.ok([...db.m.keys()].filter((k) => k.startsWith('r2:p:')).every((k) => k.startsWith(`r2:p:${head.id}:`)), 'no parts of the cut-off write left');
    for (const [i, t] of done.tracks.entries()) assert.equal(t.waveB64 === true ? await readWave(db, t.id) : undefined, old.tracks[i].waveB64);
  });
}

test('a later snapshot replaces the parts; waveforms of songs gone or without one go; the head alone is touched', async () => {
  const db = fakeDb();
  await saveSnapshot(db, { generatedAt: 'g1', savedAt: 1, tracks: Array.from({ length: 700 }, (_, i) => song(i)) });
  const firstId = db.m.get(HEAD).id;
  const fresh = Array.from({ length: 600 }, (_, i) => song(i + 50));
  await saveSnapshot(db, { generatedAt: 'g2', savedAt: 2, tracks: fresh });
  const head = db.m.get(HEAD);
  assert.notEqual(head.id, firstId);
  assert.equal([...db.m.keys()].some((k) => k.startsWith(`r2:p:${firstId}:`)), false);
  const waves = [...db.m.keys()].filter((k) => k.startsWith('r2:w:')).sort();
  assert.deepEqual(waves, fresh.filter((t) => t.waveB64).map((t) => 'r2:w:' + t.id).sort());
  await touchSnapshot(db, 99);
  const read = await readSnapshot(db);
  assert.equal(read.savedAt, 99);
  assert.equal(read.generatedAt, 'g2');
  assert.equal(read.tracks.length, 600);
  // Songs read back (waveB64: true) and written again keep their waveforms.
  await saveSnapshot(db, read);
  assert.deepEqual([...db.m.keys()].filter((k) => k.startsWith('r2:w:')).sort(), waves);
});

test("the library's hinted sort gives the plain sort's order, ties in the list's own order", () => {
  let seed = 7;
  const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const mk = (i) => ({ id: 'id' + i, albumArtist: rand(3) ? `Artist ${rand(20)}` : '', artist: `Artist ${rand(20)}`, album: `Album ${rand(15)}`, disc: rand(2), track: rand(8), title: `Title ${rand(30)}` });
  for (let round = 0; round < 20; round++) {
    const prevList = Array.from({ length: 400 }, (_, i) => mk(i));
    const prev = sortTracks(prevList.slice());
    assert.deepEqual(prev, prevList.slice().sort(compareTracks));
    // A refresh: new records for the same ids, some changed, some gone, some new, in another order.
    const next = prev.filter(() => rand(10)).map((t) => (rand(5) ? { ...t } : mk(Number(t.id.slice(2))))).concat(Array.from({ length: 30 }, (_, i) => mk(1000 + i)));
    for (let i = next.length - 1; i > 0; i--) { const j = rand(i + 1); [next[i], next[j]] = [next[j], next[i]]; }
    const plain = next.slice().sort(compareTracks);
    assert.deepEqual(sortTracks(next.slice(), prev), plain);
    assert.deepEqual(sortTracks(plain.slice(), []), plain, 'a sorted list stays as it is');
  }
});
