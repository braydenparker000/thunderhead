// Surfaces (API.md §11.12): the mind places a versioned kind in an app's slot, validated against
// the contract (shared/contract/surfaces.ts); every write and delete is a ledger row whose undo
// restores what was there. A topic the owner dismissed stays quiet for 14 days (409 nudge_repeat), a
// topic passed over three times in a row rests for 30 (422 topic_quiet, insight/topics.ts), the
// owner's speech setting may hold a line or a tile back (422 speech_budget, mind/speech.ts), and a
// surface may not draw on a fact the owner muted (422 muted_fact), nor on one labelled outside
// that the owner has not kept (422 outside_fact, MEMORY.md §6 M11b). The mind places one under
// its standing permission for lines and tiles (mind/permit.ts); clearing one only takes back what
// the mind placed, so it is never gated.
import type { Permitted, PutSurfaceRequest, Surface } from '../../../../shared/contract/api';
import { surfaceKind } from '../../../../shared/contract/surfaces.ts';
import { Fail, invalid } from '../../lib/result';
import { ownerDay } from '../../lib/time';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { scrubArrangements, scrubUndo } from '../ledger/store';
import { factFlags, provenanceOf } from '../memory/store';
import { gate, ledgerPermit, withPermit } from '../mind/permit';
import { asked, speechGate } from '../mind/speech';
import * as store from './store';

const QUIET_MS = 14 * 86_400_000;
const UNDO_WINDOW_MS = 30 * 86_400_000;

export function put(
  w: Writer,
  c: Caller,
  app: string,
  slot: string,
  r: PutSurfaceRequest,
  tz = 'UTC',
): Permitted<Surface> {
  const kind = surfaceKind(r.kind);
  if (!kind) throw invalid('kind', 'unknown surface kind');
  const slots = Object.hasOwn(kind.slots, app) ? (kind.slots as Record<string, RegExp>)[app] : undefined;
  if (!slots?.test(slot)) throw invalid('slot', `${r.kind} lives in ${Object.keys(kind.slots).join(', ')}`);
  const schema = kind.versions[r.schema];
  if (!schema) throw invalid('schema', `known versions: ${Object.keys(kind.versions).join(', ')}`);
  const payload = schema.safeParse(r.payload);
  if (!payload.success)
    throw new Fail(
      'validation',
      payload.error.issues.map((i) => ({ path: ['payload', ...i.path.map(String)].join('.'), issue: i.message })),
    );
  const cites = drawsOn(w, r);
  const topic = store.topicState(w.db, r.topic_key);
  if (topic?.ignored_at != null && w.at - topic.ignored_at < QUIET_MS) throw new Fail('nudge_repeat');
  if (topic?.quiet_until != null && topic.quiet_until > w.at)
    throw new Fail('topic_quiet', { until: topic.quiet_until, reopens: ownerDay(topic.quiet_until, tz) });
  if (r.expires_at !== undefined && r.expires_at <= w.at) throw invalid('expires_at', 'in the future');
  // A home line is the voice ladder's rung 2; a tile only "silent" holds back.
  const wasAsked = asked(w.db, c, r.asked_by, w.at);
  speechGate(w.db, c, app === 'home' ? 'line' : 'tile', wasAsked, w.at, tz);
  const askedBy = wasAsked ? (r.asked_by ?? null) : null;
  // Lines and tiles: what a card approves is the slot and what goes in it, not the why.
  const g = gate(
    w,
    c,
    'surface.put',
    { app, slot, kind: r.kind, schema: r.schema, payload: payload.data },
    `app:${app}#${slot}`,
  );
  const before = store.get(w.db, app, slot);
  const ledgerId = w.ledger({
    kind: 'arrangement',
    actor: c.actor,
    session_id: c.session_id,
    what: `${app}/${slot} ← ${r.kind}`,
    why: r.why,
    ref: r.ref ?? null,
    topic_key: r.topic_key,
    undo: before
      ? { op: 'surface.restore', args: { app, slot, row: before, was: 'put' } }
      : { op: 'surface.delete', args: { app, slot, was: 'put' } },
    // The facts it drew on, so forgetting one can find this row and take its words (never shown),
    // and the owner's message that asked for it (outside what the speech setting counts).
    op:
      cites.length || askedBy
        ? { op: 'surface.put', ...(cites.length ? { facts: cites } : {}), ...(askedBy ? { asked_by: askedBy } : {}) }
        : null,
    ...ledgerPermit(g),
  });
  w.change('surface', `app:${app}#${slot}`);
  store.put(w.db, {
    app,
    slot,
    kind: r.kind,
    schema: r.schema,
    payload_json: JSON.stringify({ v: r.schema, ...(payload.data as object) }),
    why: r.why,
    topic_key: r.topic_key,
    ref: r.ref ?? null,
    expires_at: r.expires_at ?? null,
    written_at: w.at,
    actor: c.actor,
    ledger_id: ledgerId,
    seq: w.seq,
    facts_json: cites.length ? JSON.stringify(cites) : null,
  });
  store.topicShown(w.db, r.topic_key, w.at);
  return withPermit(store.toSurface(store.get(w.db, app, slot) as store.SurfaceRow), g);
}

/** The facts a surface cites (its `facts`, and a `fact:` ref): each must exist, and none may be
 * muted (`may_raise = 0`, MEMORY.md §12), private (sensitivity 1, PRIVACY.md §4) or labelled
 * `outside` (M11b: outside text reaches no home line or push until the owner keeps it). */
function drawsOn(w: Writer, r: PutSurfaceRequest): string[] {
  const ids = new Set(Array.isArray(r.facts) ? r.facts : []);
  if (r.ref?.startsWith('fact:')) ids.add(r.ref.slice('fact:'.length));
  if (!ids.size) return [];
  const flags = factFlags(w.db, [...ids]);
  if (flags.length < ids.size) throw new Fail('validation', { reason: 'unknown_fact' });
  if (flags.some((f) => f.may_raise === 0)) throw new Fail('validation', { reason: 'muted_fact' });
  if (flags.some((f) => provenanceOf(f) === 'outside')) throw new Fail('validation', { reason: 'outside_fact' });
  if (flags.some((f) => f.sensitivity === 1)) throw new Fail('too_sensitive');
  return [...ids];
}

/** The owner muted or forgot facts: every surface citing one leaves its slot at once (one ledger
 * row each, no undo), and no arrangement row of the last 30 days (the undo window) keeps an undo
 * that would put one back. A forget also takes the words of every row that drew on the facts
 * since `since` (the lineage's first version): the put's `why` may quote what was forgotten.
 * Called by memory's owner ops. */
export function clearCiting(w: Writer, c: Caller, factIds: string[], why: 'muted' | 'forgot', since = w.at): void {
  const forgot = why === 'forgot' ? 'it drew on something the owner forgot' : null;
  for (const row of store.citing(w.db, factIds)) {
    // Its put, found by id (rows written before puts listed their facts, too).
    if (forgot && row.ledger_id) scrubArrangements(w.db, { id: row.ledger_id }, forgot);
    w.ledger({
      kind: 'arrangement',
      actor: c.actor,
      session_id: c.session_id,
      what: `${row.app}/${row.slot} cleared`,
      why: why === 'muted' ? 'it drew on something the owner muted' : 'it drew on something the owner forgot',
      topic_key: row.topic_key,
      undoable: false,
    });
    store.remove(w.db, row.app, row.slot);
    w.change('surface', `app:${row.app}#${row.slot}`);
  }
  if (forgot) scrubArrangements(w.db, { facts: factIds, since }, forgot);
  scrubUndo(w.db, factIds, w.at - UNDO_WINDOW_MS);
}

/** DELETE: the owner dismissing a surface also quiets its topic for 14 days. */
export function remove(w: Writer, c: Caller, app: string, slot: string): void {
  const before = store.get(w.db, app, slot);
  if (!before) return;
  w.ledger({
    kind: 'arrangement',
    actor: c.actor,
    session_id: c.session_id,
    what: `${app}/${slot} cleared`,
    why: c.who === 'D' ? 'the owner dismissed it' : 'the mind cleared it',
    topic_key: before.topic_key,
    undo: { op: 'surface.restore', args: { app, slot, row: before, was: 'clear' } },
  });
  store.remove(w.db, app, slot);
  if (c.who === 'D') store.topicIgnored(w.db, before.topic_key, w.at);
  w.change('surface', `app:${app}#${slot}`);
}

/** Core-internal undo ops for surfaces (ledger/ops.ts dispatches by `op`). Only the newest state
 * of a slot is undone: after a put, the slot must still hold that put; after a clear, it must
 * still be empty, so an older action never overwrites what came after it. */
export function undo(
  w: Writer,
  ledgerId: string,
  op: string,
  args: { app: string; slot: string; row?: store.SurfaceRow; was?: 'put' | 'clear' },
): void {
  if (op !== 'surface.delete' && !(op === 'surface.restore' && args.row))
    throw new Fail('validation', { reason: 'not_undoable' });
  const now = store.get(w.db, args.app, args.slot);
  const was = args.was ?? (op === 'surface.delete' ? 'put' : 'clear');
  if (was === 'put' ? now?.ledger_id !== ledgerId : now !== null)
    throw new Fail('conflict', { reason: 'a newer surface is in this slot' });
  w.change('surface', `app:${args.app}#${args.slot}`);
  if (op === 'surface.delete') store.remove(w.db, args.app, args.slot);
  else if (args.row) store.put(w.db, { ...args.row, written_at: w.at, seq: w.seq });
}
