// The decision card's logic without the DOM (HOME.md §3, COPY.md §3.3), with node tests in
// tests/decide-logic.test.mjs. Which cards may show and in what order, the card's lines, what the
// second button does, and what each answer says afterwards. The Worker decides what a card is; this
// only chooses how it looks.
import { PROPOSAL_CLASSES } from '../contract.js';

/** @typedef {import('../../../shared/contract/api').Proposal} Proposal */
/** @typedef {import('../../../shared/contract/api').DecideProposalResponse} DecideProposalResponse */

/** Who asked, as the why line names it. */
const SOURCE = /** @type {Record<string, string>} */ ({
  'mind:chat': 'From our chat',
  'mind:night': 'Night shift',
  'mind:reflex': 'Watchdog',
  worker: 'Safety check',
});

export const LINES = Object.freeze({
  notyet: 'Not yet',
  no: 'No',
  error: "Didn't go through. Try again.",
  offline: 'Needs a connection. Nothing was decided.',
  snoozed: "I'll ask again tomorrow.",
  rejected: "Okay. I won't.",
  expired: 'That one expired. Nothing was done.',
  done: 'Done.',
  failed: "That didn't work. Nothing changed.",
});

/** The cards that may show now (waiting, past their quiet-hours hold, not expired), the one to show
 * first leading: soonest expiry, then oldest (HOME.md §3.3).
 * @param {Proposal[]} items @param {number} now */
export function showing(items, now) {
  return items
    .filter((p) => p.status === 'waiting' && p.show_from <= now && p.expires_at > now)
    .sort((a, b) => a.expires_at - b.expires_at || a.created_at - b.created_at);
}

/** The next moment the set of cards that may show changes by itself (a hold ends, a card expires),
 * or null. @param {Proposal[]} items @param {number} now */
export function nextChange(items, now) {
  const times = items
    .filter((p) => p.status === 'waiting')
    .flatMap((p) => [p.show_from, p.expires_at])
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
}

/** "Night shift · Can't be undone": who asked, then the class's words for an ask-first card.
 * @param {Proposal} p */
export function whyLine(p) {
  const source = SOURCE[p.created_by] ?? 'The Thunderhead';
  const cls = PROPOSAL_CLASSES[p.class];
  return cls?.ask_first ? `${source} · ${cls.label}` : source;
}

/** "1 of 3" when more than one waits, else empty. @param {number} i @param {number} n */
export const ofLine = (i, n) => (n > 1 ? `${i + 1} of ${n}` : '');

/** The card's smaller lines: the why, the odds when given, and what happens if it is ignored.
 * @param {Proposal} p @returns {string[]} */
export function details(p) {
  const odds = typeof p.odds === 'number' ? `About ${Math.round(p.odds * 100)}% sure.` : '';
  return [p.why, odds, p.if_ignored].filter((x) => typeof x === 'string' && x.length > 0);
}

/** The two buttons: the action in the card's words, then the safe choice, whose label is fixed
 * (HOME.md §3.1: "Not yet" snoozes, "No" turns it down), so no wording can hide what it sends.
 * @param {Proposal} p @returns {{ yes: string, safe: string, safeDecision: 'reject' | 'snooze' }} */
export function buttons(p) {
  const snooze = p.safe === 'snooze';
  const yes = Array.isArray(p.options) ? p.options[0] : '';
  return { yes: yes || 'Yes', safe: snooze ? LINES.notyet : LINES.no, safeDecision: snooze ? 'snooze' : 'reject' };
}

/** The toast after the Worker answered. `null` when the card stays (a snooze that left it waiting
 * says so too). @param {'approve' | 'reject' | 'snooze'} decision @param {DecideProposalResponse} r */
export function toastFor(decision, r) {
  if (r.status === 'expired') return LINES.expired;
  if (decision === 'snooze') return LINES.snoozed;
  if (decision === 'reject') return LINES.rejected;
  return r.status === 'failed' ? LINES.failed : LINES.done;
}

/** What the voice line should know after an answer: a yes, or another answer (HOME.md §2.1 row 8).
 * @param {'approve' | 'reject' | 'snooze'} decision @param {DecideProposalResponse} r */
export const answered = (decision, r) => (decision === 'approve' && r.status !== 'failed' ? 'yes' : 'other');

/** Whether an error from the Worker means the card is settled anyway (no use asking again): it was
 * decided elsewhere, it expired, or it no longer exists. @param {string | undefined} code */
export const settled = (code) => code === 'already_decided' || code === 'expired' || code === 'not_found';

/** The date-line suffix while a card waits off-screen (COPY.md `date.waiting`). @param {number} n */
export const waitingSuffix = (n) => `${n} waiting`;
