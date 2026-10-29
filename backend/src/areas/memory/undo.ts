// Core-internal undo ops for memory (ledger/ops.ts dispatches by `op`, DATA.md §4.3). Like the
// surfaces' undo, only the newest state is taken back: a version that has been replaced since,
// or a loose end or day note changed since, answers 409 instead of overwriting what came after.
// A forgotten fact has no undo (its rows lost theirs when it was forgotten).
import { Fail } from '../../lib/result';
import type { Writer } from '../../objects/commit';
import * as notes from './notes';
import * as store from './store';

const newer = (what: string) => new Fail('conflict', { reason: `${what} changed since` });

function live(w: Writer, id: string): store.FactRow {
  const f = store.fact(w.db, id);
  if (!f) throw new Fail('not_found');
  return f;
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : null);

export const MEMORY_UNDO_OPS = [
  'memory.close',
  'memory.reopen',
  'memory.restore',
  'memory.flag',
  'open.restore',
  'day.restore',
];

export function undo(w: Writer, op: string, args: Args): void {
  switch (op) {
    case 'memory.close': {
      // The add: the fact stops being current (closed with no successor), so nothing reads it.
      const f = live(w, str(args.fact_id));
      if (f.superseded_at !== null) throw newer('the fact');
      store.closeFact(w.db, f.id, w.at, null, null);
      w.change('fact', `fact:${f.id}`);
      return;
    }
    case 'memory.reopen': {
      const fresh = live(w, str(args.new_id));
      const old = live(w, str(args.old_id));
      if (fresh.superseded_at !== null || old.superseded_by !== fresh.id) throw newer('the fact');
      store.closeFact(w.db, fresh.id, w.at, null, null);
      store.reopenFact(w.db, old.id, num(args.valid_to));
      w.change('fact', `fact:${fresh.id}`);
      w.change('fact', `fact:${old.id}`);
      return;
    }
    case 'memory.restore': {
      const f = live(w, str(args.fact_id));
      const confidence = num(args.confidence);
      const at = num(args.last_confirmed);
      if (confidence === null || at === null) throw new Fail('validation', { reason: 'not_undoable' });
      store.confirmFact(w.db, f.id, confidence, at);
      w.change('fact', `fact:${f.id}`);
      return;
    }
    case 'memory.flag': {
      const f = live(w, str(args.fact_id));
      const flag = args.flag === 'pinned' ? 'pinned' : args.flag === 'may_raise' ? 'may_raise' : null;
      if (!flag || typeof args.value !== 'boolean') throw new Fail('validation', { reason: 'not_undoable' });
      store.setFlag(w.db, f.id, flag, args.value);
      w.change('fact', `fact:${f.id}`);
      return;
    }
    case 'open.restore': {
      const id = str(args.id);
      const now = notes.openThread(w.db, id);
      if (!notes.sameThread(now, (args.after ?? null) as notes.OpenThreadRow | null)) throw newer('the loose end');
      const before = args.before as notes.OpenThreadRow | null | undefined;
      if (before) notes.putOpenThread(w.db, before);
      else notes.deleteOpenThread(w.db, id);
      w.change('open_thread', `open:${id}`);
      return;
    }
    case 'day.restore': {
      const day = str(args.day);
      const now = notes.dayNote(w.db, day);
      if (!now || now.version !== num(args.version)) throw newer('the day note');
      const before = args.before as Omit<notes.DayNoteRow, 'seq'> | null | undefined;
      if (before) notes.putDayNote(w.db, { ...before, version: now.version + 1, written_at: w.at }, now);
      else notes.deleteDayNote(w.db, now);
      w.change('day_note', `day:${day}`);
      return;
    }
    default:
      throw new Fail('validation', { reason: 'not_undoable' });
  }
}
