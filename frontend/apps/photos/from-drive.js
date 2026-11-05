// @ts-check
// Files picked in Drive onto the shelf (PHOTOS.md §3.1): registered by reference, 20 a request with
// the progress ("20 of 60"), each on the shelf at once as a placeholder tile with its name ("Preview
// coming"), then its thumbnail and preview made from its original in Drive (a RAF's header and
// embedded JPEG by ranged reads, `previewFromDrive`), three at a time. The files stay where they are
// in Drive. `photo.import` says each happened, from Drive.
import * as data from './data.js';
import { previewFromDrive, sensed, why } from './import.js';

/** Files one request registers (PHOTO_LIMITS.pick_per_request), and previews made at once. */
export const PER_REQUEST = 20;
export const IN_FLIGHT = 3;

/** @typedef {{ note: (text: string) => void, progress: (done: number, total: number) => void, end: (text: string, failed?: boolean) => void }} Row */

const changed = () => document.dispatchEvent(new CustomEvent('photos:changed'));
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** @param {import('./pick.js').Picked[]} files @param {Row} row */
export async function importPicked(files, row) {
  const total = files.length;
  /** @type {data.PhotoItem[]} */
  const queue = [];
  let added = 0, already = 0, refused = 0, made = 0, running = 0, registering = true;
  /** @type {() => void} */
  let finished = () => {};
  const previews = new Promise((r) => (finished = () => r(undefined)));
  const say = (/** @type {number} */ through) => {
    row.note(`${through} of ${total} on the shelf${added ? ` · previews ${made} of ${added}` : ''}`);
    row.progress(through + made, total + added);
  };
  let through = 0;
  const pump = () => {
    while (running < IN_FLIGHT && queue.length) {
      const p = /** @type {data.PhotoItem} */ (queue.shift());
      running++;
      previewFromDrive(p)
        .catch(() => null)
        .then(() => {
          running--;
          made++;
          data.coming.delete(p.id);
          document.dispatchEvent(new CustomEvent('photos:thumb', { detail: p.id }));
          say(through);
          pump();
        });
    }
    if (!registering && !running && !queue.length) finished();
  };
  say(0);
  let failed = '';
  for (let i = 0; i < total && !failed; i += PER_REQUEST) {
    try {
      const out = await data.fromDrive(files.slice(i, i + PER_REQUEST).map((f) => f.id));
      for (const p of out.added) {
        data.coming.add(p.id);
        queue.push(p);
        sensed(p, 'drive');
      }
      added += out.added.length;
      already += out.already.length;
      refused += out.refused.length;
      through = Math.min(total, i + PER_REQUEST);
      say(through);
      if (out.added.length) changed();
      pump();
    } catch (e) {
      failed = why(e);
    }
  }
  registering = false;
  pump();
  await previews;
  const told = [
    `${plural(added, 'photo')} from Drive on the shelf`,
    already ? `${already} already there` : '',
    refused ? `${refused} Drive would not give` : '',
  ].filter(Boolean);
  row.end(failed ? `${told[0]}. Then: ${failed}` : `${told.join(', ')}.`, Boolean(failed));
}
