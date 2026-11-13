// The network's passes written the other way (frontend/lab/engine/net-tune.js `direct`): every pass that stages its
// input in the workgroup's memory has one, with nothing staged and the exported pass's own head; the first and the
// last pass have none. Whether the other way is right and faster is found on a GPU (tests/lab-engine-grain-browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLEARLY, direct } from '../frontend/lab/engine/net-tune.js';

const DIR = new URL('../frontend/lab/engine/nets/starfish-xtrans/', import.meta.url);

test('each of the nine middle passes has another way that stages nothing; the first and last have none', () => {
  for (const kind of ['f16', 'f32']) {
    const files = readdirSync(new URL(`${kind}/`, DIR)).filter((f) => f.endsWith('.wgsl')).sort();
    assert.equal(files.length, 11);
    for (const [j, f] of files.entries()) {
      const code = readFileSync(new URL(`${kind}/${f}`, DIR), 'utf8'), other = direct(code);
      if (j === 0 || j === 10) { assert.equal(other, null, f); continue; }
      assert.ok(other, f);
      assert.doesNotMatch(other, /var<workgroup>|workgroupBarrier|\bsx\[|\bsw\[/, `${f}: nothing staged`);
      assert.equal(other.slice(0, other.indexOf('@compute')).trimEnd(), code.slice(0, code.indexOf('@compute')).replace(/^var<workgroup>.*\n/gm, '').trimEnd(), `${f}: the exported pass's own constants, bindings, load and store`);
      assert.deepEqual([...other.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), [...code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), `${f}: the same bindings`);
      assert.match(other, /@workgroup_size\(16, 4, 1\)/, `${f}: the same invocations, so the same dispatch`);
    }
  }
  assert.equal(direct('fn main() {}'), null);
  assert.ok(CLEARLY < 0.95 && CLEARLY > 0.5, 'chosen only where clearly faster');
});
