// Where the owner's Astra copy lives (DATA.md §7.1, `thunderhead-private`, binding VAULT): one sealed
// object at a fixed name, its version and save time as the object's only metadata, plus the copy as it
// stood at the start of each of the last 7 UTC days it changed, so a bad merge can be undone by hand.
// The bucket's conditional writes keep two phones from both winning: a save names the version it
// merged with, and the write goes through only while the object is still the one that version names
// (its etag), else it is a conflict and the phone fetches, merges and tries again. The text is sealed
// before it is stored (backup-seal.ts); nothing here logs it or reads inside it.
import { ASTRA_BACKUP } from '../../../../shared/contract/astra.ts';
import { uuidv7 } from '../../lib/ids';
import { openBackup, sealBackup } from './backup-seal';

export const BACKUP_NAME = 'astra/backup.json.enc';
export const BACKUP_DAYS = 'astra/days/';
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The version a phone names: the one written with the copy (an object without it: its etag). */
const versionOf = (o: R2Object) => o.customMetadata?.version || o.etag;
/** When the kept copy was saved, by the Worker's clock (the bucket's own time when unsaid). */
const savedAt = (o: R2Object) => Date.parse(o.customMetadata?.saved_at ?? '') || o.uploaded.getTime();

export interface KeptCopy {
  version: string;
  saved_at: string;
  /** The copy's JSON text, or null when it does not open (damaged, moved, another pepper). */
  text: string | null;
}

/** The kept copy, opened; null when none is kept. */
export async function readBackup(vault: R2Bucket, pepper: string): Promise<KeptCopy | null> {
  const o = await vault.get(BACKUP_NAME);
  if (!o) return null;
  const version = versionOf(o);
  const saved_at = new Date(savedAt(o)).toISOString();
  const text = await openBackup(pepper, BACKUP_NAME, version, new Uint8Array(await o.arrayBuffer()));
  return { version, saved_at, text };
}

/** Seals and stores `text` in place of the copy `base` names (null: none is kept). 'conflict' when
 * another copy is kept now, or one was written meanwhile. */
export async function writeBackup(
  vault: R2Bucket,
  pepper: string,
  base: string | null,
  text: string,
  now: number,
): Promise<{ version: string; saved_at: string } | 'conflict'> {
  const head = await vault.head(BACKUP_NAME);
  if ((head ? versionOf(head) : null) !== base) return 'conflict';
  // The first save of a UTC day keeps the copy as it stood at the day's start (at most one a day).
  if (head && dayOf(savedAt(head)) < dayOf(now)) await keepDay(vault, head, dayOf(now));
  const version = uuidv7(now);
  const saved_at = new Date(now).toISOString();
  const sealed = await sealBackup(pepper, BACKUP_NAME, version, text);
  const put = await vault.put(BACKUP_NAME, sealed, {
    // Only over exactly the object read above, or only where none is: R2 refuses it otherwise.
    onlyIf: head ? { etagMatches: head.etag } : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { version, saved_at },
  });
  return put ? { version, saved_at } : 'conflict';
}

/** Copies the kept object, sealed as it is, to `astra/days/<day>.json.enc`, and drops all but the
 * newest 7. Its additional data still names the main object, so it opens only when put back there
 * (with its metadata): that is the undo by hand (ASTRA.md §5.3). */
async function keepDay(vault: R2Bucket, head: R2Object, day: string): Promise<void> {
  const o = await vault.get(BACKUP_NAME, { onlyIf: { etagMatches: head.etag } });
  // Replaced meanwhile: the phone that replaced it kept the day.
  if (!o || !('body' in o)) return;
  await vault.put(`${BACKUP_DAYS}${day}.json.enc`, await o.arrayBuffer(), {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: o.customMetadata,
  });
  const days = (await vault.list({ prefix: BACKUP_DAYS })).objects.map((x) => x.key).sort();
  if (days.length > ASTRA_BACKUP.days) await vault.delete(days.slice(0, days.length - ASTRA_BACKUP.days));
}

/** Removes the copy and every daily copy. */
export async function removeBackup(vault: R2Bucket): Promise<void> {
  const days = (await vault.list({ prefix: BACKUP_DAYS })).objects.map((o) => o.key);
  await vault.delete([BACKUP_NAME, ...days]);
}
