// Plans (API.md §11.11 "Plans", MIND-PLAN §3.4): 2–8 verbs with one why, one undo and one line on
// home ("Set up your evening."). Every step is checked against its spec before anything runs; the
// permit is the strictest position among the steps (mind/permit.ts `gatePlan`: an `ask` anywhere
// asks once for the whole plan, a `permit.allow` card for `plan.run` with the steps' hash). The
// steps then run in order inside one commit, each through the path it would take alone (run.ts):
// a Worker-side step done with its own ledger row, a phone step (an app's intent) pending in order.
// A step that fails rolls the commit back, so the steps before it are undone with it (their rows,
// their changes, the card) and the answer names the step; a scheduled plan that fails when it runs
// is recorded as `failed` with the step (due.ts). The plan's one ledger row (kind `plan`, `what` =
// its line) keeps the steps' ledger ids; its undo reverses them last first (`undoPlan`). A plan
// counts once for the follow-through rule (follow.ts `followPlan`). The plan itself is a `verbs`
// row named `plan.run`, which also lets it wait for `fire_at` like a verb (schedule.ts).
import type {
  ErrorDetails,
  JsonObject,
  Plan,
  PlanStep,
  PostPlanRequest,
  UndoResponse,
} from '../../../../shared/contract/api';
import { lintMindText } from '../../../../shared/contract/lint.ts';
import type { Permit, PermitClass, PermitPosition } from '../../../../shared/contract/permits.ts';
import { PLAN_ACTION } from '../../../../shared/contract/schedules.ts';
import { verbSpec } from '../../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as ledger from '../ledger/store';
import { gatePlan } from '../mind/permit';
import { followPlan } from './follow';
import { lawGate } from './law';
import { type Call, type Prepared, phoneArgs, queuePhone, runWorker } from './run';
import * as schedule from './schedule';
import * as store from './store';

interface Step {
  verb: string;
  schema: number;
  args: JsonObject;
  device_id: string | null;
}
/** What a plan's row keeps in `args_json`: its line and its steps (a phone step's args as the phone
 * gets them). Its `result_json` holds the steps' verb and ledger ids once it ran. */
interface Kept {
  what: string;
  steps: Step[];
  /** The class the gate filed it under (its strictest step's), for a retry's answer. */
  cls?: PermitClass;
}
type Done = { verb_id: string; ledger_id: string }[];

/** Each step against its spec, before anything is gated or runs: 422 naming the step. */
function validate(steps: PlanStep[], why: string): Step[] {
  return steps.map((s, i) => {
    const spec = verbSpec(s.verb);
    if (!spec) throw invalid(`steps.${i}.verb`, 'unknown verb');
    if (!spec.queueable) throw invalid(`steps.${i}.verb`, 'this verb runs only from an owner tap');
    const version = spec.versions[s.schema];
    if (!version) throw invalid(`steps.${i}.schema`, `known versions: ${Object.keys(spec.versions).join(', ')}`);
    const args = version.args.safeParse(s.args);
    if (!args.success)
      throw new Fail(
        'validation',
        args.error.issues.map((x) => ({
          path: [`steps.${i}.args`, ...x.path.map(String)].join('.'),
          issue: x.message,
        })),
      );
    lawGate(s.verb, why, args.data, `steps.${i}.args`);
    return { verb: s.verb, schema: s.schema, args: args.data as JsonObject, device_id: s.device_id ?? null };
  });
}

/** A step's refusal, naming the step (1-based) and its verb. */
function stepFailed(e: unknown, i: number, verb: string): unknown {
  if (!(e instanceof Fail)) return e;
  const d = e.details;
  if (Array.isArray(d))
    return new Fail(
      e.code,
      d.map((x) => ({ ...x, path: `steps.${i}.${x.path}` })),
    );
  return new Fail(e.code, { ...(d && !('card' in d) ? d : {}), step: i + 1, verb });
}

/** POST /v1/verbs/plan. The same id and body again answers the plan as it stands. */
export function post(
  w: Writer,
  c: Caller,
  r: PostPlanRequest,
  hash: string,
  zone: () => string,
  prepared: Prepared[] = [],
): { plan: Plan; created: boolean; permit?: Permit; shifted?: boolean } {
  const found = store.byId(w.db, r.id);
  if (found) {
    if (found.req_sha256 !== hash || found.verb !== PLAN_ACTION) throw new Fail('conflict');
    const shifted =
      r.fire_at && found.fire_at !== null ? { shifted: schedule.fireMs(r.fire_at, zone()) !== found.fire_at } : {};
    return { plan: planOf(w.db, found), created: false, ...permitOf(w.db, found), ...shifted };
  }
  const problem = lintMindText(r.what);
  if (problem) throw invalid('what', problem);
  const steps = validate(r.steps, r.why);
  const verbs = steps.map((s) => s.verb);
  const tz = r.fire_at === undefined ? 'UTC' : zone();
  const requested = r.fire_at === undefined ? null : schedule.when(w, verbs, r.fire_at, tz);
  const call = {
    steps: steps.map(({ verb, schema, args }) => ({ verb, schema, args })),
    ...(requested === null ? {} : { fire_at: requested }),
  };
  const g = gatePlan(w, c, verbs, call, `plan:${r.id}`, r.proposal_id);
  // A mix's or a find's songs, now (the find ran in the route; a scheduled plan keeps them).
  const kept: Kept = {
    what: r.what,
    ...(g ? { cls: g.permit.class } : {}),
    steps: steps.map((s, i) =>
      verbSpec(s.verb)?.side === 'phone' ? { ...s, args: phoneArgs(w, s.verb, s.args, prepared[i]) } : s,
    ),
  };
  const fire = requested === null ? null : schedule.held(w, verbs, requested, tz);
  store.insert(w.db, {
    id: r.id,
    created_at: w.at,
    actor: c.actor,
    verb: PLAN_ACTION,
    schema: 1,
    ref: r.ref ?? null,
    args_json: JSON.stringify(kept),
    device_id: null,
    expires_at: fire ?? w.at,
    proposal_id: r.proposal_id ?? null,
    ledger_id: null,
    req_sha256: hash,
    status: fire === null ? 'pending' : 'scheduled',
    fire_at: fire,
    why: r.why,
    permit: g?.permit.position ?? null,
  });
  if (fire === null) run(w, c, store.byId(w.db, r.id) as store.VerbRow, g?.proposal_id ?? null, zone);
  else w.change('verb', `verb:${r.id}`);
  const permit = g ? { permit: g.permit } : {};
  const plan = planOf(w.db, store.byId(w.db, r.id) as store.VerbRow);
  return { plan, created: true, ...permit, ...(fire === null ? {} : { shifted: fire !== requested }) };
}

/** Runs a plan's steps in order, in this commit, then its one ledger row; `queued` (a scheduled
 * plan's time comes) names when it was queued. A step's Fail rolls everything back, naming it. */
export function run(
  w: Writer,
  c: Caller,
  row: store.VerbRow,
  card: string | null,
  zone: () => string,
  queued?: string,
) {
  const kept = JSON.parse(row.args_json) as Kept;
  const position = row.permit as PermitPosition | null;
  const why = row.why ?? '';
  const done: Done = [];
  // Ids that sort in step order (one millisecond, so by their random part): phones and apps take
  // what is pending oldest first, then by id, so a plan's intents apply in its order.
  const ids = kept.steps.map(() => uuidv7(w.at)).sort();
  for (const [i, s] of kept.steps.entries()) {
    const x: Call = {
      id: ids[i],
      ...s,
      why,
      ref: `plan:${row.id}`,
      position,
      proposal_id: null,
      card: null,
      hash: null,
      plan_id: row.id,
      expires_at: null,
    };
    try {
      done.push({
        verb_id: x.id,
        ledger_id: verbSpec(s.verb)?.side === 'worker' ? runWorker(w, c, x, zone).ledgerId : queuePhone(w, c, x),
      });
    } catch (e) {
      throw stepFailed(e, i, s.verb);
    }
  }
  const ledgerId = w.ledger({
    kind: 'plan',
    actor: c.actor,
    session_id: c.session_id,
    what: kept.what,
    why: queued ? `${why} (queued ${queued})` : why,
    ref: row.ref ?? `plan:${row.id}`,
    verb_id: row.id,
    undo: { op: 'plan.undo', args: { plan_id: row.id, steps: done } },
    permit: position,
    ...(card ? { proposal_id: card } : {}),
  });
  store.finish(w.db, row.id, true, w.at, { steps: done }, null, null);
  store.setLedger(w.db, row.id, ledgerId);
  w.change('verb', `verb:${row.id}`);
  w.change('plan', `plan:${row.id}`);
  followPlan(w, { what: kept.what, why, position, verbs: kept.steps.map((s) => s.verb) }, ledgerId, zone);
}

/** Which step a plan's failure names (1-based) and its verb: from the details' `step`, or a field
 * issue's `steps.<i>.` path. */
export function failedStep(
  row: store.VerbRow,
  details: ErrorDetails | undefined,
): { step: number; verb: string } | null {
  const i = Array.isArray(details)
    ? Number(/^steps\.(\d+)\./.exec(details[0]?.path ?? '')?.[1] ?? Number.NaN)
    : details && 'step' in details && typeof details.step === 'number'
      ? details.step - 1
      : Number.NaN;
  const s = Number.isInteger(i) ? (JSON.parse(row.args_json) as Kept).steps[i] : undefined;
  return s ? { step: i + 1, verb: s.verb } : null;
}

/** The steps' verbs of a plan's row. */
export const verbsOf = (row: store.VerbRow) => (JSON.parse(row.args_json) as Kept).steps.map((s) => s.verb);
export const whatOf = (row: store.VerbRow) => (JSON.parse(row.args_json) as Kept).what;

/** The plan as the wire has it, each step's state read from its own row (at most 8). */
export function planOf(db: Db, row: store.VerbRow): Plan {
  const kept = JSON.parse(row.args_json) as Kept;
  const done = row.result_json ? ((JSON.parse(row.result_json) as { steps?: Done }).steps ?? []) : [];
  const error = row.error_json ? (JSON.parse(row.error_json) as Plan['error']) : null;
  return {
    id: row.id,
    status: row.status === 'pending' ? 'done' : (row.status as Plan['status']),
    what: kept.what,
    why: row.why ?? '',
    created_at: row.created_at,
    fire_at: row.fire_at,
    steps: kept.steps.map((s, i) => {
      const v = done[i] ? store.byId(db, done[i].verb_id) : null;
      return {
        verb: s.verb,
        schema: s.schema,
        verb_id: done[i]?.verb_id ?? null,
        status: v?.status ?? null,
        ledger_id: v?.ledger_id ?? done[i]?.ledger_id ?? null,
      };
    }),
    ledger_id: row.ledger_id,
    error,
  };
}

/** The permit a plan ran (or waits) under, for a retry's answer. */
function permitOf(db: Db, row: store.VerbRow): { permit?: Permit } {
  const position = (row.ledger_id ? ledger.byId(db, row.ledger_id)?.permit : null) ?? row.permit;
  const cls = (JSON.parse(row.args_json) as Kept).cls;
  return position && cls ? { permit: { action: PLAN_ACTION, class: cls, position: position as PermitPosition } } : {};
}

/**
 * The plan's undo (ledger/ops.ts, op `plan.undo`): each step last first, through the step's own
 * undo (`undoStep`: the ledger's, for its current row: a Worker-side one in place, a phone one by
 * queueing its inverse). A step no phone has taken yet is taken back; one being applied right now
 * is a conflict (try again in a moment); one with nothing to undo, or already undone, is passed.
 * A step's refusal rolls the whole undo back, naming the step. `queued` while any inverse waits.
 */
export function undoPlan(
  w: Writer,
  args: Record<string, unknown>,
  undoStep: (ledgerId: string) => UndoResponse,
): 'undone' | 'queued' {
  const steps = Array.isArray(args.steps) ? (args.steps as Done) : [];
  let queued = false;
  for (let i = steps.length - 1; i >= 0; i--) {
    const v = store.byId(w.db, String(steps[i].verb_id));
    if (!v) continue;
    if (v.status === 'claimed')
      throw new Fail('conflict', { reason: 'a phone is applying this step right now', step: i + 1, verb: v.verb });
    if (v.status === 'pending') {
      store.cancel(w.db, v.id, w.at);
      if (v.ledger_id) ledger.setStatus(w.db, v.ledger_id, 'undone', w.at);
      w.change('verb', `verb:${v.id}`);
      continue;
    }
    const row = v.status === 'done' ? ledger.byId(w.db, v.ledger_id ?? String(steps[i].ledger_id)) : null;
    if (!row || row.status === 'undone' || !row.undoable) continue;
    try {
      if (undoStep(row.id).status === 'queued') queued = true;
    } catch (e) {
      throw stepFailed(e, i, v.verb);
    }
  }
  w.change('plan', `plan:${String(args.plan_id)}`);
  return queued ? 'queued' : 'undone';
}
