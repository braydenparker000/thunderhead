// Time helpers. Storage and wire use ms UTC (`*_at`); `day` is the owner's local calendar day.
// Inside Workers, Date.now() only advances between I/O events, which is fine for timestamps
// but means it cannot time CPU work (see MEASUREMENTS.md).

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const formats = new Map<string, Intl.DateTimeFormat>();

/** The owner-local day (`YYYY-MM-DD`) for a ms UTC instant, in an IANA time zone. */
export function ownerDay(at: number, timeZone: string): string {
  let f = formats.get(timeZone);
  if (!f) {
    // en-CA formats dates as YYYY-MM-DD.
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formats.set(timeZone, f);
  }
  return f.format(at);
}

const clocks = new Map<string, Intl.DateTimeFormat>();
/** The zone's offset from UTC at an instant, in ms (its wall clock minus UTC). */
function offset(at: number, timeZone: string): number {
  let f = clocks.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    clocks.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return wall - (at - (at % 1000));
}

/** The instant `day` reaches `hour`:00 in the owner's zone (twice through, for a DST change). */
export function zonedInstant(day: string, hour: number, timeZone: string): number {
  const naive = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const first = naive - offset(naive, timeZone);
  return naive - offset(first, timeZone);
}

/** The UTC day (`YYYY-MM-DD`), for keys that must rotate at one fixed instant everywhere. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Round down to the hour, so "last seen" is written at most once an hour. */
export function floorHour(at: number): number {
  return at - (at % HOUR);
}

/** The calendar day `n` days before `day` (both `YYYY-MM-DD`). */
export function dayBefore(day: string, n = 1): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - n * DAY).toISOString().slice(0, 10);
}
