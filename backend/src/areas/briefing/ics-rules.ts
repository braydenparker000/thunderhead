// RRULE for the calendar's parser (ics.ts): which rules are read (DAILY, WEEKLY, MONTHLY, YEARLY,
// with INTERVAL, COUNT or UNTIL, BYDAY, BYMONTHDAY, BYMONTH in a year and WKST), and the days each
// puts an event on, in the event's own calendar. Anything else is not supported: parseRule says
// null and the event shows once. Pure.
import { addDays, instant, WEEKDAYS, weekdayOf, when } from './ics-values';

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  /** UNTIL as a day (a date) or an instant (a date-time). */
  until: { day: string } | { at: number } | null;
  /** Weekdays 0–6 with an ordinal (MONTHLY only; 0 means every one). */
  byday: { wd: number; nth: number }[];
  bymonthday: number[];
  /** YEARLY only: its month (0–11), else DTSTART's. */
  bymonth: number | null;
  wkst: number;
}

/** The rule, or null when it uses something not supported (the event then shows once). */
export function parseRule(v: string, ownerTz: string): Rule | null {
  const parts = Object.fromEntries(
    v.split(';').map((kv) => {
      const eq = kv.indexOf('=');
      return [
        kv.slice(0, eq).trim().toUpperCase(),
        kv
          .slice(eq + 1)
          .trim()
          .toUpperCase(),
      ];
    }),
  );
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const allowed = [
    'FREQ',
    'INTERVAL',
    'COUNT',
    'UNTIL',
    'BYDAY',
    'BYMONTHDAY',
    'WKST',
    ...(freq === 'YEARLY' ? ['BYMONTH'] : []),
  ];
  if (Object.keys(parts).some((k) => !allowed.includes(k))) return null;
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  if (!Number.isInteger(interval) || interval < 1 || (count !== null && (!Number.isInteger(count) || count < 1)))
    return null;
  const byday: { wd: number; nth: number }[] = [];
  for (const d of parts.BYDAY ? parts.BYDAY.split(',') : []) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
    if (!m) return null;
    const nth = m[1] ? Number(m[1]) : 0;
    // An ordinal only means something in a month here; within a week or a day it is not supported.
    if (nth !== 0 && freq !== 'MONTHLY') return null;
    byday.push({ wd: WEEKDAYS.indexOf(m[2]), nth });
  }
  const bymonthday = parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : [];
  if (bymonthday.some((n) => !Number.isInteger(n) || n === 0 || Math.abs(n) > 31)) return null;
  if (freq === 'MONTHLY' && byday.length && bymonthday.length) return null;
  if (freq === 'YEARLY' && byday.length) return null;
  if (freq === 'WEEKLY' && bymonthday.length) return null;
  let until: Rule['until'] = null;
  if (parts.UNTIL) {
    const u = when({ name: 'UNTIL', params: {}, value: parts.UNTIL }, ownerTz);
    if (!u) return null;
    until = u.date ? { day: u.day } : { at: instant(u.day, u.sec, u.zone) };
  }
  const wkst = parts.WKST ? WEEKDAYS.indexOf(parts.WKST) : 1;
  if (wkst < 0) return null;
  const bymonth = parts.BYMONTH ? Number(parts.BYMONTH) - 1 : null;
  if (bymonth !== null && !(Number.isInteger(bymonth) && bymonth >= 0 && bymonth < 12)) return null;
  if (freq === 'YEARLY' && bymonthday.length > 1) return null;
  return { freq, interval, count, until, byday, bymonthday, bymonth, wkst };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dayString = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The days a rule puts an event on, from its first day, in order (the first day always first),
 * up to `last`: each loop stops there even when a rule never matches (the 30th of February). */
export function* ruleDays(r: Rule, first: string, last: string): Generator<string> {
  yield first;
  const [y0, m0, d0] = first.split('-').map(Number);
  const wd0 = weekdayOf(first);
  if (r.freq === 'DAILY') {
    for (let k = 1; ; k++) {
      const day = addDays(first, k * r.interval);
      if (day > last) return;
      if (!r.byday.length || r.byday.some((b) => b.wd === weekdayOf(day))) yield day;
    }
  }
  if (r.freq === 'WEEKLY') {
    const days = r.byday.length ? r.byday.map((b) => b.wd) : [wd0];
    const offsets = [...new Set(days.map((wd) => (wd - r.wkst + 7) % 7))].sort((a, b) => a - b);
    const weekStart = addDays(first, -((wd0 - r.wkst + 7) % 7));
    for (let w = 0; ; w += r.interval)
      for (const o of offsets) {
        const day = addDays(weekStart, w * 7 + o);
        if (day > last) return;
        if (day > first) yield day;
      }
  }
  if (r.freq === 'MONTHLY') {
    for (let k = 0; ; k += r.interval) {
      const y = y0 + Math.floor((m0 - 1 + k) / 12);
      const m = (m0 - 1 + k) % 12;
      if (dayString(y, m, 1) > last) return;
      const len = daysInMonth(y, m);
      const out = new Set<number>();
      if (r.byday.length)
        for (const b of r.byday) {
          const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay();
          const all: number[] = [];
          for (let d = 1 + ((b.wd - firstWd + 7) % 7); d <= len; d += 7) all.push(d);
          if (b.nth === 0) for (const d of all) out.add(d);
          else {
            const d = b.nth > 0 ? all[b.nth - 1] : all[all.length + b.nth];
            if (d) out.add(d);
          }
        }
      else
        for (const n of r.bymonthday.length ? r.bymonthday : [d0]) {
          const d = n > 0 ? n : len + 1 + n;
          // A day the month doesn't have (the 31st in April) is skipped, as RFC 5545 says.
          if (d >= 1 && d <= len) out.add(d);
        }
      for (const d of [...out].sort((a, b) => a - b)) {
        const day = dayString(y, m, d);
        if (day > first) yield day;
      }
    }
  }
  if (r.freq === 'YEARLY') {
    const month = r.bymonth ?? m0 - 1;
    const md = r.bymonthday.length === 1 ? r.bymonthday[0] : d0;
    for (let k = 0; ; k += r.interval) {
      const y = y0 + k;
      if (dayString(y, month, 1) > last) return;
      const len = daysInMonth(y, month);
      const d = md > 0 ? md : len + 1 + md;
      if (d < 1 || d > len) continue;
      const day = dayString(y, month, d);
      if (day > first) yield day;
    }
  }
}
