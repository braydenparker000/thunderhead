// A run the mind pauses with a reason (a scanned book with no OCR where it reads, STUDY.md §3.3):
// the book is not ready, the cover reads the reason while it waits, and the next state clears it.
import { exports } from 'cloudflare:workers';
import { beforeAll, expect, it } from 'vitest';
import type { Book, IngestClaim } from '../../../shared/contract/library.ts';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const PDF = new TextEncoder().encode(`%PDF-1.4\n${'scanned book bytes '.repeat(60)}\n%%EOF\n`);
const REASON = "Some pages are scans, and reading scans isn't set up yet. It goes on once it is.";

beforeAll(async () => {
  p = await principals();
});

it('a paused run keeps its reason on the book until the next state', async () => {
  const id = uuidv7();
  await apiJson('POST', '/v1/library/books', { token: p.D, body: { id, title: 'A scan', bytes: PDF.byteLength } });
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
  const c = await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N });
  expect(c.status).toBe(200);
  const r = await apiJson<{ book: Book }>('PATCH', `/v1/library/ingest/${c.body.job.id}`, {
    token: p.N,
    body: { state: 'paused', cursor: 0, reason: REASON },
  });
  expect(r.status).toBe(200);
  expect(r.body.book).toMatchObject({ state: 'extracting', paused: true, state_reason: REASON });
  const again = await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N });
  expect(again.status).toBe(204); // a paused run waits for the next day
});
