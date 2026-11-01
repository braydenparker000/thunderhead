// The packs and lists find reads in the Music object (MUSIC.md §10.5; music-mind.ts uses them): the
// mind's notes packed 500 to a row with the tags likeness weighs, the listening pass's moods and
// energy packed the same way, and the songs rated 1. A code layer of the one Music class. The packs
// are derived (`find_packs`, out of the backup). The notes' are built again from the notes when they
// are missing (a fresh instance) or stale: the triggers on `track_notes` mark any write that isn't a
// batch's own (a table restore, a hand edit), and then the night's place starts over too. The
// listening pass's are built again when a day old.
import {
  MUSIC_NOTE_LIMITS as L,
  type MusicNote,
  type MusicNoteRow,
  type MusicTrackRow,
} from '../../../shared/contract/music.ts';
import { type AudioEntry, listeningMap, type NoteEntry } from '../areas/music/find';
import * as notes from '../areas/music/store-notes';
import { MusicListen } from './music-listen';

/** A track's tags from its record as the old catalog kept it. */
export function tagsOf(r: { id: string; record_json: string }): MusicTrackRow {
  const t = JSON.parse(r.record_json) as { path?: string; metadata?: Record<string, unknown> };
  const m = t.metadata ?? {};
  const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
  return {
    id: r.id,
    title:
      s('title') ||
      (t.path ?? '')
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      '',
    artist: s('artist'),
    album: s('album'),
    genre: s('genre'),
    composer: s('composer'),
    year: Number(m.year) || 0,
    dur: Math.round(Number(m.dur) || 0),
  };
}

/** A note's packed entry: its words and the tags likeness weighs. */
export function entryOf(n: Omit<MusicNote, 'id'> | null, t: MusicTrackRow, ord: number): NoteEntry {
  return {
    k: n?.known ? 1 : 0,
    m: n?.moods ?? {},
    o: n?.occasions ?? {},
    e: n?.energy ?? null,
    r: n?.era ?? null,
    l: n?.language ?? null,
    a: t.artist,
    c: t.composer,
    g: t.genre,
    y: t.year,
    n: ord,
  };
}

export const rowOf = (r: notes.NoteRow): MusicNoteRow => ({
  id: r.track_id,
  known: r.known === 1,
  ...(JSON.parse(r.note_json) as Omit<MusicNote, 'id' | 'known'>),
  by: r.by,
  v: r.v,
  at: r.at,
});

/** A rebuild that failed is tried again after this long. */
const REBUILD_BACKOFF_MS = 60 * 60 * 1000;

export abstract class MusicPacks extends MusicListen {
  /** The packed notes by track id, and where the next new note goes. */
  protected packed: Map<string, NoteEntry> | null = null;
  protected place: { open: number; fill: number } | null = null;
  /** The listening pass's packed measurements, when they were packed, and at which of its epochs. */
  private audio: { at: number; epoch: number; map: Map<string, AudioEntry> } | null = null;
  /** The songs whose newest rating is 1. */
  protected ruledOut: Set<string> | null = null;

  protected rated(): Set<string> {
    this.ruledOut ??= new Set(notes.ratedOut(this.db));
    return this.ruledOut;
  }

  /** The packed notes, read once per start (tens of rows); built again from the notes when the
   * packs are missing (a restore brings back the notes, not the derived packs). */
  protected packedNotes(): Map<string, NoteEntry> {
    this.refreshIfStale();
    if (this.packed) return this.packed;
    const meta = notes.pack(this.db, 'meta', 0);
    if (meta === null && notes.anyNote(this.db)) this.rebuild(Date.now(), null);
    else this.place = meta ? (JSON.parse(meta) as { open: number; fill: number }) : { open: 0, fill: 0 };
    this.place ??= { open: 0, fill: 0 };
    const map = new Map<string, NoteEntry>();
    for (const p of notes.packs(this.db, 'notes'))
      for (const [id, e] of Object.entries(JSON.parse(p.entries_json) as Record<string, NoteEntry>)) map.set(id, e);
    this.packed = map;
    return map;
  }

  /** One row a call: when the notes changed under the packs (a restore, a hand edit), the packs are
   * built again and the night's place starts over. */
  protected refreshIfStale(): void {
    const mark = notes.staleMark(this.db);
    if (mark === null) return;
    this.packed = null;
    this.rebuild(Date.now(), mark);
  }

  /** The packs built again, at most once an hour while it keeps failing (each failure logged by name
   * and marked); until it works, find reads the packs as they are. */
  private rebuild(now: number, mark: { failed_at: number } | null): void {
    const failed = (mark ?? notes.staleMark(this.db))?.failed_at ?? 0;
    if (failed && now - failed < REBUILD_BACKOFF_MS && now >= failed) return;
    try {
      this.repack(now);
    } catch (e) {
      console.error(JSON.stringify({ evt: 'music_packs_rebuild_failed', name: (e as Error)?.name ?? 'Error' }));
      notes.rebuildFailed(this.db, now);
    }
  }

  /** The notes' packs again, each note in the pack it names (a rebuild reads every note and tag once). */
  private repack(at: number): void {
    const tracks = new Map(notes.allTags(this.db).map((t) => [t.id, t]));
    const by = new Map<number, Record<string, NoteEntry>>();
    for (const r of notes.allNotes(this.db)) {
      const t = tracks.get(r.track_id);
      if (!t) continue;
      const n = rowOf(r);
      by.set(r.pack, { ...(by.get(r.pack) ?? {}), [r.track_id]: entryOf(n, tagsOf(t), t.ord) });
    }
    const open = Math.max(0, ...by.keys());
    this.place = { open, fill: Object.keys(by.get(open) ?? {}).length };
    this.ctx.storage.transactionSync(() => {
      notes.dropPacks(this.db, 'notes');
      for (const [n, p] of by) notes.putPack(this.db, 'notes', n, JSON.stringify(p), at);
      notes.putPack(this.db, 'meta', 0, JSON.stringify(this.place), at);
      // The night's place no longer says which songs have a note: it starts over.
      notes.dropCursor(this.db);
      notes.clearStale(this.db);
    });
  }

  /** The listening pass's moods and energy (step 3), packed: null while it has measured no song.
   * Packed again from its table once a job of it applied songs (its epoch moved; one row read a call),
   * and when the packs are older than a day (its writer needs no change here). */
  protected measured(now: number): Map<string, AudioEntry> | null {
    const epoch = notes.listenEpoch(this.db);
    const fresh = (a: { at: number; epoch?: number }) => a.epoch === epoch && now - a.at < L.pack_ms && now >= a.at;
    if (this.audio && fresh(this.audio)) return this.audio.map.size ? this.audio.map : null;
    const meta = notes.pack(this.db, 'meta', 1);
    const m = meta ? (JSON.parse(meta) as { at: number; epoch?: number }) : { at: 0 };
    const map = new Map<string, AudioEntry>();
    if (fresh(m)) {
      for (const p of notes.packs(this.db, 'audio'))
        for (const [id, e] of Object.entries(JSON.parse(p.entries_json) as Record<string, AudioEntry>)) map.set(id, e);
      this.audio = { at: m.at, epoch, map };
      return map.size ? map : null;
    }
    const rows = [...listeningMap(notes.listeningRows(this.db))];
    this.ctx.storage.transactionSync(() => {
      notes.dropPacks(this.db, 'audio');
      for (let i = 0; i * L.pack_size < rows.length; i++) {
        const part = rows.slice(i * L.pack_size, (i + 1) * L.pack_size);
        notes.putPack(
          this.db,
          'audio',
          i,
          JSON.stringify(Object.fromEntries(part.map(([id, a]) => [id, { e: a.e, m: a.m }]))),
          now,
        );
      }
      notes.putPack(this.db, 'meta', 1, JSON.stringify({ at: now, epoch }), now);
    });
    for (const [id, a] of rows) map.set(id, { e: a.e, m: a.m });
    this.audio = { at: now, epoch, map };
    return map.size ? map : null;
  }
}
