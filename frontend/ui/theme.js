// Sets day or night before the first paint so night never flashes white.
// "auto" follows the clock: night from 19:00 to 07:00.
try {
  const pref = localStorage.getItem('th-theme') || 'auto';
  const hour = new Date().getHours();
  document.documentElement.dataset.theme = pref === 'auto' ? (hour >= 19 || hour < 7 ? 'dark' : 'light') : pref;
} catch {}
