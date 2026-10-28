// Runs before the first paint.
// 1. Frame guard, fail-closed: the page stays invisible unless it is the top-level page. Other
//    sites on the same Azure zone count as the same "site", so a framed copy could see our storage.
// 2. Day or night, so night never flashes white. "auto" follows the clock: night 19:00 to 07:00.
try { if (window.top === window.self) document.documentElement.dataset.unframed = ''; } catch {}
try {
  const pref = localStorage.getItem('th-theme') || 'auto';
  const hour = new Date().getHours();
  document.documentElement.dataset.theme = pref === 'auto' ? (hour >= 19 || hour < 7 ? 'dark' : 'light') : pref;
} catch {}
