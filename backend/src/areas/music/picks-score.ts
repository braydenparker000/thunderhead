// Picks to add (MUSIC.md §19.4), pure: albums the library lacks, scored over stored facts and the
// owner's own listening. Five kinds: `gap` (an album of an artist the owner loves, by how loved the
// album is), `new` (such an artist's release of the last 90 days), `neighbour` (an artist not in the
// library close to several top artists at once, with its best-loved album), `credit` (other work of a
// person behind 3 or more loved albums) and `influence` (who influenced, or was influenced by, an
// artist the owner loves). Never something in the library or declined; albums and EPs first; at most
// two an artist; a mixed list. Each pick keeps its reason as facts; `lineOf` makes its one plain line.
import {
  GENRE_WORDS,
  KNOW_LIMITS as K,
  type KnowLink,
  type KnowRelease,
  PICK_KINDS,
  type PickKind,
  type PickReason,
} from '../../../../shared/contract/know.ts';
import { eligible, fold } from './know-match';

const GENRE = new Set(GENRE_WORDS);

export interface Loved {
  mbid: string;
  name: string;
  /** 0–1: how much the owner listens to them, recent listening weighing more. */
  love: number;
  disco: KnowRelease[];
  tags: { name: string; weight: number }[];
  similar: { mbid: string; name: string; score: number }[];
  influenced_by: KnowLink[];
  influenced: KnowLink[];
}
export interface Other {
  name: string;
  disco: KnowRelease[];
  tags: { name: string; weight: number }[];
}
export interface Person {
  mbid: string;
  name: string;
  /** The owner's loved albums this person worked on, and those albums' artists. */
  loved: number;
  via: string[];
  work: (KnowRelease & { artist_mbid: string; artist: string })[];
}
export interface ScoreInput {
  now: number;
  weights: Record<PickKind, number>;
  loved: Loved[];
  others: Record<string, Other>;
  people: Person[];
  /** In the library: matched release groups, artists, and each artist's own album titles (folded),
   * so an album the owner has but that stayed unmatched is never offered. */
  library: { rgs: Set<string>; artists: Set<string>; titles?: Map<string, Set<string>> };
  declined: Set<string>;
  /** Declines per artist: each makes that artist weigh less. */
  declinedArtists: Map<string, number>;
  /** Picks already ordered or added: never made again. */
  held: Set<string>;
}
export interface Scored {
  id: string;
  kind: PickKind;
  album: string;
  artist: string;
  artist_mbid: string;
  year: number | null;
  type: string | null;
  score: number;
  reason: PickReason;
}

export const DECLINE_FACTOR = 0.7;
const yearOf = (d: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const daysSince = (d: string | null, now: number) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return Math.floor((now - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
};
/** How loved each release group is within one discography, 0–1 (0.3 when nothing says). */
function lovedness(disco: KnowRelease[]): (r: KnowRelease) => number {
  const max = Math.max(0, ...disco.map((r) => r.listens ?? 0));
  return (r) => (max > 0 ? Math.log1p(r.listens ?? 0) / Math.log1p(max) : 0.3);
}
/** The best-loved album an artist's discography offers. */
function best(disco: KnowRelease[], skip: (r: KnowRelease) => boolean): KnowRelease | null {
  const pool = eligible(disco).filter((r) => !skip(r));
  return (
    pool.sort((a, b) => (b.listens ?? -1) - (a.listens ?? -1) || (a.date ?? '9').localeCompare(b.date ?? '9'))[0] ??
    null
  );
}
const reason = (kind: PickKind, p: Partial<PickReason>): PickReason => ({
  kind,
  via: [],
  listens: null,
  count: 0,
  tags: [],
  days: null,
  person: null,
  dir: null,
  ...p,
});

export function scorePicks(i: ScoreInput): Scored[] {
  const out = new Map<string, Scored>();
  const owned = (r: KnowRelease, artist: string) => i.library.titles?.get(artist)?.has(fold(r.title)) ?? false;
  const goneOf = (artist: string) => (r: KnowRelease) =>
    i.library.rgs.has(r.mbid) || i.declined.has(r.mbid) || i.held.has(r.mbid) || owned(r, artist);
  const add = (s: Omit<Scored, 'score'> & { raw: number }) => {
    // A pick is named only by MusicBrainz's canonical artist and title: without either, none.
    if (!s.artist.trim() || !s.album.trim()) return;
    const penalty = DECLINE_FACTOR ** (i.declinedArtists.get(s.artist_mbid) ?? 0);
    const score = Math.round(s.raw * (i.weights[s.kind] ?? 1) * penalty * 1000) / 1000;
    const { raw: _, ...rest } = s;
    if (score > (out.get(s.id)?.score ?? 0)) out.set(s.id, { ...rest, score });
  };
  const of = (r: KnowRelease, artist: string, mbid: string) => ({
    id: r.mbid,
    album: r.title,
    artist,
    artist_mbid: mbid,
    year: yearOf(r.date),
    type: r.type,
  });
  for (const a of i.loved) {
    const how = lovedness(a.disco);
    const gone = goneOf(a.mbid);
    for (const r of eligible(a.disco)) {
      if (gone(r)) continue;
      const days = daysSince(r.date, i.now);
      if (days !== null && days >= 0 && days <= K.new_days)
        add({
          ...of(r, a.name, a.mbid),
          kind: 'new',
          raw: a.love,
          reason: reason('new', { via: [a.name], days, listens: r.listens }),
        });
      else
        add({
          ...of(r, a.name, a.mbid),
          kind: 'gap',
          raw: a.love * how(r),
          reason: reason('gap', { via: [a.name], listens: r.listens }),
        });
    }
    for (const [list, dir] of [
      [a.influenced_by, 'on'],
      [a.influenced, 'by'],
    ] as const)
      for (const l of list) {
        const o = l.mbid ? i.others[l.mbid] : undefined;
        if (!l.mbid || !o || i.library.artists.has(l.mbid)) continue;
        const r = best(o.disco, goneOf(l.mbid));
        if (r)
          add({
            ...of(r, o.name, l.mbid),
            kind: 'influence',
            raw: 0.8 * a.love,
            reason: reason('influence', { via: [a.name], dir, listens: r.listens }),
          });
      }
  }
  // Neighbours: close to two or more top artists at once, sharing their strongest tags.
  const near = new Map<string, { via: Loved[]; score: number }>();
  for (const a of i.loved)
    for (const s of a.similar) {
      if (i.library.artists.has(s.mbid)) continue;
      const n = near.get(s.mbid) ?? { via: [], score: 0 };
      n.via.push(a);
      n.score += s.score * a.love;
      near.set(s.mbid, n);
    }
  for (const [mbid, n] of near) {
    const o = i.others[mbid];
    if (n.via.length < 2 || !o) continue;
    // Only genre words from the fixed list count, and only they reach a line: tags are anyone's text.
    const genre = (t: { name: string }) => GENRE.has(t.name);
    const theirs = new Set(
      o.tags
        .filter(genre)
        .slice(0, 5)
        .map((t) => t.name),
    );
    const strong = new Set(
      n.via.flatMap((v) =>
        v.tags
          .filter(genre)
          .slice(0, 5)
          .map((t) => t.name),
      ),
    );
    const tags = [...theirs].filter((t) => strong.has(t)).slice(0, 3);
    const r = best(o.disco, goneOf(mbid));
    if (!r) continue;
    const raw = (n.score / n.via.length) * Math.min(1, n.via.length / 3) * (1 + 0.1 * tags.length);
    const via = n.via
      .sort((x, y) => y.love - x.love)
      .map((v) => v.name)
      .slice(0, 3);
    add({
      ...of(r, o.name, mbid),
      kind: 'neighbour',
      raw,
      reason: reason('neighbour', { via, count: n.via.length, tags, listens: r.listens }),
    });
  }
  for (const p of i.people) {
    if (p.loved < K.credit_albums) continue;
    const how = lovedness(p.work);
    for (const r of eligible(p.work)) {
      const w = p.work.find((x) => x.mbid === r.mbid) ?? { artist: p.name, artist_mbid: p.mbid };
      if (goneOf(w.artist_mbid)(r)) continue;
      const raw = Math.min(1, p.loved / 5) * how(r) * 0.9;
      add({
        ...of(r, w.artist, w.artist_mbid),
        kind: 'credit',
        raw,
        reason: reason('credit', { via: p.via.slice(0, 3), count: p.loved, person: p.name, listens: r.listens }),
      });
    }
  }
  return mix(
    [...out.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)),
    K.picks_kept,
  );
}

/** The top of a ranked list: at most two an artist, and no kind filling more than half. */
export function mix<T extends { kind: PickKind; artist_mbid: string }>(ranked: T[], limit: number): T[] {
  const kinds = new Set(ranked.map((r) => r.kind)).size;
  const cap = kinds > 1 ? Math.max(1, Math.floor(limit / 2)) : limit;
  const byKind = new Map<string, number>();
  const byArtist = new Map<string, number>();
  const out: T[] = [];
  for (const r of ranked) {
    if (out.length >= limit) break;
    if ((byArtist.get(r.artist_mbid) ?? 0) >= K.per_artist || (byKind.get(r.kind) ?? 0) >= cap) continue;
    byArtist.set(r.artist_mbid, (byArtist.get(r.artist_mbid) ?? 0) + 1);
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    out.push(r);
  }
  return out;
}

/** A pick's one plain line, from its reason. */
export function lineOf(p: { album: string; artist: string; year: number | null; reason: PickReason }): string {
  const r = p.reason;
  const album = p.year ? `${p.album} (${p.year})` : p.album;
  const two = r.via.slice(0, 2).join(' and ');
  switch (r.kind) {
    case 'gap':
      return `${album} by ${p.artist}: one of their best-loved albums, and not in your library.`;
    case 'new':
      return `${album} by ${p.artist}: out ${r.days === 0 ? 'today' : `${r.days} day${r.days === 1 ? '' : 's'} ago`}.`;
    case 'neighbour':
      return `${p.artist} sits close to ${two}${r.tags.length ? `, all ${r.tags.join(', ')}` : ''}. Start with ${album}.`;
    case 'credit':
      return `${album} by ${p.artist}: ${r.person} worked on ${r.count} albums you love.`;
    case 'influence':
      return r.dir === 'on'
        ? `${p.artist} influenced ${two}. Start with ${album}.`
        : `${p.artist} was influenced by ${two}. Start with ${album}.`;
  }
}

/** Outside text made safe for an order's words: letters, digits, spaces and plain punctuation only (no
 * quotes, backticks, `$`, backslashes, newlines or other control), collapsed and capped. */
export function safeText(s: string, max = 120): string {
  return s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} .,:;!?()&+\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** The words of a Muse order for a pick: its album and artist made safe, and their MusicBrainz ids. */
export function orderWords(p: { id: string; album: string; artist: string; artist_mbid: string; year: number | null }) {
  const year = p.year ? ` (${p.year})` : '';
  return `Find and upload the album ${safeText(p.album)} by ${safeText(p.artist)}${year} to the music library: MusicBrainz release group ${p.id}, artist ${p.artist_mbid}. Send the MusicBrainz ids of each song with it.`.slice(
    0,
    500,
  );
}

/** The per-kind weights after an answer: a decline lowers its kind a little, an add raises it, and
 * an added album the owner then plays raises it again. Kept in 0.5–1.5. */
export function learn(w: Record<PickKind, number>, kind: PickKind, what: 'declined' | 'added' | 'played') {
  const f = what === 'declined' ? 0.95 : 1.05;
  return { ...w, [kind]: Math.round(Math.min(1.5, Math.max(0.5, (w[kind] ?? 1) * f)) * 1000) / 1000 };
}
export const START_WEIGHTS = Object.fromEntries(PICK_KINDS.map((k) => [k, 1])) as Record<PickKind, number>;
