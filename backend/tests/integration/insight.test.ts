// P9: the meter (GET /v1/insight; EVALS.md §9), synthetic, in UTC: the owner's fixes and forgets and
// the facts the mind wrote by week (M-8), the newest memory checks (M-10), the mind's arrangements
// kept (a tile tapped, or the app a line names opened on its day or the next), undone or ignored
// (M-16), and the prediction skill per category (M-18); counts only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { InsightResponse } from '../../../shared/contract/predictions.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import { api, apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, principals } from '../memory-helpers';

let D = '';
let C = '';
const surface = (slot: string, body: object) =>
  apiJson<{ ledger_id: string }>('PUT', `/v1/surfaces/home/${slot}`, {
    ...as(C, CHAT_SESSION),
    body: {
      kind: 'line',
      schema: 1,
      payload: { text: 'Your new playlist is in Music.' },
      why: 'Built last night.',
      topic_key: 'built.night',
      ...body,
    },
  });

beforeAll(async () => {
  ({ D, C } = await principals());
  await api('PATCH', '/v1/settings', { token: D, body: { 'owner.tz': 'UTC' } });
});

describe('the meter', () => {
  it('counts corrections, memory checks, kept arrangements and skill', async () => {
    const now = Date.now();
    const ago = now - 3 * DAY;
    // M-8: one forget by the owner and one fact the mind wrote this week.
    await coreSql(
      `INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, op_json) VALUES (?, ?, 'owner', 'memory', 'forgot a fact', 'the owner forgot it', 0, 'done', ?)`,
      uuidv7(),
      now - DAY,
      JSON.stringify({ op: 'memory.forget', fact_id: 'f', kind: 'fact', forgotten_at: now, versions: 1 }),
    );
    await coreSql(
      `INSERT INTO facts (id, kind, about, text, source, confidence, evidence_json, recorded_at, last_confirmed, sensitivity, written_by, lineage_id)
       VALUES ('f1', 'preference', 'owner', 'Likes calm music', 'observed', 0.6, '[]', ?, ?, 0, 'mind:night', 'f1')`,
      now - DAY,
      now - DAY,
    );
    // M-10: a memory check.
    const run = uuidv7();
    expect(
      (
        await api('PUT', `/v1/evals/runs/${run}`, {
          ...as(C, CHAT_SESSION),
          body: { id: run, suite: 'MP', git_sha: 'abc1234', n: 40, passed: 35, failures: [] },
        })
      ).status,
    ).toBe(201);
    // M-16: a line naming Guitar, opened the next day (kept); a line nobody acted on (ignored); one new.
    const kept = (await surface('line.1', { ref: 'app:guitar' })).body.ledger_id;
    const left = (await surface('line.2', {})).body.ledger_id;
    await coreSql('UPDATE ledger SET at = ? WHERE id IN (?, ?)', ago, kept, left);
    await surface('line.3', {});
    const opened = ago + DAY;
    expect(
      (
        await api('PUT', `/v1/senses/batches/${uuidv7()}`, {
          token: D,
          body: { events: [{ id: uuidv7(opened), at: opened, type: 'guitar.open' }] },
        })
      ).status,
    ).toBe(200);

    const r = await apiJson<InsightResponse>('GET', '/v1/insight', { token: D });
    expect(r.status).toBe(200);
    expect(r.body.corrections).toHaveLength(4);
    expect(r.body.corrections[3]).toEqual({ fixed: 1, learned: 1 });
    expect(r.body.memory).toEqual([{ passed: 35, n: 40, at: expect.any(Number) }]);
    expect(r.body.arrangements).toEqual({ kept: 1, undone: 0, ignored: 1, waiting: 1 });
    expect(r.body.skill.map((s) => s.category)).toEqual([
      'chat.any',
      'chat.count',
      'chat.before',
      'decision.answered',
      'app.open',
    ]);
    expect((await api('GET', '/v1/insight', { token: C })).status).toBe(200);
  });
});
