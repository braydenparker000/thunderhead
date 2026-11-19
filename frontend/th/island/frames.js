// @ts-check
// One retained browsing context per app; only these windows can reclaim a frame token.
import { appFor } from '../registry/apps.js';

/** @typedef {{ id:string, frame:HTMLIFrameElement, shell:HTMLDivElement, cover:HTMLDivElement,
 * front:boolean, ready:boolean, loaded:Promise<void> }} Layer */
/** @type {Map<string, Layer>} */
export const frames = new Map();
/** @type {any} */ (window).thIsland = {
  /** @param {Window} w */
  token: async w => {
    const own = [...frames.values()].find(l => l.frame.contentWindow === w);
    return own ? frameToken(appFor(own.id)?.path ?? '') : '';
  },
};

/** The apps' own finished startup, never the frame's load. @param {Layer} l */
function interactive(l) {
  try {
    const w = /** @type {any} */ (l.frame.contentWindow);
    if (w.location.pathname !== appFor(l.id)?.path) return false;
    return l.id === 'music' ? Boolean(w.__cp?.player && !w.document.querySelector('#cp-boot'))
      : Boolean(w.document.body.style.getPropertyValue('--nav-clearance'));
  } catch { return false; }
}

/** @param {string} id @param {(l:Layer)=>void} watch */
export function retain(id, watch) {
  const had = frames.get(id);
  if (had) return had;
  const app = appFor(id);
  if (!app) throw new Error('Unknown app');
  const shell = document.createElement('div');
  shell.className = 'th-app-shell parked';
  shell.style.setProperty('--c', app.color);
  shell.innerHTML = `<iframe class="th-app away" allow="autoplay; fullscreen; picture-in-picture; screen-wake-lock" inert></iframe><div class="th-app-wait" role="status"><span class="wait-dots"><i></i><i></i><i></i></span></div>`;
  const frame = /** @type {HTMLIFrameElement} */ (shell.firstChild), cover = /** @type {HTMLDivElement} */ (shell.lastChild);
  frame.dataset.app = id; frame.title = app.name;
  cover.ariaLabel=`Opening ${app.name}`;
  const l = { id, frame, shell, cover, front:false, ready:false, loaded:Promise.resolve() };
  frames.set(id, l);
  /** @type {MutationObserver|null} */
  let boot = null, failed = 0, ready = () => {}, pending = false;
  const reset = () => {
    boot?.disconnect(); clearTimeout(failed);
    l.ready = false; delete frame.dataset.ready; cover.hidden = false;
    cover.querySelector('button')?.remove();
    if (!pending) { l.loaded = new Promise(resolve => { ready = resolve; }); pending = true; }
  };
  const check = () => {
    if (l.ready || !interactive(l)) return;
    boot?.disconnect(); clearTimeout(failed);
    l.ready = true;
    frame.dataset.ready = 'true'; cover.hidden = true; pending = false; ready();
  };
  const deadline = () => {
    clearTimeout(failed);
    failed = setTimeout(() => {
      if (l.ready) return;
      const retry = cover.appendChild(document.createElement('button'));
      retry.textContent = `Retry ${app.name}`;
      retry.onclick = () => { reset(); frame.src = frame.src; deadline(); };
    }, 15_000);
  };
  reset();
  frame.addEventListener('load', () => {
    try {
      if (frame.contentWindow?.location.pathname !== app.path) return;
      watch(l);
      frame.contentWindow.addEventListener('pagehide', () => { reset(); deadline(); }, {once:true});
      // Music removes cp-boot; Podcasts measures its chrome: watch for either, even after a retry.
      boot?.disconnect(); boot = new MutationObserver(check);
      boot.observe(/** @type {Document} */ (frame.contentDocument), {subtree:true,childList:true,attributes:true,attributeFilter:['style']});
      check();
    } catch {}
  });
  document.body.append(shell);
  void frameToken(app.path).then(token => {
    frame.src = token ? `${app.path}?th-frame=${token}` : app.path;
    deadline();
  });
  return l;
}

/** @param {string} scope */
async function frameToken(scope) {
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return '';
    // The app's own worker (home's, scope /, also matches its folder); registered on a first visit.
    let reg = await sw.getRegistration(scope);
    if (!reg || new URL(reg.scope).pathname !== scope) reg = await sw.register(`${scope}sw.js`, { scope, type: scope === '/podcasts/' ? 'module' : 'classic' });
    const worker = reg.active ?? (await new Promise((r) => {
      const w = reg.installing ?? reg.waiting;
      w?.addEventListener('statechange', () => w.state === 'activated' && r(reg.active));
      setTimeout(() => r(reg.active), 4000);
    }));
    if (!worker) return '';
    const ch = new MessageChannel();
    const ok = await new Promise((r) => {
      ch.port1.onmessage = (e) => r(e.data?.ok === true);
      worker.postMessage({ th: 'frame-token', token }, [ch.port2]);
      setTimeout(() => r(false), 1500);
    });
    return ok ? token : '';
  } catch {
    return '';
  }
}
