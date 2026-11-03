// The layered briefing end to end (MEMORY.md §9, plan step A3): what POST /v1/mind/brief reads for
// section 1's today state and section 7's day, through Core and the Senses object: the weather the
// Briefing keeps, a reminder due today, the song playing, the day's arrangement and how the owner met
// it (its tile tapped: kept), an open prediction, the Briefing's tiles. Synthetic, in UTC.
import { beforeAll, describe, expect, it } from 'vitest';
import { logicalDay } from '../../src/areas/conversation/day';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, HOUR } from '../../src/lib/time';
import { api, apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, principals } from '../memory-helpers';

let D = '';
let C = '';
let N = '';
const TRACK = `music:r2_native_${'b'.repeat(64)}`;
const section = (core: string, n: number) => {
  const end = core.indexOf(`\n## ${n + 1}. `);
  return core.slice(core.indexOf(`## ${n}. `), end < 0 ? undefined : end);
};
const senses = (events: object[]) => api('PUT', `/v1/senses/batches/${uuidv7()}`, { token: D, body: { events } });

beforeAll(async () => {
  ({ D, C, N } = await principals());
  await api('PATCH', '/v1/settings', { token: D, body: { 'owner.tz': 'UTC' } });
});

describe('the briefing reads the day', () => {
  it('section 1: the weather kept, what is due today, the song playing; nothing when none', async () => {
    const quiet = (await brief(C, CHAT_SESSION, 'chat')).body.core;
    for (const t of ['weather:', 'due ', 'music:']) expect(section(quiet, 1)).not.toContain(t);

    const now = Date.now();
    const midnight = Math.floor(now / DAY) * DAY;
    const forecast = {
      at: now - HOUR,
      current: 11.2,
      hours: Array.from({ length: 24 }, (_, i) => ({ at: now - HOUR + i * HOUR, temp: 11, rain: 0, code: 1 })),
      days: [
        { at: midnight, high: 13, low: 4 },
        { at: midnight + DAY, high: 12, low: 6 },
      ],
    };
    for (const [key, value] of [
      ['weather.place', { name: 'Testville', lat: 1.1, lon: 2.2 }],
      ['weather.forecast', forecast],
    ] as const)
      await coreSql(
        `INSERT INTO settings (key, value_json, updated_at, actor) VALUES (?, ?, ?, 'test')
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
        key,
        JSON.stringify(value),
        now,
      );
    // A reminder before the end of the owner's day (inserted, so quiet hours can't move it).
    await coreSql(
      `INSERT INTO reminders (id, text, at, fire_at, state, origin, created_at, req_sha256)
       VALUES (?, 'Call the plumber', ?, ?, 'set', 'device', ?, 'x')`,
      uuidv7(),
      now,
      Math.min(now + 30 * 60_000, midnight + DAY - 1),
      now,
    );
    expect(
      (
        await senses([
          {
            id: uuidv7(now - 120_000),
            at: now - 120_000,
            type: 'music.play',
            ref: TRACK,
            data: { source: 'list', offline: false },
          },
        ])
      ).status,
    ).toBe(200);

    const one = section((await brief(C, CHAT_SESSION, 'chat')).body.core, 1);
    expect(one).toMatch(/^weather: 11°, Dry (for the rest of the day|tonight)\. Tomorrow 6° to 12°\.$/m);
    expect(one).toMatch(/^due \d\d:\d\d: "Call the plumber"$/m);
    expect(one).toMatch(
      /^music: a song started at \d\d:\d\d \(2 min ago\), not skipped or finished since \(th music now\)$/m,
    );
    expect(one).not.toContain('Testville');

    await senses([
      {
        id: uuidv7(),
        at: Date.now() - 1_000,
        type: 'music.skip',
        ref: TRACK,
        data: { at_ms: 9_000, duration_ms: 200_000, by: 'next' },
      },
    ]);
    expect(section((await brief(C, CHAT_SESSION, 'chat')).body.core, 1)).toMatch(
      /^music: the last song was skipped at \d\d:\d\d$/m,
    );
  });

  it('section 7: the day’s arrangement as the owner met it, the open prediction, the Briefing’s tiles', async () => {
    const put = await apiJson<{ ledger_id: string }>('PUT', '/v1/surfaces/briefing/note.1', {
      ...as(C, CHAT_SESSION),
      body: {
        kind: 'tile',
        schema: 1,
        payload: { label: 'Note', value: 'Choir at six' },
        why: 'The calendar has choir tonight.',
        topic_key: 'note.choir',
      },
    });
    expect(put.status).toBe(200);
    const today = logicalDay(Date.now(), 'UTC');
    expect(
      (
        await api('PUT', `/v1/predictions/${uuidv7()}`, {
          token: N,
          body: {
            category: 'app.open',
            args: { app: 'guitar' },
            day: today,
            p: 0.7,
            why: 'Practised four days running.',
          },
        })
      ).status,
    ).toBe(200);
    const before = section((await brief(C, CHAT_SESSION, 'chat')).body.core, 7);
    expect(before).toMatch(/^\d\d:\d\d briefing\/note\.1 ← tile · no answer yet: The calendar has choir tonight\.$/m);
    expect(before).toContain(`Predicted for ${today}:\napp.open app=guitar · 70%: Practised four days running.`);
    expect(before).toMatch(/^The Briefing shows:\n(.+\n)*Note: Choir at six/m);

    await senses([
      { id: uuidv7(), at: Date.now() - 1_000, type: 'briefing.tile', ref: `ledger:${put.body.ledger_id}` },
    ]);
    const after = section((await brief(C, CHAT_SESSION, 'chat')).body.core, 7);
    expect(after).toMatch(/^\d\d:\d\d briefing\/note\.1 ← tile · kept: The calendar has choir tonight\.$/m);
    // The night's briefing reads the day before the open one: nothing of today's.
    expect(section((await brief(N, 'cse_memory_night_1', 'night')).body.core, 7)).not.toContain('note.1');
  });
});
