// Settings that the Worker honours where it decides (MENU-AND-SETTINGS.md §6, 2026-11-04): Lines on
// home caps the slots the mind may fill on home, and the owner's Briefing tiles say which tiles show
// and in what order. Each new key is checked by its kind; a phone key is never the Worker's.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import { settingSpec } from '../../../shared/contract/settings.ts';
import { tileName } from '../../src/areas/briefing/owner-tiles';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
type Refused = { error: { code: string; details?: { path: string; issue: string }[] } };
const patch = (body: object) => apiJson<Refused>('PATCH', '/v1/settings', { token: D, body });
const line = (slot: string) =>
  apiJson<Refused>('PUT', `/v1/surfaces/home/${slot}`, {
    token: C,
    body: {
      kind: 'line',
      schema: 1,
      payload: { text: 'Rain after four.' },
      why: 'the forecast',
      topic_key: `lines.${slot}`,
    },
  });
const tile = (slot: string, label: string) =>
  apiJson('PUT', `/v1/surfaces/briefing/${slot}`, {
    token: C,
    body: { kind: 'tile', schema: 1, payload: { label, value: 'Ready' }, why: 'the plan', topic_key: `tiles.${slot}` },
  });
const names = async () =>
  (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: D })).body.tiles.map(
    (t) => tileName(t) ?? 'waiting',
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('the new keys', () => {
  it('are checked by their kind, and the phone ones are not the Worker’s', async () => {
    for (const [key, value] of [
      ['mind.home_lines', 5],
      ['mind.home_lines', '2'],
      ['briefing.tiles', ['weather']],
      ['briefing.tiles', ['podcasts']],
      ['briefing.tiles', ['waiting']],
      ['appearance.glyphs', 'outline'],
      ['chat.density', 'compact'],
      ['island.mode', 'bar'],
      ['gestures.ring_apps', ['music']],
    ] as const) {
      const r = await patch({ [key]: value });
      expect([r.status, r.body.error?.code], `${key} = ${JSON.stringify(value)}`).toEqual([422, 'validation']);
    }
    expect((await patch({ 'mind.home_lines': 0 })).status).toBe(200);
    expect((await patch({ 'mind.home_lines': 4 })).status).toBe(200);
    expect(settingSpec('mind.home_lines')).toMatchObject({ scope: 'worker', mind: true, default: 4 });
    for (const key of ['appearance.glyphs', 'chat.density', 'chat.mic', 'island.mode', 'gestures.ring_apps'])
      expect(settingSpec(key)?.scope, key).toBe('phone');
  });
});

describe('Lines on home', () => {
  it('refuses a line in a slot past the owner’s count, and every line at none', async () => {
    expect((await patch({ 'mind.home_lines': 2 })).status).toBe(200);
    expect((await line('line.2')).status).toBe(200);
    const past = await line('line.3');
    expect([past.status, past.body.error.code, past.body.error.details?.[0]?.path]).toEqual([
      422,
      'validation',
      'slot',
    ]);
    expect(past.body.error.details?.[0]?.issue).toContain('2 lines');
    expect((await patch({ 'mind.home_lines': 0 })).status).toBe(200);
    expect((await line('line.1')).status).toBe(422);
    expect((await patch({ 'mind.home_lines': 4 })).status).toBe(200);
    expect((await line('line.4')).status).toBe(200);
  });
});

describe('the owner’s Briefing tiles', () => {
  it('leave out the hidden ones and go in the owner’s order, after what waits', async () => {
    const at = Date.now() + 3 * 3_600_000;
    expect(
      (await apiJson('PUT', `/v1/reminders/${uuidv7()}`, { token: D, body: { text: 'Call back', at } })).status,
    ).toBe(201);
    expect((await tile('study', 'Study')).status).toBe(200);
    expect((await tile('built', 'Built')).status).toBe(200);
    expect((await tile('note.1', 'Note')).status).toBe(200);
    // Unset: the Worker's own order.
    expect(await names()).toEqual(['due', 'study', 'built', 'notes']);
    expect((await patch({ 'briefing.tiles': ['notes', 'due', 'built'] })).status).toBe(200);
    expect(await names()).toEqual(['notes', 'due', 'built']);
    expect((await patch({ 'briefing.tiles': [] })).status).toBe(200);
    expect(await names()).toEqual([]);
    expect((await patch({ 'briefing.tiles': settingSpec('briefing.tiles')?.default })).status).toBe(200);
    expect(await names()).toEqual(['due', 'study', 'built', 'notes']);
  });
});
