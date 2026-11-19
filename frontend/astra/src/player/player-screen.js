// The full-screen player: Nuvio's layout and gestures over Astra's engine.
//
// open() must be called from a tap (it goes full screen). It follows the
// phone's rotation unless the viewer chose landscape or portrait in
// Settings; the rotate button switches for this session. Picture-in-picture
// shrinks the video into the system's floating window while the app stays
// usable. Back closes, in order: a modal or panel, then the player.
//
// Events: 'progress' {time, duration} (every 10 s, on pause and on close),
// 'close' {time, duration, reason}, 'source' {source, startTime} (cancelable:
// a listener that calls preventDefault loads it itself), 'episode' {episode},
// 'next', 'fileinfo'.
//
// This file is the screen itself: opening, loading, closing and what the
// buttons do. Its parts: view.js (the elements), controls.js (what shows and
// when), menus.js, surface.js (touch on the picture), timeline.js (the seek
// bar), keys.js, video-events.js, markers.js (skip and next episode),
// loading.js (waiting, errors, notices) and system.js (full screen,
// picture-in-picture, wake lock). Each part has close(); closing runs them all.
// extras.js gathers the rest (the Playback menu, seek-bar marks, frames, search).

import {AstraPlayer} from '../engine/player.js';
import {baseLanguage} from '../engine/languages.js';
import {loadPrefs, savePrefs, subtitleStyle, ASPECTS, ASPECT_LABELS} from './prefs.js';
import {externalPlayerUrl} from './external.js';
import {build, renderMeta, layout} from './view.js';
import {Controls} from './controls.js';
import {Menus} from './menus.js';
import {Surface} from './surface.js';
import {Timeline, timeText} from './timeline.js';
import {Markers} from './markers.js';
import {Loading} from './loading.js';
import {Passage} from './passage.js';
import {System} from './system.js';
import {key} from './keys.js';
import {bindVideo} from './video-events.js';
import {Extras} from './extras.js';
import {viaName} from './rules.js';
import {withoutHash} from '../addons/stream-text.js';

export class PlayerScreen extends EventTarget {
  /** How long a load runs before the loading screen offers other sources. */
  static SLOW_LOAD_MS = 10000;

  constructor({parent = document.body} = {}) {
    super();
    this.parent = parent;
    this.prefs = loadPrefs();
    this.isOpen = false;
    this.scrub = {active: false, time: null}; // a drag on the seek bar or across the picture, and where it points
    Object.assign(this, build(this));
    const video = this.video;
    this.engine = new AstraPlayer(video, this.subsEl);
    this.engine.addEventListener('status', e => { this.loadingStatus.textContent = e.detail; });
    this.engine.addEventListener('error', e => this.showError(e.detail.message, e.detail.plan, e.detail));
    this.engine.addEventListener('network', e => this.loader.networkState(e.detail));
    this.engine.addEventListener('tracks', () => { this.menus.refresh(); if (this.ready) this.menus.autoSubtitle(); });
    this.engine.addEventListener('ready', () => this.onReady());
    this.engine.addEventListener('filefacts', e => this.emit('fileinfo', e.detail));
    this.ctl = new Controls(this);
    this.menus = new Menus(this);
    this.markers = new Markers(this);
    this.loader = new Loading(this);
    this.passage = new Passage(this); // how it opens and leaves (passage.js)
    const resized = new ResizeObserver(() => this.layout());
    resized.observe(this.root);
    resized.observe(this.bottomEl); // a two-line title or the Via line changes how much room the subtitles need
    video.addEventListener('loadedmetadata', () => this.layout());
    video.addEventListener('resize', () => this.layout());
    this.system = new System(this);
    bindVideo(this);
    this.touch = new Surface(this);
    this.seekbar = new Timeline(this);
    this.extras = new Extras(this);
    this.parts = [this.menus, this.touch, this.seekbar, this.markers, this.loader, this.system, this.ctl]; // closed in this order
    this.onKey = e => key(this, e);
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') this.emitProgress(true, true); // the app may not come back
      else if (!this.video.paused) this.system.wake(true);
    };
  }

  /** Returns false when a listener called preventDefault on a cancelable event. */
  emit(type, detail, {cancelable = false} = {}) { return this.dispatchEvent(new CustomEvent(type, {detail, cancelable})); }

  /**
   * @param {object} o
   * @param {{url: string, headers?: object, subtitles?: Array, name?: string, bingeGroup?: string}} o.stream
   * @param {{title: string, episodeLine?: string, release?: string, description?: string, logo?: string, background?: string, poster?: string}} o.meta
   * @param {number} [o.startTime]
   * @param {Array<{id, label, detail, stream}>} [o.sources]
   * @param {{seasons: number[], season: number, items: Array, current: string}} [o.episodes]
   * @param {{label: string, title: string, thumbnail?: string, hasAired?: boolean}} [o.next]
   * @param {Array<{type: string, start: number, end: number}>} [o.segments]
   * @param {Array} [o.hiddenSources] sources the viewer's filters hide: counted in the sources panel
   * With no o.stream, nothing loads: the sources panel opens for the viewer to pick one ('source').
   */
  open(o) {
    const before = this.meta;
    this.options = o;
    this.meta = o.meta || {title: ''};
    this.sources = o.sources || [];
    this.hiddenSources = o.hiddenSources || [];
    this.sourceId = o.sourceId ?? (o.stream ? this.sources[0]?.id : null) ?? null;
    // Choices that belong to one title start fresh with the next; the subtitle delay is kept for the same series.
    if (!before || (before.id || before.title) !== (this.meta.id || this.meta.title)) this.engine.subtitles.setDelay(0);
    for (const part of this.parts) if (part !== this.system) part.close(); // anything left from before: a hold, a timer, a notice
    this.markers.reset(o.segments);
    this.menus.reset();
    this.touch.reset();
    this.extras.opened(o);
    this.mutedChip.hidden = !(this.video.muted || this.video.volume === 0);
    this.firstFrame = false;
    this.lastProgress = 0;
    this.loadedFrom = o.startTime || 0;
    this.playedTo = 0;
    if (this.system.minimized) this.system.restoreFromPip({exit: true});
    if (!this.isOpen) {
      this.isOpen = true;
      this.root.hidden = false;
      this.system.open();
      addEventListener('keydown', this.onKey);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.root.focus({preventScroll: true});
      this.passage.enter(o.origin); // the tapped card presses in, the screen dims over the backdrop
    }
    renderMeta(this);
    this.markers.renderNext();
    this.loader.show(true);
    this.ctl.setLocked(false);
    this.applyAspect();
    this.engine.subtitles.setStyle(subtitleStyle(this.prefs));
    if (!o.stream) { // the viewer picks the source
      this.stream = null;
      this.viaEl.textContent = '';
      this.engine.reset();
      this.loader.waitForPick();
      this.showControls();
      this.openPanel('sources');
      return;
    }
    if (o.deferred) this.defer(o.stream, o.startTime || 0); // the caller resolves the address, then calls load()
    else this.load(o.stream, o.startTime || 0);
    this.showControls();
  }

  /** The caller is resolving this stream's address (a debrid link) and will call load(): stop what plays and say so. */
  defer(stream, startTime = 0) {
    this.stream = stream;
    this.loadedFrom = startTime;
    this.ready = false;
    this.firstFrame = false;
    this.playedTo = 0;
    this.engine.reset();
    this.errorCard.hidden = true;
    this.loader.restart();
    this.loader.show(true);
    this.loadingStatus.textContent = 'Resolving the stream…';
  }

  /**
   * Where another load of this title should start: where the film is, once
   * it has shown a frame; before that, where this load was asked to start
   * (the video's own clock is still at 0 then).
   */
  resumePoint() {
    const at = this.firstFrame ? this.video.currentTime || this.playedTo : 0;
    return at || this.loadedFrom || 0;
  }

  load(stream, startTime, {allowSilent = false} = {}) {
    this.loader.restart(); // another source: count afresh
    this.stream = stream;
    this.loadedFrom = startTime || 0; // where "Try again" resumes when nothing played yet
    this.ready = false;
    this.firstFrame = false;
    this.playedTo = 0;
    this.loader.show(true);
    this.errorCard.hidden = true;
    this.viaEl.textContent = stream.name ? 'Via ' + viaName(withoutHash(stream.name)) : ''; // the add-on's name once
    const prefs = {languages: [...new Set([this.prefs.audioLanguage, ...((navigator.languages || []).map(baseLanguage))].filter(Boolean))], subtitleLanguage: this.prefs.subtitleLanguage || null, allowSilent};
    this.extras.loading();
    this.engine.load({url: stream.url, renew: stream.renew || null, headers: stream.headers || {}, startTime, autoplay: true, prefs, subtitles: stream.subtitles || []});
    this.system.mediaSession();
  }

  onReady() {
    this.ready = this.engine.mode !== 'unsupported';
    this.menus.refresh();
    this.menus.autoSubtitle();
    // Say so when playback needs the viewer to know something: software decoding, Dolby Vision colours, no sound,
    // or a file Astra cannot read (so no audio choice and no subtitles from inside it).
    const notes = (this.engine.plan?.notes || []).filter(n => /software|Dolby Vision profile \d+ has|without sound|Chrome will play it as-is/.test(n));
    if (notes.length) this.notice(notes.at(-1));
  }

  /** Hands the stream to another app on the phone (VLC, MX Player…). */
  openExternally() {
    const url = externalPlayerUrl(this.stream?.url, {title: [this.meta.title, this.meta.episodeLine].filter(Boolean).join(' · '), position: this.resumePoint()});
    if (url) { this.video.pause(); location.href = url; }
  }

  /** Subtitles found by add-ons for what is playing; `load` ties them to one file. */
  addSubtitles(list, load) { this.engine.addSubtitleTracks(list, load); }

  /** Skip times found after the film started: the Skip button and the seek bar's marks follow at once. */
  setSegments(list) { this.markers.setSegments(list || []); this.extras.marks.render(); this.updateTime(); }

  /** Whether subtitle add-ons are still being asked (shown in the subtitles menu). */
  setSubtitleSearch(on) { this.menus.setSubtitleSearch(on); }

  /**
   * One teardown: every part stops its timers, listeners and gestures and
   * lets go of the phone (full screen, wake lock, the app behind, the lock
   * screen's controls), then the app hears where playback got to.
   */
  close(reason = 'user') {
    if (!this.isOpen) return;
    this.isOpen = false;
    const time = this.firstFrame ? this.video.currentTime : 0, duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (!this.video.paused) this.video.pause(); // silent at once; the picture stays while it fades
    this.popLayer?.(); this.popLayer = null; // also pops an open modal's or panel's entry
    this.extras.close();
    for (const part of this.parts) part.close();
    this.emit('progress', {time, duration, final: true});
    this.emit('close', {time, duration, reason});
    this.passage.exit(() => this.engine.reset()); // the picture fades to the backdrop, the dim lifts, then the engine lets go
  }

  // ——— What the other parts and the app call ———

  showLoading(on) { this.loader.show(on); }
  showError(message, plan, detail) { this.loader.showError(message, plan, detail); }
  notice(text) { this.loader.notice(text); }
  openPanel(name) { this.menus.openPanel(name); }
  showControls(autoHide) { this.ctl.show(autoHide); }
  hideControls() { this.ctl.hide(); }
  scheduleHide() { this.ctl.scheduleHide(); }
  flash(text, o) { this.ctl.flash(text, o); }
  layout() { layout(this); }

  /**
   * Called on every timeupdate: the skip button and next card always, the
   * clock and the bar only while something shows them (showControls and the
   * lock's hint draw them afresh when they appear).
   */
  updateTime() {
    const t = this.scrub.time ?? this.video.currentTime, d = this.video.duration;
    this.markers.updateSkip(t);
    this.markers.updateNext(t, d);
    if (!this.ctl.showing) return;
    const text = timeText(t, d, this.prefs.timeShows === 'remaining');
    if (this.timeEl.textContent !== text) this.timeEl.textContent = text;
    this.seekbar.update(t, d);
  }

  // ——— Playback actions ———

  togglePlay() {
    if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause();
    this.showControls();
  }

  seekBy(seconds) {
    const d = this.video.duration || Infinity;
    this.video.currentTime = Math.max(0, Math.min(d - 0.5, this.video.currentTime + seconds));
    this.updateTime();
  }

  cycleAspect() {
    this.prefs.aspect = ASPECTS[(ASPECTS.indexOf(this.prefs.aspect) + 1) % ASPECTS.length];
    savePrefs(this.prefs);
    this.touch.zoom.reset(); // the aspect button also undoes a pinch
    this.applyAspect();
    this.flash(ASPECT_LABELS[this.prefs.aspect]);
    this.showControls();
  }

  applyAspect() { this.video.dataset.aspect = this.prefs.aspect; this.layout(); }

  unmute() {
    if (this.video.volume === 0) this.video.volume = 1;
    this.video.muted = false;
    this.prefs.volume = this.video.volume; savePrefs(this.prefs);
    this.mutedChip.hidden = true;
    this.flash('Sound on');
  }

  /** Tells the app where playback is: every 10 s while it runs, and at once when `force`d (a pause, the end, leaving). */
  emitProgress(force, final = false) {
    const now = performance.now();
    if (!force && now - this.lastProgress < 10000) return;
    this.lastProgress = now;
    const d = this.video.duration;
    if (this.video.currentTime > 0) this.emit('progress', {time: this.video.currentTime, duration: Number.isFinite(d) ? d : 0, final});
  }
}
