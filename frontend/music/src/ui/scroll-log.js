// Scroll recorder (MUSIC.md §5.10 "Scrolling"): how each scroll of a list, a grid or a shelf of Home went on
// the phone, since a hitch shorter than a long task leaves no other trace. One gesture runs from the finger
// starting to move a list until it is at rest again (the drag, its fling, its spring back); for each one,
// once it ends: the screen (one of SCREENS, never a list's own name), list or grid, the zoom level, its ms,
// frames drawn, frames over 20 ms and over 50 ms, the worst frame, and the rows and covers bound during it.
// Per session they add up into one summary a screen, layout and zoom (scrolls, frames, the late share, the
// 95th percentile and worst frame), which the playback batches carry (th/music/report.js, `scrolls`); the
// last gestures go in the copied report (`movement.scrolls`). Numbers and these names only.
// Costs: nothing while no list moves (no timer, no frame loop); while one does, one requestAnimationFrame
// loop that counts into fixed arrays (no allocation a frame) and asks the list whether it still moves.

export const SCREENS = ['home', 'shelf', 'library-playlists', 'library-albums', 'library-artists', 'library-songs', 'library-folders',
  'songs', 'albums', 'artists', 'playlists', 'folders', 'genres', 'album', 'artist', 'playlist', 'folder', 'search', 'queue', 'tracks', 'other'];
/** Late frames: over LATE_MS (a frame and a bit at 60 Hz), and over JANK_MS (three frames lost). */
export const LATE_MS = 20, JANK_MS = 50;
const BINS = 128; // the frame histogram: 1 ms a bin, the last one 127 ms and over
const MAX_KEYS = 24, MAX_ENTRIES = 40;

/** What rows and covers have been bound, counted where they are (power-list.js, home/shelf.js, AAImageView). */
export const bound = {rows: 0, covers: 0};

/** The screen a list's source is, as SCREENS names it (its List Options key's kind, without an entry's own name). */
export function screenOf(src) {
  if (!src) return 'other';
  if (src.isHomeV2) return 'home';
  if (src.isLibraryV2) return SCREENS.includes('library-' + src.libraryChip) ? 'library-' + src.libraryChip : 'other';
  if (src.isSearch) return 'search';
  const key = String(src.optsKey ?? '').split('@')[0];
  const [scope, name = ''] = key.split(':');
  if (key === 'tracks:all') return 'songs';
  if (key === 'tracks:queue') return 'queue';
  if (scope === 'tracks') return ['album', 'artist', 'playlist', 'folder'].includes(name) ? name : 'tracks';
  if (scope === 'sub') return name === 'artist' ? 'artist' : 'other';
  if (scope === 'cat') {
    if (name.startsWith('albums')) return 'albums';
    if (name === 'artists' || name === 'albumArtists' || name === 'composers') return 'artists';
    if (name.startsWith('folders')) return 'folders';
    if (name === 'playlists' || name === 'genres') return name;
  }
  return 'other';
}

/** The 95th percentile of a frame histogram (1 ms bins), in ms. */
export function p95(hist, n) {
  if (!n) return 0;
  const want = Math.ceil(n * 0.95);
  let seen = 0;
  for (let i = 0; i < hist.length; i++) { seen += hist[i]; if (seen >= want) return i + 1; }
  return hist.length;
}

/**
 * A scroll's target says whether it still moves (`scrollMoving()`) and what it is (`scrollInfo()`:
 * {screen, layout: 'list' | 'grid', zoom}).
 */
export class ScrollLog {
  constructor({now = () => performance.now(), raf = f => requestAnimationFrame(f)} = {}) {
    this.now = now;
    this.raf = raf;
    this.target = null;
    this.keys = new Map(); // screen|layout|zoom -> aggregate (its histogram made once)
    this.entries = [];
    this.loop = t => this.frame(t);
    this.running = false;
    this.g = {start: 0, last: -1, frames: 0, late: 0, jank: 0, worst: 0, rows: 0, covers: 0, still: 0, hist: new Uint32Array(BINS)};
  }

  /** A target starts to move (a drag past its touch slop); a gesture already going on goes on. */
  begin(target) {
    if (this.target === target) return;
    if (this.target) this.end();
    this.target = target;
    const g = this.g;
    g.start = this.now(); g.last = -1; g.frames = g.late = g.jank = g.worst = g.still = 0;
    g.rows = bound.rows; g.covers = bound.covers;
    g.hist.fill(0);
    this.info = target.scrollInfo?.() ?? {screen: 'other', layout: 'list', zoom: 0};
    if (!this.running) { this.running = true; this.raf(this.loop); }
  }

  frame(t) {
    const g = this.g, target = this.target;
    if (!target) { this.running = false; return; }
    if (g.last >= 0) this.count(t - g.last);
    g.last = t;
    // At rest for two frames in a row: the gesture is over (a finger held still does not end it).
    if (target.scrollMoving?.()) g.still = 0;
    else if (++g.still >= 2) { this.end(t); this.running = false; return; }
    this.raf(this.loop);
  }

  /** One frame's time (ms) into the gesture going on. */
  count(d) {
    const g = this.g;
    g.frames++;
    if (d > LATE_MS) g.late++;
    if (d > JANK_MS) g.jank++;
    if (d > g.worst) g.worst = d;
    g.hist[Math.min(BINS - 1, Math.max(0, Math.floor(d)))]++;
  }

  /** The gesture ends: its entry, and its frames into its screen's summary. */
  end(t = this.now()) {
    const g = this.g, info = this.info;
    this.target = null;
    if (!g.frames) return null;
    const screen = SCREENS.includes(info.screen) ? info.screen : 'other', layout = info.layout === 'grid' ? 'grid' : 'list', zoom = Number(info.zoom) || 0;
    const entry = {screen, layout, zoom, ms: Math.round(t - g.start), frames: g.frames, late: g.late, jank: g.jank, worstMs: Math.round(g.worst), rows: bound.rows - g.rows, covers: bound.covers - g.covers};
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    const key = screen + '|' + layout + '|' + zoom;
    let a = this.keys.get(key);
    if (!a && this.keys.size < MAX_KEYS) this.keys.set(key, a = {screen, layout, zoom, scrolls: 0, ms: 0, frames: 0, late: 0, jank: 0, worstMs: 0, rows: 0, covers: 0, hist: new Uint32Array(BINS)});
    if (a) {
      a.scrolls++; a.ms += entry.ms; a.frames += g.frames; a.late += g.late; a.jank += g.jank; a.rows += entry.rows; a.covers += entry.covers;
      if (entry.worstMs > a.worstMs) a.worstMs = entry.worstMs;
      for (let i = 0; i < BINS; i++) a.hist[i] += g.hist[i];
    }
    return entry;
  }

  /** The session's summary: one entry a screen, layout and zoom. */
  summary() {
    return [...this.keys.values()].map(a => ({screen: a.screen, layout: a.layout, zoom: a.zoom, scrolls: a.scrolls, ms: a.ms, frames: a.frames, late: a.late, jank: a.jank,
      latePct: a.frames ? Math.round((a.late / a.frames) * 1000) / 10 : 0, p95Ms: p95(a.hist, a.frames), worstMs: a.worstMs, rows: a.rows, covers: a.covers}));
  }
}
