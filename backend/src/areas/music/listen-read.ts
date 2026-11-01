// What the mind reads about one song (GET /v1/music/analysis/:id, `th music analysis|like`): its
// numbers as the Worker stored them, its Camelot place, its three strongest moods, and its nearest
// songs from the last neighbours job with their titles and how close each is (cosine on the int8
// embeddings, 0–1 rounded to 3 places). No I/O here.
import {
  ANALYZER,
  camelotOf,
  type KeyName,
  LISTEN_LIMITS as L,
  MOODS,
  type Mood,
  type TrackAnalysis,
} from '../../../../shared/contract/listen.ts';
import { cosine, embOf } from './listen-check';
import type { Neighbours } from './listen-pack';
import type { AnalysisRow } from './listen-store';

const round = (x: number, places = 3) => Math.round(x * 10 ** places) / 10 ** places;

/** A track's title and artist from its record (the catalog's own fields; the file name else). */
export function titleOf(recordJson: string): { title: string; artist: string } {
  try {
    const t = JSON.parse(recordJson) as { path?: string; metadata?: Record<string, unknown> };
    const m = t.metadata ?? {};
    const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
    const file =
      (t.path ?? '')
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? '';
    return { title: (s('title') || file).slice(0, 200), artist: s('artist').slice(0, 200) };
  } catch {
    return { title: '', artist: '' };
  }
}

export function stateOf(nativeOpus: boolean, a: AnalysisRow | null): TrackAnalysis['state'] {
  if (a?.result_json) return 'done';
  if (!nativeOpus) return 'unsupported';
  if (a?.failed && a.analyzer === ANALYZER.version && a.attempts >= L.failures_max) return 'failed';
  return 'due';
}

export function analysisView(a: AnalysisRow | null): TrackAnalysis['analysis'] {
  if (!a?.result_json) return null;
  const r = JSON.parse(a.result_json) as Record<string, unknown>;
  const n = (k: string) => r[k] as number;
  const opt = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : null);
  const moods = (r.moods as Record<Mood, number> | null) ?? null;
  const top = moods ? [...MOODS].sort((x, y) => moods[y] - moods[x] || MOODS.indexOf(x) - MOODS.indexOf(y)) : [];
  return {
    analyzer: (r.analyzer as { version: string }).version,
    duration_ms: n('duration_ms'),
    lufs_i: n('lufs_i'),
    true_peak_db: n('true_peak_db'),
    lra: n('lra'),
    bpm: opt('bpm'),
    bpm_conf: n('bpm_conf'),
    key: (r.key as KeyName | null) ?? null,
    key_conf: n('key_conf'),
    camelot: camelotOf(r.key as string | null),
    start_silence_ms: n('start_silence_ms'),
    end_silence_ms: n('end_silence_ms'),
    energy: n('energy'),
    valence: opt('valence'),
    arousal: opt('arousal'),
    vocals: opt('vocals'),
    moods,
    top_moods: top.slice(0, 3),
  };
}

/** The nearest hashes of `sha`, nearest first (at most `n`). */
export function nearest(nb: Neighbours | null, sha: string, n: number): string[] {
  if (!nb || n <= 0) return [];
  const row = nb.at.get(sha);
  if (row === undefined) return [];
  const out: string[] = [];
  for (let q = 0; q < nb.k && out.length < n; q++) {
    const x = nb.nbr[row * nb.k + q];
    if (x !== 0xffff && x < nb.n) out.push(nb.order[x]);
  }
  return out;
}

/** A track's row of `track_analysis` from its stored result and its nearest hashes: each near hash
 * as its first track (catalog order), never the track itself, nearest first. */
export function trackRow(
  t: { id: string; result_json: string },
  near: string[],
  first: Map<string, string>,
): { track_id: string; energy: number; moods_json: string | null; neighbours_json: string } {
  const r = JSON.parse(t.result_json) as { energy: number; moods: Record<string, number> | null };
  const ids = [...new Set(near.map((s) => first.get(s)).filter((x): x is string => !!x && x !== t.id))];
  return {
    track_id: t.id,
    energy: r.energy,
    moods_json: r.moods ? JSON.stringify(Object.fromEntries(MOODS.map((m) => [m, r.moods?.[m]]))) : null,
    neighbours_json: JSON.stringify(ids),
  };
}

/** The like list: each near hash's first track (catalog order), with how close it is. */
export function likeList(
  self: Uint8Array | null,
  near: string[],
  tracks: { id: string; sha256: string; record_json: string }[],
  packs: { sha256: string; pack: ArrayBuffer }[],
): TrackAnalysis['like'] {
  const first = new Map<string, { id: string; record_json: string }>();
  for (const t of tracks) if (!first.has(t.sha256)) first.set(t.sha256, t);
  const emb = new Map(packs.map((p) => [p.sha256, embOf(new Uint8Array(p.pack))]));
  const own = self ? embOf(self) : null;
  const out: TrackAnalysis['like'] = [];
  for (const sha of near) {
    const t = first.get(sha);
    if (!t) continue;
    const e = emb.get(sha);
    out.push({ id: t.id, ...titleOf(t.record_json), sim: own && e ? round(Math.max(0, cosine(own, e))) : 0 });
  }
  return out;
}
