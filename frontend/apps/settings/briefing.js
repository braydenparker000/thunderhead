// @ts-check
// Settings › Briefing (MENU-AND-SETTINGS.md §6.5): which tiles show and in what order, units, how far
// ahead Due looks and the holiday country. Kept by the Worker; the mind reads the tiles.
import { renderGroup } from './catalog.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'briefing');
