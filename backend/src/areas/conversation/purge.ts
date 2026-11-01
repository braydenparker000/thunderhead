// The purge of held conversations (held.ts): off the record 7 days after the last message, deleted
// 30 days after the delete. Run by the cron's prune pass (objects/core-held.ts), each tick, in
// steps of at most HELD_LIMITS.purge_messages messages, and never while the rows guard holds the
// heavy work (from 80% of the day's budget, until 00:00 UTC). A thread whose purge is due is gone
// from every read and refuses every write at once (held.ts `stateOf`); the purge makes it so on disk.
// A step: `plan` reads what is due and the bucket keys of its messages' files; the object deletes
// those bytes; then one commit (`apply`) deletes the messages (with their FTS entries when they were
// indexed), the files' rows and the evidence links (memory/unlink.ts), and once a thread has no
// message left, the thread, the mind's session notes about it, an FTS optimize (so the words leave
// the index segments) and a ledger row with no content. Facts keep their text and day notes stay
// (What I remember, where the owner can fix or forget them). Bytes go before rows, so the bucket
// never keeps a file no row names.
import { HELD_LIMITS } from '../../../../shared/contract/held.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as files from '../files/store';
import { unlinkEvidence } from '../memory/unlink';
import { deleteThreadNotes } from '../mind/notes';
import * as hs from './held-store';

export interface PurgeStep {
  thread: string;
  /** What it was when due: the ledger says which, never what was in it. */
  was: 'off_record' | 'deleted';
  /** Its messages have FTS entries (every kind but off the record). */
  indexed: boolean;
  messages: hs.PurgeMessage[];
  files: { id: string; key: string }[];
}

const FILE_REF = /^file:([0-9a-f-]{36})$/;

/** The file ids a message carries (`attachments_json`, API.md §2 `Attachment`). */
function fileIds(m: hs.PurgeMessage): string[] {
  if (!m.attachments_json) return [];
  try {
    const list = JSON.parse(m.attachments_json) as { ref?: unknown }[];
    return list.map((a) => FILE_REF.exec(String(a?.ref ?? ''))?.[1]).filter((id): id is string => !!id);
  } catch {
    return [];
  }
}

/** The steps due now, at most `max` messages in all, oldest due first. A due thread with no
 * message left is a step of its own (it only needs its row deleted). */
export function plan(db: Db, now: number, max: number = HELD_LIMITS.purge_messages): PurgeStep[] {
  const steps: PurgeStep[] = [];
  let left = max;
  for (const t of hs.due(db, now, 20)) {
    if (left <= 0) break;
    const messages = hs.firstMessages(db, t.id, left);
    left -= messages.length;
    const ids = messages.flatMap(fileIds);
    steps.push({
      thread: t.id,
      was: t.kind === 'off_record' ? 'off_record' : 'deleted',
      indexed: (t.kind === 'deleted' ? t.kind_was : t.kind) !== 'off_record',
      messages,
      files: files.byIds(db, ids).map((f) => ({ id: f.id, key: f.key })),
    });
  }
  return steps;
}

/** One step's rows, in the caller's commit, after the files' bytes left the bucket. Returns
 * whether the thread is gone now. */
export function apply(w: Writer, s: PurgeStep): boolean {
  hs.deleteMessages(w.db, s.messages, s.indexed);
  files.remove(
    w.db,
    s.files.map((f) => f.id),
  );
  unlinkEvidence(w.db, new Set(s.messages.map((m) => `msg:${m.id}`)));
  if (hs.hasMessages(w.db, s.thread)) return false;
  hs.deleteThread(w.db, s.thread);
  deleteThreadNotes(w.db, s.thread);
  if (s.indexed) hs.optimizeFts(w.db);
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: s.was === 'off_record' ? 'purged a conversation off the record' : 'purged a deleted conversation',
    why:
      s.was === 'off_record'
        ? 'off the record: gone 7 days after its last message'
        : 'deleted 30 days ago: Recently deleted keeps one that long',
    ref: `thread:${s.thread}`,
    undoable: false,
  });
  w.change('thread', `thread:${s.thread}`);
  return true;
}
