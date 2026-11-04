// Routines (MIND-PLAN §3.6, API.md §11.11 "Routines"; the contract is shared/contract/routines.ts):
// a plan and a condition the owner approved once. The mind raises a `routine.propose` card (always
// a card); its target line is written here from the steps and the condition (`target`), after the
// same checks a plan's steps get (plan.ts `validate`, with law 8 at the gate) and these: no step that
// runs only as it is asked, none behind a floor (those ask every time), no Music find (a routine
// plays a saved mix or given songs). The yes stores it `on` (`approve`), its permit the strictest
// step's position as it stands then. When its condition comes (`fire`, from Core's tick and alarm,
// or a sense's arrival for an `after` routine, at most once in the owner's day) it runs as one plan
// row through plan.ts `run`, with no session: one ledger row, one undo, the plan's own line on home.
// Music and podcasts wait out quiet hours as a scheduled plan does. A failed run rolls back and is
// recorded once (`failed`, a short `last_error` Settings shows). The owner switches one on or off
// and removes one that is off; the mind may only switch one off.
import type { ErrorCode, ErrorDetails, Json, ProposalResult } from '../../../../shared/contract/api';
import { lintMindText } from '../../../../shared/contract/lint.ts';
import { type PermitPosition, permitOf } from '../../../../shared/contract/permits.ts';
import { ROUTINE_LIMITS, type Routine, type RoutineArgs } from '../../../../shared/contract/routines.ts';
import { PLAN_ACTION } from '../../../../shared/contract/schedules.ts';
import { law8Topic, verbSpec } from '../../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { logicalDay } from '../conversation/day';
import * as ledger from '../ledger/store';
import { positionFor } from '../mind/permit';
import { inQuiet, nextQuietEnd, quietWindow } from '../settings/quiet';
import * as plan from './plan';
import * as rs from './routine-store';
import { nextAt, type Resolved, resolve, words } from './routine-when';
import { phoneArgs } from './run';
import * as schedule from './schedule';
import * as store from './store';

const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const changed = (w: Writer, id: string) => w.change('routine', `routine:${id}`);

/** Everything a routine is checked for, before a card is raised and again at the yes. */
export function check(db: Db, a: RoutineArgs): { steps: plan.Step[]; cond: Resolved; when: string } {
  for (const [path, text] of [
    ['name', a.name],
    ['what', a.what],
  ] as const) {
    const problem = lintMindText(text);
    if (problem) throw invalid(`spec.args.${path}`, problem);
  }
  const topic = law8Topic(`${a.name} ${a.what}`, {});
  if (topic) throw new Fail('validation', { reason: 'needs_owner_words', topic, path: 'spec.args.name' });
  const steps = plan.validate(
    a.steps.map((s) => ({ ...s, args: s.args as Record<string, Json> })),
    a.why,
  );
  for (const [i, s] of steps.entries()) {
    const at = `spec.args.steps.${i}`;
    if (verbSpec(s.verb)?.now_only) throw invalid(`${at}.verb`, `${s.verb} runs only as it is asked, never on its own`);
    if (permitOf(s.verb)?.floor) throw invalid(`${at}.verb`, 'a step behind a floor asks every time, never on its own');
    if (s.verb === 'music.play_mix' && s.args.find !== undefined && !(Array.isArray(s.args.refs) && s.args.refs.length))
      throw invalid(`${at}.args.find`, 'a routine plays a saved mix (mix_id) or given songs, never a find');
  }
  const cond = resolve(db, a.condition);
  return { steps, cond, when: words(cond) };
}

/** The card's target line (proposals/ops.ts): the condition and the steps, in the Worker's words. */
export function target(db: Db, a: RoutineArgs): string {
  const c = check(db, a);
  return short(`${c.when}: ${c.steps.map((s) => s.verb).join(', ')}. Runs on its own until you switch it off.`, 200);
}

const RANK: Record<PermitPosition, number> = { quiet: 0, tell: 1, ask: 2 };

/** The strictest standing position among the steps, as it stands now (null: no step has a class). */
function strictest(db: Db, verbs: readonly string[]): PermitPosition | null {
  let top: PermitPosition | null = null;
  for (const v of verbs) {
    if (!permitOf(v)) continue;
    const p = positionFor(db, v);
    if (top === null || RANK[p] > RANK[top]) top = p;
  }
  return top;
}

/** The yes (proposals/executors.ts): stores the routine `on`, its permit decided once, here. */
export function approve(
  w: Writer,
  a: RoutineArgs,
  p: { id: string; created_by: string },
  owner: Caller,
  tz: string,
): { result: ProposalResult; ledger_id: string } {
  if (rs.byId(w.db, a.id)) throw new Fail('conflict', { reason: 'this routine is stored already' });
  if (rs.count(w.db) >= ROUTINE_LIMITS.max)
    throw new Fail('validation', { reason: `at most ${ROUTINE_LIMITS.max} routines: remove one first` });
  const c = check(w.db, a);
  const permit = strictest(
    w.db,
    c.steps.map((s) => s.verb),
  );
  const next = nextAt(c.cond, w.at, tz);
  rs.insert(w.db, {
    id: a.id,
    name: a.name,
    what: a.what,
    why: a.why,
    steps_json: JSON.stringify(c.steps),
    cond_json: JSON.stringify(c.cond),
    when_text: c.when,
    event_type: 'after' in c.cond ? c.cond.after : null,
    actor: p.created_by,
    proposal_id: p.id,
    permit,
    status: 'on',
    approved_at: w.at,
    updated_at: w.at,
    next_at: next,
    last_run_at: null,
    last_ledger_id: null,
    last_day: null,
    last_error: null,
  });
  const ledgerId = w.ledger({
    kind: 'verb',
    actor: owner.actor,
    session_id: owner.session_id,
    what: `stored the routine "${a.name}" (${c.when})`,
    why: a.why,
    ref: `routine:${a.id}`,
    undoable: false,
    permit,
  });
  changed(w, a.id);
  return { result: { routine_id: a.id, next_at: next }, ledger_id: ledgerId };
}

const condOf = (r: rs.RoutineRow) => JSON.parse(r.cond_json) as Resolved;
const nextOf = (r: rs.RoutineRow, at: number, tz: string) => (r.status === 'on' ? nextAt(condOf(r), at, tz) : null);

/** Runs one routine whose time came (`event`: an `after` routine's sense arrived), in this commit,
 * re-read here: a switch may have come first. `moved` when quiet hours hold its music. */
export function fire(w: Writer, id: string, zone: () => string, event = false): 'ran' | 'moved' | 'gone' {
  const r = rs.byId(w.db, id);
  if (r?.status !== 'on') return 'gone';
  const tz = zone();
  const day = logicalDay(w.at, tz);
  if (event ? r.event_type === null || r.last_day === day : r.next_at === null || r.next_at > w.at) return 'gone';
  const steps = JSON.parse(r.steps_json) as plan.Step[];
  const q = quietWindow(w.db);
  if (schedule.quietHeld(steps.map((s) => s.verb)) && inQuiet(w.at, tz, q)) {
    // An event in quiet hours fires nothing (the next one after them may); a time waits for their end.
    if (event) return 'gone';
    rs.setNext(w.db, id, nextQuietEnd(w.at, tz, q));
    changed(w, id);
    return 'moved';
  }
  const kept: plan.Kept = {
    what: r.what,
    steps: steps.map((s) => (verbSpec(s.verb)?.side === 'phone' ? { ...s, args: phoneArgs(w, s.verb, s.args) } : s)),
  };
  const vid = uuidv7(w.at);
  store.insert(w.db, {
    id: vid,
    created_at: w.at,
    actor: r.actor,
    verb: PLAN_ACTION,
    schema: 1,
    ref: `routine:${id}`,
    args_json: JSON.stringify(kept),
    device_id: null,
    expires_at: w.at,
    proposal_id: r.proposal_id,
    ledger_id: null,
    req_sha256: null,
    status: 'pending',
    fire_at: null,
    why: `${r.why} (routine: ${r.name})`,
    permit: r.permit,
  });
  // The routine's card is the standing approval every run's ledger row names.
  plan.run(w, schedule.callerOf(r.actor), store.byId(w.db, vid) as store.VerbRow, r.proposal_id, zone);
  const ledgerId = store.byId(w.db, vid)?.ledger_id ?? null;
  rs.ran(w.db, id, { at: w.at, ledger_id: ledgerId, day, error: null, next: nextOf(r, w.at, tz) });
  changed(w, id);
  return 'ran';
}

/** A run that failed (its own commit rolled back): the short error Settings shows, a failed ledger
 * row (not a line on home), and the next time it comes. */
export function failed(w: Writer, id: string, code: ErrorCode, details: ErrorDetails | undefined, zone: () => string) {
  const r = rs.byId(w.db, id);
  if (r?.status !== 'on') return;
  const tz = zone();
  const kept = { args_json: JSON.stringify({ what: r.what, steps: JSON.parse(r.steps_json) }) } as store.VerbRow;
  const d = plan.failedStep(kept, details);
  const error = short(`${d ? `step ${d.step} (${d.verb}): ` : ''}${code}`, ROUTINE_LIMITS.error);
  w.ledger({
    kind: 'verb',
    actor: schedule.callerOf(r.actor).actor,
    what: `the routine "${r.name}" did not run (${error})`,
    why: r.why,
    ref: `routine:${id}`,
    status: 'failed',
    permit: r.permit as PermitPosition | null,
  });
  rs.ran(w.db, id, { at: w.at, ledger_id: null, day: logicalDay(w.at, tz), error, next: nextOf(r, w.at, tz) });
  changed(w, id);
}

/** POST /v1/routines/:id/switch: the owner on or off; the mind off only. The same again: as it is. */
export function setOn(w: Writer, c: Caller, id: string, on: boolean, tz: string): Routine {
  const r = rs.byId(w.db, id);
  if (!r) throw new Fail('not_found');
  if (on && c.who !== 'D') throw new Fail('forbidden', { reason: 'only the owner switches a routine on' });
  if ((r.status === 'on') === on) return toRoutine(w.db, r);
  const next = on ? nextAt(condOf(r), w.at, tz) : null;
  rs.setStatus(w.db, id, on ? 'on' : 'off', next, w.at);
  w.ledger({
    kind: 'verb',
    actor: c.actor,
    session_id: c.session_id,
    what: `switched the routine "${r.name}" ${on ? 'on' : 'off'}`,
    why: c.who === 'D' ? 'the owner’s switch in Settings' : 'the mind stopped a routine it proposed',
    ref: `routine:${id}`,
    undoable: false,
  });
  changed(w, id);
  return toRoutine(w.db, rs.byId(w.db, id) as rs.RoutineRow);
}

/** DELETE /v1/routines/:id: the owner removes one that is off (its runs' ledger rows stay). */
export function remove(w: Writer, c: Caller, id: string): { id: string; removed: true } {
  const r = rs.byId(w.db, id);
  if (!r) throw new Fail('not_found');
  if (r.status === 'on') throw new Fail('conflict', { reason: 'switch it off first' });
  rs.remove(w.db, id);
  w.ledger({
    kind: 'verb',
    actor: c.actor,
    session_id: c.session_id,
    what: `removed the routine "${r.name}"`,
    why: 'the owner removed it in Settings',
    ref: `routine:${id}`,
    undoable: false,
  });
  changed(w, id);
  return { id, removed: true };
}

/** One routine as the wire has it; its last run's ledger row read for whether it was undone. */
export function toRoutine(db: Db, r: rs.RoutineRow): Routine {
  const cond = condOf(r);
  const { text: _t, fact, ...rest } = 'fact' in cond ? cond : { ...cond, text: '', fact: undefined };
  return {
    id: r.id,
    name: r.name,
    what: r.what,
    why: r.why,
    when: r.when_text,
    condition: fact ? { fact } : (rest as Routine['condition']),
    steps: (JSON.parse(r.steps_json) as plan.Step[]).map((s) => s.verb),
    on: r.status === 'on',
    permit: r.permit as PermitPosition | null,
    proposal_id: r.proposal_id,
    approved_at: r.approved_at,
    next_at: r.next_at,
    last_run_at: r.last_run_at,
    last_ledger_id: r.last_ledger_id,
    last_undone: r.last_ledger_id ? ledger.byId(db, r.last_ledger_id)?.status === 'undone' : false,
    last_error: r.last_error,
  };
}

/** GET /v1/routines: every one, oldest approval first (at most 12, one read each for its last run). */
export const list = (db: Db): Routine[] => rs.all(db).map((r) => toRoutine(db, r));
