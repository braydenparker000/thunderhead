// What GET /v1/briefing answers (BRIEFING.md): the page's title line, the date and a line of the
// day's counts, the weather (P8), its tiles in order ("Waiting on you", "Today" from the owner's
// calendars, "Due", then the night shift's tiles, P8, then "Holidays"), one line about Muse when there is something to say, one
// about the night shift when it didn't arrange the page, and one about the day's database use from
// 60% of the Free plan's limit. The Worker fills Due, Holidays and the day's line itself every
// morning, without a mind session. Counts and titles only, except the Due sheet's reminders (the
// owner's own words, to the owner's device).

export interface WaitingTile {
  kind: 'waiting';
  label: 'Waiting on you';
  /** The first decision's question, ≤ 32 characters. */
  value: string;
  detail: string;
  count: number;
}

/** A tile the night shift placed (a `tile` surface in app `briefing`, BRIEFING.md §2). */
export interface NightTile {
  kind: 'night';
  /** `practice`, `study`, `built`, `note.1`–`note.3`. */
  slot: string;
  label: string;
  value: string;
  detail: string | null;
  big: string | null;
  wide: boolean;
  /** Where a tap opens it, inside that app, or null. */
  app: string | null;
  path: string | null;
  why: string;
  /** The ledger row that placed it: a tap is a `briefing.tile` sense with this ref (P9, M-16). */
  ledger_id: string | null;
}

/** BRIEFING.md §2 "Due": the owner's reminders due today and tomorrow (owner-local days): the
 * counts and the next one's time on the tile, the list in its sheet. */
export interface DueTile {
  kind: 'due';
  label: 'Due';
  /** "2 today · 1 tomorrow", "1 today", "3 tomorrow". */
  value: string;
  /** "Next at 14:30" or "Next tomorrow at 09:00". */
  detail: string;
  today: number;
  tomorrow: number;
  /** Soonest first, at most `DUE_LIMITS.items`: its words and when it is delivered (ms). */
  items: { id: string; text: string; at: number }[];
}

/** BRIEFING.md §2 "Holidays": the next public holiday within 14 days in the owner's country
 * (`owner.country`), from the Worker's own list (areas/briefing/holidays.ts). */
export interface HolidayTile {
  kind: 'holiday';
  label: 'Holidays';
  /** The holiday's name, ≤ 32 characters. */
  value: string;
  /** "Thursday 26 November · in 9 days", "… · tomorrow", "Today". */
  detail: string;
  /** `YYYY-MM-DD`. */
  date: string;
  in_days: number;
}

/** BRIEFING.md §2 "Today" (2026-11-02): one event of the owner's calendars (`briefing.calendars`,
 * areas/briefing/calendar.ts), as the Worker keeps it and `GET /v1/briefing/calendar` lists it.
 * `source` is `outside` for a link marked shared: its words were written by someone else. */
export interface CalendarEvent {
  uid: string;
  /** ms; an all-day event runs from the owner's midnight of its first day to that of the day after its last. */
  start: number;
  end: number;
  all_day: boolean;
  /** ≤ 80 characters, one line; "(no title)" when it had none. */
  title: string;
  location: string | null;
  source: 'owner' | 'outside';
}

/** One line of the "Today" tile: the start in the owner's zone ("18:00"; null for all day) and the
 * event as kept. */
export interface CalendarItem extends CalendarEvent {
  time: string | null;
}

/** BRIEFING.md §2 "Today": the owner's calendar events not yet over today (all-day ones first) and
 * tomorrow's first; a line when a link has failed for 48 hours (or never worked). */
export interface CalendarTile {
  kind: 'calendar';
  label: 'Today';
  /** "18:00 Dinner", "All day: Bins out", "Tomorrow 09:00 Standup" or "Calendar not reachable". */
  value: string;
  /** "2 things on today", "Nothing else today", or the failure line. */
  detail: string;
  /** At most `CALENDAR_LIMITS.tile_items`, soonest first. */
  today: CalendarItem[];
  tomorrow: CalendarItem | null;
  /** "Calendar not reachable since Saturday 14:00", "A calendar link redirects elsewhere." … or null. */
  notice: string | null;
}

/** What `GET /v1/briefing/calendar?days=` answers: the kept events from the owner's midnight today
 * for `days` days, and each link by its host only (a link is a key to its calendar). */
export interface CalendarResponse {
  items: CalendarEvent[];
  feeds: {
    host: string;
    source: 'owner' | 'outside';
    /** Last good fetch, the first failure since, and its code; all null before the first try. */
    ok_at: number | null;
    failing_since: number | null;
    error: string | null;
  }[];
}

/** The calendar's fetch and its rows (BRIEFING.md "Today", PRIVACY.md §5): each link at most 1 MB
 * in 10 s, no redirect followed, `text/calendar` or `text/plain`; the next 14 days kept, at most
 * 300 events a link; a failing link's rows kept 48 hours; asked again when the Briefing opens and
 * the last try is over 30 minutes old, and on the day roll. */
export const CALENDAR_LIMITS = {
  bytes: 1_048_576,
  timeout_ms: 10_000,
  days: 14,
  events: 300,
  keep_failed_h: 48,
  stale_min: 30,
  title: 80,
  location: 80,
  tile_items: 6,
} as const;

/** BRIEFING.md §1 "Today": the owner-local date, and one line made from counts (calendar events
 * still on today, reminders due today, new podcast episodes, songs added in the last day), never
 * from message text; null when every count is zero. */
export interface TodayLine {
  /** "Monday 2 November". */
  date: string;
  /** "2 things on today, 2 reminders due, 3 new episodes and 12 songs added." ≤ 60 characters
   * (the shorter wording, then the last counts dropped, until it fits), or null. */
  line: string | null;
}

export const DUE_LIMITS = { items: 50 } as const;
export const HOLIDAY_WITHIN_DAYS = 14;
export const TODAY_LINE_MAX = 60;

/** BRIEFING.md §2, §6: the weather tile, always first; with no place, the one that asks for it. */
export interface WeatherTile {
  /** The place's name, or null when none is set. */
  place: string | null;
  /** "24°", or null when there is nothing current to show. */
  temp: string | null;
  /** One sentence for the next hours, "as of 14:10", "Weather is out of date" or "Set a place for the weather". */
  detail: string;
  as_of: number | null;
  /** The next 12 hours: start (ms), °C, rain chance %. */
  hours: { at: number; temp: number; rain: number }[];
  tomorrow: { high: number; low: number } | null;
}

export interface PutPlaceRequest {
  /** A town's name, looked up with Open-Meteo's geocoder. */
  name: string;
}

export type BriefingTile = WaitingTile | CalendarTile | DueTile | NightTile | HolidayTile;

export interface BriefingResponse {
  day: string;
  title: string;
  /** The date and the day's counts (absent in answers from before 2026-11-02). */
  today?: TodayLine;
  weather: WeatherTile;
  /** At most 8, in order: "Waiting on you", "Today", "Due", the night's tiles by slot, "Holidays". */
  tiles: BriefingTile[];
  /** "Muse hasn't checked in since yesterday." / null */
  muse: string | null;
  /** When the connected night shift didn't arrange the page for today: "The night shift hasn't
   * run yet." (from 07:00), "The night shift ran out of time before arranging this page." (the
   * hard stop) or "The night shift stopped before arranging this page."; otherwise null (also
   * while it isn't connected). Absent in answers from before 2026-11-02. */
  night?: string | null;
  /** From 60% of a Free-plan daily limit: "Today's database use is at 62% of the free plan's daily
   * limit." (from 80% with when backups and uploads run again); otherwise null. */
  quota: string | null;
}

/** BRIEFING.md §3: the title line by local hour. */
export function titleLine(hour: number, empty: boolean): string {
  if (empty) return 'A quiet day.';
  if (hour >= 4 && hour < 15) return "Here's your day.";
  if (hour >= 15 && hour < 19) return "Here's the rest of today.";
  return "Here's tonight.";
}
