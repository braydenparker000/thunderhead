// @ts-check
// What the owner has picked for the next message (HOME.md §4.6, §6.2): photos, files and a voice
// memo, held on this phone until it is sent, at most four. No DOM here: th/attach/tray.js draws it
// in the ask bar, and chat/index.js takes it with the message.
import { FILE_LIMITS } from '../contract.js';

/** A file on its way: picked on this phone, uploaded under its own id when its message goes.
 * `thumb` is a small data: image for the bar; `sent` once the Worker has it.
 * @typedef {{ id: string, name: string, type: string, bytes: number, blob: Blob, thumb?: string, seconds?: number, sent?: boolean }} LocalFile */

/** @type {LocalFile[]} */
export const picked = [];
/** @type {Set<() => void>} */
const subs = new Set();
const changed = () => subs.forEach((fn) => fn());

/** Calls `fn` after every change. @param {() => void} fn */
export const onPicked = (fn) => void subs.add(fn);

/** Room left on this message. */
export const room = () => FILE_LIMITS.owner_per_message - picked.length;

/** Adds what fits; false when some didn't. @param {LocalFile[]} files */
export function add(files) {
  const fits = files.slice(0, Math.max(0, room()));
  picked.push(...fits);
  changed();
  return fits.length === files.length;
}

/** @param {string} id */
export function remove(id) {
  const at = picked.findIndex((f) => f.id === id);
  if (at >= 0) picked.splice(at, 1);
  changed();
}

/** Everything picked, now leaving with a message. */
export function take() {
  const out = picked.splice(0);
  changed();
  return out;
}

/** m:ss @param {number} s */
export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Size as people read it: "820 KB", "2.4 MB". @param {number} n */
export const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
