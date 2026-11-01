// What the mind reads and writes in the Music object (MUSIC.md §10.2, §10.5): the catalog's tags,
// its notes about each song (Music schema step 4), the owner's ratings, and songs by feeling. A code
// layer of the one Music class (music.ts), no Durable Object class of its own.
//
// Rows (the free plan meters every row read and written; DATA.md §8.4: no request-path read of a
// growing table): notes, tags and ratings are read by key; the night's untagged page walks the
// catalog's key from where its last page began; find reads the notes packed 500 to a row
// (`find_packs`, kept current by each batch: a cold find reads tens of rows, not one a song), the
// listening pass's moods and energy packed the same way (packed again at most once a day), the
// ratings of 1 (a partial index), the seed's neighbours and the winners' tags by key. The packs
// are derived: after a restore they are built again from the notes, once. The word search
// (`findTracks`) still reads the tags once per start, as it did before the notes.
import {
  MUSIC_NOTE_LIMITS as L,
  MUSIC_NOTE_VERSION,
  type MusicFindResponse,
  type MusicNote,
  type MusicNotesResponse,
  type MusicNotesWritten,
  type MusicTrackRow,
  type MusicTracksResponse,
} from '../../../shared/contract/music.ts';
import { type FindQuery, listeningMap, type NoteEntry, rank } from '../areas/music/find';
import { noteJson } from '../areas/music/notes';
import * as notes from '../areas/music/store-notes';
import { entryOf, MusicPacks, rowOf, tagsOf } from './music-packs';

type Tagged = MusicTrackRow & { hay: string };
export abstract class MusicMind extends MusicPacks {
  /** The word search's tags, read once per start (or after a change). */
  private finder: Tagged[] | null = null;

  /** The catalog changed (a write or an import): the word search's tags are read again. */
  protected dropIndex(): void {
    this.finder = null;
  }

  /** Tracks whose tags hold every word of `q`, in catalog order, at most `limit`, with how many
   * match in all; songs rated 1 and songs the owner's rules rule out (`never`) are left out. What
   * the mind picks a playlist from by its tags. */
  findTracks(q: string, limit: number, never: string[] = []): MusicTracksResponse {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Set([...this.rated(), ...never]);
    const items: MusicTrackRow[] = [];
    let total = 0;
    for (const { hay, ...row } of this.index()) {
      if (out.has(row.id) || !words.every((w) => hay.includes(w))) continue;
      total++;
      if (items.length < limit) items.push(row);
    }
    return { items, total };
  }

  /** The night's next page: the songs after its place with no note of the current version (or one
   * the owner corrected through the chat), in catalog order. Its place moves to just before the
   * first of them, so the next page starts there; `total` counts this page only. */
  untaggedPage(limit: number): MusicTracksResponse {
    this.refreshIfStale();
    const kept = notes.cursor(this.db);
    const after = kept?.v === MUSIC_NOTE_VERSION ? kept.ord : 0;
    const rows = notes.untagged(this.db, after, MUSIC_NOTE_VERSION, limit + 1);
    const items = rows.slice(0, limit);
    const ord = items.length ? items[0].ord - 1 : notes.lastOrd(this.db);
    if (ord !== after || kept?.v !== MUSIC_NOTE_VERSION) notes.putCursor(this.db, MUSIC_NOTE_VERSION, ord);
    return { items: items.map(tagsOf), total: items.length, more: rows.length > limit };
  }

  /** A batch of notes checked whole by the route (areas/music/notes.ts), written with their packs in
   * one transaction; ids the catalog doesn't hold come back and nothing is written. A night note
   * never replaces one the owner corrected through the chat. */
  putNotes(batch: MusicNote[], by: string, at = Date.now()): MusicNotesWritten | { unknown: string[] } {
    const ids = batch.map((n) => n.id);
    const tracks = new Map(notes.tracksByIds(this.db, ids).map((t) => [t.id, t]));
    const unknown = ids.filter((id) => !tracks.has(id));
    if (unknown.length) return { unknown };
    this.packedNotes();
    const place = { ...(this.place ?? { open: 0, fill: 0 }) };
    const had = new Map(notes.notesByIds(this.db, ids).map((r) => [r.track_id, r]));
    const out = { written: 0, unchanged: 0, kept: 0 };
    const entries = new Map<string, NoteEntry>();
    this.ctx.storage.transactionSync(() => {
      const touched = new Map<number, string[]>();
      for (const n of batch) {
        const old = had.get(n.id);
        if (old?.by === 'mind:chat' && by === 'mind:night') {
          out.kept++;
          continue;
        }
        const json = noteJson(n);
        const known = n.known ? 1 : 0;
        // The same note again writes nothing, unless the owner confirms the night's note through the
        // chat: then it is theirs (`by: mind:chat`), and no night note replaces it.
        const confirms = by === 'mind:chat' && old?.by !== 'mind:chat';
        if (old && old.known === known && old.note_json === json && old.v === MUSIC_NOTE_VERSION && !confirms) {
          out.unchanged++;
          continue;
        }
        let pack = old?.pack;
        if (pack === undefined) {
          if (place.fill >= L.pack_size) Object.assign(place, { open: place.open + 1, fill: 0 });
          place.fill++;
          pack = place.open;
        }
        notes.putNote(this.db, { track_id: n.id, known, note_json: json, by, v: MUSIC_NOTE_VERSION, at, pack });
        const t = tracks.get(n.id) as notes.TagRow;
        entries.set(n.id, entryOf(n, tagsOf(t), t.ord));
        touched.set(pack, [...(touched.get(pack) ?? []), n.id]);
        out.written++;
      }
      for (const [pack, list] of touched) {
        const json = notes.pack(this.db, 'notes', pack);
        const p = json ? (JSON.parse(json) as Record<string, NoteEntry>) : {};
        for (const id of list) p[id] = entries.get(id) as NoteEntry;
        notes.putPack(this.db, 'notes', pack, JSON.stringify(p), at);
      }
      if (place.open !== this.place?.open || place.fill !== this.place?.fill)
        notes.putPack(this.db, 'meta', 0, JSON.stringify(place), at);
      // This batch's own writes left the triggers' mark; its packs are current, so it goes.
      if (out.written) notes.clearStale(this.db);
    });
    // Only once the transaction has committed: memory never runs ahead of the table.
    this.place = place;
    for (const [id, e] of entries) this.packed?.set(id, e);
    return out;
  }

  /** Each track asked for with its tags and note (null when it has none); ids not held, `missing`. */
  notes(ids: string[]): MusicNotesResponse {
    const list = [...new Set(ids)];
    const tracks = new Map(notes.tracksByIds(this.db, list).map((t) => [t.id, t]));
    const kept = new Map(notes.notesByIds(this.db, list).map((r) => [r.track_id, rowOf(r)]));
    const out: MusicNotesResponse = { items: [], missing: [], next: null };
    for (const id of list) {
      const t = tracks.get(id);
      if (!t) out.missing.push(id);
      else out.items.push({ ...tagsOf(t), note: kept.get(id) ?? null });
    }
    return out;
  }

  /** Every note in track id order, `limit` at a time after `cursor` (a track id); a note whose track
   * has left the catalog is not shown. */
  notesPage(cursor: string, limit: number): MusicNotesResponse {
    const rows = notes.notesAfter(this.db, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const tracks = new Map(
      notes
        .tracksByIds(
          this.db,
          page.map((r) => r.track_id),
        )
        .map((t) => [t.id, t]),
    );
    const items = page.flatMap((r) => {
      const t = tracks.get(r.track_id);
      return t ? [{ ...tagsOf(t), note: rowOf(r) }] : [];
    });
    return { items, missing: [], next: rows.length > limit ? (page.at(-1)?.track_id ?? null) : null };
  }

  /** The owner's ratings from the phone's `music.rate` senses (the senses route): the newest of each
   * song is kept for good, so "not for me" doesn't fade with the senses' 90 days. */
  putRatings(list: { id: string; rating: number; at: number }[]): number {
    const n = this.ctx.storage.transactionSync(() =>
      list.reduce((w, r) => w + notes.putRating(this.db, r.id, r.rating, r.at), 0),
    );
    if (n) this.ruledOut = null;
    return n;
  }

  /** Songs by feeling or like one (areas/music/find.ts), with the owner's early skips by track id and
   * the songs their rules rule out; songs rated 1 are left out too. Null when `like` names a song
   * the catalog doesn't hold. */
  find(q: FindQuery, skips: Record<string, number>, never: string[], now = Date.now()): MusicFindResponse | null {
    const packed = this.packedNotes();
    const audio = this.measured(now);
    let seed: { id: string; entry: NoteEntry; neighbours: { id: string; score: number }[] } | null = null;
    if (q.like) {
      const [t] = notes.tracksByIds(this.db, [q.like]);
      if (!t) return null;
      const near = audio ? listeningMap(notes.listeningRows(this.db, q.like)).get(q.like)?.neighbours : undefined;
      seed = { id: t.id, entry: packed.get(t.id) ?? entryOf(null, tagsOf(t), t.ord), neighbours: near ?? [] };
    }
    const r = rank(
      { notes: packed, audio, seed },
      q,
      new Map(Object.entries(skips)),
      new Set(never),
      this.rated(),
      q.limit + 10,
    );
    // The winners' tags by key; a song that has left the catalog drops out.
    const tags = new Map(
      notes
        .tracksByIds(
          this.db,
          r.items.map((i) => i.id),
        )
        .map((t) => [t.id, tagsOf(t)]),
    );
    const items = r.items.flatMap((i) => {
      const t = tags.get(i.id);
      return t ? [{ ...t, score: i.score, known: i.known, why: i.why }] : [];
    });
    return { items: items.slice(0, q.limit), total: r.total, analysis: audio !== null, left_out: r.left_out };
  }

  /** The word search's tags, read once per start (or after a change). */
  protected index(): Tagged[] {
    if (this.finder) return this.finder;
    this.finder = notes.allTags(this.db).map((r) => {
      const row = tagsOf(r);
      return { ...row, hay: `${row.title} ${row.artist} ${row.album} ${row.genre} ${row.composer}`.toLowerCase() };
    });
    return this.finder;
  }
}
