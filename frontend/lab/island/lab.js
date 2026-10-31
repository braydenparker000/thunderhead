// The island lab (docs/process/NEXT-BATCH.md part 3), a prototype on the owner's phone before the
// real thing: Music runs in a frame over a stand-in chat, the way it will run inside home. A swipe
// down that starts on Music's mini player (the bottom strip; the app draws its own interface, so
// the gesture is read from the frame's touches), or Back, shrinks Music into the island by its clip;
// a tap on the island grows it back out. Music keeps playing throughout. The log records what the
// owner needs to judge on the phone: playing or not, track changes, and whether the screen was off
// when they happened (the lock screen and AirPods test). Kept in this tab only; sent nowhere.
const app = /** @type {HTMLIFrameElement} */ (document.getElementById('app'));
const island = /** @type {HTMLButtonElement} */ (document.getElementById('island'));
const logEl = /** @type {HTMLElement} */ (document.getElementById('log'));
const logBtn = /** @type {HTMLButtonElement} */ (document.getElementById('logbtn'));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const spring = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const SETTLE = spring('--settle', 'cubic-bezier(.2,.7,.2,1)');
const KEY = 'th.lab.island.log';

/** @type {string[]} */
let lines = [];
try { lines = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch {}
function log(text) {
  const t = new Date();
  const at = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
  lines.unshift(`${at}  ${text}${document.hidden ? '  [screen off or app in background]' : ''}`);
  lines = lines.slice(0, 300);
  try { sessionStorage.setItem(KEY, JSON.stringify(lines)); } catch {}
  if (!logEl.hidden) logEl.textContent = lines.join('\n');
}
logBtn.addEventListener('click', () => {
  logEl.hidden = !logEl.hidden;
  logEl.textContent = lines.join('\n');
  logBtn.textContent = logEl.hidden ? 'Show the log' : 'Hide the log';
});

let state = 'app';
/** The clip that leaves only the island's shape of the full-screen app. @param {DOMRect} r */
const clipTo = (r) => `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round ${r.height / 2}px)`;
const FULL = 'inset(0px 0px 0px 0px round 0px)';

/** Music shrinks into the island: one shape, on a spring; the island lands with a small squash. */
async function collapse(why) {
  if (state !== 'app') return;
  state = 'chat';
  island.hidden = false;
  island.style.opacity = '0';
  const r = island.getBoundingClientRect();
  const shrink = app.animate([{ clipPath: FULL, opacity: 1 }, { clipPath: clipTo(r), opacity: 1, offset: 0.8 }, { clipPath: clipTo(r), opacity: 0 }],
    { duration: still ? 1 : 560, easing: SETTLE, fill: 'forwards' });
  island.style.opacity = '';
  const land = island.animate([
    { opacity: 0, transform: 'scale(.55)' },
    { opacity: 0, transform: 'scale(.55)', offset: 0.6 },
    { opacity: 1, transform: 'scale(1.1, .86)', offset: 0.82 },
    { opacity: 1, transform: 'scale(.98, 1.03)', offset: 0.92 },
    { opacity: 1, transform: 'scale(1)' },
  ], { duration: still ? 1 : 640, easing: 'ease-out' });
  await shrink.finished.catch(() => {});
  app.classList.add('away');
  shrink.cancel();
  await land.finished.catch(() => {});
  log(`Music went behind the chat (${why})`);
}

/** The island grows back into Music: the clip opens from the island to the whole screen. */
async function expand(why) {
  if (state !== 'chat') return;
  state = 'app';
  const r = island.getBoundingClientRect();
  app.classList.remove('away');
  const grow = app.animate([{ clipPath: clipTo(r), opacity: 0 }, { clipPath: clipTo(r), opacity: 1, offset: 0.1 }, { clipPath: FULL, opacity: 1 }],
    { duration: still ? 1 : 620, easing: SETTLE, fill: 'forwards' });
  island.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.14)', opacity: 1, offset: 0.35 }, { transform: 'scale(1.6)', opacity: 0 }],
    { duration: still ? 1 : 300, easing: 'ease-in', fill: 'forwards' });
  await grow.finished.catch(() => {});
  grow.cancel();
  island.hidden = true;
  for (const a of island.getAnimations()) a.cancel();
  history.pushState({ lab: 'app' }, '');
  log(`Music came back to the front (${why})`);
}
island.addEventListener('click', () => expand('tap on the island'));
// Back from Music goes to the chat, not out of the page.
history.pushState({ lab: 'app' }, '');
addEventListener('popstate', () => { if (state === 'app') collapse('Back'); });

/** The swipe down on the mini player, read from the frame's own touches (same site). */
function watchSwipe(w) {
  /** @type {{ x: number, y: number } | null} */
  let s = null;
  const opts = { capture: true, passive: true };
  w.addEventListener('pointerdown', (e) => { s = e.clientY > w.innerHeight - 150 ? { x: e.clientX, y: e.clientY } : null; }, opts);
  w.addEventListener('pointermove', (e) => {
    if (!s) return;
    const dy = e.clientY - s.y;
    if (dy > 56 && dy > Math.abs(e.clientX - s.x) * 1.4) { s = null; collapse('swipe down on the mini player'); }
  }, opts);
  for (const t of ['pointerup', 'pointercancel']) w.addEventListener(t, () => { s = null; }, opts);
}

/** Playing or not, and each new track (an id, never a title), noted with whether the screen was off. */
function watchPlayback(w) {
  let playing = null;
  let src = '';
  setInterval(() => {
    const el = w.__cp?.player?.audio;
    const now = Boolean(el && !el.paused && !el.ended);
    if (now !== playing) {
      playing = now;
      island.classList.toggle('playing', now);
      log(now ? 'playing' : 'paused or stopped');
    }
    const next = el?.currentSrc ? el.currentSrc.split('/').pop()?.slice(0, 12) ?? '' : '';
    if (next && next !== src) {
      if (src) log(`next track (${next})`);
      src = next;
    }
  }, 500);
}

app.addEventListener('load', () => {
  try {
    const w = /** @type {any} */ (app.contentWindow);
    watchSwipe(w);
    watchPlayback(w);
    log('Music loaded in the frame');
  } catch (e) {
    log(`could not reach Music in the frame: ${e instanceof Error ? e.message : e}`);
  }
});
document.addEventListener('visibilitychange', () => log(document.hidden ? 'page hidden' : 'page visible'));
