// Offline and back (FEEL.md: things appear from somewhere, and say what still works). The phone going
// offline is said once, and stays said until it is back; nothing else on screen changes.

import {toast, unpin} from '../ui/overlays.js';

export function watchOnline() {
  if (typeof addEventListener !== 'function') return;
  let away = false;
  addEventListener('offline', () => { away = true; toast('You’re offline. What Astra has saved still opens.', {stay: true}); });
  addEventListener('online', () => { if (away) { away = false; unpin(); toast('Back online'); } });
}
