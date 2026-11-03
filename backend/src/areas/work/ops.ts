// Work orders at work (docs/engineering/MUSE-PROTOCOL.md): an order is placed by the owner's
// `@muse` in the chat (their own act, never gated) or by the mind (`muse.order`, Ask by default);
// Muse claims one at a time, posts progress lines (each one keeps its lease) and returns a result
// the Worker checks against the kind's schema before anyone sees it (a result that fails is named
// and Muse may send it again, three at most), or a failure. Each tick lapses a lease with no word
// for 30 minutes, expires an order past its deadline and closes an upload batch 30 minutes after its
// last upload. Every change writes the feed (`work`), so the chat mind's `th wait`, the menu's Tasks
// and the Briefing see it; an order asked for with `@muse` also tells its conversation (lines.ts);
// finishing writes one ledger row.

import { neverStored } from '../../../../shared/contract/never-stored.ts';
import type { Permit } from '../../../../shared/contract/permits.ts';
import {
  ASKED_KINDS,
  hintOf,
  type MuseResult,
  WORK_KINDS,
  WORK_LIMITS,
  type WorkHello,
  type WorkKind,
  type WorkOrder,
  type WorkOrderPut,
} from '../../../../shared/contract/work.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { DAY, MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import { type Caller, isMind } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { chipPath } from '../conversation/ops';
import { answerOne } from '../conversation/store-threads';
import { claimedSession } from '../mind/guards';
import { gate, positionFor, withPermit } from '../mind/permit';
import { getSetting, putSetting } from '../settings/store';
import { failedLine, LINES, say, sayOnly } from './lines';
import { mentionWords } from './mention';
import * as store from './store';
import { validate } from './validate';

const LEASE = WORK_LIMITS.lease_min * MINUTE;
const GAP = WORK_LIMITS.batch_gap_min * MINUTE;
const SEEN_EVERY = 10 * MINUTE;

export interface Seen {
  first: number;
  last: number;
}
export const seen = (db: Db) => (getSetting(db, 'muse.seen') as Seen | undefined) ?? null;

const changed = (w: Writer, id: string) => w.change('work', `work:${id}`);
const ledger = (w: Writer, what: string, id: string) =>
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: what.slice(0, 300),
    why: 'a work order for Muse (MUSE-PROTOCOL.md)',
    ref: `work:${id}`,
    undoable: false,
  });
const reread = (w: Writer, id: string) => store.order(w.db, id) as store.OrderRow;

/** What a mind may send towards Muse: only from a claimed session of its role that has read no
 * outside content (an order reaches another agent), and nothing MEMORY.md §13 says is never
 * stored. The owner's device may always. */
export function toMuse(w: Writer, c: Caller, path: string, value: unknown): void {
  if (c.who !== 'D' && claimedSession(w.db, c.session_id, c.who === 'N' ? 'night' : 'chat').tainted)
    throw new Fail('session_tainted');
  if (neverStored(JSON.stringify(value))) throw invalid(path, 'never_stored');
}

/** The standing permission an order of `kind` is taken under: Muse orders, or, for a kind that
 * carries the owner's data, the reach-people floor (marked on the kind, `personal`). */
const orderAction = (kind: string) => (WORK_KINDS[kind as WorkKind]?.personal ? 'muse.order_personal' : 'muse.order');

/** PUT /v1/work/orders/:id from the mind. The same id with the same order again is fine. */
export function create(
  w: Writer,
  c: Caller,
  id: string,
  r: WorkOrderPut,
): { order: WorkOrder; created: boolean; permit?: Permit } {
  const had = store.order(w.db, id);
  if (had) {
    if (had.kind !== r.kind || had.title !== r.title) throw new Fail('conflict');
    // No ledger row keeps an order's permit: the position as it stands now.
    const action = orderAction(had.kind);
    const permit: Permit | null = isMind(c) ? { action, class: 'muse', position: positionFor(w.db, action) } : null;
    return { order: store.toOrder(had), created: false, ...(permit ? { permit } : {}) };
  }
  if (!(ASKED_KINDS as string[]).includes(r.kind)) throw invalid('kind', `one of ${ASKED_KINDS.join(', ')}`);
  toMuse(w, c, 'spec', [r.title, r.spec]);
  if (JSON.stringify(r.spec).length > WORK_LIMITS.spec_bytes)
    throw invalid('spec', `at most ${WORK_LIMITS.spec_bytes} bytes`);
  if (r.deadline_at <= w.at + 5 * MINUTE || r.deadline_at > w.at + WORK_LIMITS.deadline_days * DAY)
    throw invalid('deadline_at', `from 5 minutes to ${WORK_LIMITS.deadline_days} days from now`);
  // A card approves the kind, title and spec; the deadline is left out, so an order approved a
  // day later can still be sent with a deadline that is in the future then.
  const g = gate(w, c, orderAction(r.kind), { kind: r.kind, title: r.title, spec: r.spec }, `work:${id}`);
  store.insertOrder(w.db, {
    id,
    kind: r.kind,
    title: r.title,
    spec: r.spec,
    deadline_at: r.deadline_at,
    created_by: c.session_id ?? c.actor,
    at: w.at,
  });
  changed(w, id);
  return withPermit({ order: store.toOrder(reread(w, id)), created: true }, g);
}

/** The owner's first 60 characters of words, as the task's title. */
export function titleOf(words: string): string {
  const one = words.replace(/\s+/g, ' ').trim();
  return one.length <= WORK_LIMITS.title_words ? one : `${one.slice(0, WORK_LIMITS.title_words).trimEnd()}…`;
}

/** The owner's `@muse` (PUT /v1/messages/:id with `mention: 'muse'`, already stored and checked):
 * a `muse.request` with their words, made under their own authority (the owner's writes are never
 * gated), linked to the message, which this answers with the first line (lines.ts). Words holding
 * what never leaves make no order, and a line says why. */
export function fromMention(w: Writer, m: { id: string; body: string }): void {
  const words = (mentionWords(m.body) ?? m.body.trim()).slice(0, WORK_LIMITS.words);
  answerOne(w.db, m.id, w.at);
  if (neverStored(words)) {
    sayOnly(w, m.id, LINES.withheld);
    return;
  }
  const id = uuidv7(w.at);
  const app = hintOf(words);
  store.insertOrder(w.db, {
    id,
    kind: 'muse.request',
    title: titleOf(words),
    spec: { v: 1, words, ...(app ? { app } : {}) },
    deadline_at: w.at + WORK_LIMITS.deadline_days * DAY,
    created_by: 'owner',
    at: w.at,
    message_id: m.id,
  });
  changed(w, id);
  say(w, reread(w, id), 'asked');
}

/** POST /v1/work/orders/:id/cancel: the owner's (never gated) or the mind's taking back. */
export function cancel(w: Writer, id: string) {
  const o = store.order(w.db, id);
  if (!o) throw new Fail('not_found');
  if (!store.OPEN.includes(o.status)) throw new Fail('conflict', [{ path: 'status', issue: `it is ${o.status}` }]);
  store.setStatus(w.db, id, { status: 'cancelled', finished_at: w.at });
  changed(w, id);
  say(w, o, 'cancelled');
  return { status: 'cancelled' as const };
}

/** Each Muse call: when it was first and last seen (written at most every 10 min). */
export function touch(w: Writer): Seen {
  const s = seen(w.db);
  if (s && w.at - s.last < SEEN_EVERY) return s;
  const next = { first: s?.first ?? w.at, last: w.at };
  putSetting(w.db, 'muse.seen', next, 'muse', w.at);
  if (!s)
    w.ledger({
      kind: 'note',
      actor: 'muse',
      what: 'Muse called the new Worker for the first time',
      why: 'Muse connected to its work orders (MUSE-PROTOCOL.md)',
      ref: 'work:hello',
      undoable: false,
    });
  return next;
}

export function hello(w: Writer): WorkHello {
  touch(w);
  return {
    agent: 'muse',
    scopes: ['work.claim', 'work.result', 'work.thread'],
    server_time: w.at,
  };
}

/** POST /v1/work/claim: the one Muse holds, else the oldest queued one; null when none. */
export function claim(w: Writer) {
  touch(w);
  const holding = store.claimed(w.db);
  if (holding) return store.toOrder(holding);
  const o = store.nextQueued(w.db, w.at);
  if (!o) return null;
  store.setStatus(w.db, o.id, {
    status: 'claimed',
    claimed_at: w.at,
    heartbeat_at: w.at,
    heartbeat_note: null,
    attempts: o.attempts + 1,
    invalid: 0,
  });
  changed(w, o.id);
  say(w, o, 'picked_up');
  return store.toOrder(reread(w, o.id));
}

/** The order Muse holds: its own, of a kind it claims, and claimed (a cancelled one answers 409). */
const held = (w: Writer, id: string) => {
  const o = store.order(w.db, id);
  if (o?.assignee !== 'muse' || !(ASKED_KINDS as string[]).includes(o.kind)) throw new Fail('not_found');
  if (o.status !== 'claimed') throw new Fail('conflict', [{ path: 'status', issue: `it is ${o.status}, not claimed` }]);
  return o;
};

/** A heartbeat, or a progress line (`note` from Muse's thread): the lease runs 30 minutes from now,
 * and the order is working. */
export function heartbeat(w: Writer, id: string, note: string | null) {
  touch(w);
  const o = held(w, id);
  store.setStatus(w.db, id, {
    status: 'claimed',
    heartbeat_at: w.at,
    heartbeat_note: note === null ? o.heartbeat_note : note.slice(0, WORK_LIMITS.heartbeat_note),
  });
  changed(w, id);
  say(w, o, 'working');
  return { lease_until: w.at + LEASE };
}

/** What the schema can't say: an `open` path stays inside its app's folder (as a chip's must). */
function kindProblems(value: unknown): string[] {
  const open = (value as MuseResult).open;
  return open && chipPath(open.app, open.path) === null ? [`open.path: a path inside ${open.app}'s folder`] : [];
}

/** PUT /v1/work/orders/:id/result: valid → done (and its conversation hears it); invalid → 422
 * with every problem named, and the order stays Muse's to send again, until the third. */
export function result(w: Writer, id: string, raw: unknown) {
  touch(w);
  const o = held(w, id);
  const checked = validate(raw, WORK_KINDS[o.kind as WorkKind].schema);
  const problems = checked.problems.length ? checked.problems : kindProblems(checked.value);
  if (problems.length) {
    const tries = o.invalid + 1;
    const last = tries >= WORK_LIMITS.results;
    store.setStatus(w.db, id, {
      status: last ? 'rejected' : 'claimed',
      invalid: tries,
      result_valid: 0,
      result_errors_json: JSON.stringify(problems),
      ...(last ? { finished_at: w.at } : { heartbeat_at: w.at }),
    });
    changed(w, id);
    if (last) {
      ledger(w, `Muse's result for "${o.title}" was rejected: ${problems.length} problems (${problems[0]})`, id);
      say(w, o, 'failed', { detail: LINES.rejected });
    }
    return { ok: false as const, problems, left: WORK_LIMITS.results - tries };
  }
  store.setStatus(w.db, id, {
    status: 'done',
    result_json: JSON.stringify(checked.value),
    result_valid: 1,
    result_errors_json: null,
    finished_at: w.at,
  });
  changed(w, id);
  ledger(w, `Muse finished "${o.title}"`, id);
  say(w, o, 'done', { result: checked.value as MuseResult });
  return { ok: true as const };
}

/** POST /v1/work/orders/:id/fail: final, with Muse's reason in its conversation; with `retry`
 * (something that may work later) back to the queue while it has tries left. */
export function fail(w: Writer, id: string, reason: string, retry = false) {
  touch(w);
  const o = held(w, id);
  const status = retry && o.attempts < WORK_LIMITS.attempts ? 'queued' : 'failed';
  store.setStatus(w.db, id, {
    status,
    claimed_at: null,
    heartbeat_at: null,
    heartbeat_note: reason.slice(0, WORK_LIMITS.heartbeat_note),
    ...(status === 'failed' ? { finished_at: w.at } : {}),
  });
  changed(w, id);
  if (status === 'failed') {
    ledger(w, `"${o.title}" failed after ${o.attempts} tries: ${reason}`, id);
    say(w, o, 'failed', { detail: failedLine(reason) });
  }
  return { status };
}

/** Songs Muse registered through its signed upload route (areas/music/upload.ts): added to the
 * open upload batch, or a new one. `artists` are short hashes of the artists' names, kept only to
 * count them; no name is stored here. */
export function uploaded(w: Writer, ids: string[], artists: string[]): void {
  if (!ids.length) return;
  let o = store.openBatch(w.db);
  if (!o) {
    const id = uuidv7(w.at);
    store.insertOrder(w.db, {
      id,
      kind: 'muse.upload_batch',
      title: 'Songs Muse uploaded',
      spec: { v: 1, words: 'Songs Muse uploaded through its own upload route.', artists: [] },
      deadline_at: w.at + WORK_LIMITS.deadline_days * DAY,
      created_by: 'muse',
      at: w.at,
      status: 'claimed',
    });
    o = reread(w, id);
  }
  const spec = JSON.parse(o.spec_json) as { artists?: string[] };
  const seenArtists = new Set(spec.artists ?? []);
  for (const a of artists) if (seenArtists.size < 500) seenArtists.add(a);
  const prev = o.result_json ? (JSON.parse(o.result_json) as MuseResult) : null;
  const result: MuseResult = {
    added: { songs: (prev?.added.songs ?? 0) + ids.length, artists: seenArtists.size },
    ids: [...(prev?.ids ?? []), ...ids].slice(0, 50),
    note: '',
    open: { app: 'music', path: '/music/' },
  };
  store.setStatus(w.db, o.id, {
    status: 'claimed',
    spec_json: JSON.stringify({ ...spec, artists: [...seenArtists] }),
    result_json: JSON.stringify(result),
    heartbeat_at: w.at,
    heartbeat_note: `${result.added.songs} so far`,
  });
  changed(w, o.id);
}

/** The tick: upload batches 30 minutes quiet close as done; lapsed leases and deadlines. */
export function tick(w: Writer): void {
  for (const o of store.open(w.db)) {
    if (o.kind === 'muse.upload_batch') {
      if ((o.heartbeat_at ?? 0) + GAP <= w.at || o.deadline_at <= w.at) {
        store.setStatus(w.db, o.id, {
          status: 'done',
          result_valid: 1,
          heartbeat_note: null,
          finished_at: Math.min(w.at, (o.heartbeat_at ?? w.at) + GAP),
        });
        changed(w, o.id);
      }
    } else if (o.deadline_at <= w.at) {
      store.setStatus(w.db, o.id, { status: 'expired', finished_at: w.at });
      changed(w, o.id);
      ledger(w, `"${o.title}" expired: not finished by its deadline`, o.id);
      say(w, o, 'failed', { detail: LINES.expired });
    } else if (o.status === 'claimed' && (o.heartbeat_at ?? 0) + LEASE <= w.at) {
      const status = o.attempts >= WORK_LIMITS.attempts ? 'failed' : 'queued';
      store.setStatus(w.db, o.id, {
        status,
        claimed_at: null,
        heartbeat_at: null,
        ...(status === 'failed' ? { finished_at: w.at } : {}),
      });
      changed(w, o.id);
      if (status === 'failed') say(w, o, 'failed', { detail: LINES.lapsed });
    }
  }
}
