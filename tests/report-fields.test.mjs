// The editor's reports, without a browser: what a report may hold (frontend/th/report/fields.js, one list for the
// phone, its background worker and the reader) and how the reader lays out a visit (scripts/reports.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../frontend/th/report/fields.js';
import { line, timeline, visits } from '../scripts/reports.mjs';

const F = /** @type {any} */ (globalThis).thReportFields;

test('an event keeps its known fields only, and names the ones it dropped', () => {
  assert.deepEqual(F.clean({ kind: 'open', ms: 8127.4, file: 'raf', decode: 1399, name: 'DSCF0042.RAF', quick: false }), { ok: { kind: 'open', ms: 8127, file: 'raf', decode: 1399, quick: false }, dropped: ['name'] });
  assert.deepEqual(F.clean({ kind: 'lost', ms: 0, job: 'copy', since: 6012.4, mb: 231, peakMb: 254, budgetMb: 480, level: 1, again: 1, calm: 0, gpu: 'mali' }).ok, { kind: 'lost', ms: 0, job: 'copy', since: 6012, mb: 231, peakMb: 254, budgetMb: 480, level: 1, again: 1, calm: 0 });
  assert.deepEqual(F.clean({ kind: 'begin', job: 'starfish' }).ok, { kind: 'begin', job: 'starfish' });
  assert.deepEqual(F.clean({ kind: 'end', job: 'copy', outcome: 'left', ms: 912.6 }).ok, { kind: 'end', job: 'copy', outcome: 'left', ms: 913 });
  assert.deepEqual(F.clean({ kind: 'phone', model: 'SM-A155F', android: '14.0.0', cores: 8, memory: 4, dpr: 262.5 }).ok, { kind: 'phone', model: 'SM-A155F', android: '14.0.0', cores: 8, memory: 4, dpr: 263 });
  assert.deepEqual(F.clean({ kind: 'gpu', vendor: 'arm', arch: 'valhall' }).ok, { kind: 'gpu', vendor: 'arm', arch: 'valhall' });
  assert.deepEqual(F.clean({ kind: 'mark', x: 0.123456, y: 0.5, zoom: 2.25, a: 'classic', b: 'network', picked: 'network' }).ok, { kind: 'mark', x: 0.1235, y: 0.5, zoom: 2.25, a: 'classic', b: 'network', picked: 'network' });
  assert.deepEqual(F.clean({ kind: 'move', ms: 900, ran: 'tile copy long' }).ok, { kind: 'move', ms: 900, ran: 'tile copy long' });
  assert.deepEqual(F.clean({ kind: 'swipe', ms: 412.2, frames: 25, worst: 33, steps: 1, back: 0, refit: 0, rebuilt: 0, outcome: 'landed' }).ok, { kind: 'swipe', ms: 412, frames: 25, worst: 33, steps: 1, back: 0, refit: 0, rebuilt: 0, outcome: 'landed' });
  // words are fixed: anything else is dropped, never kept as written
  assert.deepEqual(F.clean({ kind: 'lost', ms: 0, job: '<script>', ran: 'tile; rm', model: '../../etc' }), { ok: { kind: 'lost', ms: 0 }, dropped: ['job', 'ran', 'model'] });
  assert.equal(F.clean({ kind: 'spy', ms: 1 }).ok, null, 'an unknown kind is no event');
  assert.equal(F.known('mb') && F.known('job') && !F.known('title'), true);
});

test('every field the editor and the engine record is on the list', async () => {
  const { readFileSync } = await import('node:fs'), { execSync } = await import('node:child_process');
  const files = execSync('git ls-files frontend/lab', { encoding: 'utf8' }).split('\n').filter((f) => /\.js$/.test(f));
  const missing = new Set();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bnote\('(\w+)',[^,]+,\s*\{([^}]*)\}/g)) {
      if (!F.KINDS.includes(m[1])) missing.add(`${f}: kind ${m[1]}`);
      for (const k of m[2].matchAll(/(?:^|[,{]\s*)(\w+)\s*:/g)) if (!F.known(k[1])) missing.add(`${f}: ${m[1]}.${k[1]}`);
    }
  }
  assert.deepEqual([...missing], [], 'a field not on the list would be dropped (th/report/fields.js)');
});

test('the reader: each visit in order, an event sent twice once, a reset and a death said plainly', () => {
  const at = Date.UTC(2026, 10, 17, 0, 39, 21), s = { id: 'mh3x2k1abcd', at, build: 'cd59347', closed: 0, died: 1 };
  const doc = { v: 2, day: '2026-11-17', phone: { model: 'SM-A155F' }, sessions: [s], events: [
    { s: s.id, n: 1, at, kind: 'begin', job: 'open' }, { s: s.id, n: 2, at: at + 5384, kind: 'end', job: 'open', outcome: 'done', ms: 5384 },
    { s: s.id, n: 3, at: at + 6000, kind: 'begin', job: 'copy' }, { s: s.id, n: 4, at: at + 9000, kind: 'lost', ms: 0, job: 'copy', mb: 231, peakMb: 282, budgetMb: 480 },
    { s: s.id, n: 5, at: at + 9001, kind: 'died', job: 'copy', hidden: 0 }] };
  const v = visits([doc, { ...doc, events: doc.events.slice(0, 2) }]);
  assert.equal(v.length, 1);
  assert.equal(v[0].events.length, 5, 'the same event twice is kept once');
  const text = timeline(v[0]);
  assert.match(text, /^SM-A155F · 2026-11-17 00:39:21 UTC · build cd59347 · DIED/);
  assert.match(text, /9\.0 s {2}✖ RESET \(blamed copy, 231 MB held, peak 282, budget 480\)/);
  assert.match(text, /✖ DIED while copy/);
  assert.equal(line({ kind: 'end', job: 'open', outcome: 'done', ms: 5384 }), '■ open done 5384 ms');
});
