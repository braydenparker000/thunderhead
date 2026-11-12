// /v1/workshop (shared/contract/workshop.ts, API.md §11.27): files the owner sends from the phone for
// the agent that builds Thunderhead with them. A file goes up in pieces of exactly 8 MiB but the
// last, each streamed straight into the private bucket as its own object under
// `workshop/<id>/<piece>` and refused unless its bytes match the SHA-256 sent with it. The bucket
// is the only record (no table, no rows): each piece carries the file's name and size, so the list
// is read from the bucket and a piece already in is never sent again. The owner's phone only;
// nothing here logs a name.
import { Hono } from 'hono';
import {
  WORKSHOP_LIMITS as L,
  type WorkshopFile,
  type WorkshopListResponse,
  type WorkshopPartResponse,
} from '../../../../shared/contract/workshop.ts';
import { type AppEnv, guard } from '../../http/auth';
import { idParam } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { safeName } from '../files/wire';

const PREFIX = 'workshop/';
const vaultOf = (env: Env): R2Bucket => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new ApiError('not_configured');
  return v;
};
const bad = (path: string, issue: string) => new ApiError('validation', [{ path, issue }]);
const keyOf = (id: string, n: number) => `${PREFIX}${id}/${String(n).padStart(4, '0')}`;
export const partsOf = (bytes: number) => Math.max(1, Math.ceil(bytes / L.part_bytes));

interface Piece {
  key: string;
  id: string;
  n: number;
  size: number;
  at: number;
  name: string;
  bytes: number;
}

/** Every piece under a prefix, with what it says of its file. A piece without that is skipped. */
async function pieces(vault: R2Bucket, prefix = PREFIX): Promise<Piece[]> {
  const out: Piece[] = [];
  let cursor: string | undefined;
  do {
    const page = await vault.list({ prefix, cursor, include: ['customMetadata'] });
    for (const o of page.objects) {
      const [id, n] = o.key.slice(PREFIX.length).split('/');
      const bytes = Number(o.customMetadata?.bytes);
      let name = '';
      try {
        name = decodeURIComponent(o.customMetadata?.name ?? '');
      } catch {}
      if (!id || !/^\d{4}$/.test(n ?? '') || !name || !Number.isInteger(bytes)) continue;
      out.push({ key: o.key, id, n: Number(n), size: o.size, at: o.uploaded.getTime(), name, bytes });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const haveOf = (mine: Piece[]) => mine.map((p) => p.n).sort((a, b) => a - b);

export const workshopRoutes = new Hono<AppEnv>()
  .get('/workshop', guard('GET /v1/workshop'), async (c) => {
    const all = await pieces(vaultOf(c.env));
    const files = new Map<string, WorkshopFile>();
    for (const p of all) {
      const f = files.get(p.id) ?? {
        id: p.id,
        name: p.name,
        bytes: p.bytes,
        parts: partsOf(p.bytes),
        have: [],
        at: p.at,
      };
      f.have.push(p.n);
      f.at = Math.min(f.at, p.at);
      files.set(p.id, f);
    }
    const items = [...files.values()].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    for (const f of items) f.have.sort((a, b) => a - b);
    const out: WorkshopListResponse = {
      items,
      bytes: all.reduce((s, p) => s + p.size, 0),
      limit: L.total_bytes,
      part_bytes: L.part_bytes,
    };
    return c.json(out);
  })
  // One piece's bytes, exactly its size, streamed into the bucket (never held whole).
  .put('/workshop/:id/parts/:n', guard('PUT /v1/workshop/:id/parts/:n'), async (c) => {
    const id = idParam(c);
    const vault = vaultOf(c.env);
    const bytes = Number(c.req.query('bytes'));
    if (!Number.isInteger(bytes) || bytes < 1) throw bad('bytes', "the whole file's size");
    if (bytes > L.file_bytes) throw new ApiError('too_large');
    const parts = partsOf(bytes);
    const n = Number(c.req.param('n'));
    if (!Number.isInteger(n) || n < 1 || n > parts) throw bad('n', `a piece from 1 to ${parts}`);
    const size = n < parts ? L.part_bytes : bytes - (parts - 1) * L.part_bytes;
    const name = safeName(c.req.header('TH-File-Name'));
    const sha = c.req.header('TH-Sha256') ?? '';
    if (!/^[0-9a-f]{64}$/.test(sha)) throw bad('TH-Sha256', "the piece's SHA-256, lower-case hex");
    const body = c.req.raw.body;
    if (!body || Number(c.req.header('Content-Length')) !== size)
      throw bad('Content-Length', `piece ${n} is ${size} bytes`);
    const all = await pieces(vault);
    const key = keyOf(id, n);
    const mine = all.filter((p) => p.id === id);
    // The same id is the same file: another name or size under it is refused, not mixed in.
    if (mine.some((p) => p.name !== name || p.bytes !== bytes)) throw new ApiError('conflict');
    const stored = all.reduce((s, p) => s + (p.key === key ? 0 : p.size), 0);
    if (stored + size > L.total_bytes) throw bad('bytes', 'the workshop is full: remove a file first');
    const { readable, writable } = new FixedLengthStream(size);
    const piped = body.pipeTo(writable);
    try {
      await vault.put(key, readable, {
        sha256: sha,
        customMetadata: { name: encodeURIComponent(name), bytes: String(bytes) },
      });
      await piped;
    } catch (e) {
      await piped.catch(() => undefined);
      // The bucket checks the bytes against the hash as it stores them; a piece that differs is not kept.
      if (/sha-?256|checksum|digest/i.test(String((e as Error)?.message))) throw bad('TH-Sha256', 'not what arrived');
      throw new ApiError('upstream');
    }
    const out: WorkshopPartResponse = { n, have: haveOf([...mine.filter((p) => p.n !== n), { n } as Piece]) };
    return c.json(out);
  })
  .delete('/workshop/:id', guard('DELETE /v1/workshop/:id'), async (c) => {
    const id = idParam(c);
    const vault = vaultOf(c.env);
    const mine = await pieces(vault, `${PREFIX}${id}/`);
    if (!mine.length) throw new ApiError('not_found');
    await vault.delete(mine.map((p) => p.key));
    return c.json({ removed: mine.length });
  });
