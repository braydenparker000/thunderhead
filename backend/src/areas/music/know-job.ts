// The music knowledge's own job (`music.know`, MUSIC.md §19.2, JOBS.md §4.4), a bulk-lane job in Core's
// alarm. Each step asks the Music object what to do next (`knowNext`) and does it: one MusicBrainz
// lookup of a catalog artist, one source's request for one facts row, the daily picks rebuild. At most
// one outside request a step, and the next step waits 1.1 s (the runner's `after`), so MusicBrainz's
// one a second and every other host's gap hold. What a step learnt is kept by the Music object in one
// transaction, so a step run again writes the same rows: the job is resumable and idempotent.
// With nothing to do now, the job ends and notes when to come back (`music.know.next`); it is queued
// again by the cron's tick once that time comes (and whenever it is missing or failed: a deploy onto
// an existing database, a library with no history import, a failure), by the end of the history's
// `music.mb`, and by a catalog change (the upload routes, `seed_quiet_ms` later).
import { KNOW_LIMITS as K } from '../../../../shared/contract/know.ts';
import { TASTE_LIMITS as L } from '../../../../shared/contract/taste.ts';
import { musicObject } from '../../objects/music';
import { sensesObject } from '../../objects/senses';
import type { JobHandler } from '../jobs/runner';
import { putSetting } from '../settings/store';
import { lookup, mbJob } from './history-mb';
import { fetchAsk, type Got } from './know-fetch';
import { KNOW_JOB, KNOW_NEXT } from './know-queue';

type Input = { know: number; wait: number; idle?: boolean };

/** One knowledge step: the rows it wrote in Music, how long the next step waits, and whether there
 * was nothing to do now. */
export async function knowStep(env: Env, now = Date.now()): Promise<Input> {
  const music = musicObject(env);
  const task = await music.knowNext(now);
  if (task.t === 'idle') return { know: 0, wait: task.wait, idle: true };
  if (task.t === 'picks') {
    const skips = await sensesObject(env).earlySkips(now);
    return { know: await music.picksBuild(skips, now), wait: L.mb_gap_ms };
  }
  if (task.t === 'lookup') {
    const r = await lookup(task.name, now);
    if (r === 'wait') return { know: 0, wait: L.mb_gap_ms };
    return { know: await music.knowLookup(task.key, r, now), wait: L.mb_gap_ms };
  }
  const got = await fetchAsk(env, task.source, task.ask, now);
  if (got === 'wait') return { know: 0, wait: L.mb_gap_ms };
  // The RPC types can't carry `unknown`; the answer is the parser's own plain data.
  return {
    know: await music.knowPut(task.id, task.source, got as Got & Record<string, never>, now),
    wait: L.mb_gap_ms,
  };
}

export const knowJob: JobHandler = {
  kind: KNOW_JOB,
  lane: true,
  load: (env) => knowStep(env),
  step(w, _payload, cursor, input) {
    const i = input as Input;
    if (i.idle) {
      putSetting(w.db, KNOW_NEXT, w.at + Math.min(i.wait, K.idle_ms), 'worker', w.at);
      return { done: true, rows: i.know };
    }
    return { next: { n: ((cursor as { n: number } | null)?.n ?? 0) + 1 }, after: i.wait, rows: i.know };
  },
};

/** Music's jobs, by kind, for Core's runner (JOBS.md §4.4). */
export const MUSIC_JOBS: Record<string, JobHandler> = { [mbJob.kind]: mbJob, [knowJob.kind]: knowJob };
