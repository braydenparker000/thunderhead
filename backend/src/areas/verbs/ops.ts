// Verbs (API.md §11.11): the mind queues one; a Worker-side verb runs at once in that commit
// (worker.ts), a phone verb waits for a signed-in phone to claim it, run it and report the result.
// An intent (a phone verb whose state lives in an app that may be closed) waits for that app: home's
// loop never sees it, the app asks for its own when it opens (`pending(…, app)`). Everything is
// checked against the contract (shared/contract/verbs.ts): the verb must exist and be queueable,
// its schema version known, its args and result valid. A phone that lacks the verb reports
// `unsupported_verb`. The mind queues under its standing permissions (mind/permit.ts): an Ask
// class, or an ask-first verb's floor, needs an approved card. A mind's verb in a followed class
// that completes under tell or quiet gets one follow-up loose end (follow.ts). With `fire_at` it
// waits as a `scheduled` row and runs at that time (schedule.ts, due.ts); a plan's steps run
// through the same paths (run.ts, plan.ts).
import type { Actor, JsonObject, PutVerbRequest, Verb, VerbResultRequest } from '../../../../shared/contract/api';
import type { Permit, PermitPosition } from '../../../../shared/contract/permits.ts';
import { latestVersion, VERBS, type VerbSpec, verbSpec } from '../../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as ledger from '../ledger/store';
import { gate } from '../mind/permit';
import { speechGate } from '../mind/speech';
import { followThrough } from './follow';
import { lawGate } from './law';
import { type Call, type Prepared, phoneArgs, queuePhone, runWorker } from './run';
import * as schedule from './schedule';
import * as store from './store';

export const CLAIM_MS = 120_000;
const MAX_CLAIMS = 3;

const issues = (path: string, e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  new Fail(
    'validation',
    e.issues.map((i) => ({ path: [path, ...i.path.map(String)].join('.'), issue: i.message })),
  );

export type { Prepared } from './run';

export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutVerbRequest,
  reqHash: string,
  zone: () => string = () => 'UTC',
  prepared: Prepared = {},
): { verb: Verb; created: boolean; permit?: Permit; shifted?: boolean } {
  const found = store.byId(w.db, id);
  if (found) {
    if (found.req_sha256 !== reqHash) throw new Fail('conflict');
    // The same call again: the permit it ran under, from its ledger row (a scheduled one's own).
    const shifted =
      r.fire_at && found.fire_at !== null ? { shifted: schedule.fireMs(r.fire_at, zone()) !== found.fire_at } : {};
    return { verb: store.toVerb(found), created: false, ...permitOf(w.db, found), ...shifted };
  }
  const spec = verbSpec(r.verb);
  if (!spec) throw invalid('verb', 'unknown verb');
  if (!spec.queueable) throw invalid('verb', 'this verb runs only from an owner tap');
  const version = spec.versions[r.schema];
  if (!version) throw invalid('schema', `known versions: ${Object.keys(spec.versions).join(', ')}`);
  const args = version.args.safeParse(r.args);
  if (!args.success) throw issues('args', args.error);
  // Law 8: no verb reaches prayer, revelation, leaders, health or people (law.ts).
  lawGate(r.verb, r.why, args.data);
  // Later (schedule.ts): its time, checked and counted before the gate; music and podcasts wait out
  // quiet hours. A scheduled phone verb's expiry counts from when it fires.
  const tz = r.fire_at === undefined ? 'UTC' : zone();
  const requested = r.fire_at === undefined ? null : schedule.when(w, [r.verb], r.fire_at, tz);
  const fire = requested === null ? null : schedule.held(w, [r.verb], requested, tz);
  const from = fire ?? w.at;
  if (r.expires_at !== undefined && (r.expires_at < from || r.expires_at > from + 7 * 24 * HOUR))
    throw invalid('expires_at', fire === null ? 'within the next 7 days' : 'after fire_at, within 7 days of it');
  // The standing permission (an ask-first verb has a floor, so it always needs its card): what a
  // card approves is the verb, its schema and its args (and when it runs, for a scheduled one), not
  // where it runs. A verb with no class (`memory.note`, the owner's own words only) is not gated;
  // its area checks the words.
  const call = { schema: r.schema, args: args.data, ...(requested === null ? {} : { fire_at: requested }) };
  // The island line is unprompted speech: "silent" holds it back like a tile (mind/speech.ts).
  if (r.verb === 'island.show') speechGate(w.db, c, 'tile', false, w.at, zone());
  const g = spec.permit === null ? null : gate(w, c, r.verb, call, `verb:${id}`, r.proposal_id);
  const x: Call = {
    id,
    verb: r.verb,
    schema: r.schema,
    // What the phone runs: a mix or a find becomes its songs here (the phone has neither).
    args: spec.side === 'phone' ? phoneArgs(w, r.verb, args.data as JsonObject, prepared) : (args.data as JsonObject),
    why: r.why,
    ref: r.ref ?? null,
    device_id: r.device_id ?? null,
    position: g?.permit.position ?? null,
    proposal_id: r.proposal_id ?? null,
    card: g?.proposal_id ?? null,
    hash: reqHash,
    plan_id: null,
    expires_at: r.expires_at ?? null,
  };
  const permit = g ? { permit: g.permit } : {};
  if (fire !== null) {
    schedule.queue(w, c, x, spec.side, fire);
    const verb = store.toVerb(store.byId(w.db, id) as store.VerbRow);
    return { verb, created: true, ...permit, shifted: fire !== requested };
  }
  if (spec.side === 'worker') {
    const { ledgerId, ran } = runWorker(w, c, x, zone);
    // A verb that only records the owner's own words (its area's row: music.never) is not followed up.
    if (g && ran.undo && !ran.ledger_id)
      followThrough(w, { verb: r.verb, why: r.why, position: g.permit.position }, ledgerId, zone);
  } else queuePhone(w, c, x);
  return { verb: store.toVerb(store.byId(w.db, id) as store.VerbRow), created: true, ...permit };
}

/** The permit a queued verb ran under, read back from its ledger row, or a scheduled one's own (a
 * retry's answer). */
function permitOf(db: Db, v: store.VerbRow): { permit?: Permit } {
  const row = v.ledger_id ? ledger.byId(db, v.ledger_id) : null;
  const position = (row?.permit ?? v.permit) as PermitPosition | null;
  const spec = verbSpec(v.verb);
  return position && spec?.permit ? { permit: { action: v.verb, class: spec.permit, position } } : {};
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
  // A plan's step its undo took back before any phone claimed it stays taken back.
  if (v.status === 'done' || v.status === 'failed' || v.status === 'cancelled') return store.toVerb(v);
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
  // A mind's verb the phone did, under tell or quiet (an inverse the Worker queued has no permit); a
  // plan's step never on its own: the plan counted once when it ran (follow.ts `followPlan`).
  if (r.ok && queued?.permit && queued.permit !== 'ask' && !v.plan_id)
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
