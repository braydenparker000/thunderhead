// The owner's calendars (BRIEFING.md "Today", PRIVACY.md §5): ICS subscription links pasted in
// Settings › Briefing (`briefing.calendars`). Each is fetched by the Worker, never by the phone, on
// the day roll and when the Briefing opens with the last try over 30 minutes old: a public https
// address only (linkProblem, again here), no redirect followed, at most 1 MB in 10 s, and only a
// `text/calendar` or `text/plain` answer that starts as a calendar. A failure is a code, never the
// host's words. What the parser reads and leaves is in ics.ts. Tests swap the fetch.
import { CALENDAR_LIMITS, type CalendarEvent } from '../../../../shared/contract/briefing.ts';
import { linkProblem } from '../../../../shared/contract/settings.ts';
import { DAY, ownerDay, zonedMinute } from '../../lib/time';
import type { Core } from '../../objects/core';
import { parseIcs } from './ics';

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch the calendar hosts are asked with. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
}

/** Why a link gave no calendar: `redirect`, `too_large`, `not_calendar`, `unreachable` (no answer
 * in time), `http_<status>` or `bad_link` (refused before asking). */
export class CalendarError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const UA = 'Thunderhead-Calendar/1.0 (personal app; 1 reader)';

/** The link's calendar as text, or a CalendarError. */
export async function fetchIcs(url: string): Promise<string> {
  if (linkProblem(url) !== null) throw new CalendarError('bad_link');
  let r: Response;
  try {
    r = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(CALENDAR_LIMITS.timeout_ms),
      headers: { Accept: 'text/calendar, text/plain;q=0.8', 'User-Agent': UA },
    });
  } catch {
    throw new CalendarError('unreachable');
  }
  const refuse = async (code: string): Promise<never> => {
    await r.body?.cancel().catch(() => {});
    throw new CalendarError(code);
  };
  // A redirect could lead anywhere (an internal address, another host): never followed.
  if (r.status >= 300 && r.status < 400) return refuse('redirect');
  if (!r.ok) return refuse(`http_${r.status}`);
  const type = (r.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'text/calendar' && type !== 'text/plain') return refuse('not_calendar');
  if (Number(r.headers.get('Content-Length')) > CALENDAR_LIMITS.bytes) return refuse('too_large');
  const bytes = await capped(r);
  const text = new TextDecoder().decode(bytes);
  if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(text)) throw new CalendarError('not_calendar');
  return text;
}

/** The whole body, or `too_large` past the cap (the host is let go at once); `unreachable` when
 * the time runs out mid-body. */
async function capped(r: Response): Promise<Uint8Array> {
  if (!r.body) return new Uint8Array();
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > CALENDAR_LIMITS.bytes) {
        await reader.cancel().catch(() => {});
        throw new CalendarError('too_large');
      }
      parts.push(value);
    }
  } catch (e) {
    if (e instanceof CalendarError) throw e;
    throw new CalendarError('unreachable');
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// --- the refresh ---------------------------------------------------------------------------------

/** Fetches the given links at once and has Core keep what each gave, or that it failed (its events
 * stay); settles when every one has. The window is the owner's today and the 13 days after it. */
export async function refreshCalendars(
  core: DurableObjectStub<Core>,
  links: { feed: string; url: string; mine: boolean }[],
  tz: string,
  now: number,
): Promise<void> {
  const today = ownerDay(now, tz);
  const from = zonedMinute(today, 0, tz);
  const to = zonedMinute(addDays(today, CALENDAR_LIMITS.days), 0, tz);
  await Promise.all(
    links.map(async (l) => {
      let rows: CalendarEvent[];
      try {
        rows = parseIcs(await fetchIcs(l.url), { from, to, ownerTz: tz, source: l.mine ? 'owner' : 'outside' });
      } catch (e) {
        await core.calendarFailed(l.feed, l.url, e instanceof CalendarError ? e.code : 'unreadable', Date.now());
        return;
      }
      await core.calendarPut(l.feed, l.url, rows, Date.now());
    }),
  );
}
