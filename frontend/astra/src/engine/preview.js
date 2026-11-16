// Seek previews' bookkeeping, apart from any network or decoder so it can be tested alone: which key frame a
// time falls on (the cue index), when previews are off, and the small cache that keeps a drag cheap. Only the
// latest place asked for is fetched: a request for another place ends the one under way, and an answer for a
// place no longer wanted is kept in the cache but not handed out. Every picture is closed when it leaves the
// cache and when the film closes. The network and decoding are player-preview.js's.

export const PREVIEW = {keep: 24, width: 320, maxFrame: 1.5 * (1 << 20)};

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
    this.busy = null; // {key, controller, promise}
    this.asked = 0;
    this.closed = false;
  }

  /** The picture for `time`, or null (none, ended, or a later time was asked for meanwhile). */
  async at(time, signal) {
    if (this.closed || signal?.aborted) return null;
    const ask = ++this.asked, place = await this.locate(time);
    if (!place || ask !== this.asked || this.closed || signal?.aborted) return null;
    const held = this.pictures.get(place.key);
    if (held) { this.pictures.delete(place.key); this.pictures.set(place.key, held); this.busy?.controller.abort(); return held; }
    if (this.busy?.key !== place.key) {
      this.busy?.controller.abort(); // only the latest place is fetched
      const controller = new AbortController(), busy = {key: place.key, controller};
      busy.promise = this.load(place, controller.signal).then(picture => {
        if (picture && this.closed) { picture.close?.(); return null; } // one ended late is still kept: its bytes are paid for
        if (picture) this.put(place.key, picture);
        return picture;
      }, () => null).finally(() => { if (this.busy === busy) this.busy = null; });
      this.busy = busy;
    }
    const busy = this.busy, stop = () => { if (this.busy === busy && ask === this.asked) busy.controller.abort(); };
    signal?.addEventListener('abort', stop, {once: true});
    try {
      const picture = await busy.promise;
      return ask === this.asked && !signal?.aborted && !this.closed ? picture : null;
    } finally { signal?.removeEventListener('abort', stop); }
  }

  put(key, picture) {
    this.pictures.get(key)?.close?.();
    this.pictures.delete(key);
    this.pictures.set(key, picture);
    while (this.pictures.size > this.keep) { const [k, old] = this.pictures.entries().next().value; this.pictures.delete(k); old.close?.(); }
  }

  /** The film closed: the fetch under way ends and every picture is closed. */
  close() {
    this.closed = true;
    this.busy?.controller.abort(); this.busy = null;
    for (const picture of this.pictures.values()) picture.close?.();
    this.pictures.clear();
  }
}
