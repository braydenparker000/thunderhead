// The owner's listening history for the DJ shuffle (MUSIC.md §16.4): each catalog song's weight,
// 0 to 1 by the log of its artist's plays, from the Worker (GET /v1/music/taste/weights) each time
// Music opens. While the switch "Use my listening history" (music.history) is off the Worker sends
// none and this phone keeps none, so the DJ weighs nothing; signed out or offline, the last answer
// stays. Song ids and numbers only, kept on this phone (th/music/dj.js reads them).
import { getJson } from '../ported/arrangement.js';
import { TASTE_STORE } from './dj.js';

export async function installTaste() {
  /** @type {{ on?: boolean, weights?: Record<string, number> } | null} */
  const r = await getJson('/v1/music/taste/weights');
  if (!r || typeof r.on !== 'boolean') return;
  try {
    if (r.on && r.weights && Object.keys(r.weights).length) localStorage.setItem(TASTE_STORE, JSON.stringify({ at: Date.now(), weights: r.weights }));
    else localStorage.removeItem(TASTE_STORE);
  } catch {
    // A phone whose storage is full or blocked plays the DJ without the history.
  }
}
