// The picks and the reads of the music knowledge in the Music object (MUSIC.md §19.3–19.5;
// areas/music/picks-*.ts, know-read.ts): the daily rebuild from stored facts and the owner's
// listening, the owner's answers (decline, order, and added when the album reaches the catalog, with
// the per-kind weights learning from each), and what the routes read. A code layer of the one Music class.
import {
  type FactsResponse,
  KNOW_LIMITS as K,
  KNOW_SOURCES,
  type KnowSource,
  type KnowStatus,
  type PickKind,
  type PickState,
  type PicksResponse,
} from '../../../shared/contract/know.ts';
import { similarOf } from '../areas/music/history-store';
import type { Facts, Outside } from '../areas/music/know-apply';
import { SOURCES } from '../areas/music/know-fetch';
import { hostsStatus } from '../areas/music/know-plan';
import * as read from '../areas/music/know-read';
import * as ks from '../areas/music/know-store';
import { getState, putState } from '../areas/music/listen-store';
import { loveOf, scaled } from '../areas/music/picks-input';
import { type Loved, learn, mix, type Other, orderWords, type Person, scorePicks } from '../areas/music/picks-score';
import * as ps from '../areas/music/picks-store';
import { MusicKnow } from './music-know';

type Counts = Omit<KnowStatus, 'phase' | 'at' | 'hosts' | 'waveforms'> & { counted_at: number };
/** The status's counts are counted again at most this often (they read every album and facts row). */
const COUNT_MS = 10 * 60_000;

export abstract class MusicPicks extends MusicKnow {
  /** Rebuilds the picks (the job's `picks` step, at most daily). Returns the rows written. */
  picksBuild(skips: Record<string, number>, now = Date.now()): number {
    const love = loveOf(this.db, now, skips);
    const artists = scaled(love.artists);
    const albums = scaled(love.albums);
    const top = [...artists].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const rows = new Map(
      ks
        .factsByIds(
          this.db,
          top.map(([m]) => `a:${m}`),
        )
        .map((r) => [r.id.slice(2), r]),
    );
    const loved: Loved[] = top.flatMap(([mbid, l]) => {
      const r = rows.get(mbid);
      if (!r) return [];
      const f = JSON.parse(r.facts_json) as Facts;
      const similar = JSON.parse(similarOf(this.db, mbid)?.items_json ?? '[]');
      return [
        {
          mbid,
          name: f.name ?? r.name,
          love: l,
          disco: f.discography ?? [],
          tags: (JSON.parse(r.outside_json) as Outside).tags ?? [],
          similar,
          influenced_by: f.influenced_by ?? [],
          influenced: f.influenced ?? [],
        },
      ];
    });
    // Who may come through: neighbours named by two or more, influences, and people behind loved albums.
    // A neighbour's name is the one the similar-artists answer gave (MusicBrainz's canonical name).
    const named = new Map<string, { n: number; name: string }>();
    for (const a of loved)
      for (const s of a.similar as { mbid: string; name: string }[])
        named.set(s.mbid, { n: (named.get(s.mbid)?.n ?? 0) + 1, name: s.name });
    const wanted = new Map<string, { kind: 'lite' | 'person'; name: string; prio: number }>();
    for (const [m, x] of named) if (x.n >= 2 && x.name) wanted.set(m, { kind: 'lite', name: x.name, prio: x.n / 100 });
    for (const a of loved)
      for (const l of [...a.influenced_by, ...a.influenced])
        if (l.mbid) wanted.set(l.mbid, { kind: 'lite', name: l.name, prio: a.love / 100 });
    const lovedRgs = [...albums]
      .filter(([, l]) => l >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([g]) => g);
    const credits = ks.creditsOfGroups(this.db, lovedRgs);
    const people = new Map<string, { name: string; rgs: Set<string> }>();
    for (const c of credits) {
      const own = love.albums.get(c.rg)?.artist;
      if (c.person.startsWith('n:') || c.person === own) continue;
      const p = people.get(c.person) ?? { name: c.name, rgs: new Set() };
      p.rgs.add(c.rg);
      people.set(c.person, p);
    }
    for (const [m, p] of people)
      if (p.rgs.size >= K.credit_albums) wanted.set(m, { kind: 'person', name: p.name, prio: p.rgs.size / 100 });
    const known = new Map(
      ks
        .factsByIds(
          this.db,
          [...wanted.keys()].map((m) => `a:${m}`),
        )
        .map((r) => [r.id.slice(2), r]),
    );
    const others: Record<string, Other> = {};
    for (const [m, r] of known) {
      const f = JSON.parse(r.facts_json) as Facts;
      if (f.discography?.length)
        others[m] = {
          name: f.name || r.name || wanted.get(m)?.name || '',
          disco: f.discography,
          tags: (JSON.parse(r.outside_json) as Outside).tags ?? [],
        };
    }
    const names = new Map(loved.map((a) => [a.mbid, a.name]));
    const lovedBy = (rg: string) => names.get(love.albums.get(rg)?.artist ?? '') ?? '';
    const persons: Person[] = [...people].flatMap(([m, p]) =>
      p.rgs.size >= K.credit_albums && others[m]
        ? [
            {
              mbid: m,
              name: p.name,
              loved: p.rgs.size,
              via: [...new Set([...p.rgs].map(lovedBy).filter(Boolean))],
              work: others[m].disco.map((d) => ({ ...d, artist: others[m].name, artist_mbid: m })),
            },
          ]
        : [],
    );
    const answered = [
      ...ps.picksIn(this.db, 'declined', 500),
      ...ps.picksIn(this.db, 'ordered', 500),
      ...ps.picksIn(this.db, 'added', 500),
    ];
    const declinedArtists = new Map<string, number>();
    for (const d of answered)
      if (d.state === 'declined') declinedArtists.set(d.artist_mbid, (declinedArtists.get(d.artist_mbid) ?? 0) + 1);
    return this.kx(() => {
      let n = 0;
      let w = ps.weightsOf(this.db);
      // Answers the catalog gives: an ordered or offered album now in it is added; one then played, played.
      for (const p of [...ps.picksIn(this.db, 'new', K.picks_kept), ...answered.filter((a) => a.state === 'ordered')])
        if (love.library.rgs.has(p.id)) {
          n += ps.setState(this.db, p.id, 'added', now);
          w = learn(w, p.kind, 'added');
        }
      for (const p of ps.picksIn(this.db, 'added', 500))
        if (!p.played && (love.albums.get(p.id)?.lastPlayed ?? 0) > p.state_at) {
          n += ps.markPlayed(this.db, p.id);
          w = learn(w, p.kind, 'played');
        }
      n += ps.putWeights(this.db, w);
      for (const [m, x] of wanted)
        if (!known.has(m))
          n += ks.ensureFacts(this.db, `a:${m}`, x.kind, x.name, x.prio, SOURCES[x.kind].join(','), now);
      const scored = scorePicks({
        now,
        weights: w,
        loved,
        others,
        people: persons,
        library: love.library,
        declined: new Set(answered.filter((a) => a.state === 'declined').map((a) => a.id)),
        declinedArtists,
        held: new Set(answered.filter((a) => a.state !== 'declined').map((a) => a.id)),
      });
      n += ps.putPicks(this.db, scored, now);
      const st = ks.knowState(this.db);
      n += ks.putKnowState(this.db, { ...st, picks_at: now, built_v: this.picksSig(st), phase: 'picks', at: now });
      return n;
    });
  }

  picks(q: { kind?: PickKind; state?: PickState; limit: number }): PicksResponse {
    const state = q.state ?? 'new';
    const rows = ps
      .picksIn(this.db, state, state === 'new' ? K.picks_kept : 200)
      .filter((r) => !q.kind || r.kind === q.kind);
    const items = (state === 'new' && !q.kind ? mix(rows, q.limit) : rows.slice(0, q.limit)).map(ps.toPick);
    return { items, built_at: ks.knowState(this.db).picks_at || null, weights: ps.weightsOf(this.db) };
  }

  /** The owner's no: never offered again, and its kind and artist weigh less. Null when no such pick. */
  pickDecline(id: string, why: string | null, now = Date.now()) {
    const r = ps.pickOf(this.db, id);
    if (!r) return null;
    if (r.state === 'declined') return ps.toPick(r);
    this.kx(() => {
      ps.setState(this.db, id, 'declined', now, why ? { why } : {});
      ps.putWeights(this.db, learn(ps.weightsOf(this.db), r.kind, 'declined'));
    });
    return ps.toPick(ps.pickOf(this.db, id) as ps.PickRow);
  }

  /** A pick's artist and album as MusicBrainz names them (its preview's search, §19.7). Null when no such pick. */
  pickNames(id: string): { id: string; artist: string; album: string } | null {
    const r = ps.pickOf(this.db, id);
    return r ? { id, artist: ps.toPick(r).artist, album: ps.toPick(r).album } : null;
  }

  /** The words of a Muse order for a pick's album (ids and canonical names only); with the order's id,
   * the pick is ordered. Null when no such pick. */
  pickOrder(id: string, orderId: string | null, now = Date.now()) {
    const r = ps.pickOf(this.db, id);
    if (!r) return null;
    const p = ps.toPick(r);
    const words = orderWords(p);
    if (orderId && r.state === 'new') this.kx(() => ps.setState(this.db, id, 'ordered', now, { order_id: orderId }));
    return { id, state: (ps.pickOf(this.db, id) as ps.PickRow).state, words };
  }

  knowFacts(ref: string): FactsResponse {
    return { items: read.facts(this.db, ref) };
  }
  knowCredits(ref: string) {
    return read.credits(this.db, ref);
  }
  knowUnmatched() {
    return read.unmatched(this.db, this.knowCounts().albums.unmatched);
  }

  knowStatus(now = Date.now()): KnowStatus {
    const st = ks.knowState(this.db);
    const { counted_at: _, ...c } = this.knowCounts(now);
    const hosts = hostsStatus(ks.hostsOf(this.db), now);
    return { ...c, phase: st.phase, at: st.at || null, hosts, waveforms: st.waveforms ?? null };
  }

  /** How far the job is: albums by state, songs matched, artists done, rows each source filled. */
  private knowCounts(now = Date.now()): Counts {
    const had = getState<Counts>(this.db, 'know.counts');
    if (had && now - had.counted_at < COUNT_MS) return had;
    const albums = { total: 0, matched: 0, unmatched: 0, due: 0 };
    let songs = 0;
    for (const r of this.db.all<{ state: 'due' | 'matched' | 'unmatched'; n: number; s: number }>(
      'SELECT state, count(*) AS n, sum(matched_songs) AS s FROM know_albums GROUP BY state',
    )) {
      albums[r.state] = r.n;
      albums.total += r.n;
      songs += r.s ?? 0;
    }
    const filled = Object.fromEntries(KNOW_SOURCES.map((s) => [s, 0])) as Record<KnowSource, number>;
    const artists = { total: 0, done: 0 };
    for (const r of this.db.all<{ kind: string; busy: number; filled_json: string }>(
      'SELECT kind, busy, filled_json FROM know_facts',
    )) {
      if (r.kind === 'artist') {
        artists.total++;
        if (!r.busy) artists.done++;
      }
      for (const s of Object.keys(JSON.parse(r.filled_json)) as KnowSource[]) if (s in filled) filled[s]++;
    }
    const out: Counts = {
      albums,
      songs: { matched: songs },
      artists,
      filled,
      picks: ps.pickCounts(this.db),
      counted_at: now,
    };
    this.kx(() => putState(this.db, 'know.counts', out));
    return out;
  }
}
