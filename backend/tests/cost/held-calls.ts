// The held conversations' calls of the cost suite (cost.test.ts checks every budget): starting one
// off the record and a message in it (no FTS entry), Delete and Restore of a day's thread of 20
// messages, Recently deleted, and the cron's tick purging, as it does when a purge is due: a
// deleted day of 20 messages (FTS entries, an `optimize`, the evidence scan), and one full step of
// 500 messages off the record.
import { runInDurableObject } from 'cloudflare:test';
import type { Message, SignedIn, Thread } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function heldCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.240', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const k = core();
  const stub = k as unknown as DurableObjectStub<Core>;
  const tick = () =>
    runInDurableObject(stub, async (o: Core) => {
      await o.tick();
      return new Response(null, { status: 204 });
    });

  const id = uuidv7();
  await cost('PUT /v1/threads/:id/off-record (Core)', () => api('PUT', `/v1/threads/${id}/off-record`, d), 201, k);
  await cost(
    'PUT /v1/messages/:id (owner, off the record) (Core)',
    () => api('PUT', `/v1/messages/${uuidv7()}`, { ...d, body: { body: 'between us', thread_id: id } }),
    201,
    k,
  );

  // A day's thread of 20 messages, filed, so Delete and Restore act on a whole day.
  let day = '';
  for (let i = 0; i < 20; i++)
    day = (await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { ...d, body: { body: `held cost ${i}` } })).body
      .thread_id;
  await coreSql("UPDATE threads SET day = '2026-09-15', status = 'filed' WHERE id = ?", day);
  await cost('DELETE /v1/threads/:id (20 messages) (Core)', () => api('DELETE', `/v1/threads/${day}`, d), 200, k);
  await cost('GET /v1/threads/deleted (1) (Core)', () => api('GET', '/v1/threads/deleted', d), 200, k);
  await cost('POST /v1/threads/:id/restore (Core)', () => api('POST', `/v1/threads/${day}/restore`, d), 200, k);

  // Due now: the deleted day (its 30 days run out) and, alone, a step of 500 messages off the record.
  await api('DELETE', `/v1/threads/${day}`, d);
  await coreSql('UPDATE threads SET purge_at = ? WHERE id = ?', Date.now() - 1, day);
  await cost('cron tick, purging a deleted day of 20 messages (Core)', tick, 204, k);
  const big = (await apiJson<Thread>('PUT', `/v1/threads/${uuidv7()}/off-record`, d)).body.id;
  await coreSql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
     INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
     SELECT printf('held-cost-%04d', i), ?, 1, 'owner', 'owner_device', 'text', 'filler' FROM n`,
    big,
  );
  await coreSql('UPDATE threads SET purge_at = ? WHERE id = ?', Date.now() - 1, big);
  await cost('cron tick, purging 500 messages off the record (Core)', tick, 204, k);
}
