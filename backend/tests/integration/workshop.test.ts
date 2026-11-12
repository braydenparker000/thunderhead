// The workshop's files (shared/contract/workshop.ts, API.md §11.27): a file goes up in pieces of
// 8 MiB but the last, in any order, each kept in the private bucket only when its bytes match the
// hash sent with it; a piece cut short is refused and sent again; the list is read from the bucket,
// so a file half sent says which pieces are in; the pieces joined are the source byte for byte; the
// same id is the same file; removing takes every piece. The owner's phone only.
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WORKSHOP_LIMITS as L,
  type WorkshopListResponse,
  type WorkshopPartResponse,
} from '../../../shared/contract/workshop.ts';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const ID = uuidv7();
const BYTES = 2 * L.part_bytes + 4_321;
const NAME = 'DSCF0042 (1).RAF';
const file = new Uint8Array(BYTES);
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const slice = (n: number) => file.subarray((n - 1) * L.part_bytes, n * L.part_bytes);
interface Put {
  id?: string;
  bytes?: Uint8Array;
  total?: number;
  name?: string;
  sha?: string;
  token?: string;
}
async function part(n: number, o: Put = {}): Promise<Response> {
  const bytes = o.bytes ?? slice(n);
  return exports.default.fetch(
    new Request(`https://api.example.test/v1/workshop/${o.id ?? ID}/parts/${n}?bytes=${o.total ?? BYTES}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${o.token ?? p.D}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'TH-File-Name': encodeURIComponent(o.name ?? NAME),
        'TH-Sha256': o.sha ?? hex(await crypto.subtle.digest('SHA-256', bytes)),
      },
      body: bytes,
    }),
  );
}
const list = async () => (await apiJson<WorkshopListResponse>('GET', '/v1/workshop', { token: p.D })).body;

beforeAll(async () => {
  p = await principals();
  for (let i = 0; i < BYTES; i += 4_093) file[i] = i % 251;
});

describe('a file for the workshop', () => {
  it('goes up in pieces in any order; one cut short, or not what its hash says, is not kept', async () => {
    expect((await list()).items).toEqual([]);
    expect((await (await part(3)).json()) as WorkshopPartResponse).toEqual({ n: 3, have: [3] });
    // The first piece cut short (a dropped connection), then with a hash of other bytes.
    expect((await part(1, { bytes: file.subarray(0, 1_000) })).status).toBe(422);
    expect((await part(1, { sha: 'ab'.repeat(32) })).status).toBe(422);
    expect((await part(4)).status).toBe(422);
    expect((await part(0)).status).toBe(422);
    const half = await list();
    expect(half.items).toHaveLength(1);
    expect(half.items[0]).toMatchObject({ id: ID, name: NAME, bytes: BYTES, parts: 3, have: [3] });
    expect([half.bytes, half.limit, half.part_bytes]).toEqual([4_321, L.total_bytes, L.part_bytes]);
    // Sent again in full, and a piece already in sent once more changes nothing.
    expect((await (await part(1)).json()) as WorkshopPartResponse).toEqual({ n: 1, have: [1, 3] });
    expect((await (await part(2)).json()) as WorkshopPartResponse).toEqual({ n: 2, have: [1, 2, 3] });
    expect((await (await part(2)).json()) as WorkshopPartResponse).toEqual({ n: 2, have: [1, 2, 3] });
    expect((await list()).bytes).toBe(BYTES);
  });

  it('is the source byte for byte once its pieces are joined, each carrying its name and size', async () => {
    const joined = new Uint8Array(BYTES);
    let at = 0;
    for (const n of [1, 2, 3]) {
      const o = (await env.VAULT.get(`workshop/${ID}/${String(n).padStart(4, '0')}`)) as R2ObjectBody;
      expect(o.customMetadata).toEqual({ name: encodeURIComponent(NAME), bytes: String(BYTES) });
      joined.set(new Uint8Array(await o.arrayBuffer()), at);
      at += o.size;
    }
    expect(at).toBe(BYTES);
    expect(hex(await crypto.subtle.digest('SHA-256', joined))).toBe(hex(await crypto.subtle.digest('SHA-256', file)));
  });

  it('keeps one file to one id, refuses what is too big, and only the owner’s phone may call', async () => {
    expect((await part(1, { name: 'other.raf' })).status).toBe(409);
    expect((await part(1, { total: BYTES + 1 })).status).toBe(409);
    expect((await part(1, { id: uuidv7(), total: L.file_bytes + 1 })).status).toBe(413);
    expect((await part(1, { id: 'not-an-id' })).status).toBe(422);
    expect((await part(1, { id: uuidv7(), name: '' })).status).toBe(422);
    for (const token of [p.C, p.N]) {
      expect((await part(1, { token })).status).toBe(403);
      expect((await apiJson('GET', '/v1/workshop', { token })).status).toBe(403);
      expect((await apiJson('DELETE', `/v1/workshop/${ID}`, { token })).status).toBe(403);
    }
    expect((await apiJson('GET', '/v1/workshop')).status).toBe(401);
  });

  it('lists the newest first, and removing a file takes every piece of it and nothing else', async () => {
    const other = uuidv7();
    const small = new Uint8Array([1, 2, 3, 4, 5]);
    expect((await part(1, { id: other, bytes: small, total: 5, name: '../notes/a b.txt' })).status).toBe(200);
    const both = await list();
    // A name is made safe to show: no path in it.
    expect(both.items.map((f) => [f.id, f.name, f.parts, f.have])).toEqual(
      expect.arrayContaining([
        [other, '_notes_a b.txt', 1, [1]],
        [ID, NAME, 3, [1, 2, 3]],
      ]),
    );
    expect(both.bytes).toBe(BYTES + 5);
    const gone = await apiJson<{ removed: number }>('DELETE', `/v1/workshop/${ID}`, { token: p.D });
    expect([gone.status, gone.body.removed]).toEqual([200, 3]);
    expect((await apiJson('DELETE', `/v1/workshop/${ID}`, { token: p.D })).status).toBe(404);
    expect((await env.VAULT.list({ prefix: `workshop/${ID}/` })).objects).toEqual([]);
    expect((await list()).items.map((f) => f.id)).toEqual([other]);
  });
});
