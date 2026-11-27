// The network's passes written other ways (frontend/lab/engine/net-ways.js `ways`): every Starfish v0.2.0 3x3 middle
// pass that stages its input in workgroup memory has five ways that stage nothing, behind the exported pass's own head.
// The first (`00_prep`) and last (`12_head`) passes have none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAYS, ways } from '../frontend/lab/engine/net-tune.js';
import { canSlice, sliced } from '../frontend/lab/engine/net-pace.js';

const DIR = new URL('../frontend/lab/engine/nets/starfish-xtrans/', import.meta.url);

test('each of the eleven v0.2.0 middle passes has ways that stage nothing; first and last have none', () => {
  for (const kind of ['f16', 'f32']) {
    const ops = readFileSync(new URL(`${kind}/graph.txt`, DIR), 'utf8').split('\n').filter((l) => l.startsWith('op ')).map((l) => l.split(/\s+/)).map((v) => ({ file: v[1], code: readFileSync(new URL(`${kind}/${v[1]}`, DIR), 'utf8'), groups: v.slice(7, 10).map(Number) }));
    assert.equal(ops.length, 13);
    assert.deepEqual(ops.map((o) => ways(o).map((w) => (w ? 1 : 0)).join('')), ['', ...Array(11).fill('11111'), '']);
    for (const o of ops) for (const [k, w] of ways(o).entries()) {
      if (!w) continue;
      const f = `${kind}/${o.file} way ${k + 1}`;
      assert.doesNotMatch(w.code, /var<workgroup>|workgroupBarrier|\bsx\[|\bsw\[/, `${f}: nothing staged`);
      assert.equal(w.code.slice(0, w.code.indexOf('@compute')).trimEnd(), o.code.slice(0, o.code.indexOf('@compute')).replace(/^var<workgroup>.*\n/gm, '').replace('struct Valid { h: u32, w: u32 }', 'struct Valid { h: u32, w: u32, z0: u32 }').trimEnd(), `${f}: the exported pass's own constants, bindings, load and store`);
      assert.ok(canSlice(w.code) && !/\b(wg|g)\.z\b(?! \+ valid\.z0)/.test(w.code) && !canSlice(o.code), `${f}: every use of its place along z starts from valid.z0; exported has none`);
      assert.deepEqual([...w.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), [...o.code.matchAll(/@binding\((\d)\)/g)].map((m) => m[1]), `${f}: the same bindings`);
      assert.equal((w.code.match(/@compute/g) || []).length, 1, f);
      assert.doesNotMatch(w.code.slice(w.code.indexOf('@compute')), /`|\b\d+\.\d+\b(?!u)/, `${f}: no untyped float literal`);
      const ocb = Number(/const OCB: u32 = (\d+)u/.exec(o.code)[1]), nv = ocb / 4, cout = Number(/const COUT: u32 = (\d+)u/.exec(o.code)[1]);
      const [wx, wy] = /@workgroup_size\((\d+), (\d+), 1\)/.exec(w.code).slice(1).map(Number);
      assert.ok(w.groups[0] * wx * [1, 1, 1, 2, 2][k] >= 352 && w.groups[1] * wy * [3, 3, 1, 2, 2][k] >= 352 && w.groups[2] * [ocb, ocb / 2, ocb, 8, 4][k] >= cout, `${f}: covers 352x352 and all ${cout} outputs (nv=${nv})`);
    }
  }
  assert.deepEqual(ways({ code: 'fn main() {}', groups: [1, 1, 1] }), []);
  assert.equal(WAYS, 5);
});

test('a sliced way starts at the block its window names; code with no such place is left as it is', () => {
  const code = 'struct Valid { h: u32, w: u32 }\nfn main() { let ob = wg.z * 2u; let hh = wg.z % 2u; let other = swg.z; let ox = g.z * 4u; }';
  assert.equal(sliced(code), 'struct Valid { h: u32, w: u32, z0: u32 }\nfn main() { let ob = (wg.z + valid.z0) * 2u; let hh = (wg.z + valid.z0) % 2u; let other = swg.z; let ox = (g.z + valid.z0) * 4u; }');
  assert.equal(canSlice(sliced(code)), true);
  assert.equal(sliced('fn main() {}'), 'fn main() {}');
  assert.equal(canSlice('fn main() {}'), false);
});
