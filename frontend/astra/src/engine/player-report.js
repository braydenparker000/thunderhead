// The shareable playback report for AstraPlayer (player.js): what the file
// contains, how it plays, what this device supports. Mixed into AstraPlayer's
// prototype, so `this` is the player.

import {describeInfo} from './probe.js';
import {deviceReport} from './capabilities.js';

export const reportMethods = {
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
