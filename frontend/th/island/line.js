// @ts-check
// The island line (HOME.md §12.1, BEHAVIOR.md §2): one sentence from the mind (`island.show`, checked by the Worker)
// in the capsule while Music or Podcasts plays there. The next replaces it; its undo (`island.clear`) or its app
// leaving the island takes it away. Kept in memory only.
/** @type {{ id: string, text: string, app: string } | null} */
let line = null;
const changed = () => document.dispatchEvent(new CustomEvent('th:island-line'));

/** The line for `app`, or ''. @param {string} app */
export function saidFor(app) {
  if (line && line.app !== app) line = null;
  return line?.text ?? '';
}

/** Its app came to the front: the line goes. @param {string} app */
export function drop(app) {
  if (line?.app === app) line = null;
}

/** `island.show` v1: shows the line, or `not_playing` when no app plays in the capsule.
 * @param {{ text: string }} args @returns {Promise<import('../registry/verbs.js').Outcome>} */
export async function show({ text }) {
  const island = await import('./island.js');
  const app = island.inIsland();
  if (!app || !island.playing()) return { ok: false, error: { code: 'not_playing', message: 'nothing plays in the island' } };
  const id = crypto.randomUUID();
  line = { id, text: String(text).slice(0, 80), app };
  changed();
  return { ok: true, result: { app, line: id }, undo: { verb: 'island.clear', schema: 1, args: { line: id } } };
}

/** `island.clear` v1: takes away the line it names; a later one stays.
 * @param {{ line: string }} args @returns {Promise<import('../registry/verbs.js').Outcome>} */
export async function clear(args) {
  const cleared = line !== null && line.id === args.line;
  if (cleared) {
    line = null;
    changed();
  }
  return { ok: true, result: { cleared } };
}
