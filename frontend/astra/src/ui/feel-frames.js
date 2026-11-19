// What froze (the feel report's last part; ui/feel-log.js): the main thread's long frames as the browser itself
// reports them (the Long Animation Frames API, Chrome 123+; the older Long Tasks API, without scripts, where it is
// missing; nothing where neither is), each kept with the named transitions it fell in. A frame is kept scrubbed:
// numbers, and fixed names only. A script is named by its file's NAME when it is one of Astra's own (the last
// segment of its address, never the address, a query or a fragment), "unknown" when the browser names none, else "other"; a function by its name only
// in Astra's own code; the kind of call (a timer, a frame callback, an idle callback, an observer, a promise, an
// event listener and its event, a module's evaluation, a script). Nothing an add-on, a film or the owner wrote.

/** A frame is long from here (what the browser reports), and a run keeps this many of its longest, each with its top scripts. */
export const LONG_MS = 50, KEEP = 2, SCRIPTS = 3;

/** Astra's own folder (frontend/astra/): its modules, its vendored libraries, the lab. */
const ROOT = new URL('../../', import.meta.url).href;

/**
 * A script's address as the report may carry it: its file's name when it is Astra's own, 'unknown' when the browser
 * gives none (code resumed after an await on a timer or a promise has no file of its own), else 'other'.
 */
export function scriptFile(url, root = ROOT) {
  const s = String(url || '');
  if (!s) return 'unknown';
  if (!root || !s.startsWith(root)) return 'other';
  const name = s.slice(root.length).split(/[?#]/)[0].split('/').pop();
  return /^[a-z0-9][a-z0-9._-]{0,60}\.m?js$/i.test(name) ? name : 'other';
}

/** A function's name as the report may carry it (an identifier, at most 40 characters), or ''. */
const fnName = n => (/^[A-Za-z_$][\w$.]{0,39}$/.test(String(n || '')) ? n : '');

/** The kind of call from the API's invokerType and invoker: timer, frame, idle, observer, callback, promise, event <name>, module, script, other. */
export function callKind(type, invoker = '') {
  const inv = String(invoker || '');
  if (type === 'user-callback') return /^TimerHandler/.test(inv) ? 'timer' : /AnimationFrame|FrameRequest/.test(inv) ? 'frame' : /Idle/.test(inv) ? 'idle' : /Observer/.test(inv) ? 'observer' : 'callback';
  if (type === 'event-listener') { const e = /\.on([a-z]{1,24})$/i.exec(inv); return e ? `event ${e[1].toLowerCase()}` : 'event'; }
  if (type === 'resolve-promise' || type === 'reject-promise') return 'promise';
  if (type === 'module-script') return 'module';
  if (type === 'classic-script') return 'script';
  return 'other';
}

const ms = v => Math.max(0, Math.round(Number(v) || 0));

/**
 * A performance entry as kept: {at, ms, blocked, style, scripts: [{file, fn, kind, ms, forced}]} (style: its
 * style-and-layout ms, null when unknown; the top SCRIPTS scripts, longest first). `root` is Astra's folder.
 */
export function frameOf(entry, root = ROOT) {
  const end = entry.startTime + entry.duration;
  const scripts = [...(entry.scripts || [])].sort((a, b) => b.duration - a.duration).slice(0, SCRIPTS).map(s => {
    const file = scriptFile(s.sourceURL, root);
    return {file, fn: file === 'other' || file === 'unknown' ? '' : fnName(s.sourceFunctionName), kind: callKind(s.invokerType, s.invoker), ms: ms(s.duration), forced: ms(s.forcedStyleAndLayoutDuration)};
  });
  const long = entry.entryType === 'long-animation-frame';
  return {at: entry.startTime, end, ms: ms(entry.duration), blocked: ms(long ? entry.blockingDuration : entry.duration - LONG_MS),
    style: long && entry.styleAndLayoutStart > 0 ? ms(end - entry.styleAndLayoutStart) : null, scripts, task: !long};
}

/** Keeps `frame` with `run` ({froze}) when it is among its KEEP longest. */
export function keep(run, frame) {
  const list = (run.froze ??= []);
  if (list.some(f => f.at === frame.at)) return;
  list.push(frame);
  list.sort((a, b) => b.ms - a.ms);
  if (list.length > KEEP) list.length = KEEP;
}

/**
 * Watches the main thread's long frames and hands each, kept, to `onFrame(frame)`. Returns what is watched:
 * 'long-animation-frame', 'longtask', or 'none'.
 */
export function watchFrames(onFrame) {
  if (typeof PerformanceObserver !== 'function') return 'none';
  const types = PerformanceObserver.supportedEntryTypes || [];
  for (const type of ['long-animation-frame', 'longtask']) {
    if (!types.includes(type)) continue;
    try {
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (e.duration >= LONG_MS) onFrame(frameOf(e)); }).observe({type, buffered: true});
      return type;
    } catch {}
  }
  return 'none';
}

/** A script's line: "player-screen.js PlayerScreen module 610" (forced style and layout added when it is 5 ms or more). */
const scriptLine = s => [s.file, s.fn, s.kind, s.ms, s.forced >= 5 ? `forced layout ${s.forced}` : ''].filter(Boolean).join(' ');

/**
 * "What froze" for the ten worst gaps of `list` (runs with {name, worstGap, froze}): each run's name and gap, then
 * its longest frames (ms, how long they blocked, their style and layout) and their scripts. `watching` says what
 * the browser could report ('long-animation-frame', 'longtask', 'none').
 */
export function frozeText(list, watching = 'long-animation-frame', clean = n => n) {
  if (watching === 'none') return ['what froze: not known (this browser does not report long frames)'];
  const worst = [...list].filter(e => e.worstGap > LONG_MS).sort((a, b) => b.worstGap - a.worstGap).slice(0, 10);
  const lines = [`what froze (the ten worst gaps; frames over ${LONG_MS} ms: ms, blocked, style and layout; scripts: file, function, call, ms)`];
  if (!worst.length) lines.push('  no gap over 50 ms');
  for (const e of worst) {
    lines.push(`${clean(e.name)} gap ${ms(e.worstGap)}`);
    if (!e.froze?.length) { lines.push('  no long frame seen'); continue; }
    for (const f of e.froze) {
      lines.push(f.task ? `  task ${f.ms} ms, blocked ${f.blocked}` : `  frame ${f.ms} ms, blocked ${f.blocked}, style and layout ${f.style ?? '?'}`);
      for (const s of f.scripts) lines.push(`    ${scriptLine(s)}`);
    }
  }
  return lines;
}
