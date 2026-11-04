// The night's one line (MEMORY.md §3.1, memory/day-voice.ts): a clean night session puts it on a day
// note it wrote (PUT /v1/memory/day-notes/:day/voice), at most 200 characters through the phrase
// lint; it is served with the note (the Memory page, under the day), found by search (`th
// recall`), and refused from the chat, from a session that read outside text, and with no day
// note. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { DayNote, SearchResponse } from '../../../shared/contract/api';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, NIGHT_SESSION, type Principals, principals } from '../memory-helpers';

let P: Principals;
const night = () => as(P.N, NIGHT_SESSION);
const today = () => new Date().toISOString().slice(0, 10);
const day = () => dayBefore(today());
const voice = (call: object, line: string, d = day()) =>
  apiJson<{ day: string; voice: string; error?: { code: string } }>('PUT', `/v1/memory/day-notes/${d}/voice`, {
    ...call,
    body: { line },
  });

beforeAll(async () => {
  P = await principals();
  await apiJson('PATCH', '/v1/settings', { token: P.D, body: { 'owner.tz': 'UTC' } });
  const r = await apiJson<DayNote>('PUT', `/v1/memory/day-notes/${day()}`, {
    ...night(),
    body: { summary: 'A short practice day.', decisions: [], importance: 3 },
  });
  expect(r.status).toBe(200);
});

describe("the night's one line", () => {
  it('needs a day note, takes ≤ 200 characters through the phrase lint, and only the night', async () => {
    expect((await voice(night(), 'The house was quiet.', '2020-01-01')).status).toBe(404);
    expect((await voice(night(), 'x'.repeat(201))).status).toBe(422);
    expect((await voice(night(), 'Great question, the day.')).status).toBe(422);
    expect((await voice(as(P.C, CHAT_SESSION), 'The house was quiet.')).status).toBe(403);
  });

  it('is kept with the note, served with it, and found by search', async () => {
    const r = await voice(night(), 'The metronome waited all evening; the lantern tune came back twice.');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      day: day(),
      voice: 'The metronome waited all evening; the lantern tune came back twice.',
    });
    const list = await apiJson<{ items: DayNote[] }>('GET', `/v1/memory/day-notes?from=${day()}&to=${day()}`, {
      token: P.D,
    });
    expect(list.body.items[0]).toMatchObject({ summary: 'A short practice day.', voice: r.body.voice });
    const hit = await apiJson<SearchResponse>('GET', '/v1/search?q=lantern', { token: P.D });
    expect(hit.body.items.find((h) => h.source === 'day_notes')?.ref).toBe(`day:${day()}`);
    // A second line replaces the first, in the note and in the index.
    expect((await voice(night(), 'A calm evening; nothing broke.')).status).toBe(200);
    expect((await apiJson<SearchResponse>('GET', '/v1/search?q=lantern', { token: P.D })).body.items).toEqual([]);
    // The owner's edit of the summary keeps the night's line, and the index follows both.
    await apiJson('PUT', `/v1/memory/day-notes/${day()}`, {
      token: P.D,
      body: { summary: 'Practice, then the choir.', decisions: [], importance: 3 },
    });
    const [row] = await coreSql<{ voice: string; summary: string }>(
      'SELECT voice, summary FROM day_notes WHERE day = ?',
      day(),
    );
    expect(row).toEqual({ voice: 'A calm evening; nothing broke.', summary: 'Practice, then the choir.' });
    expect((await apiJson<SearchResponse>('GET', '/v1/search?q=evening', { token: P.D })).body.items.length).toBe(1);
  });

  it('is refused from a night session that read outside text', async () => {
    await apiJson('POST', '/v1/mind/taint', { ...night(), body: { source: 'WebFetch', ref_kind: 'url' } });
    const r = await voice(night(), 'The house was quiet.');
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('session_tainted');
  });
});
