// @ts-check
// Music's streaming feeder (MUSIC.md §5; NEXT-BATCH.md part 2). One <audio> element plays the whole
// queue through Media Source Extensions: each song's Ogg Opus file is fetched in Range requests of
// 32–128 KB (track.js), its pages repackaged as WebM as they arrive (ogg.js → webm.js: the same
// Opus packets, a new container, no re-encoding) and appended to one SourceBuffer. At most CAP_S
// seconds are appended ahead of the play position: fetching stops at the cap and starts again under
// RESUME_S; what lies more than BEHIND_S behind is removed. A song's last bytes appended, the next
// song joins at the exact sample where it ended, so the element plays on gaplessly.
//
// The join: the timeline is counted in 48 kHz samples. A song starts at sample S; its packets carry
// their own times (granule − origin) and timestampOffset = S − pre-skip, so its first audible sample
// lands on S. appendWindowStart = S trims the pre-skip and appendWindowEnd = S + its length trims the
// end padding (RFC 7845 §4.2, §4.5); the next song starts at that end. Only the window trims: the init
// segment's head says pre-skip 0 (plan.js headForMse says why).
//
// Events (CustomEvent detail): `trackstart` {index, at, late} when a song starts sounding (`at`:
// its first sample on the element's timeline, s; `late`: ms the event came after it); `trackend`
// {index, at} at a song's true end (not when skipped); `ahead` {seconds} buffered ahead; `stall`
// {index, ms} the element ran out of data; `error` {code, attempt} a failure being tried again;
// `fallback` {reason, index, ms, failed} nothing more can be done here, so the player goes back to
// its plain element path at song `index`, `ms` in (`failed`: the song whose bytes or decoding
// failed, which may be the next one); `ended` the queue played out.

import { aheadOf, append, covered, openSource, remove } from './buffer.js';
import { RATE } from './ogg.js';
import { BEHIND_S, CAP_S, RESUME_S, appendRoom, headForMse, nextFetch } from './plan.js';
import { StreamError, TrackReader } from './track.js';
import { cluster, init, samplesToNs } from './webm.js';

export { MIME, supported } from './buffer.js';
export { CAP_S } from './plan.js';

/** @typedef {import('./track.js').StreamTrack} StreamTrack */
/** One song on the element's timeline (samples). `start`: its first audible sample; `end`: just past
 * its last (-1 until its last packet is read).
 * @typedef {{ index: number, track: StreamTrack, reader: TrackReader, start: number, end: number,
 *   ready: boolean, endSet: boolean, final: boolean }} Item */

export class StreamFeed extends EventTarget {
  /**
   * @param {HTMLAudioElement} audio
   * @param {{ capS?: number, resumeS?: number, behindS?: number, fetch?: typeof fetch }} [o]
   */
  constructor(audio, o = {}) {
    super();
    this.audio = audio;
    this.capS = o.capS ?? CAP_S;
    this.resumeS = o.resumeS ?? RESUME_S;
    this.behindS = o.behindS ?? BEHIND_S;
    this.fetchFn = o.fetch;
    /** @type {StreamTrack[]} */
    this.queue = [];
    /** @type {Item[]} Songs on the timeline, in order; the last is the one being fed. */
    this.items = [];
    /** @type {Item | null} The song sounding now. */
    this.playing = null;
    /** @type {Item | null} A song left by skip() for the next one already joined (so no `trackend`). */
    this.skipped = null;
    /** Timeline sample where the appended data ends. */
    this.appended = 0;
    /** A position (s) to move the element to once data reaches it (after a seek or skip). @type {number | null} */
    this.seekTo = null;
    this.gen = 0;
    this.ctrl = new AbortController();
    this.dead = false;
    /** A restart or a queue change is rearranging the buffer, so the pump waits. */
    this.blocked = false;
    this.full = false;
    this.pumpQueued = false;
    this.lastAhead = -1;
    this.url = '';
    /** @type {Promise<unknown> | null} */
    this.fetching = null;
    /** @type {Promise<unknown>} SourceBuffer jobs run one after another on this chain. */
    this.chain = Promise.resolve();
    /** @type {ReturnType<typeof setTimeout> | undefined} */ this.timer = undefined;
    /** @type {[EventTarget, string, EventListener][]} */ this.listeners = [];
    /** @type {MediaSource | null} */ this.ms = null;
    /** @type {SourceBuffer | null} */ this.sb = null;
    this.ready = this.open();
    this.ready.catch((e) => this.fail(e));
  }

  async open() {
    const { ms, sb, url } = await openSource(this.audio);
    Object.assign(this, { ms, sb, url });
    const a = this.audio;
    this.listen(a, 'timeupdate', () => this.tick());
    this.listen(a, 'playing', () => this.tick());
    this.listen(a, 'seeked', () => this.tick());
    // A stall is the buffer running dry, not the renderer's own blips with seconds still buffered.
    this.listen(a, 'waiting', () => this.seekTo === null && !a.seeking && aheadOf(sb, a.currentTime) < 0.25 && this.emit('stall', { index: this.position().index, ms: this.position().ms }));
    this.listen(a, 'ended', () => {
      if (this.playing && this.playing.end >= 0) this.emit('trackend', { index: this.playing.index, at: this.playing.end / RATE });
      this.playing = null;
      this.emit('ended', {});
    });
    this.listen(a, 'error', () => this.fail(new StreamError(`media-${a.error?.code ?? 0}`)));
    this.listen(ms, 'sourceclose', () => this.stop());
  }

  /** Plays `tracks` from `index`, `ms` into it. The song starts on the element's timeline at `at`
   * seconds (default: where the element is now; a deck that plays one song passes 0, so the element's
   * time is the song's). @param {StreamTrack[]} tracks @param {{ index?: number, ms?: number, at?: number }} [o] */
  load(tracks, { index = 0, ms = 0, at } = {}) {
    this.queue = tracks.slice();
    this.restart(index, ms, Math.round((at ?? (this.audio.currentTime || 0)) * RATE));
  }

  /** Replaces what follows the song playing now; a song already joined that is no longer next is dropped. @param {StreamTrack[]} tracks */
  setUpcoming(tracks) {
    const now = this.playing ?? this.items[0];
    const base = now ? now.index + 1 : this.queue.length;
    this.queue = [...this.queue.slice(0, base), ...tracks];
    if (!now || this.items.every((x) => this.queue[x.index] === x.track)) return;
    const gen = this.cancel();
    this.items = this.items.slice(0, this.items.indexOf(now) + 1);
    this.exclusive(async () => {
      if (gen !== this.gen) return;
      if (now.final) {
        await this.remove(now.end / RATE, Infinity);
        this.appended = now.end;
      }
      this.blocked = false;
      this.pump();
    }).catch((e) => this.fail(e, gen));
  }

  /** The playing song's position. */
  position() {
    const it = this.playing ?? this.items[0];
    if (!it) return { index: -1, ms: 0, durationMs: 0 };
    const t = this.seekTo ?? this.audio.currentTime;
    const durationMs = it.end >= 0 ? Math.round((it.end - it.start) / 48) : (it.track.durationMs ?? 0);
    return { index: it.index, ms: Math.max(0, Math.round((t - it.start / RATE) * 1000)), durationMs };
  }

  /** Moves within the playing song: inside what is buffered at once, else from the page found by bisecting. @param {number} ms */
  seek(ms) {
    const it = this.playing ?? this.items[0];
    if (!it || this.dead) return;
    const len = it.end >= 0 ? it.end - it.start : (it.track.durationMs ?? Infinity) * 48;
    const target = Math.max(0, Math.min(Math.round(ms * 48), len - RATE / 100));
    const t = (it.start + target) / RATE;
    if (this.seekTo === null && covered(this.sb, t)) this.audio.currentTime = t;
    else this.restart(it.index, target / 48, it.start);
  }

  /** Drops what is buffered ahead and starts the next song now (at once if it is already joined). */
  skip() {
    const it = this.playing ?? this.items[0];
    if (!it || this.dead) return;
    const next = this.items.find((x) => x.index === it.index + 1 && x.ready);
    if (next && this.seekTo === null && covered(this.sb, next.start / RATE + 0.001)) {
      this.skipped = it;
      this.audio.currentTime = next.start / RATE;
      return;
    }
    this.restart(it.index + 1, 0, Math.round(this.audio.currentTime * RATE));
  }

  destroy() {
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
  }

  /** @param {string} type @param {object} detail */
  emit(type, detail) {
    if (!this.dead) this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** @param {EventTarget} t @param {string} type @param {EventListener} fn */
  listen(t, type, fn) {
    t.addEventListener(type, fn);
    this.listeners.push([t, type, fn]);
  }

  stop() {
    if (this.dead) return;
    this.dead = true;
    this.gen++;
    this.ctrl.abort();
    clearTimeout(this.timer);
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners = [];
  }

  /**
   * Anything this path can't get past: tell the player where playback is (to pick up there on the
   * plain element) and which song failed, and stop.
   * @param {unknown} e @param {number} [gen] @param {number} [failed]
   */
  fail(e, gen = this.gen, failed = this.items.at(-1)?.index) {
    if (this.dead || gen !== this.gen) return;
    const err = /** @type {{ name?: string, code?: unknown }} */ (e ?? {});
    if (err.name === 'AbortError') return;
    const reason = typeof err.code === 'string' ? err.code : err.name === 'QuotaExceededError' ? 'quota' : 'internal';
    const { index, ms } = this.position();
    this.emit('fallback', { reason, index, ms, failed: failed ?? index });
    this.stop();
  }

  /** Runs `fn` after every SourceBuffer job queued before it. @template T @param {() => Promise<T>} fn */
  exclusive(fn) {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }

  /** A song to feed, its first sample at timeline sample `start`. @param {number} index @param {StreamTrack} track @param {number} start @returns {Item} */
  item(index, track, start, reader = new TrackReader(track, { fetch: this.fetchFn, onRetry: (code, attempt) => this.emit('error', { code, attempt }) })) {
    return { index, track, reader, start, end: -1, ready: false, endSet: false, final: false };
  }

  /** Stops every fetch and holds the pump until the caller's job has rearranged the buffer. */
  cancel() {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.fetching = null;
    this.blocked = true;
    return ++this.gen;
  }

  /** Starts over at song `index`, `ms` into it, its first sample at timeline sample `start`. @param {number} index @param {number} ms @param {number} start */
  restart(index, ms, start) {
    const same = this.playing && this.playing.index === index && this.queue[index] === this.playing.track ? this.playing : null;
    const gen = this.cancel();
    const signal = this.ctrl.signal;
    const track = this.queue[index];
    const item = !track ? null : same?.reader.head ? this.item(index, track, start, same.reader) : this.item(index, track, start);
    const reader = item?.reader;
    this.items = item ? [item] : [];
    this.playing = same ? item : null;
    this.seekTo = item ? (start + Math.round(ms * 48)) / RATE : null;
    this.appended = start;
    this.full = false;
    this.exclusive(async () => {
      await this.ready;
      if (gen !== this.gen || !this.sb || !this.ms) return;
      if (this.sb.updating) this.sb.abort();
      await this.remove(0, Infinity);
      if (gen !== this.gen) return;
      if (item && reader && (ms > 0 || reader === same?.reader)) {
        while (reader.audioStart < 0 && !reader.done) await reader.fill(16 * 1024, () => {}, signal);
        if (gen !== this.gen) return;
        await reader.seek(reader.origin + (reader.head?.preSkip ?? 0) + Math.round(ms * 48), signal);
        if (gen !== this.gen) return;
      }
      this.blocked = false;
      if (item) this.pump();
      else if (this.ms.readyState === 'open') this.ms.endOfStream();
    }).catch((e) => this.fail(e, gen, index));
  }

  pump() {
    if (this.pumpQueued || this.dead) return;
    this.pumpQueued = true;
    const gen = this.gen;
    this.exclusive(async () => {
      this.pumpQueued = false;
      await this.step();
    }).catch((e) => this.fail(e, gen));
  }

  /** Appends what fits under the cap, opens the next song when this one is done, asks for bytes when it needs them. */
  async step() {
    const gen = this.gen;
    if (this.dead || this.blocked || !this.sb || !this.ms) return;
    await this.evict();
    for (let guard = 0; guard < 100 && gen === this.gen; guard++) {
      const item = this.items[this.items.length - 1];
      if (!item) return;
      const r = item.reader;
      if (item.final) {
        const next = this.queue[item.index + 1];
        if (!next) {
          if (this.ms.readyState === 'open' && !this.sb.updating) this.ms.endOfStream();
          return;
        }
        this.items.push(this.item(item.index + 1, next, item.end));
        continue;
      }
      if (!r.head || r.origin < 0) return this.fetchMore(item);
      const pre = r.head.preSkip;
      /** The element's timeline (samples) at granule `g` of this song. */
      const tl = (/** @type {number} */ g) => item.start + g - r.origin - pre;
      if (!item.ready) {
        this.sb.appendWindowEnd = Infinity;
        this.sb.appendWindowStart = item.start / RATE;
        this.sb.timestampOffset = (item.start - pre) / RATE;
        if (this.audio.ended && this.seekTo === null) this.seekTo = item.start / RATE;
        await this.append(init({ opusHead: headForMse(r.head), channels: r.head.channels }));
        item.ready = true;
        continue;
      }
      if (!item.endSet && r.endGranule >= 0) {
        this.sb.appendWindowEnd = tl(r.endGranule) / RATE;
        item.endSet = true;
      }
      const packets = r.take(appendRoom({ now: this.now(), appended: this.appended, done: r.done, queued: r.queued, capS: this.capS }));
      if (packets.length) {
        await this.append(cluster(packets, samplesToNs(packets[0].start - r.origin)));
        const last = packets[packets.length - 1];
        this.appended = Math.max(this.appended, tl(last.start + last.samples - last.discard));
        if (this.seekTo !== null && this.appended / RATE > this.seekTo + 0.05) {
          this.audio.currentTime = this.seekTo;
          this.seekTo = null;
        }
        this.ahead();
        continue;
      }
      if (r.done && !r.packets.length) {
        item.end = tl(r.endGranule);
        item.final = true;
        this.appended = Math.max(this.appended, item.end);
        if (this.seekTo !== null) {
          this.audio.currentTime = Math.min(this.seekTo, item.end / RATE);
          this.seekTo = null;
        }
        continue;
      }
      return this.fetchMore(item);
    }
  }

  /** Asks for the next bytes unless the cap says wait (stop at CAP_S, start again under RESUME_S). @param {Item} item */
  fetchMore(item) {
    const r = item.reader;
    if (this.fetching || r.done) return;
    const ahead = this.appended / RATE - this.now();
    const plan = nextFetch({ ahead, queued: r.queued / RATE, full: this.full, bytesPerSecond: r.bytesPerSecond(), head: !!r.head, capS: this.capS, resumeS: this.resumeS });
    this.full = plan.full;
    if (!plan.bytes) return;
    const gen = this.gen;
    this.fetching = r.fill(plan.bytes, () => this.pump(), this.ctrl.signal).then(
      () => gen === this.gen && ((this.fetching = null), this.pump()),
      (e) => gen === this.gen && ((this.fetching = null), this.fail(e, gen, item.index)),
    );
  }

  /** The play position the cap counts from: where a pending seek is going, else the element's. */
  now() {
    return this.seekTo ?? this.audio.currentTime;
  }

  ahead() {
    const s = Math.round(aheadOf(this.sb, this.audio.currentTime) * 10) / 10;
    if (s !== this.lastAhead) {
      this.lastAhead = s;
      this.emit('ahead', { seconds: s });
    }
  }

  /** Removes what lies more than BEHIND_S behind (with 5 s of slack, so it goes in steps). */
  async evict() {
    const b = this.sb?.buffered;
    if (!b || !b.length || this.seekTo !== null) return;
    const now = this.audio.currentTime;
    if (now - b.start(0) > this.behindS + 5) await this.remove(b.start(0), now - this.behindS);
    const i = this.playing ? this.items.indexOf(this.playing) : -1;
    if (i > 0) this.items = this.items.slice(i);
  }

  /** @param {number} from @param {number} to */
  remove(from, to) {
    return this.ms && this.sb ? remove(this.ms, this.sb, from, to) : Promise.resolve();
  }

  /** @param {Uint8Array} bytes */
  append(bytes) {
    return this.ms && this.sb ? append(this.ms, this.sb, bytes, this.audio.currentTime) : Promise.resolve();
  }

  /** Song boundaries: `trackstart` when the next song's first sample sounds (a timer set close to it,
   * as `timeupdate` comes only every 250 ms or so), then the cap may let more in. */
  tick() {
    if (this.dead) return;
    const a = this.audio;
    const now = a.currentTime;
    if (this.seekTo === null && !a.paused && a.readyState >= 3) {
      const it = this.items.findLast((x) => x.ready && x.start / RATE <= now + 0.0005);
      if (it && it !== this.playing) {
        const prev = this.playing;
        this.playing = it;
        if (prev && prev !== this.skipped && prev.end >= 0 && it.start === prev.end) this.emit('trackend', { index: prev.index, at: prev.end / RATE });
        this.skipped = null;
        this.emit('trackstart', { index: it.index, at: it.start / RATE, late: Math.round((now - it.start / RATE) * 1000) });
      }
    }
    clearTimeout(this.timer);
    const next = this.items.find((x) => x.ready && x.start / RATE > now + 0.0005);
    if (next && !a.paused) {
      const ms = ((next.start / RATE - now) * 1000) / (a.playbackRate || 1);
      if (ms < 2000) this.timer = setTimeout(() => this.tick(), Math.max(1, ms));
    }
    this.ahead();
    this.pump();
  }
}
