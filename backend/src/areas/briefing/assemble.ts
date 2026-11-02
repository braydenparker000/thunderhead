// The Briefing page's data (BRIEFING.md §1–§4, MUSE.md §9): the weather tile (weather.ts), "Waiting
// on you" from the decision cards the owner can see now (a card held for quiet hours stays off it),
// "Due" (the owner's reminders today and tomorrow), the night shift's tiles, "Holidays" (the next
// public holiday within 14 days in the owner's country, holidays.ts), the date and a line of the
// day's counts, Muse's line, a line when the connected night shift didn't arrange the page and,
// from 60% of a Free-plan daily limit, the day's database use (areas/meter). Due, Holidays and the
// day's line need no mind session: the Worker fills them every time the page asks. Pure in `db`.
import {
  type BriefingResponse,
  type BriefingTile,
  DUE_LIMITS,
  type DueTile,
  HOLIDAY_WITHIN_DAYS,
  type HolidayTile,
  type NightTile,
  TODAY_LINE_MAX,
  type TodayLine,
  titleLine,
  type WaitingTile,
  type WeatherTile,
} from '../../../../shared/contract/briefing.ts';
import { WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { DAY, HOUR, ownerDay, wallMinute, zonedInstant } from '../../lib/time';
import type { Db } from '../../objects/base';
import { quotaLine, safeQuota } from '../meter/quota';
import { arrangeState } from '../mind/night';
import { newSince } from '../podcasts/store';
import * as pstore from '../proposals/store';
import { dueBefore } from '../reminders/store';
import { getSetting } from '../settings/store';
import * as surfaces from '../surfaces/store';
import * as work from '../work/ops';
import { nextHoliday } from './holidays';
import { arrange, pinsOf } from './pins';

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n > 99 ? '99+' : n} ${n === 1 ? one : many}`;
const hhmm = (at: number, tz: string) => {
  const m = wallMinute(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
/** "Monday 2 November" for a `YYYY-MM-DD` day (en-GB puts no comma after the weekday). */
const dateLine = (day: string) => longDate.format(Date.parse(`${day}T12:00:00Z`)).replace(',', '');

function waitingTile(db: Db, now: number): WaitingTile | null {
  const cards = pstore.waiting(db).filter((p) => p.visible_from <= now && p.show_from <= now);
  if (!cards.length) return null;
  return {
    kind: 'waiting',
    label: 'Waiting on you',
    value: short(cards[0].question, 32),
    detail: cards.length === 1 ? 'One tap on home' : `${cards.length} waiting · one tap each on home`,
    count: cards.length,
  };
}

/** The owner's reminders due before the end of tomorrow (owner-local days), soonest first. */
function dueReminders(db: Db, c: { now: number; tz: string; date: string }) {
  const tomorrow = zonedInstant(nextDay(c.date), 0, c.tz);
  const end = zonedInstant(nextDay(nextDay(c.date)), 0, c.tz);
  const items = dueBefore(db, end, DUE_LIMITS.items).map((r) => ({ id: r.id, text: r.text, at: r.fire_at }));
  return {
    items,
    today: items.filter((r) => r.at < tomorrow).length,
    tomorrow: items.filter((r) => r.at >= tomorrow).length,
  };
}

/** "Due": counts and the next one's time on the tile; the list goes to its sheet. */
function dueTile(d: ReturnType<typeof dueReminders>, tz: string): DueTile | null {
  if (!d.items.length) return null;
  const value = [d.today && `${d.today} today`, d.tomorrow && `${d.tomorrow} tomorrow`].filter(Boolean).join(' · ');
  const next = d.items[0];
  return {
    kind: 'due',
    label: 'Due',
    value,
    detail: d.today ? `Next at ${hhmm(next.at, tz)}` : `Next tomorrow at ${hhmm(next.at, tz)}`,
    today: d.today,
    tomorrow: d.tomorrow,
    items: d.items,
  };
}

/** "Holidays": the next one within 14 days, from the owner's country (none set: no tile). */
function holidayTile(db: Db, date: string): HolidayTile | null {
  const h = nextHoliday(getSetting(db, 'owner.country'), date, HOLIDAY_WITHIN_DAYS);
  if (!h) return null;
  const when =
    h.in_days === 0 ? 'Today' : `${dateLine(h.date)} · ${h.in_days === 1 ? 'tomorrow' : `in ${h.in_days} days`}`;
  return {
    kind: 'holiday',
    label: 'Holidays',
    value: short(h.name, 32),
    detail: short(when, 60),
    date: h.date,
    in_days: h.in_days,
  };
}

/** The date and one line from the day's counts, never from anyone's words; null when all are 0. */
export function todayLine(date: string, n: { due: number; episodes: number; songs: number | null }): TodayLine {
  const parts = (dueWords: string) =>
    [
      n.due > 0 && `${plural(n.due, 'reminder')} ${dueWords}`,
      n.episodes > 0 && plural(n.episodes, 'new episode'),
      (n.songs ?? 0) > 0 && `${plural(n.songs ?? 0, 'song')} added`,
    ].filter((p): p is string => Boolean(p));
  const sentence = (p: string[]) =>
    p.length ? `${p.length > 1 ? `${p.slice(0, -1).join(', ')} and ${p.at(-1)}` : p[0]}.` : null;
  const line = sentence(parts('due today'));
  return {
    date: dateLine(date),
    line: line && line.length > TODAY_LINE_MAX ? sentence(parts('due')) : line,
  };
}

const SLOTS = ['practice', 'study', 'built', 'note.1', 'note.2', 'note.3'];

/** The night shift's tiles (`tile` surfaces in app `briefing`) by slot; one without an expiry goes after a day. */
function nightTiles(db: Db, now: number): NightTile[] {
  return surfaces
    .list(db, 0, now)
    .filter(
      (s) =>
        s.app === 'briefing' &&
        s.kind === 'tile' &&
        s.schema === 1 &&
        (s.expires_at !== null || now - s.written_at < DAY),
    )
    .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))
    .map((s) => {
      const p = s.payload as Record<string, unknown>;
      const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
      return {
        kind: 'night',
        slot: s.slot,
        label: text('label') ?? '',
        value: text('value') ?? '',
        detail: text('detail'),
        big: text('big'),
        wide: p.wide === true,
        app: text('app'),
        path: text('path'),
        why: s.why,
        ledger_id: s.ledger_id,
      };
    });
}

function museLine(db: Db, now: number): string | null {
  const s = work.seen(db);
  if (!s) return null;
  // Only when it needs the owner's eye: a quiet Muse. ("Muse is connected to the new Worker." was
  // plumbing talk, audit fix 6.)
  return now - s.last > WORK_LIMITS.silent_h * HOUR ? "Muse hasn't checked in since yesterday." : null;
}

/** The night line (RUNTIME.md §9 F14, F15), only while the night shift is connected: the hard
 * stop ended its run before step 7, or it stopped before it, or (from 07:00, after the 06:07
 * fallback) it hasn't run. */
function nightNote(db: Db, c: { now: number; tz: string; day: string; nightConfigured: boolean }): string | null {
  if (!c.nightConfigured) return null;
  const s = arrangeState(db, c.day, c.now);
  if (s === 'cut') return 'The night shift ran out of time before arranging this page.';
  if (s === 'stopped') return 'The night shift stopped before arranging this page.';
  if (s === 'none' && wallMinute(c.now, c.tz) >= 7 * 60) return "The night shift hasn't run yet.";
  return null;
}

export function briefing(
  db: Db,
  c: {
    now: number;
    tz: string;
    day: string;
    weather: WeatherTile;
    /** Songs added in the last day (the Music object), or null when it couldn't say. */
    songsAdded?: number | null;
    nightConfigured?: boolean;
  },
): BriefingResponse {
  // Due and Holidays go by the owner's calendar day, as the phone's date does.
  const date = ownerDay(c.now, c.tz);
  const waiting = waitingTile(db, c.now);
  const due = dueReminders(db, { now: c.now, tz: c.tz, date });
  const dueT = dueTile(due, c.tz);
  const holiday = holidayTile(db, date);
  // BRIEFING.md §4: at most 8 tiles; the night's own come after what waits and what is due, and a
  // tile the mind pinned right after what waits (pins.ts).
  const tiles: BriefingTile[] = arrange(
    [...(waiting ? [waiting] : []), ...(dueT ? [dueT] : []), ...nightTiles(db, c.now), ...(holiday ? [holiday] : [])],
    pinsOf(db),
  ).slice(0, 8);
  return {
    day: c.day,
    title: titleLine(Math.floor(wallMinute(c.now, c.tz) / 60), !tiles.length),
    today: todayLine(date, {
      due: due.today,
      episodes: newSince(db, c.now - 20 * HOUR),
      songs: c.songsAdded ?? null,
    }),
    weather: c.weather,
    tiles,
    muse: museLine(db, c.now),
    night: nightNote(db, { now: c.now, tz: c.tz, day: c.day, nightConfigured: c.nightConfigured ?? false }),
    // A meter that can't be read leaves the line out; the page is served all the same.
    quota: quotaLine(safeQuota(db, c.now), c.tz),
  };
}
