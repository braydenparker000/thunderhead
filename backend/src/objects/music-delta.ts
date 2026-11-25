// GET /v1/music/catalog?since=<generatedAt> (MUSIC.md §1.3, `MusicCatalogDelta` in shared/contract/music.ts):
// the songs changed and the ids removed after the copy a phone holds, when the change log can say
// exactly (areas/music/catalog-delta.ts); else null, and the route sends the whole catalog. As a
// streamed answer, as the whole catalog is (music.ts `catalogAnswer`: one RPC answer holds 32 MiB at
// most). A code layer of the one Music class.
import { catalogTrack, changedIds, deltaRows } from '../areas/music/catalog-delta';
import * as store from '../areas/music/store';
import { MusicDiag } from './music-diag';

export abstract class MusicDelta extends MusicDiag {
  /** What changed after `since` (exactly a `generatedAt` this catalog gave), under the catalog's ETag
   * now; null when only the whole catalog will do. Writes nothing. */
  catalogSince(since: string): Response | null {
    const t = Date.parse(since);
    if (!Number.isFinite(t) || new Date(t).toISOString() !== since) return null;
    const v = store.version(this.db);
    const ids = changedIds(this.db, t, v);
    if (!ids) return null;
    const rows = deltaRows(this.db, ids);
    const here = new Set(rows.map((r) => r.id));
    const removed = ids.filter((id) => !here.has(id));
    const head = {
      version: 1,
      kind: 'r2-library-delta',
      complete: true,
      count: v.count,
      since,
      generatedAt: new Date(v.changed_at).toISOString(),
    };
    const tracks = rows.map(catalogTrack).join(',');
    const text = `${JSON.stringify(head).slice(0, -1)},"tracks":[${tracks}],"removed":${JSON.stringify(removed)}}`;
    return new Response(text, { headers: { ETag: store.etagOf(v) } });
  }
}
