// @ts-check
// Settings › Appearance (MENU-AND-SETTINGS.md §6.1): the rest of the look, past the theme, text size
// and still background at the top of Settings: accent intensity, glass, corners, ring size, haptics
// and reduced motion. Kept on this phone; each puts a data attribute on <html> (catalog.js).
import { renderGroup } from './catalog.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'appearance');
