// Muse's side of work orders (docs/engineering/MUSE-PROTOCOL.md): Muse claims one at a time,
// posts progress lines (each one keeps its lease) and returns a result the Worker checks against the
// kind's schema before anyone sees it (a result that fails is named and Muse may send it again,
// three at most), or a failure; the owner or the mind cancels; each tick lapses a lease with no
// word for 30 minutes, expires an order past its deadline and closes a quiet upload batch. How an
// order is placed (the owner's `@muse`, the mind's PUT) is placed.ts; Muse's uploads are batch.ts.
// Every change writes the feed (`work`), so the chat mind's `th wait`, the menu's Tasks and the
// Briefing see it; an order asked for with `@muse` also tells its conversation (lines.ts);
// finishing writes one ledger row.

import {
  ASKED_KINDS,
  type MuseResult,
  WORK_KINDS,
  WORK_LIMITS,
  type WorkHello,
  type WorkKind,
} from '../../../../shared/contract/work.ts';
import { Fail } from '../../lib/result';
import { MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { chipPath } from '../conversation/ops';
import { getSetting, putSetting } from '../settings/store';
import { closeBatch } from './batch';
import { failedLine, LINES, say } from './lines';
import * as store from './store';
import { validate } from './validate';

const LEASE = WORK_LIMITS.lease_min * MINUTE;
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

/** The tick: upload batches 30 minutes quiet close as done; lapsed leases and deadlines. */
export function tick(w: Writer): void {
  for (const o of store.open(w.db)) {
    if (o.kind === 'muse.upload_batch') closeBatch(w, o);
    else if (o.deadline_at <= w.at) {
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
