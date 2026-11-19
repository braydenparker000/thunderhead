// /v1/astra/backup (ASTRA.md §5.3, API.md §11.21, SECURITY.md §11): the owner's copy of Astra's data,
// so every phone they sign in on holds the same add-ons, library, progress, watched list, settings and
// recent searches. Who: the owner's device sessions only (route table `D`; the mind, Muse and CI get
// 403 before anything here runs). What is stored: the copy, sealed whole (backup-seal.ts), at one
// fixed name in the private bucket with the last 7 daily copies (backup-store.ts); the Worker checks
// only the outer shape (an object, the tag, known keys, each with a time) and never reads further or
// logs what the keys hold, since add-on addresses are secrets. The Free plan gives about 10 ms of CPU
// a request: the copy is parsed once and sealed as sent, a GET with the version the phone holds is
// answered from the object's head alone, and a copy is 1 MiB at most. What can leak: nothing of
// the body reaches a log line, an error or a path; errors are fixed codes whose issues name a rule,
// never a value sent. Without the bucket (some local configs) every route answers 503 and the page
// carries on alone. Counted per isolate in memory like the relay: 30 requests a minute, then 429.
import { Hono } from 'hono';
import {
  type AstraBackupResponse,
  type AstraBackupSaved,
  type AstraCopy,
  ASTRA_BACKUP as B,
} from '../../../../shared/contract/astra.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { present } from '../../lib/secrets';
import { headBackup, type Pepper, readBackup, removeBackup, writeBackup } from './backup-store';

let minute = { start: 0, n: 0 };
/** For tests: a fresh minute. */
export function forgetBackupMinute(): void {
  minute = { start: 0, n: 0 };
}
/** Past 30 in this isolate's minute: 429 with the seconds until the next one. */
function cap(now = Date.now()): void {
  if (now - minute.start >= 60_000) minute = { start: now, n: 0 };
  if (++minute.n <= B.per_minute) return;
  const retry_after = Math.max(1, Math.ceil((minute.start + 60_000 - now) / 1000));
  throw new ApiError('rate_limited', { reason: 'too_many' }, { retry_after, scope: 'account' });
}

/** The bucket and the peppers the seal's key comes from, newest first, or 503 unavailable. Today there is one,
 * AUTH_PEPPER; a rotation adds AUTH_PEPPER_V2 (SECURITY.md §14.6), which then goes first here (and is declared in
 * wrangler.jsonc and the static test's inventory), and the copy is re-sealed under it at its next save. */
function placeOf(env: Env): { vault: R2Bucket; peppers: Pepper[] } {
  const vault = (env as { VAULT?: R2Bucket }).VAULT;
  const pepper = present(env.AUTH_PEPPER);
  if (!vault || !pepper) throw new ApiError('unavailable', { reason: 'no_bucket' });
  return { vault, peppers: [{ name: 'AUTH_PEPPER', value: pepper }] };
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, names: readonly string[]) => Object.keys(o).every((k) => names.includes(k));
/** A shape failure: the path names only fields this contract knows, the issue a rule. */
const bad = (path: string, issue: string) => new ApiError('validation', [{ path, issue }]);
/** A version in a query: an opaque id (ours are random base64url; an old object's etag is hex). */
const VERSION = /^[A-Za-z0-9_-]{1,64}$/;
const BOM = [0xef, 0xbb, 0xbf];
const enc = new TextEncoder();

/** A version named in the query, or null when none is; anything else is refused. */
function versionIn(value: string | undefined, name: string): string | null {
  if (value === undefined) return null;
  if (!VERSION.test(value)) throw bad(name, 'a version');
  return value;
}

/**
 * The PUT body, the copy as the phone sent it: parsed once to check its outer shape (an object tagged sync/1 with
 * known keys, each with a time at most a day ahead of the Worker's clock, a value, and objects for `gone` and
 * `times`); what the keys hold is not read. Its bytes are then sealed as they came (no second encoding): JSON
 * text without a byte-order mark, so they can go back inside the GET envelope as they are.
 */
export function checkedCopy(bytes: Uint8Array, now = Date.now()): AstraCopy {
  if (bytes.byteLength > B.max_bytes) throw new ApiError('too_large');
  if (BOM.every((b, i) => bytes[i] === b)) throw new ApiError('bad_request');
  let copy: unknown;
  try {
    copy = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new ApiError('bad_request');
  }
  if (!isPlain(copy) || !only(copy, ['astra', 'keys']) || copy.astra !== B.tag)
    throw bad('copy', `an object tagged ${B.tag} with keys only`);
  if (!isPlain(copy.keys)) throw bad('copy.keys', 'an object');
  for (const [k, v] of Object.entries(copy.keys)) {
    if (!(B.keys as readonly string[]).includes(k)) throw bad('copy.keys', 'only the known keys');
    const at = isPlain(v) ? v.at : null;
    if (!isPlain(v) || !only(v, ['at', 'value', 'gone', 'times']) || !('value' in v))
      throw bad(`copy.keys.${k}`, 'at, value, gone and times only');
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > now + B.ahead_ms)
      throw bad(`copy.keys.${k}.at`, 'a time in ms, at most a day ahead');
    if ('gone' in v && !isPlain(v.gone)) throw bad(`copy.keys.${k}.gone`, 'an object');
    if ('times' in v && !isPlain(v.times)) throw bad(`copy.keys.${k}.times`, 'an object');
  }
  return copy as unknown as AstraCopy;
}

/** The GET answer around the copy's bytes, built from byte pieces: the bytes are never decoded or encoded again. */
export function envelope(version: string, saved_at: string, copy: Uint8Array | null): Uint8Array<ArrayBuffer> {
  const head = enc.encode(`{"version":${JSON.stringify(version)},"saved_at":${JSON.stringify(saved_at)},"copy":`);
  const middle = copy ?? enc.encode('null');
  const out = new Uint8Array(head.length + middle.length + 1);
  out.set(head);
  out.set(middle, head.length);
  out[out.length - 1] = 0x7d; // }
  return out;
}

export const backupRoutes = new Hono<AppEnv>()
  .get('/astra/backup', guard('GET /v1/astra/backup'), async (c) => {
    cap();
    const { vault, peppers } = placeOf(c.env);
    const known = versionIn(c.req.query('known'), 'known');
    c.header('Cache-Control', 'no-store');
    // The phone holds that version already: answered from the object's head, nothing read or opened.
    if (known) {
      const head = await headBackup(vault);
      if (head?.version === known) return c.json({ ...head, same: true } satisfies AstraBackupResponse);
    }
    const kept = await readBackup(vault, peppers);
    if (!kept) return c.json({ version: null, saved_at: null, copy: null } satisfies AstraBackupResponse);
    return c.body(envelope(kept.version, kept.saved_at, kept.bytes), 200, { 'Content-Type': 'application/json' });
  })
  .put('/astra/backup', guard('PUT /v1/astra/backup'), async (c) => {
    cap();
    const { vault, peppers } = placeOf(c.env);
    const base = versionIn(c.req.query('base'), 'base');
    // The app's body limit refused a larger one already (by its length); counted again here, as sent.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    checkedCopy(bytes);
    const saved = await writeBackup(vault, peppers, base, bytes, Date.now());
    if (saved === 'conflict') throw new ApiError('conflict', { reason: 'stale_base' });
    c.header('Cache-Control', 'no-store');
    return c.json(saved satisfies AstraBackupSaved);
  })
  .delete('/astra/backup', guard('DELETE /v1/astra/backup'), async (c) => {
    cap();
    await removeBackup(placeOf(c.env).vault);
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });
