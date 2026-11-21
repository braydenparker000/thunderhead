// The owner's Music data on every phone (MUSIC.md §1.4, areas/music/sync-*.ts): each song's rating
// and plays, and the playlists, synced by the phones (the newer wins; plays the larger) and read by
// them by time; a Reset stats is a record with its own time that wins over older plays. A code layer of the one Music class (music.ts extends it). A rating kept here is the
// mind's too (`track_ratings`): find's list of songs rated 1 is read again. Nothing here changes the
// catalog or its ETag.
import type { MusicMark, MusicPlaylist, MusicSyncResponse } from '../../../shared/contract/music-sync.ts';
import * as sync from '../areas/music/sync-store';
import { MusicMind } from './music-mind';

type Refused = MusicSyncResponse['refused'];
type Page<T> = { rows: T[]; more: boolean; last: [number, string] | null; at: number };
/** Deleted playlists' old records a PUT prunes at most (the partial index: one row read when none). */
const PRUNE = 20;

export abstract class MusicSync extends MusicMind {
  /** Songs' marks, and a Reset stats (`reset_at`, kept if newer) before them. */
  putMarks(items: MusicMark[], refused: Refused, resetAt?: number): MusicSyncResponse {
    const at = Date.now();
    let rated = false;
    const applied = this.ctx.storage.transactionSync(() => {
      if (resetAt) sync.putReset(this.db, resetAt);
      const reset = items.length ? sync.resetAt(this.db) : 0;
      return items.reduce((n, m) => {
        const w = sync.putMark(this.db, m, at, reset);
        if (w && m.rating !== null) rated = true;
        return n + (w ? 1 : 0);
      }, 0);
    });
    if (rated) this.ruledOut = null;
    return { applied, stale: items.length - applied, refused, at };
  }

  /** One page of marks: up to `limit` songs after the cursor, `more` when there are others, the last
   * entry's `[synced_at, id]`, and the time of the read. */
  marks(after: [number, string], limit: number): Page<MusicMark> & { reset_at: number } {
    const at = Date.now();
    const reset = sync.resetAt(this.db);
    const keys = sync.markKeys(this.db, after, limit + 1);
    const kept = keys.slice(0, limit);
    const whole = sync.marksOf(this.db, [...new Set(kept.map((k) => k.track_id))], reset);
    const end = kept.at(-1);
    return {
      rows: kept.flatMap((k) => whole.get(k.track_id) ?? []),
      more: keys.length > limit,
      last: end ? [end.synced_at, end.track_id] : null,
      at,
      reset_at: reset,
    };
  }

  putPlaylists(items: MusicPlaylist[], refused: Refused): MusicSyncResponse {
    const at = Date.now();
    const applied = this.ctx.storage.transactionSync(() => {
      const n = items.reduce((k, p) => k + (sync.putPlaylist(this.db, p, at) ? 1 : 0), 0);
      sync.pruneGone(this.db, at, PRUNE);
      return n;
    });
    return { applied, stale: items.length - applied, refused, at };
  }

  playlists(after: [number, string], limit: number): Page<MusicPlaylist> {
    const at = Date.now();
    const rows = sync.playlistsPage(this.db, after, limit + 1);
    const kept = rows.slice(0, limit);
    const end = kept.at(-1);
    return {
      rows: kept.map(sync.toPlaylist),
      more: rows.length > limit,
      last: end ? [end.synced_at, end.id] : null,
      at,
    };
  }
}
