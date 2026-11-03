// The verbs the Worker runs itself (`side: 'worker'` in shared/contract/verbs.ts, API.md §11.11): each
// through the owning area's own op, inside the commit that queues it and after its permit gate, so
// the verb is `done` at once and its ledger row keeps the inverse as `{op, args}` (undo.ts runs it;
// `th undo` and the phone's Undo need nothing else). An executor that changes nothing (the setting
// already holds the value, the episode was played) returns no undo. A refusal (a Fail) rolls the
// whole commit back: nothing is queued, nothing written, the card the gate took is not used.

import type { JsonObject, PutVerbRequest, Verb } from '../../../../shared/contract/api';
import { MUSIC_NEVER_SUBJECT } from '../../../../shared/contract/music.ts';
import type { Permit } from '../../../../shared/contract/permits.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { PINS_KEY, pinsOf, withPin } from '../briefing/pins';
import * as ledger from '../ledger/store';
import * as memory from '../memory/ops';
import { type Gated, ledgerPermit } from '../mind/permit';
import * as podcasts from '../podcasts/sync';
import * as reminders from '../reminders/ops';
import { mindSet, writeSetting } from '../settings/mind-set';
import { followThrough } from './follow';
import * as mixes from './mixes';
import * as store from './store';

export interface RunCtx {
  w: Writer;
  c: Caller;
  /** The verb's id (a mix keeps it as its own; memory's batch is named by it). */
  id: string;
  /** The request's canonical hash (memory's batch keeps it). */
  hash: string;
  /** The owner's zone, read only by a verb that needs it (a settings row read). */
  zone: () => string;
}

export interface Ran {
  result: JsonObject;
  /** The inverse the ledger row keeps; null when nothing changed, so there is nothing to undo. */
  undo: { op: string; args: JsonObject } | null;
  /** The area's own ledger row for the act (memory writes one, with its own undo): the verb's row. */
  ledger_id?: string;
}

type Args = Record<string, unknown>;
type Executor = (x: RunCtx, a: Args) => Ran;

/** A fact from the owner's own words, through memory's whole path (its batch, its session, taint
 * and off-the-record checks, M3's owner evidence, M4 and the laws pin for a rule). `labelled`: its
 * result says the label memory gave it (MEMORY.md §6 M11): from a session that read outside text a
 * note is `outside` and waits for the owner's keep (a rule from one is refused, `outside_rule`). */
function remember(x: RunCtx, op: JsonObject, labelled = false): Ran {
  const id = op.id as string;
  const out = memory.apply(x.w, x.c, `verb:${x.id}`, [op], x.hash);
  return {
    result: labelled ? { fact_id: id, provenance: out.applied[0].provenance } : { fact_id: id },
    undo: { op: 'memory.close', args: { fact_id: id } },
    ledger_id: out.applied[0].ledger_id,
  };
}

const pin =
  (on: boolean): Executor =>
  ({ w, c }, a) => {
    const next = withPin(pinsOf(w.db), a.tile as string, on);
    const was = writeSetting(w, c.actor, PINS_KEY, next);
    return { result: { pinned: next }, undo: was ? { op: 'setting.restore', args: { ...was } as JsonObject } : null };
  };

export const WORKER_VERBS: Record<string, Executor> = {
  'music.never': (x, a) =>
    remember(x, {
      op: 'add',
      id: uuidv7(x.w.at),
      kind: 'rule',
      subject: MUSIC_NEVER_SUBJECT,
      // The song by its ref and nothing else of it (MUSIC.md §10.5): find reads it from the text.
      text: `Never play ${a.ref as string} again.`,
      source: 'user',
      about: 'owner',
      evidence: a.evidence as string[],
    }),
  'memory.note': (x, a) =>
    remember(
      x,
      {
        op: 'add',
        id: uuidv7(x.w.at),
        kind: a.kind as string,
        ...(a.subject ? { subject: a.subject as string } : {}),
        text: a.text as string,
        source: 'user',
        about: 'owner',
        evidence: a.evidence as string[],
      },
      true,
    ),
  'music.mix_save': ({ w, c, id }, a) => {
    const refs = [...new Set(a.refs as string[])];
    mixes.insert(w.db, {
      id,
      name: (a.name as string).trim() || 'Mix',
      refs_json: JSON.stringify(refs),
      recipe: (a.recipe as string | undefined) ?? null,
      actor: c.actor,
      created_at: w.at,
    });
    return { result: { mix_id: id, tracks: refs.length }, undo: { op: 'mix.delete', args: { mix_id: id } } };
  },
  'podcasts.mark_played': ({ w }, a) => {
    const key = a.key as string;
    const done = podcasts.markPlayed(w, key);
    return {
      result: { played: true },
      undo: done ? { op: 'podcast.progress', args: { key, was: done.was, stamp: done.stamp } } : null,
    };
  },
  'reminder.move': ({ w, c, zone }, a) => {
    const m = reminders.move(w, c, a.id as string, a.at as number, a.source_message_id as string | undefined, zone());
    return {
      result: { at: m.at, fire_at: m.fire_at },
      undo: m.changed ? { op: 'reminder.move', args: { id: a.id as string, before: m.before, moved_to: m.at } } : null,
    };
  },
  'settings.set': ({ w, c }, a) => {
    if (!('value' in a)) throw invalid('args.value', 'required');
    const s = mindSet(w, c.actor, a.key as string, a.value);
    return {
      result: { previous: s.previous as JsonObject[string] },
      undo: s.was ? { op: 'setting.restore', args: { ...s.was } as JsonObject } : null,
    };
  },
  'briefing.pin_tile': pin(true),
  'briefing.unpin_tile': pin(false),
};

/** Runs a Worker-side verb; a verb the map lacks is a bug in the contract, not a refusal. */
export function runWorkerVerb(name: string, x: RunCtx, args: Args): Ran {
  const run = Object.hasOwn(WORKER_VERBS, name) ? WORKER_VERBS[name] : null;
  if (!run) throw new Fail('unavailable', { reason: `no Worker executor for ${name}` });
  return run(x, args);
}

/** A Worker-side verb, queued (verbs/ops.ts `put`): run through its area's op in this commit, after the gate, and
 * kept `done` at once with its result; its ledger row (the area's own, or one written here) holds
 * the inverse as `{op, args}`. A mind's verb in a followed class then gets its follow-up. */
export function runHere(
  w: Writer,
  c: Caller,
  id: string,
  r: PutVerbRequest,
  args: JsonObject,
  reqHash: string,
  g: Gated | null,
  zone: () => string,
): { verb: Verb; created: boolean; permit?: Permit } {
  const ran = runWorkerVerb(r.verb, { w, c, id, hash: reqHash, zone }, args);
  let ledgerId = ran.ledger_id ?? null;
  if (ledgerId) ledger.linkVerb(w.db, ledgerId, id, g?.permit.position ?? null, g?.proposal_id ?? null);
  else
    ledgerId = w.ledger({
      kind: 'verb',
      actor: c.actor,
      session_id: c.session_id,
      what: `${r.verb} done${ran.undo ? '' : ' (nothing changed)'}`,
      why: r.why,
      ref: r.ref ?? `verb:${id}`,
      verb_id: id,
      undo: ran.undo,
      ...ledgerPermit(g),
    });
  store.insert(w.db, {
    id,
    created_at: w.at,
    actor: c.actor,
    verb: r.verb,
    schema: r.schema,
    ref: r.ref ?? null,
    args_json: JSON.stringify(args),
    device_id: null,
    expires_at: w.at,
    proposal_id: r.proposal_id ?? null,
    ledger_id: ledgerId,
    req_sha256: reqHash,
  });
  store.finish(w.db, id, true, w.at, ran.result, ran.undo, null);
  w.change('verb', `verb:${id}`);
  // A verb that only records the owner's own words (its area's row: music.never) is not followed up.
  if (g && ran.undo && !ran.ledger_id)
    followThrough(w, { verb: r.verb, why: r.why, position: g.permit.position }, ledgerId, zone);
  return {
    verb: store.toVerb(store.byId(w.db, id) as store.VerbRow),
    created: true,
    ...(g ? { permit: g.permit } : {}),
  };
}
