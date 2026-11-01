// What the mind reads and writes in the Music object (MUSIC.md §10.2, §10.5): the catalog's tags,
// searched in memory; its notes about each song (Music schema step 4, `track_notes`); and songs by
// feeling. A code layer of the one Music class (music.ts), no Durable Object class of its own.
//
// Rows (the free plan meters every row read and written, DATA.md §8): the tags are read once per
// start (one row a track) and searched in memory; the notes likewise (one row a note), and kept
// current by the writes, which come only through here; the listening pass's table, when there is
// one, once per start and again after 10 minutes. A note costs 1 row read (the upsert's check)
// and 1 written, none when it is the same as the one kept. Find, notes by id and pages read nothing
// more once those are in memory.
import {
  MUSIC_NOTE_VERSION,
  type MusicFindResponse,
  type MusicNote,
  type MusicNoteRow,
  type MusicNotesResponse,
  type MusicNotesWritten,
  type MusicTrackRow,
  type MusicTracksResponse,
} from '../../../shared/contract/music.ts';
import { type FindQuery, type Listening, listeningMap, rank } from '../areas/music/find';
import { noteJson } from '../areas/music/notes';
import * as store from '../areas/music/store';
import { MINUTE } from '../lib/time';
import { MusicListen } from './music-listen';

type Tagged = MusicTrackRow & { hay: string };

/** How long the listening pass's data is kept in memory before it is read again. */
const LISTENING_MS = 10 * MINUTE;

export abstract class MusicMind extends MusicListen {
  /** Every track's tags, in catalog order, read once per start (or after a change). */
  private finder: Tagged[] | null = null;
  private byId: Map<string, Tagged> | null = null;
  /** Every note by track id, read once per start; the writes keep it current. */
  private kept: Map<string, MusicNoteRow> | null = null;
  private listened: { at: number; map: Map<string, Listening> | null } | null = null;

  /** The catalog changed (a write or an import): the tags are read again when next needed. */
  protected dropIndex(): void {
    this.finder = null;
    this.byId = null;
  }

  /** Tracks whose tags hold every word of `q` (title, artist, album, genre, composer), in catalog
   * order, at most `limit`, with how many match in all: what the mind picks a playlist from. With
   * `untagged`, only songs with no note of the current version: the night's next page. */
  findTracks(q: string, limit: number, untagged = false): MusicTracksResponse {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const notes = untagged ? this.notesKept() : null;
    const items: MusicTrackRow[] = [];
    let total = 0;
    for (const { hay, ...row } of this.index()) {
      if (notes && (notes.get(row.id)?.v ?? 0) >= MUSIC_NOTE_VERSION) continue;
      if (!words.every((w) => hay.includes(w))) continue;
      total++;
      if (items.length < limit) items.push(row);
    }
    return { items, total };
  }

  /** Whether the catalog holds a track. */
  hasTrack(id: string): boolean {
    this.index();
    return this.byId?.has(id) ?? false;
  }

  /** A batch of notes checked whole by the route (areas/music/notes.ts), written in one
   * transaction; ids the catalog doesn't hold come back and nothing is written. */
  putNotes(notes: MusicNote[], by: string, at = Date.now()): MusicNotesWritten | { unknown: string[] } {
    const unknown = notes.filter((n) => !this.hasTrack(n.id)).map((n) => n.id);
    if (unknown.length) return { unknown };
    const kept = this.notesKept();
    const changed = this.ctx.storage.transactionSync(() =>
      notes.filter(
        (n) =>
          store.putNote(this.db, {
            track_id: n.id,
            known: n.known ? 1 : 0,
            note_json: noteJson(n),
            by,
            v: MUSIC_NOTE_VERSION,
            at,
          }) > 0,
      ),
    );
    // Only once the transaction has committed: memory never runs ahead of the table.
    for (const n of changed) kept.set(n.id, { ...n, by, v: MUSIC_NOTE_VERSION, at });
    return { written: changed.length, unchanged: notes.length - changed.length };
  }

  /** Each track asked for with its tags and note (null when it has none); ids not held, `missing`. */
  notes(ids: string[]): MusicNotesResponse {
    const kept = this.notesKept();
    this.index();
    const out: MusicNotesResponse = { items: [], missing: [], next: null };
    for (const id of new Set(ids)) {
      const t = this.byId?.get(id);
      if (!t) out.missing.push(id);
      else out.items.push({ ...tags(t), note: kept.get(id) ?? null });
    }
    return out;
  }

  /** Every note in track id order, `limit` at a time after `cursor` (a track id); a note whose track
   * has left the catalog is not read. */
  notesPage(cursor: string, limit: number): MusicNotesResponse {
    const kept = this.notesKept();
    this.index();
    const ids = [...kept.keys()].filter((id) => id > cursor).sort();
    const page = ids.slice(0, limit);
    const items = page.flatMap((id) => {
      const t = this.byId?.get(id);
      return t ? [{ ...tags(t), note: kept.get(id) as MusicNoteRow }] : [];
    });
    return { items, missing: [], next: ids.length > limit ? (page.at(-1) ?? null) : null };
  }

  /** Songs by feeling or like one (areas/music/find.ts), with the owner's early skips by track id,
   * the songs their rules rule out and the songs rated 1; null when `like` names a song the
   * catalog doesn't hold. */
  find(q: FindQuery, skips: Record<string, number>, never: string[], rated: string[] = []): MusicFindResponse | null {
    const tracks = this.index().map(tags);
    return rank(
      { tracks, notes: this.notesKept(), listening: this.listening() },
      q,
      new Map(Object.entries(skips)),
      new Set(never),
      new Set(rated),
    );
  }

  /** Every track's searchable tags, read once per start (or after a change). */
  protected index(): Tagged[] {
    if (this.finder) return this.finder;
    const out: Tagged[] = [];
    for (const r of store.tagRows(this.db)) {
      const t = JSON.parse(r.record_json) as { path?: string; metadata?: Record<string, unknown> };
      const m = t.metadata ?? {};
      const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
      const row: MusicTrackRow = {
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
      out.push({ ...row, hay: `${row.title} ${row.artist} ${row.album} ${row.genre} ${row.composer}`.toLowerCase() });
    }
    this.finder = out;
    this.byId = new Map(out.map((t) => [t.id, t]));
    return out;
  }

  private notesKept(): Map<string, MusicNoteRow> {
    if (this.kept) return this.kept;
    const kept = new Map<string, MusicNoteRow>();
    for (const r of store.allNotes(this.db)) {
      const n = JSON.parse(r.note_json) as Omit<MusicNote, 'id' | 'known'>;
      kept.set(r.track_id, { id: r.track_id, known: r.known === 1, ...n, by: r.by, v: r.v, at: r.at });
    }
    this.kept = kept;
    return kept;
  }

  /** The listening pass's data (step 3) when its table exists, else null. */
  private listening(now = Date.now()): Map<string, Listening> | null {
    if (this.listened && now - this.listened.at < LISTENING_MS && now >= this.listened.at) return this.listened.map;
    const rows = store.listeningRows(this.db);
    this.listened = { at: now, map: rows ? listeningMap(rows) : null };
    return this.listened.map;
  }
}

const tags = ({ hay: _, ...row }: Tagged): MusicTrackRow => row;
