// The guitar teacher's reading of a tab (frontend/th/guitar/teacher.js; GUITAR.md §6), on the real
// engine's timeline of the synthetic practice score (tests/fixtures/guitar/practice-timeline.json)
// and on a made-up fast run: sections in score order (repeats once), what each asks of the hands,
// at most three tips, each with whose approach it follows and never a quotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featuresOf, sectionsOf, TEMPLATES, tipsFor } from '../frontend/th/guitar/teacher.js';

const TL = JSON.parse(readFileSync(new URL('./fixtures/guitar/practice-timeline.json', import.meta.url), 'utf8'));

test("sections: the tab's own, in score order, a repeat counted once", () => {
  const s = sectionsOf(TL);
  assert.deepEqual(s.slice(0, 2), [
    { label: 'Intro', from: 0, to: 1 },
    { label: 'Verse', from: 2, to: 5 },
  ]);
  // Without names: 8 bars at a time.
  const plain = { ...TL, bars: Array.from({ length: 20 }, (_, i) => ({ mb: i, start: i * 3840, end: (i + 1) * 3840, section: '' })), events: [] };
  assert.deepEqual(sectionsOf(plain).map((x) => x.label), ['Bars 1–8', 'Bars 9–16', 'Bars 17–20']);
});

test('the practice score: strummed chords in the intro; a barre, a bend and a shift in the verse', () => {
  const [intro, verse] = sectionsOf(TL);
  assert.equal(featuresOf(TL, intro).bpm, 96);
  assert.deepEqual(tipsFor(TL, intro).map((t) => t.id), ['rhythm-first']);
  const ids = tipsFor(TL, verse).map((t) => t.id);
  assert.ok(ids.includes('barre') && ids.includes('bends'), ids.join());
  assert.ok(ids.length <= 3);
});

test('a fast run: slow practice first, at a slow tempo, and a strict right hand', () => {
  const ppq = 960;
  const events = Array.from({ length: 32 }, (_, i) => ({ t: i * (ppq / 4), d: ppq / 4, q: 0, st: 0, n: [{ s: i % 3, f: 5 + (i % 4), m: 60, d: ppq / 4, fl: 0 }] }));
  const tl = { ppq, tempos: [[0, 140]], bars: [{ mb: 0, start: 0, end: 8 * ppq, section: 'Solo' }], events };
  const [solo] = sectionsOf(tl);
  const tips = tipsFor(tl, solo);
  assert.deepEqual(tips.map((t) => t.id).slice(0, 2), ['slow-first', 'alternate']);
  assert.match(tips[0].hint, /9\.3 notes a second at 140 BPM/);
  assert.match(tips[0].show, /at 84 BPM/);
});

test('every tip names its approach and quotes nobody', () => {
  const f = { bars: 16, bpm: 120, fastest: 10, span: 6, spanBar: 0, shifts: 2, shift: 7, barres: 1, barreFret: 3, legato: 8, slides: 3, bends: 2, vibrato: 1, palmMute: 6, harmonics: 1, strums: 6, changesPerSecond: 1, notes: 100 };
  const sec = { label: 'Any', from: 0, to: 15 };
  for (const t of TEMPLATES) {
    assert.ok(t.weight(f) > 0, `${t.id} applies to a hard section`);
    const tip = t.tip(f, sec);
    for (const text of [tip.hint, tip.show, tip.after]) assert.doesNotMatch(text, /["“”]/, `${t.id}: no quotation`);
    assert.ok(tip.after.length > 5 && tip.hint.length <= 160);
  }
});
