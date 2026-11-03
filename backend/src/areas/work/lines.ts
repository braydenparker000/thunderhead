// What the owner's conversation hears about an order they asked for with `@muse` (HOME.md §6.5,
// MUSE-PROTOCOL.md): one line per state it reaches, in order (asked → picked up → working → done,
// failed or cancelled; a step back to the queue says nothing and is not said again), posted by the
// Worker in the commit that changes the order, so it works while the mind sleeps. A line goes to
// today's conversation: the order's own while that day lasts, the next one once the day has rolled,
// so the news is where the owner looks. Done is Muse's own message (author `muse`, outside text)
// with an Open chip; the rest are system lines. An order the mind placed has no message and says
// nothing here: the mind reports it in its own words.
import type { Chip } from '../../../../shared/contract/api';
import { APPS, appBuilt } from '../../../../shared/contract/feed.ts';
import type { MuseResult, TaskState } from '../../../../shared/contract/work.ts';
import { uuidv7 } from '../../lib/ids';
import type { Writer } from '../../objects/commit';
import { ownerTz } from '../conversation/day';
import { today } from '../conversation/ops';
import * as convo from '../conversation/store';
import { type OrderRow, setSaid } from './store';

const RANK: Record<TaskState, number> = { asked: 0, picked_up: 1, working: 2, done: 3, failed: 3, cancelled: 3 };

/** The Worker's words, one per state (a failure's are Muse's own reason when it gave one). */
export const LINES = {
  asked: "Asked Muse. I'll tell you when it lands.",
  picked_up: 'Muse picked it up.',
  working: 'Muse is working on it.',
  cancelled: "Cancelled. Muse won't do it.",
  expired: "Muse didn't get to it in time.",
  lapsed: 'Muse stopped answering about it.',
  rejected: "Muse's answer didn't pass the checks, so I left it out.",
  /** An `@muse` whose words hold what never leaves (MEMORY.md §13): no order is made. */
  withheld: "I didn't ask Muse: that looks like a password or a key, and those stay here.",
} as const;

/** "Muse couldn't do it: <its reason>." */
export const failedLine = (reason: string) => {
  const r = reason.trim().replace(/\s+/g, ' ');
  return `Muse couldn't do it: ${r}${/[.!?]$/.test(r) ? '' : '.'}`;
};

const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;

/** "Muse added 41 songs from 3 artists." and Muse's note after it. */
export function doneLine(r: MuseResult): string {
  const a = r.added ?? {};
  const parts: string[] = [];
  if (a.songs) parts.push(a.artists ? `${n(a.songs, 'song')} from ${n(a.artists, 'artist')}` : n(a.songs, 'song'));
  else if (a.artists) parts.push(n(a.artists, 'artist'));
  if (a.episodes) parts.push(n(a.episodes, 'episode'));
  if (a.files) parts.push(n(a.files, 'file'));
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const head = what ? `Muse added ${what}.` : 'Muse is done.';
  const note = (r.note ?? '').trim().replace(/\s+/g, ' ');
  return note ? `${head} ${note}` : head;
}

/** The Open chip: where Muse said to look, else the app the words were about (the spec's hint). */
export function chipOf(r: MuseResult, hint: unknown): Chip | null {
  const open = r.open ?? (typeof hint === 'string' && appBuilt(hint) ? { app: hint, path: APPS[hint].path } : null);
  return open ? { label: `Open in ${APPS[open.app].name}`, app: open.app, path: open.path } : null;
}

/** Posts the line for `state` if the order's conversation hasn't heard it or a later one. `detail`
 * is a failure's words; `result` the done one's. */
export function say(w: Writer, o: OrderRow, state: TaskState, extra: { detail?: string; result?: MuseResult } = {}) {
  if (!o.message_id || (o.said && RANK[o.said] >= RANK[state])) return;
  const done = state === 'done' && extra.result ? extra.result : null;
  const spec = JSON.parse(o.spec_json) as { app?: unknown };
  const chip = done ? chipOf(done, spec.app) : null;
  const body = done
    ? doneLine(done)
    : state === 'failed'
      ? (extra.detail ?? LINES.expired)
      : state === 'done'
        ? 'Muse is done.'
        : LINES[state];
  const id = uuidv7(w.at);
  convo.insertMessage(w.db, {
    id,
    thread_id: today(w, ownerTz(w.db, 'UTC')).id,
    author: done ? 'muse' : 'system',
    origin: done ? 'muse' : 'system',
    kind: 'text',
    body,
    meta: { work: { id: o.id, state }, ...(chip ? { chip: { ...chip } } : {}) },
    reply_to: o.message_id,
    created_at: w.at,
    device_id: null,
    session_id: null,
    req_sha256: '',
  });
  setSaid(w.db, o.id, state);
  o.said = state;
  w.change('message', `msg:${id}`);
}

/** A line about an `@muse` that made no order (withheld words): it answers that message. */
export function sayOnly(w: Writer, messageId: string, body: string): void {
  const id = uuidv7(w.at);
  convo.insertMessage(w.db, {
    id,
    thread_id: today(w, ownerTz(w.db, 'UTC')).id,
    author: 'system',
    origin: 'system',
    kind: 'text',
    body,
    meta: { line: 'muse_withheld' },
    reply_to: messageId,
    created_at: w.at,
    device_id: null,
    session_id: null,
    req_sha256: '',
  });
  w.change('message', `msg:${id}`);
}
