// A scheduled verb's or plan's time comes (schedule.ts): the Core alarm, and the 15-minute tick for
// one the alarm missed, run each due row in its own commit, under the permit it was queued with.
// A Worker-side verb runs through its area's op (its ledger row, written now, names when it was
// queued); a phone verb or intent becomes pending for a phone or its app from this moment; a plan
// runs its steps (plan.ts). A music or podcasts row that comes due inside quiet hours (they were
// set later than it was queued) moves to their end instead. When it fails, its commit rolls back
// and `failed` records it in the next: the row `failed` with its code (and a plan's step), and a
// failed ledger row, so the mind sees what did not happen.
import type { ErrorCode, ErrorDetails } from '../../../../shared/contract/api';
import type { PermitPosition } from '../../../../shared/contract/permits.ts';
import { PLAN_ACTION } from '../../../../shared/contract/schedules.ts';
import { verbSpec } from '../../../../shared/contract/verbs.ts';
import { Fail } from '../../lib/result';
import type { Writer } from '../../objects/commit';
import { inQuiet, nextQuietEnd, quietWindow } from '../settings/quiet';
import { followThrough } from './follow';
import * as plan from './plan';
import { type Call, queuePhone, runWorker } from './run';
import * as schedule from './schedule';
import * as store from './store';

/** Scheduled rows one pass runs; past it, the alarm comes back at once for the rest. */
export const PER_PASS = 20;

/** Runs one due row (re-read here: a cancel may have come first). `moved` when quiet hours held it. */
export function fire(w: Writer, id: string, zone: () => string): 'ran' | 'moved' | 'gone' {
  const row = store.byId(w.db, id);
  if (row?.status !== 'scheduled') return 'gone';
  const tz = zone();
  const isPlan = row.verb === PLAN_ACTION;
  const q = quietWindow(w.db);
  if (schedule.quietHeld(isPlan ? plan.verbsOf(row) : [row.verb]) && inQuiet(w.at, tz, q)) {
    store.setFireAt(w.db, id, nextQuietEnd(w.at, tz, q));
    w.change('verb', `verb:${id}`);
    return 'moved';
  }
  const c = schedule.callerOf(row.actor);
  const queued = schedule.localTime(row.created_at, tz);
  const position = row.permit as PermitPosition | null;
  const card = position === 'ask' ? row.proposal_id : null;
  if (isPlan) {
    plan.run(w, c, row, card, zone, queued);
    return 'ran';
  }
  const spec = verbSpec(row.verb);
  if (!spec) throw new Fail('validation', { reason: 'this verb is no longer in the contract' });
  const x: Call = {
    id,
    verb: row.verb,
    schema: row.schema,
    args: JSON.parse(row.args_json),
    why: row.why ?? '',
    ref: row.ref,
    device_id: row.device_id,
    position,
    proposal_id: row.proposal_id,
    card,
    hash: row.req_sha256,
    plan_id: null,
    expires_at: row.expires_at,
    queued,
  };
  if (spec.side === 'phone') {
    queuePhone(w, c, x);
    return 'ran';
  }
  const { ledgerId, ran } = runWorker(w, c, x, zone);
  if (position && ran.undo && !ran.ledger_id)
    followThrough(w, { verb: row.verb, why: x.why, position }, ledgerId, zone);
  return 'ran';
}

/** A due row that failed when it ran (its own commit rolled back): `failed` with its code (and the
 * plan's step), and a failed ledger row naming when it was queued. */
export function failed(w: Writer, id: string, code: ErrorCode, details: ErrorDetails | undefined, zone: () => string) {
  const row = store.byId(w.db, id);
  if (row?.status !== 'scheduled') return;
  const isPlan = row.verb === PLAN_ACTION;
  const d = isPlan ? plan.failedStep(row, details) : null;
  const error = { code, ...(d ?? {}) };
  const at = d?.step ? ` at step ${d.step} (${d.verb})` : '';
  const ledgerId = w.ledger({
    kind: isPlan ? 'plan' : 'verb',
    actor: schedule.callerOf(row.actor).actor,
    what: isPlan ? `${plan.whatOf(row)} (failed${at}: ${code})` : `${row.verb} failed (${code})`,
    why: `${row.why ?? ''} (queued ${schedule.localTime(row.created_at, zone())})`,
    ref: row.ref ?? `${isPlan ? 'plan' : 'verb'}:${id}`,
    verb_id: id,
    status: 'failed',
    permit: row.permit as PermitPosition | null,
  });
  store.finish(w.db, id, false, w.at, undefined, null, error);
  store.setLedger(w.db, id, ledgerId);
  w.change('verb', `verb:${id}`);
  if (isPlan) w.change('plan', `plan:${id}`);
}
