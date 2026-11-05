// The settings second pass (MENU-AND-SETTINGS.md §6.6, §6.7; DATA.md §10): Keep conversations purges
// the conversations past its window the way a deleted one is purged, once a logical day, keeping one
// filed under a topic; the mind's name is the owner's alone, phrase-linted, and the briefing says it
// in one line; the owner's hours set the briefing's day or evening. Invented days and words only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/contract/api';
import { ownerOnly } from '../../src/areas/settings/mind-set';
import { uuidv7 } from '../../src/lib/ids';
import { DAY_MS, threadRow, tick } from '../held-helpers';
import { api, apiJson, coreSql } from '../helpers';
import { brief, freshSession, type Principals, principals } from '../memory-helpers';

let p: Principals;
type Refused = { error?: { code: string; details?: { path: string; issue: string }[] } };
const patch = (body: object) => apiJson<Refused>('PATCH', '/v1/settings', { token: p.D, body });
// The logical day ends at 04:00 owner-local (UTC here; conversation/day.ts). The "same day" ticks
// below go up to 30 minutes past T0, so a T0 taken in the last hour before 04:00 would cross into
// the next day: then T0 moves one hour back, which keeps every tick's day as the test expects.
const T0 = (() => {
  const now = Date.now();
  const sinceRoll = (now - 4 * 3_600_000) % DAY_MS;
  return sinceRoll > DAY_MS - 3_600_000 ? now - 3_600_000 : now;
})();

/** A day's conversation of `n` messages, then aged: last changed `ago` days before T0. */
async function oldDay(ago: number, n = 2, topic: string | null = null): Promise<string> {
  let id = '';
  for (let i = 0; i < n; i++)
    id = (await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: p.D, body: { body: `kept word ${i}` } }))
      .body.thread_id;
  const day = new Date(T0 - ago * DAY_MS).toISOString().slice(0, 10);
  await coreSql(
    "UPDATE threads SET day = ?, status = 'filed', updated_at = ?, topic = ? WHERE id = ?",
    day,
    T0 - ago * DAY_MS,
    topic,
    id,
  );
  return id;
}
const messagesOf = async (id: string) =>
  (await coreSql<{ n: number }>('SELECT count(*) AS n FROM messages WHERE thread_id = ?', id))[0]?.n;
const newDay = () => coreSql("DELETE FROM settings WHERE key = 'prune.day'");

beforeAll(async () => {
  p = await principals();
});

describe('Keep conversations (privacy.retention)', () => {
  let old = '';
  let older = '';
  let filed = '';
  let recent = '';
  it('Forever, the default, keeps every conversation however old', async () => {
    old = await oldDay(100);
    older = await oldDay(400, 3);
    filed = await oldDay(500, 1, 'Garden plans');
    recent = await oldDay(40);
    await newDay();
    await tick(T0);
    for (const id of [old, older, filed, recent]) expect((await threadRow(id))?.purge_at, id).toBeNull();
  });

  it('takes only the three choices, and is the owner’s alone', async () => {
    expect((await patch({ 'privacy.retention': '30d' })).status).toBe(422);
    expect(ownerOnly('privacy.retention')).toBe(true);
  });

  it('90 days: the daily pass marks the days past it (gone at once); the next tick purges them', async () => {
    expect((await patch({ 'privacy.retention': '90d' })).status).toBe(200);
    await newDay();
    await tick(T0);
    expect((await threadRow(old))?.purge_at).toBe(T0);
    expect((await threadRow(older))?.purge_at).toBe(T0);
    expect((await api('GET', `/v1/threads/${old}`, { token: p.D })).status).toBe(404);
    // Filed under a topic, or inside the window: kept.
    expect((await threadRow(filed))?.purge_at).toBeNull();
    expect((await threadRow(recent))?.purge_at).toBeNull();
    await tick(T0 + 15 * 60_000);
    for (const id of [old, older]) {
      expect(await threadRow(id)).toBeUndefined();
      expect(await messagesOf(id)).toBe(0);
    }
    const notes = await coreSql<{ what: string; why: string }>(
      "SELECT what, why FROM ledger WHERE ref = ? AND actor = 'worker'",
      `thread:${old}`,
    );
    expect(notes).toEqual([
      { what: 'purged an old conversation', why: 'past Keep conversations in Settings › Privacy and data' },
    ]);
    expect(await messagesOf(filed)).toBe(1);
    expect(await messagesOf(recent)).toBe(2);
  });

  it('runs once a logical day: a day that ages past the window waits for the next day', async () => {
    await coreSql('UPDATE threads SET updated_at = ? WHERE id = ?', T0 - 95 * DAY_MS, recent);
    await tick(T0 + 30 * 60_000);
    expect((await threadRow(recent))?.purge_at).toBeNull();
    await tick(T0 + DAY_MS);
    expect((await threadRow(recent))?.purge_at).toBe(T0 + DAY_MS);
  });

  it('1 year keeps what 90 days would not', async () => {
    const mid = await oldDay(200);
    expect((await patch({ 'privacy.retention': '1y' })).status).toBe(200);
    await newDay();
    await tick(T0 + DAY_MS + 60_000);
    expect((await threadRow(mid))?.purge_at).toBeNull();
    expect((await patch({ 'privacy.retention': 'forever' })).status).toBe(200);
  });
});

describe("the mind's name", () => {
  it('takes up to 20 characters the phrase lint passes, from the owner only', async () => {
    for (const name of ['Great question', 'Wren 🌱', 'A name far past twenty letters', 'Two\nlines'] as const) {
      const r = await patch({ 'mind.name': name });
      expect([r.status, r.body.error?.code], name).toEqual([422, 'validation']);
    }
    expect((await patch({ 'mind.name': 'Great question' })).body.error?.details?.[0]?.issue).toContain('banned phrase');
    expect(ownerOnly('mind.name')).toBe(true);
    expect((await patch({ 'mind.name': 'Wren' })).status).toBe(200);
  });

  it("is in the briefing in one line, and section 1's now says the owner's day or evening by their hours", async () => {
    expect((await patch({ 'mind.day_start': '06:00', 'mind.night_start': '23:00' })).status).toBe(200);
    expect((await patch({ 'mind.night_start': '02:00' })).status).toBe(422);
    const s = await freshSession(p.C, 'chat', 'cse_settings_second_1');
    const { core, full } = (await brief(p.C, s, 'chat')).body;
    const first = core.slice(0, core.indexOf('\n## 2. '));
    expect(first.split('\n').filter((l) => l.includes('Wren'))).toEqual([
      'Name: the owner calls you Wren; answer to it, and still call yourself "I".',
    ]);
    expect(first).toMatch(/, the owner's (day \(evening from 23:00\)|evening \(day from 06:00\)) · day /);
    // Section 13, in the full file: the name with no detail (the mind does not change it).
    expect(full).toContain('mind.name: Wren\n');
    expect(full).toContain('mind.day_start: 06:00 — From this hour Auto shows the day theme');
  });
});
