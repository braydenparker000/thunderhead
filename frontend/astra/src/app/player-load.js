// The player's code, loaded a piece at a time (FEEL.md; the feel report counts the main thread's gaps). Asked for
// whole, the player and its engine (some 140 modules, Mediabunny's 750 kB among them) were evaluated in one task
// and the player made in the same one: 57 ms at 4x CPU in the lab, 114 at 6x, and over a second on the owner's
// phone when a tap came first. Here the modules are fetched and compiled ahead, a few a frame (modulepreload: off
// the main thread but for a small compile each), and evaluated in the order app/player-graph.js gives (each after those it
// imports, the largest as late as the graph allows), as many a frame as fit in PIECE_MS (one, if it is bigger),
// yielding to the frame between; then the player is made in a frame of its own. Once a tap waits for it (`urgent()`),
// its opening already on screen (app/playing.js), the rest is imported in one go: a piece a frame then put the first
// picture 1.5 to 2 s later at 4x CPU, for frames the compositor was drawing anyway.

import {PLAYER_GRAPH} from './player-graph.js';
import {nextFrame} from '../ui/motion-core.js';

/** Evaluation a frame, in ms, while nothing waits for it. */
export const PIECE_MS = 4;
/** Modules asked for ahead of the one being evaluated, and at most a frame (a link is about 0.7 ms at 4x in the app's page). */
export const AHEAD = 24, ASK = 8;

const url = path => new URL(path, import.meta.url).href;

/**
 * Evaluates `paths` (relative to this file) in order, a piece a frame, the rest at once when `urgent()` (a tap waits). Each frame
 * first asks for up to ASK more modules, so that AHEAD are asked for ahead of the evaluation (modulepreload: fetched
 * and compiled, not run; asking for all at once was itself 42 ms at 4x), then evaluates what fits in the rest. Resolves once all are evaluated; `pieces` hears
 * each piece's [modules, ms] (measurements).
 */
export async function evaluateInPieces(paths = PLAYER_GRAPH, {urgent = () => false, pieces = null} = {}) {
  const urls = paths.map(url), links = [], head = typeof document !== 'undefined' ? document.head : null;
  let asked = 0;
  const ask = upTo => {
    if (!head) return;
    const part = [], stop = Math.min(upTo, urls.length, asked + ASK);
    for (; asked < stop; asked++) part.push(Object.assign(document.createElement('link'), {rel: 'modulepreload', href: urls[asked]}));
    head.append(...part);
    links.push(...part);
  };
  try {
    let i = 0;
    while (i < urls.length) {
      if (urgent()) { const from = i, start = performance.now(); await import(urls.at(-1)); i = urls.length; pieces?.([i - from, performance.now() - start]); break; } // the entry pulls the rest
      const start = performance.now(), end = start + PIECE_MS, from = i;
      ask(i + AHEAD);
      do await import(urls[i++]); while (i < urls.length && performance.now() < end);
      pieces?.([i - from, performance.now() - start]);
      if (i < urls.length) await nextFrame();
    }
  } finally { for (const l of links) l.remove(); }
}

/** The player screen over `parent`, its code evaluated in pieces and the screen made in a frame of its own. */
export async function makePlayer(parent, options = {}) {
  await evaluateInPieces(PLAYER_GRAPH, options);
  const {PlayerScreen} = await import('../player/player-screen.js'); // evaluated already: the graph's last
  await nextFrame();
  return new PlayerScreen({parent});
}
