// Skip intro for Astra: the sound fingerprint that finds a series' opening by comparing two episodes
// (frontend/astra/src/engine/fingerprint.js, fingerprint-match.js, intro-finder.js), what is kept of
// it (src/app/intro-store.js), and the public skip-times lookup (src/addons/skip-times.js). The sound
// is synthesised here and the services' answers are invented in their published shapes; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fingerprinter, keepEnds, sliceFingerprint, STEP } from '../frontend/astra/src/engine/fingerprint.js';
import { matchRuns, segmentsFrom } from '../frontend/astra/src/engine/fingerprint-match.js';
import { IntroFinder } from '../frontend/astra/src/engine/intro-finder.js';
import { applySave, candidatesOf, introStore, MAX_EPISODES } from '../frontend/astra/src/app/intro-store.js';
import { idQuery, lookupSkipTimes, parseSkipTimes, forgetSkipTimes } from '../frontend/astra/src/addons/skip-times.js';

// --- Synthetic sound: a fixed-seed "song" of notes with partials and a bass, and per-episode backgrounds.
const rng = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
function song(seconds, sr, seed) {
  const r = rng(seed), out = new Float32Array(Math.round(seconds * sr)), scale = [0, 2, 4, 5, 7, 9, 11];
  for (let t = 0; t < seconds;) {
    const len = 0.25 + r() * 0.5, note = 57 + scale[Math.floor(r() * 7)] + 12 * Math.floor(r() * 2), bass = 40 + scale[Math.floor(r() * 7)];
    const f = 440 * 2 ** ((note - 69) / 12), fb = 440 * 2 ** ((bass - 69) / 12), i0 = Math.round(t * sr), i1 = Math.min(out.length, Math.round((t + len) * sr));
    for (let i = i0; i < i1; i++) {
      const x = (i - i0) / sr, env = Math.exp(-3 * x) * Math.min(1, x * 200);
      out[i] += env * (0.3 * Math.sin(2 * Math.PI * f * x) + 0.15 * Math.sin(4 * Math.PI * f * x) + 0.08 * Math.sin(6 * Math.PI * f * x)) + 0.2 * Math.sin(2 * Math.PI * fb * x);
    }
    t += len;
  }
  return out;
}
function background(seconds, sr, seed) {
  const r = rng(seed), out = new Float32Array(Math.round(seconds * sr));
  for (let t = 0; t < seconds;) {
    const len = 1 + r() * 4, f = 100 + r() * 1500, amp = 0.05 + r() * 0.1, i0 = Math.round(t * sr), i1 = Math.min(out.length, Math.round((t + len) * sr));
    for (let i = i0; i < i1; i++) out[i] += amp * Math.sin(2 * Math.PI * f * (i - i0) / sr) * (0.5 + 0.5 * Math.sin(6 * Math.PI * (i - i0) / sr));
    t += len;
  }
  for (let i = 0; i < out.length; i++) out[i] += (r() - 0.5) * 0.04;
  return out;
}
const place = (into, clip, at, sr) => { const i0 = Math.round(at * sr); for (let i = 0; i < clip.length && i0 + i < into.length; i++) into[i0 + i] = into[i0 + i] * 0.3 + clip[i]; };
// "Another encode": low-passed at 3 kHz, 6 dB quieter, with its own noise.
function reencoded(x, sr, seed) {
  const r = rng(seed), a = Math.exp(-2 * Math.PI * 3000 / sr), out = new Float32Array(x.length);
  for (let i = 0, y = 0, y2 = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; y2 = (1 - a) * y + a * y2; out[i] = y2 * 0.5 + (r() - 0.5) * 0.02; }
  return out;
}
const upsample4 = x => { const out = new Float32Array(x.length * 4); for (let i = 0; i < out.length; i++) { const p = i / 4, j = Math.floor(p), b = x[Math.min(j + 1, x.length - 1)]; out[i] = x[j] + (b - x[j]) * (p - j); } return out; };

const SR = 11025, LEN = 240;
const SONG = song(80, SR, 7);
const ep1 = background(LEN, SR, 1); place(ep1, SONG, 45, SR);
const ep2 = background(LEN, SR, 2); place(ep2, reencoded(SONG, SR, 9), 130, SR);
// Episode 2 also as 44.1 kHz stereo (its right side a little quieter), to go through the resampler.
const ep2L = upsample4(ep2), ep2R = ep2L.map(v => v * 0.8);

/** Feeds [from, to) seconds of a sound in chunks of `chunk` samples. */
function feedRange(f, chans, sr, from, to, chunk = 4096) {
  for (let i = Math.round(from * sr), end = Math.round(to * sr); i < end; i += chunk) f.feed(chans.map(c => c.subarray(i, Math.min(i + chunk, end))), sr, i / sr);
}
const printOf = (chans, sr, ranges = [[0, chans[0].length / sr]], chunk) => { const f = new Fingerprinter(); for (const [a, b] of ranges) feedRange(f, chans, sr, a, b, chunk); return f.fingerprint(); };
const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 1, `${what}: ${got} is not within 1 s of ${want}`);

const fp1 = printOf([ep1], SR);

test('the same song in two episodes is found at both places, within a second at each end, through another encode', () => {
  const runs = matchRuns(fp1, printOf([ep2L, ep2R], SR * 4, undefined, 1500));
  assert.equal(runs.length, 1, JSON.stringify(runs));
  near(runs[0].aStart, 45, 'start in episode 1'); near(runs[0].aEnd, 125, 'end in episode 1');
  near(runs[0].bStart, 130, 'start in episode 2'); near(runs[0].bEnd, 210, 'end in episode 2');
  assert.ok(runs[0].score > 0.5);
  const segs = segmentsFrom(runs, {duration: 600});
  assert.equal(segs.length, 1); assert.equal(segs[0].type, 'intro');
  near(segs[0].start, 130, 'intro start'); near(segs[0].end, 210, 'intro end');
  assert.equal(segs[0].start, Math.round(segs[0].start * 10) / 10);
});

test('episodes with no music in common give no run, and a 6 s jingle is not an opening', () => {
  assert.deepEqual(matchRuns(printOf([background(LEN, SR, 3)], SR), printOf([background(LEN, SR, 4)], SR)), []);
  const jingle = song(6, SR, 11), a = background(LEN, SR, 5), b = background(LEN, SR, 6);
  place(a, jingle, 20, SR); place(b, jingle, 70, SR);
  assert.deepEqual(matchRuns(printOf([a], SR), printOf([b], SR)), []);
});

test('chunks out of order, of odd sizes, with a gap inside the song, still match', () => {
  const runs = matchRuns(fp1, printOf([ep2], SR, [[160.5, 240], [0, 80], [80, 160]], 777));
  assert.equal(runs.length, 1, JSON.stringify(runs));
  near(runs[0].bStart, 130, 'start'); near(runs[0].bEnd, 210, 'end');
});

test('segments: first 35 % is the intro, last 25 % the outro; too short or too long is nothing', () => {
  const run = (bStart, bEnd) => ({aStart: 0, aEnd: bEnd - bStart, bStart, bEnd, score: 0.8});
  assert.deepEqual(segmentsFrom([run(60.04, 150.06), run(1300, 1390)], {duration: 1440}),
    [{type: 'intro', start: 60, end: 150.1}, {type: 'outro', start: 1300, end: 1390}]);
  assert.deepEqual(segmentsFrom([run(600, 690)], {duration: 1440}), []);
  assert.deepEqual(segmentsFrom([run(60, 75), run(60, 400)], {duration: 1440}), []);
});

test('IntroFinder reports the intro once its end has been heard, not before, and keeps the episode', async () => {
  const saved = [], calls = [], queue = [];
  const store = {
    known: async () => null,
    candidates: async () => [{video: 'ep1', fingerprint: keepEnds(fp1, 600), segments: []}],
    save: async (...a) => { saved.push(a); return true; },
  };
  const finder = new IntroFinder({store, series: {type: 'series', id: 'tt0000001'}, video: 'ep2', duration: 600,
    onSegments: s => calls.push({at: fed, s}), wait: fn => queue.push(fn)});
  await finder.ready;
  let fed = 0;
  for (let i = 0; i < ep2.length; i += 5512) {
    finder.feed([ep2.subarray(i, i + 5512)], SR, i / SR);
    fed = Math.min(ep2.length, i + 5512) / SR;
    while (queue.length) queue.shift()();
  }
  assert.equal(calls.length, 1, JSON.stringify(calls));
  assert.ok(calls[0].at >= 212, `reported after ${calls[0].at} s, before the end of the song had been heard`);
  near(calls[0].s[0].start, 130, 'intro start'); near(calls[0].s[0].end, 210, 'intro end');
  await finder.close();
  assert.equal(saved.length, 1);
  const [, video, data] = saved[0];
  assert.equal(video, 'ep2');
  assert.ok(data.fingerprint.spans.length && data.fingerprint.spans.every(s => s.hashes instanceof Uint32Array));
  near(data.pairs[0].segments[0].start, 45, 'what it taught about episode 1');
});

test('IntroFinder matches a new episode against the series intro alone once one is kept', async () => {
  const calls = [], queue = [];
  const store = {known: async () => null, save: async () => true,
    candidates: async () => [{video: null, slice: true, fingerprint: sliceFingerprint(fp1, 45, 125), segments: [{type: 'intro', start: 45, end: 125}]}]};
  const finder = new IntroFinder({store, series: {type: 'series', id: 'kitsu:1'}, video: 'ep2', duration: 600, onSegments: s => calls.push(s), wait: fn => queue.push(fn)});
  await finder.ready;
  for (let i = 0; i < ep2.length; i += 5512) { finder.feed([ep2.subarray(i, i + 5512)], SR, i / SR); while (queue.length) queue.shift()(); }
  assert.equal(calls.length, 1);
  near(calls[0][0].start, 130, 'intro start'); near(calls[0][0].end, 210, 'intro end');
  assert.deepEqual([...finder.pairs], [], 'the series intro is not an episode to teach');
});

test('intro store: without IndexedDB every call resolves to "nothing known"', async () => {
  const s = introStore({indexedDB: undefined});
  assert.equal(await s.known({type: 'series', id: 'x'}, 'v'), null);
  assert.deepEqual(await s.candidates({type: 'series', id: 'x'}, 'v'), []);
  assert.equal(await s.save({type: 'series', id: 'x'}, 'v', {segments: []}), false);
  const broken = introStore({indexedDB: {open() { throw Error('blocked'); }}});
  assert.equal(await broken.known({type: 'series', id: 'x'}, 'v'), null);
});

test('intro store: two agreeing pairs keep the intro print; at most eight episodes, least recently used dropped', () => {
  const print = {step: STEP, spans: [{start: 0, hashes: new Uint32Array(2000).fill(7)}]};
  let rec = null, t = 1;
  const intro = (s, e) => [{type: 'intro', start: s, end: e}];
  rec = applySave(rec, 'series:a', 'e1', {fingerprint: print, segments: []}, t++);
  rec = applySave(rec, 'series:a', 'e2', {fingerprint: print, segments: intro(10, 100), pairs: [{video: 'e1', segments: intro(20, 110)}]}, t++);
  assert.deepEqual(rec.episodes.e1.segments, intro(20, 110));
  assert.equal(rec.intro, null);
  rec = applySave(rec, 'series:a', 'e3', {fingerprint: print, segments: intro(30, 121), pairs: [{video: 'e2', segments: intro(10, 100)}]}, t++);
  assert.deepEqual([rec.intro.start, rec.intro.end], [30, 121]);
  assert.equal(rec.intro.fingerprint.spans[0].start, 30 / STEP);
  const c = candidatesOf(rec, 'e3');
  assert.equal(c[0].slice, true); assert.deepEqual(c.slice(1).map(x => x.video), ['e2', 'e1']);
  for (let i = 4; i <= 12; i++) rec = applySave(rec, 'series:a', 'e' + i, {fingerprint: print}, t++);
  assert.equal(Object.keys(rec.episodes).length, MAX_EPISODES);
  assert.ok(!rec.episodes.e1 && rec.episodes.e12 && rec.episodes.e5);
});

// --- Public skip times: invented answers in the services' shapes.
function fakeFetch(routes) {
  const seen = [];
  const f = async (url, init) => {
    seen.push({url, init});
    for (const [part, answer] of routes) if (url.includes(part)) return typeof answer === 'number'
      ? {ok: false, status: answer, json: async () => ({})} : {ok: true, status: 200, json: async () => answer};
    return {ok: false, status: 500, json: async () => ({})};
  };
  f.seen = seen;
  return f;
}
const SKIPS = {found: true, results: [
  {interval: {startTime: 80.4, endTime: 170.4}, skipType: 'op', episodeLength: 1300},
  {interval: {startTime: 60.04, endTime: 150.06}, skipType: 'mixed-op', episodeLength: 1421},
  {interval: {startTime: 1300, endTime: 1389.5}, skipType: 'ed', episodeLength: 1421},
  {interval: {startTime: 1500, endTime: 1590}, skipType: 'ed', episodeLength: 1600},
  {interval: {startTime: 5, endTime: 40}, skipType: 'recap', episodeLength: 0},
]};

test('skip times: kinds mapped, results outside the file dropped, the nearest episode length wins', () => {
  assert.deepEqual(parseSkipTimes(SKIPS, 1420), [
    {type: 'recap', start: 5, end: 40}, {type: 'intro', start: 60, end: 150.1}, {type: 'outro', start: 1300, end: 1389.5}]);
  assert.equal(parseSkipTimes({found: false, results: []}, 1420), null);
  assert.deepEqual(idQuery({id: 'tt0000001', season: 2}), null);
  assert.deepEqual(idQuery({id: 'tt0000001', season: 1}), {imdb: 'tt0000001'});
  assert.deepEqual(idQuery({id: 'mal:5'}), {mal: 5});
  assert.equal(idQuery({id: 'other:5'}), null);
});

test('skip times: a Kitsu id is mapped, only ids and the episode are sent, no cookies or referrer, answers kept', async () => {
  forgetSkipTimes();
  const fetch = fakeFetch([['api.ani.zip/mappings?kitsu_id=42', {mappings: {mal_id: 4242, kitsu_id: 42}}], ['api.aniskip.com/v2/skip-times/4242/3?', SKIPS]]);
  const got = await lookupSkipTimes({type: 'series', id: 'kitsu:42', episode: 3, duration: 1420.2}, {fetch});
  assert.deepEqual(got.map(s => s.type), ['recap', 'intro', 'outro']);
  assert.equal(fetch.seen.length, 2);
  assert.match(fetch.seen[1].url, /^https:\/\/api\.aniskip\.com\/v2\/skip-times\/4242\/3\?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=1420$/);
  for (const {init} of fetch.seen) { assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.headers, undefined); }
  await lookupSkipTimes({type: 'series', id: 'kitsu:42', episode: 3, duration: 1420.2}, {fetch});
  assert.equal(fetch.seen.length, 2, 'answered from memory');
});

test('skip times: nothing known (404) is remembered; an IMDb id past season 1 asks nobody', async () => {
  forgetSkipTimes();
  const fetch = fakeFetch([['imdb_id=tt0000002', {mappings: {mal_id: 77}}], ['skip-times/77/1?', 404]]);
  assert.equal(await lookupSkipTimes({id: 'tt0000002', season: 1, episode: 1, duration: 0}, {fetch}), null);
  assert.equal(await lookupSkipTimes({id: 'tt0000002', season: 1, episode: 1, duration: 0}, {fetch}), null);
  assert.equal(fetch.seen.length, 2);
  assert.equal(await lookupSkipTimes({id: 'tt0000002', season: 2, episode: 1}, {fetch}), null);
  assert.equal(fetch.seen.length, 2);
  const failing = fakeFetch([]);
  assert.equal(await lookupSkipTimes({id: 'mal:9', episode: 1}, {fetch: failing}), null);
});
