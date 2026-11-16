// @ts-check
// The zoom's badge: its per cent, with the red dot beating while the GPU makes something the screen is waiting for, and
// under it, small, what that is (the owner, 2026-11-16: "a small note of what's being loaded while the red dot's
// flashing, underneath it"). What is being made is the engine's own word for it (engine/work.js `doing`): "Loading full
// detail", "Loading Starfish", "Preparing Starfish", "Building a sharper copy". Fitted, the badge shows only while one is.
import { making, onMaking } from '../../engine/work.js';

/** Fills `badge` with its two lines; `shown` is called when what is made changes, to show or hide the badge.
 * @param {HTMLElement} badge @param {() => void} shown @returns {HTMLElement} the per cent's own element */
export function badgeLines(badge, shown) {
  const pct = document.createElement('span'), note = document.createElement('span');
  note.style.cssText = 'display: none; margin-top: 2px; font-size: 10px; font-weight: 500; opacity: 0.85; white-space: nowrap';
  badge.append(pct, note);
  onMaking(() => { const m = making(); pct.classList.toggle('busy', !!m); note.textContent = m; note.style.display = m ? 'block' : 'none'; shown(); });
  return pct;
}
