// Astra's playback engine. One call to load() reads the file, decides how it
// plays (plan.js) and starts exactly one pipeline; it never switches pipeline
// mid-play. Audio and subtitle tracks are listed and switched here, whichever
// pipeline is running.
//
// Events: 'status' (detail: text), 'ready', 'tracks', 'error' (detail: {message, detail}).
// `chapters` ([{start, end, title}] in seconds, [] when none) is set before 'ready'.

import {probe, describeInfo} from './probe.js';
import {planPlayback, audioLabel, subtitleLabel} from './plan.js';
import {mseSupports, nativeCanPlay, canEncodeAudio, deviceReport} from './capabilities.js';
import {softwareVideo} from './software.js';
import {HttpSource} from './http-source.js';
import {remoteFileHash, HASH_CHUNK} from './file-hash.js';
import {decodeSubtitleBytes} from '../addons/subtitles.js';
import {SubtitleRenderer} from '../subtitles/renderer.js';
import {preferredLanguages, languageName, baseLanguage} from './languages.js';
import {subtitleMethods} from './player-subtitles.js';
import {adaptiveMethods} from './adaptive.js';
import {startMethods} from './player-start.js';
import {finishChapters} from './chapters.js';
import {dataMethods} from './player-data.js';

const MEDIA_ERRORS = {
  1: 'Playback was stopped.',
  2: 'The connection to the host failed while playing.',
  3: 'The video data could not be decoded on this device.',
  4: 'This browser cannot play this file as it is.',
};

export {decodeSubtitleBytes};

export class AstraPlayer extends EventTarget {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} subtitleLayer  an element covering the video
   */
  constructor(video, subtitleLayer) {
    super();
    this.video = video;
    this.subtitles = new SubtitleRenderer(subtitleLayer, video);
    this.session = null;
    this.mode = null;
    this.plan = null;
    this.info = null;
    this.chapters = [];
    this.audio = [];
    this.textTracks = []; // {id, label, language, kind: 'embedded'|'external'|'stream', supported, reason, source, exact}
    this.cues = new Map(); // track id -> cues
    this.selectedSubtitle = null;
    this.selectedAudio = null;
    this.load_ = 0;
    this.log = [];
    this.onVideoError = () => {
      const e = this.video.error;
      if (!e || !this.mode || this.mode === 'software') return;
      this.fail(MEDIA_ERRORS[e.code] || 'Playback failed.', e.message, {decode: e.code === 3 || e.code === 4, network: e.code === 2});
    };
    video.addEventListener('error', this.onVideoError);
    this.onFirstFrame = () => { this.started = true; };
    video.addEventListener('loadeddata', this.onFirstFrame);
    // Whether the film was running, kept apart from `paused`, which an error also sets.
    this.onRun = e => { if (e.type === 'playing') this.playing = true; else if (!video.error) this.playing = false; };
    for (const type of ['playing', 'pause']) video.addEventListener(type, this.onRun);
    this.onTimeUpdate = () => { if (this.hls || this.dash) this.pullTextTrackCues(); };
    video.addEventListener('timeupdate', this.onTimeUpdate);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  status(text) { this.record('status', text); this.emit('status', text); }
  record(kind, detail) { this.log.push({t: Math.round(performance.now()), kind, detail}); if (this.log.length > 200) this.log.shift(); }
  /**
   * Reports a stop. Before the first frame, a decoding failure in Astra's
   * own unpacking or in Chrome is retried once with the software decoder.
   */
  fail(message, detail, {decode = false, network = false} = {}) {
    if (!this.started && decode && this.canFallBack()) { this.fallBack(message); return; }
    // While playing, a decoder that gives up (a seek into an open GOP in Chrome's
    // own decoder, a hardware decoder taken away) is met first with a fresh
    // pipeline at the same place, then with the software decoder.
    if (this.resuming) return;
    if (this.started && decode && this.video.error) {
      if (this.canResume()) { this.resume(message); return; }
      if (this.canFallBack()) { this.fallBack(message, this.playing); return; }
    }
    // One stop is reported once, however many pipelines noticed it.
    if (this.failedLoad === this.load_) return;
    this.failedLoad = this.load_;
    this.record('error', {message, detail});
    this.emit('error', {message, detail, plan: this.plan, network});
  }

  /** A decode error while a re-wrapped file plays is met once with a fresh pipeline at that place. */
  canResume() {
    return this.mode === 'remux' && !(performance.now() - this.resumedAt < 10000) && !this.probed?.source?.closed;
  }

  /** Starts a fresh remux pipeline where the film is: after a decode error, or (`silent`) without the sound that ran out. */
  async resume(reason, {silent = false} = {}) {
    const id = this.load_, at = this.video.currentTime, playing = this.playing, subtitle = this.selectedSubtitle;
    this.resumedAt = performance.now();
    this.resuming = true;
    if (!silent) this.plainFragments = true; // the second try is the plainest stream: fragments only at key frames
    this.record('resume', {at: +at.toFixed(2), reason});
    this.session?.destroy();
    const chosen = this.audio.find(a => a.id === this.selectedAudio)?.option;
    if (silent) this.plan = {...this.plan, audio: null, notes: [...(this.plan.notes || []), `${reason} The rest plays without sound.`]};
    else if (chosen && this.plan.audio) this.plan = {...this.plan, audio: {track: chosen.track, delivery: chosen.delivery}};
    try {
      await this.startRemux(at, id);
      if (id !== this.load_) return;
      if (this.selectedSubtitle !== subtitle) this.selectSubtitle(subtitle);
      if (playing) this.video.play().catch(() => {});
      this.resuming = false;
      if (silent) this.emit('tracks');
    } catch (error) {
      if (id !== this.load_) return;
      this.resuming = false;
      this.fail(reason, String(error?.message || error), {decode: true});
    }
  }

  canFallBack() {
    const v = this.info?.video?.[0];
    return !this.fellBack && ['remux', 'native'].includes(this.mode) && this.caps?.software && !!this.info && (!v || softwareVideo(v)) && this.readable;
  }

  async fallBack(reason, play = true) {
    const id = this.load_, at = this.video.currentTime || this.startTime || 0;
    this.fellBack = true;
    this.record('fallback', reason);
    this.status('Switching to the software decoder…');
    this.stopScanners();
    this.session?.destroy(); this.session = null;
    this.video.removeAttribute('src');
    try { this.video.load(); } catch {}
    try {
      if (!this.probed?.source || this.probed.source.closed) {
        const source = new HttpSource(this.url, {headers: this.headers});
        this.bytesBefore = (this.bytesBefore || 0) + (this.probed?.source?.bytesFetched || 0); // what the film cost so far still counts
        await source.open(this.abort?.signal);
        if (id !== this.load_) { source.close(); return; }
        this.probed = {...this.probed, source};
        this.applyDataSaver();
      }
      this.mode = 'software';
      this.plan = {...this.plan, mode: 'software', notes: [...(this.plan?.notes || []), `Switched to the software decoder: ${reason}`]};
      await this.startSoftware(at, id);
      if (id !== this.load_) return;
      this.emit('tracks');
      if (play) this.video.play().catch(() => {});
      this.offerChapters();
      this.emit('ready', this.plan);
    } catch (error) {
      if (id !== this.load_) return;
      this.record('error', {message: reason, detail: String(error?.message || error)});
      this.emit('error', {message: reason, detail: String(error?.message || error), plan: this.plan});
    }
  }

  /**
   * @param {{url: string, headers?: object, startTime?: number, autoplay?: boolean, prefs?: object, subtitles?: Array}} options
   */
  async load({url, headers = {}, startTime = 0, autoplay = false, prefs = {}, subtitles = []}) {
    this.reset(); // ends the load before this one: its awaits find a newer load and stop
    const id = this.load_;
    Object.assign(this, {url, headers, startTime, started: false, fellBack: false, resuming: false, resumedAt: NaN, plainFragments: false});
    const languages = prefs.languages || preferredLanguages();
    const controller = this.abort = new AbortController(), signal = controller.signal;
    try {
      const probed = await probe(url, {headers, signal, onStatus: t => this.status(t), onSource: s => { if (id === this.load_) { this.source = s; this.applyDataSaver(); } }});
      if (id !== this.load_) { probed.source?.close(); probed.input?.dispose(); return; }
      this.probed = probed;
      // The connection to the host lost and found again while playing (the reader keeps trying meanwhile).
      probed.source?.onState?.(state => { if (id === this.load_) this.emit('network', state); });
      this.info = probed.info;
      this.fileFacts(id, url, headers, probed, signal);
      const caps = {mse: mseSupports, native: nativeCanPlay, opusEncode: await canEncodeAudio('opus'), software: typeof WebAssembly === 'object' && typeof MediaStream === 'function'};
      if (id !== this.load_) return;
      this.caps = caps;
      this.readable = probed.readable && !probed.adaptive;
      this.plan = planPlayback(probed, caps, {...prefs, languages, requiresHeaders: Object.keys(headers).length > 0});
      this.mode = this.plan.mode;
      this.record('plan', {mode: this.mode, notes: this.plan.notes, reason: this.plan.reason});
      if (this.mode === 'unsupported') { probed.source?.close(); probed.input?.dispose(); this.fail(this.plan.reason); return this.plan; }
      if (this.mode !== 'remux' && this.mode !== 'software') { probed.source?.close(); probed.input?.dispose(); }
      this.status(this.mode === 'remux' ? 'Preparing playback…' : 'Starting…');
      if (this.mode === 'remux') {
        try { await this.startRemux(startTime, id); } catch (error) {
          if (id !== this.load_) return;
          if (!this.canFallBack()) throw error;
          await this.fallBack(String(error?.message || error));
          return this.plan;
        }
      } else if (this.mode === 'software') await this.startSoftware(startTime, id);
      else if (this.mode === 'hls') await this.startHls(url, headers, startTime, id, signal);
      else if (this.mode === 'dash') await this.startDash(url, startTime, id, signal);
      else await this.startNative(url, startTime, signal);
      if (id !== this.load_) return;
      this.addSubtitleTracks(subtitles.map(s => ({...s, source: s.source || 'This stream'})), id);
      if (autoplay) this.video.play().catch(() => {});
      this.offerChapters();
      this.emit('ready', this.plan);
      return this.plan;
    } catch (error) {
      if (id !== this.load_ || signal.aborted) return;
      this.fail(error?.message || 'Playback could not start.', String(error?.stack || error));
    }
  }

  /** The file's chapters on the film's clock: shifted as the pipeline shifts the media (files that start after zero). */
  offerChapters() { this.chapters = finishChapters(this.info?.chapters, this.info?.duration, this.session?.offset || 0); }

  /** The audio choices: [{id, label, language, supported, reason, selected}]. */
  audioOptions() { return this.audio.map(a => ({id: a.id, label: a.label, language: a.language, supported: a.supported, reason: a.reason, delivery: a.delivery, selected: a.id === this.selectedAudio})); }

  async selectAudio(id) {
    const choice = this.audio.find(a => a.id === id);
    if (!choice || !choice.supported || id === this.selectedAudio) return;
    this.selectedAudio = id;
    this.record('audio', choice.label);
    if (this.session && choice.stream != null) await this.session.setAudioStream(choice.stream);
    else if (this.session && choice.option) await this.session.setAudio({track: choice.option.track, delivery: choice.option.delivery});
    else if (this.hls) this.hls.audioTrack = choice.index;
    else if (this.dash) this.dash.setCurrentTrack(choice.track);
    else if (choice.native) for (const a of this.audio) if (a.native) a.native.enabled = a === choice;
    this.emit('tracks');
  }

  /**
   * Learns the file's size and OpenSubtitles hash (two small reads) so
   * subtitle add-ons can match this exact release; emits 'filefacts'.
   */
  async fileFacts(load, url, headers, probed, signal) {
    let hash = null;
    const size = probed.readable && !probed.adaptive ? probed.info?.size || probed.source?.size || null : null;
    if (size) {
      try {
        const head = probed.source?.has(0, HASH_CHUNK) ? await probed.source.read(0, HASH_CHUNK) : null;
        hash = await remoteFileHash(probed.source?.url || url, size, {headers, head: head && head.slice(), signal});
      } catch {}
    }
    if (load === this.load_ && !signal.aborted) this.emit('filefacts', {load, hash, size});
  }

  /** A shareable report: what the file contains, how it plays, what this device supports. */
  async report() {
    return {
      astra: 'playback-report/1', userAgent: navigator.userAgent, mode: this.mode,
      plan: this.plan && {mode: this.plan.mode, reason: this.plan.reason, notes: this.plan.notes, audio: this.plan.audio?.label, delivery: this.plan.audio?.delivery},
      info: describeInfo(this.info), device: await deviceReport(),
      health: this.session?.health?.() ?? null, stats: this.session?.stats ?? null,
      subtitles: {clustersScanned: this.scanner?.clustersRead ?? 0, cues: Object.fromEntries([...this.cues].map(([k, v]) => [k, v.length]))},
      video: {currentTime: this.video.currentTime, readyState: this.video.readyState, error: this.video.error?.message || null,
        quality: this.video.getVideoPlaybackQuality ? (({totalVideoFrames, droppedVideoFrames}) => ({totalVideoFrames, droppedVideoFrames}))(this.video.getVideoPlaybackQuality()) : null,
        size: this.video.videoWidth ? `${this.video.videoWidth}x${this.video.videoHeight}` : null},
      network: this.probed?.source ? {bytes: this.probed.source.bytesFetched} : null,
      log: this.log.slice(-60),
    };
  }

  /** Ends what is playing or loading: every await of that load finds a newer one (load_) and stops; its downloads close. */
  reset() {
    this.load_++;
    this.abort?.abort(); this.abort = null;
    this.stopScanners();
    this.session?.destroy(); this.session = null;
    this.hls?.destroy(); this.hls = null;
    this.dash?.reset(); this.dash = null;
    this.pulledCues = null;
    this.probed?.input?.dispose?.(); this.probed?.source?.close?.(); this.probed = null;
    this.source?.close?.(); this.source = null; // the reader of a file still being described
    this.mode = null; this.plan = null; this.info = null; this.chapters = []; this.bytesBefore = 0; this.adaptiveBytes = null;
    this.audio = []; this.textTracks = []; this.cues = new Map(); this.selectedAudio = null; this.selectedSubtitle = null;
    this.subtitles.clear();
    this.video.removeAttribute('crossorigin'); // set again only for a native film whose host lets the page read it
    this.video.removeAttribute('src');
    try { this.video.load(); } catch {}
  }

  destroy() {
    this.reset();
    this.stopDataSaver();
    this.video.removeEventListener('error', this.onVideoError);
    for (const type of ['playing', 'pause']) this.video.removeEventListener(type, this.onRun);
    this.video.removeEventListener('loadeddata', this.onFirstFrame);
    this.video.removeEventListener('timeupdate', this.onTimeUpdate);
    this.subtitles.destroy();
  }
}

export {baseLanguage};

// Starting each pipeline (player-start.js), the subtitle tracks (player-subtitles.js), adaptive streams
// (adaptive.js) and the data count and saver (player-data.js) live in modules of their own.
Object.assign(AstraPlayer.prototype, startMethods, subtitleMethods, adaptiveMethods, dataMethods);
