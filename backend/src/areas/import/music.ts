// I7, the music catalog (MIGRATION.md §4): the old `music_tracks` rows become the Music object's
// tracks, keeping each track's id, content keys, place in the catalog and record exactly as the
// old catalog stored them, and its waveform; `music_log` becomes `catalog_log`, by its old
// sequence number. The rows are written in the Music object, not in Core, so a step's load does
// the writing (a put that changes nothing writes nothing, so a retried load is harmless) and the
// step keeps the counts. The spot checks read the sampled rows back from the Music object.
import type { ImportSkipReason } from '../../../../shared/contract/api';
import { musicObject } from '../../objects/music';
import { ART_KEY, AUDIO_KEY, SONG_ID, waveBytes } from '../music/shapes';
import type { LogRow, TrackRow } from '../music/store';
import type { Mapped } from './map';
import type { RunCounts } from './store';

export type MusicDataset = 'music' | 'music_log';
export const isMusic = (d: string): d is MusicDataset => d === 'music' || d === 'music_log';

type Old = Record<string, unknown>;
const HEX = /^[a-f0-9]{64}$/;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const int = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

/** One old catalog row, or why it can't be one: an id, hash, size or key the catalog's own check
 * would refuse, or a record that isn't this track's. A waveform that isn't one is left out. */
export function mapTrack(o: Old): Mapped<TrackRow> {
  const id = str(o.id);
  const old_id = id ?? String(o.__rowid__ ?? o.ord);
  const ord = int(o.ord);
  const size = int(o.size);
  const updated = int(o.updated_ms);
  const sha = str(o.sha256);
  const audio = str(o.audio_key);
  const cover = o.cover_key == null ? null : str(o.cover_key);
  const record = str(o.record);
  if (!id || !SONG_ID.test(id) || !ord || !size || !updated || !sha || !HEX.test(sha)) return { old_id, skip: 'empty' };
  if (!audio || !AUDIO_KEY.test(audio) || (o.cover_key != null && (!cover || !ART_KEY.test(cover))))
    return { old_id, skip: 'empty' };
  let rec: unknown;
  try {
    rec = JSON.parse(record ?? '');
  } catch {
    return { old_id, skip: 'empty' };
  }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || (rec as { id?: unknown }).id !== id)
    return { old_id, skip: 'invalid_ref' };
  const wave = str(o.waveform);
  return {
    old_id,
    row: {
      ord,
      id,
      sha256: sha,
      size,
      audio_key: audio,
      cover_key: cover,
      record_json: record as string,
      waveform: wave && waveBytes(wave) ? wave : null,
      updated_at: updated,
    },
  };
}

export function mapLog(o: Old): Mapped<LogRow> {
  const seq = int(o.seq);
  const at = int(o.at_ms);
  const op = str(o.op);
  if (!seq || !at || !op || op.length > 40) return { old_id: String(o.seq ?? o.__rowid__), skip: 'empty' };
  return {
    old_id: String(seq),
    row: { seq, at, op, track_id: str(o.track_id), before_json: str(o.before) },
  };
}

/** What a step's load did with one part. */
export interface MusicPart {
  imported: number;
  skipped: Partial<Record<ImportSkipReason, number>>;
  /** Rows written in the Music object (index entries included), for the bulk lane. */
  written: number;
  /** Tracks or log rows that changed. */
  changed: number;
}

/** Maps one part's rows and puts them in the Music object. */
export async function putPart(env: Env, dataset: MusicDataset, rows: Old[], at: number): Promise<MusicPart> {
  const skipped: MusicPart['skipped'] = {};
  const tracks: TrackRow[] = [];
  const log: LogRow[] = [];
  for (const r of rows) {
    const m = dataset === 'music' ? mapTrack(r) : mapLog(r);
    if ('skip' in m) skipped[m.skip] = (skipped[m.skip] ?? 0) + 1;
    else if (dataset === 'music') tracks.push(m.row as TrackRow);
    else log.push(m.row as LogRow);
  }
  const music = musicObject(env);
  const done = dataset === 'music' ? await music.importTracks(tracks, at) : await music.importLog(log);
  // A track whose place another track holds is skipped as a duplicate, never moved.
  const clashes = done.clashes?.length ?? 0;
  if (clashes) skipped.duplicate = (skipped.duplicate ?? 0) + clashes;
  return { imported: tracks.length + log.length - clashes, skipped, written: done.written, changed: done.changed };
}

/** The sampled source rows that don't match what the Music object holds (their old ids). A row
 * skipped on the way in was counted as skipped and has nothing to match. */
export async function failedChecks(env: Env, dataset: MusicDataset, rows: Old[]): Promise<string[]> {
  const music = musicObject(env);
  const failed: string[] = [];
  if (dataset === 'music') {
    const want = rows.map(mapTrack).filter((m) => !('skip' in m)) as { old_id: string; row: TrackRow }[];
    const got = new Map((await music.tracks(want.map((m) => m.row.id))).map((t) => [t.id, t]));
    for (const { old_id, row } of want) {
      const g = got.get(row.id);
      const same =
        g &&
        g.sha256 === row.sha256 &&
        g.size === row.size &&
        g.audio_key === row.audio_key &&
        g.cover_key === row.cover_key &&
        g.record_json === row.record_json &&
        g.waveform === row.waveform;
      if (!same) failed.push(old_id);
    }
    return failed;
  }
  const want = rows.map(mapLog).filter((m) => !('skip' in m)) as { old_id: string; row: LogRow }[];
  const got = new Map((await music.log(want.map((m) => m.row.seq))).map((l) => [l.seq, l]));
  for (const { old_id, row } of want) {
    const g = got.get(row.seq);
    if (!g || g.op !== row.op || g.track_id !== row.track_id || g.before_json !== row.before_json) failed.push(old_id);
  }
  return failed;
}

/** A music part, put by its load: its counts join the run's. */
export function tally(counts: RunCounts, m: MusicPart): void {
  counts.imported += m.imported;
  for (const [k, n] of Object.entries(m.skipped) as [ImportSkipReason, number][]) {
    counts.skipped += n;
    counts.skip_reasons[k] = (counts.skip_reasons[k] ?? 0) + n;
  }
  counts.rows_changed += m.changed;
}
