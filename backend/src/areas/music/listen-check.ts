// The checks on what an Actions run sends back (JOBS.md §3.5), with no I/O: the manifest against its
// schema and the spec (checks 1–3, 6), each result against schema v2 and its key (checks 4–5), and
// the neighbours file's shape. Results are untrusted, so a valid one is re-written from its known
// fields only before it is stored, and packed into the 56 bytes the phone file and the neighbours
// step read: bpm×10 (uint16), Camelot (1A=1 … 12B=24, 0 none), energy, valence, arousal, vocals
// (0–250, 255 none), flags (1 moods, 2 embedding), the 16 moods (0–250), the 32-d embedding as int8
// scaled by its own largest value (cosine keeps to within about 0.005).
import {
  ANALYSIS_MANIFEST_SCHEMA,
  ANALYSIS_SCHEMA,
  camelotOf,
  LISTEN_LIMITS as L,
  type ListenKind,
  MOODS,
  NEIGHBOURS_MANIFEST_SCHEMA,
} from '../../../../shared/contract/listen.ts';
import type { Schema } from '../../../../shared/contract/work.ts';
import { check } from '../work/validate';

export const PACK_BYTES = 56;
const NONE = 255;
const FIELDS = Object.keys(ANALYSIS_SCHEMA.properties as Record<string, Schema>);

export interface ManifestFile {
  sha256: string;
  bytes: number;
  result_sha256: string;
}
export type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export interface AnalysisManifest {
  files: ManifestFile[];
  failed: { sha256: string; reason: string }[];
  missing: number;
}
export interface NeighboursManifest {
  n: number;
  k: number;
  bytes: number;
  sha256: string;
}

/** Checks 1–3 and 6: the manifest's schema, its job, and its hashes against the spec. */
export function checkManifest(
  kind: ListenKind,
  jobId: string,
  m: unknown,
  spec: { shas?: string[]; n?: number },
): Checked<AnalysisManifest | NeighboursManifest> {
  const schema = kind === 'audio.analysis' ? ANALYSIS_MANIFEST_SCHEMA : NEIGHBOURS_MANIFEST_SCHEMA;
  const problems = check(m, schema);
  if (problems.length) return { ok: false, problems };
  const o = m as Record<string, unknown>;
  if (o.job_id !== jobId) return { ok: false, problems: ['job_id: not this job'] };
  if (kind === 'audio.neighbours') {
    const n = o as unknown as NeighboursManifest;
    if (n.n !== spec.n) return { ok: false, problems: ['n: not the spec'] };
    if (n.k !== L.k) return { ok: false, problems: [`k: must be ${L.k}`] };
    if (n.bytes !== n.n * n.k * 2) return { ok: false, problems: ['bytes: must be n × k × 2'] };
    return { ok: true, value: { n: n.n, k: n.k, bytes: n.bytes, sha256: n.sha256 } };
  }
  const a = o as unknown as Omit<AnalysisManifest, 'missing'>;
  const want = new Set(spec.shas ?? []);
  const seen = new Set<string>();
  for (const [i, x] of [...a.files, ...a.failed].entries()) {
    const at = i < a.files.length ? `files[${i}]` : `failed[${i - a.files.length}]`;
    if (!want.has(x.sha256)) return { ok: false, problems: [`${at}.sha256: not in the spec`] };
    if (seen.has(x.sha256)) return { ok: false, problems: [`${at}.sha256: listed twice`] };
    seen.add(x.sha256);
  }
  return { ok: true, value: { files: a.files, failed: a.failed, missing: want.size - seen.size } };
}

/** The part file (1-based) holding `files[i]`, and its name. */
export const partOf = (i: number) => Math.floor(i / L.part_results) + 1;
export const partName = (p: number) => `part-${String(p).padStart(3, '0')}.jsonl`;
export const partsFor = (files: number) => Math.ceil(files / L.part_results);

/** A part's lines as exact bytes (a last newline is allowed; an empty line is a line). */
export function lines(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++)
    if (bytes[i] === 0x0a) {
      out.push(bytes.subarray(start, i));
      start = i + 1;
    }
  if (start < bytes.length) out.push(bytes.subarray(start));
  return out;
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (b: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', b));
const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export type ResultCheck =
  | {
      ok: true;
      result_json: string;
      pack: Uint8Array;
      analyzer: string;
      v: number;
      energy: number;
      moods_json: string | null;
    }
  | { ok: false; reason: 'size' | 'hash' | 'json' | 'schema' | 'key' };

/** Checks 4–5 on one line: its size and hash against the manifest, then schema v2 and its key. */
export async function checkResult(line: Uint8Array, f: ManifestFile): Promise<ResultCheck> {
  if (line.length !== f.bytes || line.length > L.result_bytes) return { ok: false, reason: 'size' };
  if ((await sha256Hex(line)) !== f.result_sha256) return { ok: false, reason: 'hash' };
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(text.decode(line));
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (check(r, ANALYSIS_SCHEMA).length) return { ok: false, reason: 'schema' };
  if ((r.start_silence_ms as number) + (r.end_silence_ms as number) > (r.duration_ms as number))
    return { ok: false, reason: 'schema' };
  if (r.sha256 !== f.sha256) return { ok: false, reason: 'key' };
  // Known fields only, in the schema's order.
  const clean = Object.fromEntries(FIELDS.map((k) => [k, r[k]]));
  return {
    ok: true,
    result_json: JSON.stringify(clean),
    pack: packOf(clean),
    analyzer: (r.analyzer as { version: string }).version,
    v: r.v as number,
    energy: r.energy as number,
    // In MUSIC_MOODS' order, for the per-track view (track_analysis).
    moods_json: r.moods
      ? JSON.stringify(Object.fromEntries(MOODS.map((m) => [m, (r.moods as Record<string, number>)[m]])))
      : null,
  };
}

const unit8 = (x: unknown) => (typeof x === 'number' ? Math.round(Math.min(1, Math.max(0, x)) * 250) : NONE);

/** The 56 bytes of a checked result. */
export function packOf(r: Record<string, unknown>): Uint8Array {
  const b = new Uint8Array(PACK_BYTES);
  const v = new DataView(b.buffer);
  v.setUint16(0, typeof r.bpm === 'number' ? Math.round(r.bpm * 10) : 0, true);
  const cam = camelotOf(r.key as string | null);
  b[2] = cam ? Number.parseInt(cam, 10) * 2 - (cam.endsWith('A') ? 1 : 0) : 0;
  b[3] = unit8(r.energy);
  b[4] = unit8(r.valence);
  b[5] = unit8(r.arousal);
  b[6] = unit8(r.vocals);
  const moods = r.moods as Record<string, number> | null;
  const emb = r.emb as number[] | null;
  b[7] = (moods ? 1 : 0) | (emb ? 2 : 0);
  for (const [i, m] of MOODS.entries()) b[8 + i] = moods ? unit8(moods[m]) : NONE;
  if (emb) {
    const top = Math.max(...emb.map(Math.abs)) || 1;
    for (const [i, x] of emb.entries()) v.setInt8(24 + i, Math.round((x / top) * 127));
  }
  return b;
}

/** The embedding bytes of a pack (32 int8), or null when it has none. */
export const embOf = (pack: Uint8Array): Uint8Array | null => (pack[7] & 2 ? pack.subarray(24, 56) : null);

/** Cosine of two int8 embeddings. */
export function cosine(a: Uint8Array, b: Uint8Array): number {
  const x = new Int8Array(a.buffer, a.byteOffset, a.length);
  const y = new Int8Array(b.buffer, b.byteOffset, b.length);
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  return nx && ny ? dot / Math.sqrt(nx * ny) : 0;
}

/** The neighbours file: exactly n × k uint16; each row's songs other than its own, no repeats, and
 * 0xFFFF only after them, only when fewer than k other songs exist. */
export function checkNeighbours(bytes: Uint8Array, n: number, k: number): string | null {
  if (bytes.length !== n * k * 2) return 'size';
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const real = Math.min(k, n - 1);
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    seen.clear();
    for (let j = 0; j < k; j++) {
      const x = v.getUint16((i * k + j) * 2, true);
      if (j >= real) {
        if (x !== 0xffff) return 'padding';
        continue;
      }
      if (x >= n || x === i || seen.has(x)) return 'index';
      seen.add(x);
    }
  }
  return null;
}
