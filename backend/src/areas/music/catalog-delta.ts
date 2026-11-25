// The catalog in changes (GET /v1/music/catalog?since=, MUSIC.md §1.3): what changed after the copy a
// phone holds, read from the change log (`catalog_log`), never from the whole table. Every writer
// change logs its song at its commit's time, and each commit's time is after the last one's (music.ts),
// so the log walked back from its newest row, by its key, to the first row at or before `since` names
// every song changed since, and a `delete` row names one removed. The log cannot say exactly, and the whole catalog is
// sent, when `since` is not a time the catalog had, is at or before the last change the log does not
// hold (an import, `floor`), is older than the log's oldest kept row, or more than 6,000 songs
// changed. Rows read: the log's rows since (at most its 20,000 kept), a page more, and the changed
// songs by key: 6,000 songs changed once each about 12,400 (the cost suite's music-scale test bounds
// it), at most about 26,500 (the whole log), half a percent of the day's 5,000,000 at worst; the
// answer about 14 MB, 40% of the whole catalog's 35 MB (2.4 KB a song), which it spares. It was
// 2,000 songs (and 8,000 log rows) until 2026-11-25.
import type { Db } from '../../objects/base';
import { withAlbumId } from './album-id';
import { type CatalogVersion, LOG_KEEP } from './store';

/** Pages of the log grow from 25 rows to 400, so a small change reads a few rows. */
export const DELTA = { max_songs: 6_000, max_log_rows: LOG_KEEP, first_page: 25, page: 400 } as const;

/** A catalog row as the catalog's build reads it. */
export interface CatalogRow {
  record_json: string;
  w: number;
  u: number;
}

/** One track as the catalog gives it: its record (with its album id, album-id.ts), and `waveformBars`
 * and `waveformAt` (the row's last change) when it has a waveform to fetch. */
export function catalogTrack(r: CatalogRow): string {
  const json = withAlbumId(r.record_json);
  return r.w ? `${json.slice(0, -1)},"waveformBars":true,"waveformAt":${r.u}}` : json;
}

/** The ids of the songs changed (or removed) after `since`, newest first; null when the log cannot say
 * exactly: `since` must be the current version's time or a row's (the held copy's own change). */
export function changedIds(db: Db, since: number, v: CatalogVersion): string[] | null {
  if (v.count === undefined || since <= (v.floor ?? v.changed_at) || since > v.changed_at) return null;
  const ids = new Set<string>();
  const current = since === v.changed_at;
  let below = Number.MAX_SAFE_INTEGER;
  let page: number = DELTA.first_page;
  let read = 0;
  while (read < DELTA.max_log_rows) {
    const rows = db.all<{ seq: number; at: number; track_id: string | null }>(
      'SELECT seq, at, track_id FROM catalog_log WHERE seq < ? ORDER BY seq DESC LIMIT ?',
      below,
      page,
    );
    for (const r of rows) {
      if (r.at <= since) return r.at === since || current ? [...ids] : null;
      if (r.track_id) ids.add(r.track_id);
      if (ids.size > DELTA.max_songs) return null;
    }
    // The log's oldest kept row is still after `since`: what came before it is gone.
    if (rows.length < page) return null;
    below = rows[rows.length - 1].seq;
    read += page;
    page = Math.min(page * 2, DELTA.page);
  }
  return null;
}

/** The songs of `ids` still in the catalog, in its order (one read each, by the id's index). */
export function deltaRows(db: Db, ids: string[]): (CatalogRow & { id: string })[] {
  if (!ids.length) return [];
  return db.all(
    `SELECT id, record_json, waveform IS NOT NULL AS w, updated_at AS u FROM tracks
     WHERE id IN (SELECT value FROM json_each(?)) ORDER BY ord`,
    JSON.stringify(ids),
  );
}
