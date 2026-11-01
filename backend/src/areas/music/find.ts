// Songs by feeling (GET /v1/music/find, MUSIC.md §10.5): a pure ranking over the catalog's tags, the
// mind's notes and, where the listening pass (Music schema step 3) has measured a song, its audio.
//
//   score = 1.0 · mood fit      (each asked mood's confidence, the note's and the audio's averaged
//                                where both have it, then the mean over the asked moods)
//         + 0.8 · occasion fit  (the note's confidence for the asked occasion)
//         + 0.5 · energy fit    (1 − |energy − target|; the audio's energy before the note's)
//         + 1.0 · likeness      (to `like`: the listening pass's neighbours when it has them for that
//                                song, else moods, occasions, tags, era, language and energy)
//         − 0.25 · early skips  (skips before 30 s in the last 30 days)
//
// A song must show the asked feeling (mood and occasion fit together over 0.15), a known energy
// when energy is all that is asked, or some likeness. Songs the owner said never to play again,
// and songs skipped early three times in 30 days (MUSIC.md §4.2), are left out and counted.
import {
  MUSIC_NOTE_LIMITS as L,
  MUSIC_MOODS,
  MUSIC_OCCASIONS,
  type MusicFindItem,
  type MusicFindResponse,
  type MusicMood,
  type MusicNoteRow,
  type MusicOccasion,
  type MusicTrackRow,
} from '../../../../shared/contract/music.ts';
import type { Issue } from './notes';
import { SONG_ID } from './shapes';

/** What the listening pass knows of a song. */
export interface Listening {
  energy: number | null;
  moods: Partial<Record<MusicMood, number>>;
  neighbours: { id: string; score: number }[];
}

export interface FindQuery {
  moods: MusicMood[];
  occasion: MusicOccasion | null;
  energy: number | null;
  like: string | null;
  limit: number;
}

const ENERGY: Record<string, number> = { low: 0.2, mid: 0.5, high: 0.8 };
const W = { mood: 1, occasion: 0.8, energy: 0.5, like: 1, skip: 0.25 };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The query string, checked: the query, or what is wrong with it. */
export function parseFind(q: Record<string, string | undefined>): FindQuery | { issues: Issue[] } {
  const issues: Issue[] = [];
  const moods = (q.moods ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  for (const m of moods)
    if (!(MUSIC_MOODS as readonly string[]).includes(m)) issues.push({ path: 'moods', issue: `${m} is not a mood` });
  if (moods.length > L.find_moods || new Set(moods).size !== moods.length)
    issues.push({ path: 'moods', issue: `at most ${L.find_moods} different moods` });
  const occasion = q.occasion?.trim() || null;
  if (occasion !== null && !(MUSIC_OCCASIONS as readonly string[]).includes(occasion))
    issues.push({ path: 'occasion', issue: `one of ${MUSIC_OCCASIONS.join(', ')}` });
  let energy: number | null = null;
  if (q.energy !== undefined && q.energy !== '') {
    energy = ENERGY[q.energy] ?? (/^(0(\.\d+)?|1(\.0+)?)$/.test(q.energy) ? Number(q.energy) : Number.NaN);
    if (Number.isNaN(energy)) issues.push({ path: 'energy', issue: 'low, mid, high or 0 to 1' });
  }
  const like = q.like?.trim() || null;
  if (like !== null && !SONG_ID.test(like)) issues.push({ path: 'like', issue: 'a track id' });
  const limit = q.limit === undefined || q.limit === '' ? L.find_default : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > L.find_max)
    issues.push({ path: 'limit', issue: `1 to ${L.find_max}` });
  if (!moods.length && !occasion && energy === null && !like)
    issues.push({ path: 'moods', issue: 'ask for moods, an occasion, an energy or like' });
  return issues.length
    ? { issues }
    : { moods: moods as MusicMood[], occasion: occasion as MusicOccasion, energy, like, limit };
}

/** A song's moods: the note's and the audio's averaged where both score one. */
function moodsOf(n: MusicNoteRow | undefined, a: Listening | undefined): Partial<Record<MusicMood, number>> {
  if (!a) return n?.moods ?? {};
  if (!n) return a.moods;
  const out: Partial<Record<MusicMood, number>> = {};
  for (const m of MUSIC_MOODS) {
    const x = n.moods[m];
    const y = a.moods[m];
    if (x !== undefined || y !== undefined) out[m] = x !== undefined && y !== undefined ? (x + y) / 2 : (x ?? y);
  }
  return out;
}

function cosine(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>, keys: readonly string[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[,;/&]+/)
    .map((w) => w.trim())
    .filter(Boolean);

/** How close two songs' tags are (the DJ's own measure, MUSIC.md §9), 0 to 1. */
function tagCloseness(a: MusicTrackRow, b: MusicTrackRow): number {
  let s = 0;
  if (a.composer && a.composer === b.composer) s += 0.6;
  if (a.artist && a.artist === b.artist) s += 0.4;
  const g = new Set(words(a.genre));
  s += Math.min(0.5, words(b.genre).filter((w) => g.has(w)).length * 0.25);
  const dy = a.year && b.year ? Math.abs(a.year - b.year) : 99;
  s += dy <= 2 ? 0.2 : dy <= 5 ? 0.1 : 0;
  return Math.min(1, s);
}

export interface Known {
  tracks: MusicTrackRow[];
  notes: Map<string, MusicNoteRow>;
  listening: Map<string, Listening> | null;
}

/** How alike `x` is to the seed, 0 and up: the neighbours' score when the listening pass gave the
 * seed some, else from the notes and tags. */
function likeness(k: Known, seed: MusicTrackRow, x: MusicTrackRow, near: Map<string, number> | null): number {
  if (near) return near.get(x.id) ?? 0;
  const ns = k.notes.get(seed.id);
  const nx = k.notes.get(x.id);
  const as = k.listening?.get(seed.id);
  const ax = k.listening?.get(x.id);
  let s = 0.5 * tagCloseness(seed, x);
  s += cosine(moodsOf(ns, as), moodsOf(nx, ax), MUSIC_MOODS);
  if (ns && nx) {
    s += 0.5 * cosine(ns.occasions, nx.occasions, MUSIC_OCCASIONS);
    if (ns.language && ns.language === nx.language) s += 0.1;
    if (ns.era && ns.era === nx.era) s += 0.1;
  }
  const es = as?.energy ?? ns?.energy ?? null;
  const ex = ax?.energy ?? nx?.energy ?? null;
  if (es !== null && ex !== null) s += 0.2 * (1 - Math.abs(es - ex));
  return s;
}

/** The ranking. `skips`: early skips by track id; `never`: ids the owner ruled out. Null when
 * `like` names a song the catalog doesn't hold. */
export function rank(k: Known, q: FindQuery, skips: Map<string, number>, never: Set<string>): MusicFindResponse | null {
  const seed = q.like ? k.tracks.find((t) => t.id === q.like) : undefined;
  if (q.like && !seed) return null;
  const nb = seed ? k.listening?.get(seed.id)?.neighbours : undefined;
  const near = nb?.length ? new Map(nb.map((n) => [n.id, n.score])) : null;
  const left_out = { never: 0, skipped: 0 };
  const scored: { item: MusicFindItem; raw: number; ord: number }[] = [];
  k.tracks.forEach((t, ord) => {
    // Like a song the listening pass measured: its neighbours are the candidates.
    if ((seed && t.id === seed.id) || (near && !near.has(t.id))) return;
    const n = k.notes.get(t.id);
    const a = k.listening?.get(t.id);
    const why: MusicFindItem['why'] = {};
    let score = 0;
    let feel = 0;
    if (q.moods.length) {
      const m = moodsOf(n, a);
      const fit = q.moods.reduce((s, x) => s + (m[x] ?? 0), 0) / q.moods.length;
      why.moods = Object.fromEntries(q.moods.filter((x) => m[x] !== undefined).map((x) => [x, r2(m[x] as number)]));
      score += W.mood * fit;
      feel += fit;
    }
    if (q.occasion) {
      const fit = n?.occasions[q.occasion] ?? 0;
      if (fit) why.occasion = fit;
      score += W.occasion * fit;
      feel += fit;
    }
    const energy = a?.energy ?? n?.energy ?? null;
    if (q.energy !== null && energy !== null) {
      why.energy = r2(energy);
      score += W.energy * (1 - Math.abs(energy - q.energy));
    }
    if (seed) {
      const like = likeness(k, seed, t, near);
      if (like > 0) why.like = r2(like);
      score += W.like * like;
    }
    const asked = q.moods.length || q.occasion;
    const shows = asked ? feel > 0.15 : seed ? (why.like ?? 0) > 0 : energy !== null;
    if (!shows) return;
    if (never.has(t.id)) {
      left_out.never++;
      return;
    }
    const s = skips.get(t.id) ?? 0;
    if (s >= L.skip_exclude) {
      left_out.skipped++;
      return;
    }
    if (s) {
      why.skips = s;
      score -= W.skip * s;
    }
    scored.push({ item: { ...t, score: r2(score), known: n ? n.known : null, why }, raw: score, ord });
  });
  scored.sort((x, y) => y.raw - x.raw || x.ord - y.ord);
  return {
    items: scored.slice(0, q.limit).map((s) => s.item),
    total: scored.length,
    analysis: k.listening !== null,
    left_out,
  };
}

/** The listening pass's rows as find reads them; a row it can't read is left out. */
export function listeningMap(
  rows: { track_id: string; energy: number | null; moods_json: string | null; neighbours_json: string | null }[],
): Map<string, Listening> {
  const out = new Map<string, Listening>();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
  for (const r of rows) {
    try {
      const moods: Partial<Record<MusicMood, number>> = {};
      const m = r.moods_json ? (JSON.parse(r.moods_json) as Record<string, unknown>) : {};
      for (const k of MUSIC_MOODS) {
        const v = num(m[k]);
        if (v) moods[k] = v;
      }
      const nb = r.neighbours_json ? (JSON.parse(r.neighbours_json) as unknown[]) : [];
      const neighbours = nb.flatMap((x, i) => {
        const o = (typeof x === 'string' ? { id: x } : x) as { id?: unknown; score?: unknown };
        return typeof o?.id === 'string' ? [{ id: o.id, score: num(o.score) ?? 1 - i / Math.max(1, nb.length) }] : [];
      });
      out.set(r.track_id, { energy: num(r.energy), moods, neighbours });
    } catch {
      /* a row that isn't JSON: left out */
    }
  }
  return out;
}
