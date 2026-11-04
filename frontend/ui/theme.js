// Runs before the first paint.
// 1. Frame guard, fail-closed: the page stays invisible unless it is the top-level page. Other
//    sites on the same Azure zone count as the same "site", so a framed copy could see our storage.
// 2. Day or night, so night never flashes white. "auto" follows the owner's hours (Settings › The
//    mind, `mind.day_start` and `mind.night_start`, 07:00 and 22:00 unless set, as this phone last
//    saw them in `th.p.settings`): day from the one, night from the other, flipping at each while
//    the page stays open. Settings and the shell.appearance verb change the choice through th:theme;
//    new hours arrive as th:setting.
// 3. The shell's pages cross-fade into each other (shell.css). A cross-fade that can't run rejects
//    its promise, which is expected, not an error: into a page that moves on before it shows (signed
//    out, home goes straight to sign-in), or toward an app's page, which doesn't take part and would
//    throw on arriving, so it is skipped before it leaves.
try { if (window.top === window.self) document.documentElement.dataset.unframed = ''; } catch {}
{
let flip = 0;
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
  document.documentElement.dataset.theme = pref && pref !== 'auto' ? pref : h >= day && h < night ? 'light' : 'dark';
  if (pref && pref !== 'auto') return;
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  for (let i = 0; i < 25; i++) { next.setHours(next.getHours() + 1); if (next.getHours() === day || next.getHours() === night) break; }
  flip = setTimeout(() => theme(), next.getTime() - now.getTime() + 50);
};
theme();
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
    ['appearance.accent', 'data-accent-intensity'], ['appearance.glass', 'data-glass'], ['appearance.corners', 'data-corners'],
    ['appearance.glyphs', 'data-glyphs'], ['appearance.ring', 'data-ring-size'], ['appearance.haptics', 'data-haptics'],
    ['appearance.motion', 'data-reduced-motion'], ['chat.density', 'data-chat-density'], ['chat.mic', 'data-mic'], ['island.mode', 'data-island'],
  ]) {
    const v = localStorage.getItem(`th.s.${key}`);
    if (v && /^[a-z-]{1,16}$/.test(v)) document.documentElement.setAttribute(attr, v);
  }
} catch {}
const expected = (fade) => fade?.ready.catch(() => {});
expected(document.activeViewTransition);
addEventListener('pagereveal', (e) => expected(e.viewTransition));
addEventListener('pageswap', (e) => {
  if (!e.viewTransition) return;
  expected(e.viewTransition);
  if (!/^\/(?:|signin\/|setup\/|recover\/|import\/)$/.test(new URL(e.activation.entry.url).pathname)) e.viewTransition.skipTransition();
});
