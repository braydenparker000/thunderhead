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

/** The UTC day (`YYYY-MM-DD`), for keys that must rotate at one fixed instant everywhere. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Round down to the hour, so "last seen" is written at most once an hour. */
export function floorHour(at: number): number {
  return at - (at % HOUR);
}
