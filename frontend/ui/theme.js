// Runs before the first paint.
// 1. Frame guard, fail-closed: the page stays invisible unless it is the top-level page. Other
//    sites on the same Azure zone count as the same "site", so a framed copy could see our storage.
// 2. Day or night, so night never flashes white. "auto" follows the owner's hours (Settings › The
//    mind, `mind.day_start` and `mind.night_start`, 07:00 and 22:00 unless set, as this phone last
//    saw them in `th.p.settings`): day from the one, night from the other, flipping at each while
//    the page stays open. Settings and the shell.appearance verb change the choice through th:theme;
//    new hours arrive as th:setting.
// 3. The shell's pages cross-fade into each other (shell.css), and an app's page opened from the
//    ring uncovers from the launch colour (ui/arrive.css). A cross-fade that can't run rejects its
//    promise, which is expected, not an error: into a page that moves on before it shows (signed
//    out, home goes straight to sign-in), or toward an app's page with no launch colour over home.
try { if (window.top === window.self) document.documentElement.dataset.unframed = ''; } catch {}
{
let flip = 0;
let shown = false;
/** Day to night or back: the whole screen cross-fades (a view transition, the browser's 250 ms,
 * about --d-base) once the page is on screen; at once before its first frame, while hidden, with
 * reduced motion (the phone's or the owner's), or where the browser has no view transitions. */
const show = (t) => {
  const root = document.documentElement, rm = root.dataset.reducedMotion;
  if (root.dataset.theme === t) return;
  const still = rm === 'always' || (rm !== 'never' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!shown || still || document.hidden || !document.startViewTransition) root.dataset.theme = t;
  else document.startViewTransition(() => { root.dataset.theme = t; }).ready.catch(() => {});
};
/** Applies the theme for `pref` (the stored one when not given) and, for Auto, waits for the next of the two hours. */
const theme = (pref) => {
  clearTimeout(flip);
  let day = 7, night = 22;
  try {
    pref = pref || localStorage.getItem('th-theme') || 'auto';
    const s = JSON.parse(localStorage.getItem('th.p.settings') || '{}') || {};
    const at = (v, d) => { const h = parseInt(v, 10); return h >= 0 && h < 24 ? h : d; };
    day = at(s['mind.day_start'], 7);
    night = at(s['mind.night_start'], 22);
  } catch {}
  const now = new Date(), h = now.getHours();
  show(pref && pref !== 'auto' ? pref : h >= day && h < night ? 'light' : 'dark');
  if (pref && pref !== 'auto') return;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  for (let i = 0; i < 25; i++) { next.setHours(next.getHours() + 1); if (next.getHours() === day || next.getHours() === night) break; }
  flip = setTimeout(() => theme(), next.getTime() - now.getTime() + 50);
};
theme();
shown = true;
document.addEventListener('th:theme', (e) => {
  if (!['auto', 'light', 'dark'].includes(e.detail)) return;
  try { localStorage.setItem('th-theme', e.detail); } catch {}
  theme(e.detail);
});
document.addEventListener('th:setting', (e) => { if (/^mind\.(day|night)_start$/.test(e.detail?.key)) theme(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) theme(); });
}
try {
  // The owner's text size and still background (Settings → Appearance). The accent picker is gone
  // (owner, 2026-10-31): blue only, so an old choice is dropped.
  const d = document.documentElement.dataset;
  const text = localStorage.getItem('th-text');
  if (text === 's' || text === 'l') d.text = text;
  if (localStorage.getItem('th-still')) d.still = '';
  localStorage.removeItem('th-accent');
  // The catalogue's phone settings that CSS follows (shared/contract/settings.ts `attr`; Settings'
  // applyPhone keeps them current after this): each one stored is a choice other than the default.
  // tests/settings-depth-browser.test.mjs holds this list equal to the catalogue's.
  for (const [key, attr] of [
    ['appearance.look', 'data-look'],
    ['appearance.accent', 'data-accent-intensity'], ['appearance.glass', 'data-glass'], ['appearance.corners', 'data-corners'],
    ['appearance.glyphs', 'data-glyphs'], ['appearance.ring', 'data-ring-size'], ['appearance.haptics', 'data-haptics'],
    ['appearance.motion', 'data-reduced-motion'], ['appearance.field', 'data-field'], ['appearance.grain', 'data-grain'],
    ['appearance.idle_glow', 'data-idle-glow'], ['appearance.feel', 'data-feel'], ['appearance.ring_dim', 'data-ring-dim'],
    ['appearance.ring_label', 'data-ring-label'], ['appearance.press', 'data-press'], ['appearance.toast', 'data-toast'],
    ['appearance.status', 'data-status'], ['appearance.menu_width', 'data-menu-width'], ['appearance.brief_tiles', 'data-brief-tiles'],
    ['appearance.brief_greeting', 'data-brief-greeting'], ['chat.density', 'data-chat-density'], ['chat.time_markers', 'data-chat-times'],
    ['chat.followups', 'data-chat-followups'], ['chat.mic', 'data-mic'], ['chat.date', 'data-chat-date'],
    ['chat.hint', 'data-chat-hint'], ['chat.code_wrap', 'data-code-wrap'], ['island.mode', 'data-island'],
    ['island.art', 'data-island-art'], ['island.bars', 'data-island-bars'], ['island.progress', 'data-island-progress'],
  ]) {
    const v = localStorage.getItem(`th.s.${key}`);
    if (v && /^[a-z-]{1,16}$/.test(v)) document.documentElement.setAttribute(attr, v);
  }
} catch {}
// The look Ink and Lamp (appearance.look; frontend/look/), on the shell's pages only: its sheet, after
// <head> so it outweighs the shell's own, with the page unseen until it loads (400 ms at most), and its
// script after the first paint. Turned on in Settings it comes at once; off, its attribute goes and
// the sheet lies inert. With the classic look none of this runs. LOOK is rewritten at publish to the
// folder's hashed name (scripts/look-config.mjs).
{
  const LOOK = '/look/';
  const root = document.documentElement;
  const look = (first) => {
    if (root.dataset.look !== 'ink-lamp' || root.querySelector('link[data-look]') || /^\/(signin|setup|recover|import)\//.test(location.pathname)) return;
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${LOOK}look.css` });
    css.dataset.look = '';
    const shown = () => { clearTimeout(wait); root.style.visibility = ''; };
    const wait = first ? setTimeout(shown, 400) : 0;
    if (first) { root.style.visibility = 'hidden'; css.onload = css.onerror = shown; }
    root.append(css);
    requestAnimationFrame(() => setTimeout(() => import(`${LOOK}look.js`).catch(() => {})));
  };
  look(true);
  document.addEventListener('th:setting', (e) => { if (e.detail?.key === 'appearance.look') look(false); });
}
const expected = (fade) => fade?.ready.catch(() => {});
expected(document.activeViewTransition);
// A page the browser kept whole (its back/forward cache) shows its last frame at once, so a
// cross-fade from the page left would only flash that page again: none (ui/launch.js uncovers home).
let kept = false;
addEventListener('pageshow', (e) => { kept = e.persisted; });
addEventListener('pagereveal', (e) => { expected(e.viewTransition); if (kept) e.viewTransition?.skipTransition(); });
addEventListener('pageswap', (e) => {
  if (!e.viewTransition) return;
  expected(e.viewTransition);
  // Toward an app's page only when home's launch colour covers it (ui/launch.js): the app uncovers
  // from it (ui/arrive.css). Without one ("Opening an app": none) the app's page comes at once.
  let to = '';
  try { to = new URL(e.activation.entry.url).pathname; } catch {}
  // Only toward the app pages that take it (they load ui/arrive.css): a page that has not opted in
  // aborts the transition, and that abort is an error on the page arrived at.
  const app = /^\/(?:media|podcasts|guitar|astra|study)\/$/.test(to) && document.querySelector('.launch');
  if (!/^\/(?:|signin\/|setup\/|recover\/|import\/)$/.test(to) && !app) e.viewTransition.skipTransition();
});
