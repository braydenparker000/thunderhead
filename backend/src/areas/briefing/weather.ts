// The Briefing's weather (BRIEFING.md §2, §6): Open-Meteo, free and keyless, for the owner's place,
// which only the Worker keeps (Core settings, never the repo). A town's name is looked up once with
// its geocoder; the forecast is asked again when the page opens and the kept one is over 30 minutes
// old. The tile is made from the kept forecast at the moment it is asked for: the place, the
// temperature now, one sentence for the next hours, the next 12 hours and tomorrow's high and low;
// "as of" after 3 hours, no numbers after 12. Tests swap the fetch.
import type { WeatherTile } from '../../../../shared/contract/briefing.ts';
import { HOUR, ownerDay, wallMinute } from '../../lib/time';

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch Open-Meteo is asked with. */
export function useFetch(f: typeof fetch): void {
  fetcher = f;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Forecast {
  /** When it was fetched. */
  at: number;
  current: number;
  /** Hourly from the current hour, 36 hours: start, °C, rain chance %, WMO weather code. */
  hours: { at: number; temp: number; rain: number; code: number }[];
  /** Each local day's start, high and low. */
  days: { at: number; high: number; low: number }[];
}

/** PRIVACY.md §5: coordinates leave rounded to 0.1° (about 11 km). */
const round1 = (n: number) => Math.round(n * 10) / 10;

async function getJson(url: URL): Promise<Record<string, unknown>> {
  const r = await fetcher(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`weather ${r.status}`);
  }
  return (await r.json()) as Record<string, unknown>;
}

/** The first place by that name, or null, its coordinates rounded to 0.1°. */
export async function findPlace(name: string): Promise<Place | null> {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  for (const [k, v] of Object.entries({ name, count: '1', language: 'en', format: 'json' })) u.searchParams.set(k, v);
  const p = ((await getJson(u)).results as { name?: string; latitude?: number; longitude?: number }[] | undefined)?.[0];
  if (!p?.name || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null;
  return { name: p.name.slice(0, 24), lat: round1(p.latitude), lon: round1(p.longitude) };
}

export async function forecastFor(p: Place, now: number): Promise<Forecast> {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [k, v] of Object.entries({
    latitude: String(p.lat),
    longitude: String(p.lon),
    current: 'temperature_2m',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min',
    timeformat: 'unixtime',
    timezone: 'auto',
    forecast_days: '3',
  }))
    u.searchParams.set(k, v);
  const j = (await getJson(u)) as {
    current?: { temperature_2m?: number };
    hourly?: {
      time: number[];
      temperature_2m: number[];
      precipitation_probability: (number | null)[];
      weather_code: number[];
    };
    daily?: { time: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const h = j.hourly;
  const d = j.daily;
  if (!h || !d || typeof j.current?.temperature_2m !== 'number') throw new Error('weather shape');
  const hours = h.time
    .map((t, i) => ({
      at: t * 1000,
      temp: h.temperature_2m[i],
      rain: h.precipitation_probability[i] ?? 0,
      code: h.weather_code[i],
    }))
    .filter((x) => x.at > now - HOUR)
    .slice(0, 36);
  const days = d.time.map((t, i) => ({ at: t * 1000, high: d.temperature_2m_max[i], low: d.temperature_2m_min[i] }));
  return { at: now, current: j.current.temperature_2m, hours, days };
}

const STORM = (c: number) => c >= 95;
const SNOW = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const SHOWERS = (c: number) => c >= 80 && c <= 82;
const WET = (x: { code: number; rain: number }) => x.code >= 51 || x.rain >= 60;
const hhmm = (at: number, tz: string) => {
  const m = wallMinute(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** One sentence for the next 12 hours: the first wet spell and its kind, else dry. */
export function sentence(f: Forecast, now: number, tz: string): string {
  const next = f.hours.filter((x) => x.at + HOUR > now).slice(0, 12);
  const first = next.findIndex(WET);
  const evening = wallMinute(now, tz) >= 18 * 60;
  if (first < 0) return evening ? 'Dry tonight.' : 'Dry for the rest of the day.';
  let last = first;
  while (last + 1 < next.length && WET(next[last + 1])) last++;
  const spell = next.slice(first, last + 1);
  const kind = spell.some((x) => STORM(x.code))
    ? 'Storms'
    : spell.some((x) => SNOW(x.code))
      ? 'Snow'
      : spell.some((x) => SHOWERS(x.code))
        ? 'Showers'
        : spell.some((x) => x.code >= 51)
          ? 'Rain'
          : 'Rain likely';
  const end = next[last].at + HOUR;
  const from = first === 0 ? '' : ` from ${hhmm(next[first].at, tz)}`;
  if (last === next.length - 1) return first === 0 ? `${kind} for the next hours.` : `${kind}${from} on.`;
  const clears =
    ownerDay(end, tz) !== ownerDay(next[first].at, tz) && wallMinute(end, tz) < 9 * 60 ? ' Clear by morning.' : '';
  return first === 0 ? `${kind} until ${hhmm(end, tz)}.${clears}` : `${kind}${from} to ${hhmm(end, tz)}.${clears}`;
}

/** The tile as the page shows it now; with no place, the one that asks for it. */
export function weatherTile(place: Place | null, f: Forecast | null, now: number, tz: string): WeatherTile {
  if (!place)
    return { place: null, temp: null, detail: 'Set a place for the weather', as_of: null, hours: [], tomorrow: null };
  if (!f || now - f.at > 12 * HOUR)
    return {
      place: place.name,
      temp: null,
      detail: 'Weather is out of date',
      as_of: f?.at ?? null,
      hours: [],
      tomorrow: null,
    };
  const tomorrow = f.days.find((d) => ownerDay(d.at + 12 * HOUR, tz) === ownerDay(now + 24 * HOUR, tz));
  return {
    place: place.name,
    temp: `${Math.round(f.current)}°`,
    detail: now - f.at > 3 * HOUR ? `as of ${hhmm(f.at, tz)}` : sentence(f, now, tz),
    as_of: f.at,
    hours: f.hours
      .filter((x) => x.at + HOUR > now)
      .slice(0, 12)
      .map((x) => ({ at: x.at, temp: Math.round(x.temp), rain: Math.round(x.rain) })),
    tomorrow: tomorrow ? { high: Math.round(tomorrow.high), low: Math.round(tomorrow.low) } : null,
  };
}
