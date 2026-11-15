// Finds this episode's opening and ending while it plays, by comparing its
// sound with episodes of the same series heard before (intro-store.js).
// The engine feeds it decoded sound; it fingerprints the first six and last
// four minutes, matches every so often in slices of a few milliseconds, and
// calls onSegments once a segment's start and end have both been heard here
// and in the other episode. On close it keeps this episode's fingerprint.

import {Fingerprinter, joinGaps, keepEnds, sliceFingerprint, spansToTimes, STEP} from './fingerprint.js';
import {matchSteps, segmentsFrom} from './fingerprint-match.js';

const HEAD = 360, TAIL = 240;   // seconds fingerprinted at each end
const EVERY = 15;               // match again after this many new seconds
const FIRST = 30;               // and not before this many
const SLICE_MS = 4;             // longest the page is held at a time
const MARGIN = 2;               // seconds heard past an end before it counts as known
const EPISODES = 3;             // most episodes matched against, besides the series intro

export class IntroFinder {
  /**
   * @param {{store, series: {type, id}, video: string, duration: number, onSegments: Function,
   *   wait?: (fn) => void}} o  wait runs fn after the page has had a turn (setTimeout 0 by default)
   */
  constructor({store, series, video, duration, onSegments, wait}) {
    Object.assign(this, {store, series, video, duration, onSegments});
    this.wait = wait || (fn => setTimeout(fn, 0));
    this.fp = new Fingerprinter();
    this.segments = [];
    this.pairs = new Map();        // other video -> its segments, from the matches
    this.fed = 0; this.matchedAt = 0;
    this.closed = false; this.busy = false; this.again = false;
    this.candidates = null;
    this.ready = (async () => {
      const known = await store?.known(series, video);
      if (known?.length && !this.closed) this.emit(known);
      this.candidates = (await store?.candidates(series, video)) || [];
    })().catch(() => { this.candidates = []; });
  }

  get headEnd() { return this.duration > 0 ? Math.min(HEAD, this.duration * 0.35 + 30) : HEAD; }
  get tailStart() { return this.duration > HEAD ? Math.max(HEAD, this.duration - TAIL) : Infinity; }

  /** Whether sound at media time t (seconds) is wanted: the engine can skip decoding or copying the rest. */
  wants(t, len = 0) { return !this.closed && !(t >= this.headEnd && t + len <= this.tailStart) && !(this.segments.length >= 2); }

  /** Decoded sound: one Float32Array per channel, its rate, the media time of its first sample. */
  feed(channels, sampleRate, mediaTime) {
    const len = (channels?.[0]?.length || 0) / sampleRate;
    if (this.closed || !(len > 0) || (mediaTime >= this.headEnd && mediaTime + len <= this.tailStart)) return;
    this.fp.feed(channels, sampleRate, mediaTime);
    this.fed += len;
    if (this.fed >= FIRST && this.fed - this.matchedAt >= EVERY) this.match();
  }

  /** Starts a round of matching, or asks for another once the current one ends. */
  match() {
    if (this.busy) { this.again = true; return; }
    if (!this.candidates || !this.candidates.length) return;
    const want = ['intro', 'outro'].filter(t => !this.segments.some(s => s.type === t));
    if (!want.length) return;
    this.busy = true; this.matchedAt = this.fed;
    this.wait(() => this.round(want));
  }

  /** One round, run a slice at a time: this episode so far against each candidate. */
  round(want) {
    if (this.closed) return;
    const b = this.fp.fingerprint(), jobs = [];
    const parts = {intro: sliceFingerprint(b, 0, this.headEnd), outro: sliceFingerprint(b, this.tailStart, Infinity)};
    for (const type of want) {
      const mine = parts[type];
      if (!mine.spans.length) continue;
      const list = this.candidates.filter(c => type === 'intro' || !c.slice);
      for (const c of [...list.filter(c => c.slice), ...list.filter(c => !c.slice).slice(0, EPISODES)]) {
        const theirs = c.slice ? c.fingerprint : type === 'intro' ? sliceFingerprint(c.fingerprint, 0, HEAD) : sliceFingerprint(c.fingerprint, HEAD, Infinity);
        if (theirs.spans.length) jobs.push({type, c, theirs, mine, steps: matchSteps(theirs, mine, {minSeconds: c.slice ? 10 : 20})});
      }
    }
    const step = () => {
      if (this.closed) return;
      const until = now() + SLICE_MS;
      while (jobs.length && now() < until) {
        const job = jobs[0], s = job.steps.next();
        if (!s.done) continue;
        jobs.shift();
        this.take(job, s.value);
        if (this.segments.some(x => x.type === job.type)) for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].type === job.type) jobs.splice(i, 1);
      }
      if (jobs.length) return this.wait(step);
      this.busy = false;
      if (this.again) { this.again = false; this.match(); }
    };
    step();
  }

  /** Keeps a run whose two ends have been heard, in this episode and in the other. */
  take({type, c, theirs, mine}, runs) {
    const heardB = spansToTimes(joinGaps(mine)), heardA = spansToTimes(joinGaps(theirs));
    // Heard in one stretch, with MARGIN heard before the start (or the stretch starts the file) and after the end.
    const within = (heard, t0, t1) => heard.some(h => t0 >= h.start - STEP && t1 <= h.end + STEP &&
      (t0 - h.start >= MARGIN || h.start <= STEP * 8) && h.end - t1 >= MARGIN);
    const sliceEnds = c.slice ? spansToTimes(c.fingerprint) : null;
    const good = runs.filter(r => {
      if (!within(heardB, r.bStart, r.bEnd)) return false;
      if (!c.slice) return within(heardA, r.aStart, r.aEnd);
      // Against the series intro, the run must cover nearly all of it.
      const whole = sliceEnds.reduce((n, h) => n + h.end - h.start, 0);
      return r.aEnd - r.aStart >= whole - 2 * MARGIN;
    });
    const found = segmentsFrom(good, {duration: this.duration, minSeconds: c.slice ? 10 : 20}).filter(s => s.type === type);
    if (!found.length) return;
    const seg = found[0], run = good.find(r => Math.abs(Math.round(r.bStart * 10) / 10 - seg.start) < 0.06);
    if (!c.slice && run) this.pairs.set(c.video, [...(this.pairs.get(c.video) || []).filter(s => s.type !== type),
      {type, start: Math.round(run.aStart * 10) / 10, end: Math.round(run.aEnd * 10) / 10}]);
    this.emit([...this.segments.filter(s => s.type !== type), seg]);
  }

  emit(segments) {
    const next = [...segments].sort((x, y) => x.start - y.start);
    if (JSON.stringify(next) === JSON.stringify(this.segments)) return;
    this.segments = next;
    try { this.onSegments?.(next.map(s => ({...s}))); } catch {}
  }

  /** Stops matching and keeps what was learned. Resolves when saved (never rejects). */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.ready;
    const fingerprint = keepEnds(this.fp.fingerprint(), this.duration, HEAD, TAIL);
    if (!fingerprint.spans.length && !this.segments.length) return;
    try {
      await this.store?.save(this.series, this.video, {fingerprint, segments: this.segments, duration: this.duration,
        pairs: [...this.pairs].map(([video, segments]) => ({video, segments}))});
    } catch {}
  }
}

const now = () => (globalThis.performance?.now?.() ?? Date.now());
