// @ts-check
// When a reminder is for, in words and in quick choices (HOME.md §6.2), in this phone's time. No
// DOM, so a node test checks it (tests/attach-logic.test.mjs).

const MIN = 60_000;
const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
const hm = (/** @type {Date} */ d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const dayStart = (/** @type {number} */ t) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();

/** "at 19:00", "tomorrow at 08:00", "on Monday at 09:00", "on 3 Nov at 09:00". @param {number} t @param {number} [now] */
export function when(t, now = Date.now()) {
  const d = new Date(t);
  const days = Math.round((dayStart(t) - dayStart(now)) / 86_400_000);
  if (days <= 0) return `at ${hm(d)}`;
  if (days === 1) return `tomorrow at ${hm(d)}`;
  if (days < 7) return `on ${d.toLocaleDateString('en-GB', { weekday: 'long' })} at ${hm(d)}`;
  return `on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${hm(d)}`;
}

/** The quick choices for `now`, as [label, time]. This evening goes once it is 18:30. @param {number} now */
export function choices(now) {
  const at = (/** @type {number} */ days, /** @type {number} */ h) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const evening = new Date(now).getHours() * 60 + new Date(now).getMinutes() < 18 * 60 + 30;
  /** @type {[string, number][]} */
  const out = [['In 1 hour', Math.ceil((now + 60 * MIN) / MIN) * MIN]];
  if (evening) out.push(['This evening', at(0, 19)]);
  out.push(['Tomorrow morning', at(1, 8)]);
  return out;
}

