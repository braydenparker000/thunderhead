// Core's two chunked jobs for the listening pass (JOBS.md §3.5, §4.4), run by Core's alarm.
//
// `music.listen.apply` (bulk lane): one part file a step, 50 results at most. Its load reads the part
// from the private bucket, checks each line against the manifest's size and hash and against schema
// v2 and its key (checks 4–5), and hands the valid ones to the Music object, which writes them in
// one transaction and skips a part it already took (a step repeated after a crash writes nothing
// twice). The rows Music wrote count on the bulk lane in the step's commit (the lane pauses the job
// past 40,000 a day, and the quota hold from 80% of the day's budget). A last step records the
// job's own failures, marks it applied, deletes its uploads and queues the phone file. A neighbours
// job's first step checks the file (size, hash, every row) and stores it in place of the last; then
// each track's row of `track_analysis` (energy, moods, neighbour ids) is written 2,000 tracks a
// step, unchanged rows costing nothing, and the phone file is queued. Each step stays well under
// the 50 subrequests an invocation may make (one read, one call to Music; the last a list and a delete).
//
// `music.listen.pack` (reads only; waits like heavy work from 80% of the day's budget): the Music
// object builds the phone file and puts it in the bucket.
import { LISTEN_LIMITS as L } from '../../../../shared/contract/listen.ts';
import { musicObject } from '../../objects/music';
import { JobError, type JobHandler, useLane } from '../jobs/runner';
import { requeueJob } from '../jobs/store';
import type { ApplyPayload } from './listen';
import { checkNeighbours, checkResult, lines, partName, partsFor, sha256Hex } from './listen-check';
import { dropJobFiles, incoming, NEIGHBOURS_FILE, specKey } from './listen-files';
import { NEIGHBOURS_KEY, neighboursFile } from './listen-pack';
import type { ResultRow } from './listen-store';

export const LISTEN_APPLY = 'music.listen.apply';
export const LISTEN_PACK = 'music.listen.pack';
export const LISTEN_REJECT = 'music.listen.reject';
export const applyJobId = (jobId: string) => `listen.apply:${jobId}`;
export const PACK_JOB_ID = 'listen.pack';

type Cursor = { part: number } | { phase: 'finish' } | { phase: 'rows'; after: number };
/** Tracks a neighbours step writes into `track_analysis` at most (DATA.md §8: ≤ 2,000 rows a step). */
const ROWS_PER_STEP = 2_000;
interface Input {
  /** Rows the Music object wrote. */
  written: number;
  next?: Cursor;
  /** The job is over; `pack`: the phone file is out of date. */
  done?: { pack: boolean };
}

const bump = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};

async function part(env: Env, vault: R2Bucket, p: Extract<ApplyPayload, { kind: 'audio.analysis' }>, n: number) {
  const from = (n - 1) * L.part_results;
  const files = p.files.slice(from, from + L.part_results);
  const rows: ResultRow[] = [];
  const invalid: Record<string, number> = {};
  const obj = await vault.get(incoming(p.job_id) + partName(n));
  if (!obj || obj.size > L.part_bytes) {
    await obj?.body.cancel();
    bump(invalid, 'part', files.length);
  } else {
    const got = lines(new Uint8Array(await obj.arrayBuffer()));
    for (const [i, [sha256, bytes, result_sha256]] of files.entries()) {
      const r = got[i] ? await checkResult(got[i], { sha256, bytes, result_sha256 }) : null;
      if (r?.ok) {
        const { ok: _, ...row } = r;
        rows.push({ sha256, ...row });
      } else bump(invalid, r ? r.reason : 'size');
    }
  }
  return musicObject(env).listenApply(p.job_id, n, rows, invalid);
}

async function neighbours(
  env: Env,
  vault: R2Bucket,
  p: Extract<ApplyPayload, { kind: 'audio.neighbours' }>,
): Promise<Input> {
  const [file, order] = await Promise.all([
    vault.get(incoming(p.job_id) + NEIGHBOURS_FILE),
    vault.get(specKey(p.job_id, 'order')),
  ]);
  let problem: string | null = null;
  let bytes = new Uint8Array(0);
  let ord = new Uint8Array(0);
  if (!file || !order || file.size !== p.n * p.k * 2 || order.size !== p.n * 32) {
    problem = !file || !order ? 'missing' : 'size';
    await Promise.all([file?.body.cancel(), order?.body.cancel()]);
  } else {
    bytes = new Uint8Array(await file.arrayBuffer());
    ord = new Uint8Array(await order.arrayBuffer());
    problem = (await sha256Hex(bytes)) !== p.sha256 ? 'hash' : checkNeighbours(bytes, p.n, p.k);
  }
  if (!problem) await vault.put(NEIGHBOURS_KEY, neighboursFile(ord, bytes, p.n, p.k));
  const written = await musicObject(env).listenNeighbours(p.job_id, problem);
  await dropJobFiles(vault, p.job_id);
  // Accepted: each track's row of track_analysis follows, a page a step.
  return problem ? { written, done: { pack: false } } : { written, next: { phase: 'rows', after: 0 } };
}

export const listenApplyJob: JobHandler = {
  kind: LISTEN_APPLY,
  lane: true,
  async load(env, _db, payload, cursor): Promise<Input> {
    const p = payload as ApplyPayload;
    const vault = env.VAULT;
    if (!vault) throw new JobError('not_configured');
    const c0 = cursor as Cursor | null;
    if (c0 && 'phase' in c0 && c0.phase === 'rows') {
      const r = await musicObject(env).listenTrackRows(c0.after, ROWS_PER_STEP);
      return r.last === null
        ? { written: r.written, done: { pack: true } }
        : { written: r.written, next: { phase: 'rows', after: r.last } };
    }
    if (p.kind === 'audio.neighbours') return neighbours(env, vault, p);
    const c = c0 ?? (p.files.length ? { part: 1 } : { phase: 'finish' });
    if ('part' in c) {
      const written = await part(env, vault, p, c.part);
      return { written, next: c.part >= partsFor(p.files.length) ? { phase: 'finish' } : { part: c.part + 1 } };
    }
    const r = await musicObject(env).listenFinish(p.job_id, p.failed);
    await dropJobFiles(vault, p.job_id);
    // The phone file changes only when something was applied.
    return { written: r.written, done: { pack: r.valid > 0 } };
  },
  step(w, _payload, _cursor, input) {
    const i = input as Input;
    // Rows written in the Music object count on the lane here; Music's own meter counts them for the day.
    useLane(w, i.written, w.at);
    if (!i.done) return { next: i.next };
    if (i.done.pack) requeueJob(w.db, { id: PACK_JOB_ID, kind: LISTEN_PACK, payload: {}, at: w.at });
    return { done: true };
  },
  // Failed for good (six tries): the Actions job is rejected and its files go, by a job of its own,
  // since this hook runs inside Core's commit and can't reach the Music object or the bucket.
  failed(w, payload) {
    const jobId = (payload as ApplyPayload).job_id;
    requeueJob(w.db, { id: `listen.reject:${jobId}`, kind: LISTEN_REJECT, payload: { job_id: jobId }, at: w.at });
  },
};

/** `music.listen.reject`: an Actions job whose apply failed for good is rejected, its uploads deleted. */
export const listenRejectJob: JobHandler = {
  kind: LISTEN_REJECT,
  lane: false,
  async load(env, _db, payload) {
    const vault = env.VAULT;
    if (!vault) throw new JobError('not_configured');
    const jobId = (payload as { job_id: string }).job_id;
    await musicObject(env).listenReject(jobId);
    await dropJobFiles(vault, jobId);
    return null;
  },
  step() {
    return { done: true };
  },
};

export const listenPackJob: JobHandler = {
  kind: LISTEN_PACK,
  lane: false,
  heavy: true,
  async load(env) {
    if (!env.VAULT) throw new JobError('not_configured');
    return musicObject(env).buildPack();
  },
  step() {
    return { done: true };
  },
};
