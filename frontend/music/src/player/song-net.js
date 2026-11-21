// Each streamed song's network figures for the report (MUSIC.md §6.3, the fourth phone report): the
// worker's signature ms for its first range (0: signed ahead), first-byte ms from its first request,
// the average kbps received while its reads ran, its first range's size, and the page's requests of other
// files on the link at its start (covers, heads, sync, senses: what the page sees; the worker's own
// signature posts are not in it). The reader (th/music/stream/track.js) keeps `net`; read at report time.

const KEEP = 12;
const round = n => Math.round(n);

export class SongNet {
  constructor() {
    /** @type {{id: string, feed: any}[]} */
    this.songs = [];
    try { performance.setResourceTimingBufferSize?.(1500); } catch { /* no resource timing */ }
  }

  /** A deck starts streaming song id through feed. */
  add(id, feed) {
    if (!feed) return;
    this.songs.push({id, feed});
    if (this.songs.length > KEEP) this.songs.shift();
  }

  /** The figures of the songs kept, oldest first (ms from the session's start: t0). */
  report(t0 = 0) {
    const entries = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : [];
    const out = [];
    for (const {id, feed} of this.songs) {
      const net = feed.items?.[0]?.reader?.net;
      if (!net?.firstAt) continue;
      const until = net.firstByteAt || net.firstAt + 3000;
      const tail = id.slice(-12);
      const others = entries.filter(e => e.startTime <= until && e.responseEnd >= net.firstAt && !e.name.includes(tail));
      out.push({
        at: round(net.firstAt - t0), signMs: net.signMs, firstByteMs: net.firstByteAt ? round(net.firstByteAt - net.firstAt) : null,
        kbps: net.lastByteAt > net.firstAt ? round((net.bytes * 8) / (net.lastByteAt - net.firstAt)) : null, bytes: net.bytes, firstRange: net.firstRange,
        othersAtStart: others.length, othersKinds: kinds(others),
      });
    }
    return out;
  }
}

/** What the other requests were, by kind (no addresses in the report). */
function kinds(entries) {
  const k = {};
  for (const e of entries) {
    const n = e.name;
    const kind = /\/audio\//.test(n) ? 'song bytes' : /\/art\//.test(n) || /cover/.test(n) ? 'cover' : /\/waveform/.test(n) ? 'waveform' : /\/v1\/music\/(marks|playlists|sync)/.test(n) ? 'sync' : /\/v1\/senses/.test(n) ? 'senses' : /library\.json|catalog/.test(n) ? 'catalog' : 'other';
    k[kind] = (k[kind] ?? 0) + 1;
  }
  return k;
}
