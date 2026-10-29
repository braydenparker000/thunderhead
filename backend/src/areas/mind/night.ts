// The night shift's run record (RUNTIME.md §12, API.md §11.8). One `night_runs` row per closed day
// keeps the last finished step, each step's time and session (or why it was skipped), a step's
// saved cursor and when the run ended, so a refired session resumes at the first step not done
// and never repeats one. The steps are shared/contract/night.ts's: a number it doesn't list is
// refused, steps go in order, a step of a phase not built yet (and the weekly step on any other
// night) is skipped on the way, and `done` ends the session and its wake (`night_done`). The day
// roll fires the night once for the day before the new open day (`nightWake`), but only while the
// mind-night task is connected (ROUTINE_NIGHT_URL/TOKEN, SETUP.md L1).
import type { MindNightRequest, MindNightResponse } from '../../../../shared/contract/api';
import {
  NIGHT_BACKFILL_DAYS,
  NIGHT_LAST_STEP,
  NIGHT_STEPS,
  type NightStep,
} from '../../../../shared/contract/night.ts';
import { BUILT_PHASES } from '../../../../shared/contract/routes.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { DAY, dayBefore, HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { claimedSession } from './guards';
import * as store from './store';
import type { ToFire } from './wake';

type Skip = 'later' | 'not_sunday' | 'hard_stop';
/** A step done (`done`), skipped (`skipped`, with why), or under way with a saved `cursor`. */
interface StepRecord {
  at: number;
  session?: string | null;
  done?: true;
  skipped?: Skip;
  cursor?: string;
}
interface RunRow {
  day: string;
  started_at: number;
  step: number;
  steps_json: string;
  done_at: number | null;
  session_id: string | null;
}

/** A night wake nobody claimed within this long has failed (the 06:07 schedule was its fallback). */
const NIGHT_WAKE_OPEN_MS = 12 * HOUR;
/** How long a run stays with the session that last moved it (more than the longest step). */
const NIGHT_HOLD_MS = 20 * 60_000;

/** The day a night works on: the one before the open day ("yesterday", RUNTIME.md §12). */
export const nightDayOf = (today: string): string => dayBefore(today);

export function nightRun(db: Db, day: string): RunRow | null {
  return db.one<RunRow>(
    'SELECT day, started_at, step, steps_json, done_at, session_id FROM night_runs WHERE day = ?',
    day,
  );
}

/** Whether `day`'s run finished (the night briefing's `night_done`). */
export const nightDone = (db: Db, day: string): boolean => (nightRun(db, day)?.done_at ?? null) !== null;

/** The briefing's health line about the night (RUNTIME.md §9 F14, F15). */
export function nightLine(db: Db, today: string, configured: boolean): string {
  const day = nightDayOf(today);
  const run = nightRun(db, day);
  if (run?.done_at != null) return `night shift: ${day} done`;
  if (run) return `night shift: ${day} stopped after step ${run.step}`;
  return configured ? `night shift: ${day} not run yet` : 'night shift: not connected yet (SETUP.md L1)';
}

/** The day roll's fire of the night shift (RUNTIME.md §3), inside the roll's own commit: once for
 * the new open day's night, unless the task isn't connected, that night already finished, or a
 * night wake of the last 12 hours is still open. An older one nobody claimed has failed. */
export function nightWake(w: Writer, today: string, configured: boolean): ToFire | null {
  const { db, at } = w;
  if (!configured || nightDone(db, nightDayOf(today))) return null;
  let open = false;
  for (const o of store.openWakes(db, 'night')) {
    if (at - o.at < NIGHT_WAKE_OPEN_MS) open = true;
    else store.setWakeStatus(db, o.id, 'failed');
  }
  if (open) return null;
  const id = uuidv7(at);
  store.insertWake(db, { id, at, task: 'night', reason: 'roll' });
  return { id, task: 'night' };
}

/** The weekly step runs on the night into Sunday, the one that works on Saturday. */
export const weekly = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() === 6;

function notDue(s: NightStep, day: string): Skip | null {
  if (!BUILT_PHASES.includes(s.phase) || s.deferred) return 'later';
  if (s.sunday && !weekly(day)) return 'not_sunday';
  return null;
}

/** The first step neither done nor skipped, marking the steps that aren't due on the way. */
function next(steps: Record<string, StepRecord>, day: string, at: number): number {
  for (const s of NIGHT_STEPS) {
    const rec = steps[s.step];
    if (rec?.done || rec?.skipped) continue;
    const skip = rec ? null : notDue(s, day);
    if (!skip) return s.step;
    steps[s.step] = { at, skipped: skip };
  }
  return NIGHT_LAST_STEP + 1;
}

function answer(row: { done_at: number | null }, steps: Record<string, StepRecord>, resume: number): MindNightResponse {
  const skipped = Object.entries(steps)
    .filter(([, r]) => r.skipped)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  return { resume_from: resume, done: row.done_at !== null, cursor: steps[resume]?.cursor ?? null, skipped };
}

/** POST /v1/mind/night from a claimed night session (its taint doesn't matter: this is progress,
 * not memory). `today` is the open logical day; `day` must be one that has closed. */
export function night(w: Writer, c: Caller, r: MindNightRequest, today: string): MindNightResponse {
  const { db, at } = w;
  if (r.day >= today) throw invalid('day', 'a day that has closed');
  if (Date.parse(`${r.day}T12:00:00Z`) < Date.parse(`${today}T12:00:00Z`) - NIGHT_BACKFILL_DAYS * DAY)
    throw invalid('day', `at most ${NIGHT_BACKFILL_DAYS} days back`);
  if (r.partial && r.action !== 'done') throw invalid('partial', 'only with done');
  if (r.action === 'cursor' && r.cursor === undefined) throw invalid('cursor', 'required with cursor');
  const stored = nightRun(db, r.day);
  if (stored && stored.done_at !== null) {
    // Finished already (the 06:07 fallback's start, a refire, a repeated done): nothing to do,
    // and the asking session's work is over. Only a night session that claimed (and is live,
    // or ended with this run) is answered; its end is the one write.
    doneCaller(db, c.session_id, stored.done_at);
    endNight(db, c.session_id, at);
    return answer(stored, JSON.parse(stored.steps_json) as Record<string, StepRecord>, NIGHT_LAST_STEP + 1);
  }
  claimedSession(db, c.session_id, 'night');
  // One session works a run at a time (the 06:07 fallback while the roll's session still works):
  // another live night session that made progress in the last 20 minutes keeps it; one that
  // crashed stops counting after that, and a refire takes over.
  if (stored?.session_id && stored.session_id !== c.session_id) {
    const other = store.session(db, stored.session_id);
    const recs = Object.values(JSON.parse(stored.steps_json) as Record<string, StepRecord>);
    const last = Math.max(stored.started_at, ...recs.map((x) => x.at));
    if (other !== null && other.ended_at === null && at - last < NIGHT_HOLD_MS)
      throw new Fail('already_live', { reason: 'another night session is working on this run' });
  }
  const row = stored
    ? { ...stored }
    : { day: r.day, started_at: at, step: 0, steps_json: '{}', done_at: null, session_id: null };
  const steps = JSON.parse(row.steps_json) as Record<string, StepRecord>;
  let resume = next(steps, r.day, at);
  const step = r.step ?? 0;
  if (r.action === 'step_done' || r.action === 'cursor') {
    if (!NIGHT_STEPS.some((s) => s.step === step))
      throw invalid('step', `steps are ${NIGHT_STEPS.map((s) => s.step).join(', ')}`);
    if (step > resume) throw new Fail('conflict', { resume_from: resume });
  }
  // `done` is the last step's own end (so is that step reported done); with `partial`, the hard
  // stop cut the steps between, and they are recorded as skipped (those not due tonight anyway
  // with their own reason).
  if (r.action === 'done' || (r.action === 'step_done' && step === NIGHT_LAST_STEP && step === resume)) {
    if (resume < NIGHT_LAST_STEP && !r.partial) throw new Fail('conflict', { resume_from: resume });
    for (const s of NIGHT_STEPS)
      if (s.step >= resume && s.step < NIGHT_LAST_STEP)
        steps[s.step] = { at, skipped: notDue(s, r.day) ?? 'hard_stop' };
    steps[NIGHT_LAST_STEP] = { at, session: c.session_id, done: true };
    row.done_at = at;
    resume = NIGHT_LAST_STEP + 1;
    endNight(db, c.session_id, at);
  } else if (r.action === 'step_done' && step === resume) {
    steps[step] = { at, session: c.session_id, done: true };
    resume = next(steps, r.day, at);
  } else if (r.action === 'cursor' && step === resume) {
    if (!NIGHT_STEPS.find((s) => s.step === step)?.cursor) throw invalid('step', `step ${step} keeps no cursor`);
    steps[step] = { at, session: c.session_id, cursor: r.cursor };
  }
  // A step reported again, or a start that changes nothing, writes nothing.
  const json = JSON.stringify(steps);
  if (stored && json === stored.steps_json && row.done_at === null && c.session_id === stored.session_id)
    return answer(row, steps, resume);
  db.run(
    `INSERT INTO night_runs (day, started_at, step, steps_json, done_at, session_id) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET step = excluded.step, steps_json = excluded.steps_json,
       done_at = coalesce(night_runs.done_at, excluded.done_at), session_id = excluded.session_id`,
    r.day,
    row.started_at,
    resume - 1,
    json,
    row.done_at,
    c.session_id,
  );
  return answer(row, steps, resume);
}

/** The caller of a run already done: a night session that claimed, and is live or ended at or
 * after that run's end (so a retried `done` gets the same answer). Anyone else (a session that
 * never claimed, a made-up id, another role's session, one ended before) is 403, and nothing is
 * ended. */
function doneCaller(db: Db, sessionId: string | null, doneAt: number): void {
  const s = sessionId ? store.session(db, sessionId) : null;
  if (s?.role !== 'night' || s.wake_id === null || (s.ended_at !== null && s.ended_at < doneAt))
    throw new Fail('session_required');
}

/** The night session's work is over: it ends, and so does the wake it claimed (`night_done`). */
export function endNight(db: Db, sessionId: string | null, at: number): void {
  const s = sessionId ? store.session(db, sessionId) : null;
  if (s?.role !== 'night' || s.ended_at !== null) return;
  store.endSession(db, s.session_id, at);
  if (s.wake_id) store.setWakeStatus(db, s.wake_id, 'ended', { ended_at: at, end_reason: 'night_done' });
}
