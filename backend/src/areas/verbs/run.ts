// How one verb call runs now, wherever it was asked from (API.md §11.11): a Worker-side verb
// through its area's op (worker.ts), kept `done` with its result and a ledger row that holds the
// inverse; a phone verb (or an app's intent) as a `pending` row a phone claims, with its `queued`
// ledger row. Three callers share it: `PUT /v1/verbs/:id` at once (ops.ts), a plan's steps
// (plan.ts) and a scheduled row when its time comes (schedule.ts), whose ledger row names the time
// it was queued. The permit was decided before: by the gate in the same commit, or, for a
// scheduled row, when it was queued.
import type { JsonObject } from '../../../../shared/contract/api';
import type { PermitPosition } from '../../../../shared/contract/permits.ts';
import { Fail, invalid } from '../../lib/result';
import { HOUR } from '../../lib/time';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as ledger from '../ledger/store';
import * as mixes from './mixes';
import * as store from './store';
import { type Ran, runWorkerVerb } from './worker';

/** What the route worked out before the commit: the songs a `music.play_mix` find picked (the Music
 * object answers finds, so it can't be asked from inside Core's transaction). */
export interface Prepared {
  refs?: string[];
}

/** What the phone runs: a `music.play_mix` mix or find becomes its songs here (the phone has
 * neither), with the place to start from; given songs (or ones resolved when a scheduled row was
 * queued) go as they are. Any other verb's args are the phone's as given. */
export function phoneArgs(w: Writer, verb: string, a: JsonObject, prepared: Prepared = {}): JsonObject {
  if (verb !== 'music.play_mix' || (Array.isArray(a.refs) && a.refs.length)) return a;
  if (typeof a.mix_id === 'string') {
    const refs = mixes.refsOf(w.db, a.mix_id);
    if (!refs) throw new Fail('not_found', { reason: 'no such mix' });
    return { ...a, refs };
  }
  if (a.find !== undefined) {
    if (!prepared.refs?.length) throw invalid('args.find', 'no songs match it');
    return { ...a, refs: prepared.refs };
  }
  return a;
}

/** One call to run: the verb and its args (a phone verb's as the phone gets them), its why and
 * ref, how it was allowed (`position` null: not the mind's, or a verb of no class) and, for a row
 * that already exists (a scheduled one), `queued`: when it was queued, for its ledger line. */
export interface Call {
  id: string;
  verb: string;
  schema: number;
  args: JsonObject;
  why: string;
  ref: string | null;
  device_id: string | null;
  position: PermitPosition | null;
  /** The card the call named (its verbs row keeps it), and the one that let an `ask` through (its
   * ledger row's). */
  proposal_id: string | null;
  card: string | null;
  /** The canonical request hash (a retry's check; memory's batch keeps it). */
  hash: string | null;
  plan_id: string | null;
  expires_at: number | null;
  queued?: string;
}

const permitFields = (x: Call) => ({ permit: x.position, ...(x.card ? { proposal_id: x.card } : {}) });
/** A scheduled row's ledger line says when it was queued (its why: the line's `what` stays the act). */
const why = (x: Call) => (x.queued ? `${x.why} (queued ${x.queued})` : x.why);

/** A Worker-side verb, run in this commit: its ledger row (the area's own, or one written here)
 * and its `done` row. A refusal (a Fail) is the caller's to roll back. */
export function runWorker(w: Writer, c: Caller, x: Call, zone: () => string): { ledgerId: string; ran: Ran } {
  const ran = runWorkerVerb(x.verb, { w, c, id: x.id, hash: x.hash ?? x.id, zone }, x.args);
  let ledgerId = ran.ledger_id ?? null;
  if (ledgerId) ledger.linkVerb(w.db, ledgerId, x.id, x.position, x.card);
  else
    ledgerId = w.ledger({
      kind: 'verb',
      actor: c.actor,
      session_id: c.session_id,
      what: `${x.verb} done${ran.undo ? '' : ' (nothing changed)'}`,
      why: why(x),
      ref: x.ref ?? `verb:${x.id}`,
      verb_id: x.id,
      undo: ran.undo,
      ...permitFields(x),
    });
  if (x.queued) store.setLedger(w.db, x.id, ledgerId);
  else
    store.insert(w.db, {
      id: x.id,
      created_at: w.at,
      actor: c.actor,
      verb: x.verb,
      schema: x.schema,
      ref: x.ref,
      args_json: JSON.stringify(x.args),
      device_id: null,
      expires_at: w.at,
      proposal_id: x.proposal_id,
      ledger_id: ledgerId,
      req_sha256: x.hash,
      plan_id: x.plan_id,
    });
  store.finish(w.db, x.id, true, w.at, ran.result, ran.undo, null);
  w.change('verb', `verb:${x.id}`);
  return { ledgerId, ran };
}

/** A phone verb, from now on a phone's (or, for an intent, its app's) to claim: its `queued`
 * ledger row, which the phone's result replaces as the undo handle. */
export function queuePhone(w: Writer, c: Caller, x: Call): string {
  const ledgerId = w.ledger({
    kind: 'verb',
    actor: c.actor,
    session_id: c.session_id,
    what: `${x.verb} queued`,
    why: why(x),
    ref: x.ref ?? `verb:${x.id}`,
    verb_id: x.id,
    undoable: false,
    ...permitFields(x),
  });
  if (x.queued) store.release(w.db, x.id, ledgerId);
  else
    store.insert(w.db, {
      id: x.id,
      created_at: w.at,
      actor: c.actor,
      verb: x.verb,
      schema: x.schema,
      ref: x.ref,
      args_json: JSON.stringify(x.args),
      device_id: x.device_id,
      expires_at: x.expires_at ?? w.at + 24 * HOUR,
      proposal_id: x.proposal_id,
      ledger_id: ledgerId,
      req_sha256: x.hash,
      plan_id: x.plan_id,
    });
  w.change('verb', `verb:${x.id}`);
  return ledgerId;
}
