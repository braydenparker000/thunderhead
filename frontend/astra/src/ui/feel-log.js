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
  const end = now();
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
  loop();
  let result;
  try { result = fn(); } catch (error) { finish(run, true); throw error; }
  const done = result && typeof result.finished?.then === 'function' ? result.finished : typeof result?.then === 'function' ? result : null;
  if (done) done.then(v => finish(run, v?.cancelled), () => finish(run, true));
  else finish(run, false);
  return result;
}

/** The runs kept, oldest first (copies). */
export const feelEntries = () => entries.map(e => ({...e}));
/** Empties the log (tests). */
export function clearFeelLog() { entries.length = 0; }

const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const pad = (v, n) => String(v).padStart(n);

/**
 * The report as plain text: a heading with the settings it was made under, one line per name
 * (runs, median and slowest ms, frames a second, the worst gap between frames, interruptions),
 * then the last 20 runs as they happened. `info` holds fixed words only (the motion level, haptics).
 */
export function reportText(list, info = {}) {
  const lines = ['Astra feel report', Object.entries(info).map(([k, v]) => `${cleanName(k)} ${cleanName(v)}`).join(' · '), `${list.length} transitions`, ''];
  const names = [...new Set(list.map(e => e.name))].sort();
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
