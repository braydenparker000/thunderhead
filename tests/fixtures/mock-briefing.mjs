// The Briefing page and the Board of the mocked Worker (BRIEFING.md, API.md): one card waiting and
// today's edition, synthetic and using every v2 block type, with a tag that must stay text.

export const DAY = '2026-10-29';

export const EDITION = {
  schema: 'jarvis-daily-board-v2', id: '0192f0c4-0000-4000-8000-0000000000b1', date: DAY,
  title: 'Rain moves in, the market steadies', summary: 'Two stories: the weather turns and prices hold.',
  edition: { theme: 'tide', thesis: 'A slower week, on purpose.' },
  stories: [
    {
      id: 'rain', title: 'Rain moves in after a dry month', label: 'Weather · forecast issued today', composition: 'lead', claim: 'forecast',
      dek: 'Three wet days start tomorrow.', whyItMatters: 'Outdoor plans shift to the weekend.', whatsNext: 'The next forecast is at 18:00.',
      disagreement: { label: 'Another model', text: 'One model keeps it dry until Saturday.' },
      sources: [
        { title: 'Forecast', url: 'https://example.com/forecast', publisher: 'Example Weather', type: 'official' },
        { title: '<img src=x onerror="document.title=1">Model run', url: 'https://example.com/model', publisher: 'Example Models' },
      ],
      blocks: [
        { id: 'b1', type: 'prose', text: 'A front arrives from the west.', cites: [0] },
        { id: 'b2', type: 'stats', items: [{ label: 'Rain', value: '42 mm', change: '+30 mm', direction: 'up', tone: 'bad', asOf: 'today' }, { label: 'Days', value: '3' }] },
        { id: 'b3', type: 'chart', text: 'Rain by day', kind: 'column', unit: 'mm', labels: ['Thu', 'Fri', 'Sat'], series: [{ name: 'Rain', values: [12, 20, 10] }] },
        { id: 'b4', type: 'timeline', text: 'The week', items: [{ label: 'Wednesday', text: 'Dry', state: 'past' }, { label: 'Thursday', text: 'Rain starts', state: 'next' }] },
        { id: 'b5', type: 'quote', text: 'Bring an umbrella.', speaker: 'A forecaster', role: 'Example Weather' },
        { id: 'b6', type: 'callout', kind: 'unknown', text: 'How long the front stalls.' },
      ],
    },
    {
      id: 'prices', title: 'Prices hold for a second month', composition: 'data', dek: 'The monthly figure is flat.',
      sources: [{ title: 'Statistics office', url: 'https://example.com/stats' }],
      blocks: [
        { id: 'c1', type: 'chart', text: 'Monthly change', kind: 'line', unit: '%', labels: ['Jul', 'Aug', 'Sep', 'Oct'], series: [{ name: 'Prices', values: [0.4, 0.2, 0.1, 0.1] }] },
        { id: 'c2', type: 'comparison', text: 'Two readings', items: [{ label: 'Calm', text: 'It has settled.' }, { label: 'Cautious', text: 'One month is not a trend.' }] },
        { id: 'c3', type: 'perspectives', text: 'What it means', tabs: [{ label: 'Shoppers', text: 'Bills stay the same.' }, { label: 'Savers', text: 'Rates may stay put.' }] },
        { id: 'c4', type: 'explanation', text: 'How the figure is made', steps: ['Prices are collected.', 'They are weighted.', 'The change is published.'] },
        { id: 'c5', type: 'agenda', text: 'Next', items: [{ at: '2026-11-12T09:00:00+00:00', label: 'Next figure' }] },
      ],
    },
  ],
};

export function briefingState() {
  return {
    page: {
      day: DAY, title: "Here's your day.",
      tiles: [{ kind: 'waiting', label: 'Waiting on you', value: 'Let Muse read your Board brief?', detail: 'One tap on home', count: 1 }],
      board: { day: DAY, title: EDITION.title, detail: '2 stories · 1 min read', stories: 2, minutes: 1, stale: false },
      muse: 'Muse is connected to the new Worker.',
    },
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

/** GET /v1/briefing, GET /v1/board/editions/:day and PUT /v1/briefing/place ("Nowhere" is unknown); null for anything else. */
export function briefingAnswer(s, method, p, body) {
  if (s && method === 'PUT' && p === '/v1/briefing/place') {
    if (body?.name === 'Nowhere') return [422, { error: { code: 'validation', message: 'Some fields are not valid.', details: [{ path: 'name', issue: 'No place by that name.' }], request_id: 'r' } }];
    s.page = { ...s.page, weather: weatherFor(body.name) };
    return [200, { place: body.name }];
  }
  if (!s || method !== 'GET') return null;
  if (p === '/v1/briefing') return [200, s.page];
  if (p === `/v1/board/editions/${DAY}`) return [200, { day: DAY, edition: EDITION, finished_at: Date.parse(`${DAY}T07:10:00Z`), origin: 'muse' }];
  return null;
}
