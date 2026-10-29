// A closed day's input for the night shift (RUNTIME.md §12 step 1, API.md §11.8 `GET
// /v1/mind/day/:day`): deterministic counts with when the day was open, then its messages, ledger
// rows and session notes as pages, oldest first, after a cursor tied to its day and part; only
// the night key reads it, and only for a day that has closed.
import { beforeAll, describe, expect, it } from 'vitest';
import type { DayStats, ErrorBody, Page, TodayResponse } from '../../../shared/contract/api';
import { encodeCursor } from '../../src/lib/cursor';
import { dayBefore, HOUR } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let today = '';

beforeAll(async () => {
  p = await principals();
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
});

describe("a closed day's input", () => {
  const D3 = () => dayBefore(today, 3);
  const at = (h: number) => Date.parse(`${D3()}T00:00:00Z`) + h * HOUR;
  const get = <T>(query: string, token = p.N) =>
    apiJson<T & ErrorBody>('GET', `/v1/mind/day/${D3()}?${query}`, { token });

  beforeAll(async () => {
    // A day three days back, filed at the next morning's roll: five messages, three ledger rows
    // and two session notes inside it, and one of each outside it.
    await coreSql(
      `INSERT INTO threads (id, day, kind, status, started_at, filed_at, updated_at) VALUES ('t-d3', ?, 'daily', 'filed', ?, ?, ?)`,
      D3(),
      at(5),
      at(28),
      at(28),
    );
    const authors = ['owner', 'mind', 'owner', 'mind', 'owner'];
    for (const [i, author] of authors.entries())
      await coreSql(
        `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body) VALUES (?, 't-d3', ?, ?, ?, 'text', ?)`,
        `m-d3-${i}`,
        at(6 + i),
        author,
        author === 'owner' ? 'owner_device' : 'mind',
        `message ${i}`,
      );
    for (const [i, h] of [6, 7, 7, 30].entries())
      await coreSql(
        `INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, tainted) VALUES (?, ?, 'mind:chat', 'note', ?, 'synthetic', 0, 'done', 0)`,
        `l-d3-${i}`,
        at(h),
        `ledger ${i}`,
      );
    for (const [i, h] of [8, 9, 3].entries())
      await coreSql(
        `INSERT INTO session_notes (id, session_id, wake_id, role, thread_id, created_at, body, open_items_json) VALUES (?, 's', NULL, 'chat', 't-d3', ?, ?, '[]')`,
        `n-d3-${i}`,
        at(h),
        `note ${i}`,
      );
  });

  it('the counts are deterministic and say when the day was open', async () => {
    const s = await get<DayStats>('part=stats');
    expect(s.status).toBe(200);
    expect(s.body).toEqual({
      day: D3(),
      from: Date.parse(`${D3()}T04:00:00Z`),
      to: at(28),
      messages: 5,
      owner: 3,
      mind: 2,
      system: 0,
      muse: 0,
      ledger: 3,
      notes: 2,
    });
  });

  it('each part comes oldest first in pages after a cursor, and only its own rows', async () => {
    const pages = async (part: string, limit: number) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const r: { status: number; body: Page<{ id: string }> } = await get<Page<{ id: string }>>(
          `part=${part}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(r.status).toBe(200);
        expect(r.body.items.length).toBeLessThanOrEqual(limit);
        ids.push(...r.body.items.map((x) => x.id));
        cursor = r.body.next;
        if (!cursor) return ids;
      }
      throw new Error('no end');
    };
    expect(await pages('messages', 2)).toEqual(['m-d3-0', 'm-d3-1', 'm-d3-2', 'm-d3-3', 'm-d3-4']);
    expect(await pages('ledger', 2)).toEqual(['l-d3-0', 'l-d3-1', 'l-d3-2']);
    expect(await pages('notes', 1)).toEqual(['n-d3-0', 'n-d3-1']);
    const notes = await get<Page<{ body: string; open_items: unknown[]; role: string }>>('part=notes');
    expect(notes.body.items[0]).toMatchObject({ body: 'note 0', open_items: [], role: 'chat' });
  });

  it('refuses a cursor of another day or part, a forged one, an open day, and every key but the night one', async () => {
    const first = await get<Page<unknown>>('part=messages&limit=2');
    expect((await get(`part=ledger&cursor=${first.body.next}`)).status).toBe(400);
    const other = await apiJson('GET', `/v1/mind/day/${dayBefore(today, 4)}?part=messages&cursor=${first.body.next}`, {
      token: p.N,
    });
    expect(other.status).toBe(400);
    const forged = encodeCursor(`day:${D3()}:messages`, ['1 OR 1=1']);
    expect((await get(`part=messages&cursor=${forged}`)).status).toBe(400);
    expect((await get(`part=stats&cursor=${encodeCursor(`day:${D3()}:stats`, [1])}`)).status).toBe(400);
    expect((await get('part=everything')).status).toBe(422);
    expect((await apiJson('GET', `/v1/mind/day/${today}?part=stats`, { token: p.N })).status).toBe(422);
    expect((await apiJson('GET', '/v1/mind/day/yesterday?part=stats', { token: p.N })).status).toBe(422);
    expect((await get('part=stats', p.C)).status).toBe(403);
    expect((await get('part=stats', p.D)).status).toBe(403);
  });
});
