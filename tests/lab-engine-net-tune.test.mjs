// The network's passes written other ways (frontend/lab/engine/net-tune.js `ways`): every pass that stages its input
// in the workgroup's memory has one that stages nothing, with the exported pass's own head; the three 3 × 3 passes
// have a second, sixteen outputs to an invocation over half the dispatches; the first and the last pass have none.
// Whether a way is right and faster is found on a GPU (tests/lab-engine-grain-browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLEARLY, ways } from '../frontend/lab/engine/net-tune.js';

const DIR = new URL('../frontend/lab/engine/nets/starfish-xtrans/', import.meta.url);

test('each of the nine middle passes has a way that stages nothing, the 3 × 3 a second; the first and last have none', () => {
  for (const kind of ['f16', 'f32']) {
    const ops = readFileSync(new URL(`${kind}/graph.txt`, DIR), 'utf8').split('\n').filter((l) => l.startsWith('op ')).map((l) => l.split(/\s+/)).map((v) => ({ file: v[1], code: readFileSync(new URL(`${kind}/${v[1]}`, DIR), 'utf8'), groups: v.slice(7, 10).map(Number) }));
    assert.equal(ops.length, 11);
    assert.deepEqual(ops.map((o) => ways(o).length), [0, 2, 1, 1, 2, 1, 1, 2, 1, 1, 0]);
    for (const o of ops) for (const [k, w] of ways(o).entries()) {
      const f = `${kind}/${o.file} way ${k + 1}`;
      assert.doesNotMatch(w.code, /var<workgroup>|workgroupBarrier|\bsx\[|\bsw\[/, `${f}: nothing staged`);
      assert.equal(w.code.slice(0, w.code.indexOf('@compute')).trimEnd(), o.code.slice(0, o.code.indexOf('@compute')).replace(/^var<workgroup>.*\n/gm, '').trimEnd(), `${f}: the exported pass's own constants, bindings, load and store`);
      assert.deepEqual([...w.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), `${f}: the same bindings`);
      assert.match(w.code, /@workgroup_size\(16, 4, 1\)/, f);
      assert.deepEqual(w.groups, k === 0 ? o.groups : [o.groups[0], o.groups[1], o.groups[2] / 2], `${f}: the same dispatch, or half as many for twice the outputs each`);
    }
  }
  assert.deepEqual(ways({ code: 'fn main() {}', groups: [1, 1, 1] }), []);
  assert.ok(CLEARLY < 0.95 && CLEARLY > 0.5, 'chosen only where clearly faster');
});
