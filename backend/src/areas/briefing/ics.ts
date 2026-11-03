// The calendar's parser (BRIEFING.md "Today"): VEVENTs into the events of a window of the owner's
// days (the next 14, calendar.ts). It reads:
//   DTSTART / DTEND / DURATION  a date (all day), a date-time in UTC (`Z`), with a TZID (an IANA
//                               name, a Mozilla-style path ending in one, or one of the common
//                               Windows names in ics-values.ts), or floating (the owner's zone); no DTEND is
//                               one day for a date and no length for a date-time
//   SUMMARY, LOCATION, UID      text unescaped, one line, ≤ 80 characters
//   RRULE                       DAILY (BYDAY as a filter), WEEKLY (BYDAY, WKST), MONTHLY (BYMONTHDAY,
//                               negative too, or BYDAY with an ordinal: 2TU, -1FR), YEARLY (its own
//                               month and day), each with INTERVAL and COUNT or UNTIL, expanded in
//                               the event's own zone (so 09:00 stays 09:00 across a clock change)
//                               and only as far as the window
//   EXDATE, RECURRENCE-ID       a removed occurrence, and a moved or cancelled one (STATUS:CANCELLED)
// Not supported, by choice: RDATE; BYSETPOS, BYHOUR, BYMINUTE, BYSECOND, BYWEEKNO, BYYEARDAY and
// HOURLY or finer, and BYMONTH outside YEARLY (such an event shows once, at its DTSTART); VTIMEZONE
// definitions (a zone is known by its name or taken as the owner's); VTODO, VJOURNAL, VFREEBUSY.
import { CALENDAR_LIMITS, type CalendarEvent } from '../../../../shared/contract/briefing.ts';
import { DAY } from '../../lib/time';
import { parseRule, ruleDays } from './ics-rules';
import { addDays, daysBetween, duration, instant, type Prop, parseLine, text, type When, when } from './ics-values';

/** How many days a rule may walk before it is cut (a daily rule from ten years ago is ~3,650). */
const WALK_MAX = 20_000;

interface Raw {
  props: Map<string, Prop>;
  exdates: Prop[];
}

/** The VEVENTs' properties (VALARM and other nested parts skipped). */
function vevents(ics: string): Raw[] {
  const lines = ics
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const out: Raw[] = [];
  let cur: Raw | null = null;
  let depth = 0;
  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:')) {
      if (cur) depth++;
      else if (upper === 'BEGIN:VEVENT') cur = { props: new Map(), exdates: [] };
      continue;
    }
    if (upper.startsWith('END:')) {
      if (cur && depth > 0) depth--;
      else if (cur && upper === 'END:VEVENT') {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur || depth > 0) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'EXDATE') cur.exdates.push(p);
    else if (!cur.props.has(p.name)) cur.props.set(p.name, p);
  }
  return out;
}

/** An occurrence's key: its start instant (a date: its day). */
const occKey = (w: When) => (w.date ? w.day : String(instant(w.day, w.sec, w.zone)));

/**
 * The events of a calendar overlapping [from, to), soonest first, at most CALENDAR_LIMITS.events,
 * each marked with `source`. Floating times and unknown zones are the owner's (`ownerTz`).
 */
export function parseIcs(
  ics: string,
  c: { from: number; to: number; ownerTz: string; source: CalendarEvent['source'] },
): CalendarEvent[] {
  const events = vevents(ics);
  // Moved or cancelled occurrences of a recurring event, by its UID and the occurrence's key.
  const moved = new Set<string>();
  for (const e of events) {
    const rid = when(e.props.get('RECURRENCE-ID'), c.ownerTz);
    if (rid) moved.add(`${e.props.get('UID')?.value ?? ''}|${occKey(rid)}`);
  }
  const fromDay = addDays(new Date(c.from).toISOString().slice(0, 10), -2);
  const toDay = addDays(new Date(c.to).toISOString().slice(0, 10), 2);
  const out = new Map<string, CalendarEvent>();
  events.forEach((e, i) => {
    if ((e.props.get('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED') return;
    const start = when(e.props.get('DTSTART'), c.ownerTz);
    if (!start) return;
    const uid = text(e.props.get('UID')?.value, 200) || `nouid:${i}`;
    const end = when(e.props.get('DTEND'), c.ownerTz);
    const dur = duration(e.props.get('DURATION')?.value);
    // All day: a length in days; else in ms. A DTEND before its start counts as none.
    const spanDays = start.date
      ? Math.max(1, end?.date ? daysBetween(start.day, end.day) : dur !== null ? Math.round(dur / DAY) : 1)
      : 0;
    const startAt = instant(start.day, start.sec, start.zone);
    const spanMs = start.date
      ? 0
      : Math.max(0, end && !end.date ? instant(end.day, end.sec, end.zone) - startAt : (dur ?? 0));
    const base = {
      uid,
      all_day: start.date,
      title: text(e.props.get('SUMMARY')?.value, CALENDAR_LIMITS.title) || '(no title)',
      location: text(e.props.get('LOCATION')?.value, CALENDAR_LIMITS.location) || null,
      source: c.source,
    };
    const emit = (day: string) => {
      const s = start.date ? instant(day, 0, c.ownerTz) : instant(day, start.sec, start.zone);
      const f = start.date ? instant(addDays(day, spanDays), 0, c.ownerTz) : s + spanMs;
      const overlaps = f > s ? f > c.from && s < c.to : s >= c.from && s < c.to;
      if (overlaps) out.set(`${uid}|${s}`, { ...base, start: s, end: f });
    };
    const rrule = e.props.get('RRULE');
    const rule = rrule && !e.props.has('RECURRENCE-ID') ? parseRule(rrule.value, c.ownerTz) : null;
    if (!rule) {
      emit(start.day);
      return;
    }
    const ex = new Set(
      e.exdates.flatMap((p) =>
        p.value.split(',').flatMap((v) => {
          const w = when({ ...p, value: v }, c.ownerTz);
          return w ? [occKey(w)] : [];
        }),
      ),
    );
    const reach = spanDays + Math.ceil(spanMs / DAY) + 1;
    let n = 0;
    let walked = 0;
    for (const day of ruleDays(rule, start.day, toDay)) {
      if (++walked > WALK_MAX || day > toDay) break;
      n++;
      if (rule.count !== null && n > rule.count) break;
      if (rule.until && 'day' in rule.until && day > rule.until.day) break;
      const occ: When = { ...start, day };
      if (rule.until && 'at' in rule.until) {
        // Instants only near the end, so a long walk stays cheap.
        if (day >= addDays(new Date(rule.until.at).toISOString().slice(0, 10), -1)) {
          if (instant(day, start.sec, start.zone) > rule.until.at) break;
        }
      }
      if (addDays(day, reach) < fromDay) continue;
      const key = occKey(occ);
      if (ex.has(key) || moved.has(`${e.props.get('UID')?.value ?? ''}|${key}`)) continue;
      emit(day);
    }
  });
  return [...out.values()]
    .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
    .slice(0, CALENDAR_LIMITS.events);
}
