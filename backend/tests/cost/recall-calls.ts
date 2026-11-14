// Recall by meaning in the cost suite (cost.test.ts checks every budget), with the fake AI binding
// (recall-helpers.ts): one index batch (100 new messages, one step of `search.embed`: Core reads
// them and moves its place, the Library writes their vectors), measured in each object, then a
// search whose recall reads the 200 vectors and checks its candidates in Core. Synthetic text.
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Message, SignedIn } from '../../../shared/contract/api';
import { embedJob, placeOf } from '../../src/areas/search/embed-job';
import { putSetting } from '../../src/areas/settings/store';
import { uuidv7 } from '../../src/lib/ids';
import type { Db } from '../../src/objects/base';
import type { Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, PASSWORD } from '../helpers';
import { fakeAi, searchWith } from '../recall-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;
type Host = { db: Db; write<T>(fn: (w: Writer) => T, at?: number): T };

const inCore = <T>(fn: (c: Host) => T | Promise<T>) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => fn(o as unknown as Host));

/** 100 new owner messages in `thread`, with their FTS rows, as the writer keeps them. */
async function batch(thread: string, n: number): Promise<void> {
  await coreSql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
     INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
     SELECT printf('recall-%d-%03d', ?, i), ?, ?, 'owner', 'owner_device', 'text', printf('a synthetic line about the garden, %d', i) FROM n`,
    n,
    thread,
    Date.now(),
  );
  await coreSql(
    "INSERT INTO messages_fts (rowid, body) SELECT seq, body FROM messages WHERE id LIKE printf('recall-%d-%%', ?)",
    n,
  );
}

async function step(e: Env): Promise<Response> {
  await inCore(async (c) => {
    const cursor = { phase: 'messages', texts: 0 };
    const input = await embedJob.load(e, c.db, {}, cursor);
    c.write((w) => embedJob.step(w, {}, cursor, input));
  });
  return new Response(null, { status: 204 });
}

/** Rings Core's alarm while one is due within five seconds. The calls before these leave some (the listening
 * history's import, a message just written), and on a slow machine one rang while a call below was being
 * measured: its reading was counted as the call's (CI, 2026-11-14: a search read 113 rows where every other
 * run reads 95). Rung first, what is measured is the call alone. */
async function quiet(): Promise<void> {
  const stub = core() as unknown as DurableObjectStub<Core>;
  for (let i = 0; i < 5; i++) {
    const due = await runInDurableObject(stub, async (_o: Core, state) => {
      const at = await state.storage.getAlarm();
      return at !== null && at - Date.now() < 5000;
    });
    if (!due || !(await runDurableObjectAlarm(stub))) return;
  }
}

export async function recallCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.245', `${PASSWORD} new`);
  const ai = fakeAi();
  const library = env.LIBRARY.get(env.LIBRARY.idFromName('owner')) as unknown as never;
  // Today's thread (the held calls before leave others off the record or deleted).
  const said = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: d.token, body: { body: 'a line' } });
  // The place starts at the newest message, so each step embeds exactly the 100 written before it.
  const [{ top }] = await coreSql<{ top: number }>('SELECT max(seq) AS top FROM messages');
  await inCore((c) =>
    c.write((w) => putSetting(w.db, 'recall.index', { ...placeOf(w.db), messages: top }, 'worker', w.at)),
  );
  await batch(said.body.thread_id, 1);
  await quiet();
  await cost('search.embed step, 100 messages (Library)', () => step(ai.env), 204, library);
  await batch(said.body.thread_id, 2);
  await quiet();
  await cost('search.embed step, 100 messages (Core)', () => step(ai.env), 204, core() as never);
  const search = () =>
    searchWith(ai.env, d.token, 'q=planting%20tomatoes').then((r) => new Response(null, { status: r.status }));
  await quiet();
  await cost('GET /v1/search (by meaning, 200 vectors) (Library)', search, 200, library);
  await quiet();
  await cost('GET /v1/search (by meaning, 200 vectors) (Core)', search, 200, core() as never);
}
