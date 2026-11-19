// The player's module graph as Astra evaluates it a piece at a time (scripts/astra/player-graph.mjs makes
// frontend/astra/src/app/player-graph.js; app/player-load.js evaluates it): the file is what the graph gives, every
// module comes after those it imports, nothing start-up loaded is in it, and Mediabunny comes as late as it can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphOf, orderOf } from '../scripts/astra/player-graph.mjs';
import { PLAYER_GRAPH } from '../frontend/astra/src/app/player-graph.js';

const SCRIPT = fileURLToPath(new URL('../scripts/astra/player-graph.mjs', import.meta.url));
const SRC = fileURLToPath(new URL('../frontend/astra/src/', import.meta.url));

test('player-graph.js is what the graph gives (node scripts/astra/player-graph.mjs --write)', () => {
  execFileSync(process.execPath, [SCRIPT, '--check']);
});

test('each module after those it imports; start-up\'s modules left out; the largest as late as the graph allows', () => {
  const mods = graphOf(), started = graphOf(resolve(SRC, 'main.js'));
  const files = PLAYER_GRAPH.map((p) => resolve(SRC, 'app', p));
  assert.deepEqual(files, orderOf().map((m) => m.file));
  assert.equal(files.at(-1), resolve(SRC, 'player/player-screen.js'));
  assert.ok(!files.some((f) => started.has(f)), 'nothing start-up already loaded');
  const at = new Map(files.map((f, i) => [f, i]));
  const late = []; // a module before one it imports: only inside an import cycle
  for (const f of files) for (const d of mods.get(f).deps) if (at.has(d) && at.get(d) > at.get(f)) late.push([f, d]);
  const reaches = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), mods.get(from).deps.some((d) => mods.has(d) && reaches(d, to, seen))));
  for (const [f, d] of late) assert.ok(reaches(d, f), `${f} before ${d} outside a cycle`);
  const mb = resolve(SRC, '../vendor/mediabunny.js');
  for (const f of files.slice(at.get(mb) + 1)) assert.ok(reaches(f, mb), `${f} comes after Mediabunny without needing it`);
});
