// The player's module graph in the order Astra evaluates it a piece at a time (frontend/astra/src/app/player-load.js):
// every module after the modules it imports (its static imports; a dynamic import() is a later load of its own),
// and, among those that may come next, the smallest first, so the largest (Mediabunny) comes as late as the graph
// allows. Modules the app's start-up already loaded (src/main.js's own graph) are left out. Written to
// frontend/astra/src/app/player-graph.js, relative to that file.
//   node scripts/astra/player-graph.mjs          prints the order with each module's size
//   node scripts/astra/player-graph.mjs --write  writes it
//   node scripts/astra/player-graph.mjs --check  fails if the file differs from what the graph gives
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../frontend/astra/src/', import.meta.url));
const ENTRY = resolve(SRC, 'player/player-screen.js'), START = resolve(SRC, 'main.js');
const OUT = resolve(SRC, 'app/player-graph.js');
const IMPORT = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

/** Each module of the graph from `entry`: {file, size, deps}. */
export function graphOf(entry = ENTRY) {
  const mods = new Map();
  const visit = (file) => {
    if (mods.has(file)) return;
    const text = readFileSync(file, 'utf8');
    const deps = [...new Set([...text.matchAll(IMPORT)].map((m) => resolve(dirname(file), m[1])))];
    mods.set(file, { file, size: statSync(file).size, deps });
    for (const d of deps) visit(d);
  };
  visit(entry);
  return mods;
}

/** The evaluation order: dependencies first; of the modules ready, the smallest first (an import cycle from one of its own). */
export function orderOf(mods = graphOf(), started = graphOf(START)) {
  const done = new Set([...started.keys()].filter((f) => mods.has(f))), out = [];
  while (done.size < mods.size) {
    const left = [...mods.values()].filter((m) => !done.has(m.file));
    const waits = (m) => m.deps.filter((d) => mods.has(d) && !done.has(d));
    // Ready: nothing to wait for, or only for modules that import it back (an import cycle starts there).
    const back = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), waits(mods.get(from)).some((d) => back(d, to, seen))));
    const ready = left.filter((m) => waits(m).every((d) => back(d, m.file)));
    const next = (ready.length ? ready : left).sort((a, b) => a.size - b.size || a.file.localeCompare(b.file))[0];
    done.add(next.file);
    out.push(next);
  }
  return out;
}

/** player-graph.js as the order gives it. */
export function fileText(order = orderOf()) {
  const paths = order.map((m) => relative(dirname(OUT), m.file).replace(/^(?!\.)/, './'));
  return `// Made by scripts/astra/player-graph.mjs (do not edit): the player's modules, each after those it imports, the
// smallest first and the largest as late as the graph allows; app/player-load.js evaluates them a piece at a time.
export const PLAYER_GRAPH = [
${paths.map((p) => `  '${p}',`).join('\n')}
];
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const order = orderOf(), text = fileText(order);
  if (process.argv.includes('--write')) writeFileSync(OUT, text);
  else if (process.argv.includes('--check')) {
    let now = '';
    try { now = readFileSync(OUT, 'utf8'); } catch {}
    if (now !== text) { console.error('frontend/astra/src/app/player-graph.js is out of date: node scripts/astra/player-graph.mjs --write'); process.exit(1); }
  } else for (const m of order) console.log(String(m.size).padStart(8), relative(SRC, m.file));
}
