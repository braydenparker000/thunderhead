// An export file the owner dropped, read into its summary (MUSIC.md §16.1): a zip's history entries
// (history-zip.ts) or the one json or csv, each parsed (history-parse.ts) and summed by artist, album
// and year. A zip holding more than one kind of export keeps its first kind's files.
import type { TasteSource } from '../../../../shared/contract/taste.ts';
import { type Play, parseExport, type SummaryRow, sourceOf, summarise } from './history-parse';
import { historyEntries, isZip, zipEntries } from './history-zip';

export interface ReadExport {
  source: TasteSource;
  rows: SummaryRow[];
  skipped: number;
}

/** The file's kind from its name or its first bytes, for the upload's answer; null when not one. */
export function kindOf(name: string, b: Uint8Array): 'zip' | 'json' | 'csv' | null {
  if (isZip(b)) return 'zip';
  if (/\.csv$/i.test(name)) return 'csv';
  const first = b.find((c) => c > 0x20);
  return first === 0x5b || first === 0x7b ? 'json' : null;
}

/** The export's kind from names alone (a zip's entries' are read from its directory, nothing inflated). */
export function guessSource(name: string, b: Uint8Array): TasteSource | null {
  const names = isZip(b) ? historyEntries(zipEntries(b) ?? []).map((e) => e.name) : [name];
  for (const n of names) {
    const s = sourceOf(n, null);
    if (s) return s;
  }
  return null;
}

export async function readExport(name: string, bytes: Uint8Array): Promise<ReadExport | null> {
  const files: { name: string; read: () => Promise<string> }[] = isZip(bytes)
    ? historyEntries(zipEntries(bytes) ?? [])
    : [{ name, read: async () => new TextDecoder().decode(bytes) }];
  let source: TasteSource | null = null;
  const plays: Play[] = [];
  let skipped = 0;
  for (const f of files) {
    const p = parseExport(f.name, await f.read());
    if (!p || (source && p.source !== source)) continue;
    source = p.source;
    for (const x of p.plays) plays.push(x);
    skipped += p.skipped;
  }
  return source ? { source, rows: summarise(plays), skipped } : null;
}

/** The parts of a summary, `size` rows each. */
export const partsOf = <T>(rows: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
