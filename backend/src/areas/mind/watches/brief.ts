// What the mind is told about its watches: one budget line in the briefing's section 1 ("wakes
// today: 4 of 12, 3 watches live"), then each watch handed to this session with why it woke
// (RUNTIME.md §3); and the `watch.fired` event a live session's `th wait` gets instead of a wake.
// An outside watch's words (set after outside text) reach only a session that read outside text
// too; a clean one sees it kept back (MEMORY.md §6 M11). Reads only.
import type { LiveEvent } from '../../../../../shared/contract/api';
import type { Watch } from '../../../../../shared/contract/watches.ts';
import type { Db } from '../../../objects/base';
import { budgetNow, QUEUED_MS } from './pulse';
import * as store from './store';

const KEPT_BACK = '(set after outside text: its words are kept back)';

/** What the watch waited for, in a few words. */
const what = (r: store.WatchRow, clock: (at: number) => string) =>
  r.kind === 'at'
    ? `at ${clock(r.fire_at ?? r.created_at)}`
    : `${r.kind} ${r.type}${r.ref ? ` ${r.ref}` : ''}${r.met_ref && r.met_ref !== r.ref ? ` (met by ${r.met_ref})` : ''}`;

/** A watch as the routes give it: its words kept back from a clean session when they are outside. */
export function toWatch(r: store.WatchRow, words: boolean): Watch {
  const show = words || r.outside === 0;
  return {
    id: r.id,
    kind: r.kind,
    at: r.fire_at,
    type: r.type,
    ref: r.ref,
    why: show ? r.why : null,
    note: show ? r.note : null,
    provenance: r.outside ? 'outside' : 'owner',
    state: r.state,
    created_at: r.created_at,
    until: r.until,
    met_at: r.met_at,
    settled_at: r.settled_at,
    by: r.by,
    wake_id: r.wake_id,
  };
}

/** Section 1's lines: the budget, then the watches handed to this session (at most 5), each with
 * what to do. `tainted`: the session may read an outside watch's words. */
export function briefLines(
  db: Db,
  o: { sessionId: string; now: number; tz: string; tainted: boolean; clock: (at: number) => string },
): string[] {
  const b = budgetNow(db, o.now, o.tz);
  const live = store.countWaiting(db);
  const head =
    b.budget === 0
      ? `wakes today: watches off (the owner's wake budget is Off), ${live} watches live`
      : `wakes today: ${b.used} of ${b.budget}, ${live} watches live${b.refused ? `, ${b.refused} refused over the budget` : ''}`;
  const handed = store.handedTo(db, o.sessionId, o.now - QUEUED_MS);
  const lines = handed.slice(-5).map((r) => {
    const words = o.tainted || r.outside === 0 ? `${r.why}${r.note ? ` · note: ${r.note}` : ''}` : KEPT_BACK;
    return `watch ${r.id} fired (${what(r, o.clock)}): ${words}`;
  });
  if (lines.length)
    lines.push(
      'A watch woke you: look at what it names, then speak only by the voice ladder (BEHAVIOR.md §3); nothing that notifies in quiet hours.',
    );
  return [head, ...lines];
}

/** The live session's events for the watches fired to it among these changes (no new wake). */
export function liveEvents(
  db: Db,
  changes: { kind: string; ref: string | null; at: number }[],
  sessionId: string | null,
  tainted: () => boolean,
): LiveEvent[] {
  const out: LiveEvent[] = [];
  if (!sessionId) return out;
  for (const c of changes) {
    if (c.kind !== 'watch' || !c.ref) continue;
    const r = store.byId(db, c.ref.slice('watch:'.length));
    if (r?.state !== 'fired' || r.by !== 'event' || r.to_session !== sessionId || r.settled_at !== c.at) continue;
    const show = r.outside === 0 || tainted();
    out.push({
      type: 'watch.fired',
      ref: c.ref,
      at: c.at,
      kind: r.kind,
      why: show ? r.why : null,
      note: show ? r.note : null,
    });
  }
  return out;
}
