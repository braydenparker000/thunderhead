// @ts-check
// The + sheet once signed in (HOME.md §6.2): Camera, Photos and Files pick what goes with the next
// message, Voice memo records one, Remind me sets a reminder. Loaded while the sheet opens, so the
// pickers open straight from the tap.
import { toast } from '../ui.js';
import { choose, prepare } from './pick.js';
import { add, room } from './state.js';
import './tray.js';

/** @param {string | undefined} kind */
export async function act(kind) {
  if (kind === 'remind') return (await import('./remind.js')).openRemind();
  if (kind === 'memo') return (await import('./memo.js')).recordMemo();
  if (kind !== 'camera' && kind !== 'photos' && kind !== 'files') return;
  if (room() <= 0) return toast('Up to 4 at a time.');
  const files = await choose(kind);
  if (!files.length) return;
  const ready = /** @type {import('./state.js').LocalFile[]} */ ((await Promise.all(files.map(prepare))).filter(Boolean));
  if (!add(ready)) toast('Up to 4 at a time.');
}
