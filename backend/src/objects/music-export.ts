// The upload tools' reads beyond the whole export (POST /v1/music/uploads/export with a page, and
// `track`): the catalog in pages by its order (`ord`, so a song added while a tool pages comes on a
// later page), with its waveforms or without, and one track's record without its waveform. A code
// layer of the one Music class (music-diag.ts extends it). Answers are JSON text: the records are
// the old catalog's own, which the RPC types can't carry.
import * as store from '../areas/music/store';
import { MAX_TRACKS } from '../areas/music/writer';
import { MusicPicks } from './music-picks';

type Rec = Record<string, unknown> & { metadata: Record<string, unknown> };

/** A record with its waveform inline, as the whole export gives it. */
function full(r: store.BriefRow): string {
  if (!r.waveform) return r.record_json;
  const t = JSON.parse(r.record_json) as Rec;
  t.metadata.waveform = r.waveform;
  return JSON.stringify(t);
}

/** A record without its waveform: whether it has one, and its kind ("rms" or "peak"; null without). */
export function bare(r: store.BriefRow): string {
  const t = JSON.parse(r.record_json) as Rec;
  delete t.metadata.waveform;
  t.hasWaveform = !!r.w;
  t.waveformKind = r.w ? (t.waveformKind === 'rms' ? 'rms' : 'peak') : null;
  return JSON.stringify(t);
}

export abstract class MusicExport extends MusicPicks {
  /** Up to `limit` tracks (all, without one) after place `after` or after the track with that id, as
   * the whole export's file with `next` (the last place, for the next page; null on the last page);
   * null when `after` names no track. One row read per track, one more for the version. */
  exportPage(limit: number | null, after: number | string | null, waveforms: boolean): string | null {
    const from = typeof after === 'string' ? store.ordOf(this.db, after) : (after ?? 0);
    if (from === null) return null;
    const max = limit ?? MAX_TRACKS;
    const rows = store.exportPage(this.db, from, max + 1, waveforms);
    const page = rows.slice(0, max);
    const more = rows.length > max;
    const tracks = page.map(waveforms ? full : bare);
    const next = more ? String(page[page.length - 1].ord) : null;
    const head = { version: 1, kind: 'r2-library', complete: !more, count: tracks.length, next };
    const generatedAt = new Date(store.version(this.db).changed_at || Date.now()).toISOString();
    return `${JSON.stringify({ ...head, generatedAt }).slice(0, -1)},"tracks":[${tracks.join(',')}]}`;
  }

  /** One track's record without its waveform (`bare`), by id or by its audio; null when none. */
  trackRecord(id: string | null, sha256: string, size: number): string | null {
    const r = store.briefRow(this.db, id === null ? { sha256, size } : { id });
    return r ? bare(r) : null;
  }
}
