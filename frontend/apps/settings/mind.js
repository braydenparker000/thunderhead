// @ts-check
// Settings › The mind (MENU-AND-SETTINGS.md §6.6): today's count of wakes and minutes at the top
// (mind-meter.js), then how I talk (the Name row, then the voice page: mind-voice.js), nights, waking, how I reach you, and the standing permissions
// per kind of action. Kept by the Worker; all in the mind's briefing (section 13). Then What lands
// (mind-lands.js): what you did with each topic I placed, and Reopen for one that rests; then
// Routines (mind-routines.js): what you approved once, each with its switch and Undo for its last run.
import { renderGroup } from './catalog.js';
import { landsFold } from './mind-lands.js';
import { routinesFold } from './mind-routines.js';
import { meterBlock } from './mind-meter.js';
import { voiceBlock } from './mind-voice.js';

/** @param {HTMLElement} body */
export const page = (body) => {
  const done = renderGroup(body, 'mind', { before: [meterBlock()], after: [landsFold(), routinesFold()] });
  // The voice page goes under "How I talk" (its Name row), which renderGroup has placed by now.
  const talk = [...body.querySelectorAll('.scatalog[data-group="mind"] > .group-section')].find((g) => g.querySelector('.group-title')?.textContent === 'How I talk');
  if (talk) talk.append(...voiceBlock());
  return done;
};
