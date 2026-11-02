// @ts-check
// Settings › Home and chat (MENU-AND-SETTINGS.md §6.2): time markers, folding, how a reply appears,
// follow-ups, Enter and the dictation language. Kept on this phone; the chat reads them with
// phoneValue() from catalog.js.
import { renderGroup } from './catalog.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'chat');
