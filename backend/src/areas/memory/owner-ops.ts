// The owner's own memory ops (MEMORY.md §3, §12): pin, "don't bring this up" and forget. Device
// only; each is one ledger row. Forget is the one hard delete in memory and has no undo.
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { scrubMemory } from '../ledger/store';
import { clearCiting } from '../surfaces/ops';
import { type Applied, current, short } from './fact-ops';
import * as store from './store';
import { type OpContext, owner, Reject } from './validate';

const FLAG_WORDS = {
  pinned: ['pinned', 'unpinned', 'the owner pinned it', 'the owner unpinned it'],
  may_raise: ['allowed', 'muted', 'the owner may hear about it again', 'the owner asked me not to bring it up'],
} as const;

export function flag(
  w: Writer,
  c: Caller,
  ctx: OpContext,
  id: string,
  which: 'pinned' | 'may_raise',
  on: boolean,
): Applied {
  owner(ctx);
  const f = current(ctx, id);
  const [yes, no, whyYes, whyNo] = FLAG_WORDS[which];
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `${on ? yes : no} a ${f.kind}`,
    why: on ? whyYes : whyNo,
    ref: short(f.id),
    undo: { op: 'memory.flag', args: { fact_id: f.id, flag: which, value: f[which] === 1 } },
  });
  store.setFlag(w.db, f.id, which, on);
  w.change('fact', short(f.id));
  // Muted: no surface may keep drawing on it (MEMORY.md §12).
  if (which === 'may_raise' && !on) clearCiting(w, c, [f.id], 'muted');
  return { fact_id: f.id, ledger_id: ledgerId };
}

/** The owner's forget (MEMORY.md §3): every version of the fact's lineage (even one an undo
 * unlinked) is deleted with its FTS entries, its id kept as a tombstone; the ledger rows that
 * pointed at them lose their words and their undo; surfaces citing them leave their slots; and
 * one tombstone ledger row remains: `{fact_id, kind, forgotten_at, versions}`, no text. Not
 * undoable. */
export function forget(w: Writer, c: Caller, ctx: OpContext, id: string): Applied {
  owner(ctx);
  const versions = store.lineage(ctx.db, id);
  if (!versions.length) throw new Reject('unknown_ref');
  const kind = versions[0].kind;
  store.deleteFacts(w.db, versions, w.at);
  clearCiting(
    w,
    c,
    versions.map((v) => v.id),
    'forgot',
  );
  scrubMemory(
    w.db,
    versions.map((v) => short(v.id)),
    Math.min(...versions.map((v) => v.recorded_at)),
  );
  const ledgerId = w.ledger({
    id: ctx.selfLedger,
    kind: 'memory',
    actor: c.actor,
    session_id: c.session_id,
    what: `forgot a ${kind}`,
    why: 'the owner forgot it',
    ref: short(id),
    undoable: false,
    op: { op: 'memory.forget', fact_id: id, kind, forgotten_at: w.at, versions: versions.length },
  });
  for (const v of versions) w.change('fact', short(v.id));
  return { fact_id: id, ledger_id: ledgerId };
}
