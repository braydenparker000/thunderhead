// @ts-check
// The shell's side of the service worker (ARCHITECTURE.md §8.3): register /sw.js, look for a new
// release when the page comes back into view (at most hourly), and apply a waiting worker only at
// a safe moment, then reload behind a short fade; the page going out of view is the safest moment, and a
// waiting worker is applied then. If no safe moment comes, the browser applies it at the next cold start.
import { FADE_MS, RETRY_MS, checkDue, safeNow } from './update-rules.js';

/** What a reload would lose, by the class or flag each place sets: a voice memo recording (th/attach/memo.js
 * `#ask.recording`); files or a stopped memo picked and not sent (th/attach/tray.js `#ask.hasfiles`); dictation
 * listening or finishing (th/dictate/mic.js `#ask.listening`, `#ask.finishing`); the Remind sheet
 * (th/attach/remind.js `.remind`); an old conversation open (th/convos/past.js `#home.pastview`); and any place
 * but home, the Briefing or the menu (apps/home/home.js `inertAll` makes `#home` inert). */
const BUSY = '#ask.recording, #ask.hasfiles, #ask.listening, #ask.finishing, .remind, #home.pastview, #home[inert]';

/** @type {ServiceWorkerRegistration | null} */
let reg = null;
let lastCheck = Date.now();
/** @type {ReturnType<typeof setInterval> | null} */
let retry = null;

/** What the shell is doing right now, read from the page. */
function state() {
  const media = /** @type {HTMLMediaElement[]} */ ([...document.querySelectorAll('audio, video')]);
  const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'));
  const active = document.activeElement;
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  // An app in home's layer (th/island) plays inside its frame: its decks count too.
  for (const f of /** @type {NodeListOf<HTMLIFrameElement>} */ (document.querySelectorAll('iframe.th-app'))) {
    try {
      const w = /** @type {any} */ (f.contentWindow);
      const deck = w?.__cp?.player?.audio;
      if (deck) media.push(deck);
      media.push(...w.document.querySelectorAll('audio, video'));
    } catch {}
  }
  return {
    visible: document.visibilityState === 'visible',
    playing: media.some((m) => !m.paused && !m.ended),
    typing: Boolean(q?.value.trim()) || field,
    written: Boolean(q?.value.trim()) || (field && Boolean(/** @type {HTMLInputElement} */ (active).value.trim())),
    overlay: document.querySelector('#opts.show, #side.open, .ring.show, .spage, [aria-modal="true"]') !== null,
    busy: document.querySelector(BUSY) !== null,
  };
}

/** Whether a new release has installed and waits. */
export function waiting() {
  return Boolean(reg?.waiting && navigator.serviceWorker.controller);
}

function tryApply() {
  if (!reg?.waiting || !safeNow(state())) return;
  const next = reg.waiting;
  if (retry) clearInterval(retry);
  retry = null;
  next.postMessage({ type: 'skipWaiting' });
}

/** The worker in charge changed: asked for here, or by an editor page as it opened (lab/engine/fresh.js).
 * This page is the release before's now, so it reloads at a safe moment: behind a short fade, or at once out of view. */
function changed() {
  const go = () => {
    if (!safeNow(state())) return false;
    if (document.visibilityState !== 'visible') { location.reload(); return true; }
    document.documentElement.style.transition = `opacity ${FADE_MS}ms`;
    document.documentElement.style.opacity = '0';
    setTimeout(() => location.reload(), FADE_MS);
    return true;
  };
  if (!go()) { const t = setInterval(() => { if (go()) clearInterval(t); }, RETRY_MS); }
}

function watchWaiting() {
  if (!waiting() || retry) return;
  tryApply();
  if (reg?.waiting) retry = setInterval(tryApply, RETRY_MS);
}

/** Asks the browser for a newer worker. Resolves to whether one now waits. */
export async function checkForUpdate() {
  if (!reg) return false;
  lastCheck = Date.now();
  await reg.update().catch(() => {});
  const installing = reg.installing;
  if (installing) await new Promise((done) => {
    installing.addEventListener('statechange', () => { if (installing.state !== 'installing') done(undefined); });
    setTimeout(done, 20_000);
  });
  watchWaiting();
  return waiting();
}

/** Registers the worker; a framed copy and a browser without service workers skip it. */
export async function startUpdates() {
  if (!navigator.serviceWorker || window.top !== window.self) return;
  try {
    reg = (await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })) ?? null;
  } catch {
    return;
  }
  if (!reg) return;
  // (a first worker taking a page that had none is no change of release)
  let had = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) changed(); had = true; }, { once: !!had });
  reg.addEventListener('updatefound', () => {
    const w = reg?.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') watchWaiting(); });
  });
  watchWaiting();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return void tryApply();   // out of view: the safest moment
    if (checkDue(lastCheck, Date.now())) checkForUpdate();
    else tryApply();
  });
}

