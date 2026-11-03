// Verbs (API.md §11.11): the mind queues one; a Worker-side verb runs at once in that commit
// (worker.ts), a phone verb waits for a signed-in phone to claim it, run it and report the result.
// An intent (a phone verb whose state lives in an app that may be closed) waits for that app: home's
// loop never sees it, the app asks for its own when it opens (`pending(…, app)`). Everything is
// checked against the contract (shared/contract/verbs.ts): the verb must exist and be queueable,
// its schema version known, its args and result valid. A phone that lacks the verb reports
// `unsupported_verb`. The mind queues under its standing permissions (mind/permit.ts): an Ask
// class, or an ask-first verb's floor, needs an approved card. A mind's verb in a followed class
// that completes under tell or quiet gets one follow-up loose end (follow.ts).
import type { Actor, JsonObject, PutVerbRequest, Verb, VerbResultRequest } from '../../../../shared/contract/api';
import type { Permit } from '../../../../shared/contract/permits.ts';
import { latestVersion, VERBS, type VerbSpec, verbSpec } from '../../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as ledger from '../ledger/store';
import { gate, ledgerPermit } from '../mind/permit';
import { followThrough } from './follow';
import * as mixes from './mixes';
import * as store from './store';
import { runHere } from './worker';

export const CLAIM_MS = 120_000;
const MAX_CLAIMS = 3;

const issues = (path: string, e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  new Fail(
    'validation',
    e.issues.map((i) => ({ path: [path, ...i.path.map(String)].join('.'), issue: i.message })),
  );

/** What the route worked out before the commit: the songs a `music.play_mix` find picked (the Music
 * object answers finds, so it can't be asked from inside Core's transaction). */
export interface Prepared {
  refs?: string[];
}

export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutVerbRequest,
  reqHash: string,
  zone: () => string = () => 'UTC',
  prepared: Prepared = {},
): { verb: Verb; created: boolean; permit?: Permit } {
  const found = store.byId(w.db, id);
  if (found) {
    if (found.req_sha256 !== reqHash) throw new Fail('conflict');
    // The same call again: the permit it ran under, from its ledger row.
    return { verb: store.toVerb(found), created: false, ...permitOf(w.db, found) };
  }
  const spec = verbSpec(r.verb);
  if (!spec) throw invalid('verb', 'unknown verb');
  if (!spec.queueable) throw invalid('verb', 'this verb runs only from an owner tap');
  const version = spec.versions[r.schema];
  if (!version) throw invalid('schema', `known versions: ${Object.keys(spec.versions).join(', ')}`);
  const args = version.args.safeParse(r.args);
  if (!args.success) throw issues('args', args.error);
  if (r.expires_at !== undefined && (r.expires_at < w.at || r.expires_at > w.at + 7 * 24 * HOUR))
    throw invalid('expires_at', 'within the next 7 days');
  // The standing permission (an ask-first verb has a floor, so it always needs its card): what a
  // card approves is the verb, its schema and its args, not where it runs. A verb with no class
  // (`memory.note`, the owner's own words only) is not gated; its area checks the words.
  const g =
    spec.permit === null
      ? null
      : gate(w, c, r.verb, { schema: r.schema, args: args.data }, `verb:${id}`, r.proposal_id);
  if (spec.side === 'worker') return runHere(w, c, id, r, args.data as JsonObject, reqHash, g, zone);
  // What the phone runs: a mix or a find becomes its songs here (the phone has neither).
  const phoneArgs = r.verb === 'music.play_mix' ? songsFor(w, args.data as JsonObject, prepared) : args.data;
  const ledgerId = w.ledger({
    kind: 'verb',
    actor: c.actor,
    session_id: c.session_id,
    what: `${r.verb} queued`,
    why: r.why,
    ref: r.ref ?? `verb:${id}`,
    verb_id: id,
    undoable: false,
    ...ledgerPermit(g),
  });
  store.insert(w.db, {
    id,
    created_at: w.at,
    actor: c.actor,
    verb: r.verb,
    schema: r.schema,
    ref: r.ref ?? null,
    args_json: JSON.stringify(phoneArgs),
    device_id: r.device_id ?? null,
    expires_at: r.expires_at ?? w.at + 24 * HOUR,
    proposal_id: r.proposal_id ?? null,
    ledger_id: ledgerId,
    req_sha256: reqHash,
  });
  w.change('verb', `verb:${id}`);
  return {
    verb: store.toVerb(store.byId(w.db, id) as store.VerbRow),
    created: true,
    ...(g ? { permit: g.permit } : {}),
  };
}

/** `music.play_mix`'s songs for the phone: a saved mix's (not found: 404), the find's the route ran,
 * or the ones given; with the place to start from. */
function songsFor(w: Writer, a: JsonObject, prepared: Prepared): JsonObject {
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

/** The permit a queued verb ran under, read back from its ledger row (a retry's answer). */
function permitOf(db: Db, v: store.VerbRow): { permit?: Permit } {
  const row = v.ledger_id ? ledger.byId(db, v.ledger_id) : null;
  const spec = verbSpec(v.verb);
  return row?.permit && spec?.permit ? { permit: { action: v.verb, class: spec.permit, position: row.permit } } : {};
}

/** Stale claims and expired verbs are settled lazily on every read and by the daily tick. */
export function settle(w: Writer): void {
  for (const id of [...store.releaseStale(w.db, w.at, CLAIM_MS, MAX_CLAIMS), ...store.expire(w.db, w.at)])
    w.change('verb', `verb:${id}`);
}

/** The intents (verbs.ts `intent`), by the app that applies them. */
const INTENTS: Record<string, string[]> = {};
for (const [name, v] of Object.entries(VERBS) as [string, VerbSpec][])
  if (v.intent) INTENTS[v.app] = [...(INTENTS[v.app] ?? []), name];
const ALL_INTENTS = Object.values(INTENTS).flat();

/** Open verbs for a device: without `app`, what home's own loop runs (never an intent); with it,
 * that app's pending intents, which it applies when it opens. */
export function pending(w: Writer, deviceId: string, app?: string): Verb[] {
  settle(w);
  const only = app === undefined ? { not: ALL_INTENTS } : { in: INTENTS[app] ?? [] };
  return store.open(w.db, deviceId, only).map(store.toVerb);
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

export function result(
  w: Writer,
  id: string,
  deviceId: string,
  r: VerbResultRequest,
  zone: () => string = () => 'UTC',
): Verb {
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
  // The outcome is the action of whoever queued it (the phone only ran it), and its row is the
  // verb's undo handle from now on: it keeps the permit the queued row ran under.
  const queued = v.ledger_id ? ledger.byId(w.db, v.ledger_id) : null;
  const outcome = w.ledger({
    kind: 'verb',
    actor: v.actor as Actor,
    session_id: null,
    what: `${v.verb} ${r.ok ? 'done' : `failed (${r.error?.code ?? 'failed'})`}`,
    why: `the phone ran a verb that was queued (verb:${id})`,
    ref: `verb:${id}`,
    verb_id: id,
    undo: undo ? { verb: undo.verb, schema: undo.schema ?? 1, args: undo.args } : null,
    status: r.ok ? 'done' : 'failed',
    permit: queued?.permit ?? null,
  });
  store.setLedger(w.db, id, outcome);
  w.change('verb', `verb:${id}`);
  // A mind's verb the phone did, under tell or quiet (an inverse the Worker queued has no permit).
  if (r.ok && queued?.permit && queued.permit !== 'ask')
    followThrough(w, { verb: v.verb, why: queued.why, position: queued.permit }, outcome, zone);
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

/** The inverse queued for a ledger row and not run yet, if any (open verbs only, so few rows). */
export function openInverse(db: Db, ledgerId: string): store.VerbRow | null {
  return store.openByRef(db, `ledger:${ledgerId}`);
}

/** An inverse's own undo row, so asking again returns the same one. */
export function linkInverse(db: Db, verbId: string, undoLedgerId: string): void {
  store.setLedger(db, verbId, undoLedgerId);
}
