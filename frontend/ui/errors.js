// @ts-check
// The shell's error reporter (NEXT-BATCH.md part 1): home's and Study's uncaught errors and unhandled
// rejections go to the Worker's inbox (`POST /v1/ops/errors`, API.md §11.16), where the mind reads
// them with `th errors`, so a bug on the owner's phone is seen without anyone reporting it. Only signed
// in, and only from a top-level page (the session store gives a framed page nothing). What goes: the
// error's words with every address cut to its host and quoted text cut, where in this site's code it
// came from, the page's path and the build (ui/error-items.js); nothing the owner typed or saved. A batch goes 2 s after the
// last error, or at once when the page is hidden. Load it as a page's first module:
//   <script type="module" src="/ui/errors.js" data-app="home"></script>
import { CONFIG } from '/config.js';
import { store } from '/th/session.js';
import { collector, itemOf } from './error-items.js';

const app = /** @type {HTMLScriptElement | null} */ (document.querySelector('script[src="/ui/errors.js"]'))?.dataset.app || 'home';
/** @type {string | null} */
let token = null;
const ready = CONFIG.api
  ? store.read().then((s) => { token = s?.token ?? null; }, () => {})
  : null;

const inbox = collector((items) => {
  const send = () => {
    if (!token) return;
    fetch(`${CONFIG.api}/v1/ops/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    }).catch(() => {});
  };
  if (token) send();
  else ready?.then(send);
});

/** @param {'error' | 'rejection'} kind @param {unknown} error @param {string} [message] */
const add = (kind, error, message) =>
  inbox.add(itemOf({ app, kind, error, message, origin: location.origin, path: location.pathname, build: CONFIG.build || 0, at: Date.now() }));

if (ready) {
  addEventListener('error', (e) => {
    // A failed <img> or <script> load also fires "error", without an Error: not a bug in the code.
    if (e.target && e.target !== window) return;
    add('error', e.error, e.message);
  });
  addEventListener('unhandledrejection', (e) => add('rejection', e.reason));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') inbox.flush();
  });
  addEventListener('pagehide', () => inbox.flush());
}
