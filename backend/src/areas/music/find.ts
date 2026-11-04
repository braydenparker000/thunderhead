// Songs by feeling (GET /v1/music/find, MUSIC.md §10.5): a pure ranking over the mind's notes (with
// the tags likeness weighs) and, where the listening pass (Music schema step 3) has measured a song,
// its audio, as the Music object keeps them packed (music-mind.ts). Songs with neither a note nor a
// measurement aren't ranked; the caller reads the winners' tags by key.
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
// when energy is all that is asked, or some likeness. Songs the owner told the mind never to play
// again (a rule fact), songs whose newest rating is 1 (the phone's "not for me", which "never play
// this again" said to the phone sets), and songs skipped early three times in 30 days (MUSIC.md
// §4.2) are left out and counted.
import {
  MUSIC_NOTE_LIMITS as L,
  MUSIC_MOODS,
  MUSIC_OCCASIONS,
  type MusicFindItem,
  type MusicFindResponse,
  type MusicMood,
  type MusicOccasion,
} from '../../../../shared/contract/music.ts';
import type { Issue } from './notes';
import { SONG_ID } from './shapes';

export interface FindQuery {
  moods: MusicMood[];
  occasion: MusicOccasion | null;
  energy: number | null;
  like: string | null;
  /** Weigh songs by the owner's plays of their artist (`--like-history`). */
  history: boolean;
  limit: number;
}

const ENERGY: Record<string, number> = { low: 0.2, mid: 0.5, high: 0.8 };
const W = { mood: 1, occasion: 0.8, energy: 0.5, like: 1, history: 0.6, skip: 0.25 };
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
  const history = q.history === '1';
  if (!moods.length && !occasion && energy === null && !like && !history)
    issues.push({ path: 'moods', issue: 'ask for moods, an occasion, an energy, like or history' });
  return issues.length
    ? { issues }
    : { moods: moods as MusicMood[], occasion: occasion as MusicOccasion, energy, like, history, limit };
}

/** A song as find reads it from the packs (`find_packs`, music-mind.ts): its note's words and the
 * tags likeness weighs (`k` known, `m` moods, `o` occasions, `e` energy, `r` era, `l` language,
 * `a` artist, `c` composer, `g` genre, `y` year, `n` its place in the catalog). */
export interface NoteEntry {
  k: 0 | 1;
  m: Partial<Record<MusicMood, number>>;
  o: Partial<Record<MusicOccasion, number>>;
  e: number | null;
  r: number | null;
  l: string | null;
  a: string;
  c: string;
  g: string;
  y: number;
  n: number;
}
/** What the listening pass measured of a song, packed: `e` energy, `m` mood scores. */
export interface AudioEntry {
  e: number | null;
  m: Partial<Record<MusicMood, number>>;
}

export interface Known {
  notes: Map<string, NoteEntry>;
  /** Null until the listening pass's table exists. */
  audio: Map<string, AudioEntry> | null;
  /** `like`: the song, its entry (or one from its tags alone), and its neighbours when the
   * listening pass measured it. */
  seed: { id: string; entry: NoteEntry; neighbours: { id: string; score: number }[] } | null;
  /** `history`: each song's weight from the owner's plays of its artist, 0–1 (music-taste.ts). */
  history?: Map<string, number>;
}

/** One ranked song, before its tags are read. */
export interface Ranked {
  id: string;
  score: number;
  known: boolean | null;
  why: MusicFindItem['why'];
}

/** A song's moods: the note's and the audio's averaged where both score one. */
function moodsOf(n: NoteEntry | undefined, a: AudioEntry | undefined): Partial<Record<MusicMood, number>> {
  if (!a) return n?.m ?? {};
  if (!n) return a.m;
  const out: Partial<Record<MusicMood, number>> = {};
  for (const m of MUSIC_MOODS) {
    const x = n.m[m];
    const y = a.m[m];
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
function tagCloseness(a: NoteEntry, b: NoteEntry): number {
  let s = 0;
  if (a.c && a.c === b.c) s += 0.6;
  if (a.a && a.a === b.a) s += 0.4;
  const g = new Set(words(a.g));
  s += Math.min(0.5, words(b.g).filter((w) => g.has(w)).length * 0.25);
  const dy = a.y && b.y ? Math.abs(a.y - b.y) : 99;
  s += dy <= 2 ? 0.2 : dy <= 5 ? 0.1 : 0;
  return Math.min(1, s);
}

/** How alike a song is to the seed, 0 and up, from the notes, tags and audio. */
function likeness(k: Known, seed: NoteEntry, seedId: string, id: string): number {
  const nx = k.notes.get(id);
  const as = k.audio?.get(seedId);
  const ax = k.audio?.get(id);
  const seedNoted = k.notes.has(seedId);
  let s = nx ? 0.5 * tagCloseness(seed, nx) : 0;
  s += cosine(moodsOf(seedNoted ? seed : undefined, as), moodsOf(nx, ax), MUSIC_MOODS);
  if (seedNoted && nx) {
    s += 0.5 * cosine(seed.o, nx.o, MUSIC_OCCASIONS);
    if (seed.l && seed.l === nx.l) s += 0.1;
    if (seed.r && seed.r === nx.r) s += 0.1;
  }
  const es = as?.e ?? (seedNoted ? seed.e : null);
  const ex = ax?.e ?? nx?.e ?? null;
  if (es !== null && ex !== null) s += 0.2 * (1 - Math.abs(es - ex));
  return s;
}

/** The ranking over every song with a note or a measurement. `skips`: early skips by track id;
 * `never`: ids the owner's rules rule out; `rated`: ids whose newest rating is 1. The top `take`
 * come back (the caller reads their tags), with how many matched. */
export function rank(
  k: Known,
  q: FindQuery,
  skips: Map<string, number>,
  never: Set<string>,
  rated: Set<string>,
  take: number,
): { items: Ranked[]; total: number; left_out: MusicFindResponse['left_out'] } {
  const near = k.seed?.neighbours.length ? new Map(k.seed.neighbours.map((n) => [n.id, n.score])) : null;
  const left_out = { never: 0, rated: 0, skipped: 0 };
  const scored: { item: Ranked; raw: number; ord: number }[] = [];
  const hist = q.history ? (k.history ?? new Map<string, number>()) : null;
  const ids = new Set([
    ...k.notes.keys(),
    ...(k.audio?.keys() ?? []),
    ...(near?.keys() ?? []),
    ...(hist?.keys() ?? []),
  ]);
  for (const id of ids) {
    // Like a song the listening pass measured: its neighbours are the candidates.
    if ((k.seed && id === k.seed.id) || (near && !near.has(id))) continue;
    const n = k.notes.get(id);
    const a = k.audio?.get(id);
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
      const fit = n?.o[q.occasion] ?? 0;
      if (fit) why.occasion = fit;
      score += W.occasion * fit;
      feel += fit;
    }
    const energy = a?.e ?? n?.e ?? null;
    if (q.energy !== null && energy !== null) {
      why.energy = r2(energy);
      score += W.energy * (1 - Math.abs(energy - q.energy));
    }
    if (k.seed) {
      const like = near ? (near.get(id) ?? 0) : likeness(k, k.seed.entry, k.seed.id, id);
      if (like > 0) why.like = r2(like);
      score += W.like * like;
    }
    const h = hist?.get(id) ?? 0;
    if (h) why.history = h;
    score += W.history * h;
    const asked = q.moods.length || q.occasion;
    const shows = asked ? feel > 0.15 : k.seed ? (why.like ?? 0) > 0 : q.energy !== null ? energy !== null : h > 0;
    if (!shows) continue;
    if (never.has(id)) {
      left_out.never++;
      continue;
    }
    if (rated.has(id)) {
      left_out.rated++;
      continue;
    }
    const s = skips.get(id) ?? 0;
    if (s >= L.skip_exclude) {
      left_out.skipped++;
      continue;
    }
    if (s) {
      why.skips = s;
      score -= W.skip * s;
    }
    scored.push({
      item: { id, score: r2(score), known: n ? n.k === 1 : null, why },
      raw: score,
      ord: n?.n ?? Infinity,
    });
  }
  scored.sort((x, y) => y.raw - x.raw || x.ord - y.ord || (x.item.id < y.item.id ? -1 : 1));
  return { items: scored.slice(0, take).map((s) => s.item), total: scored.length, left_out };
}

/** The listening pass's rows as find reads them; a row it can't read is left out. */
export function listeningMap(
  rows: { track_id: string; energy: number | null; moods_json: string | null; neighbours_json: string | null }[],
): Map<string, AudioEntry & { neighbours: { id: string; score: number }[] }> {
  const out = new Map<string, AudioEntry & { neighbours: { id: string; score: number }[] }>();
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
  for (const r of rows) {
    try {
      const m: Partial<Record<MusicMood, number>> = {};
      const raw = r.moods_json ? (JSON.parse(r.moods_json) as Record<string, unknown>) : {};
      for (const k of MUSIC_MOODS) {
        const v = num(raw[k]);
        if (v) m[k] = v;
      }
      const nb = r.neighbours_json ? (JSON.parse(r.neighbours_json) as unknown[]) : [];
      const neighbours = nb.flatMap((x, i) => {
        const o = (typeof x === 'string' ? { id: x } : x) as { id?: unknown; score?: unknown };
        return typeof o?.id === 'string' ? [{ id: o.id, score: num(o.score) ?? 1 - i / Math.max(1, nb.length) }] : [];
      });
      out.set(r.track_id, { e: num(r.energy), m, neighbours });
    } catch {
      /* a row that isn't JSON: left out */
    }
  }
  return out;
}
