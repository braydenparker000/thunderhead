// The DJ shuffle for the Music player (MUSIC.md §9; the owner's day-1 request): a sixth shuffle
// mode, "DJ", in which each song is picked to follow the one before. Until the audio analysis
// (tempo, key, energy, a sound embedding: §9.1) exists, "follows" means close in the tags: the
// same composer, artist or genre, a near year. Never the same artist within 10 songs (unless nothing
// else is left), an album within 20 counts against; never a song played in the last 2 hours or the
// last 50, nor one rated "not for me" (1). It
// learns from this phone's skips (§9.3): a song skipped early scores lower, one played through
// higher, and so does the move from the song before it, fading with a 60-day half-life. The pick
// among the best five is random with weights softmax(score / 0.15), seeded so a test can replay it.
// The player plans DJ_AHEAD songs at a time (its play order) and plans again after a skip, keeping
// the KEEP_AHEAD songs already planned next (their first seconds may be on the phone already).
// installDj also names the next songs to the player's worker, which signs their links ahead
// (th/music/bridge.js). Nothing here touches the session: it is the player's own, on this phone.

export const SHUFFLE_DJ = 5;
export const DJ_AHEAD = 60;
/** Songs already planned that a new plan keeps next (the player keeps the next 3 songs' heads). */
export const KEEP_AHEAD = 3;
/** Songs after the playing one whose links the worker signs ahead. */
const SIGN_AHEAD = 3;
const RECENT = 50;
const RECENT_MS = 2 * 3_600_000;
const HALF_LIFE_MS = 60 * 86_400_000;
const STORE = 'th.music.dj';
const KEEP = 4000;

/** @typedef {{ id: string, artist?: string, album?: string, albumArtist?: string, genre?: string, composer?: string, year?: number, rating?: number, lastPlayed?: number }} Track */
/** @typedef {{ tracks: Record<string, [number, number]>, moves: Record<string, [number, number]>, recent: string[] }} Learned */

/** A seeded random number generator (mulberry32). @param {number} seed */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const low = (/** @type {unknown} */ s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const genres = (/** @type {Track} */ t) => new Set(low(t.genre).split(/\s*[/,;]\s*/).filter(Boolean));

/** How close two songs are in their tags, 0 to about 2. @param {Track} c @param {Track} x */
export function closeness(c, x) {
  let s = 0;
  if (low(c.composer) && low(c.composer) === low(x.composer)) s += 0.6;
  if (low(c.artist) && low(c.artist) === low(x.artist)) s += 0.4;
  else if (low(c.albumArtist) && low(c.albumArtist) === low(x.albumArtist)) s += 0.2;
  const g1 = genres(c);
  const g2 = genres(x);
  if (g1.size && g2.size) s += (0.5 * [...g1].filter((g) => g2.has(g)).length) / new Set([...g1, ...g2]).size;
  if (c.year && x.year) s += 0.2 * Math.max(0, 1 - Math.abs(c.year - x.year) / 10);
  return s;
}

/** A learned score now, after its fading. @param {[number, number] | undefined} v @param {number} now */
const faded = (v, now) => (v ? v[0] * 0.5 ** ((now - v[1]) / HALF_LIFE_MS) : 0);

/**
 * The next song after `c` among `pool` (indices into `tracks`), or -1.
 * @param {Track[]} tracks @param {number} c @param {number[]} pool @param {string[]} history newest last
 * @param {Learned} learned @param {() => number} rand @param {number} now
 */
export function pick(tracks, c, pool, history, learned, rand, now) {
  const cur = tracks[c];
  const last = new Set(history.slice(-RECENT));
  const artists = history.slice(-10).map((id) => low(byId(tracks, id)?.artist)).filter(Boolean);
  const albums = history.slice(-20).map((id) => low(byId(tracks, id)?.album)).filter(Boolean);
  /** @type {[number, number][]} */
  const scored = [];
  /** @type {[number, number][]} */
  const sameArtist = [];
  for (const i of pool) {
    const x = tracks[i];
    if (i === c || last.has(x.id) || x.rating === 1 || (x.lastPlayed && now - x.lastPlayed < RECENT_MS)) continue;
    const mine = faded(learned.tracks[x.id], now);
    if (mine <= -3) continue;
    let s = closeness(cur, x) + 0.25 * Math.max(-1, Math.min(1, mine)) + 0.25 * Math.max(-1, Math.min(1, faded(learned.moves[`${cur.id}>${x.id}`], now)));
    if (low(x.album) && albums.includes(low(x.album))) s -= 0.3;
    // The same artist within 10 songs only when nothing else is left.
    (low(x.artist) && artists.includes(low(x.artist)) ? sameArtist : scored).push([i, s]);
  }
  if (!scored.length) scored.push(...sameArtist.map(([i, s]) => /** @type {[number, number]} */ ([i, s - 0.5])));
  if (!scored.length) return -1;
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, 5);
  const w = top.map(([, s]) => Math.exp((s - top[0][1]) / 0.15));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < top.length; k++) if ((r -= w[k]) <= 0) return top[k][0];
  return top[top.length - 1][0];
}

/** @type {WeakMap<Track[], Map<string, Track>>} */
const ids = new WeakMap();
/** @param {Track[]} tracks @param {string} id */
function byId(tracks, id) {
  let m = ids.get(tracks);
  if (!m) ids.set(tracks, (m = new Map(tracks.map((t) => [t.id, t]))));
  return m.get(id);
}

/**
 * The DJ's play order for a queue: the current song first (or `o.keep`, songs already chosen, the
 * current one first), then DJ_AHEAD songs each picked after the one before (from the songs close in
 * the tags plus 100 at random), then the rest shuffled.
 * @param {Track[]} tracks @param {number} index @param {{ learned?: Learned, seed?: number, now?: number, keep?: number[] }} [o]
 */
export function djOrder(tracks, index, o = {}) {
  const n = tracks.length;
  const rand = seeded(o.seed ?? (Date.now() ^ (n * 2654435761)));
  const now = o.now ?? Date.now();
  const learned = o.learned ?? load();
  const start = index >= 0 && index < n ? index : Math.floor(rand() * n);
  const keep = o.keep?.[0] === start ? o.keep : [start];
  /** @type {Map<string, number[]>} */
  const by = new Map();
  tracks.forEach((t, i) => {
    for (const k of [`c:${low(t.composer)}`, `a:${low(t.artist)}`, ...[...genres(t)].map((g) => `g:${g}`)]) {
      if (k.endsWith(':')) continue;
      const b = by.get(k);
      if (b) b.push(i);
      else by.set(k, [i]);
    }
  });
  const left = new Set(tracks.keys());
  for (const i of keep) left.delete(i);
  const order = [...keep];
  const history = [...learned.recent, ...keep.map((i) => tracks[i].id)];
  while (order.length < Math.min(n, DJ_AHEAD + 1)) {
    const c = /** @type {number} */ (order.at(-1));
    const t = tracks[c];
    const near = [`c:${low(t.composer)}`, `a:${low(t.artist)}`, ...[...genres(t)].map((g) => `g:${g}`)].flatMap((k) => by.get(k) ?? []);
    const all = [...left];
    const pool = [...new Set([...near.filter((i) => left.has(i)).slice(0, 400), ...Array.from({ length: Math.min(100, all.length) }, () => all[Math.floor(rand() * all.length)])])];
    let next = pick(tracks, c, pool, history, learned, rand, now);
    if (next < 0) next = all[Math.floor(rand() * all.length)];
    order.push(next);
    left.delete(next);
    history.push(tracks[next].id);
  }
  const rest = [...left];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...order, ...rest];
}

/**
 * A new plan after a skip: from the song now playing, keeping the KEEP_AHEAD songs the old plan had
 * next, except any just played or skipped (learned.recent), so their heads on the phone serve.
 * @param {Track[]} tracks @param {number[] | null} order @param {number} index
 * @param {{ learned?: Learned, seed?: number, now?: number }} [o]
 */
export function replan(tracks, order, index, o = {}) {
  const learned = o.learned ?? load();
  const recent = new Set(learned.recent);
  const at = order?.length === tracks.length ? order.indexOf(index) : -1;
  const next = at < 0 ? [] : order.slice(at + 1, at + 1 + KEEP_AHEAD).filter((i) => !recent.has(tracks[i].id));
  return djOrder(tracks, index, { ...o, learned, keep: [index, ...next] });
}

/** This phone's learning. @returns {Learned} */
export function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (v && typeof v === 'object') return { tracks: v.tracks ?? {}, moves: v.moves ?? {}, recent: v.recent ?? [] };
  } catch {}
  return { tracks: {}, moves: {}, recent: [] };
}

/** @param {Learned} l */
function save(l) {
  const trim = (/** @type {Record<string, [number, number]>} */ m) =>
    Object.fromEntries(Object.entries(m).sort((a, b) => b[1][1] - a[1][1]).slice(0, KEEP));
  try {
    localStorage.setItem(STORE, JSON.stringify({ tracks: trim(l.tracks), moves: trim(l.moves), recent: l.recent.slice(-RECENT) }));
  } catch {}
}

/** What a song's play teaches (§9.3): [song, move] scores. @param {number} pos ms @param {number} dur ms */
export function lesson(pos, dur) {
  if (pos < 30_000) return [-1, -1];
  if (dur && pos < dur / 2) return [-0.25, -0.5];
  if (dur && pos >= dur - 2_000) return [1, 1];
  return [0.5, 0.5];
}

/** Adds a play's lesson. @param {Learned} l @param {string | null} before @param {string} id @param {number} pos @param {number} dur @param {number} now */
export function learn(l, before, id, pos, dur, now) {
  const [song, move] = lesson(pos, dur);
  l.tracks[id] = [faded(l.tracks[id], now) + song, now];
  if (before) l.moves[`${before}>${id}`] = [faded(l.moves[`${before}>${id}`], now) + move, now];
  l.recent = [...l.recent.filter((x) => x !== id), id].slice(-RECENT);
  return song < 0;
}

/**
 * The model's sixth shuffle mode: its value, label, second line and icon (the reference model
 * names five; the popup and the toast read these arrays).
 * @param {any} model
 */
export function installDjMode(model) {
  const v = model?.values;
  if (!v?.array?.shuffle_modes_enum || v.integer.SHUFFLE_DJ) return;
  v.integer.SHUFFLE_DJ = [[String(SHUFFLE_DJ)]];
  v.string.shuffle_dj = [['DJ']];
  v.string.shuffle_dj_long = [['Each song follows the last']];
  const set = (/** @type {string} */ name, /** @type {string} */ value) => {
    for (const variant of v.array[name] ?? []) {
      const items = variant[variant.length - 1];
      items[SHUFFLE_DJ] = value;
    }
  };
  set('shuffle_modes_enum', '@integer/SHUFFLE_DJ');
  set('shuffle_modes', '@string/shuffle_dj');
  set('shuffle_modes_line2', '@string/shuffle_dj_long');
  set('shuffle_modes_long', '@string/shuffle_dj_long');
  set('shuffle_icons_32dp', '?shuffle_all_32dp');
}

/**
 * Learns from each song the player leaves, and plans again after a skip in DJ mode. Names the next
 * songs to the player's worker whenever they may have changed.
 * @param {any} ctx @param {any} player
 */
export function installDj(ctx, player) {
  const learned = load();
  /** @type {{ id: string, pos: number, dur: number } | null} */
  let now = null;
  /** @type {string | null} */
  let before = null;
  setInterval(() => {
    const t = player.track;
    if (t?.id && now?.id === t.id) now.pos = Math.max(now.pos, player.positionMs?.() ?? 0);
  }, 1000);
  ctx.bus.subscribe('bus_player', (/** @type {string} */ msg, /** @type {unknown} */ _src, /** @type {any} */ d) => {
    if (msg !== 'msg_player_track_changed' || d?.meta) return;
    const t = player.track;
    if (!t?.id || now?.id === t.id) return;
    if (now) {
      const skipped = learn(learned, before, now.id, now.pos, now.dur, Date.now());
      save(learned);
      before = now.id;
      // A plan the player made in DJ mode is planned again from here (ensureOrder keeps it); any other, from scratch.
      const dj = player.orderShuffle === SHUFFLE_DJ && player.orderQueueMode === player.queueMode && !(player.queueMode && ctx.pref?.('queue_no_shuffle'));
      if (skipped && player.shuffle === SHUFFLE_DJ) player.order = dj ? replan(player.queue, player.order, player.index, { learned }) : null;
    }
    now = { id: t.id, pos: 0, dur: t.durationMs || 0 };
  });
  // The next songs' links, signed by the worker before their turn (one request for all of them).
  let soon = 0;
  ctx.bus.subscribe('bus_player', (/** @type {string} */ msg, /** @type {unknown} */ _src, /** @type {any} */ d) => {
    if (!/^msg_player_(track_changed|queue_changed|category_changed|shuffle_mode_changed|repeat_mode_changed|playing_state_changed)$/.test(msg) || d?.meta) return;
    clearTimeout(soon);
    soon = setTimeout(() => {
      const urls = [];
      for (let k = 0; k <= SIGN_AHEAD; k++) {
        const src = player.trackAt?.(k)?.src;
        if (typeof src === 'string' && !urls.includes(src)) urls.push(src);
      }
      if (urls.length) globalThis.navigator?.serviceWorker?.controller?.postMessage({ type: 'th-music-ahead', urls });
    }, 300);
  });
}
