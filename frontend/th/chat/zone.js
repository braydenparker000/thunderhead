// @ts-check
// The owner's time zone (`owner.tz`) is this phone's. The Worker keeps the day's thread, quiet hours,
// a reminder's quiet-hours shift, the night shift and the weekly backup in that zone. Until
// 2026-11-01 nothing ever set it, so the Worker used the deploy's default, UTC: three hours off for
// an owner three hours behind UTC (the day rolled over at 21:00, the backup ran at 23:30). Home now sends
// this phone's zone when the Worker's differs, once per load; travel, and it follows the phone.
import { api, signedIn } from '../client.js';

let sent = false;

/** This phone's IANA zone, or ''. */
export function zoneHere() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/** Whether two zone names are the same zone (an alias, "Asia/Calcutta", is the same as
 * "Asia/Kolkata": the browser names it canonically). @param {string} a @param {unknown} b */
export function sameZone(a, b) {
  if (typeof b !== 'string' || !b) return false;
  try {
    return a === b || new Intl.DateTimeFormat('en', { timeZone: b }).resolvedOptions().timeZone === a;
  } catch {
    return false;
  }
}

/** Sends this phone's zone if the Worker keeps another. @param {unknown} worker the Worker's `owner.tz` */
export async function keepZone(worker) {
  const here = zoneHere();
  if (sent || !here || sameZone(here, worker)) return false;
  sent = true;
  try {
    await signedIn((t) => api.call('/v1/settings', { method: 'PATCH', token: t, body: { 'owner.tz': here } }));
    return true;
  } catch {
    sent = false;
    return false;
  }
}
