// The briefing's newer inputs (MEMORY.md §9, the layered briefing), read from Core's rows and the
// Senses object's reports, each bounded and by an index: section 1's today state (the weather kept
// for the Briefing, the owner's own calendar, the reminders due today and the scheduled verbs, the
// song playing) and section 7's day (its arrangements and how each was met so far, the open
// predictions about it, the Briefing's tiles, a shared calendar's events). Reads only.

import { DAY, dayBefore, ownerDay, zonedInstant } from '../../lib/time';
import type { Db } from '../../objects/base';
import { briefing } from '../briefing/assemble';
import { briefLines, type CalendarView } from '../briefing/calendar-store';
import { type Forecast, type Place, weatherTile } from '../briefing/weather';
import { DAY_STARTS_HOUR } from '../conversation/day';
import { metSoFar, seenSet } from '../insight/meter';
import { arrangedBetween } from '../ledger/store';
import { dueOn } from '../predictions/ops';
import { dueBefore } from '../reminders/store';
import type { BriefReports } from '../senses/brief';
import { getSetting } from '../settings/store';
import { dueBefore as routinesBefore } from '../verbs/routine-store';
import { scheduledCount, soonest } from '../verbs/store';
import { clock } from './brief-text';

const one = (t: string, n: number) => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** "11°, Rain from 16:00 to 18:00. Tomorrow 6° to 12°." from the forecast the Briefing keeps (no
 * fetch); null with no place set. */
export function weatherLine(db: Db, now: number, tz: string): string | null {
  const place = (getSetting(db, 'weather.place') as Place | undefined) ?? null;
  if (!place) return null;
  const w = weatherTile(place, (getSetting(db, 'weather.forecast') as Forecast | undefined) ?? null, now, tz);
  if (w.temp === null) return w.detail;
  return `${w.temp}, ${w.detail}${w.tomorrow ? ` Tomorrow ${w.tomorrow.low}° to ${w.tomorrow.high}°.` : ''}`;
}

/** The calendar split by provenance: the owner's own links' lines for section 1, a shared link's
 * (marked `(outside)`) for section 7. */
export function calendarLines(v: CalendarView, tz: string): { own: string[]; shared: string[] } {
  const by = (outside: boolean): CalendarView => {
    const mine = (e: { source: string }) => (e.source === 'outside') === outside;
    return {
      today: v.today.filter(mine),
      tomorrow: v.tomorrow && mine(v.tomorrow) ? v.tomorrow : null,
      notice: outside ? null : v.notice,
    };
  };
  return { own: briefLines(by(false), tz), shared: briefLines(by(true), tz) };
}

/** What is due today: the owner's reminders until the end of their day (at most 3, then where the
 * rest are), the verbs and plans waiting for their time, and the routines due today. */
export function dueLines(db: Db, now: number, tz: string): string[] {
  const end = zonedInstant(ownerDay(now + DAY, tz), 0, tz);
  const rows = dueBefore(db, end, 4);
  const lines = rows.slice(0, 3).map((r) => `due ${clock(r.fire_at, tz)}: ${JSON.stringify(one(r.text, 80))}`);
  if (rows.length > 3) lines.push('(+more due today: th remind list)');
  const waiting = scheduledCount(db);
  const next = waiting ? soonest(db) : null;
  if (next !== null) lines.push(`scheduled: ${waiting} waiting, the next at ${clock(next, tz)} (th verbs scheduled)`);
  // The routines due before the day ends, in one line (an index read; none on, no row).
  const due = routinesBefore(db, end, 4);
  const named = due.slice(0, 3).map((r) => `${JSON.stringify(one(r.name, 40))} at ${clock(r.next_at, tz)}`);
  if (due.length) lines.push(`routines today: ${named.join(', ')}${due.length > 3 ? ', +more' : ''} (th routine list)`);
  return lines;
}

/** Section 1's music line, from the day's newest song events: one started and neither skipped nor
 * finished since, or the last one's end. Nothing played today: no line. */
export function playingLine(r: BriefReports | null, now: number, tz: string): string | null {
  const play = r?.music.find((e) => e.type === 'music.play');
  if (!play) return null;
  const ended = r?.music.find((e) => e.type !== 'music.play' && e.ref === play.ref && e.at >= play.at);
  if (ended)
    return `music: the last song ${ended.type === 'music.skip' ? 'was skipped' : 'finished'} at ${clock(ended.at, tz)}`;
  const ago = Math.max(0, Math.round((now - play.at) / 60_000));
  return `music: a song started at ${clock(play.at, tz)} (${ago} min ago), not skipped or finished since (th music now)`;
}

/** The logical day's span: from its 04:00 to the next one's, or now if sooner. */
export function daySpan(day: string, now: number, tz: string): { from: number; to: number } {
  const to = zonedInstant(dayBefore(day, -1), DAY_STARTS_HOUR, tz);
  return { from: zonedInstant(day, DAY_STARTS_HOUR, tz), to: Math.min(now, to) };
}

const MET: Record<string, string> = {
  undone: 'undone',
  kept: 'kept',
  ignored: 'ignored (dismissed)',
  unseen: 'unseen yet',
};

/** Section 7's lines: the day's arrangements (at most 8) each with how it was met so far, the open
 * predictions about it, and the Briefing's tiles as the page shows them, one line each. */
export function dayLines(
  db: Db,
  c: { day: string; now: number; tz: string; reports: BriefReports | null },
): { arranged: string[]; predicted: string[]; tiles: string[] } {
  const span = daySpan(c.day, c.now, c.tz);
  const seen = seenSet(c.reports?.rollups ?? []);
  const arranged = arrangedBetween(db, span.from, span.to, 8).map((a) => {
    // Without the phone's reports (the Senses object didn't answer) only an undo is known.
    const met = c.reports ? metSoFar(a, seen, c.tz) : a.undone_at !== null ? 'undone' : null;
    const state = met ? MET[met] : c.reports ? 'no answer yet' : 'not known (no reports)';
    return `${clock(a.at, c.tz)} ${a.what} · ${state}: ${one(a.why ?? '', 100)}`;
  });
  const predicted = dueOn(db, c.day, 6).map((p) => {
    const args = Object.entries(p.args)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return `${p.category}${args ? ` ${args}` : ''} · ${Math.round(p.p * 100)}%: ${one(p.why, 100)}`;
  });
  return { arranged, predicted, tiles: tileLines(db, c) };
}

/** The Briefing's tiles as the page shows them now, one line each. */
export function tileLines(db: Db, c: { day: string; now: number; tz: string }): string[] {
  const page = briefing(db, { now: c.now, tz: c.tz, day: c.day, weather: weatherTile(null, null, c.now, c.tz) });
  return page.tiles.map((t) => one(`${t.label || t.kind}: ${t.value}${t.detail ? ` · ${t.detail}` : ''}`, 120));
}
