// The Briefing page of the mocked Worker (BRIEFING.md, API.md): one card waiting and Muse's line.

export const DAY = '2026-10-29';

export function briefingState() {
  return {
    page: {
      day: DAY, title: "Here's your day.",
      tiles: [{ kind: 'waiting', label: 'Waiting on you', value: 'Forget the old address?', detail: 'One tap on home', count: 1 }],
      muse: "Muse hasn't checked in since yesterday.",
    },
  };
}

/** The Today tile (BRIEFING.md "Today") as the Worker makes it from invented calendars: two timed
 * events and one all day still on today, tomorrow's first, and the line for a link that failed. */
export function calendarTile({ notice = null } = {}) {
  const ev = (time, title, more = {}) => ({ uid: title, start: 0, end: 0, all_day: time === null, title, location: null, source: 'owner', time, ...more });
  return {
    kind: 'calendar', label: 'Today', value: '15:00 Dentist', detail: '3 things on today',
    today: [ev(null, 'Bins out'), ev('15:00', 'Dentist', { location: 'High Street' }), ev('18:30', 'Dinner', { source: 'outside' })],
    tomorrow: ev('09:00', 'Standup'),
    notice,
  };
}

/** The weather tile for a place, 12 synthetic hours from now. */
export function weatherFor(place) {
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return {
    place, temp: '19°', detail: 'Rain from 15:00 to 18:00.', as_of: Date.now(),
    hours: Array.from({ length: 12 }, (_, i) => ({ at: start + i * 3_600_000, temp: 15 + (i % 4), rain: i > 4 && i < 8 ? 80 : 10 })),
    tomorrow: { high: 21, low: 10 },
  };
}

/** GET /v1/briefing and PUT /v1/briefing/place ("Nowhere" is unknown); null for anything else. */
export function briefingAnswer(s, method, p, body) {
  if (s && method === 'PUT' && p === '/v1/briefing/place') {
    if (body?.name === 'Nowhere') return [422, { error: { code: 'validation', message: 'Some fields are not valid.', details: [{ path: 'name', issue: 'No place by that name.' }], request_id: 'r' } }];
    s.page = { ...s.page, weather: weatherFor(body.name) };
    return [200, { place: body.name }];
  }
  if (!s || method !== 'GET') return null;
  if (p === '/v1/briefing') return [200, s.page];
  return null;
}
