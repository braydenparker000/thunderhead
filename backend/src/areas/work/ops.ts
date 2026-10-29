// Work orders at work (MUSE.md §3–§5, §9): the mind makes and cancels them; Muse claims one at a
// time, heartbeats it and returns a result the Worker checks against the kind's schema before
// anyone sees it (or a failure); each tick lapses a lease with no heartbeat for 30 min, expires an
// order past its deadline, and, once the owner allowed Muse to read the Board brief, makes the
// day's `board.edition` order, due 09:00 local. Every change writes the feed (`work`), so the
// chat mind's `th wait` and the Briefing page see it; finishing writes one ledger row.

import { neverStored } from '../../../../shared/contract/never-stored.ts';
import {
  WORK_KINDS,
  WORK_LIMITS,
  type WorkHello,
  type WorkKind,
  type WorkOrderPut,
} from '../../../../shared/contract/work.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { HOUR, MINUTE, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { claimedSession } from '../mind/guards';
import { getSetting, putSetting } from '../settings/store';
import * as store from './store';
import { validate } from './validate';

const LEASE = WORK_LIMITS.lease_min * MINUTE;
const [dueH, dueM] = WORK_LIMITS.board_due_local.split(':').map(Number);
const SEEN_EVERY = 10 * MINUTE;

export interface Seen {
  first: number;
  last: number;
}
export const seen = (db: Db) => (getSetting(db, 'muse.seen') as Seen | undefined) ?? null;
export const boardAllowed = (db: Db) => Boolean(getSetting(db, 'board.allowed'));
export const brief = (db: Db) =>
  (getSetting(db, 'board.brief') as { version: number; brief: unknown; updated_at: number } | undefined) ?? null;

const changed = (w: Writer, id: string) => w.change('work', `work:${id}`);
const ledger = (w: Writer, what: string, id: string) =>
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: what.slice(0, 300),
    why: 'a work order for Muse (MUSE.md §3)',
    ref: `work:${id}`,
    undoable: false,
  });

/** What a mind may send towards Muse: only from a claimed session of its role that has read no
 * outside content (an order or a brief reaches another agent), and nothing MEMORY.md §13 says is
 * never stored. The owner's device may always. */
export function toMuse(w: Writer, c: Caller, path: string, value: unknown): void {
  if (c.who !== 'D' && claimedSession(w.db, c.session_id, c.who === 'N' ? 'night' : 'chat').tainted)
    throw new Fail('session_tainted');
  if (neverStored(JSON.stringify(value))) throw invalid(path, 'never_stored');
}

/** PUT /v1/work/orders/:id from the mind. The same id with the same order again is fine. */
export function create(w: Writer, c: Caller, id: string, r: WorkOrderPut) {
  const had = store.order(w.db, id);
  if (had) {
    if (had.kind !== r.kind || had.title !== r.title) throw new Fail('conflict');
    return { order: store.toOrder(had), created: false };
  }
  if (!Object.hasOwn(WORK_KINDS, r.kind)) throw invalid('kind', `one of ${Object.keys(WORK_KINDS).join(', ')}`);
  toMuse(w, c, 'spec', [r.title, r.spec]);
  if (JSON.stringify(r.spec).length > WORK_LIMITS.spec_bytes)
    throw invalid('spec', `at most ${WORK_LIMITS.spec_bytes} bytes`);
  if (r.deadline_at <= w.at + 5 * MINUTE || r.deadline_at > w.at + 7 * 24 * HOUR)
    throw invalid('deadline_at', 'from 5 minutes to 7 days from now');
  store.insertOrder(w.db, {
    id,
    kind: r.kind,
    title: r.title,
    spec: r.spec,
    day: null,
    recurrence: null,
    deadline_at: r.deadline_at,
    created_by: c.session_id ?? c.actor,
    at: w.at,
  });
  changed(w, id);
  return { order: store.toOrder(store.order(w.db, id) as store.OrderRow), created: true };
}

export function cancel(w: Writer, id: string) {
  const o = store.order(w.db, id);
  if (!o) throw new Fail('not_found');
  if (!store.OPEN.includes(o.status)) throw new Fail('conflict', [{ path: 'status', issue: `it is ${o.status}` }]);
  store.setStatus(w.db, id, { status: 'cancelled', finished_at: w.at });
  changed(w, id);
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
      why: 'the switch from the old relay (MUSE.md §8 step 6)',
      ref: 'work:hello',
      undoable: false,
    });
  return next;
}

export function hello(w: Writer): WorkHello {
  touch(w);
  return {
    agent: 'muse',
    scopes: ['work.claim', 'work.result', 'work.thread', ...(boardAllowed(w.db) ? ['board.brief'] : [])],
    server_time: w.at,
    board_brief_allowed: boardAllowed(w.db),
  };
}

/** POST /v1/work/claim: the one Muse holds, else the oldest queued one; null when none. */
export function claim(w: Writer) {
  touch(w);
  const held = store.claimed(w.db);
  if (held) return store.toOrder(held);
  const o = store.nextQueued(w.db, w.at);
  if (!o) return null;
  store.setStatus(w.db, o.id, { status: 'claimed', claimed_at: w.at, heartbeat_at: w.at, attempts: o.attempts + 1 });
  changed(w, o.id);
  return store.toOrder(store.order(w.db, o.id) as store.OrderRow);
}

const held = (w: Writer, id: string) => {
  const o = store.order(w.db, id);
  if (o?.assignee !== 'muse') throw new Fail('not_found');
  if (o.status !== 'claimed') throw new Fail('conflict', [{ path: 'status', issue: `it is ${o.status}, not claimed` }]);
  return o;
};

export function heartbeat(w: Writer, id: string, note: string | null) {
  touch(w);
  held(w, id);
  store.setStatus(w.db, id, { status: 'claimed', heartbeat_at: w.at, heartbeat_note: note });
  return { lease_until: w.at + LEASE };
}

/** PUT /v1/work/orders/:id/result: valid → done; invalid → rejected, with every problem named. */
export function result(w: Writer, id: string, raw: unknown) {
  touch(w);
  const o = held(w, id);
  const { problems, value } = validate(raw, WORK_KINDS[o.kind].schema);
  if (!problems.length && o.kind === 'board.edition' && o.day && (value as { date?: string }).date !== o.day)
    problems.push(`date: must be ${o.day}, the day this edition is for`);
  if (problems.length) {
    store.setStatus(w.db, id, {
      status: 'rejected',
      result_valid: 0,
      result_errors_json: JSON.stringify(problems),
      finished_at: w.at,
    });
    changed(w, id);
    ledger(w, `Muse's result for "${o.title}" was rejected: ${problems.length} problems (${problems[0]})`, id);
    return { ok: false as const, problems };
  }
  store.setStatus(w.db, id, {
    status: 'done',
    result_json: JSON.stringify(value),
    result_valid: 1,
    result_errors_json: null,
    finished_at: w.at,
  });
  changed(w, id);
  ledger(w, `Muse finished "${o.title}"`, id);
  return { ok: true as const };
}

export function fail(w: Writer, id: string, reason: string) {
  touch(w);
  const o = held(w, id);
  const status = o.attempts >= WORK_LIMITS.attempts ? 'failed' : 'queued';
  store.setStatus(w.db, id, {
    status,
    claimed_at: null,
    heartbeat_at: null,
    heartbeat_note: reason.slice(0, WORK_LIMITS.heartbeat_note),
    ...(status === 'failed' ? { finished_at: w.at } : {}),
  });
  changed(w, id);
  if (status === 'failed') ledger(w, `"${o.title}" failed after ${o.attempts} tries: ${reason}`, id);
  return { status };
}

/** The tick: lapsed leases, deadlines, and the day's Board order. `day` is the logical day. */
export function tick(w: Writer, day: string, tz: string): void {
  for (const o of store.open(w.db)) {
    if (o.deadline_at <= w.at) {
      store.setStatus(w.db, o.id, { status: 'expired', finished_at: w.at });
      changed(w, o.id);
      ledger(w, `"${o.title}" expired: not finished by its deadline`, o.id);
    } else if (o.status === 'claimed' && (o.heartbeat_at ?? 0) + LEASE <= w.at) {
      const status = o.attempts >= WORK_LIMITS.attempts ? 'failed' : 'queued';
      store.setStatus(w.db, o.id, {
        status,
        claimed_at: null,
        heartbeat_at: null,
        ...(status === 'failed' ? { finished_at: w.at } : {}),
      });
      changed(w, o.id);
    }
  }
  if (!boardAllowed(w.db) || !brief(w.db) || store.forDay(w.db, 'board.edition', day).length) return;
  const due = zonedMinute(day, dueH * 60 + dueM, tz);
  if (due <= w.at + 30 * MINUTE) return;
  const id = uuidv7(w.at);
  store.insertOrder(w.db, {
    id,
    kind: 'board.edition',
    title: `The Board for ${day}`,
    spec: {
      v: 1,
      goal: `Write the Board for ${day} from the owner's Board brief.`,
      inputs: { day, brief: 'GET /v1/work/board/brief' },
      constraints: [
        'The Daily Board v2 edition format, exactly (the order schema).',
        `date is ${day}.`,
        'Primary sources first.',
      ],
      done_when: `A valid edition for ${day} is returned before ${WORK_LIMITS.board_due_local} local.`,
    },
    day,
    recurrence: `daily@${WORK_LIMITS.board_due_local}`,
    deadline_at: due,
    created_by: 'worker',
    at: w.at,
  });
  changed(w, id);
}

/** The Board edition for the Briefing page (BRIEFING.md §5): today's, else yesterday's marked
 * as such; none older. */
export function edition(db: Db, today: string, yesterday: string) {
  const t = store.latestDone(db, 'board.edition', [today]);
  if (t) return { row: t, stale: false };
  const y = store.latestDone(db, 'board.edition', [yesterday]);
  return y ? { row: y, stale: true } : null;
}

export const kindOf = (k: string): WorkKind | null => (Object.hasOwn(WORK_KINDS, k) ? (k as WorkKind) : null);
