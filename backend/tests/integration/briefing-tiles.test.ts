// P8: the night shift's Briefing tiles (BRIEFING.md §2, §4; surface kind `tile` in app
// `briefing`): the Worker holds them to the content limits and to a link inside one app; the page
// gets them after "Waiting on you" in slot order (practice, study, built, notes), with where a
// tap opens them; one without an expiry goes after a day.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse, NightTile } from '../../../shared/contract/briefing.ts';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const tile = (payload: object, more: object = {}) => ({
  kind: 'tile',
  schema: 1,
  payload,
  why: 'From the reading plan you agreed.',
  topic_key: 'study.today',
  ...more,
});
const put = (slot: string, body: object) => apiJson('PUT', `/v1/surfaces/briefing/${slot}`, { token: C, body });
const night = async () =>
  (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body.tiles.filter(
    (t): t is NightTile => t.kind === 'night',
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('the night shift’s Briefing tiles', () => {
  it('are held to the limits and a link inside one app', async () => {
    const study = {
      label: 'Study',
      value: 'Book A, chapter 3',
      detail: 'p. 212 · 20 min',
      app: 'study',
      path: '/study/?book=b1&p=212',
    };
    expect((await put('study', tile(study))).status).toBe(200);
    for (const bad of [
      { ...study, label: 'x'.repeat(25) },
      { ...study, value: 'Read now!' },
      { ...study, path: '/music/' },
      { ...study, path: '/study/../signin/' },
      { ...study, app: 'nowhere' },
      { label: 'Study', value: 'Book A', path: '/study/' },
    ])
      expect((await put('study', tile(bad))).status, JSON.stringify(bad)).toBe(422);
    expect((await put('weather', tile(study))).status).toBe(422);
  });

  it('come in slot order with where a tap opens them; one without an expiry goes after a day', async () => {
    expect(
      (
        await put(
          'built',
          tile(
            {
              label: 'Built overnight',
              value: 'A calm playlist',
              detail: '31 songs, ready in Music',
              app: 'music',
              path: '/music/#pl=calm123456',
            },
            { topic_key: 'built.night' },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await put(
          'note.1',
          tile(
            { label: 'Note', value: 'Bring the umbrella', wide: true },
            { topic_key: 'note.rain', expires_at: Date.now() + 3_600_000 },
          ),
        )
      ).status,
    ).toBe(200);
    const tiles = await night();
    expect(tiles.map((t) => [t.slot, t.label, t.app, t.path, t.wide])).toEqual([
      ['study', 'Study', 'study', '/study/?book=b1&p=212', false],
      ['built', 'Built overnight', 'music', '/music/#pl=calm123456', false],
      ['note.1', 'Note', null, null, true],
    ]);
    await coreSql(
      `UPDATE surfaces SET written_at = ? WHERE app = 'briefing' AND slot = 'study'`,
      Date.now() - 25 * 3_600_000,
    );
    expect((await night()).map((t) => t.slot)).toEqual(['built', 'note.1']);
  });
});
