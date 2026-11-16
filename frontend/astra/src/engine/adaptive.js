// Adaptive streams (HLS, DASH) for AstraPlayer (player.js), through hls.js and
// dash.js, served from the site's own vendor/ (scripts/astra/vendor.mjs pins
// them) and integrity-checked, loaded only when a stream needs one. Mixed into
// AstraPlayer's prototype, so `this` is the player. Every wait ends when the
// load is replaced or closed (`signal`), and a library that arrives after that
// is never attached to the video element.

import {languageName} from './languages.js';
import {markupSpans} from '../subtitles/parse.js';
import {hlsTuning, dashTuning, capHls, capNow} from './adaptive-tuning.js';
import {saverOn} from './player-data.js';

const VENDOR = new URL('../../vendor/', import.meta.url);
const LIBRARIES = { // hls.js 1.6.13 and dash.js 5.2.0, as vendor/vendor.json pins them
  hls: {src: new URL('hls/hls.min.js', VENDOR).href, integrity: 'sha384-z+tuLqMWl1/cPv7O+39RO0EURSNvorimpcCaMgeNwU+qFBx+AlUIl7jaAwg0cYil', global: 'Hls'},
  dash: {src: new URL('dash/dash.all.min.js', VENDOR).href, integrity: 'sha384-DUqWPzOl/i7/DGF7SBoe4NrlZOMxxomlJsg3X0daS5SBeFxco3dmwWQPFr2oauXn', global: 'dashjs'},
};
const loaded = {};
function library(name) {
  const lib = LIBRARIES[name];
  return loaded[name] ??= new Promise((resolve, reject) => {
    if (globalThis[lib.global]) return resolve(globalThis[lib.global]);
    const s = document.createElement('script');
    Object.assign(s, {src: lib.src, integrity: lib.integrity, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer', async: true});
    s.onload = () => resolve(globalThis[lib.global]);
    s.onerror = () => { delete loaded[name]; s.remove(); reject(Error(`The ${name.toUpperCase()} player could not be downloaded.`)); };
    document.head.append(s);
  });
}

/** `promise`, or a 'closed' rejection as soon as `signal` aborts. */
export function until(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const closed = () => reject(Object.assign(new Error('Playback was closed.'), {kind: 'closed'}));
    if (signal.aborted) return closed();
    signal.addEventListener('abort', closed, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', closed));
  });
}

export const adaptiveMethods = {
  async startHls(url, headers, startTime, id, signal) {
    const Hls = await until(library('hls'), signal);
    if (id !== this.load_) return;
    if (!Hls.isSupported()) { await this.startNative(url, startTime, signal); this.mode = 'native'; return; }
    const saver = () => saverOn(this.saverSetting ?? 'auto');
    const hls = new Hls({startPosition: startTime > 0 ? startTime : -1, xhrSetup: xhr => { for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v); }, renderTextTracksNatively: true, ...hlsTuning(saver())});
    capHls(hls, saver); // the picture no larger than the player (and 720p's worth with the saver on): adaptive-tuning.js
    this.hls = hls;
    let recovered = 0;
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal || id !== this.load_) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) return hls.recoverMediaError();
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 3) return hls.startLoad();
      this.fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'The stream stopped loading.' : 'The stream could not be decoded.', data.details);
    });
    const refresh = () => {
      if (id !== this.load_) return;
      this.audio = hls.audioTracks.map((t, i) => ({id: 'hls:' + i, index: i, label: t.name || languageName(t.lang) || `Track ${i + 1}`, language: t.lang || '', supported: true}));
      this.selectedAudio = hls.audioTrack >= 0 ? 'hls:' + hls.audioTrack : null;
      this.textTracks = this.textTracks.filter(t => t.kind !== 'stream').concat(hls.subtitleTracks.map((t, i) => ({id: 'hls-sub:' + i, index: i, label: t.name || languageName(t.lang) || `Subtitles ${i + 1}`, language: t.lang || '', kind: 'stream', supported: true})));
      this.emit('tracks');
    };
    hls.on(Hls.Events.MANIFEST_PARSED, refresh);
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refresh);
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refresh);
    hls.on(Hls.Events.SUBTITLE_FRAG_PROCESSED, () => { if (id === this.load_) this.pullTextTrackCues(); });
    // What the stream has cost (dataUsed): every piece and playlist loaded, as hls.js counts it.
    for (const event of [Hls.Events.FRAG_LOADED, Hls.Events.MANIFEST_LOADED, Hls.Events.LEVEL_LOADED, Hls.Events.AUDIO_TRACK_LOADED, Hls.Events.SUBTITLE_TRACK_LOADED]) {
      hls.on(event, (_, d) => { if (id === this.load_) this.countAdaptive(d?.frag?.stats?.loaded ?? d?.stats?.loaded ?? d?.payload?.byteLength ?? 0); });
    }
    hls.subtitleDisplay = false;
    await until(new Promise((resolve, reject) => {
      hls.once(Hls.Events.MANIFEST_PARSED, resolve);
      hls.once(Hls.Events.ERROR, (_, d) => d.fatal && reject(Error('The stream could not be opened.')));
      hls.loadSource(url);
      hls.attachMedia(this.video);
    }), signal);
  },

  async startDash(url, startTime, id, signal) {
    const dashjs = await until(library('dash'), signal);
    if (id !== this.load_) return;
    const player = dashjs.MediaPlayer().create();
    // A live stream that names no clock of its own is timed from its own host's answer, not dash.js's default (a third party's).
    player.updateSettings({streaming: {utcSynchronization: {defaultTimingSource: {scheme: 'urn:mpeg:dash:utc:http-head:2014', value: url}}}});
    player.updateSettings(dashTuning(saverOn(this.saverSetting ?? 'auto'))); // a phone's settings: adaptive-tuning.js
    this.dash = player;
    const events = dashjs.MediaPlayer.events;
    // What the stream has cost (dataUsed): every piece dash.js loaded.
    player.on(events.FRAGMENT_LOADING_COMPLETED, e => { if (id === this.load_) this.countAdaptive(e?.request?.bytesLoaded || e?.response?.byteLength || 0); });
    await until(new Promise((resolve, reject) => {
      player.on(events.STREAM_INITIALIZED, resolve);
      player.on(events.ERROR, e => {
        if (id !== this.load_) return;
        reject(Error('The stream could not be played.'));
        this.fail('The stream could not be played.', JSON.stringify(e?.error || e));
      });
      player.initialize(this.video, url, false, startTime > 0 ? startTime : undefined);
    }), signal);
    if (id !== this.load_) return;
    const tracks = player.getTracksFor('audio') || [];
    const current = player.getCurrentTrackFor('audio');
    this.audio = tracks.map((t, i) => ({id: 'dash:' + i, track: t, label: t.labels?.[0]?.text || languageName(t.lang) || `Track ${i + 1}`, language: t.lang || '', supported: true}));
    this.selectedAudio = this.audio.find(a => a.track === current)?.id ?? this.audio[0]?.id ?? null;
    // The stream's own subtitles: dash.js puts their cues on the video's text tracks, which Astra copies.
    const texts = player.getTracksFor('text') || [];
    this.textTracks = this.textTracks.filter(t => t.kind !== 'stream').concat(texts.map((t, i) => ({id: 'dash-sub:' + i, index: i, label: t.labels?.[0]?.text || languageName(t.lang) || `Subtitles ${i + 1}`, language: t.lang || '', kind: 'stream', supported: true})));
    player.enableText?.(false);
    this.tuneAdaptive(); // the saver's ceiling needs the stream's own picture sizes
  },

  /** Puts the data saver's reach (and its ceiling on the picture) on the HLS or DASH player of the film loaded now. */
  tuneAdaptive() {
    const on = saverOn(this.saverSetting ?? 'auto');
    if (this.hls) { Object.assign(this.hls.config, hlsTuning(on)); capNow(this.hls, on); } // hls.js reads its config afresh as it loads
    if (this.dash) this.dash.updateSettings(dashTuning(on, this.dash));
  },

  /**
   * Copies cues an adaptive player (hls.js, dash.js) placed on the video's
   * text tracks into Astra's renderer, each cue once. Runs as subtitle
   * fragments arrive and on timeupdate while the stream's own subtitles show.
   */
  pullTextTrackCues() {
    const selected = this.textTracks.find(t => t.id === this.selectedSubtitle);
    if (selected?.kind !== 'stream') return;
    this.pulledCues ??= new WeakSet();
    for (const t of this.video.textTracks) {
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'showing') t.mode = 'hidden';
      if (t.mode === 'disabled') continue;
      const cues = [];
      for (const c of t.cues || []) {
        if (this.pulledCues.has(c)) continue;
        this.pulledCues.add(c);
        cues.push({start: c.startTime, end: c.endTime, align: 2, pos: null, spans: markupSpans(c.text || '')});
      }
      if (cues.length) this.receiveCues(selected.id, cues);
    }
  },
};
