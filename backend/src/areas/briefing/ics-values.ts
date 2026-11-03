// ICS values (RFC 5545) for the calendar's parser (ics.ts): content lines, text, dates and
// date-times in their zones, and durations. Pure.
import { DAY, MINUTE, zonedMinute } from '../../lib/time';

export interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** One content line: NAME;PARAM=a;PARAM="b:c":value (a colon inside quotes is not the split). */
export function parseLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (parts[0] ?? '').toUpperCase(), params, value: line.slice(colon + 1) };
}

/** RFC 5545 §3.3.11 text: escapes undone, made one line, control characters out, cut to `max`. */
export function text(v: string | undefined, max: number): string {
  const s = (v ?? '')
    .replace(/\\([nN])/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Common Windows zone names (Outlook and Exchange feeds) and their IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'India Standard Time': 'Asia/Kolkata',
  'Tokyo Standard Time': 'Asia/Tokyo',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
};
const known = new Map<string, boolean>();
const isZone = (z: string) => {
  let ok = known.get(z);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: z });
      ok = true;
    } catch {
      ok = false;
    }
    known.set(z, ok);
  }
  return ok;
};
/** A TZID as an IANA zone, or null (then the owner's zone is used). */
export function zoneOf(tzid: string): string | null {
  const t = tzid.trim();
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  if (isZone(t)) return t;
  // "/mozilla.org/20050126_1/America/New_York", "/citadel.org/.../Europe/London"
  const tail = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(t)?.[1];
  return tail && isZone(tail) ? tail : null;
}

/** A DTSTART-like value: its local day and second of the day in its zone (`UTC` for `Z`), or a date. */
export interface When {
  day: string;
  sec: number;
  zone: string;
  date: boolean;
}

export function when(p: Prop | undefined, ownerTz: string): When | null {
  if (!p) return null;
  const v = p.value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d) return { day: `${d[1]}-${d[2]}-${d[3]}`, sec: 0, zone: ownerTz, date: true };
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!t || p.params.VALUE === 'DATE') return null;
  const zone = t[7] ? 'UTC' : ((p.params.TZID && zoneOf(p.params.TZID)) ?? ownerTz);
  const sec = Number(t[4]) * 3600 + Number(t[5]) * 60 + Math.min(59, Number(t[6]));
  if (sec >= DAY / 1000) return null;
  return { day: `${t[1]}-${t[2]}-${t[3]}`, sec, zone, date: false };
}

/** The instant a local day and second reach in a zone (all-day: the owner's midnight). */
export function instant(day: string, sec: number, zone: string): number {
  if (zone === 'UTC') return Date.parse(`${day}T00:00:00Z`) + sec * 1000;
  return zonedMinute(day, Math.floor(sec / 60), zone) + (sec % 60) * 1000;
}

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const weekdayOf = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** RFC 5545 DURATION: P[n]W or P[n]DT[n]H[n]M[n]S, in ms (`days` for an all-day event), or null. */
export function duration(v: string | undefined): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec((v ?? '').trim());
  if (!m || m[1] === '-') return null;
  const n = (i: number) => Number(m[i] ?? 0);
  return (n(2) * 7 + n(3)) * DAY + n(4) * 3_600_000 + n(5) * MINUTE + n(6) * 1000;
}
