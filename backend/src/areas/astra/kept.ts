// What the relay remembers between asks for the same film, in this isolate's memory only (never
// stored, never logged, gone with the isolate), 30 minutes each, at most 200 of each kind:
// - a torrent in the owner's account: its hash → its TorBox id and file list. A second ask (the
//   tap after a press, "Try again", a renewal, the next tap) then costs requestdl alone; an id
//   TorBox no longer knows is forgotten and the full path runs once.
// - what a press learnt of a torrent TorBox has ready but the account does not hold yet: its file
//   list from checkcached (places, not TorBox's ids). The tap then needs createtorrent and requestdl,
//   without asking checkcached again.
import type { TorrentFile } from './files';

const KEEP_MS = 30 * 60_000;
const MAX = 200;
export interface Known {
  id: number;
  files: TorrentFile[];
}
export interface Ready {
  files: TorrentFile[];
}

/** One kind of memory: by hash, for half an hour, the oldest going first past MAX. */
function shelf<T>() {
  const kept = new Map<string, { value: T; until: number }>();
  return {
    get(hash: string, now = Date.now()): T | null {
      const k = kept.get(hash);
      if (k && k.until > now) return k.value;
      if (k) kept.delete(hash);
      return null;
    },
    put(hash: string, value: T, now = Date.now()): void {
      kept.delete(hash);
      kept.set(hash, { value, until: now + KEEP_MS });
      // A Map keeps the order things were put in.
      while (kept.size > MAX) kept.delete(kept.keys().next().value as string);
    },
    drop(hash?: string): void {
      if (hash === undefined) kept.clear();
      else kept.delete(hash);
    },
  };
}
const owned = shelf<Known>();
const ready = shelf<Ready>();

export const recall = (hash: string, now = Date.now()): Known | null => owned.get(hash, now);
export const recallReady = (hash: string, now = Date.now()): Ready | null => ready.get(hash, now);

/** A torrent found in the account; what a press learnt of it before is no longer needed. */
export function remember(hash: string, known: Known, now = Date.now()): void {
  ready.drop(hash);
  owned.put(hash, { id: known.id, files: known.files }, now);
}

export function rememberReady(hash: string, r: Ready, now = Date.now()): void {
  ready.put(hash, { files: r.files }, now);
}

/** For tests, for an id TorBox no longer knows, and for a torrent TorBox no longer has ready:
 * forgets one hash, or every one. */
export function forget(hash?: string): void {
  owned.drop(hash);
  ready.drop(hash);
}
