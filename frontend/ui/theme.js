// Runs before the first paint.
// 1. Frame guard, fail-closed: the page stays invisible unless it is the top-level page. Other
//    sites on the same Azure zone count as the same "site", so a framed copy could see our storage.
// 2. Day or night, so night never flashes white. "auto" follows the clock: night 19:00 to 07:00.
// 3. The shell's pages cross-fade into each other (shell.css). A cross-fade that can't run rejects
//    its promise, which is expected, not an error: into a page that moves on before it shows (signed
//    out, home goes straight to sign-in), or toward an app's page, which doesn't take part and would
//    throw on arriving, so it is skipped before it leaves.
try { if (window.top === window.self) document.documentElement.dataset.unframed = ''; } catch {}
try {
  const pref = localStorage.getItem('th-theme') || 'auto';
  const hour = new Date().getHours();
  document.documentElement.dataset.theme = pref === 'auto' ? (hour >= 19 || hour < 7 ? 'dark' : 'light') : pref;
  // The owner's text size, accent and still background (Settings → Appearance).
  const d = document.documentElement.dataset;
  const text = localStorage.getItem('th-text');
  const accent = localStorage.getItem('th-accent');
  if (text === 's' || text === 'l') d.text = text;
  if (accent === 'green' || accent === 'violet' || accent === 'rose') d.accent = accent;
  if (localStorage.getItem('th-still')) d.still = '';
} catch {}
const expected = (fade) => fade?.ready.catch(() => {});
expected(document.activeViewTransition);
addEventListener('pagereveal', (e) => expected(e.viewTransition));
addEventListener('pageswap', (e) => {
  if (!e.viewTransition) return;
  expected(e.viewTransition);
  if (!/^\/(?:|signin\/|setup\/|recover\/|import\/)$/.test(new URL(e.activation.entry.url).pathname)) e.viewTransition.skipTransition();
});
