// @ts-check
// The shell's side of the service worker (ARCHITECTURE.md §8.3): register /sw.js, look for a new
// release when the page comes back into view (at most hourly), and apply a waiting worker only at
// a safe moment, then reload behind a short fade. If no safe moment comes, the browser applies it
// at the next cold start.
import { FADE_MS, RETRY_MS, checkDue, safeToApply } from './update-rules.js';

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
    typing: Boolean(q?.value.trim()) || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement,
    overlay: document.querySelector('#opts.show, #side.open, .ring.show, .spage, [aria-modal="true"]') !== null,
  };
}

/** Whether a new release has installed and waits. */
export function waiting() {
  return Boolean(reg?.waiting && navigator.serviceWorker.controller);
}

/** The new release's worker is in charge: reload into it behind a short fade. */
function reloadNow() {
  document.documentElement.style.transition = `opacity ${FADE_MS}ms`;
  document.documentElement.style.opacity = '0';
  setTimeout(() => location.reload(), FADE_MS);
}

function tryApply() {
  if (!reg?.waiting || !safeToApply(state())) return;
  const next = reg.waiting;
  if (retry) clearInterval(retry);
  retry = null;
  mine = true;
  next.postMessage({ type: 'skipWaiting' });
}

/** Whether this page asked for the change of worker (it was a safe moment then). */
let mine = false;
/** The worker in charge changed. Asked for here: reload. Applied by another page (the editor's pages apply a
 * release when they open, lab/engine/fresh.js): this page's code is the release before's and what it fetches from
 * now on is the new one's, so it reloads too, at its next safe moment. */
function changed() {
  if (mine || safeToApply(state())) { reloadNow(); return; }
  const t = setInterval(() => { if (safeToApply(state())) { clearInterval(t); reloadNow(); } }, RETRY_MS);
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
  // (a first worker taking a page that had none is not a change of release)
  let had = Boolean(navigator.serviceWorker.controller), told = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!had) { had = true; return; } if (!told) { told = true; changed(); } });
  reg.addEventListener('updatefound', () => {
    const w = reg?.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') watchWaiting(); });
  });
  watchWaiting();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (checkDue(lastCheck, Date.now())) checkForUpdate();
    else tryApply();
  });
}

