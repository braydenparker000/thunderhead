// P8: the Briefing's weather through the Worker (BRIEFING.md §2, §6), Open-Meteo answered by the
// test: with no place the tile asks for one; a town's name is looked up and kept (only in Core's
// settings), its forecast fetched and the tile filled; an unknown name is the owner's words; a kept
// forecast under 30 minutes old is not asked again, an older one is.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { useFetch } from '../../src/areas/briefing/weather';
import { api, apiJson, coreSql, setupOwner } from '../helpers';

let D = '';
let asked: string[] = [];
const H = 3_600_000;

function openMeteo(url: string): Response {
  const u = new URL(url);
  asked.push(u.host);
  if (u.host === 'geocoding-api.open-meteo.com')
    return Response.json(
      u.searchParams.get('name') === 'Testville'
        ? { results: [{ name: 'Testville', latitude: 12.3456, longitude: -4.5678, country_code: 'XX' }] }
        : {},
    );
  const start = Math.floor(Date.now() / H) * H;
  const time = Array.from({ length: 48 }, (_, i) => (start + i * H) / 1000);
  return Response.json({
    current: { temperature_2m: 18.6 },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 15 + (i % 5)),
      precipitation_probability: time.map(() => 10),
      weather_code: time.map(() => 2),
    },
    // Open-Meteo stamps each day at its local midnight (here UTC, the owner's zone in this test); the
    // current hour instead made "tomorrow" today's row after 12:00.
    daily: {
      time: [0, 1, 2].map((d) => ((Math.floor(Date.now() / (24 * H)) + d) * 24 * H) / 1000),
      temperature_2m_max: [20, 21, 22],
      temperature_2m_min: [9, 10, 11],
    },
  });
}

beforeAll(async () => {
  useFetch(async (input) => openMeteo(String(input instanceof Request ? input.url : input)));
  D = (await setupOwner()).token;
});
afterAll(() => useFetch((...a) => fetch(...a)));

const briefing = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body;

describe('the Briefing’s weather', () => {
  it('asks for a place, keeps it, and fills the tile', async () => {
    expect((await briefing()).weather).toMatchObject({
      place: null,
      temp: null,
      detail: 'Set a place for the weather',
    });
    const unknown = await apiJson<{ error: { code: string; details: { issue: string }[] } }>(
      'PUT',
      '/v1/briefing/place',
      {
        token: D,
        body: { name: 'Nowhere' },
      },
    );
    expect([unknown.status, unknown.body.error.details[0].issue]).toEqual([422, 'No place by that name.']);
    asked = [];
    expect((await apiJson('PUT', '/v1/briefing/place', { token: D, body: { name: 'Testville' } })).body).toEqual({
      place: 'Testville',
    });
    expect(asked).toEqual(['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
    const [kept] = await coreSql<{ value_json: string }>(`SELECT value_json FROM settings WHERE key = 'weather.place'`);
    expect(JSON.parse(kept.value_json)).toEqual({ name: 'Testville', lat: 12.3, lon: -4.6 });
    const w = (await briefing()).weather;
    expect([w.place, w.temp, w.detail, w.hours.length, w.tomorrow]).toEqual([
      'Testville',
      '19°',
      expect.stringMatching(/^Dry /),
      12,
      { high: 21, low: 10 },
    ]);
    expect((await api('PUT', '/v1/briefing/place', { token: D, body: { name: 'x' } })).status).toBe(422);
  });

  it('asks Open-Meteo again only when the kept forecast is over 30 minutes old', async () => {
    asked = [];
    await briefing();
    expect(asked).toEqual([]);
    const [row] = await coreSql<{ value_json: string }>(
      `SELECT value_json FROM settings WHERE key = 'weather.forecast'`,
    );
    const old = { ...JSON.parse(row.value_json), at: Date.now() - 40 * 60_000 };
    await coreSql(`UPDATE settings SET value_json = ? WHERE key = 'weather.forecast'`, JSON.stringify(old));
    await briefing();
    for (let i = 0; i < 20 && !asked.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(asked).toEqual(['api.open-meteo.com']);
  });
});
