// What the Worker knows of the owner's music beyond their files (MUSIC.md §19; areas/music/know-*.ts):
// the job's side in the Music object. `knowNext` says what the `music.know` job does next (match an
// album, ask one source for one facts row, rebuild the picks, or wait), `knowLookup` and `knowPut`
// keep what an outside request answered, each one transaction. A code layer of the one Music class.
import { KNOW_LIMITS as K } from '../../../shared/contract/know.ts';
import { TASTE_LIMITS as T } from '../../../shared/contract/taste.ts';
import { keyOf } from '../areas/music/history-parse';
import { type Applied, apply, type Facts, type Outside } from '../areas/music/know-apply';
import {
  type Ask,
  askFor,
  FAMILY,
  type Got,
  type Kind,
  SOURCES,
  type Source,
  secretsOf,
  type Work,
} from '../areas/music/know-fetch';
import { keepExtras, putBack } from '../areas/music/know-keep';
import { matchAlbum } from '../areas/music/know-match';
import * as plan from '../areas/music/know-plan';
import { type SeedSong, seedAlbums } from '../areas/music/know-seed';
import * as ks from '../areas/music/know-store';
import * as store from '../areas/music/store';
import { MusicSync } from './music-sync';

export type KnowTask =
  | { t: 'lookup'; key: string; name: string }
  | { t: 'fetch'; id: string; source: Source; ask: Ask }
  | { t: 'picks' }
  | { t: 'idle'; wait: number };

const DAY = 86_400_000;
const MB = 'musicbrainz.org';
const todoOf = (kind: string) => SOURCES[(kind in SOURCES ? kind : 'lite') as Kind].join(',');
const MBID_OF = (id: string) => id.slice(2);
const workOf = (r: ks.FactsRow) => JSON.parse(r.work_json) as Work;

export abstract class MusicKnow extends MusicSync {
  protected kx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  protected knowKeys(): plan.Keys {
    const k = secretsOf(this.env);
    return { lastfm: !!k.key, discogs: !!k.token };
  }

  /** The catalog's albums read again once the catalog changed and has been still `seed_quiet_ms` (an
   * upload session of many edits is read once). When to look again, if it is not still yet. */
  private seed(now: number): number {
    const v = store.version(this.db);
    if (ks.knowState(this.db).seeded === v.version) return 0;
    if (now - v.changed_at < K.seed_quiet_ms) return v.changed_at + K.seed_quiet_ms - now;
    const rows = this.db.all<{ id: string; record_json: string; w: number }>(
      'SELECT id, record_json, waveform IS NOT NULL AS w FROM tracks',
    );
    this.kx(() => seedAlbums(this.db, rows, v.version, now));
    return 0;
  }

  /** What the job does next. At most one outside request comes of it. */
  knowNext(now = Date.now()): KnowTask {
    const later = this.seed(now);
    const hosts = ks.hostsOf(this.db);
    const mbBlocked = plan.blockedUntil(hosts, MB, now);
    // A restore brings the matches back without the facts (fetched again, not backed up).
    if (
      !this.db.one('SELECT 1 AS x FROM know_facts LIMIT 1') &&
      this.db.one('SELECT 1 AS x FROM know_albums WHERE artist_mbid IS NOT NULL LIMIT 1')
    )
      this.restoreFacts(now);
    for (let i = 0; i < 40 && !mbBlocked; i++) {
      const a = ks.nextDue(this.db);
      if (!a) break;
      this.phase('matching', now);
      if (!a.artist_mbid) {
        if (a.tries < T.mb_tries) return { t: 'lookup', key: a.artist_key, name: a.artist };
        this.kx(() =>
          a.hint ? this.matched(a, a.hint, null, now) : ks.setArtist(this.db, a.artist_key, null, 'lookup_failed', now),
        );
        continue;
      }
      const id = `a:${a.artist_mbid}`;
      this.kx(() => ks.ensureFacts(this.db, id, 'artist', a.artist, a.plays + 1, todoOf('artist'), now));
      const row = ks.factsOf(this.db, id) as ks.FactsRow;
      if (a.hint) {
        this.kx(() => this.matched(a, a.hint as string, row, now));
        continue;
      }
      // Never judged against a discography not fully read: read it first, or wait for the next round.
      if (workOf(row).disco_done) this.kx(() => this.matchArtist(a.artist_key, row, now));
      else if (row.todo.split(',').includes('disco')) {
        const ask = askFor('disco', { mbid: a.artist_mbid, name: row.name }, workOf(row), this.knowKeys());
        if (ask) return { t: 'fetch', id, source: 'disco', ask };
      } else this.kx(() => ks.discoFailed(this.db, a.artist_mbid as string, now));
    }
    for (let i = 0; i < 40; i++) {
      const row = ks.nextFacts(this.db);
      if (!row) break;
      this.phase('facts', now);
      const f = JSON.parse(row.facts_json) as Facts;
      const next = plan.nextAsk(row, { artist: f.artist?.name, title: f.title }, hosts, this.knowKeys(), now);
      if ('source' in next && !next.drop.length) return { t: 'fetch', id: row.id, source: next.source, ask: next.ask };
      const todo = row.todo.split(',').filter((s) => !next.drop.includes(s as Source));
      if ('source' in next) this.kx(() => this.saved(row, { todo, at: now }));
      else if (next.park && todo.length)
        // Nothing to ask while its hosts refuse: parked, its list kept, until they may be asked.
        this.kx(() =>
          ks.saveFacts(this.db, row, { ...row, todo: todo.join(','), busy: 0, due_at: next.park, at: now }),
        );
      else this.kx(() => this.saved(row, { todo: [], at: now }));
    }
    const st = ks.knowState(this.db);
    const flipped = this.kx(() => {
      let n = ks.refreshDue(this.db, now, todoOf) + ks.retryLookups(this.db, now - K.relook_ms);
      n += ks.keysArrived(this.db, this.knowKeys(), SOURCES);
      if (now - st.refreshed >= DAY) {
        if (now - st.top_at >= K.top_refresh_ms) n += ks.refreshTop(this.db, K.top_artists, now - K.top_refresh_ms);
        if (plan.restoreMissing(this.db, (id, kind, name, prio) => this.putBack(id, kind, name, prio, now))) n++;
        ks.putKnowState(this.db, {
          ...ks.knowState(this.db),
          refreshed: now,
          top_at: now - st.top_at >= K.top_refresh_ms ? now : st.top_at,
        });
      }
      return n;
    });
    if (flipped) return this.knowNext(now);
    if (now - st.picks_at >= K.picks_ms && this.picksStale(st)) return { t: 'picks' };
    this.phase('idle', now);
    const parked = this.db.one<{ t: number | null }>('SELECT min(due_at) AS t FROM know_facts WHERE busy = 0')?.t;
    const waits = [
      K.idle_ms,
      later || K.idle_ms,
      mbBlocked ? mbBlocked - now : K.idle_ms,
      parked ? parked - now : K.idle_ms,
    ];
    return { t: 'idle', wait: Math.max(1_000, Math.min(...waits)) };
  }

  /** After a restore: every facts row put back to be fetched again, and the picks rebuilt after. */
  private restoreFacts(now: number): void {
    this.kx(() => {
      plan.restoreMissing(this.db, (id, kind, name, prio) => this.putBack(id, kind, name, prio, now));
      ks.putKnowState(this.db, { ...ks.knowState(this.db), picks_at: 0 });
    });
  }

  private putBack(id: string, kind: 'artist' | 'album', name: string, prio: number, now: number): void {
    putBack(this.db, { id, kind, name, prio, todo: todoOf(kind) }, now);
  }

  /** Whether facts or plays changed since the picks were built (one index row read for the plays). */
  protected picksStale(st: ks.KnowState): boolean {
    return this.picksSig(st) !== st.built_v;
  }
  protected picksSig(st: ks.KnowState): string {
    const p = this.db.one<{ m: number | null }>('SELECT max(synced_at) AS m FROM track_plays');
    const r = this.db.one<{ m: number | null }>('SELECT max(synced_at) AS m FROM track_ratings');
    const h = this.db.one<{ value_json: string }>("SELECT value_json FROM music_state WHERE key = 'history.totals'");
    return `${st.facts_v}|${p?.m ?? 0}|${r?.m ?? 0}|${h?.value_json.length ?? 0}:${JSON.parse(h?.value_json ?? '{}').plays ?? 0}`;
  }

  private phase(p: ks.KnowState['phase'], now: number): void {
    const st = ks.knowState(this.db);
    if (st.phase !== p) this.kx(() => ks.putKnowState(this.db, { ...st, phase: p, at: now }));
  }

  /** A catalog artist the history did not resolve: MusicBrainz's answer for the albums of that key. */
  knowLookup(key: string, r: { mbid: string; name: string } | 'none' | 'refused' | 'error', now = Date.now()): number {
    return this.kx(() => {
      const hosts = ks.hostsOf(this.db);
      const h = r === 'refused' ? plan.refused(hosts[MB], undefined, now) : plan.answered(hosts[MB], now);
      if (h) ks.putHosts(this.db, { ...hosts, [MB]: h });
      // A refusal is the host's fault and costs the artist no try (2026-11-23: MusicBrainz busy for an
      // hour marked the most played artists failed); only an answer that could not be read does.
      if (r === 'refused') return 0;
      if (r === 'error') return ks.bumpTries(this.db, key);
      if (r === 'none') return ks.setArtist(this.db, key, null, 'artist_unknown', now);
      ks.putName(this.db, keyOf(r.name), `a:${r.mbid}`);
      return ks.setArtist(this.db, key, r.mbid, null, now);
    });
  }

  /** The albums of an artist still due, matched against its (fully read) discography. */
  private matchArtist(artistKey: string, row: ks.FactsRow, now: number): void {
    const disco = (JSON.parse(row.facts_json) as Facts).discography ?? [];
    ks.putName(this.db, keyOf(row.name), row.id);
    for (const a of ks.albumsOfArtist(this.db, artistKey)) {
      if (a.state !== 'due') continue;
      const m = matchAlbum({ title: a.album, songs: a.songs, year: a.year }, disco);
      if ('rg' in m) this.matched(a, m.rg, row, now);
      else ks.setMatch(this.db, a.album_key, m, now);
    }
  }

  /** An album matched: its release group's facts row, and Muse's recordings kept as they came. */
  private matched(a: ks.AlbumRow, rg: string, artist: ks.FactsRow | null, now: number): void {
    ks.setMatch(this.db, a.album_key, { rg }, now);
    const known = ((artist ? JSON.parse(artist.facts_json) : {}) as Facts).discography?.find((r) => r.mbid === rg);
    const id = `g:${rg}`;
    ks.ensureFacts(this.db, id, 'album', known?.title ?? a.album, a.plays + 0.5, todoOf('album'), now);
    const row = ks.factsOf(this.db, id) as ks.FactsRow;
    if (row.facts_json === '{}') {
      const facts: Facts = {
        title: known?.title ?? a.album,
        artist: { mbid: a.artist_mbid, name: artist ? artist.name : a.artist },
        type: known?.type ?? null,
        secondary: known?.secondary ?? [],
        first_release: known?.date ?? null,
      };
      ks.saveFacts(this.db, row, { ...row, facts_json: JSON.stringify(facts), at: now });
      if (known) ks.putName(this.db, keyOf(known.title), id);
    }
    const songs = JSON.parse(a.songs_json) as SeedSong[];
    const muse = songs.flatMap((s) => (s.recording ? [{ id: s.id, recording: s.recording, how: 'muse' }] : []));
    if (muse.length) ks.putSongs(this.db, a.album_key, muse);
  }

  /** One source's answer for one facts row. A host's refusal backs it off; any failure counts against
   * the row's tries for that source; nothing of a failed answer is kept. */
  knowPut(id: string, source: Source, got: Got, now = Date.now()): number {
    const row = ks.factsOf(this.db, id);
    if (!row) return 0;
    const facts = JSON.parse(row.facts_json) as Facts;
    const ask = askFor(
      source,
      { mbid: MBID_OF(id), name: row.name, artist: facts.artist?.name, title: facts.title },
      workOf(row),
      this.knowKeys(),
    );
    return this.kx(() => {
      const hosts = ks.hostsOf(this.db);
      const host = ask?.host ?? '';
      const todo = row.todo.split(',').filter(Boolean);
      const rest = todo.filter((s) => s !== source);
      let n = 0;
      const h = plan.hostFault(got) ? plan.refused(hosts[host], got.retry, now) : plan.answered(hosts[host], now);
      if (h && host) n += ks.putHosts(this.db, { ...hosts, [host]: h });
      if ('error' in got) {
        const f = plan.rowFailed(workOf(row), source);
        if (f.gaveUp && source === 'disco' && !workOf(row).disco_done) n += ks.discoFailed(this.db, MBID_OF(id), now);
        return n + this.saved(row, { todo: f.gaveUp ? rest : todo, at: now, work: f.work });
      }
      const w = workOf(row);
      if (w.tries?.[source]) delete w.tries[source];
      if ('none' in got) return n + this.saved(row, { todo: rest, at: now, work: w });
      const a = apply(source, row.kind, facts, JSON.parse(row.outside_json), w, got.ok);
      n += keepExtras(this.db, row, a, now);
      const filled = { ...JSON.parse(row.filled_json), [FAMILY[source]]: now };
      n += this.saved(row, { todo: a.again ? todo : rest, at: now, a, filled });
      if (source === 'disco' && !a.again && row.kind === 'artist') {
        // A whole discography: albums left unmatched for want of it are matched again, now.
        n += ks.rematch(this.db, MBID_OF(id));
        const keyRow = ks.factsOf(this.db, id) as ks.FactsRow;
        const keys = this.db.all<{ artist_key: string }>(
          `SELECT DISTINCT artist_key FROM know_albums WHERE artist_mbid = ? AND state = 'due'`,
          MBID_OF(id),
        );
        for (const k of keys) this.matchArtist(k.artist_key, keyRow, now);
      }
      return n;
    });
  }

  protected saved(
    row: ks.FactsRow,
    p: { todo: string[]; at: number; a?: Applied; filled?: object; work?: Work },
  ): number {
    const done = p.todo.length === 0;
    // A row done is what the picks are rebuilt for (`facts_v`, picksSig), not each step.
    if (done && row.busy) {
      const st = ks.knowState(this.db);
      ks.putKnowState(this.db, { ...st, facts_v: st.facts_v + 1 });
    }
    const work = p.a?.work ?? p.work;
    return ks.saveFacts(this.db, row, {
      ...row,
      name: (row.kind !== 'album' && p.a?.facts.name) || row.name,
      facts_json: p.a ? JSON.stringify(p.a.facts) : row.facts_json,
      outside_json: p.a ? JSON.stringify(p.a.outside satisfies Outside) : row.outside_json,
      work_json: work ? JSON.stringify(work) : row.work_json,
      filled_json: p.filled ? JSON.stringify(p.filled) : row.filled_json,
      todo: p.todo.join(','),
      busy: done ? 0 : 1,
      due_at: done ? p.at + K.refresh_ms : row.due_at,
      at: p.at,
    });
  }
}
