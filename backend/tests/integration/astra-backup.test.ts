// The owner's Astra copy (ASTRA.md §5.3, API.md §11.21): who may call (each token role), a round trip,
// a conflict when another phone saved first (and two saves at once: exactly one wins), the size cap
// against a heavy real-shaped store, the outer shape refused in fixed words, 503 without the bucket,
// and the per-isolate count. The seal, the bucket's bytes and the logs are in astra-backup-seal.test.ts.
// Invented add-ons, titles and times.

import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ASTRA_BACKUP } from '../../../shared/contract/astra.ts';
import { forgetBackupMinute } from '../../src/areas/astra/backup';
import { removeBackup } from '../../src/areas/astra/backup-store';
import { ADDON, ADDON_SECRET, backup, copyOf, realStore } from '../astra-backup-helpers';
import { makeAgent, setupOwner } from '../helpers';

let D = '';
const agents: Record<string, string> = {};
const small = () => copyOf(realStore({ progress: 3, library: 2, watched: 5 }));
type Saved = { version: string; saved_at: string };
type Kept = { version: string | null; saved_at: string | null; copy: unknown };

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
        const r = await backup(method, token, method === 'PUT' ? { base: null, copy: small() } : undefined);
        expect([role, method, r.status, r.body.error?.code]).toEqual([role, method, 403, 'forbidden']);
      }
    }
    expect((await backup('GET', null)).status).toBe(401);
    expect((await backup('PUT', null, { base: null, copy: small() })).status).toBe(401);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
    expect((await backup<Kept>('GET', D)).body).toEqual({ version: null, saved_at: null, copy: null });
  });
});

describe('a round trip', () => {
  it('nothing kept, then a save, then the same copy back with its version and time; never cached', async () => {
    const empty = await backup<Kept>('GET', D);
    expect([empty.status, empty.body, empty.headers.get('Cache-Control')]).toEqual([
      200,
      { version: null, saved_at: null, copy: null },
      'no-store',
    ]);
    const copy = small();
    const saved = await backup<Saved>('PUT', D, { base: null, copy });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('Cache-Control')).toBe('no-store');
    expect(Object.keys(saved.body).sort()).toEqual(['saved_at', 'version']);
    expect(Number.isNaN(Date.parse(saved.body.saved_at))).toBe(false);
    const back = await backup<Kept>('GET', D);
    expect([back.status, back.headers.get('Cache-Control')]).toEqual([200, 'no-store']);
    expect(back.body).toEqual({ version: saved.body.version, saved_at: saved.body.saved_at, copy });
    // The next save names that version and gets a new one.
    const next = await backup<Saved>('PUT', D, { base: saved.body.version, copy: { ...copy, keys: {} } });
    expect(next.status).toBe(200);
    expect(next.body.version).not.toBe(saved.body.version);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual({ astra: 'sync/1', keys: {} });
    const gone = await backup('DELETE', D);
    expect([gone.status, gone.text, gone.headers.get('Cache-Control')]).toEqual([204, '', 'no-store']);
    expect((await backup<Kept>('GET', D)).body).toEqual({ version: null, saved_at: null, copy: null });
  });
});

describe('another phone saved first', () => {
  it('a save on a version no longer kept is 409 conflict in the usual envelope, and changes nothing', async () => {
    const first = await backup<Saved>('PUT', D, { base: null, copy: small() });
    const late = await backup('PUT', D, { base: null, copy: copyOf({ settings: { hero: false } }) });
    expect([late.status, late.body.error?.code, late.body.error?.details]).toEqual([
      409,
      'conflict',
      { reason: 'stale_base' },
    ]);
    expect(typeof (late.body.error as { request_id?: string }).request_id).toBe('string');
    const stale = await backup('PUT', D, { base: '0192f0c4-0000-7000-8000-000000000000', copy: small() });
    expect(stale.status).toBe(409);
    expect((await backup<Kept>('GET', D)).body.version).toBe(first.body.version);
    // Nothing kept and a phone naming a version: also a conflict (the copy was removed meanwhile).
    await backup('DELETE', D);
    expect((await backup('PUT', D, { base: first.body.version, copy: small() })).status).toBe(409);
  });

  it('two phones saving on the same version at once: exactly one wins, by the bucket’s conditional write', async () => {
    const base = (await backup<Saved>('PUT', D, { base: null, copy: small() })).body.version;
    const [a, b] = await Promise.all([
      backup<Saved>('PUT', D, { base, copy: copyOf({ settings: { hero: true } }) }),
      backup<Saved>('PUT', D, { base, copy: copyOf({ settings: { hero: false } }) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? a : b;
    expect((await backup<Kept>('GET', D)).body.version).toBe(won.body.version);
  });
});

describe('the size of a copy', () => {
  it('a heavy real-shaped store (2,000 progress entries, 500 library titles, 3,000 watched) fits under 2 MiB', async () => {
    const copy = copyOf(realStore({ progress: 2000, library: 500, watched: 3000 }));
    const bytes = new TextEncoder().encode(JSON.stringify({ base: null, copy })).length;
    expect(bytes, `${bytes} bytes`).toBeLessThan(ASTRA_BACKUP.max_bytes);
    expect(bytes, `${bytes} bytes`).toBeGreaterThan(1024 * 1024);
    const saved = await backup<Saved>('PUT', D, { base: null, copy });
    expect(saved.status).toBe(200);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(copy);
  });

  it('past 2 MiB as sent is 413 too_large, and nothing is stored', async () => {
    const copy = copyOf({ recentSearches: ['x'.repeat(ASTRA_BACKUP.max_bytes)] });
    const r = await backup('PUT', D, { base: null, copy });
    expect([r.status, r.body.error?.code]).toEqual([413, 'too_large']);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
  });
});

describe('the outer shape', () => {
  const refused = async (body: unknown) => {
    const r = await backup('PUT', D, body);
    expect(r.text).not.toContain(ADDON_SECRET);
    expect(r.text).not.toContain('addon.example');
    return [r.status, r.body.error?.code];
  };
  const value = [{ url: ADDON, enabled: true, name: 'Invented' }];

  it('an object, the tag, known keys each with a time and a value; nothing sent is echoed', async () => {
    expect(await refused('not json')).toEqual([400, 'bad_request']);
    expect(await refused([])).toEqual([422, 'validation']);
    expect(await refused({ copy: small() })).toEqual([422, 'validation']);
    expect(await refused({ base: 7, copy: small() })).toEqual([422, 'validation']);
    expect(await refused({ base: null, copy: { astra: 'backup/1', keys: { addons: { at: 1, value } } } })).toEqual([
      422,
      'validation',
    ]);
    expect(await refused({ base: null, copy: { astra: 'sync/2', keys: {} } })).toEqual([422, 'validation']);
    expect(await refused({ base: null, copy: { astra: 'sync/1', keys: [] } })).toEqual([422, 'validation']);
    expect(await refused({ base: null, copy: { astra: 'sync/1', keys: {}, extra: ADDON } })).toEqual([
      422,
      'validation',
    ]);
    // A device key (the player's choices) never travels; nor an unknown one named after a secret.
    expect(await refused({ base: null, copy: copyOf({ player: { volume: 1 } }) })).toEqual([422, 'validation']);
    const named = await backup('PUT', D, {
      base: null,
      copy: { astra: 'sync/1', keys: { [ADDON]: { at: 1, value } } },
    });
    expect([named.status, named.text.includes(ADDON_SECRET)]).toEqual([422, false]);
    expect(await refused({ base: null, copy: { astra: 'sync/1', keys: { addons: { value } } } })).toEqual([
      422,
      'validation',
    ]);
    expect(await refused({ base: null, copy: { astra: 'sync/1', keys: { addons: { at: -1, value } } } })).toEqual([
      422,
      'validation',
    ]);
    // Add-ons carry when each address was had (`times`, an object), as the phones merge them address by address.
    expect(
      await refused({ base: null, copy: { astra: 'sync/1', keys: { addons: { at: 1, value, times: [1] } } } }),
    ).toEqual([422, 'validation']);
    // A time past a day from the Worker's clock (the security read's far-future probe): it would win every merge.
    const far = (at: number) => ({ base: null, copy: { astra: 'sync/1', keys: { addons: { at, value } } } });
    expect(await refused(far(9e15))).toEqual([422, 'validation']);
    expect(await refused(far(Date.now() + 864e5 + 60_000))).toEqual([422, 'validation']);
    expect(await refused({ base: null, copy: { astra: 'sync/1', keys: { addons: { at: 1 } } } })).toEqual([
      422,
      'validation',
    ]);
    expect(
      await refused({ base: null, copy: { astra: 'sync/1', keys: { addons: { at: 1, value, url: ADDON } } } }),
    ).toEqual([422, 'validation']);
    expect(
      await refused({ base: null, copy: { astra: 'sync/1', keys: { library: { at: 1, value: {}, gone: [ADDON] } } } }),
    ).toEqual([422, 'validation']);
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
    expect((await backup('PUT', D, { base: null, copy: odd })).status).toBe(200);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(odd);
  });
});

describe('without the bucket', () => {
  it('every route answers 503 unavailable, so the page carries on alone', async () => {
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const r = await backup(method, D, method === 'PUT' ? { base: null, copy: small() } : undefined, {
        VAULT: undefined,
      });
      expect([method, r.status, r.body.error?.code]).toEqual([method, 503, 'unavailable']);
    }
  });
});

describe('the count', () => {
  it('30 requests a minute in an isolate, GET, PUT and DELETE together, then 429 with Retry-After', async () => {
    for (let i = 0; i < 29; i++) expect((await backup('GET', D)).status).toBe(200);
    expect((await backup('PUT', D, { base: null, copy: small() })).status).toBe(200);
    const over = await backup('GET', D);
    expect([over.status, over.body.error?.code]).toEqual([429, 'rate_limited']);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await backup('DELETE', D)).status).toBe(429);
  });
});
