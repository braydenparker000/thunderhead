// Each long task after start-up, named, for the recorder (ui/feel-log.js `longWork`, MUSIC.md §5.11 "Idle
// work"): the fourth phone report counted 63 long tasks in 198 s and could not say what ran in them. A task
// of 50 ms or more that began after start-up (10 s) is listed with when it began, its ms, and what ran:
// `idle:<job>` when an idle job's piece ran in it (view/idle-work.js), else the handler the browser names
// (Long Animation Frames: the script's invoker, its function and file, e.g. "PointerEvent onPointerUp
// input.js"), else "unnamed". The longest piece of each idle job is kept too. Numbers and code names only.

const AFTER_MS = 10_000, KEEP = 60, PIECES = 40;
export const longWork = {count: 0, totalMs: 0, tasks: [], pieces: [], longestPiece: {}};

/** An idle job's piece ran from at for ms (view/idle-work.js). */
export function pieceRan(name, at, ms) {
  const lp = longWork.longestPiece;
  if (!(lp[name] >= ms)) lp[name] = Math.round(ms);
  if (ms < 20) return;
  longWork.pieces.push({name, at, end: at + ms});
  if (longWork.pieces.length > PIECES) longWork.pieces.shift();
}

/** What ran in a task from at for ms: an idle job's name, else ''. */
export function idleAt(at, ms) {
  for (let i = longWork.pieces.length - 1; i >= 0; i--) {
    const p = longWork.pieces[i];
    if (p.at < at + ms && p.end > at) return 'idle:' + p.name;
  }
  return '';
}

/** A script of a long animation frame, named "invoker function file" (no address). */
const scriptName = s => [s.invoker, s.sourceFunctionName, String(s.sourceURL || '').split('/').pop()].filter(Boolean).join(' ');

function add(at, ms, what) {
  longWork.count++;
  longWork.totalMs += ms;
  longWork.tasks.push({at: Math.round(at), ms: Math.round(ms), what});
  if (longWork.tasks.length > KEEP) longWork.tasks.shift();
}

try {
  if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.startTime < AFTER_MS || !(e.blockingDuration > 0)) continue;
        const top = [...(e.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
        add(e.startTime, e.duration, idleAt(e.startTime, e.duration) || (top ? scriptName(top) : 'unnamed'));
      }
    }).observe({type: 'long-animation-frame', buffered: false});
  } else {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (e.startTime >= AFTER_MS) add(e.startTime, e.duration, idleAt(e.startTime, e.duration) || 'unnamed');
    }).observe({type: 'longtask', buffered: false});
  }
} catch { /* no long task timing */ }

/** The report: the count and total after start-up, each named task (the last KEEP), each idle job's longest piece. */
export function longWorkReport() {
  return {count: longWork.count, totalMs: Math.round(longWork.totalMs), tasks: longWork.tasks.slice(), longestPiece: {...longWork.longestPiece}};
}
