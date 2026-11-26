// Music's start-up, for the recorder (ui/feel-log.js `startup`, MUSIC.md §5.11): when each step of boot
// ended (ms from the page's start) and the main thread's long tasks of the first 10 s, each named by
// the step it began in, so a phone's report says what its start-up long tasks are. Loaded first by
// app.js, so the observer sees the modules' own evaluation too. Numbers only.
export const startup = {marks: [], longTasks: []};

/** The end of a boot step. */
export function mark(name) {
  if (startup.marks.length < 20) startup.marks.push({name, ms: Math.round(performance.now())});
}

try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) if (e.startTime < 10_000 && startup.longTasks.length < 30) startup.longTasks.push({at: Math.round(e.startTime), ms: Math.round(e.duration)});
  }).observe({type: 'longtask', buffered: true});
} catch { /* no long task timing */ }
globalThis.addEventListener?.('pointerdown', () => mark('firstTap'), {once: true, capture: true});
mark('modules');

/** The steps' times (ms from the page's start) by name, for the playback batches (`start`): the first of each. */
export const START_STEPS = ['modules', 'worker', 'boot', 'model', 'theme', 'inflate', 'library', 'restore', 'ready', 'firstFrame', 'firstTap'];
export function startTimes() {
  const out = {};
  for (const m of startup.marks) if (START_STEPS.includes(m.name) && !(m.name in out)) out[m.name] = m.ms;
  return out;
}

/** The report: the steps, and each long task with the step it began in (the first step ending after it began). */
export function startupReport() {
  const steps = startup.marks;
  return {steps: steps.slice(), longTasks: startup.longTasks.map(t => ({...t, during: steps.find(s => s.ms > t.at)?.name ?? 'after'}))};
}
