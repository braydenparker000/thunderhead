// The feel log (FEEL.md "The feel log"): every named transition ui/motion.js runs is timed here,
// with how many frames it drew, the longest gap between two, and whether it was interrupted, in a
// small ring kept in memory only. Settings › About › "Copy feel report" copies it as plain text:
// numbers and fixed names only, never a title, an address or anything the owner typed.

const RING = 150; // runs kept, newest last
const entries = [];
const running = new Set();
let looping = false;

/** A transition's name as the report may carry it: lower-case letters, digits and : . _ - only. */
export const cleanName = name => String(name || 'unnamed').toLowerCase().replace(/[^a-z0-9:._-]+/g, '-').slice(0, 40) || 'unnamed';

const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const pad = (v, n) => String(v).padStart(n);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function loop() {
  if (looping || typeof requestAnimationFrame !== 'function') return;
  looping = true;
  const frame = t => {
    for (const run of running) { run.frames++; run.worst = Math.max(run.worst, t - run.last); run.last = t; }
    if (running.size) requestAnimationFrame(frame); else looping = false;
  };
  requestAnimationFrame(frame);
}

function finish(run, interrupted) {
  if (!running.delete(run)) return;
  const end = busyAt = now();
  entries.push({name: run.name, ms: Math.round(end - run.start), frames: run.frames, worstGap: Math.round(Math.max(run.worst, end - run.last)), interrupted: !!interrupted});
  if (entries.length > RING) entries.splice(0, entries.length - RING);
}

/**
 * Runs fn() and times it under `name` until what it returns is done: a handle's `finished`
 * (resolving to {cancelled}) or a promise; anything else counts as done at once. Returns fn's result.
 */
export function timed(name, fn) {
  const start = now();
  const run = {name: cleanName(name), start, last: start, frames: 0, worst: 0};
  running.add(run);
  busyAt = start;
  loop();
  let result;
  try { result = fn(); } catch (error) { finish(run, true); throw error; }
  const done = result && typeof result.finished?.then === 'function' ? result.finished : typeof result?.then === 'function' ? result : null;
  if (done) done.then(v => finish(run, v?.cancelled), () => finish(run, true));
  else finish(run, false);
  return result;
}

// The screen's refresh rate as this page sees it: the median time between frames over a quiet second, so the
// report's "fps" can be read against what the phone can do. Quiet means no transition for 2 s, no touch, and no
// film playing; a second that stops being quiet is dropped and tried again later (waits doubling to 30 s), so the
// sampling never runs beside the owner's use of the app or a film (it is a second of frames drawn for nothing).
let refresh = null, sampling = false, busyAt = 0;
const touched = () => { busyAt = now(); };
const playing = () => typeof document !== 'undefined' && [...document.getElementsByTagName('video')].some(v => !v.paused && !v.ended);
const quiet = () => !running.size && now() - busyAt > 2000 && !playing();
/** Measures it once a second is quiet (see above). Returns at once. */
export function measureRefresh({wait = 2000} = {}) {
  if (sampling || typeof requestAnimationFrame !== 'function') return;
  sampling = true;
  if (typeof addEventListener === 'function') addEventListener('pointerdown', touched, {capture: true, passive: true});
  const later = () => { sampling = false; measureRefresh({wait: Math.min(wait * 2, 30000)}); };
  setTimeout(() => {
    if (!quiet()) { later(); return; }
    const gaps = [];
    let last = null, start = null;
    const frame = t => {
      if (!quiet()) { later(); return; } // not quiet after all: later
      if (last != null) gaps.push(t - last);
      last = t; start ??= t;
      if (t - start < 1000) { requestAnimationFrame(frame); return; }
      sampling = false;
      const ms = median(gaps);
      if (ms > 0) refresh = {ms: Math.round(ms * 10) / 10, hz: Math.round(1000 / ms)};
    };
    requestAnimationFrame(frame);
  }, wait);
}
/** The last measured refresh: {hz, ms} or null. */
export const refreshRate = () => refresh;

/** The runs kept, oldest first (copies). */
export const feelEntries = () => entries.map(e => ({...e}));
/** Empties the log (tests). */
export function clearFeelLog() { entries.length = 0; }


/** A press is in the table only when it went badly (a gap over this): a press is short, and ends at its release. */
export const PRESS_BAD_GAP = 50;

/**
 * The report as plain text: a heading with the screen's measured refresh rate (`screen`: {hz, ms}, or
 * null) and the settings it was made under, one line per name (runs, median and slowest ms, frames a
 * second, the worst gap between frames, interruptions; `press` only when its worst gap is over
 * PRESS_BAD_GAP), then the last 20 runs as they happened. `info` holds fixed words only.
 */
export function reportText(list, info = {}, screen = null) {
  const rate = screen?.hz ? `screen ${screen.hz} Hz (median frame ${screen.ms} ms over a quiet second)` : 'screen not measured yet';
  const lines = [`Astra feel report · ${rate}`, Object.entries(info).map(([k, v]) => `${cleanName(k)} ${cleanName(v)}`).join(' · '), `${list.length} transitions`, ''];
  const names = [...new Set(list.map(e => e.name))].sort().filter(n => n !== 'press' || list.some(e => e.name === n && e.worstGap > PRESS_BAD_GAP));
  lines.push('name                                       runs  med ms  max ms  fps  worst gap  cut');
  for (const name of names) {
    const runs = list.filter(e => e.name === name);
    const ms = runs.map(e => e.ms), fps = runs.map(e => e.ms > 0 ? Math.round(e.frames * 1000 / e.ms) : 0);
    lines.push(`${cleanName(name).padEnd(42)}${pad(runs.length, 5)}${pad(median(ms), 8)}${pad(Math.max(...ms), 8)}${pad(median(fps), 5)}${pad(Math.max(...runs.map(e => e.worstGap)), 11)}${pad(runs.filter(e => e.interrupted).length, 5)}`);
  }
  lines.push('', 'last runs (name, ms, frames, worst gap, cut)');
  for (const e of list.slice(-20)) lines.push(`${cleanName(e.name)} ${e.ms} ${e.frames} ${e.worstGap}${e.interrupted ? ' cut' : ''}`);
  return lines.join('\n');
}
