// When the music knowledge's job (`music.know`, know-job.ts) is queued: by the end of the history's
// `music.mb`, by a catalog change, and by the cron's tick once the time it noted has come, or when it
// is missing or failed (a deploy onto an existing database, a library with no history, a failure).
import type { Db } from '../../objects/base';
import { job, requeueJob } from '../jobs/store';
import { getSetting } from '../settings/store';

export const KNOW_JOB = 'music.know';
/** When the job, gone idle, wants to look again (a Core setting it writes as it ends). */
export const KNOW_NEXT = 'music.know.next';

/** Queues the job at `at` unless it is already queued or running (a new row, or a done or failed one
 * again). Rows written. */
export const queueKnow = (db: Db, at: number) => requeueJob(db, { id: KNOW_JOB, kind: KNOW_JOB, payload: {}, at });

/** The cron's look (two rows read): whether the job should be queued now. */
export function knowDue(db: Db, now: number): boolean {
  const j = job(db, KNOW_JOB);
  if (!j || j.state === 'failed') return true;
  if (j.state !== 'done') return false;
  const next = getSetting(db, KNOW_NEXT);
  return typeof next !== 'number' || now >= next;
}
