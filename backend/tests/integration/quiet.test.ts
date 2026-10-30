// P8: "go quiet" in the Worker (BEHAVIOR.md §8, Law 9; VL-3 `409 quiet`): the phone sets the
// setting `quiet.until`; while it is ahead the mind's nudge is refused with `quiet` and the mind's
// briefing says until when; 0 ends it and nudges are taken again.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Settings } from '../../../shared/contract/api';
import { api, apiJson } from '../helpers';
import { brief, CHAT_SESSION, principals } from '../memory-helpers';

let D = '';
let C = '';
const nudge = (topic: string) => ({
  title: 'Leave by 16:40',
  body: 'The bus is 10 minutes early today.',
  why: 'time-bound: the bus leaves early',
  topic_key: topic,
});
const quietLine = async () => (await brief(C, CHAT_SESSION, 'chat')).body.core.match(/quiet: [^\n]*/)?.[0];

beforeAll(async () => {
  ({ D, C } = await principals());
  // Quiet hours off, so only "go quiet" can refuse.
  await api('PATCH', '/v1/settings', {
    token: D,
    body: { 'quiet.start': '06:30', 'quiet.end': '06:30', 'owner.tz': 'UTC' },
  });
});

describe('go quiet', () => {
  it('refuses the mind’s nudges until it ends, and the briefing says until when', async () => {
    expect(await quietLine()).toBe('quiet: off');
    const until = Date.now() + 2 * 3_600_000;
    for (const bad of [-1, 1.5, '06:30', null])
      expect((await api('PATCH', '/v1/settings', { token: D, body: { 'quiet.until': bad } })).status).toBe(422);
    expect((await api('PATCH', '/v1/settings', { token: C, body: { 'quiet.until': until } })).status).toBe(403);
    const set = await apiJson<Settings>('PATCH', '/v1/settings', { token: D, body: { 'quiet.until': until } });
    expect([set.status, set.body['quiet.until']]).toEqual([200, until]);
    expect((await apiJson<Settings>('GET', '/v1/settings', { token: D })).body['quiet.until']).toBe(until);

    const refused = await apiJson<{ error: { code: string } }>('PUT', '/v1/pushes/quiet-0001', {
      token: C,
      body: nudge('trip.leave'),
    });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'quiet']);
    expect(await quietLine()).toMatch(
      /^quiet: until \d\d:\d\d \(the owner said go quiet: no nudges; cards and home lines wait\)$/,
    );

    await api('PATCH', '/v1/settings', { token: D, body: { 'quiet.until': 0 } });
    expect(await quietLine()).toBe('quiet: off');
    expect((await api('PUT', '/v1/pushes/quiet-0002', { token: C, body: nudge('trip.leave') })).status).toBe(202);
  });
});
