// The network's passes written other ways (frontend/lab/engine/net-ways.js `ways`): every pass that stages its input
// in the workgroup's memory has ways that stage nothing, behind the exported pass's own head, each in its own place:
// read in place; for a 3 × 3 pass, sixteen outputs to an invocation over half the dispatches; one pixel and
// thirty-two outputs. The first and the last pass have none. Whether a way is right and faster is found on a GPU
// (tests/lab-engine-grain-browser, tests/lab-engine-net-bench-browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAYS, ways } from '../frontend/lab/engine/net-tune.js';

const DIR = new URL('../frontend/lab/engine/nets/starfish-xtrans/', import.meta.url);

test('each of the nine middle passes has ways that stage nothing, each in its own place; the first and last have none', () => {
  for (const kind of ['f16', 'f32']) {
    const ops = readFileSync(new URL(`${kind}/graph.txt`, DIR), 'utf8').split('\n').filter((l) => l.startsWith('op ')).map((l) => l.split(/\s+/)).map((v) => ({ file: v[1], code: readFileSync(new URL(`${kind}/${v[1]}`, DIR), 'utf8'), groups: v.slice(7, 10).map(Number) }));
    assert.equal(ops.length, 11);
    // read in place | sixteen outputs (a 3 x 3 pass only) | one pixel and thirty-two outputs | a 2 x 2 block (3 x 3 only) | that with four outputs (3 x 3 only)
    assert.deepEqual(ops.map((o) => ways(o).map((w) => (w ? 1 : 0)).join('')), ['', '11111', '10100', '10100', '11111', '10100', '10100', '11111', '10100', '10100', '']);
    for (const o of ops) for (const [k, w] of ways(o).entries()) {
      if (!w) continue;
      const f = `${kind}/${o.file} way ${k + 1}`, three = /const KK\b/.test(o.code);
      assert.doesNotMatch(w.code, /var<workgroup>|workgroupBarrier|\bsx\[|\bsw\[/, `${f}: nothing staged`);
      assert.equal(w.code.slice(0, w.code.indexOf('@compute')).trimEnd(), o.code.slice(0, o.code.indexOf('@compute')).replace(/^var<workgroup>.*\n/gm, '').trimEnd(), `${f}: the exported pass's own constants, bindings, load and store`);
      assert.deepEqual([...w.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), `${f}: the same bindings`);
      assert.equal((w.code.match(/@compute/g) || []).length, 1, f);
      assert.doesNotMatch(w.code.slice(w.code.indexOf('@compute')), /`|\b\d+\.\d+\b(?!u)/, `${f}: no number in it that would need a float's type spelled out`);
      const [gx, gy, gz] = o.groups;
      assert.deepEqual(w.groups, k === 0 || k === 3 || !three ? o.groups : k === 1 ? [gx, gy, gz / 2] : k === 2 ? [gx * 2, gy * 2, Math.ceil(gz / 4)] : [gx, gy, gz * 2], `${f}: the dispatch its invocations need`);
      // every workgroup covers the whole 176 x 176 and every output: invocations a workgroup, times workgroups, times pixels and outputs each
      const [wx, wy] = /@workgroup_size\((\d+), (\d+), 1\)/.exec(w.code).slice(1).map(Number);
      if (three) assert.ok(w.groups[0] * wx * [1, 1, 1, 2, 2][k] >= 176 && w.groups[1] * wy * [4, 4, 1, 2, 2][k] >= 176 && w.groups[2] * [8, 16, 32, 8, 4][k] >= 144, `${f}: covers the picture and its outputs`);
    }
  }
  assert.deepEqual(ways({ code: 'fn main() {}', groups: [1, 1, 1] }), []);
  assert.equal(WAYS, 5);
});
