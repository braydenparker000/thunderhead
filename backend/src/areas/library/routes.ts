// /v1/library (STUDY.md §3, §5, §6; API.md §11.21): the owner's books. A book is created with the
// client's own id (sent again, the same book) and uploaded in parts of exactly 50 MiB but the last,
// each streamed by the Worker straight into the private bucket's multipart upload, then completed:
// it then waits for the mind to read it. Reading places and highlights keep the newest version. The
// books' text is searched with FTS5, ready books only. Nothing here logs a title, a quote or a word.

import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  type BookCreateResponse,
  type BookPartResponse,
  type Highlight,
  LIBRARY_LIMITS as L,
  type LibrarySearchResponse,
} from '../../../../shared/contract/library.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { libraryObject } from '../../objects/library';
import { fresh } from '../../objects/rpc';
import { partsFor } from './ops';
import { ftsQuery } from './search';
import { createBody, editBody, highlightBody, positionBody, searchQuery, UUID7 } from './validate';

export const idParam = (c: Context, name = 'id'): string => {
  const id = c.req.param(name) ?? '';
  if (!UUID7.test(id)) throw new ApiError('not_found');
  return id;
};

export const libraryRoutes = new Hono<AppEnv>()
  .get('/library/books', guard('GET /v1/library/books'), async (c) =>
    c.json({ items: await fresh(libraryObject(c.env).books()) }),
  )
  .post('/library/books', guard('POST /v1/library/books'), async (c) => {
    const r = value(await fresh(libraryObject(c.env).createBook(await json(c, createBody))));
    const out: BookCreateResponse = {
      book: r.book,
      upload: { part_bytes: L.part_bytes, parts: partsFor(r.book.bytes) },
    };
    return c.json(out, r.created ? 201 : 200);
  })
  .get('/library/books/:id', guard('GET /v1/library/books/:id'), async (c) => {
    const book = await fresh(libraryObject(c.env).book(idParam(c)));
    if (!book) throw new ApiError('not_found');
    return c.json({ book });
  })
  .patch('/library/books/:id', guard('PATCH /v1/library/books/:id'), async (c) => {
    const id = idParam(c);
    return c.json({ book: value(await fresh(libraryObject(c.env).edit(id, await json(c, editBody)))) });
  })
  // One part's bytes, exactly its size, streamed into the multipart upload (never held whole).
  .put('/library/books/:id/parts/:n', guard('PUT /v1/library/books/:id/parts/:n'), async (c) => {
    const id = idParam(c);
    const n = Number(c.req.param('n'));
    if (!Number.isInteger(n) || n < 1) throw new ApiError('validation', [{ path: 'n', issue: 'a part number from 1' }]);
    const lib = libraryObject(c.env);
    const t = value(await fresh(lib.uploadTarget(id, n)));
    const body = c.req.raw.body;
    if (!body || Number(c.req.header('Content-Length')) !== t.size)
      throw new ApiError('validation', [{ path: 'Content-Length', issue: `part ${n} is ${t.size} bytes` }]);
    const { readable, writable } = new FixedLengthStream(t.size);
    const piped = body.pipeTo(writable);
    const part = await c.env.VAULT.resumeMultipartUpload(t.key, t.upload_id).uploadPart(n, readable);
    await piped;
    const out: BookPartResponse = { n, parts: value(await lib.partDone(id, n, part.etag)) };
    return c.json(out);
  })
  .post('/library/books/:id/complete', guard('POST /v1/library/books/:id/complete'), async (c) =>
    c.json({ book: value(await fresh(libraryObject(c.env).complete(idParam(c)))) }),
  )
  .post('/library/books/:id/retry', guard('POST /v1/library/books/:id/retry'), async (c) =>
    c.json({ book: value(await fresh(libraryObject(c.env).retry(idParam(c)))) }),
  )
  .put('/library/positions/:book_id', guard('PUT /v1/library/positions/:book_id'), async (c) => {
    const id = idParam(c, 'book_id');
    const p = await json(c, positionBody);
    const who = principalOf(c);
    const device = who.kind === 'device' ? who.session_id : who.agent_id;
    return c.json({ position: value(await fresh(libraryObject(c.env).putPosition(id, { ...p, device }))) });
  })
  .get('/library/highlights', guard('GET /v1/library/highlights'), async (c) => {
    const id = c.req.query('book_id') ?? '';
    if (!UUID7.test(id)) throw new ApiError('validation', [{ path: 'book_id', issue: 'a book id' }]);
    return c.json({ items: await fresh(libraryObject(c.env).highlights(id)) });
  })
  .put('/library/highlights/:id', guard('PUT /v1/library/highlights/:id'), async (c) => {
    const id = idParam(c);
    const h: Highlight = { id, ...(await json(c, highlightBody)) };
    if (h.updated_at < h.created_at)
      throw new ApiError('validation', [{ path: 'updated_at', issue: 'not before created_at' }]);
    return c.json(value(await fresh(libraryObject(c.env).putHighlight(h))));
  })
  .get('/library/search', guard('GET /v1/library/search'), async (c) => {
    const q = parse(searchQuery, c.req.query());
    const match = ftsQuery(q.q);
    const lib = libraryObject(c.env);
    if (!match) {
      const empty: LibrarySearchResponse = { items: [], next: null, not_ready: 0 };
      return c.json(empty);
    }
    const offset = q.cursor ? Number(q.cursor.slice(1)) : 0;
    const r = await fresh(lib.search(match, q.book_id ?? null, q.limit ?? 20, offset));
    return c.json(r satisfies LibrarySearchResponse);
  });
