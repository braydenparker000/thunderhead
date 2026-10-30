// The Briefing's weather words (backend/src/areas/briefing/weather.ts; BRIEFING.md §2, §6) on a
// fixed clock in UTC: dry for the day or tonight, a spell of rain with its hours, storms through
// the night "Clear by morning", rain now "until", the kind by the strongest code; "as of" after 3
// hours and no numbers after 12; the next 12 hours and tomorrow's high and low; no place asks for one.
import { describe, expect, it } from 'vitest';
import { type Forecast, sentence, weatherTile } from '../../src/areas/briefing/weather';

const H = 3_600_000;
const at = (d: number, h: number) => Date.UTC(2026, 9, d, h);
/** A forecast from 00:00 on the 30th for 48 hours; `wet` hours get that code and 80 %. */
function forecast(wet: Record<number, number> = {}, fetched = at(30, 10)): Forecast {
  const hours = Array.from({ length: 48 }, (_, i) => ({
    at: at(30, 0) + i * H,
    temp: 10 + (i % 24) / 2,
    rain: wet[i] ? 80 : 5,
    code: wet[i] ?? 1,
  }));
  return {
    at: fetched,
    current: 21.4,
    hours,
    days: [0, 1, 2].map((d) => ({ at: at(30 + d, 0), high: 22.6 + d, low: 9.4 + d })),
  };
}
const range = (from: number, to: number, code: number) =>
  Object.fromEntries(Array.from({ length: to - from }, (_, i) => [from + i, code]));

describe('weather', () => {
  it('says the next hours in one sentence', () => {
    expect(sentence(forecast(), at(30, 10), 'UTC')).toBe('Dry for the rest of the day.');
    expect(sentence(forecast(), at(30, 19), 'UTC')).toBe('Dry tonight.');
    expect(sentence(forecast(range(15, 18, 61)), at(30, 10), 'UTC')).toBe('Rain from 15:00 to 18:00.');
    expect(sentence(forecast(range(21, 26, 95)), at(30, 15), 'UTC')).toBe(
      'Storms from 21:00 to 02:00. Clear by morning.',
    );
    expect(sentence(forecast(range(9, 12, 80)), at(30, 10), 'UTC')).toBe('Showers until 12:00.');
    expect(sentence(forecast({ ...range(14, 16, 61), 15: 73 }), at(30, 10), 'UTC')).toBe('Snow from 14:00 to 16:00.');
    expect(sentence(forecast(range(18, 40, 61)), at(30, 10), 'UTC')).toBe('Rain from 18:00 on.');
  });

  it('the tile: now, the next 12 hours, tomorrow; "as of" after 3 hours, no numbers after 12', () => {
    const place = { name: 'Testville', lat: 1.23, lon: 4.56 };
    const t = weatherTile(place, forecast(), at(30, 10), 'UTC');
    expect([t.place, t.temp, t.detail, t.hours.length, t.hours[0], t.tomorrow]).toEqual([
      'Testville',
      '21°',
      'Dry for the rest of the day.',
      12,
      { at: at(30, 10), temp: 15, rain: 5 },
      { high: 24, low: 10 },
    ]);
    expect(weatherTile(place, forecast({}, at(30, 6)), at(30, 10), 'UTC').detail).toBe('as of 06:00');
    expect(weatherTile(place, forecast({}, at(29, 20)), at(30, 10), 'UTC')).toMatchObject({
      temp: null,
      detail: 'Weather is out of date',
      hours: [],
    });
    expect(weatherTile(null, null, at(30, 10), 'UTC')).toEqual({
      place: null,
      temp: null,
      detail: 'Set a place for the weather',
      as_of: null,
      hours: [],
      tomorrow: null,
    });
  });
});
