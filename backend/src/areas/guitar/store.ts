// SQL for Guitar's progress inside Core (DATA.md §4.1, GUITAR.md §1.1). A write is one upsert per
// song that changes the row only when its `updated_at` is newer (the newer wins); an older or equal
// one writes nothing. A page walks the `synced_at` index from the caller's cursor, so it reads the
// rows it returns. Nothing here writes the change feed: the phones ask by time when Guitar opens.
import { GUITAR_LIMITS, type GuitarProgress } from '../../../../shared/contract/guitar.ts';
import type { Db } from '../../objects/base';

export interface ProgressRow {
  key: string;
  body: string;
  updated_at: number;
  synced_at: number;
}

/** One song's record, kept if newer. Returns whether it was. */
export function putProgress(db: Db, p: GuitarProgress, at: number): boolean {
  const body = JSON.stringify({ song: p.song, ladder: p.ladder, days: p.days, phone_at: p.phone_at });
  return (
    db.run(
      `INSERT INTO guitar_progress (key, body, updated_at, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, synced_at = excluded.synced_at
       WHERE excluded.updated_at > guitar_progress.updated_at`,
      p.key,
      body,
      p.updated_at,
      at,
    ) > 0
  );
}

/** Records taken after the `[synced_at, key]` cursor, oldest first. */
export const progressPage = (db: Db, after: [number, string], limit: number) =>
  db.all<ProgressRow>(
    `SELECT key, body, updated_at, synced_at FROM guitar_progress
     WHERE (synced_at, key) > (?, ?) ORDER BY synced_at, key LIMIT ?`,
    after[0],
    after[1],
    limit,
  );

/** A row as the phone reads it. */
export function toProgress(r: ProgressRow): GuitarProgress {
  const b = JSON.parse(r.body) as Omit<GuitarProgress, 'key' | 'updated_at'>;
  return { key: r.key, song: b.song, ladder: b.ladder, days: b.days, phone_at: b.phone_at, updated_at: r.updated_at };
}

/** The newest 1,000 records by `updated_at` stay; the rest go, at most `max` a call (DATA.md §10). */
export function pruneProgress(db: Db, _now: number, max: number): number {
  const old = db.all<{ key: string }>(
    'SELECT key FROM guitar_progress ORDER BY updated_at DESC, key DESC LIMIT ? OFFSET ?',
    max,
    GUITAR_LIMITS.progress_keep,
  );
  for (const { key } of old) db.run('DELETE FROM guitar_progress WHERE key = ?', key);
  return old.length;
}
