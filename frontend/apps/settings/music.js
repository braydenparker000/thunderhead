// @ts-check
// Settings › Music (MENU-AND-SETTINGS.md §6.6b, MUSIC.md §16): whether find and the mind's brief use
// your listening history, then Listening history (music-history.js): drop the exports, see what
// was counted.
import { renderGroup } from './catalog.js';
import { historyBlock } from './music-history.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'music', { after: [historyBlock()] });
