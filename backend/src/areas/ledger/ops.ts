// The ledger's own routes (API.md §11.9): agents record actions taken outside the Worker, and any
// stored inverse can be undone. A Core-internal action (surfaces, memory, a Worker-side verb) is undone in the same
// transaction; a phone action is undone by queueing its inverse verb, and the row becomes
// `undone` when the phone reports that verb done. A plan's row is undone step by step, last first.
import type { JsonObject, LedgerEntry, PutLedgerRequest, UndoResponse } from '../../../../shared/contract/api';
import { Fail } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as memory from '../memory/undo';
import * as surfaces from '../surfaces/ops';
import * as verbs from '../verbs/ops';
import { undoPlan } from '../verbs/plan';
import { VERB_UNDO_OPS, undo as verbUndo } from '../verbs/undo';
import * as store from './store';

const UNDO_DAYS = 30;

export function put(w: Writer, c: Caller, id: string, r: PutLedgerRequest, reqHash: string) {
  const found = store.byId(w.db, id);
  if (found) {
    if (found.req_sha256 !== reqHash) throw new Fail('conflict');
    return { entry: strip(found), created: false };
  }
  w.ledger({
    id,
    kind: r.kind,
    actor: c.actor,
    session_id: c.session_id,
    what: r.what,
    why: r.why,
    ref: r.ref ?? null,
    topic_key: r.topic_key ?? null,
    undoable: false,
    req_sha256: reqHash,
  });
  return { entry: strip(store.byId(w.db, id) as store.Full), created: true };
}

function strip(f: store.Full): LedgerEntry {
  const { undo_json: _u, session_id: _s, verb_id: _v, req_sha256: _r, ...entry } = f;
  return entry;
}

/** `zone`: the owner's zone, read only when needed (a reminder moved back rings by the quiet hours again). */
export function undo(w: Writer, c: Caller, id: string, zone: () => string = () => 'UTC'): UndoResponse {
  const row = store.byId(w.db, id);
  if (!row) throw new Fail('not_found');
  if (c.who !== 'D' && row.actor !== c.actor)
    throw new Fail('forbidden', { reason: 'mind:chat undoes its own actions only' });
  if (row.status === 'undone') throw new Fail('already_undone');
  if (!row.undoable || !row.undo_json) throw new Fail('validation', { reason: 'not_undoable' });
  if (w.at - row.at > UNDO_DAYS * 86_400_000) throw new Fail('expired');
  const inverse = JSON.parse(row.undo_json) as { op?: string; args?: JsonObject; verb?: string; schema?: number };
  if (inverse.verb) {
    // Asked again while the phone hasn't run the first inverse: the same undo, not a second one.
    const queued = verbs.openInverse(w.db, id);
    if (queued)
      return {
        undo_ledger_id: queued.ledger_id ?? store.undoRowFor(w.db, queued.id, queued.created_at) ?? id,
        status: 'queued',
      };
    const verbId = verbs.queueInverse(
      w,
      { verb: inverse.verb, schema: inverse.schema ?? 1, args: inverse.args ?? {} },
      id,
    );
    const undoId = w.ledger({
      kind: 'undo',
      actor: c.actor,
      session_id: c.session_id,
      what: `undo ${row.what}`.slice(0, 200),
      why: `undo of ledger:${id}, waiting for the phone (verb:${verbId})`,
      ref: `ledger:${id}`,
      verb_id: verbId,
    });
    verbs.linkInverse(w.db, verbId, undoId);
    return { undo_ledger_id: undoId, status: 'queued' };
  }
  // A plan: each step's own undo, last first, through this same function (verbs/plan.ts).
  let status: UndoResponse['status'] = 'undone';
  if (inverse.op === 'plan.undo') status = undoPlan(w, inverse.args ?? {}, (step) => undo(w, c, step, zone));
  else if (inverse.op?.startsWith('surface.')) {
    const args = inverse.args as { app: string; slot: string; was?: 'put' | 'clear' };
    // Rows written before undo args carried `was`: the ledger line says which action it was.
    const was = args.was ?? (row.what.endsWith(' cleared') ? 'clear' : 'put');
    surfaces.undo(w, id, inverse.op, { ...args, was });
  } else if (inverse.op && memory.MEMORY_UNDO_OPS.includes(inverse.op)) memory.undo(w, inverse.op, inverse.args ?? {});
  // The Worker-side verbs' stored inverses (verbs/undo.ts).
  else if (inverse.op && VERB_UNDO_OPS.includes(inverse.op)) verbUndo(w, c.actor, inverse.op, inverse.args ?? {}, zone);
  else throw new Fail('validation', { reason: 'not_undoable' });
  store.setStatus(w.db, id, 'undone', w.at);
  const undoId = w.ledger({
    kind: 'undo',
    actor: c.actor,
    session_id: c.session_id,
    what: `undo ${row.what}`.slice(0, 200),
    why: `undo of ledger:${id}`,
    ref: `ledger:${id}`,
  });
  return { undo_ledger_id: undoId, status };
}
