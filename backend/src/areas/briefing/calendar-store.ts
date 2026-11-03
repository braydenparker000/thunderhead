// SQL for the owner's calendars inside Core (BRIEFING.md "Today", DATA.md §4): the links come from
// the setting `briefing.calendars`; each link's last try is a `calendar_feeds` row and its events
// `calendar_events` rows, both keyed by `feed` (a hash of the address, never the address). A fetch
// that brings the same events as last time writes one row; a different one replaces the link's
// events. A failing link keeps its events 48 hours from its last good fetch; after that (or at once
// for a link that never worked) they are left out and the tile says so. Whether an event is the
// owner's own or outside text follows the link's current mark, whatever it was when fetched.
// Stores never write the change feed: nothing on home moves with a calendar.
import { CALENDAR_LIMITS, type CalendarEvent, type CalendarResponse } from '../../../../shared/contract/briefing.ts';
import { type SettingLink, settingSpec, validSetting } from '../../../../shared/contract/settings.ts';
import { DAY, HOUR, MINUTE, ownerDay, wallMinute, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { sha256Hex } from '../auth/crypto';
import { getSetting } from '../settings/store';

export interface FeedRow {
  feed: string;
  checked_at: number;
  ok_at: number | null;
  failing_since: number | null;
  error: string | null;
  hash: string | null;
  n: number;
}

export interface Link {
  feed: string;
  url: string;
  mine: boolean;
}

/** A link's id in the rows: never its address. */
export const feedId = (url: string) => sha256Hex(url).slice(0, 16);

/** The owner's links as set (a stored value the catalogue no longer allows counts as none). */
export function links(db: Db): Link[] {
  const spec = settingSpec('briefing.calendars');
  const v = getSetting(db, 'briefing.calendars');
  if (!spec || !validSetting(spec, v)) return [];
  return (v as readonly SettingLink[]).map((l) => ({ feed: feedId(l.url), url: l.url, mine: l.mine }));
}

export const feeds = (db: Db) =>
  db.all<FeedRow>('SELECT feed, checked_at, ok_at, failing_since, error, hash, n FROM calendar_feeds');

/** Each link, whether it is due a fetch (never tried, or its last try is over 30 minutes old;
 * `all`: every one) and whether it was never tried (the Briefing waits for those). */
export function plan(db: Db, now: number, all = false) {
  const state = new Map(feeds(db).map((f) => [f.feed, f]));
  return links(db).map((l) => {
    const f = state.get(l.feed);
    return {
      ...l,
      fresh: !f,
      due: all || !f || now - f.checked_at > CALENDAR_LIMITS.stale_min * MINUTE,
    };
  });
}

/** The rows and state of links no longer set go. */
function tidy(db: Db, keep: string[]): void {
  const list = keep.map(() => '?').join(', ');
  const not = keep.length ? `WHERE feed NOT IN (${list})` : '';
  db.run(`DELETE FROM calendar_events ${not}`, ...keep);
  db.run(`DELETE FROM calendar_feeds ${not}`, ...keep);
}

/** A good fetch: its events replace the link's, unless they are the same as last time. Ignored when
 * the link was removed (or changed) while it was being fetched. */
export function put(db: Db, feed: string, url: string, rows: CalendarEvent[], at: number): void {
  const set = links(db);
  const keep = set.map((l) => l.feed);
  if (!set.some((l) => l.feed === feed && l.url === url)) {
    tidy(db, keep);
    return;
  }
  const hash = sha256Hex(JSON.stringify(rows));
  const had = db.one<FeedRow>('SELECT feed, hash FROM calendar_feeds WHERE feed = ?', feed);
  if (had?.hash !== hash) {
    db.run('DELETE FROM calendar_events WHERE feed = ?', feed);
    for (const r of rows)
      db.run(
        `INSERT OR REPLACE INTO calendar_events (feed, uid, start, end, all_day, title, location, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        feed,
        r.uid,
        r.start,
        r.end,
        r.all_day ? 1 : 0,
        r.title,
        r.location,
        r.source,
      );
  }
  db.run(
    `INSERT INTO calendar_feeds (feed, checked_at, ok_at, failing_since, error, hash, n) VALUES (?, ?, ?, NULL, NULL, ?, ?)
     ON CONFLICT (feed) DO UPDATE SET checked_at = excluded.checked_at, ok_at = excluded.ok_at,
       failing_since = NULL, error = NULL, hash = excluded.hash, n = excluded.n`,
    feed,
    at,
    at,
    hash,
    rows.length,
  );
  tidy(
    db,
    set.map((l) => l.feed),
  );
}

/** A failed fetch: its code and, the first time since the last good one, when it began. Its events stay. */
export function failed(db: Db, feed: string, url: string, code: string, at: number): void {
  const set = links(db);
  if (set.some((l) => l.feed === feed && l.url === url))
    db.run(
      `INSERT INTO calendar_feeds (feed, checked_at, ok_at, failing_since, error, hash, n) VALUES (?, ?, NULL, ?, ?, NULL, 0)
       ON CONFLICT (feed) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error,
         failing_since = coalesce(calendar_feeds.failing_since, excluded.failing_since)`,
      feed,
      at,
      at,
      code.slice(0, 20),
    );
  tidy(
    db,
    set.map((l) => l.feed),
  );
}

/** The daily prune: events over a day past their end (at most `max`). */
export function pruneEvents(db: Db, now: number, max: number): number {
  const gone = db.all<{ feed: string; uid: string; start: number }>(
    'SELECT feed, uid, start FROM calendar_events WHERE start < ? AND end < ? LIMIT ?',
    now - DAY,
    now - DAY,
    max,
  );
  for (const g of gone)
    db.run('DELETE FROM calendar_events WHERE feed = ? AND uid = ? AND start = ?', g.feed, g.uid, g.start);
  return gone.length;
}

/** The daily prune: the state and events of links no longer set. */
export function pruneFeeds(db: Db, _now: number, max: number): number {
  const keep = new Set(links(db).map((l) => l.feed));
  const gone = feeds(db)
    .filter((f) => !keep.has(f.feed))
    .slice(0, max);
  for (const f of gone) {
    db.run('DELETE FROM calendar_events WHERE feed = ?', f.feed);
    db.run('DELETE FROM calendar_feeds WHERE feed = ?', f.feed);
  }
  return gone.length;
}

// --- what the Briefing, the brief and the read route show ----------------------------------------

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const hhmm = (at: number, tz: string) => {
  const m = wallMinute(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const weekdays = new Map<string, Intl.DateTimeFormat>();
const weekday = (at: number, tz: string) => {
  let f = weekdays.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long' });
    weekdays.set(tz, f);
  }
  return f.format(at);
};

interface EventRow extends Omit<CalendarEvent, 'all_day'> {
  feed: string;
  all_day: number;
}

/** The links whose events may show now (a good fetch in the last 48 hours), each with its mark,
 * and the line for those that may not. */
function usable(db: Db, now: number, tz: string): { show: Map<string, boolean>; notice: string | null } {
  const state = new Map(feeds(db).map((f) => [f.feed, f]));
  const show = new Map<string, boolean>();
  let notice: string | null = null;
  for (const l of links(db)) {
    const f = state.get(l.feed);
    const kept = f?.ok_at != null && now - f.ok_at <= CALENDAR_LIMITS.keep_failed_h * HOUR;
    if (kept) show.set(l.feed, l.mine);
    // Before the first try there is nothing to say yet; a failure says so once its rows are gone.
    if (!kept && f?.failing_since != null) notice ??= noticeFor(f.error ?? '', f.failing_since, now, tz);
  }
  return { show, notice };
}

/** The tile's line for a link that gives nothing: what the owner can fix, else since when. */
function noticeFor(code: string, since: number, now: number, tz: string): string {
  if (code === 'redirect') return 'A calendar link redirects elsewhere.';
  if (code === 'too_large') return 'A calendar is over 1 MB.';
  if (code === 'not_calendar' || code === 'http_404') return 'A calendar link gives no calendar.';
  const day = ownerDay(since, tz);
  const when =
    day === ownerDay(now, tz)
      ? hhmm(since, tz)
      : now - since < 6 * DAY
        ? `${weekday(since, tz)} ${hhmm(since, tz)}`
        : `${Number(day.slice(8))} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(Date.parse(`${day}T12:00:00Z`))}`;
  return `Calendar not reachable since ${when}`;
}

/** Events overlapping [from, to) from the usable links, soonest first; marked as their link is now. */
function between(db: Db, show: Map<string, boolean>, from: number, to: number, limit: number): CalendarEvent[] {
  if (!show.size) return [];
  // An event can start before `from` and still run (a trip): 31 days back bounds the index walk.
  return db
    .all<EventRow>(
      `SELECT feed, uid, start, end, all_day, title, location, source FROM calendar_events
       WHERE start >= ? AND start < ? AND (end > ? OR (end = start AND start >= ?)) ORDER BY start, title LIMIT ?`,
      from - 31 * DAY,
      to,
      from,
      from,
      limit * 3,
    )
    .filter((r) => show.has(r.feed))
    .slice(0, limit)
    .map((r) => ({
      uid: r.uid,
      start: r.start,
      end: r.end,
      all_day: r.all_day === 1,
      title: r.title,
      location: r.location,
      source: show.get(r.feed) ? 'owner' : 'outside',
    }));
}

export interface CalendarView {
  /** Not yet over today, all-day ones first, then by start. */
  today: CalendarEvent[];
  /** Tomorrow's first timed event, else its first all-day one. */
  tomorrow: CalendarEvent | null;
  notice: string | null;
}

/** Today's and tomorrow's events for the tile, the day's line and the brief. */
export function view(db: Db, now: number, tz: string): CalendarView {
  const { show, notice } = usable(db, now, tz);
  const date = ownerDay(now, tz);
  const tomorrow = zonedMinute(addDays(date, 1), 0, tz);
  const after = zonedMinute(addDays(date, 2), 0, tz);
  const rows = between(db, show, zonedMinute(date, 0, tz), after, 50);
  const today = rows
    .filter((e) => e.start < tomorrow && (e.end > now || (e.end === e.start && e.start >= now)))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start - b.start);
  const next = rows.filter((e) => e.start >= tomorrow);
  return { today, tomorrow: next.find((e) => !e.all_day) ?? next[0] ?? null, notice };
}

/** GET /v1/briefing/calendar: the events from today's midnight for `days` days, and each link by host. */
export function list(db: Db, now: number, tz: string, days: number): CalendarResponse {
  const { show } = usable(db, now, tz);
  const date = ownerDay(now, tz);
  const items = between(db, show, zonedMinute(date, 0, tz), zonedMinute(addDays(date, days), 0, tz), 200);
  const state = new Map(feeds(db).map((f) => [f.feed, f]));
  return {
    items,
    feeds: links(db).map((l) => {
      const f = state.get(l.feed);
      return {
        host: new URL(l.url).hostname,
        source: l.mine ? 'owner' : 'outside',
        ok_at: f?.ok_at ?? null,
        failing_since: f?.failing_since ?? null,
        error: f?.error ?? null,
      };
    }),
  };
}

/** One event as the mind reads it: its time, its title as data (JSON-quoted, so a title can't pass
 * for the brief's own words) and where, and `(outside)` when someone else wrote it. */
export function briefLine(e: CalendarEvent, tz: string): string {
  const time = e.all_day ? 'all day' : e.end > e.start ? `${hhmm(e.start, tz)}–${hhmm(e.end, tz)}` : hhmm(e.start, tz);
  const where = e.location ? ` at ${JSON.stringify(e.location)}` : '';
  return `${time} ${JSON.stringify(e.title)}${where}${e.source === 'outside' ? ' (outside)' : ''}`;
}

/** The brief's calendar lines (section 1): today's, tomorrow's first, and the failure line. */
export function briefLines(v: CalendarView, tz: string): string[] {
  return [
    ...v.today.map((e) => `calendar today: ${briefLine(e, tz)}`),
    ...(v.tomorrow ? [`calendar tomorrow: ${briefLine(v.tomorrow, tz)}`] : []),
    ...(v.notice ? [`calendar: ${v.notice}`] : []),
  ];
}
