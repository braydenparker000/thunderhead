// @ts-check
// A ported app's page inside home's layer (NEXT-BATCH.md part 3) that loaded again by itself (Music
// reloads on a day/night switch, a skin change or a settings import) is a new page to its worker, and
// the token home opened the frame with is spent. So it asks home, its top page, for a fresh one and
// gives it to its worker (th/ported/frames.js, `frame-claim`). Home hands one only to its own layer's
// frame; a page another site frames can't reach home at all. Nothing happens in a top-level page.
import { framedByOther } from './session.js';

export async function claim() {
  if (typeof window === 'undefined' || window.top === window.self || framedByOther()) return false;
  const worker = navigator.serviceWorker?.controller;
  const home = /** @type {any} */ (window.top);
  if (!worker || typeof home?.thIsland?.token !== 'function') return false;
  const token = await home.thIsland.token(window).catch(() => '');
  if (!token) return false;
  const ch = new MessageChannel();
  return new Promise((r) => {
    ch.port1.onmessage = (e) => r(e.data?.ok === true);
    worker.postMessage({ th: 'frame-claim', token }, [ch.port2]);
    setTimeout(() => r(false), 1500);
  });
}

void claim();
