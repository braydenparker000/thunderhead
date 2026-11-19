// /v1/astra/backup (ASTRA.md §5.3, API.md §11.21, SECURITY.md §11): the owner's copy of Astra's data,
// so every phone they sign in on holds the same add-ons, library, progress, watched list, settings and
// recent searches. Who: the owner's device sessions only (route table `D`; the mind, Muse and CI get
// 403 before anything here runs). What is stored: the copy, sealed whole (backup-seal.ts), at one
// fixed name in the private bucket with the last 7 daily copies (backup-store.ts); the Worker checks
// only the outer shape (an object, the tag, known keys, each with a time) and never reads, parses
// further or logs what the keys hold, since add-on addresses are secrets. What can leak: nothing of
// the body reaches a log line, an error or a path; errors are fixed codes whose issues name a rule,
// never a value sent. Without the bucket (some local configs) every route answers 503 and the page
// carries on alone. Counted per isolate in memory like the relay: 30 requests a minute, then 429.
import { Hono } from 'hono';
import {
  type AstraBackupPut,
  type AstraBackupResponse,
  type AstraBackupSaved,
  type AstraCopy,
  ASTRA_BACKUP as B,
} from '../../../../shared/contract/astra.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { present } from '../../lib/secrets';
import { readBackup, removeBackup, writeBackup } from './backup-store';

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

/** The bucket and the pepper the seal's key comes from, or 503 unavailable. */
function placeOf(env: Env): { vault: R2Bucket; pepper: string } {
  const vault = (env as { VAULT?: R2Bucket }).VAULT;
  const pepper = present(env.AUTH_PEPPER);
  if (!vault || !pepper) throw new ApiError('unavailable', { reason: 'no_bucket' });
  return { vault, pepper };
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, names: readonly string[]) => Object.keys(o).every((k) => names.includes(k));
/** A shape failure: the path names only fields this contract knows, the issue a rule. */
const bad = (path: string, issue: string) => new ApiError('validation', [{ path, issue }]);

/** The PUT body's outer shape, checked without reading any key's value or removed entries. An `at` past a day
 * from the Worker's own clock is refused: a far-future time would win every merge on every phone. */
export function checkedPut(raw: unknown, now = Date.now()): AstraBackupPut {
  if (!isPlain(raw) || !only(raw, ['base', 'copy'])) throw bad('', 'an object with base and copy only');
  const { base, copy } = raw;
  if (base !== null && (typeof base !== 'string' || base.length < 1 || base.length > 64))
    throw bad('base', 'a version, or null');
  if (!isPlain(copy) || !only(copy, ['astra', 'keys']) || copy.astra !== B.tag)
    throw bad('copy', `an object tagged ${B.tag} with keys only`);
  if (!isPlain(copy.keys)) throw bad('copy.keys', 'an object');
  for (const [k, v] of Object.entries(copy.keys)) {
    if (!(B.keys as readonly string[]).includes(k)) throw bad('copy.keys', 'only the known keys');
    const at = isPlain(v) ? v.at : null;
    if (!isPlain(v) || !only(v, ['at', 'value', 'gone']) || !('value' in v))
      throw bad(`copy.keys.${k}`, 'at, value and gone only');
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > now + B.ahead_ms)
      throw bad(`copy.keys.${k}.at`, 'a time in ms, at most a day ahead');
    if ('gone' in v && !isPlain(v.gone)) throw bad(`copy.keys.${k}.gone`, 'an object');
  }
  return { base, copy: copy as unknown as AstraCopy };
}

export const backupRoutes = new Hono<AppEnv>()
  .get('/astra/backup', guard('GET /v1/astra/backup'), async (c) => {
    cap();
    const { vault, pepper } = placeOf(c.env);
    const kept = await readBackup(vault, pepper);
    c.header('Cache-Control', 'no-store');
    if (!kept) return c.json({ version: null, saved_at: null, copy: null } satisfies AstraBackupResponse);
    // The copy's text goes back as it was sealed (our own JSON, checked by the seal), never parsed here.
    const head = `{"version":${JSON.stringify(kept.version)},"saved_at":${JSON.stringify(kept.saved_at)},"copy":`;
    return c.body(`${head}${kept.text ?? 'null'}}`, 200, { 'Content-Type': 'application/json' });
  })
  .put('/astra/backup', guard('PUT /v1/astra/backup'), async (c) => {
    cap();
    const { vault, pepper } = placeOf(c.env);
    // The app's body limit refused a larger one already; counted again here, in bytes as sent.
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > B.max_bytes) throw new ApiError('too_large');
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    } catch {
      throw new ApiError('bad_request');
    }
    const { base, copy } = checkedPut(raw);
    const saved = await writeBackup(vault, pepper, base, JSON.stringify(copy), Date.now());
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
