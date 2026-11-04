// Watches (RUNTIME.md §3, shared/contract/watches.ts): `watch.set` and `watch.cancel` (run as
// Worker-side verbs, verbs.ts here), their undo, and what meets a live watch: an event (a sense in
// the phone's batch, or the Worker's own `reminder.fired`) or a change that settles its thing (a
// work order ended, a verb's result, a card decided, a prediction resolved). A met watch is
// `queued`; pulse.ts decides what it wakes. No class gates them (the mind's own bookkeeping): each
// fired wake counts against the owner's wake budget instead.
import type { ChangeKind } from '../../../../../shared/contract/feed.ts';
import { SENSE_TYPES, type SenseTypeSpec } from '../../../../../shared/contract/senses.ts';
import { WATCH_CHANGES, WATCH_EVENTS, WATCH_LIMITS, type WatchKind } from '../../../../../shared/contract/watches.ts';
import { Fail, invalid } from '../../../lib/result';
import { DAY } from '../../../lib/time';
import type { Db } from '../../../objects/base';
import type { Caller } from '../../../objects/caller';
import type { Writer } from '../../../objects/commit';
import * as proposals from '../../proposals/store';
import * as verbs from '../../verbs/store';
import * as work from '../../work/store';
import { claimedSession } from '../guards';
import { wakeBudget } from './pulse';
import * as store from './store';

export interface SetArgs {
  kind: WatchKind;
  at?: number;
  type?: string;
  ref?: string;
  why: string;
  note?: string;
}
export interface SetResult {
  watch_id: string;
  state: store.WatchRow['state'];
  until: number;
  [k: string]: string | number;
}

const AHEAD_MS = WATCH_LIMITS.ahead_days * DAY;
const roleOf = (c: Caller) => (c.who === 'N' ? 'night' : 'chat');
const changed = (w: Writer, id: string) => w.change('watch', `watch:${id}`);

/** Which fields go with which kind: a time with `at`, a sense type or a Worker event with `event`, a
 * change kind with `change`. */
function checkShape(a: SetArgs): void {
  if (a.kind === 'at') {
    if (a.at === undefined) throw invalid('args.at', 'required with kind at');
    if (a.type !== undefined || a.ref !== undefined) throw invalid('args.type', 'only with kind event or change');
    return;
  }
  if (a.at !== undefined) throw invalid('args.at', 'only with kind at');
  const known = a.kind === 'event' ? WATCH_EVENTS.includes(a.type ?? '') : Object.hasOwn(WATCH_CHANGES, a.type ?? '');
  if (!known)
    throw invalid(
      'args.type',
      a.kind === 'event' ? 'a sense type or reminder.fired' : 'work, verb, proposal or prediction',
    );
}

/** The ref a watch may name: an event's must be a kind its type carries (a sensitive type's ref never
 * reaches an agent, so none), a change's its own kind's (`verb:<id>` for `verb`). */
function checkRef(a: SetArgs): void {
  if (!a.ref || a.kind === 'at') return;
  const kind = a.ref.slice(0, a.ref.indexOf(':'));
  if (a.kind === 'change') {
    if (kind !== a.type) throw invalid('args.ref', `a ${a.type}:<id> ref`);
    return;
  }
  if (a.type === 'reminder.fired') {
    if (kind !== 'reminder') throw invalid('args.ref', 'a reminder:<id> ref');
    return;
  }
  const spec = (SENSE_TYPES as Record<string, SenseTypeSpec>)[a.type ?? ''];
  if (spec?.sensitivity === 1) throw invalid('args.ref', `${a.type} carries no ref an agent may see`);
  if (spec && !(spec.ref as readonly string[]).includes(kind))
    throw invalid('args.ref', spec.ref.length ? `a ${spec.ref.join(' or ')} ref` : `${a.type} carries no ref`);
}

/** `watch.set` from a claimed session of the caller's role (403 session_required), never one handed
 * a message off the record (its note would carry it on: 403 off_record). Its words are labelled
 * `outside` after outside text (MEMORY.md §6 M11), so a clean session's briefing keeps them back. */
export function set(w: Writer, c: Caller, id: string, a: SetArgs): SetResult {
  const g = claimedSession(w.db, c.session_id, roleOf(c));
  if (g.offRecord) throw new Fail('off_record');
  if (wakeBudget(w.db) === 0) throw invalid('args', 'watches are off: the owner set the wake budget to Off');
  if (store.countWaiting(w.db) >= WATCH_LIMITS.live)
    throw invalid('args', `at most ${WATCH_LIMITS.live} watches wait at once: cancel one first`);
  checkShape(a);
  let until = w.at + AHEAD_MS;
  if (a.kind === 'at') {
    const at = a.at ?? 0;
    if (at <= w.at) throw invalid('args.at', 'a time still to come');
    if (at > w.at + AHEAD_MS) throw invalid('args.at', `at most ${WATCH_LIMITS.ahead_days} days ahead`);
    until = at;
  }
  checkRef(a);
  store.insert(w.db, {
    id,
    kind: a.kind,
    fire_at: a.kind === 'at' ? (a.at ?? null) : null,
    type: a.kind === 'at' ? null : (a.type ?? null),
    ref: a.ref ?? null,
    why: a.why,
    note: a.note ?? null,
    outside: g.tainted ? 1 : 0,
    created_at: w.at,
    until,
    session_id: c.session_id,
  });
  changed(w, id);
  return { watch_id: id, state: 'live', until };
}

/** `watch.cancel`: a waiting watch (404 none, 410 expired once it fired, lapsed or was cancelled). */
export function cancel(w: Writer, id: string): SetResult {
  const r = store.byId(w.db, id);
  if (!r) throw new Fail('not_found', { reason: 'no such watch' });
  if (r.state !== 'live' && r.state !== 'queued') throw new Fail('expired', { reason: `it is ${r.state} already` });
  store.settle(w.db, id, 'cancelled', w.at);
  changed(w, id);
  return { watch_id: id, state: 'cancelled', until: r.until };
}

/** The stored inverses: a set watch cancelled while it still waits (409 once it fired), a cancelled
 * one waiting again while its time has not passed and fewer than 20 wait. */
export const WATCH_UNDO_OPS = ['watch.cancel', 'watch.revive'];
export function undo(w: Writer, op: string, args: Record<string, unknown>): void {
  const id = typeof args.id === 'string' ? args.id : '';
  const r = store.byId(w.db, id);
  if (op === 'watch.cancel') {
    if (r && (r.state === 'live' || r.state === 'queued')) cancel(w, id);
    else if (r?.state !== 'cancelled') throw new Fail('conflict', { reason: `the watch is ${r?.state ?? 'gone'}` });
    return;
  }
  if (r?.state !== 'cancelled' || r.until <= w.at || store.countWaiting(w.db) >= WATCH_LIMITS.live)
    throw new Fail('conflict', { reason: 'the watch can no longer wait' });
  store.revive(w.db, id);
  changed(w, id);
}

/** Marks the live event watches these events meet (one indexed read): a watch's type, its ref when
 * it names one, and an event no older than the watch. Returns how many it met. */
export function matchEvents(w: Writer, events: { type: string; ref: string | null; at: number }[]): number {
  let n = 0;
  for (const r of store.liveOn(w.db, 'event', [...new Set(events.map((e) => e.type))])) {
    const e = events.find((x) => x.type === r.type && (r.ref === null || r.ref === x.ref) && x.at >= r.created_at);
    if (!e) continue;
    store.met(w.db, r.id, w.at, e.ref);
    changed(w, r.id);
    n++;
  }
  return n;
}

/** Whether a change's thing has settled: a work order ended, a verb's result (never a watch verb's
 * own, which is done in the commit that sets it), a card decided; a prediction's change is its
 * resolution. */
function settled(db: Db, kind: string, ref: string): boolean {
  const id = ref.slice(ref.indexOf(':') + 1);
  if (kind === 'verb') {
    const v = verbs.byId(db, id);
    return v !== null && (v.status === 'done' || v.status === 'failed') && !v.verb.startsWith('watch.');
  }
  if (kind === 'work') {
    const o = work.order(db, id);
    return o !== null && !work.OPEN.includes(o.status);
  }
  if (kind === 'proposal') return (proposals.byId(db, id)?.status ?? 'waiting') !== 'waiting';
  return kind === 'prediction';
}

/** Marks the live change watches a commit's changes meet (`made`, committed at `at`): its kind, its
 * ref when it names one, once the thing has settled. A watch set in that same commit is not met by it. */
export function matchChanges(w: Writer, made: { kind: ChangeKind; ref: string | null }[], at: number): number {
  const kinds = [...new Set(made.map((m) => m.kind))].filter((k) => Object.hasOwn(WATCH_CHANGES, k));
  const seen = new Map<string, boolean>();
  const isSettled = (kind: string, ref: string) => {
    const k = `${kind}|${ref}`;
    if (!seen.has(k)) seen.set(k, settled(w.db, kind, ref));
    return seen.get(k) === true;
  };
  let n = 0;
  for (const r of store.liveOn(w.db, 'change', kinds)) {
    if (r.created_at >= at) continue;
    const m = made.find(
      (x) => x.kind === r.type && x.ref !== null && (r.ref === null || r.ref === x.ref) && isSettled(x.kind, x.ref),
    );
    if (!m) continue;
    store.met(w.db, r.id, w.at, m.ref);
    changed(w, r.id);
    n++;
  }
  return n;
}
