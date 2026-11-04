// @ts-check
// Settings › The mind (MENU-AND-SETTINGS.md §6.6): today's count of wakes and minutes at the top
// (mind-meter.js), then how I talk, nights, waking, how I reach you, and the standing permissions
// per kind of action. Kept by the Worker; all in the mind's briefing (section 13). Then What lands
// (mind-lands.js): what you did with each topic I placed, and Reopen for one that rests; then
// Routines (mind-routines.js): what you approved once, each with its switch and Undo for its last run.
import { renderGroup } from './catalog.js';
import { landsFold } from './mind-lands.js';
import { routinesFold } from './mind-routines.js';
import { meterBlock } from './mind-meter.js';

/** @param {HTMLElement} body */
export const page = (body) => renderGroup(body, 'mind', { before: [meterBlock()], after: [landsFold(), routinesFold()] });
