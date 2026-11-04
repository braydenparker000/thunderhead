// SQL for the mixes `music.mix_save` keeps (Core schema step 29, DATA.md §4.3): a name, the songs
// (`music:<id>` refs, in order) and the one line they were found by, under the id of the verb that
// saved it. `music.play_mix {mix_id}` hands its songs to the phone; GET /v1/music/mixes lists them.
// The newest MIXES_KEEP stay. Stores never write the change feed.
import type { MusicMix, MusicMixSongs } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export const MIXES_KEEP = 50;

interface Row {
  id: string;
  name: string;
  refs_json: string;
  tracks: number;
  recipe: string | null;
  actor: string;
  created_at: number;
}

export function insert(db: Db, m: Omit<Row, 'tracks'>): void {
  db.run(
    'INSERT INTO mixes (id, name, refs_json, tracks, recipe, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    m.id,
    m.name,
    m.refs_json,
    (JSON.parse(m.refs_json) as unknown[]).length,
    m.recipe,
    m.actor,
    m.created_at,
  );
}

/** A mix's songs, or null when there is no such mix (one read by the key). */
export function refsOf(db: Db, id: string): string[] | null {
  const r = db.one<{ refs_json: string }>('SELECT refs_json FROM mixes WHERE id = ?', id);
  return r ? (JSON.parse(r.refs_json) as string[]) : null;
}

/** One mix's name and songs in order, or null (one read by the key). */
export function songs(db: Db, id: string): MusicMixSongs | null {
  const r = db.one<{ name: string; refs_json: string }>('SELECT name, refs_json FROM mixes WHERE id = ?', id);
  return r ? { id, name: r.name, refs: JSON.parse(r.refs_json) as string[] } : null;
}

/** Deletes one mix; whether there was one. */
export function remove(db: Db, id: string): boolean {
  return db.all('DELETE FROM mixes WHERE id = ? RETURNING 1', id).length > 0;
}

/** The mixes, newest first (at most MIXES_KEEP rows, through the time index). */
export function list(db: Db): MusicMix[] {
  return db.all<Omit<Row, 'refs_json' | 'actor'>>(
    'SELECT id, name, tracks, recipe, created_at FROM mixes ORDER BY created_at DESC, id DESC LIMIT ?',
    MIXES_KEEP,
  );
}

/** Past the newest MIXES_KEEP, the oldest go (DATA.md §10). */
export function pruneMixes(db: Db, _now: number, max: number): number {
  const old = db.all<{ id: string }>(
    'SELECT id FROM mixes ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    max,
    MIXES_KEEP,
  );
  for (const { id } of old) db.run('DELETE FROM mixes WHERE id = ?', id);
  return old.length;
}
