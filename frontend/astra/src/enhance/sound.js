// Better sound for the film's <video>: louder for quiet films, night mode,
// clearer speech, sound later than the picture, even loudness and headphone
// surround (the chain is in sound-chain.js). No UI: the player's menus call set() and read state().
//
// Two things are permanent once done, so this file is careful about both:
// - createMediaElementSource takes the element's sound for good: from then on
//   the film is heard only through this AudioContext. So nothing is captured
//   until a feature is first turned on, never for a film the page cannot read
//   (it would play as silence), and never while the context is suspended (the
//   film would be silent until a tap): the context is resumed on the next
//   play or tap, and only then is the sound captured.
// - Once captured, the chain stays connected for the element's life; with
//   every feature off it is a straight wire (bit-transparent at gain 1), and
//   close() returns it to that wire rather than tearing anything down.

import {SoundChain, OFF, settle, isOff} from './sound-chain.js';
import {unreadable} from './origin.js';

export {centreGain, stereoMatrix, NIGHT, LIMIT, SPEECH, STEP_DB} from './sound-chain.js';

/**
 * Why this film's sound cannot be changed, or ''.
 * @param {HTMLVideoElement} video
 * @param {string} [mode] the engine's mode ('native', 'remux', 'hls', 'dash', 'software')
 */
export function whyNot(video, mode) {
  if (mode === 'software' || video.srcObject) return 'The software decoder plays the sound through its own audio graph, not the video element.';
  return unreadable(video);
}

/** True only when changing the sound cannot silence the film: a blob: MediaSource the page made, or a same-origin film. */
export const canProcess = (video, mode) => !whyNot(video, mode);

// Counts the channels the element's sound really has (MediaElementAudioSourceNode.channelCount
// always reads 2; the real count shows only in the audio itself). Reports a count once a block
// carrying it has any sound in it, so a paused element's silent block does not count.
const COUNTER = `registerProcessor('astra-channels', class extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; }
  process(inputs) {
    const ins = inputs[0], n = ins.length;
    if (n && n !== this.n && ins.some(ch => ch.some(x => x !== 0))) { this.n = n; this.port.postMessage(n); }
    return true;
  }
});`;

export class Sound {
  /**
   * @param {HTMLVideoElement} video
   * @param {{onReport?: (reason: string) => void, onSettle?: (id: string, db: number) => void}} [options]
   *   onReport: told why a setting could not be applied, or that the sound went silent; onSettle: a film's settled loudness gain
   */
  constructor(video, {onReport, onSettle} = {}) {
    this.video = video;
    this.onReport = onReport || (() => {});
    this.onSettle = onSettle || (() => {});
    this.opening = [null, {}]; // the film playing and where its loudness gain starts, for a chain made later
    this.mode = null; // the engine's mode for the film playing; the player sets it on each load
    this.settings = OFF;
    this.ctx = null; this.source = null; this.chain = null; this.counter = null;
    this.channels = 0;
    this.reason = '';
    this.closed = false;
    this.wake = () => this.resume();
    this.onLoad = () => {
      // The element is ours for good once captured: a film it cannot read now plays as silence.
      const why = this.source && unreadable(this.video);
      if (why) this.report(`This film plays without sound: ${why}`);
      // A new film with another layout is noticed by the channel counter, which reports every change.
    };
    video.addEventListener('loadstart', this.onLoad);
  }

  report(reason) { this.reason = reason; this.onReport(reason); }

  /**
   * Turns features on or off: {boost: 1-3, night: bool, dialogue: 0-2, delay: 0-1 s, loudness: bool, headphones: bool}.
   * Missing keys keep their value. Returns false when the film's sound cannot be changed (see state().reason).
   */
  set(next = {}) {
    if (this.closed) return false;
    const wanted = settle({...this.settings, ...next});
    if (!this.source) {
      if (isOff(wanted)) { this.settings = wanted; return true; }
      const why = whyNot(this.video, this.mode);
      if (why) { this.report(why); return false; }
    }
    this.settings = wanted;
    this.reason = '';
    if (this.source) this.update(); else this.start();
    return true;
  }

  /** The film playing (the player's title id) and where its loudness gain starts ({db, known}). */
  film(id, start = {}) {
    this.opening = [id, start];
    this.chain?.film(id, start);
  }

  state() {
    return {settings: {...this.settings}, captured: !!this.source, active: !!this.source && !isOff(this.settings), channels: this.channels, context: this.ctx?.state || 'none', reason: this.reason};
  }

  /** Makes the context (suspended until a tap, if the page has had none) and captures the sound once it runs. */
  start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Android can suspend a running context (another app takes the sound): the next play or tap resumes it.
      this.ctx.addEventListener('statechange', () => { if (this.ctx?.state !== 'running' && this.source) this.listen(); });
    }
    this.resume();
  }

  resume() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') { this.unlisten(); if (!this.source) this.capture(); return; }
    this.listen();
    ctx.resume().then(() => { if (ctx.state === 'running') this.resume(); }, () => {});
  }

  // A context that needs a tap: the next play or tap resumes it.
  listen() {
    this.video.addEventListener('play', this.wake);
    addEventListener('pointerdown', this.wake, true);
    addEventListener('keydown', this.wake, true);
  }
  unlisten() {
    this.video.removeEventListener('play', this.wake);
    removeEventListener('pointerdown', this.wake, true);
    removeEventListener('keydown', this.wake, true);
  }

  capture() {
    if (this.closed && isOff(this.settings)) return;
    if (whyNot(this.video, this.mode)) { this.report(whyNot(this.video, this.mode)); return; } // the film changed while waiting for a tap
    const ctx = /** @type {AudioContext} */ (this.ctx);
    this.source = ctx.createMediaElementSource(this.video);
    // The element's volume is applied before the chain: the loudness meter takes it back out.
    this.chain = new SoundChain(ctx, {volume: () => this.video.muted ? 0 : this.video.volume, onSettle: (id, db) => this.onSettle(id, db)});
    this.chain.film(...this.opening);
    this.source.connect(this.chain.in);
    this.chain.out.connect(ctx.destination);
    this.update();
  }

  update() {
    if (!this.chain) return;
    if (this.settings.dialogue > 0 || this.settings.headphones) this.count();
    else if (this.counter instanceof AudioWorkletNode) { this.counter.disconnect(); this.counter = null; }
    this.chain.apply(this.settings, this.channels);
  }

  // The channel counter runs only while dialogue or headphone surround is on: they are the features that depend on the layout.
  async count() {
    if (this.counter) return;
    const ctx = /** @type {AudioContext} */ (this.ctx);
    this.counter = 'loading';
    try {
      if (!this.registered) {
        const url = URL.createObjectURL(new Blob([COUNTER], {type: 'text/javascript'}));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        this.registered = true;
      }
      if (this.counter !== 'loading') return; // closed, or dialogue turned off, while loading
      const node = new AudioWorkletNode(ctx, 'astra-channels', {numberOfOutputs: 0});
      node.port.onmessage = e => { if (e.data !== this.channels) { this.channels = e.data; this.update(); } };
      this.source?.connect(node);
      this.counter = node;
    } catch {
      // No worklet (an old browser or a policy): treat the sound as stereo, so dialogue lifts the speech band.
      this.counter = 'none';
      this.channels ||= 2;
      this.update();
    }
  }

  /** All features off and the chain left as a straight wire: the film stays audible for the element's life. */
  close() {
    this.settings = OFF;
    this.chain?.close();
    if (this.counter instanceof AudioWorkletNode) this.counter.disconnect();
    this.counter = null;
    this.closed = true;
    if (!this.source) { this.unlisten(); this.ctx?.close().catch(() => {}); this.ctx = null; }
    this.video.removeEventListener('loadstart', this.onLoad);
    // When the sound was captured, the resume listeners stay: a suspended context would silence the film.
  }
}
