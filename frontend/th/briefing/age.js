// @ts-check
// How old the Briefing on screen is (audit, 2026-11-21): a day kept on this phone is never painted
// as today. When the answer is from another day it says which ("From yesterday", "From Tuesday",
// "From 3 November") and what was about that day (the weather now, Due, Today, Holidays, the day's
// counts) is left out; when today's answer could not be refreshed, "Couldn't refresh just now".
// Pure: the page (page.js) gives it the answer's day, the time and whether the last refresh failed.

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The tiles that speak of their own day. */
const OF_THE_DAY = new Set(['due', 'calendar', 'holiday']);

/** A local date as `YYYY-MM-DD`. @param {Date} d */
export const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** @param {string | undefined} day the answer's `YYYY-MM-DD` @param {Date} now @param {boolean} failed
 * @returns {{ old: boolean, line: string }} `old`: the answer is from another day; `line`: what to say, or '' */
export function age(day, now, failed) {
  const today = dayOf(now);
  if (!day || day === today) return { old: false, line: failed ? 'Couldn’t refresh just now' : '' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return { old: true, line: 'From an earlier day' };
  const then = new Date(+m[1], +m[2] - 1, +m[3]);
  const back = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - then.getTime()) / 86_400_000);
  if (back === 1) return { old: true, line: 'From yesterday' };
  if (back > 1 && back < 7) return { old: true, line: `From ${WD[then.getDay()]}` };
  return { old: true, line: `From ${then.getDate()} ${MON[then.getMonth()]}` };
}

/** Whether a tile stays on a Briefing from another day. @param {{ kind: string }} t */
export const keeps = (t) => !OF_THE_DAY.has(t.kind);
