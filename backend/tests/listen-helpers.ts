// Helpers for the listening pass's suites (JOBS.md §3): a synthetic catalog in the Music object,
// synthetic results of schema v2 (clustered embeddings, so neighbours mean something), part files
// and manifests as the Actions run makes them, and Core's alarm run until its jobs are done.
// Everything is synthetic: no real audio, titles or hashes of anyone's songs.
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { ANALYZER, KEYS, LISTEN_LIMITS as L, MOODS } from '../../shared/contract/listen.ts';
import type { Core } from '../src/objects/core';
import { musicObject } from '../src/objects/music';
import { core, coreSql } from './helpers';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
export const sha = async (b: Uint8Array | string) =>
  hex(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? enc.encode(b) : b));

export const music = () => musicObject(env);

/** `n` native Opus tracks (ids `r2_native_<sha>`), plus `extra` tracks the pass can't take (old keys). */
export async function seedTracks(n: number, from = 0, extra = 0): Promise<string[]> {
  const shas: string[] = [];
  const rows = [];
  for (let i = from; i < from + n + extra; i++) {
    const s = await sha(`synthetic song ${i}`);
    const native = i < from + n;
    if (native) shas.push(s);
    const id = native ? `r2_native_${s}` : `r2_oldsong${String(i).padStart(8, '0')}`;
    const audio_key = native ? `native/audio/${s}.opus` : `audio/oldsong${String(i).padStart(8, '0')}/${s}.mp3`;
    const record = { id, sha256: s, audioKey: audio_key, metadata: { title: `Song ${i}`, artist: `Band ${i % 7}` } };
    rows.push({
      ord: i + 1,
      id,
      sha256: s,
      size: 1000 + i,
      audio_key,
      cover_key: null,
      record_json: JSON.stringify(record),
      waveform: null,
      updated_at: Date.now(),
    });
  }
  await music().importTracks(rows, Date.now());
  return shas;
}

/** A seeded unit vector near one of four directions: songs in a cluster are each other's neighbours. */
function embedding(i: number): number[] {
  let a = i * 2654435761;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  const v = Array.from({ length: L.dim }, (_, d) => (d % 4 === i % 4 ? 1 : 0) + 0.3 * rand());
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => Math.round((x / norm) * 1e4) / 1e4);
}

export function result(s: string, i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    sha256: s,
    analyzer: { ...ANALYZER },
    duration_ms: 180_000 + i,
    sample_rate: 48000,
    channels: 2,
    lufs_i: -14.2,
    true_peak_db: -1.1,
    lra: 6.5,
    bpm: 90 + (i % 60),
    bpm_conf: 0.8,
    key: KEYS[i % 24],
    key_conf: 0.6,
    start_silence_ms: 120,
    end_silence_ms: 900,
    energy: (i % 10) / 10,
    valence: 0.5,
    arousal: 0.4,
    vocals: 0.3,
    moods: Object.fromEntries(MOODS.map((m, j) => [m, ((i + j) % 10) / 10])),
    emb: embedding(i),
    emb_v: 1,
    ...over,
  };
}

export interface Upload {
  parts: Uint8Array[];
  files: { sha256: string; bytes: number; result_sha256: string }[];
}

/** Part files and manifest entries for these results, 50 a part, as the job writes them. `lie` maps
 * an index to a manifest entry that differs from the bytes (bytes or hash). */
export async function pack(
  results: Record<string, unknown>[],
  lie: Record<number, { sha256?: string; bytes?: number; result_sha256?: string }> = {},
): Promise<Upload> {
  const lines = results.map((r) => enc.encode(JSON.stringify(r)));
  const files = [];
  for (const [i, l] of lines.entries())
    files.push({ sha256: results[i].sha256 as string, bytes: l.length, result_sha256: await sha(l), ...lie[i] });
  const parts: Uint8Array[] = [];
  for (let p = 0; p < lines.length; p += L.part_results) {
    const chunk = lines.slice(p, p + L.part_results);
    const out = new Uint8Array(chunk.reduce((n, l) => n + l.length + 1, 0));
    let at = 0;
    for (const l of chunk) {
      out.set(l, at);
      out[at + l.length] = 0x0a;
      at += l.length + 1;
    }
    parts.push(out);
  }
  return { parts, files };
}

export function manifest(jobId: string, files: Upload['files'], failed: { sha256: string; reason: string }[] = []) {
  return {
    v: 1,
    job_id: jobId,
    kind: 'audio.analysis',
    analyzer: { ...ANALYZER },
    started_at: Date.now() - 60_000,
    finished_at: Date.now(),
    files,
    failed,
  };
}

/** One upload through the Worker's real fetch handler, as the Actions run sends it. */
export function put(token: string, jobId: string, name: string, bytes: Uint8Array | string, length?: number) {
  const body = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'CF-Connecting-IP': '192.0.2.60',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(length ?? body.length),
  });
  const url = `https://api.example.test/v1/jobs/${jobId}/files/${name}`;
  return exports.default.fetch(new Request(url, { method: 'PUT', headers, body }));
}

/** Core's alarm until no job is due (at most `max` alarms). */
export async function drain(max = 60): Promise<number> {
  let n = 0;
  for (; n < max; n++) {
    const due = await coreSql<{ n: number }>(
      "SELECT count(*) AS n FROM jobs WHERE state IN ('queued', 'running', 'paused') AND due_at <= ?",
      Date.now(),
    );
    if (!due[0].n) break;
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
  }
  return n;
}

export function musicSql<T = Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): Promise<T[]> {
  return runInDurableObject(music(), (_o, state) => state.storage.sql.exec(query, ...bindings).toArray() as T[]);
}
