// One analytic spring for gestures and the CSS curves exported by the feel lab.
/** @typedef {{stiffness:number,damping:number}} Params */
/** @param {Partial<Params>} [params] */
export function spring({ stiffness = 380, damping = .8 } = {}) {
  if (!(stiffness > 0) || !(damping >= 0) || !Number.isFinite(stiffness + damping)) throw new RangeError('Invalid spring');
  const omega = Math.sqrt(stiffness);
  return { stiffness, damping, omega, response: 2 * Math.PI / omega };
}
// Spatial springs overshoot (lift: a disc's size .2→1.06→1); effects never do (fade) (GESTURES.md §3).
export const springs = { page: spring({ stiffness: 320, damping: .86 }), pop: spring({ stiffness: 900, damping: .55 }), ring: spring({ stiffness: 1100, damping: .7 }), island: spring({ stiffness: 130, damping: .82 }), lift: spring({ stiffness: 700, damping: .64 }), fade: spring({ stiffness: 3800, damping: 1 }) };
/** @param {keyof typeof springs} name @param {Partial<Params>} params */
export function setSpring(name, params) { return springs[name] = spring({ ...springs[name], ...params }); }
// The owner's Springs (Settings → Appearance, `data-feel` on <html>): calm lands without a bounce
// and a little slower, lively bounces more. Applied once, to every spring, as this module loads.
const FEEL = { calm: { k: .85, d: .14 }, lively: { k: 1.1, d: -.1 } }[globalThis.document?.documentElement.dataset.feel ?? ''];
if (FEEL) for (const name of /** @type {(keyof typeof springs)[]} */ (Object.keys(springs))) setSpring(name, { stiffness: springs[name].stiffness * FEEL.k, damping: Math.min(1, Math.max(.3, springs[name].damping + FEEL.d)) });

/** Exact state after seconds; velocity is in units/second. @param {Params} p @param {number} seconds */
export function response(p, seconds, value = 0, velocity = 0, target = 1) {
  const w = Math.sqrt(p.stiffness), a = p.damping * w, y = value - target;
  let x, v;
  if (p.damping > 1) {
    const d = w * Math.sqrt(p.damping ** 2 - 1), r = -p.stiffness / (a + d), s = -a - d;
    const A = (velocity - s * y) / (r - s), B = y - A;
    const u = A * Math.exp(r * seconds), z = B * Math.exp(s * seconds);
    x = u + z; v = r * u + s * z;
  } else {
    const d = w * Math.sqrt(1 - p.damping ** 2), e = Math.exp(-a * seconds);
    const c = Math.cos(d * seconds), s = d ? Math.sin(d * seconds) / d : seconds;
    x = e * (y * c + (velocity + a * y) * s);
    v = e * (velocity * c - (a * velocity + p.stiffness * y) * s);
  }
  return { value: target + x, velocity: v };
}

/** @type {{requestFrame:(f:FrameRequestCallback)=>unknown,now:()=>number,matchMedia:(q:string)=>{matches:boolean},vibrate:(p:number[])=>unknown,reduced:boolean|null,haptics:boolean}} */
const config = { requestFrame: f => requestAnimationFrame(f), now: () => performance.now(), matchMedia: q => matchMedia(q), vibrate: p => navigator.vibrate?.(p), reduced: null, haptics: true };
export const motionSettings = () => ({ reduced: config.reduced, haptics: config.haptics });
/** @param {Partial<typeof config>} [options] */
export function configureMotion(options = {}) { Object.assign(config, options); return motionSettings(); }
// The owner's Reduced motion and Haptics (Settings → More appearance) ride on <html> as data attributes.
const owner = (/** @type {string} */ name) => globalThis.document?.documentElement.dataset[name];
export const motionReduced = () => config.reduced ?? ({ always: true, never: false }[owner('reducedMotion') ?? ''] ?? config.matchMedia('(prefers-reduced-motion: reduce)').matches);
/** A tap back (ms, or a pattern of pulses and gaps): none with Haptics off, pulses twice as long with
 * it full. @param {number | number[]} p */
export function buzz(p) { const h = owner('haptics'), list = [p].flat(); if (config.haptics && h !== 'off') try { config.vibrate(h === 'full' ? list.map((ms, i) => i % 2 ? ms : ms * 2) : list); } catch {} }
/** @param {'open'|'choose'|'commit'} kind */
export function haptic(kind) { buzz({ open: 8, choose: 4, commit: 10 }[kind]); }

/** @type {Set<(time:number)=>void>} */
const moving = new Set();
/** @type {Set<()=>void>} */
const idle = new Set();
/** Resolves when all current engine motion rests, including retargeting. @returns {Promise<void>} */
export function whenResting() { return moving.size ? new Promise(resolve => idle.add(resolve)) : Promise.resolve(); }
let queued = false;
function schedule() {
  if (queued || !moving.size) return;
  queued = true;
  config.requestFrame(time => { queued = false; for (const move of [...moving]) if (moving.has(move)) move(time); schedule(); });
}

/** @param {(value:number,velocity:number)=>void} onFrame @param {{unit?:'px'|'scalar'|'opacity'}} [options] */
export function animator(onFrame, { unit = 'px' } = {}) {
  let value = 0, velocity = 0, target = 0, travel = 0, last = 0, scale = 1;
  let elapsed = 0, origin = 0, linear = false, params = springs.page;
  /** @type {Set<()=>void>} */
  const waiting = new Set();
  const stopped = () => { moving.delete(move); velocity = 0; for (const done of waiting) done(); waiting.clear(); if (!moving.size) { for (const done of idle) done(); idle.clear(); } };
  const resting = () => Math.abs(target - value) <= Math.max(unit === 'px' ? .1 : 1e-6, travel * .01) && Math.abs(velocity) <= Math.max(unit === 'px' ? .5 : 1e-6, travel * .02);
  const set = (/** @type {number} */ next) => { value = target = next; stopped(); onFrame(value, velocity); };
  function move(/** @type {number} */ time) {
    const dt = Math.max(0, Math.min(32, time - last)) / 1000; last = Math.max(last, time);
    if (motionReduced()) {
      if (unit !== 'opacity') { set(target); return; }
      if (!linear) { origin = value; elapsed = 0; linear = true; }
      elapsed += dt; value = origin + (target - origin) * Math.min(1, elapsed / .15);
      velocity = (target - origin) / .15;
      if (elapsed >= .15 - 1e-9) { value = target; stopped(); }
    } else {
      linear = false;
      const next = response(params, dt / scale, value, velocity * scale, target);
      value = next.value; velocity = next.velocity / scale;
      if (resting()) { value = target; stopped(); }
    }
    onFrame(value, velocity);
  }
  return {
    /** @param {number} next @param {{velocity?:number,spring?:ReturnType<typeof spring>,timeScale?:number}} [options] */
    to(next, options = {}) {
      const nextScale = options.timeScale ?? 1;
      if (!(nextScale > 0) || !Number.isFinite(nextScale)) throw new RangeError('Invalid time scale');
      target = next; travel = Math.abs(target - value); params = options.spring ?? params;
      scale = nextScale;
      velocity = options.velocity ?? velocity; last = config.now(); linear = false;
      if ((motionReduced() && unit !== 'opacity') || resting()) { set(target); return; }
      moving.add(move); schedule();
    },
    set, stop: stopped,
    get value() { return value; }, get velocity() { return velocity; }, get resting() { return !moving.has(move); },
    /** @returns {Promise<void>} */
    whenResting() { return moving.has(move) ? new Promise(done => { waiting.add(done); }) : Promise.resolve(); },
  };
}

/** First relative rest, at millisecond resolution, for a scalar 0→1 move. @param {Params} params */
export function restTime(params) {
  for (let ms = 0; ms <= 10000; ms++) {
    const r = response(params, ms / 1000);
    if (Math.abs(1 - r.value) <= .01 && Math.abs(r.velocity) <= .02) return ms;
  }
  return Infinity;
}

/** Adaptive error subdivision, including quarter points to catch inflections. @param {Params} params @param {number} durationMs */
export function linearCurve(params, durationMs) {
  const points = [[0, 0], [1, 1]];
  while (points.length < 32) {
    let worst = .001, at = 0, point = [0, 0];
    for (let i = 1; i < points.length; i++) {
      const [a, x] = points[i - 1], [b, y] = points[i];
      if (b - a < 1e-5) continue;
      for (const f of [.25, .5, .75]) {
        const t = a + (b - a) * f, v = response(params, t * durationMs / 1000).value;
        const error = Math.abs(v - (x + (y - x) * f));
        if (error > worst) { worst = error; at = i; point = [t, v]; }
      }
    }
    if (!at) break;
    points.splice(at, 0, point);
  }
  return `linear(${points.map(([t, v]) => `${+v.toFixed(5)} ${+(t * 100).toFixed(5)}%`).join(', ')})`;
}
