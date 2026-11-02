import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { animator, configureMotion, haptic, linearCurve, motionReduced, motionSettings, response, restTime, setSpring, spring, springs } from '../frontend/th/motion.js';

const css = await readFile(new URL('../frontend/ui/tokens.css', import.meta.url), 'utf8');
const tokens = name => css.match(new RegExp(`--${name}:linear\\(([^)]+)\\)`))[1].split(',').map(Number);
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}, tolerance ${tolerance}`);

function clock(t, reduced = false) {
  let now = 0;
  const frames = [], animations = [], vibrations = [];
  configureMotion({ requestFrame: f => frames.push(f), now: () => now, matchMedia: () => ({ matches: reduced }), vibrate: p => vibrations.push(p), reduced: null, haptics: true });
  const tick = ms => { now += ms; for (const frame of frames.splice(0)) frame(now); };
  const make = (callback = () => {}, options = { unit: 'scalar' }) => { const a = animator(callback, options); animations.push(a); return a; };
  t.after(() => { animations.forEach(a => a.stop()); tick(0); configureMotion({ reduced: null, haptics: true }); });
  return { tick, make, frames, vibrations, get now() { return now; } };
}

test('the running analytic engine matches every existing page and pop curve sample', t => {
  const c = clock(t);
  for (const [name, token, duration] of [['page', 'settle', 410], ['pop', 'pop', 345]]) {
    const values = tokens(token);
    assert.equal(values.length, 25);
    const a = c.make();
    a.to(1, { spring: springs[name] });
    close(a.value, values[0], .01);
    for (let i = 1; i < values.length; i++) {
      c.tick(duration / 24);
      close(a.value, values[i], .01);
      close(a.value, response(springs[name], duration * i / 24000).value);
    }
    a.stop(); c.tick(0);
  }
});

test('analytic updates compose for underdamped, critical and overdamped motion', () => {
  for (const damping of [.4, 1, 1.6]) {
    const p = spring({ stiffness: 380, damping });
    const first = response(p, .027, .3, -2, .8);
    const composed = response(p, .031, first.value, first.velocity, .8);
    const whole = response(p, .058, .3, -2, .8);
    close(composed.value, whole.value);
    close(composed.velocity, whole.velocity);
    assert.ok(Number.isFinite(response(p, 100).value));
    close(response(p, 100).value, 1);
  }
});

test('overshoot, monotone critical/overdamped approach and rest reflect the physical parameters', () => {
  for (const damping of [.6, .8, 1, 1.6]) {
    const p = spring({ stiffness: 800, damping });
    const values = Array.from({ length: 1001 }, (_, i) => response(p, i / 1000).value);
    const peak = Math.max(...values);
    if (damping === .6) assert.ok(peak >= 1.06 && peak <= 1.14, `${peak}`);
    if (damping >= 1) {
      assert.ok(peak <= 1);
      values.slice(1).forEach((v, i) => assert.ok(v >= values[i], `${damping}: ${i}`));
    }
    const ms = restTime(p), at = response(p, ms / 1000);
    assert.ok(Math.abs(1 - at.value) <= .01 && Math.abs(at.velocity) <= .02);
    if (damping >= .8 && damping <= 1) assert.ok(ms / 1000 <= 2.5 * p.response);
  }
});

test('one frame loop serves all animators and stops when they rest', async t => {
  const c = clock(t), a = c.make(), b = c.make();
  a.to(1); b.to(2);
  assert.equal(c.frames.length, 1);
  const done = Promise.all([a.whenResting(), b.whenResting()]);
  for (let i = 0; i < 150 && c.frames.length; i++) { c.tick(16); assert.ok(c.frames.length <= 1); }
  await done;
  assert.equal(a.resting, true); assert.equal(b.resting, true);
  assert.equal(a.value, 1); assert.equal(b.value, 2);
  assert.equal(a.velocity, 0); assert.equal(c.frames.length, 0);
});

test('stopping another animator during a shared frame prevents its stale callback', t => {
  const c = clock(t);
  let other, frames = 0;
  const a = c.make(() => other.stop());
  other = c.make(() => frames++);
  a.to(1); other.to(1); c.tick(16);
  assert.equal(frames, 0); assert.equal(other.value, 0); assert.equal(other.resting, true);
});

test('retargeting retains the current state and carries velocity without a discontinuity', t => {
  const c = clock(t), a = c.make();
  a.to(1); c.tick(32); c.tick(32);
  const x = a.value, v = a.velocity;
  assert.ok(v > 0);
  a.to(-1);
  assert.equal(a.value, x); assert.equal(a.velocity, v);
  c.tick(1);
  const exact = response(springs.page, .001, x, v, -1);
  close(a.value, exact.value); close(a.velocity, exact.velocity);
  assert.ok(Math.abs(a.value - x) <= Math.max(Math.abs(v), Math.abs(a.velocity)) * .001);
});

test('an injected velocity away from the target first travels away', t => {
  const c = clock(t), a = c.make();
  a.set(1); a.to(0, { velocity: 4 }); c.tick(4);
  assert.ok(a.value > 1); assert.ok(a.velocity > 0);
});

test('clock scaling preserves real-world velocity, including when retargeted', t => {
  const c = clock(t), a = c.make();
  a.to(1, { velocity: 2, timeScale: 2 }); c.tick(20);
  const expected = response(springs.page, .01, 0, 4, 1);
  close(a.value, expected.value); close(a.velocity, expected.velocity / 2);
  const x = a.value, v = a.velocity;
  a.to(-1, { timeScale: .5 }); c.tick(10);
  const retargeted = response(springs.page, .02, x, v * .5, -1);
  close(a.value, retargeted.value); close(a.velocity, retargeted.velocity / .5);
  const before = [a.value, a.velocity];
  assert.throws(() => a.to(100, { timeScale: 0 }), RangeError);
  assert.deepEqual([a.value, a.velocity], before);
  c.tick(10); assert.ok(Number.isFinite(a.value));
});

test('a long frame advances at most 32 ms and identical runs are deterministic', t => {
  const c = clock(t), a = c.make(), b = c.make();
  a.to(1); b.to(1);
  c.tick(1000);
  close(a.value, response(springs.page, .032).value);
  for (const ms of [1, 9, 17, 32, 500, 16]) { c.tick(ms); assert.equal(a.value, b.value); assert.equal(a.velocity, b.velocity); }
});

test('relative rest scales with travel and pixel floors never cause scalar jumps', t => {
  const c = clock(t), large = c.make(), tiny = c.make(), pixels = c.make(() => {}, { unit: 'px' });
  large.to(1); tiny.to(.01); pixels.to(.05);
  assert.equal(pixels.value, .05); assert.equal(pixels.resting, true);
  assert.equal(tiny.value, 0); assert.equal(tiny.resting, false);
  for (let i = 0; i < 100 && !large.resting; i++) {
    c.tick(16); close(tiny.value, large.value * .01); assert.equal(tiny.resting, large.resting);
  }
  assert.equal(large.resting, true);
});

test('set and stop finish waiters without keeping the frame loop alive', async t => {
  const c = clock(t), a = c.make();
  a.to(1); const stopped = a.whenResting(); c.tick(16);
  const x = a.value; a.stop(); await stopped;
  assert.equal(a.value, x); assert.equal(a.velocity, 0);
  c.tick(16); assert.equal(c.frames.length, 0);
  a.to(1); const set = a.whenResting(); a.set(.4); await set;
  assert.equal(a.value, .4); assert.equal(a.resting, true);
});

test('reduced motion is immediate except for a 150 ms linear opacity fade', async t => {
  const c = clock(t, true), a = c.make(), opacity = c.make(() => {}, { unit: 'opacity' });
  assert.equal(motionReduced(), true);
  a.to(1); assert.equal(a.value, 1); assert.equal(a.resting, true);
  opacity.to(1); const done = opacity.whenResting();
  for (let i = 1; i <= 6; i++) { c.tick(25); close(opacity.value, i / 6); }
  await done; assert.equal(opacity.resting, true);
  configureMotion({ reduced: false }); assert.equal(motionReduced(), false);
  configureMotion({ reduced: null }); assert.equal(motionReduced(), true);
});

test('forcing reduced motion finishes a running spatial animation', t => {
  const c = clock(t), a = c.make();
  a.to(1); c.tick(16); assert.ok(a.value < 1);
  configureMotion({ reduced: true }); c.tick(16);
  assert.equal(a.value, 1); assert.equal(a.resting, true);
});

test('haptics are named, optional, injectable and safe when unavailable', t => {
  const c = clock(t);
  haptic('open'); haptic('choose'); haptic('commit');
  assert.deepEqual(c.vibrations, [[8], [4], [10]]);
  configureMotion({ haptics: false }); haptic('commit'); assert.equal(c.vibrations.length, 3);
  assert.deepEqual(motionSettings(), { reduced: null, haptics: false });
  configureMotion({ haptics: true, vibrate: () => { throw new Error('unsupported'); } });
  assert.doesNotThrow(() => haptic('open'));
});

test('the spring registry replaces a preset without mutating old parameters', () => {
  const before = springs.ring;
  try {
    const next = setSpring('ring', { stiffness: 700, damping: .75 });
    assert.notEqual(next, before); assert.equal(springs.ring, next);
    close(next.response, 2 * Math.PI / Math.sqrt(700));
    assert.equal(setSpring('ring', { stiffness: 900 }).damping, .75);
    assert.throws(() => spring({ stiffness: 0 }), RangeError);
    assert.throws(() => spring({ damping: -1 }), RangeError);
  } finally { setSpring('ring', before); }
});

test('CSS curves adapt to curvature, have ordered percentages, and retain the token response', () => {
  for (const [name, token, ms] of [['page', 'settle', 410], ['pop', 'pop', 345]]) {
    const text = linearCurve(springs[name], ms);
    const pairs = [...text.matchAll(/(-?[\d.]+) ([\d.]+)%/g)].map(m => [Number(m[2]) / 100, Number(m[1])]);
    assert.match(text, /^linear\(0 0%, .*1 100%\)$/);
    assert.ok(pairs.length > 2 && pairs.length <= 32);
    pairs.slice(1).forEach(([p], i) => assert.ok(p > pairs[i][0]));
    const gaps = pairs.slice(1).map(([p], i) => (p - pairs[i][0]).toFixed(6));
    assert.ok(new Set(gaps).size > 1, 'samples are adaptive');
    for (const [i, expected] of tokens(token).entries()) {
      const t = i / 24, next = pairs.findIndex(([p]) => p >= t);
      if (next === 0) { close(pairs[0][1], expected, .01); continue; }
      const [a, x] = pairs[next - 1], [b, y] = pairs[next];
      close(x + (y - x) * (t - a) / (b - a), expected, .01);
    }
    assert.equal(linearCurve(springs[name], ms), text);
  }
});

test('curves keep distinct percentages when the chosen span ends before the spring settles', () => {
  for (const p of [spring({ stiffness: 100, damping: .5 }), spring({ stiffness: 1600, damping: 1 }), spring({ stiffness: 380, damping: 2.5 })]) {
    const pairs = [...linearCurve(p, 410).matchAll(/(-?[\d.]+) ([\d.]+)%/g)].map(m => [Number(m[2]), Number(m[1])]);
    assert.ok(pairs.length <= 32);
    assert.deepEqual(pairs[0], [0, 0]); assert.deepEqual(pairs.at(-1), [100, 1]);
    pairs.slice(1).forEach(([p, v], i) => { assert.ok(p > pairs[i][0]); assert.ok(Number.isFinite(v)); });
  }
});
