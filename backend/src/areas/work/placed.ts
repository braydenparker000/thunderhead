// How a work order is placed (MUSE-PROTOCOL.md): the owner's `@muse` in the chat, with their message
// (core.ts), under their own authority, never gated; or the mind's PUT /v1/work/orders/:id, under
// the standing permission `muse.order` (Ask by default: a card first) and only from a clean session.
// Neither sends on what MEMORY.md §13 says is never stored.

import type { Message } from '../../../../shared/contract/api';
import { neverStored } from '../../../../shared/contract/never-stored.ts';
import type { Permit } from '../../../../shared/contract/permits.ts';
import {
  ASKED_KINDS,
  hintOf,
  WORK_KINDS,
  WORK_LIMITS,
  type WorkKind,
  type WorkOrder,
  type WorkOrderPut,
} from '../../../../shared/contract/work.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { DAY, MINUTE } from '../../lib/time';
import { type Caller, isMind } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { messageById } from '../conversation/store';
import { answerOne } from '../conversation/store-threads';
import { claimedSession } from '../mind/guards';
import { gate, positionFor, withPermit } from '../mind/permit';
import { LINES, say, sayOnly } from './lines';
import { mentionWords } from './mention';
import * as store from './store';

const changed = (w: Writer, id: string) => w.change('work', `work:${id}`);
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
 * what never leaves make no order, and a line says why. Returns the message as it now stands. */
export function fromMention(w: Writer, m: Message): Message {
  const words = (mentionWords(m.body) ?? m.body.trim()).slice(0, WORK_LIMITS.words);
  answerOne(w.db, m.id, w.at);
  if (neverStored(words)) sayOnly(w, m.id, LINES.withheld);
  else {
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
  const {
    req_sha256: _h,
    session_id: _s,
    ...now
  } = messageById(w.db, m.id) as NonNullable<ReturnType<typeof messageById>>;
  return now;
}
