// Public holidays for the Briefing's Holidays tile (BRIEFING.md §2): a static list per country,
// nothing fetched. Fixed dates are listed; the well-known movable ones are computed (Easter by the
// Gregorian computus, and the nth or last weekday of a month). National days only: a holiday kept
// in some states or regions is left out, and when one falls on a weekend the weekday off that
// replaces it is not shown. Only 2026 and 2027 are covered; outside them there is no tile. The
// owner's country is the private Core setting `owner.country` (ISO 3166-1 alpha-2), set from the
// weather place's country; it never appears in this repository.

export const HOLIDAY_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'MX'] as const;
export type HolidayCountry = (typeof HOLIDAY_COUNTRIES)[number];
export const HOLIDAY_YEARS: readonly number[] = [2026, 2027];

/** A fixed date; an offset in days from Easter Sunday; the nth weekday of a month (`n: -1` the
 * last; `wd` 0 Sunday to 6 Saturday); or the last weekday on or before a date (Victoria Day). */
type Rule = { name: string } & (
  | { m: number; d: number }
  | { easter: number }
  | { m: number; wd: number; n: number }
  | { m: number; wd: number; onOrBefore: number }
);

const RULES: Record<HolidayCountry, Rule[]> = {
  US: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Martin Luther King Jr. Day', m: 1, wd: 1, n: 3 },
    { name: 'Presidents’ Day', m: 2, wd: 1, n: 3 },
    { name: 'Memorial Day', m: 5, wd: 1, n: -1 },
    { name: 'Juneteenth', m: 6, d: 19 },
    { name: 'Independence Day', m: 7, d: 4 },
    { name: 'Labor Day', m: 9, wd: 1, n: 1 },
    { name: 'Columbus Day', m: 10, wd: 1, n: 2 },
    { name: 'Veterans Day', m: 11, d: 11 },
    { name: 'Thanksgiving', m: 11, wd: 4, n: 4 },
    { name: 'Christmas Day', m: 12, d: 25 },
  ],
  // England and Wales' bank holidays.
  GB: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Good Friday', easter: -2 },
    { name: 'Easter Monday', easter: 1 },
    { name: 'Early May bank holiday', m: 5, wd: 1, n: 1 },
    { name: 'Spring bank holiday', m: 5, wd: 1, n: -1 },
    { name: 'Summer bank holiday', m: 8, wd: 1, n: -1 },
    { name: 'Christmas Day', m: 12, d: 25 },
    { name: 'Boxing Day', m: 12, d: 26 },
  ],
  // Federal statutory holidays.
  CA: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Good Friday', easter: -2 },
    { name: 'Victoria Day', m: 5, wd: 1, onOrBefore: 24 },
    { name: 'Canada Day', m: 7, d: 1 },
    { name: 'Labour Day', m: 9, wd: 1, n: 1 },
    { name: 'Truth and Reconciliation Day', m: 9, d: 30 },
    { name: 'Thanksgiving', m: 10, wd: 1, n: 2 },
    { name: 'Remembrance Day', m: 11, d: 11 },
    { name: 'Christmas Day', m: 12, d: 25 },
    { name: 'Boxing Day', m: 12, d: 26 },
  ],
  // National public holidays (the King's Birthday as most states keep it).
  AU: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Australia Day', m: 1, d: 26 },
    { name: 'Good Friday', easter: -2 },
    { name: 'Easter Monday', easter: 1 },
    { name: 'Anzac Day', m: 4, d: 25 },
    { name: 'King’s Birthday', m: 6, wd: 1, n: 2 },
    { name: 'Christmas Day', m: 12, d: 25 },
    { name: 'Boxing Day', m: 12, d: 26 },
  ],
  DE: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Good Friday', easter: -2 },
    { name: 'Easter Monday', easter: 1 },
    { name: 'Labour Day', m: 5, d: 1 },
    { name: 'Ascension Day', easter: 39 },
    { name: 'Whit Monday', easter: 50 },
    { name: 'German Unity Day', m: 10, d: 3 },
    { name: 'Christmas Day', m: 12, d: 25 },
    { name: 'Second Day of Christmas', m: 12, d: 26 },
  ],
  FR: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Easter Monday', easter: 1 },
    { name: 'Labour Day', m: 5, d: 1 },
    { name: 'Victory in Europe Day', m: 5, d: 8 },
    { name: 'Ascension Day', easter: 39 },
    { name: 'Whit Monday', easter: 50 },
    { name: 'Bastille Day', m: 7, d: 14 },
    { name: 'Assumption of Mary', m: 8, d: 15 },
    { name: 'All Saints’ Day', m: 11, d: 1 },
    { name: 'Armistice Day', m: 11, d: 11 },
    { name: 'Christmas Day', m: 12, d: 25 },
  ],
  // National holidays (each region adds its own).
  ES: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Epiphany', m: 1, d: 6 },
    { name: 'Good Friday', easter: -2 },
    { name: 'Labour Day', m: 5, d: 1 },
    { name: 'Assumption of Mary', m: 8, d: 15 },
    { name: 'National Day of Spain', m: 10, d: 12 },
    { name: 'All Saints’ Day', m: 11, d: 1 },
    { name: 'Constitution Day', m: 12, d: 6 },
    { name: 'Immaculate Conception', m: 12, d: 8 },
    { name: 'Christmas Day', m: 12, d: 25 },
  ],
  // The statutory rest days (Ley Federal del Trabajo, article 74).
  MX: [
    { name: 'New Year’s Day', m: 1, d: 1 },
    { name: 'Constitution Day', m: 2, wd: 1, n: 1 },
    { name: 'Benito Juárez’s Birthday', m: 3, wd: 1, n: 3 },
    { name: 'Labour Day', m: 5, d: 1 },
    { name: 'Independence Day', m: 9, d: 16 },
    { name: 'Revolution Day', m: 11, wd: 1, n: 3 },
    { name: 'Christmas Day', m: 12, d: 25 },
  ],
};

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const weekday = (ms: number) => new Date(ms).getUTCDay();

/** Easter Sunday of a Gregorian year (the anonymous computus), as ms UTC at midnight. */
export function easter(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utc(y, Math.floor(n / 31), (n % 31) + 1);
}

function dateOf(r: Rule, y: number): number {
  if ('easter' in r) return easter(y) + r.easter * DAY_MS;
  if ('d' in r) return utc(y, r.m, r.d);
  if ('onOrBefore' in r) {
    const t = utc(y, r.m, r.onOrBefore);
    return t - ((weekday(t) - r.wd + 7) % 7) * DAY_MS;
  }
  if (r.n > 0) {
    const first = utc(y, r.m, 1);
    return first + (((r.wd - weekday(first) + 7) % 7) + (r.n - 1) * 7) * DAY_MS;
  }
  const last = utc(y, r.m + 1, 1) - DAY_MS;
  return last - ((weekday(last) - r.wd + 7) % 7) * DAY_MS;
}

export const isHolidayCountry = (c: unknown): c is HolidayCountry =>
  typeof c === 'string' && (HOLIDAY_COUNTRIES as readonly string[]).includes(c);

/** A country's holidays in a covered year, by date (`YYYY-MM-DD`); none outside 2026–2027. */
export function holidaysOf(country: HolidayCountry, year: number): { date: string; name: string }[] {
  if (!HOLIDAY_YEARS.includes(year)) return [];
  return RULES[country]
    .map((r) => ({ date: iso(dateOf(r, year)), name: r.name }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The next holiday from `day` (that day included) within `within` days, or null: also for a
 * country without a list. */
export function nextHoliday(
  country: unknown,
  day: string,
  within = 14,
): { date: string; name: string; in_days: number } | null {
  if (!isHolidayCountry(country)) return null;
  const from = Date.parse(`${day}T00:00:00Z`);
  const y = Number(day.slice(0, 4));
  for (const h of [...holidaysOf(country, y), ...holidaysOf(country, y + 1)]) {
    const n = Math.round((Date.parse(`${h.date}T00:00:00Z`) - from) / DAY_MS);
    if (n >= 0) return n <= within ? { ...h, in_days: n } : null;
  }
  return null;
}
