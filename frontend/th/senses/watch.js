// @ts-check
// Astra's and My Media's watching, as senses (shared/contract/senses.ts `media.watch`, `media.finish`,
// `media.drop`): read from each app's own progress on this phone, which the apps write as they play
// (Astra `astra.v2.progress`, seconds; My Media `mymedia.progress.v1`, seconds), so neither app is
// changed. Each look compares the progress with the last look (`th.p.senses.watch`, cleared on
// sign-out with the rest of `th.p.*`): time watched since (never more than twice the time between
// the looks, so a seek forward isn't watching; sent once it reaches 10 s), a title finished, and an
// unfinished title taken off Continue Watching (seen in the last 14 days). The very first look only
// remembers. Looks: shortly after the page opens, 2 s after a video pauses or ends (Astra saves 1.5 s
// later), every 5 minutes while one plays, and when the page hides. Refs and numbers only: a title's
// id, never its name. Loaded by th/senses/send.js on these two apps' pages.

const SEEN = 'th.p.senses.watch';
const ASTRA = 'astra.v2.progress';
const MYMEDIA = 'mymedia.progress.v1';
const ID = /^[A-Za-z0-9._:/-]{1,150}$/;
const MIN_MS = 10_000;
const DROP_DAYS = 14;

/** @typedef {{ t: number, d: number, done: boolean, at: number }} Spot ms watched to, ms long, finished, when saved */
/** @typedef {{ look: number, spots: Record<string, Spot> }} Seen */

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Astra's progress by ref: `astra:<type>:<id>`, an episode `…:<season>:<episode>`. @param {unknown} raw */
export function astraSpots(raw) {
  /** @type {Record<string, Spot>} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const e of Object.values(raw)) {
    if (!e || typeof e !== 'object' || typeof e.type !== 'string' || e.id == null) continue;
    const ep = Number.isInteger(e.season) && Number.isInteger(e.episode) ? `:${e.season}:${e.episode}` : '';
    const id = `${e.type}:${e.id}${ep}`;
    if (ID.test(id)) out[`astra:${id}`] = { t: num(e.time) * 1000, d: num(e.duration) * 1000, done: e.completed === true, at: num(e.updated) };
  }
  return out;
}

/** My Media's progress by ref: `media:<drive file id>`. @param {unknown} raw */
export function mediaSpots(raw) {
  /** @type {Record<string, Spot>} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, p] of Object.entries(raw))
    if (ID.test(id) && p && typeof p === 'object') out[`media:${id}`] = { t: num(p.t) * 1000, d: num(p.d) * 1000, done: p.done === true, at: num(p.at) };
  return out;
}

/** The senses between two looks, and the spots to remember (a title watched less than MIN_MS keeps
 * its earlier place, so short stretches add up).
 * @param {Seen} before @param {Record<string, Spot>} now @param {number} at
 * @returns {{ senses: [string, string, Record<string, number> | null][], spots: Record<string, Spot> }} */
export function changes(before, now, at) {
  /** @type {[string, string, Record<string, number> | null][]} */
  const senses = [];
  /** @type {Record<string, Spot>} */
  const spots = { ...now };
  const most = Math.max(0, at - before.look) * 2;
  for (const [ref, s] of Object.entries(now)) {
    const was = before.spots[ref];
    // Not saved since the last look: as it was (with any place it keeps).
    if (was && s.at <= before.look) {
      spots[ref] = was;
      continue;
    }
    const ms = Math.min(Math.max(0, s.t - (was?.t ?? 0)), most);
    if (ms >= MIN_MS) senses.push(['media.watch', ref, { ms: Math.round(ms) }]);
    else if (was && !s.done) spots[ref] = { ...s, t: was.t };
    if (s.done && !was?.done) senses.push(['media.finish', ref, null]);
  }
  for (const [ref, was] of Object.entries(before.spots))
    if (!now[ref] && !was.done && was.at > at - DROP_DAYS * 86_400_000) senses.push(['media.drop', ref, { at_ms: Math.round(was.t) }]);
  return { senses, spots };
}

/** @param {string} key */
function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

/** Both apps' progress, as this page sees it now. */
const progress = () => ({ ...astraSpots(read(ASTRA)), ...mediaSpots(read(MYMEDIA)) });

/** One look: what changed since the last is remembered first, then sent (a page that goes away
 * meanwhile loses a sense rather than sending it twice; an app switched off moves on all the same,
 * so nothing watched meanwhile is sent later). */
export async function look(now = Date.now()) {
  const was = /** @type {Seen | null} */ (read(SEEN));
  const spots = progress();
  if (!was?.spots) return save({ look: now, spots });
  const c = changes(was, spots, now);
  save({ look: now, spots: c.spots });
  if (!c.senses.length) return;
  const { sense } = await import('./send.js');
  for (const s of c.senses) await sense(...s);
}
/** @param {Seen} s */
function save(s) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(s));
  } catch {}
}

let started = false;
export function startWatching() {
  if (started) return;
  started = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let soon;
  const later = (/** @type {number} */ ms) => {
    clearTimeout(soon);
    soon = setTimeout(() => void look(), ms);
  };
  later(3000);
  // Media events don't bubble; on the document's capture they are heard from any video.
  for (const e of ['pause', 'ended']) document.addEventListener(e, () => later(2000), true);
  setInterval(() => {
    if (document.visibilityState === 'visible' && [...document.querySelectorAll('video')].some((v) => !v.paused)) void look();
  }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => document.hidden && void look());
  addEventListener('pagehide', () => void look());
}
