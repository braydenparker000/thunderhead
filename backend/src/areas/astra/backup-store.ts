// Where the owner's Astra copy lives (DATA.md §7.1, `thunderhead-private`, binding VAULT): one sealed
// object at a fixed name, its version and save time as the object's only metadata, plus the copy as it
// stood at the start of each of the last 7 UTC days it changed, so a bad merge can be undone by hand.
// The bucket's conditional writes keep two phones from both winning: a save names the version it
// merged with, and the write goes through only while the object is still the one that version names
// (its etag), else it is a conflict and the phone fetches, merges and tries again. The text is sealed
// before it is stored (backup-seal.ts); nothing here logs it or reads inside it.
//
// Pepper rotation (SECURITY.md §14.5, §14.6): the seal's key comes from a pepper, and the peppers come newest first
// (`Pepper[]`). A copy is opened with the pepper its metadata names (`seal`), then the others; it is always sealed
// with the newest, so after a rotation the next save re-seals it. That save also removes the daily copies, which
// were sealed under the older pepper: nothing sealed under it outlives the first save after the rotation.
import { ASTRA_BACKUP } from '../../../../shared/contract/astra.ts';
import { openBackup, sealBackup } from './backup-seal';

export const BACKUP_NAME = 'astra/backup.json.enc';
export const BACKUP_DAYS = 'astra/days/';
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** A pepper by its Worker secret's name; a list of them comes newest first. */
export interface Pepper {
  name: string;
  value: string;
}
/** The pepper an object was sealed under (objects from before the field: the first pepper, AUTH_PEPPER). */
const sealOf = (o: R2Object) => o.customMetadata?.seal || 'AUTH_PEPPER';
/** Opens sealed bytes with the pepper named first, then the others. */
async function openWith(peppers: Pepper[], named: string, version: string, sealed: Uint8Array) {
  for (const p of [...peppers].sort((a, b) => Number(b.name === named) - Number(a.name === named))) {
    const out = await openBackup(p.value, BACKUP_NAME, version, sealed);
    if (out) return out;
  }
  return null;
}
/** The version a phone names: the one written with the copy (an object without it: its etag). */
const versionOf = (o: R2Object) => o.customMetadata?.version || o.etag;
/** When the kept copy was saved, by the Worker's clock (the bucket's own time when unsaid). */
const savedAt = (o: R2Object) => Date.parse(o.customMetadata?.saved_at ?? '') || o.uploaded.getTime();

export interface KeptCopy {
  version: string;
  saved_at: string;
  /** The copy's bytes as a phone sent them, or null when they do not open (damaged, moved, another pepper). */
  bytes: Uint8Array | null;
}

/** A new version: an opaque random id (it travels in a query, so it says nothing, not even when). */
const newVersion = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The kept copy's version and time from its head alone (nothing read or opened); null when none is kept. */
export async function headBackup(vault: R2Bucket): Promise<{ version: string; saved_at: string } | null> {
  const o = await vault.head(BACKUP_NAME);
  return o ? { version: versionOf(o), saved_at: new Date(savedAt(o)).toISOString() } : null;
}

/** The kept copy, opened; null when none is kept. */
export async function readBackup(vault: R2Bucket, peppers: Pepper[]): Promise<KeptCopy | null> {
  const o = await vault.get(BACKUP_NAME);
  if (!o) return null;
  const version = versionOf(o);
  const saved_at = new Date(savedAt(o)).toISOString();
  const bytes = await openWith(peppers, sealOf(o), version, new Uint8Array(await o.arrayBuffer()));
  return { version, saved_at, bytes };
}

/** Seals and stores the copy's bytes, as sent, in place of the copy `base` names (null: none is kept).
 * 'conflict' when another copy is kept now, or one was written meanwhile. */
export async function writeBackup(
  vault: R2Bucket,
  peppers: Pepper[],
  base: string | null,
  bytes: Uint8Array,
  now: number,
): Promise<{ version: string; saved_at: string } | 'conflict'> {
  const head = await vault.head(BACKUP_NAME);
  if ((head ? versionOf(head) : null) !== base) return 'conflict';
  const [newest] = peppers;
  // Sealed under an older pepper: re-sealed now, and no daily copy is made of it (they all go below).
  const rotated = head !== null && sealOf(head) !== newest.name;
  // The first save of a UTC day keeps the copy as it stood at the day's start (at most one a day).
  if (head && !rotated && dayOf(savedAt(head)) < dayOf(now)) await keepDay(vault, head, dayOf(now));
  const version = newVersion();
  const saved_at = new Date(now).toISOString();
  const sealed = await sealBackup(newest.value, BACKUP_NAME, version, bytes);
  const put = await vault.put(BACKUP_NAME, sealed, {
    // Only over exactly the object read above, or only where none is: R2 refuses it otherwise.
    onlyIf: head ? { etagMatches: head.etag } : new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { version, saved_at, seal: newest.name },
  });
  if (put && rotated) await removeDays(vault);
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

/** Removes every daily copy. */
async function removeDays(vault: R2Bucket): Promise<void> {
  const days = (await vault.list({ prefix: BACKUP_DAYS })).objects.map((o) => o.key);
  if (days.length) await vault.delete(days);
}

/** Removes the copy and every daily copy. */
export async function removeBackup(vault: R2Bucket): Promise<void> {
  await removeDays(vault);
  await vault.delete(BACKUP_NAME);
}
