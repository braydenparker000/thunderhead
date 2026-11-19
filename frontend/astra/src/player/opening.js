// How the player opens, loads and closes, in the order the feel needs (FEEL.md "Stream → player"; the feel
// report counts the main thread's gaps). In the tap's own frame only what that frame shows: the player's state,
// the tapped card pressing in and the dim starting (passage.js, on the compositor), the loading layer's art, logo
// and words. The rest waits for that frame to be presented and runs a piece a frame (stages.js): the film is
// asked for first, so it starts as soon as before; then the controls, the title block, the picture's size, the
// subtitles' style, keyboard focus and the app behind put out of reach. Closing is the same the other way: the
// picture's fade and the dim's lift start first, then the parts stop; the app comes back in reach after their
// first frame; the engine lets go of the film once they have ended and the main thread is free.

import {baseLanguage} from '../engine/languages.js';
import {subtitleStyle} from './prefs.js';
import {renderMeta, renderLoading} from './view.js';
import {viaName} from './rules.js';
import {withoutHash} from '../addons/stream-text.js';
import {whenIdle} from '../ui/motion-core.js';

/** PlayerScreen.open (player-screen.js documents the options). */
export function openPlayer(p, o) {
  p.stages.flush(); // what a close just before still had to do is done first
  p.settleReset(); // and the film it let go of is let go now, before another loads
  const before = p.meta;
  p.options = o;
  p.meta = o.meta || {title: ''};
  p.sources = o.sources || [];
  p.hiddenSources = o.hiddenSources || [];
  p.sourceId = o.sourceId ?? (o.stream ? p.sources[0]?.id : null) ?? null;
  // Choices that belong to one title start fresh with the next; the subtitle delay is kept for the same series.
  if (!before || (before.id || before.title) !== (p.meta.id || p.meta.title)) p.engine.subtitles.setDelay(0);
  for (const part of p.parts) if (part !== p.system) part.close(); // anything left from before: a hold, a timer, a notice
  p.markers.reset(o.segments);
  p.menus.reset();
  p.touch.reset();
  p.extras.opened(o);
  p.mutedChip.hidden = !(p.video.muted || p.video.volume === 0);
  p.firstFrame = false;
  p.lastProgress = 0;
  p.loadedFrom = o.startTime || 0;
  p.playedTo = 0;
  if (p.system.minimized) p.system.restoreFromPip({exit: true});
  if (!p.isOpen) {
    p.isOpen = true;
    p.passage.enter(o.origin); // the tapped card presses in, the screen dims over the backdrop: before anything else
    p.system.open();
    addEventListener('keydown', p.onKey);
    document.addEventListener('visibilitychange', p.onVisibility);
    p.stages.add(() => { if (p.isOpen && !p.system.minimized) p.system.setInert(true); }); // a style pass over the whole app: its own frame
    p.stages.add(() => { if (p.isOpen) p.root.focus({preventScroll: true}); });
  }
  renderLoading(p); // what the dim shows: the backdrop, the logo
  p.loader.show(true);
  const drawn = () => {
    p.stages.add(() => { if (p.isOpen) { renderMeta(p); p.markers.renderNext(); } });
    p.stages.add(() => { if (p.isOpen) p.ctl.setLocked(false); });
    p.stages.add(() => { if (p.isOpen) { p.applyAspect(); p.engine.subtitles.setStyle(subtitleStyle(p.prefs)); } });
  };
  if (!o.stream) { // the viewer picks the source
    p.stream = null;
    p.viaEl.textContent = '';
    p.loadToken++;
    p.engine.reset();
    p.loader.waitForPick();
    drawn();
    p.stages.add(() => { if (p.isOpen) { p.showControls(); p.openPanel('sources'); } });
    return;
  }
  if (o.deferred) p.defer(o.stream, o.startTime || 0); // the caller resolves the address, then calls load()
  else p.load(o.stream, o.startTime || 0);
  drawn();
  p.stages.add(() => { if (p.isOpen) p.showControls(); });
}

/**
 * PlayerScreen.load: the state at once; the engine is asked to start in a piece of its own: once the opening's
 * dim has landed when the player is opening (its reading and unpacking are the main thread's heaviest work, and
 * the dim, with the drawing of the controls under it, is over by then: the film starts no later than when the
 * opening did all of it in the tap), else first, after the frame on screen (another source).
 */
export function loadFilm(p, stream, startTime, {allowSilent = false} = {}) {
  const opening = p.passage.opening();
  p.loader.restart(); // another source: count afresh
  p.stream = stream;
  p.loadedFrom = startTime || 0; // where "Try again" resumes when nothing played yet
  p.ready = false;
  p.firstFrame = false;
  p.playedTo = 0;
  p.loader.show(true);
  p.errorCard.hidden = true;
  p.viaEl.textContent = stream.name ? 'Via ' + viaName(withoutHash(stream.name)) : ''; // the add-on's name once
  const prefs = {languages: [...new Set([p.prefs.audioLanguage, ...((navigator.languages || []).map(baseLanguage))].filter(Boolean))], subtitleLanguage: p.prefs.subtitleLanguage || null, allowSilent};
  const token = ++p.loadToken;
  p.stages.add(() => {
    if (token !== p.loadToken) return; // another load, a defer or a close came since
    p.extras.loading();
    p.engine.load({url: stream.url, renew: stream.renew || null, headers: stream.headers || {}, startTime, autoplay: true, prefs, subtitles: stream.subtitles || []});
    p.system.mediaSession();
  }, opening ? {after: p.passage.dimmed} : {first: true});
}

/** PlayerScreen.close: see the top of this file. */
export function closePlayer(p, reason) {
  if (!p.isOpen) return;
  p.isOpen = false;
  p.stages.clear(); // what the opening still had to do is not wanted now
  p.loadToken++;
  const time = p.firstFrame ? p.video.currentTime : 0, duration = Number.isFinite(p.video.duration) ? p.video.duration : 0;
  removeEventListener('keydown', p.onKey);
  document.removeEventListener('visibilitychange', p.onVisibility);
  if (!p.video.paused) p.video.pause(); // silent at once; the picture stays while it fades
  // The picture fades to the backdrop and the dim lifts, from where things are now (nothing has changed yet).
  // At its end the engine lets go: when the main thread is free, or at once if the player opens again first.
  p.passage.exit(now => { if (now) p.engine.reset(); else p.idleReset(); });
  p.popLayer?.(); p.popLayer = null; // also pops an open modal's or panel's entry
  p.emit('progress', {time, duration, final: true});
  p.emit('close', {time, duration, reason});
  p.extras.close();
  for (const part of p.parts) part.close(); // timers, holds, the wake lock, full screen: let go of now
  p.stages.add(() => { if (!p.isOpen) p.system.setInert(false); }); // the app back in reach: a style pass of its own, after the first frame
}

/** The engine's teardown once the main thread is free (PlayerScreen.idleReset); settleReset() runs it now. */
export function idleReset(p) {
  p.cancelReset?.();
  const run = () => { p.cancelReset = null; if (!p.isOpen) p.engine.reset(); };
  p.cancelReset = whenIdle(run, {timeout: 1500});
  p.resetNow = run;
}
