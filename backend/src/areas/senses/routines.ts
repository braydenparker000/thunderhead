// Routines as observed facts (MEMORY.md §4, rule M5; the `routines` query): when the owner does a
// thing, counted from the events of the last 28 logical days, never guessed. Each event falls in a
// cell, the weekday of its logical day (it turns at 04:00, so a late Friday stays Friday) and the
// hour of the owner's clock; a band of hours is a routine on the weekdays whose cells hold events in
// two weeks or more, once those days hold ROUTINES.min_n events in three different weeks
// (shared/contract/senses.ts ROUTINES). Counts, weekdays and hours only: no ref, no data.
import { ROUTINES, type Routine, routineRef, WEEKDAYS } from '../../../../shared/contract/senses.ts';
import { DAY, dayBefore, HOUR, zonedInstant } from '../../lib/time';

/** Events of a type on a logical day in a quarter of an hour (`q`: ms since the epoch ÷ 900,000). */
export interface QuarterCount {
  type: string;
  day: string;
  q: number;
  n: number;
}

const QUARTER = 15 * 60_000;

/** The window's logical days, `to` first. */
export const windowDays = (to: string, days: number = ROUTINES.days) =>
  Array.from({ length: days }, (_, k) => dayBefore(to, k));

const bits = (m: number) => {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
};

/** The routines in counted quarters, the window ending on `to`, in the owner's zone: the densest
 * bands of each type that do not overlap, at most ROUTINES.per_type a type and ROUTINES.rows in
 * all, most events first. */
export function routines(counts: QuarterCount[], to: string, tz: string): Routine[] {
  const offsets = new Map<string, number>();
  // The zone's offset on a day, taken at its noon (a change of clocks moves a night's hour by one).
  const offset = (day: string) => {
    let o = offsets.get(day);
    if (o === undefined) {
      o = Date.parse(`${day}T12:00:00Z`) - zonedInstant(day, 12, tz);
      offsets.set(day, o);
    }
    return o;
  };
  const end = Date.parse(`${to}T12:00:00Z`);
  const byType = new Map<string, { n: number[][]; weeks: number[][] }>();
  for (const c of counts) {
    const ago = Math.round((end - Date.parse(`${c.day}T12:00:00Z`)) / DAY);
    if (ago < 0 || ago >= ROUTINES.days) continue;
    let t = byType.get(c.type);
    if (!t) {
      t = {
        n: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        weeks: Array.from({ length: 7 }, () => new Array(24).fill(0)),
      };
      byType.set(c.type, t);
    }
    const wd = (new Date(`${c.day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const local = (((c.q * QUARTER + offset(c.day)) % DAY) + DAY) % DAY;
    const h = Math.floor(local / HOUR);
    t.n[wd][h] += c.n;
    t.weeks[wd][h] |= 1 << Math.floor(ago / 7);
  }
  const out: Routine[] = [];
  for (const [type, t] of byType) {
    const found: Omit<Routine, 'ref'>[] = [];
    for (let w = 1; w <= ROUTINES.max_hours; w++)
      for (let from = 0; from + w <= 24; from++) {
        const days: number[] = [];
        let n = 0;
        let weeks = 0;
        for (let wd = 0; wd < 7; wd++) {
          let dn = 0;
          let dw = 0;
          for (let h = from; h < from + w; h++) {
            dn += t.n[wd][h];
            dw |= t.weeks[wd][h];
          }
          if (bits(dw) < ROUTINES.day_weeks) continue;
          days.push(wd);
          n += dn;
          weeks |= dw;
        }
        if (n >= ROUTINES.min_n && bits(weeks) >= ROUTINES.min_weeks)
          found.push({
            type,
            weekdays: days.map((d) => WEEKDAYS[d]),
            hour_from: from,
            hour_to: from + w,
            n,
            weeks: bits(weeks),
          });
      }
    // Densest first (events an hour), then the narrower band, then the earlier one.
    found.sort(
      (a, b) =>
        b.n / (b.hour_to - b.hour_from) - a.n / (a.hour_to - a.hour_from) ||
        a.hour_to - a.hour_from - (b.hour_to - b.hour_from) ||
        a.hour_from - b.hour_from,
    );
    const kept: Omit<Routine, 'ref'>[] = [];
    for (const r of found) {
      if (kept.length >= ROUTINES.per_type) break;
      if (kept.some((k) => r.hour_from < k.hour_to && k.hour_from < r.hour_to)) continue;
      kept.push(r);
    }
    for (const r of kept) out.push({ ...r, ref: routineRef(r, to) });
  }
  return out
    .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type) || a.hour_from - b.hour_from)
    .slice(0, ROUTINES.rows);
}
