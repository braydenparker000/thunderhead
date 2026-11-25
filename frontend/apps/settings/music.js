// @ts-check
// Settings › Music (MENU-AND-SETTINGS.md §6.6b, MUSIC.md §16): whether find and the mind's brief use
// your listening history, then Listening history (music-history.js): drop the exports, see what
// was counted; then what the Worker knows about the music (music-know.js, MUSIC.md §19.6) and the
// picks to add with their previews (music-picks.js, §19.7), stopped when the page is left.
import { renderGroup } from './catalog.js';
import { historyBlock } from './music-history.js';
import { knowBlock } from './music-know.js';
import { picksBlock } from './music-picks.js';

/** @param {HTMLElement} body @returns {Promise<() => void>} the page's cleanup: a playing preview stops */
export async function page(body) {
  const picks = picksBlock();
  await renderGroup(body, 'music', { after: [historyBlock(), knowBlock([picks.box])] });
  return picks.stop;
}
