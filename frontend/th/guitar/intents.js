// @ts-check
// Guitar's pending intents (API.md §11.11 "Pending intents"): `guitar.start_practice`, which the
// mind queues so that the next time the owner opens Guitar, it lands in the reader at the planned
// section (guitar.set_plan's `guitar/today`), looped, at its tempo. It never opens Guitar or plays
// by itself: it waits for the owner to open the app, and the owner presses play. A song this phone
// has never opened is `song_unknown`. Nothing to undo (the owner closes the reader). Started by
// guitar/app.js as Guitar opens; the plumbing is th/ported/intents.js.
import { applyIntents, workerIo } from '../ported/intents.js';

/** Where the reader opens: a section's first and last bar (indexes, as the ladder keys them) and a
 * tempo. @typedef {{ a: number, b: number, bpm?: number }} At */
/** The app's side: opens the song by its key at `at`; whether it knows the song.
 * @typedef {{ open: (key: string, at: At) => boolean }} Guitar */

/** A plan's section `<first bar>-<last bar>` as the reader takes it, or null. @param {string} key
 * @param {number} [bpm] @returns {At | null} */
export function sectionAt(key, bpm) {
  const m = /^(\d{1,4})-(\d{1,4})$/.exec(String(key));
  if (!m || Number(m[1]) > Number(m[2])) return null;
  return { a: Number(m[1]), b: Number(m[2]), ...(bpm ? { bpm } : {}) };
}

/** The reader's address at a section: `#play=<key>&bars=<a>-<b>[&bpm=<n>]` (guitar/app.js).
 * @param {string} key @param {At} at */
export const playHash = (key, at) => `#play=${encodeURIComponent(key)}&bars=${at.a}-${at.b}${at.bpm ? `&bpm=${at.bpm}` : ''}`;

/** @type {import('../ported/intents.js').Executors<Guitar>} */
export const EXECUTORS = {
  'guitar.start_practice': {
    1: async (guitar, { tab, section, bpm }) => {
      const key = String(tab).replace(/^tab:/, '');
      const at = sectionAt(section, bpm);
      if (!at) return { ok: false, error: { code: 'bad_section' } };
      if (!guitar.open(key, at)) return { ok: false, error: { code: 'song_unknown', message: 'open the song once in Guitar' } };
      return { ok: true, result: { opened: `${tab}#${section}` } };
    },
  },
};

/** Applies Guitar's pending intents as it opens. Never throws. @param {Guitar} guitar */
export async function installIntents(guitar) {
  try {
    const io = await workerIo('guitar');
    if (io) await (await applyIntents(EXECUTORS, guitar, io)).send();
  } catch {
    // The next open tries again.
  }
}
