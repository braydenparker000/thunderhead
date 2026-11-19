// Spring maths for Astra's motion (FEEL.md "Tokens"): a mass of 1 on a spring of the given stiffness,
// slowed by the given damping, pulled from 0 to 1 from rest. Pure: no DOM. The CSS tokens
// --spring-snappy, --spring-smooth and --spring-lively are this module's output, written by
// scripts/astra/springs.mjs and checked against tokens.css by tests/astra-springs.test.mjs.

/** The three springs, with the duration each is used with (ms). */
export const SPRINGS = {
  snappy: {stiffness: 420, damping: 34, duration: 220},
  smooth: {stiffness: 240, damping: 27, duration: 380},
  lively: {stiffness: 320, damping: 22, duration: 420},
};

const SETTLED = 0.001; // within a thousandth of the target counts as there
const POINTS = 33; // samples in a linear() easing, evenly spaced

/** Position at `t` seconds of a spring released from 0 towards 1, at rest. */
export function position({stiffness, damping}, t) {
  const w0 = Math.sqrt(stiffness), zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1), r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** Seconds until the spring stays within SETTLED of its target (searched in 1 ms steps, up to 5 s). */
export function settleTime(spring) {
  let last = 0;
  for (let ms = 0; ms <= 5000; ms++) if (Math.abs(position(spring, ms / 1000) - 1) >= SETTLED) last = ms;
  return (last + 1) / 1000;
}

/** How far past the target the spring swings, as a fraction (0.02 is 2%). */
export function overshoot(spring) {
  const end = settleTime(spring);
  let most = 0;
  for (let ms = 0; ms <= end * 1000; ms++) most = Math.max(most, position(spring, ms / 1000) - 1);
  return most;
}

/** The spring's path over its settle time, as evenly spaced values from 0 to 1 (the last exactly 1). */
export function samples(spring, points = POINTS) {
  const end = settleTime(spring);
  return Array.from({length: points}, (_, i) => i === points - 1 ? 1 : i === 0 ? 0 : position(spring, end * i / (points - 1)));
}

/** A CSS `linear()` easing that follows the spring (the duration it plays over is the caller's). */
export function linearEasing(spring, points = POINTS) {
  return `linear(${samples(spring, points).map(v => String(Number(v.toFixed(4)))).join(', ')})`;
}

/** The easing for one of SPRINGS by name. */
export const easing = name => linearEasing(SPRINGS[name]);
