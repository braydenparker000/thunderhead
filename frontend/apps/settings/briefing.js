// @ts-check
// Settings › Briefing (MENU-AND-SETTINGS.md §6.5): which tiles show and in what order, your calendars
// and the weather's units. Kept by the Worker; the mind reads the tiles.
import { renderGroup } from './catalog.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'briefing');
