// "The network on this phone" on the engine test page (frontend/lab/engine/net-ui.js, net-bench.js): one tap
// measures a window of the network a pass at a time, every way each pass is written, judges the fastest ways on the
// whole picture, keeps them for the editor, and measures the CPU on the heavy pass's work. Here on a small part of
// a window and for a moment each, on a software GPU (which has no half floats: what a phone's 16-bit sums do is the
// phone's to say, and the page's report is made to say it). Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { apart, fastest, judge, FASTER } from '../frontend/lab/engine/net-bench.js';

const opts = { skip: process.env.SITE_URL ? 'local only (a software GPU)' : false, timeout: 600_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('one tap measures the network every way, judges the picture, keeps the ways, and measures the CPU', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback&side=96&reps=1&cpums=150`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-net=ready]');
  assert.equal(await page.isDisabled('#ncopy'), true, 'nothing to copy before a run');
  await page.click('#nrun');
  await page.waitForFunction(() => /^Done|^Stopped/.test(document.getElementById('nnow').textContent), null, { timeout: 480_000, polling: 250 });
  const r = await page.evaluate(() => ({ now: document.getElementById('nnow').textContent, text: document.getElementById('nout').textContent, run: window.__net, kept: JSON.parse(localStorage.getItem('th.net.tune') || 'null'),
    last: JSON.parse(localStorage.getItem('th.net.bench'))[0].at, timing: JSON.parse(localStorage.getItem('th.editor.timings')).at(-1), copy: document.getElementById('ncopy').disabled }));
  assert.match(r.now, /^Done\./, r.now);
  const n = r.run;
  console.log(`# ${r.text.split('\n').join('\n# ')}`);
  assert.equal(n.ms.length, 11);
  assert.deepEqual(n.names, ['first', '3x3 37>144', '1x1 144>288', '1x1 288>288', '3x3 288>144', '1x1 144>288', '1x1 288>288', '3x3 288>144', '1x1 144>288', '1x1 288>108', 'last']);
  // every way of every pass compiled, ran, and made what the exported pass makes (a software GPU's sums are exact)
  assert.deepEqual(n.tried.map((row) => row.map((t) => (t.ms >= 0 ? (t.rms === 0 ? 'same' : `off ${t.rms}`) : t.ms)).join(' ')),
    ['-1 -1 -1', 'same same same', 'same -1 same', 'same -1 same', 'same same same', 'same -1 same', 'same -1 same', 'same same same', 'same -1 same', 'same -1 same', '-1 -1 -1']);
  // the ways tried together are the fastest of each pass, and only those clearly faster
  assert.deepEqual(n.way.length, 11);
  for (const [j, w] of n.way.entries()) if (w) assert.ok(n.tried[j][w - 1].ms < FASTER * n.ms[j], `pass ${j + 1}: ${n.tried[j][w - 1].ms} against ${n.ms[j]}`);
  assert.ok(n.whole.exported > 0 && n.whole.after > 0 && n.whole.full === null && n.picture.exported === null, 'no half floats here: the exported picture is itself the truth');
  if (n.way.some(Boolean)) {
    assert.ok(n.whole.chosen > 0 && n.picture.chosen.max <= 0.001 && n.picture.between.max <= 0.001, `the chosen ways make the same picture (${JSON.stringify(n.picture)})`);
    assert.match(n.verdict, /^kept: |not clearly faster/);
  }
  assert.deepEqual(r.kept ? r.kept.way : n.kept.map(() => 0), n.kept, 'what it keeps is what the editor will compile');
  assert.ok(!n.kept.some(Boolean) || /^kept: /.test(n.verdict));
  // the CPU: both builds, on one core and more, each a speed
  assert.deepEqual(n.cpu.notes, []);
  assert.ok(n.cpu.rows.length >= 2 && n.cpu.rows.every((x) => x.gmacs > 0 && x.runs >= x.cores) && ['conv', 'conv-fused'].every((b) => n.cpu.rows.some((x) => x.build === b)), JSON.stringify(n.cpu.rows));
  // the report, the copy key, the run kept, and its numbers among the editor's timings
  assert.match(r.text, /^Thunderhead network test · .* · took \d+ s\nGPU: .*half floats no \(the network runs in f32\)\nOne window \(96 x 96, 0\.01 MP\), each time the least of 1:/);
  assert.match(r.text, /\n +5 3x3 288>144 +[\d.]+ \| [\d.]+\*? \(0\) \| [\d.]+\*? \(0\) \| [\d.]+\*? \(0\)\n/);
  assert.match(r.text, /\nVerdict: /);
  assert.match(r.text, /\nThe CPU on the heavy pass's work \(\d+ cores?\), in thousand million multiply-adds a second:\n {2}multiply and add +1 core [\d.]+/);
  assert.equal(r.copy, false);
  assert.equal(r.last, n.at);
  assert.deepEqual([r.timing.kind, r.timing.at, r.timing.op5 > 0, r.timing.alt5 > 0, r.timing.wid5 > 0, r.timing.one5 > 0, r.timing.alt1, r.timing.wid3, r.timing.whole > 0, r.timing.cpu1 > 0], ['tune', n.at, true, true, true, true, -1, -1, true, true]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the picture decides: how far apart two pictures are, which ways are tried, and when a set is as true', () => {
  const px = (levels) => Uint32Array.from(levels.flatMap((v) => [v | (v << 16), v]));
  const a = px([0, 1000, 20000, 65535]), same = apart(a, a);
  assert.deepEqual(same, { mean: 0, p999: 0, max: 0 });
  const b = px([40, 1000, 20000, 65535]), d = apart(a, b);   // a difference in the deepest shadow counts for much
  assert.ok(d.max > 5 && d.max < 12 && d.mean > 1 && d.p999 >= d.mean, JSON.stringify(d));
  assert.ok(apart(a, px([0, 1000, 20040, 65535])).max < 0.3, 'the same difference in the light counts for little');
  // the fastest way of each pass that ran, was sane and was clearly faster; a way left out is passed over
  const tried = [[{ ms: -1 }, { ms: -1 }, { ms: -1 }], [{ ms: 80, rms: 0.001 }, { ms: 60, rms: 0.002 }, { ms: 95, rms: 0 }], [{ ms: 50, rms: 0.9 }, { ms: -1 }, { ms: 93, rms: 0 }], [{ ms: -2, why: 'x' }, { ms: -1 }, { ms: 70, rms: 0.01 }]];
  assert.deepEqual(fastest([5, 100, 100, 100], tried), [0, 2, 0, 3], 'pass 3: one way is wrong (not rounded), the other within what a timing wanders by');
  assert.deepEqual(fastest([5, 100, 100, 100], tried, new Set(['1:2'])), [0, 1, 0, 3]);
  // as true: no further from full floats than the exported half floats are, but for a little
  assert.equal(judge({ mean: 0.2, p999: 1.5, max: 4 }, { mean: 0.22, p999: 1.6, max: 9 }), true);
  assert.equal(judge({ mean: 0.2, p999: 1.5, max: 4 }, { mean: 0.3, p999: 1.6, max: 4 }), false);
  assert.equal(judge({ mean: 0.2, p999: 1.5, max: 4 }, { mean: 0.2, p999: 2.5, max: 4 }), false);
});
