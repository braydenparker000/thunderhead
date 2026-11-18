// What the relay remembers between asks for the same film, in this isolate's memory only (never
// stored, gone with the isolate): a torrent's hash → its TorBox id and file list, 30 minutes each,
// at most 200. A second ask (the tap after a press, "Try again", a renewal, the next tap) then costs
// requestdl alone; an id TorBox no longer knows is forgotten and the full path runs once.
import type { TorrentFile } from './files';

const KEEP_MS = 30 * 60_000;
const MAX = 200;
export interface Known {
  id: number;
  files: TorrentFile[];
}
const kept = new Map<string, Known & { until: number }>();

export function recall(hash: string, now = Date.now()): Known | null {
  const k = kept.get(hash);
  if (k && k.until > now) return { id: k.id, files: k.files };
  if (k) kept.delete(hash);
  return null;
}

export function remember(hash: string, known: Known, now = Date.now()): void {
  kept.delete(hash);
  kept.set(hash, { ...known, until: now + KEEP_MS });
  // The oldest goes first (a Map keeps the order things were put in).
  while (kept.size > MAX) kept.delete(kept.keys().next().value as string);
}

/** For tests, and for an id TorBox no longer knows: forgets one hash, or every one. */
export function forget(hash?: string): void {
  if (hash === undefined) kept.clear();
  else kept.delete(hash);
}
