// Seek previews' bookkeeping, apart from any network or decoder so it can be tested alone: which key frame a
// time falls on (the cue index), when previews are off, how large a key frame may be, and the small cache that
// keeps a drag cheap. One key frame is fetched at a time and a fetch under way is let finish: its picture is
// kept, and handed to the latest request as an early picture (`early`), while the latest place asked for is
// fetched next; places passed over meanwhile are never fetched. (Ending the fetch under way for each new place
// left a 4K film, whose key frame takes longer than a finger rests, with no picture at all during a drag.)
// Every picture is closed when it leaves the cache and when the film closes. The network and decoding are
// player-preview.js's.

export const PREVIEW = {keep: 24, width: 320, maxFrame: 1.5 * (1 << 20), maxFrameTop: 4 * (1 << 20), frameSeconds: 0.5};

/**
 * The largest key frame fetched for a film's preview: half a second of its own average data, never under 1.5 MB
 * nor over 4 MB (a 4K film's key frames run past 1.5 MB where a 1080p film's are a few hundred kB).
 */
export function frameCap(size, duration) {
  const rate = size > 0 && duration > 0 ? size / duration : 0;
  return Math.round(Math.min(PREVIEW.maxFrameTop, Math.max(PREVIEW.maxFrame, rate * PREVIEW.frameSeconds)));
}

/** The cue at or before `ticks` in a time-ordered list ({ticks, position, relative}), else the first; null for none. */
export function cueAt(cues, ticks) {
  if (!cues?.length) return null;
  let found = 0;
  for (let lo = 0, hi = cues.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (cues[m].ticks <= ticks) { found = m; lo = m + 1; } else hi = m - 1; }
  return cues[found];
}

/**
 * Why there are no previews now, or '' when there may be: only a film Astra unpacks ('remux') has its index and
 * a reader for side requests; never with the data saver on, and never while the connection to the host is lost.
 */
export function previewsOff({mode, saver, state, closed} = {}) {
  if (mode !== 'remux') return 'mode';
  if (saver) return 'saver';
  if (closed) return 'closed';
  if (state === 'reconnecting' || state === 'lost') return 'offline';
  return '';
}

/**
 * `locate(time)` → {key, …} (the key frame's place, known without the network; or a promise of it) or null;
 * `load(place, signal)` → a picture (ImageBitmap) or null, its fetch ended by `signal`.
 */
export class PreviewCache {
  constructor({locate, load, keep = PREVIEW.keep}) {
    Object.assign(this, {locate, load, keep});
    this.pictures = new Map(); // key -> ImageBitmap, oldest first
    this.busy = null; // the fetch under way: {key, controller}
    this.wanted = null; // the latest request waiting: {place, early, resolve, done}
    this.asked = 0;
    this.closed = false;
  }

  /**
   * The picture for `time`, or null (none, ended, or a later time was asked for meanwhile). While it is fetched
   * behind another place's fetch, `early(picture)` hears of that one's picture as it lands.
   */
  async at(time, signal, early = null) {
    if (this.closed || signal?.aborted) return null;
    const ask = ++this.asked, place = await this.locate(time);
    if (!place || ask !== this.asked || this.closed || signal?.aborted) return null;
    this.drop(); // an older request still waiting gets nothing
    const held = this.pictures.get(place.key);
    if (held) { this.pictures.delete(place.key); this.pictures.set(place.key, held); return held; }
    return new Promise(resolve => {
      const want = {place, early, resolve};
      // The caller ending its request (the drag let go) ends the fetch under way too.
      const stop = () => { if (this.wanted === want) { this.drop(); this.end(); } };
      signal?.addEventListener('abort', stop, {once: true});
      want.done = () => signal?.removeEventListener('abort', stop);
      this.wanted = want;
      this.pump();
    });
  }

  /** The request waiting, if any, is answered null. */
  drop() {
    const want = this.wanted;
    this.wanted = null;
    if (want) { want.done(); want.resolve(null); }
  }

  /** Starts the waiting request's fetch once none is under way. */
  pump() {
    const want = this.wanted;
    if (this.busy || !want || this.closed) return;
    const key = want.place.key, held = this.pictures.get(key);
    if (held) { this.wanted = null; want.done(); want.resolve(held); return; }
    const busy = this.busy = {key, controller: new AbortController()};
    this.load(want.place, busy.controller.signal).then(picture => picture, () => null).then(picture => {
      if (this.busy === busy) this.busy = null;
      if (picture && this.closed) { picture.close?.(); return; }
      if (picture) this.put(key, picture); // kept even when no longer the latest: its bytes are paid for
      else if (busy.controller.signal.aborted) return this.pump(); // ended: it answers no one
      const now = this.wanted;
      if (now?.place.key === key) { this.wanted = null; now.done(); now.resolve(picture); }
      else if (now && picture) now.early?.(picture);
      this.pump();
    });
  }

  /** The fetch under way ends (a picture that still lands is kept). */
  end() { this.busy?.controller.abort(); this.busy = null; }

  put(key, picture) {
    this.pictures.get(key)?.close?.();
    this.pictures.delete(key);
    this.pictures.set(key, picture);
    while (this.pictures.size > this.keep) { const [k, old] = this.pictures.entries().next().value; this.pictures.delete(k); old.close?.(); }
  }

  /** The film closed: the fetch under way ends and every picture is closed. */
  close() {
    this.closed = true;
    this.drop();
    this.end();
    for (const picture of this.pictures.values()) picture.close?.();
    this.pictures.clear();
  }
}
