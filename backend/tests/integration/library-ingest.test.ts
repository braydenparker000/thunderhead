// P7 step 1: the mind reads the owner's books (STUDY.md §3.3, §6). It claims the oldest waiting
// book (an hour's lease; nobody else gets it), downloads its PDF through the Worker (its holder
// only), posts pages (blocks inside the text, refs naming a block; a page sent again replaces
// itself and its index entry), reports its states, and ends ready (searchable: accents ignored,
// phrases, prefixes, the owner's typing never read as FTS syntax, snippets escaped) or failed (with
// a sentence; the owner can try again). The same file twice is a duplicate. Pages count against the
// bulk lane. The daily pass aborts uploads left for a day and frees lapsed or paused runs.
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Book, IngestClaim, LibrarySearchResponse, PageIn } from '../../../shared/contract/library.ts';
import { uuidv7 } from '../../src/lib/ids';
import { utcDay } from '../../src/lib/time';
import type { Library } from '../../src/objects/library';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const lib = () => env.LIBRARY.get(env.LIBRARY.idFromName('owner')) as unknown as DurableObjectStub<Library>;
const PDF = new TextEncoder().encode(`%PDF-1.4\n${'synthetic book bytes '.repeat(80)}\n%%EOF\n`);
const SHA = async () =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', PDF)), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );

async function addBook(title: string): Promise<string> {
  const id = uuidv7();
  await apiJson('POST', '/v1/library/books', { token: p.D, body: { id, title, bytes: PDF.byteLength } });
  await exports.default.fetch(
    new Request(`https://api.example.test/v1/library/books/${id}/parts/1`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${p.D}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Length': String(PDF.byteLength),
      },
      body: PDF,
    }),
  );
  await apiJson('POST', `/v1/library/books/${id}/complete`, { token: p.D });
  return id;
}
const claim = (token: string, headers: Record<string, string> = {}) =>
  apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token, headers });
const report = (token: string, job: string, body: object) =>
  apiJson<{ book: Book; error?: { code: string } }>('PATCH', `/v1/library/ingest/${job}`, { token, body });
const pages = (token: string, book: string, job: string, list: PageIn[]) =>
  apiJson<{ written: number; refs: number }>('PUT', `/v1/library/books/${book}/pages`, {
    token,
    body: { job_id: job, pages: list },
  });
const search = (q: string, token = p.D) =>
  apiJson<LibrarySearchResponse>('GET', `/v1/library/search?q=${encodeURIComponent(q)}`, { token });
const page = (n: number, text: string, over: Partial<PageIn> = {}): PageIn => ({
  pdf_page: n,
  page_label: String(n + 10),
  text,
  blocks: [[0, text.length]],
  ocr: false,
  ocr_conf: null,
  refs: [],
  ...over,
});

let book = '';
let job = '';
let pausedJob = '';
let R = '';
beforeAll(async () => {
  p = await principals();
  R = await makeAgent(p.D, 'mind:reflex');
  book = await addBook('Commentary on Book A');
});

describe('a reading run', () => {
  it('is claimed by one mind at a time; the device claims nothing; the sandbox has no library', async () => {
    expect((await claim(p.D)).status).toBe(403);
    expect((await claim(p.N, { 'TH-Sandbox': 'eval' })).status).toBe(422);
    const c = await claim(p.N);
    expect(c.status).toBe(200);
    expect(c.body.book).toEqual({ id: book, bytes: PDF.byteLength, language: 'eng', pdf_pages: null });
    expect(c.body.job.cursor).toBe(0);
    job = c.body.job.id;
    expect((await claim(p.C)).status).toBe(204);
    expect((await apiJson<{ book: Book }>('GET', `/v1/library/books/${book}`, { token: p.D })).body.book.state).toBe(
      'extracting',
    );
  });

  it('gives the PDF to the run’s holder only', async () => {
    const r = await api('GET', `/v1/library/ingest/${job}/file`, { token: p.N });
    expect([r.status, r.headers.get('Content-Type')]).toEqual([200, 'application/pdf']);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
    expect((await api('GET', `/v1/library/ingest/${job}/file`, { token: p.C })).status).toBe(409);
  });

  it('stores pages with their blocks and refs; a page sent again replaces itself', async () => {
    const text = 'La prière du matin. See Book A 3:12 and Gamma 10.';
    const r = await pages(p.N, book, job, [
      page(1, 'An old first draft about evenings.'),
      page(2, text, {
        blocks: [
          [0, 19],
          [20, text.length],
        ],
        refs: [
          { block: 2, book_code: 'a', chapter: 3, v_start: 12, v_end: 12, weight: 2, in_heading: false },
          { block: 2, book_code: 'gamma', chapter: 10, v_start: null, v_end: null, weight: 1, in_heading: false },
        ],
      }),
    ]);
    expect(r.body).toEqual({ written: 2, refs: 2 });
    expect((await pages(p.N, book, job, [page(1, 'The <first> page & its "quotes".')])).body).toEqual({
      written: 1,
      refs: 0,
    });
    const bad = await pages(p.N, book, job, [
      page(3, 'two blocks out of order', {
        blocks: [
          [5, 9],
          [0, 4],
        ],
      }),
      page(4, 'a ref to a missing block', {
        refs: [{ block: 2, book_code: 'a', chapter: 1, v_start: 2, v_end: 1, weight: 1, in_heading: false }],
      }),
    ]);
    expect(bad.status).toBe(422);
    expect((await pages(p.C, book, job, [page(3, 'not my run')])).status).toBe(409);
    // Not ready: not searched yet, and said so.
    expect((await search('priere')).body).toEqual({ items: [], next: null, not_ready: 1 });
  });

  it('goes through its states and ends ready; then it is searchable', async () => {
    expect((await report(p.N, job, { state: 'ready' })).status).toBe(422);
    const sha = await SHA();
    expect(
      (await report(p.N, job, { state: 'indexing', pdf_pages: 2, sha256: sha, cursor: 2 })).body.book,
    ).toMatchObject({
      state: 'indexing',
      pdf_pages: 2,
      sha256: sha,
      read_pages: 2,
    });
    expect((await pages(p.N, book, job, [page(3, 'past the end')])).status).toBe(422);
    const done = await report(p.N, job, { state: 'ready' });
    expect(done.body.book).toMatchObject({ state: 'ready', state_reason: null });
    expect(done.body.book.ingested_at).toEqual(expect.any(Number));
    expect((await report(p.N, job, { state: 'indexing' })).status).toBe(409);

    const hit = await search('priere');
    expect(hit.body.not_ready).toBe(0);
    expect(hit.body.items).toEqual([
      {
        book_id: book,
        pdf_page: 2,
        page_label: '12',
        snippet: expect.stringContaining('<mark>prière</mark>'),
        score: expect.any(Number),
      },
    ]);
    expect((await search('"du matin"')).body.items.map((h) => h.pdf_page)).toEqual([2]);
    expect((await search('"matin du"')).body.items).toEqual([]);
    expect((await search('pri*')).body.items.map((h) => h.pdf_page)).toEqual([2]);
    expect((await search('evenings')).body.items).toEqual([]);
    const escaped = (await search('first quotes')).body.items[0].snippet;
    expect(escaped).toBe('The &lt;<mark>first</mark>&gt; page &amp; its &quot;<mark>quotes</mark>&quot;.');
    for (const q of ['NEAR(a b)', 'a OR', '"unclosed', '* -', 'col:x']) expect((await search(q)).status, q).toBe(200);
    expect((await search('first', p.C)).status).toBe(200);
    expect((await search('first', R)).status).toBe(403);
    expect((await api('GET', '/v1/library/search?q=first')).status).toBe(401);
    expect((await api('GET', '/v1/library/search?q=x', { token: p.D })).status).toBe(422);
  });
});

describe('the same file twice, a failure, and the bulk lane', () => {
  it('a second copy of the same file is a duplicate of the first', async () => {
    const twin = await addBook('Commentary on Book A (copy)');
    const c = await claim(p.N);
    expect(c.body.book.id).toBe(twin);
    const r = await report(p.N, c.body.job.id, { state: 'extracting', sha256: await SHA() });
    expect(r.body.book).toMatchObject({ state: 'duplicate', duplicate_of: book });
  });

  it('a book that can’t be read says why, and can be tried again', async () => {
    const broken = await addBook('A locked file');
    const c = await claim(p.N);
    expect((await report(p.N, c.body.job.id, { state: 'failed' })).status).toBe(422);
    const failed = await report(p.N, c.body.job.id, {
      state: 'failed',
      reason: 'This PDF is password-protected. Remove the password and add it again.',
    });
    expect(failed.body.book).toMatchObject({ state: 'failed', state_reason: expect.stringContaining('password') });
    const again = await apiJson<{ book: Book }>('POST', `/v1/library/books/${broken}/retry`, { token: p.D });
    expect(again.body.book).toMatchObject({ state: 'queued', state_reason: null });
  });

  it('pages wait for tomorrow once the day’s bulk rows are used', async () => {
    const c = await claim(p.N);
    const now = Date.now();
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('bulk.day', ?, ?, 'worker')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify({ day: utcDay(now), rows: 40_000 }),
      now,
    );
    const r = await api('PUT', `/v1/library/books/${c.body.book.id}/pages`, {
      token: p.N,
      body: { job_id: c.body.job.id, pages: [page(1, 'tomorrow')] },
    });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    await coreSql("DELETE FROM settings WHERE key = 'bulk.day'");
    expect((await pages(p.N, c.body.book.id, c.body.job.id, [page(1, 'today after all')])).status).toBe(200);
    const [{ value_json }] = await coreSql<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = 'bulk.day'",
    );
    expect(JSON.parse(value_json).rows).toBeGreaterThan(0);
    // The mind pauses the run; the cover says it goes on tomorrow.
    pausedJob = c.body.job.id;
    const paused = await report(p.N, c.body.job.id, { state: 'paused', cursor: 1 });
    expect(paused.body.book).toMatchObject({ paused: true, read_pages: 1 });
  });
});

describe('the daily pass', () => {
  it('aborts an upload left for a day, and frees lapsed claims and yesterday’s paused runs', async () => {
    const left = uuidv7();
    await apiJson('POST', '/v1/library/books', { token: p.D, body: { id: left, title: 'Never finished', bytes: 10 } });
    const now = Date.now();
    const r = await lib().daily(now + 25 * 60 * 60_000);
    expect(r.aborted).toBe(1);
    expect((await api('GET', `/v1/library/books/${left}`, { token: p.D })).status).toBe(404);
    // The run paused today waits again the next UTC day, to go on where it stopped.
    const runOf = (id: string) =>
      runInDurableObject(lib(), (_o, s) =>
        s.storage.sql.exec('SELECT state, cursor, attempts FROM ingest_jobs WHERE id = ?', id).one(),
      );
    expect(await runOf(pausedJob)).toEqual({ state: 'queued', cursor: 1, attempts: 0 });
    expect(r.released).toBe(1);
    // A claim whose hour ran out waits again too, one lapse counted.
    const c = await claim(p.N);
    await lib().daily(now + 2 * 60 * 60_000);
    expect(await runOf(c.body.job.id)).toMatchObject({ state: 'queued', attempts: 1 });
  });
});
