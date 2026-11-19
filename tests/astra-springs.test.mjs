// Astra's springs (FEEL.md "Tokens"): the maths in src/ui/spring.js, and tokens.css carrying exactly
// what scripts/astra/springs.mjs makes of it, so the tokens cannot drift from their stiffness and damping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPRINGS, linearEasing, overshoot, position, samples, settleTime } from '../frontend/astra/src/ui/spring.js';
import { tokenLines, withSprings } from '../scripts/astra/springs.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/astra/springs.mjs', import.meta.url));
const TOKENS = readFileSync(new URL('../frontend/astra/src/styles/tokens.css', import.meta.url), 'utf8');

test('a spring starts at rest at 0 and settles on 1, whatever its damping', () => {
  for (const s of [...Object.values(SPRINGS), { stiffness: 100, damping: 20 }, { stiffness: 100, damping: 40 }]) {
    assert.equal(position(s, 0), 0);
    assert.ok(Math.abs(position(s, 3) - 1) < 1e-3, JSON.stringify(s));
    assert.ok(settleTime(s) > 0.05 && settleTime(s) < 3);
  }
  assert.ok(Math.abs(position({ stiffness: 100, damping: 20 }, 0.1) - (1 - Math.exp(-1) * 2)) < 1e-9, 'critical damping, by hand');
  assert.equal(overshoot({ stiffness: 100, damping: 40 }), 0, 'over-damped never passes its target');
});

test('the three springs keep the character FEEL.md gives them', () => {
  assert.ok(overshoot(SPRINGS.snappy) < 0.01, 'snappy: no visible overshoot');
  assert.ok(overshoot(SPRINGS.smooth) < 0.02, 'smooth: under 2%');
  assert.ok(overshoot(SPRINGS.lively) > 0.07 && overshoot(SPRINGS.lively) < 0.09, 'lively: about 8%');
  for (const s of Object.values(SPRINGS)) assert.ok(s.duration <= 450, 'nothing takes longer than 450 ms');
});

test('an easing runs from exactly 0 to exactly 1 in evenly spaced points', () => {
  const v = samples(SPRINGS.smooth);
  assert.equal(v[0], 0);
  assert.equal(v.at(-1), 1);
  assert.match(linearEasing(SPRINGS.snappy), /^linear\(0, [0-9., ]+, 1\)$/);
});

test('tokens.css carries the generated springs, and the check mode says so', () => {
  assert.equal(withSprings(TOKENS), TOKENS);
  for (const line of tokenLines()) assert.ok(TOKENS.includes(line + '\n'), line.slice(0, 30));
  assert.match(execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' }), /match/);
  const drifted = TOKENS.replace(/(--spring-smooth: linear\(0, )0\.\d+/, '$10.5');
  assert.notEqual(withSprings(drifted), drifted, 'a hand edit is caught');
  assert.throws(() => withSprings(TOKENS.replace(/^ {2}--spring-lively:.*$/m, '')), /no --spring-lively/);
});
