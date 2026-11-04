// Recall by meaning (MEMORY.md §10.6): the indexer (search/embed-job.ts, a lane job of Core's) and
// the recall fused into GET /v1/search (search/semantic.ts). The indexer keeps its place per source
// (a second run embeds only what is new), sends at most 100 texts a call and 1,000 a run, passes
// over system lines, held conversations, superseded facts and pages of books not ready, and its
// sweep drops rows gone from their source. The recall is fused with FTS by rank, serves only rows
// that still stand, labels and keeps back as search does, and fails open. The AI binding is a
// fake (recall-helpers.ts); every word is invented.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SearchResponse } from '../../../shared/contract/api';
import { EMBED_MODEL } from '../../src/areas/search/embed';
import { uuidv7 } from '../../src/lib/ids';
import { offRecord } from '../held-helpers';
import { coreSql } from '../helpers';
import { addOp, as, brief, CHAT_SESSION, ops, ownerSays, type Principals, principals } from '../memory-helpers';
import { fakeAi, runIndexer, searchWith } from '../recall-helpers';

let P = {} as Principals;
const ids: Record<string, string> = {};
const library = () => env.LIBRARY.get(env.LIBRARY.idFromName('owner'));
const libSql = <T>(q: string, ...b: unknown[]) =>
  runInDurableObject(library(), (_o, s) => s.storage.sql.exec(q, ...b).toArray() as T[]);
const indexed = async () =>
  (await libSql<{ ref: string }>('SELECT ref FROM embeddings ORDER BY ref')).map((r) => r.ref);
/** FTS rows for lines written here by SQL, as the writer keeps them. */
const fts = (like: string) =>
  coreSql('INSERT INTO messages_fts (rowid, body) SELECT seq, body FROM messages WHERE id LIKE ?', like);
const texts = (ai: ReturnType<typeof fakeAi>) => ai.calls.flatMap((c) => c.texts);
const search = (q: string, ai = fakeAi(), token = P.D, extra = '') =>
  searchWith<SearchResponse>(ai.env, token, `q=${encodeURIComponent(q)}${extra}`);

beforeAll(async () => {
  P = await principals();
  await brief(P.C, CHAT_SESSION, 'chat');
  ids.memo = await ownerSays(P.D, 'I left the voice memo from the lake on the old phone.');
  ids.bread = await ownerSays(P.D, 'The sourdough loaf came out flat again this morning.');
  const [{ thread_id }] = await coreSql<{ thread_id: string }>('SELECT thread_id FROM messages LIMIT 1');
  await coreSql(
    `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
     VALUES ('sys-line', ?, ?, 'system', 'system', 'text', 'A system line about the voice memo')`,
    thread_id,
    Date.now(),
  );
  await fts('sys-line');
  const held = await offRecord(P.D);
  await coreSql(
    `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
     VALUES ('held-line', ?, ?, 'owner', 'owner_device', 'text', 'An off the record line about the tape')`,
    held.id,
    Date.now(),
  );
  const fact = addOp([`msg:${ids.bread}`], { text: 'Bakes bread on Saturdays', subject: 'baking' });
  const old = addOp([`msg:${ids.bread}`], { text: 'Rides a bike to work', subject: 'commute' });
  ids.fact = fact.id;
  ids.old = old.id;
  expect((await ops(as(P.C, CHAT_SESSION), [fact, old])).status).toBe(200);
  await coreSql('UPDATE facts SET superseded_at = ? WHERE id = ?', Date.now(), old.id);
  // Study: a ready book's page is indexed; a book still being read waits.
  ids.book = uuidv7();
  ids.reading = uuidv7();
  const book = `INSERT INTO books (id, title, kind, language, bytes, r2_key, state, added_at, updated_at, ingested_at)
     VALUES (?, 'Invented book', 'book', 'en', 1, 'books/x.pdf', ?, 1, 1, 1)`;
  const page = `INSERT INTO pages (book_id, pdf_page, text, blocks_json, chars) VALUES (?, ?, ?, '[]', 10)`;
  await libSql(book, ids.book, 'ready');
  await libSql(page, ids.book, 7, 'How to tune a guitar by ear, one string at a time.');
  await libSql(book, ids.reading, 'extracting');
  await libSql(page, ids.reading, 1, 'A garden of tomatoes and seeds.');
});

describe('the indexer', () => {
  it('embeds the owner and the mind, current facts, ready pages; never system lines or held ones', async () => {
    const ai = fakeAi();
    expect(await runIndexer(ai.env)).toBeGreaterThan(0);
    expect(ai.calls.every((c) => c.model === EMBED_MODEL && c.texts.length <= 100)).toBe(true);
    const refs = await indexed();
    expect(refs).toContain(`msg:${ids.memo}`);
    expect(refs).toContain(`fact:${ids.fact}`);
    expect(refs).toContain(`book:${ids.book}#p7`);
    expect(refs).not.toContain('msg:sys-line');
    expect(refs).not.toContain('msg:held-line');
    expect(refs).not.toContain(`fact:${ids.old}`);
    expect(refs.some((r) => r.startsWith(`book:${ids.reading}`))).toBe(false);
    const [row] = await libSql<{ vector: ArrayBuffer; snippet: string; provenance: string }>(
      'SELECT vector, snippet, provenance FROM embeddings WHERE ref = ?',
      `msg:${ids.memo}`,
    );
    expect(row.vector.byteLength).toBe(384 * 4);
    expect(row).toMatchObject({
      snippet: 'I left the voice memo from the lake on the old phone.',
      provenance: 'owner',
    });
  });

  it('keeps its place: a second run embeds only what is new, and a book once ready', async () => {
    const quiet = fakeAi();
    await runIndexer(quiet.env);
    expect(texts(quiet)).toEqual([]);
    ids.ride = await ownerSays(P.D, 'Pedalled along the river after lunch.');
    await libSql("UPDATE books SET state = 'ready' WHERE id = ?", ids.reading);
    const next = fakeAi();
    await runIndexer(next.env);
    expect(texts(next)).toEqual(['Pedalled along the river after lunch.', 'A garden of tomatoes and seeds.']);
  });

  it('batches at most 100 texts a call and 1,000 a run; the rest waits for the next run', async () => {
    const [{ thread_id }] = await coreSql<{ thread_id: string }>('SELECT thread_id FROM messages LIMIT 1');
    await coreSql(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1050)
       INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
       SELECT printf('bulk-%04d', i), ?, ?, 'owner', 'owner_device', 'text', printf('filler line %d', i) FROM n`,
      thread_id,
      Date.now(),
    );
    await fts('bulk-%');
    const first = fakeAi();
    await runIndexer(first.env);
    expect(first.calls.map((c) => c.texts.length)).toEqual(Array(10).fill(100));
    const second = fakeAi();
    await runIndexer(second.env);
    expect(texts(second)).toHaveLength(50);
  });

  it('a failed call retries the step later and moves nothing', async () => {
    await ownerSays(P.D, 'The oven timer broke mid bake.');
    const down = fakeAi(true);
    await runIndexer(down.env);
    const [job] = await coreSql<{ state: string; last_error: string }>(
      "SELECT state, last_error FROM jobs WHERE id = 'search.embed'",
    );
    expect(job.state).not.toBe('done');
    expect(job.last_error).toMatch(/^load_failed/);
    await coreSql("UPDATE jobs SET due_at = 0 WHERE id = 'search.embed'");
    const up = fakeAi();
    await runIndexer(up.env);
    expect(texts(up)).toEqual(['The oven timer broke mid bake.']);
  });
});

describe('recall by meaning in GET /v1/search', () => {
  it('finds a message by meaning when no word matches, fused with the FTS hits', async () => {
    const r = await search('that thing I said about the recording');
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ source: 'messages', ref: `msg:${ids.memo}`, provenance: 'owner' });
    expect(r.body.items[0].thread_id).toEqual(expect.any(String));
    // Words and meaning both: the FTS hit keeps its marked snippet, its ranks add up.
    const both = await search('loaf');
    const hit = both.body.items.find((h) => h.ref === `msg:${ids.bread}`);
    expect(hit?.snippet).toContain('«loaf»');
    expect(both.body.items.map((h) => h.ref)).toContain(`fact:${ids.fact}`);
    // Study's pages are found by meaning too, by their page ref.
    const page = await search('chords and frets', fakeAi(), P.D, '&sources=library');
    expect(page.body.items[0]).toMatchObject({ source: 'library', ref: `book:${ids.book}#p7` });
  });

  it('serves only rows that still stand: a forgotten fact never comes back, and the sweep drops it', async () => {
    expect((await search('baking bread')).body.items.map((h) => h.ref)).toContain(`fact:${ids.fact}`);
    expect((await ops({ token: P.D }, [{ op: 'forget', id: ids.fact }])).status).toBe(200);
    expect((await search('baking bread')).body.items.map((h) => h.ref)).not.toContain(`fact:${ids.fact}`);
    await runIndexer(fakeAi().env);
    expect(await indexed()).not.toContain(`fact:${ids.fact}`);
  });

  it('keeps an outside hit back from a mind session unless it asks, as search does', async () => {
    const f = addOp([`msg:${ids.ride}`], { text: 'Owns a red umbrella', subject: 'weather' });
    const added = await ops(as(P.C, CHAT_SESSION), [f]);
    expect(added.body.applied.map((a) => a.fact_id)).toEqual([f.id]);
    await coreSql("UPDATE facts SET provenance = 'outside' WHERE id = ?", f.id);
    await runIndexer(fakeAi().env);
    const mind = await searchWith<SearchResponse>(fakeAi().env, P.C, 'q=stormy%20weather', {
      'TH-Session': CHAT_SESSION,
    });
    expect(mind.status).toBe(200);
    expect(mind.body.items.find((h) => h.ref === `fact:${f.id}`)).toMatchObject({
      provenance: 'outside',
      snippet: '(outside, kept back)',
    });
    const owner = await search('stormy weather');
    expect(owner.body.items.find((h) => h.ref === `fact:${f.id}`)?.snippet).toBe('Owns a red umbrella');
  });

  it('fails open: the model failing or missing leaves FTS to answer alone', async () => {
    for (const e of [fakeAi(true).env, { ...env, AI: undefined } as unknown as Env]) {
      const words = await searchWith<SearchResponse>(e, P.D, 'q=sourdough');
      expect(words.status).toBe(200);
      expect(words.body.items.map((h) => h.ref)).toEqual([`msg:${ids.bread}`]);
      const meaning = await searchWith<SearchResponse>(e, P.D, 'q=the%20recording');
      expect(meaning).toMatchObject({ status: 200, body: { items: [] } });
    }
  });
});
