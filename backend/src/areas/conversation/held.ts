// Held conversations: off the record and deleted (shared/contract/held.ts, NEXT-BATCH.md part 8,
// decisions.md 2026-11-01). SECURITY-RELEVANT: the rules that keep them out of memory and out of
// sight are here, each enforced by the Worker, never by the model:
//   - only the owner's device starts one off the record, deletes or restores (the routes are
//     device-only; each function checks again, so no verb, proposal or agent path can);
//   - a thread is "gone" once deleted or once its purge is due, and nobody reads a gone thread;
//   - the night and the reflex never read one off the record (only the owner and the chat mind
//     answering it); search, the briefing, backups and the export leave held threads out
//     (search.ts, mind/assemble.ts, held-store.ts `heldRows`);
//   - memory refuses any evidence in a held thread (`off_record_evidence`, `deleted_evidence`:
//     memory/validate.ts and notes-ops.ts call `messageHeld` / `threadHeld`);
//   - a message only enters a thread off the record when it is named, or when it answers one of its
//     messages, so an answer never lands in today's remembered thread, and none is FTS-indexed.
// The purge itself is purge.ts. SQL is in held-store.ts.
import type { Message, Thread } from '../../../../shared/contract/api';
import { type DeletedThread, HELD_LIMITS, type RestoredThread } from '../../../../shared/contract/held.ts';
import type { Who } from '../../../../shared/contract/routes.ts';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentDay } from './day';
import * as hs from './held-store';
import { dailyThread, thread as threadById } from './store';

export type HeldState = 'live' | 'off_record' | 'gone';

/** What a thread is to the rules at `now` (null: no such thread). */
export function stateOf(r: hs.HeldRow | null, now: number): HeldState | null {
  if (!r) return null;
  if (r.kind === 'deleted' || (r.purge_at !== null && r.purge_at <= now)) return 'gone';
  return r.kind === 'off_record' ? 'off_record' : 'live';
}

const owner = (c: Caller) => {
  if (c.who !== 'D') throw new Fail('forbidden');
};

/** Who may read a thread, its messages and its files: nobody a gone one; one off the record only
 * the owner and the chat mind (which answers it), never the night or the reflex. */
export function readable(who: Who, s: HeldState | null): boolean {
  if (s === null || s === 'gone') return false;
  return s === 'live' || who === 'D' || who === 'C';
}

export const threadReadable = (db: Db, who: Who, id: string, now: number) =>
  readable(who, stateOf(hs.heldRow(db, id), now));

/** A file's message decides (an upload no message took yet is its uploader's, as before). */
export const fileReadable = (db: Db, who: Who, messageId: string | null, now: number) =>
  messageId === null || readable(who, stateOf(hs.messageThread(db, messageId), now));

/** For memory's evidence checks (MEMORY.md §6): is this message in a held conversation? */
export function messageHeld(db: Db, messageId: string, now: number): 'off_record' | 'deleted' | null {
  const s = stateOf(hs.messageThread(db, messageId), now);
  return s === 'off_record' ? 'off_record' : s === 'gone' ? 'deleted' : null;
}

/** The same for a `thread:` ref (a loose end may cite a whole thread). */
export function threadHeld(db: Db, threadId: string, now: number): 'off_record' | 'deleted' | null {
  const s = stateOf(hs.heldRow(db, threadId), now);
  return s === 'off_record' ? 'off_record' : s === 'gone' ? 'deleted' : null;
}

/** Throws the code for a held thread: one off the record is never memory or read later. */
export function refuseHeld(db: Db, threadId: string | null | undefined, now: number): void {
  if (!threadId) return;
  const h = threadHeld(db, threadId, now);
  if (h === 'off_record') throw new Fail('off_record');
  if (h === 'deleted') throw new Fail('gone');
}

/** Which conversation off the record a message goes to, or null for today's thread. A thread is
 * named only by the owner or the chat mind, and only one off the record that is still live; a
 * message answering one of its messages goes there too, named or not; one answering a message of a
 * gone thread is refused. `target` is the message `reply_to` names. */
export function offRecordTarget(
  db: Db,
  c: Caller,
  named: string | null,
  target: Pick<Message, 'thread_id'> | null,
  now: number,
): string | null {
  if (named) {
    if (c.who !== 'D' && c.who !== 'C') throw new Fail('forbidden');
    const s = stateOf(hs.heldRow(db, named), now);
    if (s === null) throw new Fail('not_found');
    if (s === 'gone') throw new Fail('gone');
    if (s !== 'off_record') throw invalid('thread_id', 'only a conversation off the record is named');
    if (target && target.thread_id !== named) throw invalid('reply_to', 'not a message in that conversation');
    return named;
  }
  if (!target) return null;
  const s = stateOf(hs.heldRow(db, target.thread_id), now);
  if (s === 'gone') throw new Fail('gone');
  return s === 'off_record' ? target.thread_id : null;
}

/** After a message went into a thread off the record: its purge moves to 7 days from now. */
export const spoke = (w: Writer, threadId: string) => hs.movePurge(w.db, threadId, w.at + HELD_LIMITS.off_record_ms);

/** PUT /v1/threads/:id/off-record: a new conversation off the record under the phone's id; the
 * same id again answers it (a retry), another thread's id is a conflict. */
export function startOffRecord(w: Writer, c: Caller, id: string, tz: string): { thread: Thread; created: boolean } {
  owner(c);
  const r = hs.heldRow(w.db, id);
  if (r) {
    const s = stateOf(r, w.at);
    if (s === 'off_record') return { thread: threadById(w.db, id) as Thread, created: false };
    throw new Fail(s === 'gone' ? 'gone' : 'conflict');
  }
  hs.insertOffRecord(w.db, id, currentDay(w.db, tz, w.at), w.at, w.at + HELD_LIMITS.off_record_ms);
  w.change('thread', `thread:${id}`);
  return { thread: threadById(w.db, id) as Thread, created: true };
}

/** DELETE /v1/threads/:id: hidden at once from the menu, search, the briefing and the mind; its
 * waiting messages settled; purged 30 days later (one off the record keeps its sooner 7 days).
 * Deleting today's daily thread frees the day's slot, so the next message starts a fresh today. */
export function remove(w: Writer, c: Caller, id: string): { id: string; purge_at: number } {
  owner(c);
  const r = hs.heldRow(w.db, id);
  const s = stateOf(r, w.at);
  if (!r || s === null) throw new Fail('not_found');
  if (s === 'gone') throw new Fail('gone');
  const purgeAt = Math.min(r.purge_at ?? Number.POSITIVE_INFINITY, w.at + HELD_LIMITS.deleted_ms);
  hs.markDeleted(w.db, id, w.at, purgeAt);
  hs.settleWaiting(w.db, id, w.at);
  w.ledger({
    kind: 'note',
    actor: 'owner',
    session_id: c.session_id,
    what: 'deleted a conversation (Recently deleted for 30 days)',
    why: 'the owner deleted it from the menu',
    ref: `thread:${id}`,
    undoable: false,
  });
  w.change('thread', `thread:${id}`);
  return { id, purge_at: purgeAt };
}

/** POST /v1/threads/:id/restore: back as it was. A daily thread whose day began a fresh one after
 * the delete comes back beside it, kind `restored` (the day keeps one daily thread); one of an
 * earlier day comes back filed. One off the record keeps its own 7 days. */
export function restore(w: Writer, c: Caller, id: string, tz: string): RestoredThread {
  owner(c);
  const r = hs.heldRow(w.db, id);
  if (r?.kind !== 'deleted') throw new Fail('not_found');
  if (r.purge_at !== null && r.purge_at <= w.at) throw new Fail('gone');
  let kind = r.kind_was ?? 'daily';
  let status = r.status;
  if (kind === 'daily' && dailyThread(w.db, r.day)) kind = 'restored';
  const earlier = kind === 'restored' || r.day < currentDay(w.db, tz, w.at);
  if (status === 'open' && (kind === 'daily' || kind === 'restored') && earlier) status = 'filed';
  hs.markRestored(w.db, id, {
    kind,
    status,
    filed_at: status === 'filed' ? w.at : null,
    purge_at: kind === 'off_record' ? r.purge_at : null,
    at: w.at,
  });
  w.ledger({
    kind: 'note',
    actor: 'owner',
    session_id: c.session_id,
    what: 'restored a conversation',
    why: 'the owner restored it from Recently deleted',
    ref: `thread:${id}`,
    undoable: false,
  });
  w.change('thread', `thread:${id}`);
  return { id, kind: kind as RestoredThread['kind'], beside: kind === 'restored' };
}

/** GET /v1/threads/deleted: Settings › Recently deleted. */
export const deleted = (db: Db, now: number): DeletedThread[] => hs.deletedPage(db, now, HELD_LIMITS.deleted_list);

/** The conversations off the record among these messages (the briefing and the live wait mark
 * them, so the chat mind answers and remembers nothing). */
export function offRecordOf(db: Db, messages: Pick<Message, 'thread_id'>[], now: number): string[] {
  return hs.offRecordAmong(db, [...new Set(messages.map((m) => m.thread_id))], now);
}

/** When the owner last spoke off the record (or started one), for the roll's quiet hour. */
export function lastOffRecordAt(db: Db): number | null {
  const p = hs.newestOffRecordPurge(db);
  return p === null ? null : p - HELD_LIMITS.off_record_ms;
}
