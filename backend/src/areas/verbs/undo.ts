// The stored inverses of the Worker-side verbs (worker.ts), run by the ledger's undo
// (ledger/ops.ts dispatches by `op`, DATA.md §4.3) in the same transaction as its `undo` row. Like
// the surfaces' and memory's undo, only the newest state is taken back: a mix already gone is no
// conflict (the undo's end holds), but a setting, an episode or a reminder that changed since
// answers 409 instead of overwriting what came after. `memory.close` (music.never, memory.note) is
// memory's own (memory/undo.ts).
import { Fail } from '../../lib/result';
import type { Writer } from '../../objects/commit';
import { type ProgressWas, unmarkPlayed } from '../podcasts/sync';
import { moveBack } from '../reminders/ops';
import { restoreSetting, type SettingWas } from '../settings/mind-set';
import * as mixes from './mixes';

export const VERB_UNDO_OPS = ['mix.delete', 'podcast.progress', 'reminder.move', 'setting.restore'];

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
  if (typeof v !== 'number') throw new Fail('validation', { reason: 'not_undoable' });
  return v;
};

export function undo(w: Writer, actor: string, op: string, args: Args, zone: () => string): void {
  switch (op) {
    case 'mix.delete':
      mixes.remove(w.db, str(args.mix_id));
      return;
    case 'podcast.progress':
      if (!unmarkPlayed(w, str(args.key), (args.was ?? null) as ProgressWas, num(args.stamp)))
        throw new Fail('conflict', { reason: 'the episode changed since' });
      return;
    case 'reminder.move':
      moveBack(w, str(args.id), num(args.before), num(args.moved_to), zone());
      return;
    case 'setting.restore':
      restoreSetting(w, actor, args as unknown as SettingWas);
      return;
    default:
      throw new Fail('validation', { reason: 'not_undoable' });
  }
}
