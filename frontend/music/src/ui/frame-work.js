// What ran during each view transition, for the recorder (ui/feel-log.js, MUSIC.md §5.10 "Movement and
// layout"): a transition's frames can only be slow because of work in them, and the report named the
// gaps without the work. Each run records, only when they happen while it runs:
// - `relayouts`: whole-page layouts done at once (Context.layoutNow: a resize, a field let go);
// - `resizes`: window and visual viewport resizes (the keyboard opening or closing, home's toolbar);
// - `songAt`: ms after its start that a song change or play/pause began (a song's start work);
// - `longTasks`, `longMs`, `longAt`: main-thread tasks of 50 ms or more that began inside it, the longest
//   one's ms, and when it began (ms after the start); read as the browser reports them, a little after.
// Numbers only. Nothing runs outside a transition except the long task observer's own bookkeeping.

/** @param {import('./feel-log.js').FeelLog} log */
export function watchFrameWork(log) {
  const ctx = log.ctx;
  const each = fn => { for (const run of log.running.values()) fn((run.work ??= {}), run); };
  const layoutNow = ctx.layoutNow?.bind(ctx);
  if (layoutNow) ctx.layoutNow = (...a) => { each(w => { w.relayouts = (w.relayouts ?? 0) + 1; }); return layoutNow(...a); };
  const resized = () => each(w => { w.resizes = (w.resizes ?? 0) + 1; });
  globalThis.addEventListener?.('resize', resized);
  globalThis.visualViewport?.addEventListener('resize', resized);
  ctx.bus.subscribe('bus_player', (msg, src, d) => {
    if ((msg === 'msg_player_track_changed' && !d?.meta) || msg === 'msg_player_playing_state_changed') each((w, run) => { w.songAt ??= Math.round(performance.now() - run.start); });
  });
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        // The runs going on, and the last ones ended (the entry comes after its task).
        const runs = [...log.running.values(), ...log.runs.slice(-4).map(r => ({start: log.t0 + r.t, ms: r.ms, rec: r}))];
        for (const run of runs) {
          const at = e.startTime - run.start;
          if (at < 0 || (run.rec && at > run.ms)) continue;
          const w = run.rec ?? (run.work ??= {});
          w.longTasks = (w.longTasks ?? 0) + 1;
          if (!(w.longMs >= e.duration)) { w.longMs = Math.round(e.duration); w.longAt = Math.round(at); }
        }
      }
    }).observe({type: 'longtask', buffered: false});
  } catch { /* no long task timing */ }
}
