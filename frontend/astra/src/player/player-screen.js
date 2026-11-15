// The full-screen player: Nuvio's layout and gestures over Astra's engine.
//
// open() must be called from a tap (it goes full screen). It follows the
// phone's rotation unless the viewer chose landscape or portrait in
// Settings; the rotate button switches for this session. Picture-in-picture
// shrinks the video into the system's floating window while the app stays
// usable. Back closes, in order: a modal or panel, then the player.
//
// Events: 'progress' {time, duration} (every 10 s, on pause and on close),
// 'close' {time, duration, reason}, 'source' {source}, 'episode' {episode}.
//
// This file is the screen itself: opening, loading, closing and what the
// buttons do. Its parts: view.js (the elements), controls.js (what shows and
// when), menus.js, surface.js (touch on the picture), timeline.js (the seek
// bar), keys.js, markers.js (skip and next episode), loading.js (waiting,
// errors, notices) and system.js (full screen, picture-in-picture, wake lock).

import {AstraPlayer} from '../engine/player.js';
import {baseLanguage} from '../engine/languages.js';
import {clock} from '../ui/dom.js';
import {loadPrefs, savePrefs, subtitleStyle, SPEEDS, ASPECTS, ASPECT_LABELS} from './prefs.js';
import {externalPlayerUrl} from './external.js';
import {build, renderMeta, layout} from './view.js';
import {Controls} from './controls.js';
import {Menus} from './menus.js';
import {Surface} from './surface.js';
import {Timeline} from './timeline.js';
import {Markers} from './markers.js';
import {Loading} from './loading.js';
import {System} from './system.js';
import {key} from './keys.js';

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
    this.engine.addEventListener('tracks', () => { this.menus.refresh(); if (this.ready) this.autoSubtitle(); });
    this.engine.addEventListener('ready', () => this.onReady());
    this.engine.addEventListener('filefacts', e => this.emit('fileinfo', e.detail));
    this.ctl = new Controls(this);
    this.menus = new Menus(this);
    this.markers = new Markers(this);
    this.loader = new Loading(this);
    const resized = new ResizeObserver(() => this.layout());
    resized.observe(this.root);
    resized.observe(this.bottomEl); // a two-line title or the Via line changes how much room the subtitles need
    video.addEventListener('loadedmetadata', () => this.layout());
    video.addEventListener('resize', () => this.layout());
    this.system = new System(this);
    this.bindVideo();
    this.touch = new Surface(this);
    this.seekbar = new Timeline(this);
    this.parts = [this.menus, this.touch, this.seekbar, this.markers, this.loader, this.system, this.ctl]; // closed in this order
    this.onKey = e => key(this, e);
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') this.emitProgress(true, true); // the app may not come back
      else if (!this.video.paused) this.system.wake(true);
    };
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }

  /**
   * @param {object} o
   * @param {{url: string, headers?: object, subtitles?: Array, name?: string, bingeGroup?: string}} o.stream
   * @param {{title: string, episodeLine?: string, release?: string, description?: string, logo?: string, background?: string, poster?: string}} o.meta
   * @param {number} [o.startTime]
   * @param {Array<{id, label, detail, stream}>} [o.sources]
   * @param {{seasons: number[], season: number, items: Array, current: string}} [o.episodes]
   * @param {{label: string, title: string, thumbnail?: string, hasAired?: boolean}} [o.next]
   * @param {Array<{type: string, start: number, end: number}>} [o.segments]
   */
  open(o) {
    this.options = o;
    this.meta = o.meta || {title: ''};
    this.sources = o.sources || [];
    this.sourceId = o.sourceId ?? this.sources[0]?.id ?? null;
    // Choices that belong to one title start fresh with the next.
    this.markers.reset(o.segments);
    this.menus.reset();
    this.touch.reset();
    this.mutedChip.hidden = !(this.video.muted || this.video.volume === 0);
    this.firstFrame = false;
    this.remaining = false;
    this.lastProgress = 0;
    if (this.system.minimized) this.system.restoreFromPip({exit: true});
    if (!this.isOpen) {
      this.isOpen = true;
      this.root.hidden = false;
      this.system.open();
      addEventListener('keydown', this.onKey);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.root.focus({preventScroll: true});
    }
    renderMeta(this);
    this.markers.renderNext();
    this.loader.show(true);
    this.errorCard.hidden = true;
    this.ctl.setLocked(false);
    this.menus.dismiss();
    this.applyAspect();
    this.engine.subtitles.setStyle(subtitleStyle(this.prefs));
    if (o.deferred) { // the caller resolves the address, then calls load()
      this.stream = o.stream;
      this.engine.reset();
      this.loader.show(true);
      this.loadingStatus.textContent = 'Resolving the stream…';
    } else this.load(o.stream, o.startTime || 0);
    this.showControls();
  }

  load(stream, startTime, {allowSilent = false} = {}) {
    this.loader.restart(); // another source: count afresh
    this.stream = stream;
    this.loadedFrom = startTime || 0; // where "Try again" resumes when nothing played yet
    this.ready = false;
    this.firstFrame = false;
    this.loader.show(true);
    this.errorCard.hidden = true;
    this.viaEl.textContent = stream.name ? 'Via ' + stream.name.replace(/\s+/g, ' ') : '';
    const prefs = {languages: [...new Set([this.prefs.audioLanguage, ...((navigator.languages || []).map(baseLanguage))].filter(Boolean))], subtitleLanguage: this.prefs.subtitleLanguage || null, allowSilent};
    this.engine.load({url: stream.url, headers: stream.headers || {}, startTime, autoplay: true, prefs, subtitles: stream.subtitles || []});
    this.system.mediaSession();
  }

  onReady() {
    this.ready = this.engine.mode !== 'unsupported';
    this.menus.refresh();
    this.autoSubtitle();
    // Say so when playback needs the viewer to know something: software decoding, Dolby Vision colours, no sound,
    // or a file Astra cannot read (so no audio choice and no subtitles from inside it).
    const notes = (this.engine.plan?.notes || []).filter(n => /software|Dolby Vision profile \d+ has|without sound|Chrome will play it as-is/.test(n));
    if (notes.length) this.notice(notes.at(-1));
  }

  /** Hands the stream to another app on the phone (VLC, MX Player…). */
  openExternally() {
    const url = externalPlayerUrl(this.stream?.url, {title: [this.meta.title, this.meta.episodeLine].filter(Boolean).join(' · '), position: this.video.currentTime || 0});
    if (!url) return;
    this.video.pause();
    location.href = url;
  }

  /** Subtitles found by add-ons for what is playing; `load` ties them to one file. */
  addSubtitles(list, load) { this.engine.addSubtitleTracks(list, load); }

  /** Whether subtitle add-ons are still being asked (shown in the subtitles menu). */
  setSubtitleSearch(on) { this.menus.setSubtitleSearch(on); }

  /**
   * Shows subtitles in the remembered language when nothing is shown yet:
   * the file's own track first, then an exact match for this release, then
   * the first add-on file. Choosing Off in the menu forgets the language.
   */
  autoSubtitle() {
    const want = this.prefs.subtitleLanguage;
    if (!want || !this.ready || this.engine.selectedSubtitle) return;
    const options = this.engine.subtitleOptions().filter(s => s.supported && baseLanguage(s.language) === want);
    const match = options.find(s => !s.forced) || options[0];
    if (match) this.engine.selectSubtitle(match.id);
  }

  close(reason = 'user') {
    if (!this.isOpen) return;
    this.isOpen = false;
    const time = this.video.currentTime, duration = this.video.duration || 0;
    this.emit('progress', {time, duration, final: true});
    this.emit('close', {time, duration, reason});
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.popLayer?.(); this.popLayer = null; // also pops an open modal's or panel's entry
    for (const part of this.parts) part.close();
    this.engine.reset();
    this.root.hidden = true;
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

  updateTime() {
    const t = this.scrub.time ?? this.video.currentTime, d = this.video.duration;
    const known = Number.isFinite(d) && d > 0;
    this.timeEl.textContent = !known ? clock(t) : this.remaining ? '−' + clock(d - t) : `${clock(t)} / ${clock(d)}`;
    if (known) this.seekbar.update(t, d);
    this.markers.updateSkip(t);
    this.markers.updateNext(t, d);
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

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.video.playbackRate);
    this.video.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
    this.speedBtn.textContent = `Speed ${this.video.playbackRate}x`;
    this.flash(`${this.video.playbackRate}x`);
    this.showControls();
  }

  cycleAspect() {
    this.prefs.aspect = ASPECTS[(ASPECTS.indexOf(this.prefs.aspect) + 1) % ASPECTS.length];
    savePrefs(this.prefs);
    this.applyAspect();
    this.flash(ASPECT_LABELS[this.prefs.aspect]);
    this.showControls();
  }

  applyAspect() { this.video.dataset.aspect = this.prefs.aspect; this.layout(); }

  unmute() {
    if (this.video.volume === 0) this.video.volume = 1;
    this.video.muted = false;
    this.mutedChip.hidden = true;
    this.flash('Sound on');
  }

  // ——— The video's own events ———

  bindVideo() {
    const v = this.video, ctl = this.ctl;
    v.addEventListener('playing', () => {
      if (!this.firstFrame) { this.firstFrame = true; this.loader.show(false); this.showControls(); }
      ctl.setBuffering(false); ctl.updatePlayState(); this.system.wake(true);
    });
    v.addEventListener('waiting', () => { if (this.firstFrame) ctl.setBuffering(true); });
    v.addEventListener('pause', () => {
      this.pausedAt = performance.now();
      ctl.updatePlayState(); this.system.wake(false); this.showControls(false); this.emitProgress(true);
    });
    v.addEventListener('play', () => { ctl.updatePlayState(); this.scheduleHide(); });
    v.addEventListener('volumechange', () => { this.mutedChip.hidden = !(v.muted || v.volume === 0); });
    v.addEventListener('timeupdate', () => { this.updateTime(); this.emitProgress(false); this.system.positionState(); });
    v.addEventListener('progress', () => this.updateTime());
    v.addEventListener('durationchange', () => this.updateTime());
    v.addEventListener('ratechange', () => { this.speedBtn.textContent = `Speed ${this.touch.holding ? this.touch.holdBase : v.playbackRate}x`; });
    v.addEventListener('ended', () => { this.showControls(false); this.emitProgress(true); });
  }

  emitProgress(force, final = false) {
    const now = performance.now();
    if (!force && now - this.lastProgress < 10000) return;
    this.lastProgress = now;
    if (this.video.currentTime > 0) this.emit('progress', {time: this.video.currentTime, duration: this.video.duration || 0, final});
  }
}
