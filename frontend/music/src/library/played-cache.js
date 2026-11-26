// Songs kept from playing them (owner, 2026-11-25): a streamed song whose every byte the stream
// fetched (th/music/stream/track.js `keep`, feed.js `keep`) is stored whole here, so playing it again
// starts from the phone and costs no network. Nothing is ever downloaded for this: only the bytes the
// stream already read are assembled (from its first byte to its last, in order; a song whose stream
// skipped bytes with a seek is not kept, since filling the gap would cost a download). At most
// PLAYED_BUDGET in all; the song played longest ago goes first. On by default, on every connection.
// The index (URL → bytes, last play) lives in localStorage; Settings › On this phone clears it
// (apps/settings/phone-stores.js). AudioCache (audio-cache.js) answers from it: a kept song plays as a
// blob URL like an offline copy, and counts as one for heads, preloads and the stall guard. A kept copy
// is checked against the catalogue's size for its song as it opens: a file replaced upstream under the
// same id (another length) is dropped, and the song streams again (and is kept again, whole).
export const PLAYED_CACHE = 'claude-player-played';
const STORE = 'cp-played-cache';
export const PLAYED_BUDGET = 200 * 1024 * 1024;

export class PlayedCache {
  constructor({caches = globalThis.caches, storage = globalThis.localStorage, budget = PLAYED_BUDGET, now = () => Date.now()} = {}) {
    this.caches = caches;
    this.storage = storage;
    this.budget = budget;
    this.now = now;
    /** @type {Map<string, {bytes: number, used: number}>} */
    this.index = new Map();
    this.counts = {kept: 0, keptBytes: 0, plays: 0, evicted: 0};
    this.ready = this.caches ? this.load() : Promise.resolve();
  }

  get available() { return !!this.caches; }

  /** The stored index, checked against the cache's keys (an entry without a copy goes, a copy without an entry goes). */
  async load() {
    try {
      const e = JSON.parse(this.storage?.getItem(STORE) || '{}')?.e ?? {};
      for (const [url, [bytes, used]] of Object.entries(e)) if (bytes > 0) this.index.set(url, {bytes, used: +used || 0});
    } catch { /* no index */ }
    try {
      const cache = await this.caches.open(PLAYED_CACHE);
      const keys = new Set((await cache.keys()).map(r => r.url));
      for (const url of this.index.keys()) if (!keys.has(url)) this.index.delete(url);
      for (const url of keys) if (!this.index.has(url)) await cache.delete(url, {ignoreVary: true});
      this.save();
    } catch { /* storage unavailable */ }
  }

  save() {
    const e = {};
    for (const [url, x] of this.index) e[url] = [x.bytes, x.used];
    try { this.storage?.setItem(STORE, JSON.stringify({v: 1, e})); } catch { /* storage full or unavailable */ }
  }

  has(url) { return this.index.has(url); }

  get bytes() {
    let n = 0;
    for (const x of this.index.values()) n += x.bytes;
    return n;
  }

  /**
   * The kept song at url as a Blob (marked played now), or null. `expected`: its size in the catalogue
   * (0: unknown); a copy of another length is stale (the file was replaced) and goes.
   * @param {string} url @param {{expected?: number}} [o]
   */
  async open(url, {expected = 0} = {}) {
    await this.ready;
    if (!this.index.has(url)) return null;
    if (expected > 0 && this.index.get(url).bytes !== expected) { await this.forget(url); return null; }
    try {
      const r = await (await this.caches.open(PLAYED_CACHE)).match(url, {ignoreVary: true});
      if (!r) { this.index.delete(url); this.save(); return null; }
      const blob = await r.blob();
      if (!blob.size || (expected > 0 && blob.size !== expected)) { await this.forget(url); return null; }
      this.index.get(url).used = this.now();
      this.save();
      this.counts.plays++;
      return blob;
    } catch {
      await this.forget(url);
      return null;
    }
  }

  /**
   * Keeps a song's whole file, read by its stream. `expected`: its size from the catalog (0: unknown);
   * bytes of another length are not kept. Makes room by dropping the songs played longest ago. Whether it is kept.
   * @param {string} url @param {Uint8Array} bytes @param {{expected?: number, type?: string}} [o]
   */
  async keep(url, bytes, {expected = 0, type = 'audio/ogg'} = {}) {
    if (!this.available || !/^https?:/.test(url || '') || !bytes?.length) return false;
    if (expected && bytes.length !== expected) return false;
    await this.ready;
    if (this.index.has(url)) { this.index.get(url).used = this.now(); this.save(); return true; }
    if (bytes.length > this.budget) return false;
    try {
      const cache = await this.caches.open(PLAYED_CACHE);
      let total = this.bytes;
      const old = [...this.index].sort((a, b) => a[1].used - b[1].used);
      for (const [u, x] of old) {
        if (total + bytes.length <= this.budget) break;
        await cache.delete(u, {ignoreVary: true}).catch(() => {});
        this.index.delete(u);
        this.counts.evicted++;
        total -= x.bytes;
      }
      this.save();
      await cache.put(url, new Response(new Blob([bytes], {type}), {status: 200, headers: {'content-type': type, 'content-length': String(bytes.length)}}));
      this.index.set(url, {bytes: bytes.length, used: this.now()});
      this.save();
      this.counts.kept++;
      this.counts.keptBytes += bytes.length;
      return true;
    } catch {
      // The browser's quota is full, or storage is unavailable: not kept, and nothing else changes.
      return false;
    }
  }

  /** Drops the kept song at url (unreadable, or one that would not play). */
  async forget(url) {
    if (!this.index.delete(url)) return;
    this.save();
    try { await (await this.caches.open(PLAYED_CACHE)).delete(url, {ignoreVary: true}); } catch { /* storage unavailable */ }
  }

  /** Deletes every kept song. */
  async clear() {
    this.index.clear();
    this.save();
    await this.caches?.delete(PLAYED_CACHE).catch(() => {});
  }

  summary() {
    return {available: this.available, tracks: this.index.size, bytes: this.bytes, budget: this.budget, ...this.counts};
  }
}
