// Verbs (API.md §11.11): the mind queues one, a signed-in phone claims it, runs it and reports
// the result. Everything is checked against the contract (shared/contract/verbs.ts): the verb
// must exist and be queueable, its schema version known, its args and result valid. A phone that
// lacks the verb reports `unsupported_verb`; ask-first verbs need an approved proposal (P4).
import type { JsonObject, PutVerbRequest, Verb, VerbResultRequest } from '../../../../shared/contract/api';
import { latestVersion, verbSpec } from '../../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { HOUR } from '../../lib/time';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as ledger from '../ledger/store';
import * as store from './store';

export const CLAIM_MS = 120_000;
const MAX_CLAIMS = 3;

const issues = (path: string, e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  new Fail(
    'validation',
    e.issues.map((i) => ({ path: [path, ...i.path.map(String)].join('.'), issue: i.message })),
  );

export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutVerbRequest,
  reqHash: string,
): { verb: Verb; created: boolean } {
  const found = store.byId(w.db, id);
  if (found) {
    if (found.req_sha256 !== reqHash) throw new Fail('conflict');
    return { verb: store.toVerb(found), created: false };
  }
  const spec = verbSpec(r.verb);
  if (!spec) throw invalid('verb', 'unknown verb');
  if (!spec.queueable) throw invalid('verb', 'this verb runs only from an owner tap');
  const version = spec.versions[r.schema];
  if (!version) throw invalid('schema', `known versions: ${Object.keys(spec.versions).join(', ')}`);
  const args = version.args.safeParse(r.args);
  if (!args.success) throw issues('args', args.error);
  if (spec.class === 'ask_first') throw new Fail('proposal_required');
  if (r.expires_at !== undefined && (r.expires_at < w.at || r.expires_at > w.at + 7 * 24 * HOUR))
    throw invalid('expires_at', 'within the next 7 days');
  const ledgerId = w.ledger({
    kind: 'verb',
    actor: c.actor,
    session_id: c.session_id,
    what: `${r.verb} queued`,
    why: r.why,
    ref: r.ref ?? `verb:${id}`,
    verb_id: id,
    undoable: false,
  });
  store.insert(w.db, {
    id,
    created_at: w.at,
    actor: c.actor,
    verb: r.verb,
    schema: r.schema,
    ref: r.ref ?? null,
    args_json: JSON.stringify(args.data),
    device_id: r.device_id ?? null,
    expires_at: r.expires_at ?? w.at + 24 * HOUR,
    proposal_id: r.proposal_id ?? null,
    ledger_id: ledgerId,
    req_sha256: reqHash,
  });
  w.change('verb', `verb:${id}`);
  return { verb: store.toVerb(store.byId(w.db, id) as store.VerbRow), created: true };
}

/** Stale claims and expired verbs are settled lazily on every read and by the daily tick. */
export function settle(w: Writer): void {
  for (const id of [...store.releaseStale(w.db, w.at, CLAIM_MS, MAX_CLAIMS), ...store.expire(w.db, w.at)])
    w.change('verb', `verb:${id}`);
}

export function pending(w: Writer, deviceId: string): Verb[] {
  settle(w);
  return store.open(w.db, deviceId).map(store.toVerb);
}

export function claim(w: Writer, id: string, deviceId: string): Verb {
  settle(w);
  const v = store.byId(w.db, id);
  if (!v || (v.device_id !== null && v.device_id !== deviceId)) throw new Fail('not_found');
  if (v.status === 'expired') throw new Fail('expired');
  if (v.status === 'claimed' && v.claimed_by !== deviceId) throw new Fail('already_claimed');
  if (v.status !== 'pending' && v.status !== 'claimed') throw new Fail('already_decided');
  store.claim(w.db, id, deviceId, w.at);
  w.change('verb', `verb:${id}`);
  return store.toVerb(store.byId(w.db, id) as store.VerbRow);
}

export function result(w: Writer, id: string, deviceId: string, r: VerbResultRequest): Verb {
  const v = store.byId(w.db, id);
  if (!v || (v.device_id !== null && v.device_id !== deviceId)) throw new Fail('not_found');
  if (v.status === 'done' || v.status === 'failed') return store.toVerb(v);
  if (v.status === 'expired' || v.expires_at < w.at) throw new Fail('expired');
  const spec = verbSpec(v.verb);
  if (r.ok && spec) {
    const check = spec.versions[v.schema]?.result.safeParse(r.result ?? {});
    if (check && !check.success)
      throw new Fail(
        'invalid_result',
        check.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
      );
  }
  const undo = r.ok && spec?.undo === 'reported' && r.undo ? r.undo : null;
  if (undo) {
    const inv = verbSpec(undo.verb);
    if (!inv?.versions[undo.schema ?? latestVersion(inv)]?.args.safeParse(undo.args).success)
      throw invalid('undo', 'not a valid verb call');
  }
  store.finish(w.db, id, r.ok, w.at, r.result, undo, r.ok ? null : (r.error ?? { code: 'failed' }));
  if (v.ledger_id && !r.ok) {
    ledger.setStatus(w.db, v.ledger_id, 'failed', null);
    w.change('ledger', `ledger:${v.ledger_id}`);
  }
  // An inverse queued by an undo: the undone row becomes `undone` once the phone did it.
  if (r.ok && v.actor === 'worker' && v.ref?.startsWith('ledger:')) {
    ledger.setStatus(w.db, v.ref.slice('ledger:'.length), 'undone', w.at);
    w.change('ledger', v.ref);
  }
  w.ledger({
    kind: 'verb',
    actor: 'owner',
    what: `${v.verb} ${r.ok ? 'done' : `failed (${r.error?.code ?? 'failed'})`}`,
    why: `the phone ran a verb the mind queued (verb:${id})`,
    ref: `verb:${id}`,
    verb_id: id,
    undo: undo ? { verb: undo.verb, schema: undo.schema ?? 1, args: undo.args } : null,
    status: r.ok ? 'done' : 'failed',
  });
  w.change('verb', `verb:${id}`);
  return store.toVerb(store.byId(w.db, id) as store.VerbRow);
}

/** Undo of a phone action: queue its stored inverse, pointing at the ledger row it undoes. */
export function queueInverse(
  w: Writer,
  inverse: { verb: string; schema: number; args: JsonObject },
  ledgerId: string,
): string {
  const id = uuidv7(w.at);
  store.insert(w.db, {
    id,
    created_at: w.at,
    actor: 'worker',
    verb: inverse.verb,
    schema: inverse.schema,
    ref: `ledger:${ledgerId}`,
    args_json: JSON.stringify(inverse.args),
    device_id: null,
    expires_at: w.at + 24 * HOUR,
    proposal_id: null,
    ledger_id: null,
    req_sha256: null,
  });
  w.change('verb', `verb:${id}`);
  return id;
}
