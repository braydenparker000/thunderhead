// The owner's Stop (BEHAVIOR.md §3, RUNTIME.md §4.6): a tap ends the mind's current work, not the
// session. It is a setting, so it needs no table and survives restarts: `mind.stop` =
// {at, seq, cleared_at}. A waiting mind gets the `stop` signal once (the take's `after` passes its
// seq), every say/status reply carries `TH-Stop: 1` while it stands, and the chat mind's next
// text reply ("Stopped. Done: … Not done: …") clears it.
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as settings from '../settings/store';

export interface StopMark {
  at: number;
  seq: number;
  cleared_at: number | null;
}

export function standing(db: Db): StopMark | null {
  const s = settings.getSetting(db, 'mind.stop') as StopMark | undefined;
  return s && typeof s.seq === 'number' && s.cleared_at === null ? s : null;
}

/** The owner tapped Stop. A second tap while one stands changes nothing. */
export function request(w: Writer): StopMark {
  const cur = standing(w.db);
  if (cur) return cur;
  w.change('mind_status', 'setting:mind.stop');
  const mark: StopMark = { at: w.at, seq: w.seq, cleared_at: null };
  settings.putSetting(w.db, 'mind.stop', mark, 'owner', w.at);
  return mark;
}

/** The chat mind's reply after a Stop clears it. */
export function clear(w: Writer): void {
  const cur = standing(w.db);
  if (!cur) return;
  settings.putSetting(w.db, 'mind.stop', { ...cur, cleared_at: w.at }, 'worker', w.at);
  w.change('mind_status', 'setting:mind.stop');
}
