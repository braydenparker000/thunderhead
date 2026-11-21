// @ts-check
// When this phone sends its push subscription to the Worker again (th/push/phone.js `recheck`), without the DOM,
// so node tests can check it. The PUT is idempotent, so a subscription the Worker dropped (a push service's 404
// or 410 deletes it there) is restored within a day.

/** A subscription sent longer ago than this is sent again. */
export const RESEND_MS = 24 * 60 * 60 * 1000;

/** What `send` keeps in localStorage: the session and endpoint it was sent for, and when.
 * @param {string} session @param {string} endpoint @param {number} at */
export const sentMark = (session, endpoint, at) => `${session}|${endpoint}|${at}`;

/** Whether to send the subscription now: it was made again, sent for another session or endpoint (or never),
 * or sent more than a day ago. @param {{ made: boolean, mark: string | null, session: string, endpoint: string, now: number }} o */
export function resendDue({ made, mark, session, endpoint, now }) {
  if (made || !mark) return true;
  const cut = mark.lastIndexOf('|');
  const at = Number(mark.slice(cut + 1));
  if (mark.slice(0, cut) !== `${session}|${endpoint}` || !Number.isFinite(at)) return true;
  return now - at > RESEND_MS || now < at;
}
