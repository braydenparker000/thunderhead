// @ts-check
// One retained browsing context per app. Only windows in this map can reclaim a frame token.
import { appFor } from '../registry/apps.js';

/** @typedef {{ id:string, frame:HTMLIFrameElement, shell:HTMLDivElement, cover:HTMLDivElement,
 * front:boolean, ready:boolean, loaded:Promise<void>, readyAt:number }} Layer */
/** @type {Map<string, Layer>} */
export const frames = new Map();
/** @type {any} */ (window).thIsland = {
  /** @param {Window} w */
  token: async w => {
    const own = [...frames.values()].find(l => l.frame.contentWindow === w);
    return own ? frameToken(appFor(own.id)?.path ?? '') : '';
  },
};

/** Uses the apps' completed startup state, never iframe load as a readiness proxy. @param {Layer} l */
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
  const frame = document.createElement('iframe');
  frame.className = 'th-app away';
  frame.dataset.app = id;
  frame.title = app.name;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; screen-wake-lock';
  frame.inert = true;
  const cover = document.createElement('div');
  cover.className = 'th-app-wait';
  cover.setAttribute('role', 'status');
  cover.setAttribute('aria-label', `Opening ${app.name}`);
  const dots = document.createElement('span');
  dots.className = 'wait-dots';
  for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
  cover.append(dots);
  shell.append(frame, cover);
  const l = { id, frame, shell, cover, front:false, ready:false, loaded:Promise.resolve(), readyAt:0 };
  frames.set(id, l);
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let failed;
  /** @type {MutationObserver|null} */
  let boot = null;
  /** @type {()=>void} */
  let ready = () => {};
  let pending = false;
  const reset = () => {
    boot?.disconnect(); clearTimeout(failed);
    l.ready = false; delete frame.dataset.ready; cover.hidden = false;
    cover.querySelector('button')?.remove();
    if (!pending) { l.loaded = new Promise(resolve => { ready = resolve; }); pending = true; }
  };
  const check = () => {
    if (l.ready || !interactive(l)) return;
    boot?.disconnect(); clearTimeout(failed);
    l.ready = true; l.readyAt = performance.now();
    frame.dataset.ready = 'true'; cover.hidden = true; pending = false; ready();
  };
  const deadline = () => {
    clearTimeout(failed);
    failed = setTimeout(() => {
      if (l.ready) return;
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = `Retry ${app.name}`;
      retry.addEventListener('click', () => { reset(); frame.src = frame.src; deadline(); });
      cover.append(retry);
    }, 15_000);
  };
  reset();
  frame.addEventListener('load', () => {
    try {
      if (frame.contentWindow?.location.pathname !== app.path) return;
      watch(l);
      frame.contentWindow.addEventListener('pagehide', () => { reset(); deadline(); }, {once:true});
      // Music removes cp-boot; Podcasts measures its chrome after installing handlers.
      // Observe those completion mutations, including a late success after the retry appears.
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
    // The app's own worker: home's worker (scope /) also matches the app's folder, so only a
    // registration for exactly that folder will do; on a first visit it is registered here.
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
