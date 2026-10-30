// @ts-check
// Device verb executors (EXTENDING.md rule 3, API.md §11.11): what this phone does when the mind
// asks, or the owner taps a reply chip. Keyed by the contract's verb names and schema versions; a
// verb or version missing here is answered `unsupported_verb`, so a newer mind never breaks an
// older phone. An executor returns its result and, for `undo: 'reported'` verbs, its inverse.
import { VERBS } from '../contract.js';
import { launch } from '../../ui/launch.js';
import { appFor, deepLink } from './apps.js';

/** @typedef {{ ok: true, result: Record<string, unknown>, undo?: { verb: string, schema: number, args: Record<string, unknown> } } | { ok: false, error: { code: string, message?: string } }} Outcome */
/** @typedef {(args: any) => Promise<Outcome>} Executor */

const MODES = /** @type {const} */ ({ auto: 'auto', day: 'light', night: 'dark' });

/** The appearance the owner chose on this phone, in the verb's words. */
export function currentMode() {
  let pref = 'auto';
  try {
    pref = localStorage.getItem('th-theme') || 'auto';
  } catch {}
  return pref === 'light' ? 'day' : pref === 'dark' ? 'night' : 'auto';
}

/** @type {Record<string, Record<number, Executor>>} */
export const EXECUTORS = {
  'app.open': {
    1: async ({ app, path }) => {
      const to = deepLink(app, path);
      if (!to) return { ok: false, error: { code: 'app_missing' } };
      await launch(/** @type {{ color: string }} */ (appFor(app)).color);
      location.assign(to);
      return { ok: true, result: {} };
    },
  },
  // The Music player's playlists, in its own storage (th/music/playlists.js, loaded when needed).
  'music.create_playlist': {
    1: async (args) => (await import('../music/playlists.js')).createPlaylist(args),
  },
  'music.delete_playlist': {
    1: async (args) => (await import('../music/playlists.js')).deletePlaylist(args),
  },
  'shell.appearance': {
    1: async ({ mode }) => {
      const previous = currentMode();
      const theme = MODES[/** @type {keyof typeof MODES} */ (mode)];
      if (!theme) return { ok: false, error: { code: 'validation' } };
      // home.js owns the theme switch; it stores the choice and repaints.
      document.dispatchEvent(new CustomEvent('th:theme', { detail: theme }));
      return { ok: true, result: { previous }, undo: { verb: 'shell.appearance', schema: 1, args: { mode: previous } } };
    },
  },
};

/** Whether this phone can run a verb at a schema version. @param {string} verb @param {number} schema */
export const canRun = (verb, schema) => Boolean(Object.hasOwn(VERBS, verb) && EXECUTORS[verb]?.[schema]);

/** Runs a verb; anything this phone lacks is `unsupported_verb`.
 * @param {{ verb: string, schema: number, args: any }} v @returns {Promise<Outcome>} */
export async function run(v) {
  if (!canRun(v.verb, v.schema)) return { ok: false, error: { code: 'unsupported_verb' } };
  try {
    return await EXECUTORS[v.verb][v.schema](v.args);
  } catch (e) {
    return { ok: false, error: { code: 'failed', message: String(/** @type {Error} */ (e)?.message ?? e).slice(0, 200) } };
  }
}
