// Starting each pipeline AstraPlayer (player.js) can run: the browser's own
// (native), Astra's re-wrapping (remux) and the software decoder. Mixed into
// AstraPlayer's prototype, so `this` is the player. Each takes the load's id
// and stops after an await that finds a newer load.

import {RemuxSession} from './remux.js';
import {SoftwareSession, softwareAudio} from './software.js';
import {languageName} from './languages.js';

const NETWORK_KINDS = new Set(['network', 'stall', 'timeout']);

export const startMethods = {
  async startNative(url, startTime, signal) {
    // A host the probe found lets the page read the file (CORS) is asked with CORS, so the page may use the film's
    // sound and frames (the sound features, frame capture); any other would refuse such a request, so it is asked plainly.
    if (this.readable) this.video.crossOrigin = 'anonymous'; else this.video.removeAttribute('crossorigin');
    this.video.src = url;
    // Ends with the load, so a load whose metadata never comes cannot move a later film.
    if (startTime > 0) this.video.addEventListener('loadedmetadata', () => { this.video.currentTime = startTime; }, {once: true, signal});
    const tracks = this.video.audioTracks; // Safari only; Chromium has no audioTracks
    this.audio = tracks ? Array.from(tracks, (t, i) => ({id: 'native:' + i, label: t.label || languageName(t.language) || `Track ${i + 1}`, language: t.language, supported: true, native: t})) : [];
    this.selectedAudio = this.audio.find(a => a.native?.enabled)?.id ?? null;
  },

  async startRemux(startTime, id = this.load_) {
    const {plan, info, probed} = this;
    this.audio = plan.audioOptions.map(o => ({id: o.track.id, label: o.label, language: o.track.language, delivery: o.delivery, supported: o.delivery !== 'unsupported', reason: o.reason, option: o}));
    this.selectedAudio = plan.audio?.track.id ?? null;
    const session = new RemuxSession(this.video, {info, video: plan.video, audio: plan.audio, source: probed?.source, early: !this.plainFragments});
    session.addEventListener('status', e => this.status(e.detail));
    session.addEventListener('error', e => this.fail(e.detail?.message || 'Playback stopped.', String(e.detail?.stack || e.detail), {decode: !e.detail?.kind, network: NETWORK_KINDS.has(e.detail?.kind)}));
    session.addEventListener('stall', e => this.record('stall', e.detail));
    session.addEventListener('audioended', () => { if (this.session === session) this.resume('The sound in this file ended before the picture.', {silent: true}); });
    this.session = session;
    this.soundToSession(session); // the sound tap, dialogue lift and sound advance (player-sound.js)
    this.applyDataSaver(); // how far ahead it reads, with the data saver on or off
    this.startScanner();
    await session.start(startTime);
    if (id !== this.load_) return;
    if (plan.subtitle) this.selectSubtitle(plan.subtitle.id);
  },

  /** Software decoding through libmedia (see software.js). */
  async startSoftware(startTime, id = this.load_) {
    const {plan, info, probed} = this;
    probed.input?.dispose?.();
    const session = new SoftwareSession(this.video, {source: probed.source});
    session.addEventListener('status', e => this.status(e.detail));
    session.addEventListener('error', e => { this.record('error', {message: 'software', detail: String(e.detail?.message || e.detail)}); this.emit('error', {message: 'The software decoder could not continue with this file.', detail: String(e.detail?.message || e.detail), plan: this.plan}); });
    session.addEventListener('tracks', () => this.emit('tracks'));
    this.session = session;
    this.startScanner();
    await session.start(startTime, {autoplay: false}); // throws, kind 'closed', when this load was replaced meanwhile
    if (id !== this.load_) return;
    // Audio tracks as libmedia numbers them, labelled from the probe when it read the same file.
    const streams = session.audioStreams(), known = info?.audio || [], same = known.length === streams.length;
    this.audio = streams.map((s, i) => {
      const track = same ? known[i] : null;
      const option = track && plan.audioOptions?.find(o => o.track === track);
      const supported = s.decodable && (track ? softwareAudio(track) : true);
      return {id: 'sw:' + s.id, stream: s.id, label: option?.label || s.title || languageName(s.language) || `Track ${i + 1}`, language: track?.language || s.language, supported, reason: supported ? '' : option?.reason || 'This audio format cannot be decoded in a browser.', delivery: 'software'};
    });
    if (session.silent) this.plan = {...plan, notes: [...(plan.notes || []), 'The sound in this file cannot be decoded in a browser, so it plays without sound.']};
    // The track the planner chose (the preferred language), not libmedia's first.
    const wanted = same && plan.audio ? streams[known.indexOf(plan.audio.track)] : null;
    if (wanted && !wanted.active && this.audio.find(a => a.stream === wanted.id)?.supported) {
      await session.setAudioStream(wanted.id);
      if (id !== this.load_) return;
    }
    this.selectedAudio = (wanted && this.audio.find(a => a.stream === wanted.id && a.supported)?.id) ?? this.audio.find(a => streams.find(s => s.id === a.stream)?.active)?.id ?? this.audio[0]?.id ?? null;
    if (plan.subtitle) this.selectSubtitle(plan.subtitle.id);
  },
};
