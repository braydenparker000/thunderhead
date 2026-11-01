// SQL for the listening pass's per-track view (Music schema step 3, DATA.md §6.2): `track_analysis`,
// one row per track (not per audio hash), the shape other areas read (Music step 4's `listeningRows`):
// `energy` 0–1, `moods_json` (MUSIC_MOODS to 0–1) and `neighbours_json` (track ids, nearest first).
// Filled when results are applied (energy, moods) and by the neighbours step a page at a time (the
// whole row); a put that changes nothing writes nothing.
import type { Db } from '../../objects/base';

/** Every track holding this audio gets its energy and moods (its neighbours stay as they are). */
export function putTrackAnalysis(db: Db, sha256: string, energy: number, moodsJson: string | null): number {
  return db.run(
    `INSERT INTO track_analysis (track_id, energy, moods_json, neighbours_json)
     SELECT id, ?, ?, NULL FROM tracks WHERE sha256 = ?
     ON CONFLICT (track_id) DO UPDATE SET energy = excluded.energy, moods_json = excluded.moods_json
     WHERE track_analysis.energy IS NOT excluded.energy OR track_analysis.moods_json IS NOT excluded.moods_json`,
    energy,
    moodsJson,
    sha256,
  );
}

/** One track's whole row (the neighbours step fills a page of tracks at a time). */
export function putTrackRow(
  db: Db,
  r: { track_id: string; energy: number; moods_json: string | null; neighbours_json: string },
): number {
  return db.run(
    `INSERT INTO track_analysis (track_id, energy, moods_json, neighbours_json) VALUES (?, ?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET energy = excluded.energy, moods_json = excluded.moods_json,
       neighbours_json = excluded.neighbours_json
     WHERE track_analysis.energy IS NOT excluded.energy OR track_analysis.moods_json IS NOT excluded.moods_json
       OR track_analysis.neighbours_json IS NOT excluded.neighbours_json`,
    r.track_id,
    r.energy,
    r.moods_json,
    r.neighbours_json,
  );
}

/** Analysed tracks after `afterOrd`, in catalog order, `limit` at most: a page of the neighbours step. */
export function analysedTracks(
  db: Db,
  afterOrd: number,
  limit: number,
): { ord: number; id: string; sha256: string; result_json: string }[] {
  return db.all(
    `SELECT t.ord AS ord, t.id AS id, t.sha256 AS sha256, a.result_json AS result_json
     FROM tracks t JOIN analysis a ON a.sha256 = t.sha256
     WHERE a.result_json IS NOT NULL AND t.ord > ? ORDER BY t.ord LIMIT ?`,
    afterOrd,
    limit,
  );
}

/** Each audio hash's first track in catalog order. */
export function firstTracks(db: Db): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.all<{ id: string; sha256: string }>('SELECT id, sha256 FROM tracks ORDER BY ord'))
    if (!out.has(r.sha256)) out.set(r.sha256, r.id);
  return out;
}
