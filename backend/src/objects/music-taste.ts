// The owner's listening history in the Music object (MUSIC.md §16; areas/music/history-*.ts): the
// summary a Core job puts a part at a time, the artists the MusicBrainz job resolves one at a time,
// ListenBrainz's similar artists kept a week, and what find, `th music taste` and the brief read.
// A code layer of the one Music class (music-packs.ts extends it): no Durable Object class of its
// own. Writes are one transaction each.
import {
  type HistoryStatus,
  TASTE_LIMITS as L,
  type SimilarResponse,
  type TasteArtist,
  type TasteResponse,
} from '../../../shared/contract/taste.ts';
import { keyOf, type SummaryRow } from '../areas/music/history-parse';
import * as store from '../areas/music/history-store';
import { OwnerObject } from './base';

/** An unresolved artist's id for the mind: opaque, the same on every read, never its name. */
const opaque = (key: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return `h_${h.toString(16).padStart(8, '0')}`;
};

export abstract class MusicTaste extends OwnerObject {
  /** Every artist's plays and id by key, read once per start or after a change. */
  private artists: Map<string, number> | null = null;

  /** The catalog's tags (music-mind.ts), for the songs each artist has in it. */
  protected abstract index(): { id: string; artist: string }[];

  private ttx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  private byKey(): Map<string, number> {
    this.artists ??= new Map(store.allArtists(this.db).map((a) => [a.artist_key, a.plays]));
    return this.artists;
  }

  /** The catalog's songs by artist key. */
  private songsByKey(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const t of this.index()) {
      const k = keyOf(t.artist);
      if (k) out.set(k, [...(out.get(k) ?? []), t.id]);
    }
    return out;
  }

  historyFile(sha: string): store.FileRow | null {
    return store.fileOf(this.db, sha);
  }

  /** The job's split: the file's row, once. */
  startHistory(f: Omit<store.FileRow, 'state' | 'next' | 'plays' | 'minutes'>): number {
    return this.ttx(() => store.startFile(this.db, f));
  }

  /** One part of a file's summary; a part already put writes nothing. */
  putHistoryPart(sha: string, n: number, rows: SummaryRow[], at = Date.now()): { written: number; done: boolean } {
    const written = this.ttx(() => store.putPart(this.db, sha, n, rows, at));
    if (written) this.artists = null;
    return { written, done: store.fileOf(this.db, sha)?.state === 'done' };
  }

  historyStatus(): HistoryStatus {
    const files = store.files(this.db, 20).map(({ parts: _, next: __, ...f }) => f);
    const t = store.totals(this.db);
    return { files, artists: t.artists, resolved: t.resolved };
  }

  /** The MusicBrainz job's next artist: its key and its name as the files spelled it. */
  mbNext(): { key: string; name: string } | null {
    const a = store.mbDue(this.db);
    return a ? { key: a.artist_key, name: a.name } : null;
  }

  mbPut(key: string, r: { mbid: string; name: string } | 'none' | 'error', at = Date.now()): number {
    const n = this.ttx(() => store.mbSet(this.db, key, r, at));
    if (n) this.artists = null;
    return n;
  }

  /** Top artists and years by plays (counts, ids and canonical names: an unresolved name stays here). */
  taste(limit: number): TasteResponse {
    const t = store.totals(this.db);
    const songs = this.songsByKey();
    const top: TasteArtist[] = store.topArtists(this.db, Math.min(L.taste_max, limit)).map((a) => ({
      id: a.mbid ?? opaque(a.artist_key),
      mbid: a.mbid,
      name: a.mb_state === 'found' ? a.canonical : null,
      plays: a.plays,
      minutes: Math.round(a.minutes),
      songs: songs.get(a.artist_key)?.length ?? 0,
    }));
    const years = Object.entries(t.years)
      .map(([y, plays]) => ({ year: Number(y), plays }))
      .sort((a, b) => b.plays - a.plays || b.year - a.year)
      .slice(0, 10);
    return { plays: t.plays, minutes: Math.round(t.minutes), artists: t.artists, years, top };
  }

  similarCached(mbid: string): { items: SimilarResponse['items']; fetched_at: number } | null {
    const r = store.similarOf(this.db, mbid);
    if (!r) return null;
    return { items: this.withCounts(JSON.parse(r.items_json)), fetched_at: r.fetched_at };
  }

  putSimilar(mbid: string, items: { mbid: string; name: string; score: number }[], at = Date.now()) {
    this.ttx(() => store.putSimilar(this.db, mbid, items, at));
    return { items: this.withCounts(items), fetched_at: at };
  }

  /** Each similar artist with the owner's plays of them and their songs in the catalog, by the key
   * of its canonical name (at most 50 rows read by key). */
  private withCounts(items: { mbid: string; name: string; score: number }[]): SimilarResponse['items'] {
    const plays = store.playsOf(
      this.db,
      items.map((i) => keyOf(i.name)),
    );
    const songs = this.songsByKey();
    return items.map((i) => ({
      ...i,
      plays: plays.get(keyOf(i.name)) ?? 0,
      songs: songs.get(keyOf(i.name))?.length ?? 0,
    }));
  }

  /** find's history weight: each catalog song whose artist the owner played, log-scaled to 0–1. */
  protected historyWeights(): Map<string, number> {
    const by = this.byKey();
    let max = 0;
    for (const p of by.values()) max = Math.max(max, p);
    const out = new Map<string, number>();
    if (!max) return out;
    for (const [k, ids] of this.songsByKey()) {
      const p = by.get(k) ?? 0;
      if (p > 0) for (const id of ids) out.set(id, Math.round((Math.log1p(p) / Math.log1p(max)) * 100) / 100);
    }
    return out;
  }
}
