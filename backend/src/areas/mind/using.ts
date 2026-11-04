// "How I got this" (HOME.md §4.13, API.md §11.7): the chips the chat session gave while it worked
// on the owner's message (the presence's `using`, given at or after that message) go to the reply
// that answers it as `meta.using`, and leave the presence, so the next message starts with none.
// The Worker sets them; a mind's own `meta.using` is refused (conversation/ops.ts).
import type { MindPresence } from '../../../../shared/contract/api';
import { MIND_STATUS_LIMITS, type MindUse } from '../../../../shared/contract/feed.ts';
import type { Writer } from '../../objects/commit';
import * as settings from '../settings/store';

/** The chips given since `since` (ms), taken off the presence; none when the session gave none. */
export function takeUsing(w: Writer, since: number): MindUse[] {
  const cur = settings.getSetting(w.db, 'mind.status') as MindPresence | undefined;
  const using = cur?.state === 'working' && (cur.title_at ?? 0) >= since ? (cur.using ?? []) : [];
  if (!using.length) return [];
  // The title was about the same work: it goes with them; the state and the live line stay.
  const next: MindPresence = { state: cur?.state ?? 'working', note: cur?.note ?? null, since: cur?.since ?? w.at };
  settings.putSetting(w.db, 'mind.status', next, 'worker', w.at);
  w.change('mind_status', 'setting:mind.status');
  return using.slice(0, MIND_STATUS_LIMITS.using);
}
