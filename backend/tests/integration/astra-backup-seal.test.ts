// The owner's Astra copy at rest (ASTRA.md §5.3, SECURITY.md §11): the bucket holds no plain text of an
// invented add-on address, only the sealed bytes and a version and a time; a copy damaged by one bit,
// given another version or moved does not open (the page then gets `copy: null` and its next save
// replaces it); the copy as it stood at the start of each of the last 7 days it changed is kept and
// opens when put back by hand; nothing of a body reaches a log line, also when the bucket fails with
// the address in its message. Invented add-ons, titles and times.
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetBackupMinute } from '../../src/areas/astra/backup';
import { openBackup } from '../../src/areas/astra/backup-seal';
import { BACKUP_DAYS, BACKUP_NAME, readBackup, removeBackup, writeBackup } from '../../src/areas/astra/backup-store';
import { ADDON, ADDON_SECRET, backup, copyOf, put, realStore } from '../astra-backup-helpers';
import { setupOwner } from '../helpers';

const PEPPER = 'test-pepper-not-a-real-secret-0123456789';
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-01T09:00:00Z');
let D = '';
type Kept = { version: string | null; saved_at: string | null; copy: unknown };
const bytesOf = async (key: string) => new Uint8Array(await ((await env.VAULT.get(key)) as R2ObjectBody).arrayBuffer());
const bytesOfCopy = (copy: unknown) => new TextEncoder().encode(JSON.stringify(copy));
const contains = (hay: Uint8Array, needle: string) => {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
};

beforeAll(async () => {
  D = (await setupOwner()).token;
});
beforeEach(async () => {
  forgetBackupMinute();
  await removeBackup(env.VAULT);
});
afterEach(() => vi.restoreAllMocks());

describe('what the bucket holds', () => {
  it('no plain text of an add-on address, a title or a key name: sealed bytes, a version and a time', async () => {
    const store = realStore({ progress: 40, library: 10, watched: 20 });
    await put(D, copyOf(store));
    // A second save on a later day keeps a daily copy too: it is checked the same way.
    const kept = await readBackup(env.VAULT, PEPPER);
    await writeBackup(env.VAULT, PEPPER, kept?.version ?? null, bytesOfCopy(copyOf(store)), Date.now() + 2 * DAY);
    const objects = (await env.VAULT.list({ prefix: 'astra/', include: ['customMetadata', 'httpMetadata'] })).objects;
    expect(objects.map((o) => o.key.replace(/\d{4}-\d\d-\d\d/, 'DAY')).sort()).toEqual([
      BACKUP_NAME,
      `${BACKUP_DAYS}DAY.json.enc`,
    ]);
    const secrets = [
      ADDON,
      ADDON_SECRET,
      'addon.example',
      'Invented Streams',
      'An Invented',
      'progress',
      'sync/1',
      'tt100',
    ];
    for (const o of objects) {
      expect(Object.keys(o.customMetadata ?? {}).sort()).toEqual(['saved_at', 'version']);
      expect(o.httpMetadata?.contentType).toBe('application/octet-stream');
      const bytes = await bytesOf(o.key);
      for (const s of secrets) expect(contains(bytes, s), `${o.key} holds ${s}`).toBe(false);
      // Nor as base64 of the address (sealed bytes are random-looking, never an encoding of the text).
      expect(contains(bytes, btoa(ADDON).slice(0, 24))).toBe(false);
    }
  });

  it('two saves of the same copy are different bytes (a fresh nonce each time)', async () => {
    const text = bytesOfCopy(copyOf({ settings: { hero: true } }));
    const a = await writeBackup(env.VAULT, PEPPER, null, text, Date.now());
    const first = await bytesOf(BACKUP_NAME);
    await writeBackup(env.VAULT, PEPPER, a === 'conflict' ? null : a.version, text, Date.now());
    const second = await bytesOf(BACKUP_NAME);
    expect(first.subarray(1, 13)).not.toEqual(second.subarray(1, 13));
  });
});

describe('a tampered copy is refused', () => {
  const plant = (bytes: Uint8Array, customMetadata: Record<string, string>) =>
    env.VAULT.put(BACKUP_NAME, bytes, { customMetadata });

  it('one bit changed, another version named, or a copy moved here: `copy: null`, and the next save replaces it', async () => {
    const copy = copyOf(realStore({ progress: 2, library: 1, watched: 1 }));
    await put(D, copy);
    const meta = (await env.VAULT.head(BACKUP_NAME))?.customMetadata as Record<string, string>;
    const good = await bytesOf(BACKUP_NAME);
    for (const i of [0, 5, 40, good.length - 1]) {
      const bad = good.slice();
      bad[i] ^= 1;
      await plant(bad, meta);
      const r = await backup<Kept>('GET', D);
      expect([i, r.status, r.body.copy, r.body.version]).toEqual([i, 200, null, meta.version]);
      expect(r.text).not.toContain('addon.example');
    }
    // The right bytes under another version, and a copy sealed for another name.
    await plant(good, { ...meta, version: '0192f0c4-0000-7000-8000-00000000000f' });
    expect((await backup<Kept>('GET', D)).body.copy).toBeNull();
    expect(await openBackup(PEPPER, `${BACKUP_DAYS}2026-11-01.json.enc`, meta.version, good)).toBeNull();
    expect(await openBackup('another-pepper-0123456789abcdef0123', BACKUP_NAME, meta.version, good)).toBeNull();
    // A save on the damaged copy's version replaces it.
    const damaged = await backup<Kept>('GET', D);
    expect((await put(D, copy, damaged.body.version)).status).toBe(200);
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(copy);
  });
});

describe('the daily copies', () => {
  it('the copy as it stood at the start of each of the last 7 days it changed; one opens again when put back', async () => {
    let version: string | null = null;
    const save = async (day: number, n: number) => {
      const r = await writeBackup(
        env.VAULT,
        PEPPER,
        version,
        bytesOfCopy(copyOf({ recentSearches: [`day ${n}`] })),
        T0 + day * DAY,
      );
      if (r === 'conflict') throw new Error('conflict');
      version = r.version;
    };
    // Day 0 twice (no daily copy: nothing stood before it), then ten more days of changes, two of them skipped.
    await save(0, 0);
    await save(0, 1);
    for (const day of [1, 2, 3, 5, 6, 7, 8, 9, 10, 12]) await save(day, day * 10);
    const days = (await env.VAULT.list({ prefix: BACKUP_DAYS })).objects.map((o) =>
      o.key.slice(BACKUP_DAYS.length, -9),
    );
    expect(days).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-13',
    ]);
    // The undo by hand: the copy of 2026-11-09 (as day 8 began, so day 7's save) put back at the fixed name.
    const day = (await env.VAULT.get(`${BACKUP_DAYS}2026-11-09.json.enc`)) as R2ObjectBody;
    await env.VAULT.put(BACKUP_NAME, await day.arrayBuffer(), { customMetadata: day.customMetadata });
    expect((await backup<Kept>('GET', D)).body.copy).toEqual(copyOf({ recentSearches: ['day 70'] }));
    // Removing the copy removes the daily ones too.
    expect((await backup('DELETE', D)).status).toBe(204);
    expect((await env.VAULT.list({ prefix: 'astra/' })).objects).toEqual([]);
  });
});

describe('nothing of a body is logged (ASTRA.md §5.3: a log capture)', () => {
  it('no address, title or key name in any log line or answer, a bucket failure carrying the address included', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const copy = copyOf(realStore({ progress: 5, library: 3, watched: 3 }));
    const answers: string[] = [];
    const saved = await put(D, copy);
    answers.push(saved.text, (await put(D, copy)).text);
    answers.push((await put(D, { ...copy, keys: { ...copy.keys, [ADDON]: {} } })).text);
    answers.push((await put(D, JSON.stringify(copy).slice(0, -2))).text);
    answers.push(
      (await backup('GET', D, { query: `?known=${saved.body.version}` })).text,
      (await backup('GET', D)).text.slice(0, 80),
    );
    // A bucket that fails with the copy's address in its message: logged by the error's name only.
    const failing = {
      head: async () => null,
      put: async () => {
        throw new Error(`write failed for ${ADDON}`);
      },
    } as unknown as R2Bucket;
    const broken = await put(D, copy, null, { VAULT: failing });
    expect([broken.status, broken.body.error?.code]).toEqual([500, 'internal']);
    answers.push(broken.text);
    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, ...answers])
      for (const s of [ADDON, ADDON_SECRET, 'addon.example', 'Invented Streams', 'An Invented', 'images.example'])
        expect(text, s).not.toContain(s);
  });
});
