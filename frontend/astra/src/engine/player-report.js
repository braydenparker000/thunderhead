// The shareable playback report for AstraPlayer (player.js): what the file
// contains, how it plays, what this device supports. Mixed into AstraPlayer's
// prototype, so `this` is the player.

import {describeInfo} from './probe.js';
import {deviceReport} from './capabilities.js';

export const reportMethods = {
  /**
   * A step of the start, timed in the log for the report ('timing'): ms since load(), the bytes and requests so far
   * ('open', 'index', 'track', 'plan', 'fragment', 'picture'). Numbers and fixed words only, never an address or a name.
   */
  mark(step, extra = {}) {
    const s = this.probed?.source || this.source;
    this.record('timing', {step, ms: Math.round(performance.now() - (this.loadAt ?? 0)), bytes: s?.bytesFetched ?? 0, requests: s?.requests ?? 0, ...extra});
  },

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
  },
};
