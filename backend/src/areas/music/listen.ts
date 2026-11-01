// The listening pass in the Music object (JOBS.md §3.3–3.5): issuing specs, the state of each job,
// the manifest's checks on collect, and applying checked results. A job moves issued → validating →
// applied, or → rejected (a bad manifest, nothing applied) or → expired (not collected in 72 h; its
// songs are due again). At most two jobs of a kind are open at once. Songs are offered oldest first
// in catalog order, one per audio hash; a song the job reports failed three times in a row at this
// analyzer version is left out until the version changes. Counts only, never a hash, leave here in
// a status.
import {
  ANALYZER,
  type FailReason,
  type JobCounts,
  type JobIssued,
  type JobStatus,
  LISTEN_LIMITS as L,
  LISTEN_V,
  type ListenKind,
} from '../../../../shared/contract/listen.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';
import { type AnalysisManifest, checkManifest, embOf, type NeighboursManifest } from './listen-check';
import { neighboursSpec } from './listen-pack';
import * as store from './listen-store';
import * as tracks from './listen-store-tracks';

export interface Spec {
  shas?: string[];
  n?: number;
  epoch?: number;
}
/** What Core's apply job carries (areas/music/listen-jobs.ts). */
export type ApplyPayload =
  | {
      job_id: string;
      kind: 'audio.analysis';
      files: [sha: string, bytes: number, result_sha256: string][];
      failed: [sha: string, reason: FailReason][];
    }
  | { job_id: string; kind: 'audio.neighbours'; n: number; k: number; sha256: string };

/** The counts as kept: also the parts already applied (never shown). */
type Counted = JobCounts & { parts?: number[] };
const specOfRow = (r: store.JobRow) => JSON.parse(r.spec_json) as Spec;
const countsOf = (r: store.JobRow) => (r.counts_json ? (JSON.parse(r.counts_json) as Counted) : null);

export function status(r: store.JobRow): JobStatus {
  const s = specOfRow(r);
  const kept = countsOf(r);
  const { parts: _, ...counts } = kept ?? ({} as Counted);
  return {
    job_id: r.id,
    kind: r.kind as ListenKind,
    v: r.v,
    state: r.state as JobStatus['state'],
    issued_at: r.issued_at,
    expires_at: r.expires_at,
    collected_at: r.collected_at,
    count: s.shas?.length ?? s.n ?? 0,
    counts: kept ? counts : null,
  };
}

/** Refuses a third open job of a kind, and a fourth in 24 hours; prunes finished jobs past 90 days. */
function admit(db: Db, kind: ListenKind, now: number): void {
  store.pruneJobs(db, now - L.keep_ms, 20);
  if (store.jobs(db, kind, true, L.open_jobs).length >= L.open_jobs)
    throw new Fail('conflict', { reason: 'open_jobs' });
  if (store.issuedSince(db, kind, now - DAY) >= L.jobs_per_day)
    throw new Fail('rate_limited', { reason: 'daily_jobs' });
}

/** Hashes in open analysis specs: not offered twice. */
function inFlight(db: Db): Set<string> {
  return new Set(store.jobs(db, 'audio.analysis', true, L.open_jobs).flatMap((r) => specOfRow(r).shas ?? []));
}

export function issueAnalysis(db: Db, max: number, now: number): JobIssued | null {
  admit(db, 'audio.analysis', now);
  const busy = inFlight(db);
  const shas = store
    .due(db, ANALYZER.version, L.failures_max, max + busy.size)
    .filter((s) => !busy.has(s))
    .slice(0, max);
  if (!shas.length) return null;
  const id = uuidv7(now);
  const expires_at = now + L.spec_ttl_ms;
  store.insertJob(db, {
    id,
    kind: 'audio.analysis',
    v: LISTEN_V['audio.analysis'],
    spec_json: JSON.stringify({ shas }),
    state: 'issued',
    issued_at: now,
    expires_at,
  });
  return { job_id: id, kind: 'audio.analysis', v: 2, shas, expires_at };
}

/** A neighbours job, once nothing waits for analysis and results changed since the last one. Its
 * hashes and embeddings go to the bucket (the caller writes them); the row says how many. */
export function issueNeighbours(
  db: Db,
  now: number,
): { job_id: string; n: number; order: Uint8Array; emb: Uint8Array; expires_at: number } | null {
  admit(db, 'audio.neighbours', now);
  if (store.jobs(db, 'audio.neighbours', true, 1).length || store.jobs(db, 'audio.analysis', true, 1).length)
    return null;
  // Two rows first: nothing changed since the last neighbours, so no scan of the catalog.
  const epoch = store.getState<number>(db, 'listen.epoch') ?? 0;
  if (store.getState<{ epoch: number }>(db, 'listen.neighbours')?.epoch === epoch) return null;
  if (store.due(db, ANALYZER.version, L.failures_max, 1).length) return null;
  const rows = store
    .embeddings(db)
    .map((r) => ({ sha256: r.sha256, pack: new Uint8Array(r.pack) }))
    .filter((r) => embOf(r.pack));
  if (rows.length < 2 || rows.length > L.neighbours_max) return null;
  const id = uuidv7(now);
  const expires_at = now + L.spec_ttl_ms;
  store.insertJob(db, {
    id,
    kind: 'audio.neighbours',
    v: LISTEN_V['audio.neighbours'],
    spec_json: JSON.stringify({ n: rows.length, epoch }),
    state: 'issued',
    issued_at: now,
    expires_at,
  });
  return { job_id: id, n: rows.length, ...neighboursSpec(rows), expires_at };
}

/** An issued, unexpired job, or the error its state calls for. */
function issued(db: Db, id: string, now: number): store.JobRow {
  const r = store.job(db, id);
  if (!r) throw new Fail('not_found');
  if (r.state === 'expired' || (r.state === 'issued' && r.expires_at <= now)) throw new Fail('expired');
  if (r.state !== 'issued') throw new Fail('conflict', { reason: r.state });
  return r;
}

export function specOf(db: Db, id: string, now: number): { kind: ListenKind; spec: Spec } {
  const r = issued(db, id, now);
  return { kind: r.kind as ListenKind, spec: specOfRow(r) };
}

export const uploadable = specOf;

export type Collected =
  | { state: 'validating'; payload: ApplyPayload }
  | { state: 'applied' | 'rejected' | 'validating'; payload?: undefined };

/** Checks 1–3 and 6 (JOBS.md §3.5). A bad manifest rejects the job and applies nothing. A job
 * already being applied gives its payload again, so a collect repeated after a failed apply job
 * starts it again (applying is idempotent). */
export function collect(db: Db, id: string, manifest: unknown, now: number): Collected {
  const r = store.job(db, id);
  if (!r) throw new Fail('not_found');
  if (r.state === 'applied') return { state: 'applied' };
  if (r.state === 'rejected') return { state: 'rejected' };
  if (r.state === 'expired' || (r.state === 'issued' && r.expires_at <= now)) throw new Fail('expired');
  const kind = r.kind as ListenKind;
  const spec = specOfRow(r);
  const expected = spec.shas?.length ?? spec.n ?? 0;
  const checked = checkManifest(kind, id, manifest, spec);
  if (!checked.ok) {
    if (r.state === 'validating') return { state: 'validating' };
    const counts: JobCounts = {
      expected,
      valid: 0,
      invalid: 0,
      failed: 0,
      missing: expected,
      reasons: { manifest: 1 },
    };
    store.setJob(db, id, { state: 'rejected', collected_at: now, counts });
    return { state: 'rejected' };
  }
  let payload: ApplyPayload;
  let counts: JobCounts;
  if (kind === 'audio.analysis') {
    const m = checked.value as AnalysisManifest;
    payload = {
      job_id: id,
      kind,
      files: m.files.map((f) => [f.sha256, f.bytes, f.result_sha256]),
      failed: m.failed.map((f) => [f.sha256, f.reason as FailReason]),
    };
    counts = { expected, valid: 0, invalid: 0, failed: m.failed.length, missing: m.missing };
  } else {
    const m = checked.value as NeighboursManifest;
    payload = { job_id: id, kind, n: m.n, k: m.k, sha256: m.sha256 };
    counts = { expected, valid: 0, invalid: 0, failed: 0, missing: 0 };
  }
  if (r.state === 'issued') store.setJob(db, id, { state: 'validating', collected_at: now, counts });
  return { state: 'validating', payload };
}

const merge = (a: Record<string, number> = {}, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};

/** One part's checked results (and how many were refused, by reason); rows written. A part already
 * taken is skipped, so a step repeated after a crash counts nothing twice. */
export function apply(
  db: Db,
  id: string,
  part: number,
  rows: store.ResultRow[],
  invalid: Record<string, number>,
  now: number,
): number {
  const r = store.job(db, id);
  if (r?.state !== 'validating') return 0;
  const c = countsOf(r) as Counted;
  if (c.parts?.includes(part)) return 0;
  let written = 0;
  for (const x of rows)
    written += store.putResult(db, x, id, now) + tracks.putTrackAnalysis(db, x.sha256, x.energy, x.moods_json);
  const bad = Object.values(invalid).reduce((n, x) => n + x, 0);
  const parts = [...(c.parts ?? []), part];
  const counts: Counted = { ...c, valid: c.valid + rows.length, invalid: c.invalid + bad, parts };
  if (bad) counts.reasons = merge(c.reasons, invalid);
  return written + store.setJob(db, id, { state: 'validating', counts });
}

/** The job's own failures, then `applied`; new results move the epoch the neighbours step watches. */
export function finish(
  db: Db,
  id: string,
  failed: [string, string][],
  now: number,
): { written: number; valid: number } {
  const r = store.job(db, id);
  if (r?.state !== 'validating') return { written: 0, valid: 0 };
  let written = 0;
  for (const [sha, reason] of failed) written += store.putFailure(db, sha, ANALYZER.version, reason, id, now);
  const c = countsOf(r) as JobCounts;
  if (c.valid > 0) written += store.putState(db, 'listen.epoch', (store.getState<number>(db, 'listen.epoch') ?? 0) + 1);
  written += store.setJob(db, id, { state: 'applied' });
  return { written, valid: c.valid };
}

/** A job whose apply failed for good (Core's job tried six times): rejected, the reason counted. */
export function reject(db: Db, id: string): number {
  const r = store.job(db, id);
  if (r?.state !== 'validating') return 0;
  const c = countsOf(r) as Counted;
  const counts: Counted = { ...c, reasons: merge(c.reasons, { apply_failed: 1 }) };
  return store.setJob(db, id, { state: 'rejected', counts });
}

/** A neighbours job's end: its file stored (ok) or refused (why). */
export function neighboursDone(db: Db, id: string, problem: string | null, now: number): number {
  const r = store.job(db, id);
  if (r?.state !== 'validating') return 0;
  const s = specOfRow(r);
  const n = s.n ?? 0;
  if (problem) {
    const counts: JobCounts = { expected: n, valid: 0, invalid: 1, failed: 0, missing: 0, reasons: { [problem]: 1 } };
    return store.setJob(db, id, { state: 'rejected', counts });
  }
  const counts: JobCounts = { expected: n, valid: n, invalid: 0, failed: 0, missing: 0 };
  return (
    store.putState(db, 'listen.neighbours', { job_id: id, epoch: s.epoch ?? 0, n, k: L.k, at: now }) +
    store.setJob(db, id, { state: 'applied', counts })
  );
}
