// P4 stages G–H: the Board (MUSE.md §6, §8, BRIEFING.md §5). The owner's brief raises one
// standing-approval card; until it is approved Muse can't read the brief; once it is, the tick
// makes the day's `board.edition` order, due 09:00 local, and its valid edition (dated for its
// day) becomes the Briefing page's Board tile and the reader's edition, marked as Muse's.
// Withdrawing the approval closes the brief again. Muse's own thread, and `muse.silent` after 26
// hours without a call.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import type { Proposal } from '../../../shared/contract/proposals.ts';
import type { WatchdogsResponse } from '../../../shared/contract/watchdogs.ts';
import type { WorkOrder } from '../../../shared/contract/work.ts';
import { briefing } from '../../src/areas/briefing/assemble';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let M = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));

/** A synthetic Board edition for `day` (shape only). */
const edition = (day: string) => ({
  schema: 'jarvis-daily-board-v2',
  id: '0192f0c4-0000-4000-8000-0000000000b1',
  date: day,
  title: 'Rain moves in, the market steadies',
  summary: 'Two stories: the weather turns and prices hold.',
  edition: { theme: 'tide', thesis: 'A slower week.' },
  stories: [
    {
      id: 'rain',
      title: 'Rain moves in after a dry month',
      label: 'Weather · forecast issued today',
      composition: 'lead',
      claim: 'forecast',
      dek: 'Three wet days start tomorrow.',
      whyItMatters: 'Outdoor plans shift to the weekend.',
      sources: [
        { title: 'Forecast', url: 'https://example.com/forecast', publisher: 'Example Weather', type: 'official' },
      ],
      blocks: [
        { id: 'b1', type: 'prose', text: 'A front arrives from the west.', cites: [0] },
        { id: 'b2', type: 'stats', items: [{ label: 'Rain', value: '42 mm', asOf: 'today' }] },
      ],
    },
    {
      id: 'prices',
      title: 'Prices hold for a second month',
      composition: 'brief',
      dek: 'The monthly figure is flat.',
      sources: [{ title: 'Statistics office', url: 'https://example.com/stats' }],
    },
  ],
});

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
  await api('GET', '/v1/work/hello', { token: M });
});

describe('the Board', () => {
  const BRIEF = {
    focus: 'What matters this week, briefly.',
    interests: [{ topic: 'Weather', priority: 'high' }],
    depth: 'headlines',
    stories: { min: 2, max: 5 },
    lookbackHours: 36,
  };
  it('a brief raises one standing-approval card; Muse reads the brief only once it is approved', async () => {
    expect((await apiJson('PUT', '/v1/board/brief', { token: p.D, body: { version: 0, brief: BRIEF } })).body).toEqual({
      version: 1,
    });
    expect((await api('PUT', '/v1/board/brief', { token: p.D, body: { version: 0, brief: BRIEF } })).status).toBe(409);
    const cards = (await apiJson<{ items: Proposal[] }>('GET', '/v1/proposals', { token: p.D })).body.items.filter(
      (c) => c.spec.op === 'board.allow',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      class: 'reach_people',
      question: 'Let Muse read your Board brief?',
      status: 'waiting',
    });
    expect((await api('GET', '/v1/work/board/brief', { token: M })).status).toBe(409);
    await apiJson('PUT', '/v1/board/brief', {
      token: p.D,
      body: { version: 1, brief: { ...BRIEF, depth: 'standard' } },
    });
    expect(
      (await apiJson<{ items: Proposal[] }>('GET', '/v1/proposals', { token: p.D })).body.items.filter(
        (c) => c.spec.op === 'board.allow',
      ),
    ).toHaveLength(1);
    expect(
      (
        await api('POST', `/v1/proposals/${cards[0].id}/decide`, {
          token: p.D,
          body: { decision: 'approve', spec_hash: cards[0].spec_hash },
        })
      ).status,
    ).toBe(200);
    const b = await apiJson<{ version: number; brief: { depth: string } }>('GET', '/v1/work/board/brief', { token: M });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ version: 2, brief: { depth: 'standard' } });
  });

  it("the tick makes the day's order, due 09:00; its valid edition is the Briefing's Board and the reader's", async () => {
    const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 10);
    await watch(Date.parse(`${tomorrow}T06:00:00Z`)); // the test owner's zone is UTC
    await watch(Date.parse(`${tomorrow}T06:15:00Z`));
    const [o] = await coreSql<{ id: string; day: string; deadline_at: number; status: string }>(
      "SELECT id, day, deadline_at, status FROM work_orders WHERE kind = 'board.edition'",
    );
    expect(o).toMatchObject({ day: tomorrow, deadline_at: Date.parse(`${tomorrow}T09:00:00Z`), status: 'queued' });
    expect((await apiJson<{ order: WorkOrder }>('POST', '/v1/work/claim', { token: M, body: {} })).body.order.id).toBe(
      o.id,
    );
    const wrongDay = await apiJson<{ error: { details: { issue: string }[] } }>(
      'PUT',
      `/v1/work/orders/${o.id}/result`,
      { token: M, body: { result: edition('2020-01-01') } },
    );
    expect(wrongDay.body.error.details[0].issue).toBe(`date: must be ${tomorrow}, the day this edition is for`);
    // Rejected: the mind makes it again as a new order (here, straight in SQL), and Muse delivers.
    await coreSql(
      "UPDATE work_orders SET status = 'claimed', result_valid = NULL, result_errors_json = NULL WHERE id = ?",
      o.id,
    );
    expect(
      (await api('PUT', `/v1/work/orders/${o.id}/result`, { token: M, body: { result: edition(tomorrow) } })).status,
    ).toBe(200);
    const page = await runInDurableObject(stub(), (obj) =>
      briefing((obj as unknown as { db: never }).db, {
        now: Date.parse(`${tomorrow}T10:00:00Z`),
        tz: 'UTC',
        day: tomorrow,
        yesterday: '2000-01-01',
      }),
    );
    expect(page.board).toMatchObject({
      day: tomorrow,
      title: 'Rain moves in, the market steadies',
      stories: 2,
      stale: false,
    });
    expect(page.board?.detail).toMatch(/^2 stories · \d+ min read$/);
    expect(page.title).toBe("Here's your day.");
    const later = await runInDurableObject(stub(), (obj) =>
      briefing((obj as unknown as { db: never }).db, {
        now: Date.parse(`${tomorrow}T10:00:00Z`),
        tz: 'UTC',
        day: '2099-01-02',
        yesterday: tomorrow,
      }),
    );
    expect(later.board).toMatchObject({ stale: true });
    expect(later.board?.detail).toMatch(/^Yesterday's edition · 2 stories/);
    const r = await apiJson<{ day: string; edition: { title: string }; origin: string }>(
      'GET',
      `/v1/board/editions/${tomorrow}`,
      { token: p.D },
    );
    expect(r.body).toMatchObject({
      day: tomorrow,
      origin: 'muse',
      edition: { title: 'Rain moves in, the market steadies' },
    });
    expect((await api('GET', `/v1/board/editions/${tomorrow}`, { token: M })).status).toBe(403);
  });

  it('the page answers to the owner; withdrawing the approval closes the brief to Muse', async () => {
    const page = await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ muse: 'Muse is connected to the new Worker.' });
    expect((await api('GET', '/v1/briefing', { token: p.C })).status).toBe(403);
    expect((await apiJson('DELETE', '/v1/board/approval', { token: p.D })).body).toEqual({ allowed: false });
    expect((await api('GET', '/v1/work/board/brief', { token: M })).status).toBe(409);
  });
});

describe("Muse's thread and silence", () => {
  it('notes go to its own thread, which the owner and the mind can read', async () => {
    const id = uuidv7();
    expect(
      (
        await api('POST', '/v1/work/thread/messages', {
          token: M,
          body: { id, body: 'The feed for the weather moved.' },
        })
      ).status,
    ).toBe(201);
    const t = await apiJson<{ items: { author: string; body: string }[] }>('GET', '/v1/work/thread', { token: p.D });
    expect(t.body.items.at(-1)).toMatchObject({ author: 'muse', body: 'The feed for the weather moved.' });
    expect(
      (await api('POST', '/v1/work/thread/messages', { token: M, body: { id, body: 'Something else' } })).status,
    ).toBe(409);
  });

  it('muse.silent trips after 26 hours without a call', async () => {
    await coreSql(
      "UPDATE settings SET value_json = json_set(value_json, '$.last', ?) WHERE key = 'muse.seen'",
      Date.now() - 27 * HOUR,
    );
    await watch();
    const items = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: p.D })).body.items;
    expect(items.find((i) => i.name === 'muse.silent')).toMatchObject({ state: 'tripped' });
    expect((await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D })).body.muse).toBe(
      "Muse hasn't checked in since yesterday.",
    );
  });
});
