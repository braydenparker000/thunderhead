// The owner's Astra copy (ASTRA.md §5.3, API.md §11.21): who may call (each token role), a round trip with the
// copy as the body and its base in the query, the copy given back exactly as it was sent, `same` from the head
// alone when the phone names the version it holds, a conflict when another phone saved first (and two saves at
// once, also two first saves: exactly one wins), the 1 MiB cap against a full real-shaped store, the outer shape
// refused in fixed words, 503 without the bucket, and the per-isolate count. The seal, the bucket's bytes and the
// logs are in astra-backup-seal.test.ts. Invented add-ons, titles and times.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ASTRA_BACKUP } from '../../../shared/contract/astra.ts';
import { forgetBackupMinute } from '../../src/areas/astra/backup';
import { removeBackup } from '../../src/areas/astra/backup-store';
import { ADDON, ADDON_SECRET, backup, copyOf, put, realStore } from '../astra-backup-helpers';
import { makeAgent, setupOwner } from '../helpers';

let D = '';
const agents: Record<string, string> = {};
const small = () => copyOf(realStore({ progress: 3, library: 2, watched: 5 }));
type Kept = { version: string | null; saved_at: string | null; copy?: unknown; same?: true };
const empty = { version: null, saved_at: null, copy: null };

beforeAll(async () => {
  D = (await setupOwner()).token;
  for (const role of ['mind:chat', 'mind:night', 'mind:reflex', 'muse', 'ci'] as const)
    agents[role] = await makeAgent(D, role);
});
beforeEach(async () => {
  forgetBackupMinute();
  await removeBackup(env.VAULT);
});

describe('who may call', () => {
  it('only the owner’s device: every agent role gets 403 and no token 401, and nothing is stored', async () => {
    for (const [role, token] of Object.entries(agents)) {
      for (const method of ['GET', 'PUT', 'DELETE'] as const) {
        const r = method === 'PUT' ? await put(token, small()) : await backup(method, token);
        expect([role, method, r.status, r.body.error?.code]).toEqual([role, method, 403, 'forbidden']);
      }
    }
    expect((await backup('GET', null)).status).toBe(401);
    expect((await put(null, small())).status).toBe(401);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
    expect((await backup<Kept>('GET', D)).body).toEqual(empty);
  });
});

describe('a round trip', () => {
  it('nothing kept, then a save, then the same copy back with its version and time; never cached', async () => {
    const none = await backup<Kept>('GET', D);
    expect([none.status, none.body, none.headers.get('Cache-Control')]).toEqual([200, empty, 'no-store']);
    const copy = small();
    const saved = await put(D, copy);
    expect([saved.status, saved.headers.get('Cache-Control')]).toEqual([200, 'no-store']);
    expect(Object.keys(saved.body).sort()).toEqual(['saved_at', 'version']);
    expect(saved.body.version, 'an opaque random id: 16 bytes, base64url').toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Number.isNaN(Date.parse(saved.body.saved_at))).toBe(false);
    const back = await backup<Kept>('GET', D);
    expect([back.status, back.headers.get('Cache-Control')]).toEqual([200, 'no-store']);
    expect(back.body).toEqual({ version: saved.body.version, saved_at: saved.body.saved_at, copy });
    // The next save names that version in the query and gets a new one.
    const next = await put(D, { ...copy, keys: {} }, saved.body.version);
    expect([next.status, next.body.version === saved.body.version]).toEqual([200, false]);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual({ astra: 'sync/1', keys: {} });
    const gone = await backup('DELETE', D);
    expect([gone.status, gone.text, gone.headers.get('Cache-Control')]).toEqual([204, '', 'no-store']);
    expect((await backup<Kept>('GET', D)).body).toEqual(empty);
  });

  it('gives the copy back byte for byte as it was sent: sealed as it came, never re-encoded', async () => {
    const sent = `{ "keys" : {"settings":{"value":{"hero":false,"név":"\\u00e9"},"at":5}},\n "astra":"sync/1" }`;
    const saved = await put(D, sent);
    expect(saved.status).toBe(200);
    const back = await backup('GET', D);
    expect(back.text).toBe(`{"version":"${saved.body.version}","saved_at":"${saved.body.saved_at}","copy":${sent}}`);
    // A byte-order mark could not go back inside the answer: refused.
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(small()))]);
    expect((await put(D, bom, saved.body.version)).status).toBe(400);
  });

  it('naming the version it holds, a phone gets `same` from the object’s head alone; an older one, the copy', async () => {
    const copy = small();
    const saved = await put(D, copy);
    let gets = 0;
    const counting = {
      head: (k: string) => env.VAULT.head(k),
      get: (k: string, o?: R2GetOptions) => {
        gets++;
        return env.VAULT.get(k, o);
      },
    } as unknown as R2Bucket;
    const same = await backup<Kept>('GET', D, { query: `?known=${saved.body.version}`, over: { VAULT: counting } });
    expect([same.status, same.body, gets]).toEqual([200, { ...saved.body, same: true }, 0]);
    expect(same.text.length).toBeLessThan(120);
    const other = await backup<Kept>('GET', D, { query: '?known=AAAAAAAAAAAAAAAAAAAAAA', over: { VAULT: counting } });
    expect([other.body.copy, gets]).toEqual([copy, 1]);
    for (const q of ['?known=', '?known=a%20b', `?known=${'a'.repeat(65)}`, '?base=a/b'])
      expect(
        (
          await backup(q.startsWith('?base') ? 'PUT' : 'GET', D, {
            query: q,
            body: q.startsWith('?base') ? copy : undefined,
          })
        ).status,
      ).toBe(422);
  });
});

describe('another phone saved first', () => {
  it('a save on a version no longer kept is 409 conflict in the usual envelope, and changes nothing', async () => {
    const first = await put(D, small());
    const late = await put(D, copyOf({ settings: { hero: false } }));
    expect([late.status, late.body.error?.code, late.body.error?.details]).toEqual([
      409,
      'conflict',
      { reason: 'stale_base' },
    ]);
    expect(typeof (late.body.error as { request_id?: string }).request_id).toBe('string');
    expect((await put(D, small(), 'AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(409);
    expect((await backup<Kept>('GET', D)).body.version).toBe(first.body.version);
    // Nothing kept and a phone naming a version: also a conflict (the copy was removed meanwhile).
    await backup('DELETE', D);
    expect((await put(D, small(), first.body.version)).status).toBe(409);
  });

  it('two phones saving on the same version at once, or both saving first: exactly one wins, by the conditional write', async () => {
    const [a, b] = await Promise.all([
      put(D, copyOf({ settings: { hero: true } })),
      put(D, copyOf({ settings: { hero: false } })),
    ]);
    expect([a.status, b.status].sort(), 'two first saves (If-None-Match: *)').toEqual([200, 409]);
    const base = (a.status === 200 ? a : b).body.version;
    const [c, e] = await Promise.all([put(D, small(), base), put(D, copyOf({ recentSearches: ['x'] }), base)]);
    expect([c.status, e.status].sort()).toEqual([200, 409]);
    expect((await backup<Kept>('GET', D)).body.version).toBe((c.status === 200 ? c : e).body.version);
  });
});

describe('the size of a copy', () => {
  it('a full real-shaped phone (300 progress entries, 500 library titles, 3,000 watched) fits well under 1 MiB', async () => {
    const copy = copyOf(realStore({ progress: 300, library: 500, watched: 3000 }));
    const bytes = new TextEncoder().encode(JSON.stringify(copy)).length;
    expect(bytes, `${bytes} bytes`).toBeLessThan(ASTRA_BACKUP.max_bytes * 0.6);
    expect((await put(D, copy)).status).toBe(200);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(copy);
  });

  it('past 1 MiB as sent is 413 too_large, and nothing is stored', async () => {
    const r = await put(D, copyOf({ recentSearches: ['x'.repeat(ASTRA_BACKUP.max_bytes)] }));
    expect([r.status, r.body.error?.code]).toEqual([413, 'too_large']);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
  });
});

describe('the outer shape', () => {
  const refused = async (body: unknown) => {
    const r = await put(D, body);
    expect(r.text).not.toContain(ADDON_SECRET);
    expect(r.text).not.toContain('addon.example');
    return [r.status, r.body.error?.code];
  };
  const value = [{ url: ADDON, enabled: true, name: 'Invented' }];
  const one = (entry: unknown, astra = 'sync/1') => ({ astra, keys: { addons: entry } });

  it('an object, the tag, known keys each with a time and a value; nothing sent is echoed', async () => {
    expect(await refused('not json')).toEqual([400, 'bad_request']);
    expect(await refused([])).toEqual([422, 'validation']);
    expect(await refused({ base: null, copy: small() }), 'the old body, base inside').toEqual([422, 'validation']);
    expect(await refused(one({ at: 1, value }, 'backup/1'))).toEqual([422, 'validation']);
    expect(await refused({ astra: 'sync/2', keys: {} })).toEqual([422, 'validation']);
    expect(await refused({ astra: 'sync/1', keys: [] })).toEqual([422, 'validation']);
    expect(await refused({ astra: 'sync/1', keys: {}, extra: ADDON })).toEqual([422, 'validation']);
    // A device key (the player's choices) never travels; nor an unknown one named after a secret.
    expect(await refused(copyOf({ player: { volume: 1 } }))).toEqual([422, 'validation']);
    const named = await put(D, { astra: 'sync/1', keys: { [ADDON]: { at: 1, value } } });
    expect([named.status, named.text.includes(ADDON_SECRET)]).toEqual([422, false]);
    expect(await refused(one({ value }))).toEqual([422, 'validation']);
    expect(await refused(one({ at: -1, value }))).toEqual([422, 'validation']);
    expect(await refused(one({ at: 1 }))).toEqual([422, 'validation']);
    expect(await refused(one({ at: 1, value, url: ADDON }))).toEqual([422, 'validation']);
    expect(await refused({ astra: 'sync/1', keys: { library: { at: 1, value: {}, gone: [ADDON] } } })).toEqual([
      422,
      'validation',
    ]);
    // Add-ons carry when each address was had (`times`, an object), as the phones merge them address by address.
    expect(await refused(one({ at: 1, value, times: [1] }))).toEqual([422, 'validation']);
    // A time past a day from the Worker's clock (the security read's far-future probe): it would win every merge.
    expect(await refused(one({ at: 9e15, value }))).toEqual([422, 'validation']);
    expect(await refused(one({ at: Date.now() + 864e5 + 60_000, value }))).toEqual([422, 'validation']);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
    // What a key holds is not read: any JSON value is kept as it came.
    const odd = {
      astra: 'sync/1',
      keys: {
        settings: { at: 5, value: [1, 'two', null] },
        library: { at: 6, value: {}, gone: { 'movie:tt1': 9 } },
        addons: { at: 7, value: [], times: { '0123456789abcdef': 3 }, gone: {} },
      },
    };
    expect((await put(D, odd)).status).toBe(200);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(odd);
  });
});

describe('without the bucket', () => {
  it('every route answers 503 unavailable, so the page carries on alone', async () => {
    const over = { VAULT: undefined };
    for (const r of [
      await backup('GET', D, { over }),
      await put(D, small(), null, over),
      await backup('DELETE', D, { over }),
    ])
      expect([r.status, r.body.error?.code]).toEqual([503, 'unavailable']);
  });
});

describe('the count', () => {
  it('30 requests a minute in an isolate, GET, PUT and DELETE together, then 429 with Retry-After', async () => {
    for (let i = 0; i < 29; i++) expect((await backup('GET', D)).status).toBe(200);
    expect((await put(D, small())).status).toBe(200);
    const over = await backup('GET', D);
    expect([over.status, over.body.error?.code]).toEqual([429, 'rate_limited']);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await backup('DELETE', D)).status).toBe(429);
  });
});
