// P7 step 1: Study's books (STUDY.md §3.1, §5.4, §5.5). A book is created under the client's id
// (again: the same book; other fields: a conflict) and uploaded in parts, 50 MiB but the last, each
// streamed into the private bucket; a part cut short is refused and sent again; complete before
// every part is in names the parts received; once whole, the stored file equals the source byte for
// byte and the book waits for the mind. The newest reading place wins; a highlight keeps its newest
// version. A whole book's PDF comes back through the Worker, for the device only; `book:` refs are
// never signed.
import { createExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Book,
  type BookCreateResponse,
  type HighlightPutResponse,
  LIBRARY_LIMITS,
  type Position,
} from '../../../shared/contract/library.ts';
import type { MediaSignResponse } from '../../../shared/contract/music.ts';
import { app } from '../../src/app';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';
import { storeScripture } from '../scripture-helpers';

let p: Principals;
const ID = uuidv7();
const BYTES = LIBRARY_LIMITS.part_bytes + 1_024;
const file = new Uint8Array(BYTES);
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const part = (n: number, bytes = file.subarray((n - 1) * LIBRARY_LIMITS.part_bytes, n * LIBRARY_LIMITS.part_bytes)) =>
  exports.default.fetch(
    new Request(`https://api.example.test/v1/library/books/${ID}/parts/${n}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${p.D}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    }),
  );
const book = async (id = ID) =>
  (await apiJson<{ book: Book }>('GET', `/v1/library/books/${id}`, { token: p.D })).body.book;

beforeAll(async () => {
  p = await principals();
  await storeScripture();
  file.set(new TextEncoder().encode('%PDF-1.7\n'));
  for (let i = 9; i < BYTES; i += 4_093) file[i] = i % 251;
});

describe('adding a book', () => {
  const create = { id: ID, title: 'A Synthetic Commentary', author: 'Nobody', bytes: BYTES };

  it('creates it under the client’s id, once; other fields under that id are a conflict', async () => {
    const r = await apiJson<BookCreateResponse>('POST', '/v1/library/books', { token: p.D, body: create });
    expect(r.status).toBe(201);
    expect(r.body.upload).toEqual({ part_bytes: LIBRARY_LIMITS.part_bytes, parts: 2 });
    expect(r.body.book).toMatchObject({ id: ID, state: 'uploading', kind: 'book', language: 'eng', parts: [] });
    const again = await apiJson<BookCreateResponse>('POST', '/v1/library/books', { token: p.D, body: create });
    expect([again.status, again.body.book.id]).toEqual([200, ID]);
    const other = await apiJson('POST', '/v1/library/books', { token: p.D, body: { ...create, title: 'Else' } });
    expect(other.status).toBe(409);
    const big = { ...create, id: uuidv7(), bytes: LIBRARY_LIMITS.book_bytes + 1 };
    expect((await apiJson('POST', '/v1/library/books', { token: p.D, body: big })).status).toBe(422);
    expect((await apiJson('POST', '/v1/library/books', { token: p.C, body: create })).status).toBe(403);
  });

  it('takes parts in any order, refuses one cut short, resumes, and completes once all are in', async () => {
    expect((await (await part(2)).json()) as object).toEqual({ n: 2, parts: [2] });
    // The first part cut short (a dropped connection): refused, nothing recorded.
    expect((await part(1, file.subarray(0, 1_000))).status).toBe(422);
    const early = await apiJson<{ error: { code: string; details: { parts: number[] } } }>(
      'POST',
      `/v1/library/books/${ID}/complete`,
      { token: p.D },
    );
    expect([early.status, early.body.error.details.parts]).toEqual([409, [2]]);
    expect((await book()).parts).toEqual([2]);
    expect((await part(3)).status).toBe(422);
    // Sent again in full.
    expect((await (await part(1)).json()) as object).toEqual({ n: 1, parts: [1, 2] });
    const done = await apiJson<{ book: Book }>('POST', `/v1/library/books/${ID}/complete`, { token: p.D });
    expect(done.status).toBe(200);
    expect(done.body.book).toMatchObject({ state: 'queued', read_pages: 0 });
    expect(done.body.book).not.toHaveProperty('parts');
    const stored = (await env.VAULT.get(`books/${ID}.pdf`)) as R2ObjectBody;
    expect(stored.size).toBe(BYTES);
    expect(stored.httpMetadata?.contentType).toBe('application/pdf');
    expect(hex(await crypto.subtle.digest('SHA-256', await stored.arrayBuffer()))).toBe(
      hex(await crypto.subtle.digest('SHA-256', file)),
    );
    // Done is done: complete again is the same book; a part now is refused.
    expect(
      (await apiJson<{ book: Book }>('POST', `/v1/library/books/${ID}/complete`, { token: p.D })).body.book.state,
    ).toBe('queued');
    expect((await part(2)).status).toBe(409);
  });

  it('lists it, edits its title and author, and only a failed book can be tried again', async () => {
    const list = await apiJson<{ items: Book[] }>('GET', '/v1/library/books', { token: p.N });
    expect(list.body.items.map((b) => b.id)).toContain(ID);
    const edited = await apiJson<{ book: Book }>('PATCH', `/v1/library/books/${ID}`, {
      token: p.D,
      body: { title: 'A Synthetic Commentary, 2nd ed.', author: null },
    });
    expect(edited.body.book).toMatchObject({ title: 'A Synthetic Commentary, 2nd ed.', author: null });
    expect((await apiJson('POST', `/v1/library/books/${ID}/retry`, { token: p.D })).status).toBe(409);
    expect((await apiJson('GET', `/v1/library/books/${uuidv7()}`, { token: p.D })).status).toBe(404);
  });
});

describe('reading', () => {
  it('keeps the newest place per book, whichever device sent it', async () => {
    const put = (pdf_page: number, at: number) =>
      apiJson<{ position: Position }>('PUT', `/v1/library/positions/${ID}`, {
        token: p.D,
        body: { pdf_page, scroll_frac: 0.25, at },
      });
    const now = Date.now();
    expect((await put(12, now)).body.position).toMatchObject({ pdf_page: 12, at: now });
    expect((await put(3, now - 60_000)).body.position).toMatchObject({ pdf_page: 12 });
    expect((await book()).position).toMatchObject({ pdf_page: 12, scroll_frac: 0.25 });
    expect(
      (
        await apiJson('PUT', `/v1/library/positions/${uuidv7()}`, {
          token: p.D,
          body: { pdf_page: 1, scroll_frac: 0, at: now },
        })
      ).status,
    ).toBe(404);
  });

  it('keeps a highlight’s newest version, its first time, and its book', async () => {
    const id = uuidv7();
    const now = Date.now();
    const h = {
      book_id: ID,
      pdf_page: 12,
      quote: 'a sentence worth keeping',
      prefix: 'before ',
      suffix: ' after',
      rects: [[0.1, 0.2, 0.5, 0.03]],
      color: 'gold',
      note: null,
      ref: 'verse:a/3/12',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    const put = (body: object) =>
      apiJson<HighlightPutResponse>('PUT', `/v1/library/highlights/${id}`, { token: p.D, body });
    expect((await put(h)).body).toMatchObject({ applied: true, highlight: { id, color: 'gold' } });
    expect((await put({ ...h, color: 'blue', updated_at: now - 1, created_at: now - 1 })).body).toMatchObject({
      applied: false,
      highlight: { color: 'gold' },
    });
    const deleted = await put({
      ...h,
      note: 'why it matters',
      updated_at: now + 5,
      created_at: now + 5,
      deleted_at: now + 5,
    });
    expect(deleted.body).toMatchObject({
      applied: true,
      highlight: { note: 'why it matters', created_at: now, deleted_at: now + 5 },
    });
    const list = await apiJson<{ items: { id: string }[] }>('GET', `/v1/library/highlights?book_id=${ID}`, {
      token: p.D,
    });
    expect(list.body.items.map((x) => x.id)).toEqual([id]);
    expect((await put({ ...h, ref: 'verse:a/0/1' })).status).toBe(422);
    expect((await put({ ...h, quote: 'x'.repeat(501) })).status).toBe(422);
    expect((await put({ ...h, book_id: uuidv7() })).status).toBe(404);
    expect((await apiJson('PUT', `/v1/library/highlights/${id}`, { token: p.C, body: h })).status).toBe(403);
  });
});

describe("a book's file, for the phone to keep", () => {
  it('serves a whole book’s PDF to the device, byte for byte; nothing while it uploads; never a signed link', async () => {
    const res = await exports.default.fetch(
      new Request(`https://api.example.test/v1/library/books/${ID}/file`, {
        headers: { Authorization: `Bearer ${p.D}`, 'CF-Connecting-IP': '192.0.2.10' },
      }),
    );
    expect([res.status, res.headers.get('Content-Type'), res.headers.get('Content-Length')]).toEqual([
      200,
      'application/pdf',
      String(BYTES),
    ]);
    const hex = async (b: ArrayBuffer | Uint8Array) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    expect(await hex(await res.arrayBuffer())).toBe(await hex(file));
    const uploading = uuidv7();
    await apiJson('POST', '/v1/library/books', { token: p.D, body: { id: uploading, title: 'Half', bytes: 10 } });
    expect((await apiJson('GET', `/v1/library/books/${uploading}/file`, { token: p.D })).status).toBe(404);
    expect((await apiJson('GET', `/v1/library/books/${ID}/file`, { token: p.N })).status).toBe(403);
    const KEYED = {
      ...env,
      R2_ACCOUNT_ID: 'f'.repeat(32),
      R2_SIGN_ACCESS_KEY_ID: 'test-access-key-id',
      R2_SIGN_SECRET: 'test-secret-not-real',
    } as Env;
    const signed = (await (
      await app.fetch(
        new Request('https://api.example.test/v1/media/sign', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${p.D}`,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '192.0.2.10',
          },
          body: JSON.stringify({ refs: [`book:${ID}`] }),
        }),
        KEYED,
        createExecutionContext(),
      )
    ).json()) as MediaSignResponse;
    expect(signed).toEqual({ items: [], errors: [{ ref: `book:${ID}`, code: 'not_signable' }] });
  });
});
