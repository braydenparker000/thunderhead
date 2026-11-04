// @ts-check
// "Today" at the top of Settings › The mind (MENU-AND-SETTINGS.md §6.6, MIND-PLAN §5.4): how often
// the mind woke and how long it was awake, read when the page opens (GET /v1/mind/usage). The wakes
// it set itself against the owner's wake budget (`mind.wake_budget`, the setting below on the same
// page), the minutes awake, the night shift's minutes, and a small row for the 7 days before.
// Counts only: never why it woke or what it looked at. One more line when a cold wake was
// answered: how long it took to wake and then to reply, the newest day that has one, and beside it
// how long an outside read took to its answer.
import { api, signedIn } from '/th/client.js';
import { el } from '/th/ui.js';

/** @typedef {import('../../../shared/contract/watches.ts').UsageResponse} UsageResponse */
/** @typedef {import('../../../shared/contract/watches.ts').UsageDay} UsageDay */

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** @param {UsageDay} d */
const wakes = (d) => Object.values(d.wakes).reduce((n, v) => n + v, 0);
/** @param {UsageDay} d */
const awake = (d) => Object.values(d.minutes).reduce((n, v) => n + v, 0);
/** @param {string} day */
const weekday = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' });

/** The newest day with a cold wake answered or an outside read: the median seconds to wake, then
 * to the first reply; beside them, the median outside read, from looking it up to the answer.
 * @param {UsageResponse} u @returns {string | null} */
export function latencyLine(u) {
  const d = [u.today, ...u.days].find((x) => x.latency && (x.latency.replies > 0 || (x.latency.lookups ?? 0) > 0));
  if (!d) return null;
  const { replies, claim_s, reply_s, lookups = 0, outside_s = null } = d.latency;
  const when = d === u.today ? 'today' : `on ${weekday(d.day)}`;
  const cold = replies ? `From cold: ${claim_s} s to wake, then ${reply_s} s to the first reply (${count(replies, 'time', 'times')} ${when}).` : '';
  const looked = lookups ? `Looking things up: ${outside_s} s to the answer (${count(lookups, 'time', 'times')}${cold ? '' : ` ${when}`}).` : '';
  return [cold, looked].filter(Boolean).join(' ');
}

/** The block's lines: the wakes it set itself, the minutes, the 7 days, and the cold-wake line when
 * there is one. @param {UsageResponse} u @returns {string[]} */
export function meterLines(u) {
  const t = u.today;
  const mine =
    u.budget === 0
      ? 'I set no wakes myself: you turned them off.'
      : `${t.wakes.watch} of ${u.budget} wakes I set myself${t.watches.refused ? `, ${t.watches.refused} more refused` : ''}${u.live ? ` · ${u.live} waiting` : ''}`;
  const yours = t.wakes.owner ? ` · ${count(t.wakes.owner, 'wake', 'wakes')} for you` : '';
  const latency = latencyLine(u);
  return [
    mine,
    `Awake ${awake(t)} min${yours} · night shift ${t.night_min} min`,
    `Last 7 days: ${u.days.map((d) => `${weekday(d.day)} ${wakes(d)}`).join(' · ')} wakes`,
    ...(latency ? [latency] : []),
  ];
}

/** The block, filled once the Worker answers. */
export function meterBlock() {
  const body = el('div', { class: 'group' }, [el('p', { class: 'shelp', text: 'Reading…' })]);
  const block = el('section', { class: 'msec', 'data-meter': '', 'aria-live': 'polite' }, [
    el('h2', { class: 'group-title', text: 'Today' }),
    body,
  ]);
  void (async () => {
    try {
      const u = /** @type {UsageResponse} */ (await signedIn((t) => api.call('/v1/mind/usage', { token: t })));
      const [first, ...rest] = meterLines(u);
      body.replaceChildren(el('p', { class: 'snow', text: first }), ...rest.map((l) => el('p', { class: 'shelp', text: l })));
    } catch {
      body.replaceChildren(el('p', { class: 'sempty', text: "I couldn't read today's count just now." }));
    }
  })();
  return block;
}
