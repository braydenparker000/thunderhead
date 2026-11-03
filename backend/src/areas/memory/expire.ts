// Outside facts nobody kept (MEMORY.md §6 M11g, PRIVACY.md §2; owner ruling 2026-11-03). A fact the
// Worker labelled `outside` waits for the owner's Keep under "Learned from outside"; one still
// waiting `OUTSIDE_KEEP_DAYS` after its version was written is dropped by the daily prune pass the
// way the owner's forget drops one (every version and its FTS entries go, the ids stay as
// tombstones, the memory ledger rows that pointed at it lose their words and their undo, a card
// naming it loses its words), with one ledger row that says how many, never which or what. Never
// dropped: a kept one (it is `owner` from then on), a lineage holding any version the owner or the
// events wrote, a pinned one, one the notebook import left for review (`imported`, MEMORY.md §14),
// and rows from before Core step 30 (no label). No surface can cite one (surfaces/ops.ts), so none
// has a slot to leave.
import { DAY } from '../../lib/time';
import type { Writer } from '../../objects/commit';
import { scrubMemory } from '../ledger/store';
import { forgotten } from '../proposals/scrub';
import * as store from './store';

/** How long an outside fact waits for the owner's Keep before the prune pass drops it: long enough
 * for the owner to come by Settings › Memory at their own pace, short enough that what nobody kept
 * does not sit in memory (and in every backup) for good. */
export const OUTSIDE_KEEP_DAYS = 90;
/** Lineages dropped in one pass at most; a longer list goes on the next tick. */
export const DROP_STEP = 200;

/** Drops the outside facts nobody kept in time; returns how many lineages went. */
export function dropUnkept(w: Writer, now: number, max = DROP_STEP): number {
  const due = w.db.all<{ id: string }>(
    `SELECT f.id FROM facts f INDEXED BY facts_outside
     WHERE f.superseded_at IS NULL AND f.provenance = 'outside' AND f.recorded_at < ? AND f.pinned = 0
       AND coalesce(f.tags_json, '') NOT LIKE '%"imported"%'
       AND NOT EXISTS (SELECT 1 FROM facts g WHERE g.lineage_id = f.lineage_id AND coalesce(g.provenance, '') != 'outside')
     LIMIT ?`,
    now - OUTSIDE_KEEP_DAYS * DAY,
    max,
  );
  if (!due.length) return 0;
  const rows = due.flatMap(({ id }) => store.lineage(w.db, id));
  store.deleteFacts(w.db, rows, w.at);
  const refs = rows.map((r) => `fact:${r.id}`);
  scrubMemory(w.db, refs, Math.min(...rows.map((r) => r.recorded_at)), 'dropped: nobody kept it');
  forgotten(
    w,
    rows.map((r) => r.id),
  );
  for (const ref of refs) w.change('fact', ref);
  w.ledger({
    kind: 'memory',
    actor: 'worker',
    what: `dropped ${due.length} outside fact${due.length === 1 ? '' : 's'} nobody kept`,
    why: `outside facts wait ${OUTSIDE_KEEP_DAYS} days for the owner's keep`,
    undoable: false,
  });
  return due.length;
}
