// @ts-check
// Apps inside the Thunderhead, and the island (NEXT-BATCH.md part 3; HOME.md §13). Home stays
// loaded. Music and Podcasts open as a layer over it, in a frame, with the ring's circle reveal
// (ui/launch.js); the other apps open as before. Swipe down on the app's mini player, or Back, and
// the app shrinks into the island, one shape on a spring, and keeps playing behind the chat. The
// island is a door, not a player: a small dark shape at the top, Music's live level bars (from its
// own audio engine) or Podcasts' ring of the time left. Tap it and the app grows back out of it; hold
// it and it opens wide for a moment (the song, pause and skip, Who is this?, More like this, Close);
// swipe it sideways for next or previous. The phone's commands reach the playing app through here
// (control()). The frame gets the owner's session only because home opened it (th/ported/frames.js:
// a one-time token for the app's worker, given before the frame opens). Only transform, opacity and
// clip-path animate; with reduced motion, a crossfade.
import { appFor } from '../registry/apps.js';

/** The apps that open as a layer and keep playing behind the chat. */
export const LAYERED = Object.freeze(['music', 'podcasts']);
const BARS = 5;
const HOLD_MS = 450;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SETTLE = () => getComputedStyle(document.documentElement).getPropertyValue('--settle').trim() || 'cubic-bezier(.2,.7,.2,1)';
const FULL = 'inset(0px 0px 0px 0px round 0px)';
/** @param {DOMRect} r */
const clipTo = (r) => `inset(${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px round ${r.height / 2}px)`;

/** @typedef {{ id: string, frame: HTMLIFrameElement, front: boolean }} Layer */
/** @type {Layer | null} */
let layer = null;
/** @type {HTMLButtonElement | null} */
let island = null;
let raf = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let slow;

/** Home's side of th/ported/claim.js: a fresh token, only for its own layer's frame. */
/** @type {any} */ (window).thIsland = {
  /** @param {Window} w the asking page */
  token: async (w) => (layer && w === layer.frame.contentWindow ? frameToken(appFor(layer.id)?.path ?? '') : ''),
};

/** Whether `id` opens as a layer here. @param {string} id */
export const layered = (id) => LAYERED.includes(id);

/** The app's window in the frame, when it has loaded (same site). @returns {any} */
function win() {
  try {
    return layer?.frame.contentWindow ?? null;
  } catch {
    return null;
  }
}

/** Music's player, or Podcasts' audio element, in the frame.
 * @returns {{ kind: 'music', p: any, w: any } | { kind: 'podcasts', a: HTMLAudioElement, w: any } | null} */
function media() {
  const w = win();
  if (!w || !layer) return null;
  // A frame that ended on an error page (offline, a crash) is another origin: nothing to reach.
  try {
    if (layer.id === 'music') return w.__cp?.player ? { kind: 'music', p: w.__cp.player, w } : null;
    const a = /** @type {HTMLAudioElement | null} */ (w.document?.querySelector('audio'));
    return a ? { kind: 'podcasts', a, w } : null;
  } catch {
    return null;
  }
}

/** Whether the app behind the chat is playing. */
export function playing() {
  const m = media();
  if (!m) return false;
  const el = m.kind === 'music' ? m.p.audio : m.a;
  return Boolean(el && !el.paused && !el.ended);
}

/** One-time token for the app's worker, so it trusts this frame (th/ported/frames.js). Waits up to
 * 4 s for a worker to be there (registering it on a first visit) and for its answer.
 * @param {string} scope the app's folder */
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

/**
 * Opens `id` as a layer (true), or says it doesn't open as one (false: the caller navigates).
 * @param {string} id @param {{ cover?: () => Promise<void> }} [o] the ring's reveal, already sized
 */
export async function openApp(id, o = {}) {
  const app = appFor(id);
  if (!layered(id) || !app?.built) return false;
  if (layer?.id === id) {
    if (!layer.front) await expand('open');
    return true;
  }
  if (layer) close();
  styles();
  const [token] = await Promise.all([frameToken(app.path), o.cover?.()]);
  const frame = document.createElement('iframe');
  frame.className = 'th-app';
  frame.title = app.name;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; screen-wake-lock';
  frame.src = token ? `${app.path}?th-frame=${token}` : app.path;
  document.body.append(frame);
  layer = { id, frame, front: true };
  history.pushState({ th: 'app', app: id }, '');
  await new Promise((r) => {
    frame.addEventListener('load', r, { once: true });
    setTimeout(r, 8000);
  });
  watch(frame);
  // The ring's circle (ui/launch.js) gives way to the app under it.
  const cover = /** @type {HTMLElement | null} */ (document.querySelector('.launch'));
  if (cover) cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).finished.then(() => cover.remove(), () => cover.remove());
  return true;
}

/** The app shrinks into the island and goes on behind the chat. @param {string} why */
export async function collapse(why) {
  if (!layer?.front) return;
  layer.front = false;
  const is = ensureIsland();
  is.hidden = false;
  const r = is.getBoundingClientRect();
  const f = layer.frame;
  if (still()) f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  else {
    f.animate([{ clipPath: FULL }, { clipPath: clipTo(r), offset: 0.8 }, { clipPath: clipTo(r), opacity: 0 }], { duration: 560, easing: SETTLE(), fill: 'forwards' });
    is.animate(
      [
        { opacity: 0, transform: 'scale(.55)' },
        { opacity: 0, transform: 'scale(.55)', offset: 0.6 },
        { opacity: 1, transform: 'scale(1.1,.86)', offset: 0.82 },
        { opacity: 1, transform: 'scale(.98,1.03)', offset: 0.92 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 640, easing: 'ease-out' },
    );
  }
  f.classList.add('away');
  f.inert = true;
  document.body.dataset.island = layer.id;
  void why;
  tick();
}

/** The island grows back into the app. @param {string} why */
export async function expand(why) {
  if (!layer || layer.front) return;
  layer.front = true;
  const f = layer.frame;
  const is = ensureIsland();
  const r = is.getBoundingClientRect();
  for (const a of f.getAnimations()) a.cancel();
  f.classList.remove('away');
  f.inert = false;
  delete document.body.dataset.island;
  // One entry for the app in front: a swipe down leaves it, so Back still brings the chat.
  if (history.state?.th !== 'app') history.pushState({ th: 'app', app: layer.id }, '');
  const grow = still()
    ? f.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })
    : f.animate([{ clipPath: clipTo(r), opacity: 0 }, { clipPath: clipTo(r), opacity: 1, offset: 0.1 }, { clipPath: FULL, opacity: 1 }], { duration: 620, easing: SETTLE() });
  is.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.14)', opacity: 1, offset: 0.35 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: still() ? 1 : 300, easing: 'ease-in' });
  await grow.finished.catch(() => {});
  is.hidden = true;
  void why;
}

/** The app goes: its frame unloads (and its sound stops), the island goes. */
export function close() {
  layer?.frame.remove();
  layer = null;
  if (island) island.hidden = true;
  delete document.body.dataset.island;
  cancelAnimationFrame(raf);
  clearTimeout(slow);
}

/** Back from the app goes to the chat, not out of home. */
addEventListener('popstate', () => {
  if (layer?.front) void collapse('Back');
});

/** The swipe down on the app's own mini player (its bottom strip), read from the frame's touches. @param {HTMLIFrameElement} f */
function watch(f) {
  const w = /** @type {any} */ (f.contentWindow);
  if (!w) return;
  /** @type {{ x: number, y: number } | null} */
  let s = null;
  const opts = { capture: true, passive: true };
  try {
    w.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => (s = e.clientY > w.innerHeight - 150 ? { x: e.clientX, y: e.clientY } : null), opts);
    w.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (!s) return;
      const dy = e.clientY - s.y;
      if (dy > 56 && dy > Math.abs(e.clientX - s.x) * 1.4) {
        s = null;
        void collapse('swipe down');
      }
    }, opts);
    for (const t of ['pointerup', 'pointercancel']) w.addEventListener(t, () => (s = null), opts);
  } catch {}
}

/** The island's element, made once. */
function ensureIsland() {
  if (island) return island;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'th-island';
  b.hidden = true;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const bars = document.createElement('span');
  bars.className = 'bars';
  for (let i = 0; i < BARS; i++) bars.append(document.createElement('i'));
  const left = document.createElement('span');
  left.className = 'left';
  b.append(dot, bars, left);
  document.body.append(b);
  gestures(b);
  island = b;
  return b;
}

/** Tap: back into the app. Hold: the wide card. Sideways: next or previous. @param {HTMLButtonElement} b */
function gestures(b) {
  /** @type {{ x: number, y: number, t: number } | null} */
  let s = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hold;
  let done = false;
  b.addEventListener('pointerdown', (e) => {
    s = { x: e.clientX, y: e.clientY, t: Date.now() };
    done = false;
    hold = setTimeout(() => {
      done = true;
      wide();
    }, HOLD_MS);
  });
  b.addEventListener('pointermove', (e) => {
    if (!s || done) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
      clearTimeout(hold);
      done = true;
      control(dx < 0 ? 'next' : 'previous');
      b.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx < 0 ? -14 : 14}px)` }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' });
    }
  });
  b.addEventListener('pointerup', () => {
    clearTimeout(hold);
    if (s && !done) void expand('tap on the island');
    s = null;
  });
  b.addEventListener('pointercancel', () => {
    clearTimeout(hold);
    s = null;
  });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void expand('keyboard');
    }
  });
}

/** The live look: Music's level from its engine's meter (60 frames a second), Podcasts' time left. */
function tick() {
  cancelAnimationFrame(raf);
  clearTimeout(slow);
  const is = island;
  if (!is || !layer || layer.front) return;
  const m = media();
  const color = appFor(layer.id)?.color ?? '#2f7df6';
  is.style.setProperty('--c', color);
  is.dataset.app = layer.id;
  const on = playing();
  is.classList.toggle('playing', on);
  is.setAttribute('aria-label', `${appFor(layer.id)?.name ?? 'The app'} ${on ? 'playing' : 'paused'}: tap to open, hold for more`);
  if (m?.kind === 'music') {
    let an = null;
    try {
      an = m.w.__cp?.dsp?.nodes?.analyser ?? null;
    } catch {}
    const bars = /** @type {NodeListOf<HTMLElement>} */ (is.querySelectorAll('.bars i'));
    if (an && on && !document.hidden) {
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / 3 / BARS));
      bars.forEach((b, i) => {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += data[i * step + k] ?? 0;
        b.style.transform = `scaleY(${Math.max(0.18, Math.min(1, sum / step / 190)).toFixed(3)})`;
      });
      is.classList.add('live');
    } else is.classList.remove('live');
  } else if (m?.kind === 'podcasts') {
    const a = m.a;
    const left = a.duration > 0 ? Math.max(0, a.duration - a.currentTime) : 0;
    is.style.setProperty('--done', `${a.duration > 0 ? Math.round((a.currentTime / a.duration) * 360) : 0}deg`);
    /** @type {HTMLElement} */ (is.querySelector('.left')).textContent = left ? `${Math.max(1, Math.round(left / 60))} min` : '';
  }
  // Every frame while the bars move; twice a second otherwise (paused, Podcasts, the screen off).
  if (is.classList.contains('live')) raf = requestAnimationFrame(tick);
  else slow = setTimeout(tick, 500);
}

/** Held: the island opens wide for a moment with the song and its buttons, then shrinks back. */
function wide() {
  const m = media();
  const is = island;
  if (!is || !layer) return;
  document.querySelector('.th-wide')?.remove();
  const card = document.createElement('div');
  card.className = 'th-wide';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', appFor(layer.id)?.name ?? 'Playing');
  const t = m?.kind === 'music' ? m.p.track : null;
  // On this screen only: the title is read from the app here and sent nowhere.
  const title = document.createElement('p');
  title.className = 'tt';
  title.textContent = t?.title || (m?.kind === 'podcasts' ? m.w.document.title : appFor(layer.id)?.name) || '';
  const by = document.createElement('p');
  by.className = 'by';
  by.textContent = t?.artist || '';
  const row = document.createElement('div');
  row.className = 'row';
  /** @param {string} label @param {() => void} run */
  const btn = (label, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      run();
      shut();
    });
    row.append(b);
  };
  btn(playing() ? 'Pause' : 'Play', () => control(playing() ? 'pause' : 'play'));
  btn(m?.kind === 'podcasts' ? '+30 s' : 'Next', () => control('next'));
  if (m?.kind === 'music') {
    btn('Who is this?', () => ask('Who is this?'));
    btn('More like this', () => ask('More like this'));
  }
  btn(`Open ${appFor(layer.id)?.name ?? ''}`.trim(), () => void expand('open from the card'));
  btn('Close', close);
  card.append(title, by, row);
  document.body.append(card);
  card.animate(still() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateX(-50%) scale(.6,.4)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 300, easing: SETTLE() });
  const timer = setTimeout(shut, 5000);
  const away = (/** @type {Event} */ e) => !card.contains(/** @type {Node} */ (e.target)) && shut();
  setTimeout(() => addEventListener('pointerdown', away, true));
  function shut() {
    clearTimeout(timer);
    removeEventListener('pointerdown', away, true);
    card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).finished.then(() => card.remove(), () => card.remove());
  }
}

/** Puts words in the ask bar and sends them, as the owner would. @param {string} text */
function ask(text) {
  const q = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('#q'));
  const form = /** @type {HTMLFormElement | null} */ (document.querySelector('#ask'));
  if (!q || !form) return;
  q.value = text;
  q.dispatchEvent(new Event('input'));
  form.requestSubmit();
}

/**
 * The phone's commands, on the app playing behind the chat (or in front). `minutes` for 'sleep'.
 * @param {'pause' | 'play' | 'next' | 'previous' | 'sleep' | 'never'} cmd @param {number} [minutes]
 * @returns {{ ok: boolean, text: string, undo?: () => void }}
 */
export function control(cmd, minutes = 30) {
  const m = media();
  if (!m) return { ok: false, text: 'Nothing is playing here. Open Music or Podcasts first.' };
  if (m.kind === 'podcasts') {
    const a = m.a;
    if (cmd === 'pause') a.pause();
    else if (cmd === 'play') void a.play().catch(() => {});
    else if (cmd === 'next') a.currentTime = Math.min(a.duration || Infinity, a.currentTime + 30);
    else if (cmd === 'previous') a.currentTime = Math.max(0, a.currentTime - 15);
    else if (cmd === 'sleep') {
      setTimeout(() => a.pause(), minutes * 60_000);
      return { ok: true, text: `Podcasts stops in ${minutes} minutes.` };
    } else return { ok: false, text: 'That works in Music.' };
    tick();
    return { ok: true, text: { pause: 'Paused.', play: 'Playing.', next: '30 seconds on.', previous: '15 seconds back.' }[cmd] ?? '' };
  }
  const p = m.p;
  if (cmd === 'pause') p.pause();
  else if (cmd === 'play') p.play();
  else if (cmd === 'next') p.step(1);
  else if (cmd === 'previous') p.step(-1);
  else if (cmd === 'sleep') {
    // Music's own sleep timer: it fades out and stops (MUSIC.md's sleep timer).
    p.setSleepTimer(minutes * 60, false);
    return { ok: true, text: `Music stops in ${minutes} minutes.`, undo: () => p.setSleepTimer(0, false) };
  } else if (cmd === 'never') {
    const t = p.track;
    const lib = m.w.__cp?.library;
    if (!t || !lib?.setRating) return { ok: false, text: "Couldn't reach the song." };
    const before = t.rating ?? 0;
    lib.setRating(t, 1);
    rated(t.id, 1, before);
    p.step(1);
    return {
      ok: true,
      text: 'Skipped. Rated "not for me": it won\'t come up again.',
      undo: () => {
        lib.setRating(t, before);
        rated(t.id, before, 1);
      },
    };
  }
  tick();
  return { ok: true, text: { pause: 'Paused.', play: 'Playing.', next: 'Next song.', previous: 'Previous song.' }[cmd] ?? '' };
}

/** A rating the owner set from home, as a sense with the song's id (MUSIC.md §10.1 `music.rate`), so
 * the mind keeps a "never" out of its mixes too. @param {string} id @param {number} rating @param {number} from */
function rated(id, rating, from) {
  if (!/^[A-Za-z0-9._:/-]{1,154}$/.test(id)) return;
  import('../senses/send.js').then((s) => s.sense('music.rate', `music:${id}`, { rating, from, by: 'command' }), () => {});
}

/** The island's styles, loaded the first time an app opens as a layer. */
function styles() {
  if (document.querySelector('link[href="/th/island/island.css"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/th/island/island.css';
  document.head.append(l);
}
