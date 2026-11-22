// Guitar's half of the Core object (areas/guitar, GUITAR.md §1.1): one progress record per song,
// synced by the phone (the newer wins) and read by the phones by time. A code layer of the one Core
// class.
import type { GuitarProgress, GuitarSyncResponse } from '../../../shared/contract/guitar.ts';
import * as store from '../areas/guitar/store';
import type { Out } from '../lib/result';
import { CoreCheckin } from './core-checkin';

type Refused = GuitarSyncResponse['refused'];

export abstract class CoreGuitar extends CoreCheckin {
  putGuitarProgress(items: GuitarProgress[], refused: Refused): Out<GuitarSyncResponse> {
    return this.run((w) => {
      let applied = 0;
      for (const p of items) if (store.putProgress(w.db, p, w.at)) applied++;
      return { applied, stale: items.length - applied, refused, at: w.at };
    });
  }

  /** One page: up to `limit` records after the cursor, `more` when there are others, the last row's
   * `[synced_at, key]`, and the time of the read (a row taken later has a `synced_at` at or after it). */
  guitarProgress(
    after: [number, string],
    limit: number,
  ): { rows: GuitarProgress[]; more: boolean; last: [number, string] | null; at: number } {
    const at = Date.now();
    const rows = store.progressPage(this.db, after, limit + 1);
    const kept = rows.slice(0, limit);
    const end = kept.at(-1);
    return {
      rows: kept.map(store.toProgress),
      more: rows.length > limit,
      last: end ? [end.synced_at, end.key] : null,
      at,
    };
  }
}
