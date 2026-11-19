// The shell's feel report as plain text (Settings › About › "Copy feel report"), laid out as Astra's
// (astra/src/ui/feel-log.js reportText): the screen's measured refresh rate and what it was made under, a table
// with a line per movement, then what froze in the ten worst gaps, then the last movements as they happened.
// Numbers and fixed names only: never an address, a title or anything the owner wrote.

import {frozeText} from './frames.js';
import {cleanName, feelEntries, framesWatched, level, measureRefresh, refreshRate} from './log.js';

const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const pad = (v, n) => String(v).padStart(n);

/**
 * The report from `list` (movements as feelEntries() gives them), `info` (fixed words: {motion: 'full', ...}),
 * `screen` ({hz, ms} or null) and `frames` (what the browser reports of long frames: 'long-animation-frame',
 * 'longtask' or 'none'). A movement's fps is over the time its frames were counted (home's start: from when this
 * log loaded), '-' when none were.
 */
export function reportText(list, info = {}, screen = null, frames = 'long-animation-frame') {
  const rate = screen?.hz ? `screen ${screen.hz} Hz (median frame ${screen.ms} ms over a quiet second)` : 'screen not measured yet';
  const lines = [`Thunderhead feel report · ${rate}`, Object.entries(info).map(([k, v]) => `${cleanName(k)} ${cleanName(v)}`).join(' · '), `${list.length} movements`, ''];
  lines.push('name                                       runs  med ms  max ms  fps  worst gap  cut');
  for (const name of [...new Set(list.map(e => e.name))].sort()) {
    const runs = list.filter(e => e.name === name);
    const ms = runs.map(e => e.ms), fps = runs.map(e => [e.frames, e.counted ?? e.ms]).filter(([f, c]) => f > 0 && c > 0).map(([f, c]) => Math.round(f * 1000 / c));
    lines.push(`${cleanName(name).padEnd(42)}${pad(runs.length, 5)}${pad(median(ms), 8)}${pad(Math.max(...ms), 8)}${pad(fps.length ? median(fps) : '-', 5)}${pad(Math.max(...runs.map(e => e.worstGap)), 11)}${pad(runs.filter(e => e.interrupted).length, 5)}`);
  }
  lines.push('', ...frozeText(list, frames, cleanName));
  lines.push('', 'last movements (name, ms, frames, worst gap, cut)');
  for (const e of list.slice(-20)) lines.push(`${cleanName(e.name)} ${e.ms} ${e.frames} ${e.worstGap}${e.interrupted ? ' cut' : ''}`);
  return lines.join('\n');
}

/** What the phone's own settings say of motion, as fixed words. */
function made() {
  const d = document.documentElement.dataset;
  return {motion: level(), 'reduced-motion': d.reducedMotion || 'system', springs: d.feel || 'regular', haptics: d.haptics || 'light'};
}

/** The feel log as plain text now; the refresh rate is measured afresh for the next one. */
export function feelReport() {
  const text = reportText(feelEntries(), made(), refreshRate(), framesWatched());
  measureRefresh();
  return text;
}
