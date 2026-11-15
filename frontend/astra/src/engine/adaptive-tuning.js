// A phone's settings for hls.js and dash.js (adaptive.js), in place of their
// desktop defaults: the picture no larger than the player shows it (its size
// times the device pixel ratio, counted at most 2), 40 s read ahead (20 s with the data saver,
// the same as Astra's own re-wrapping, player-data.js), 30 s kept behind,
// and with the saver on a ceiling of 720p's worth of picture. Names and
// defaults are those of the vendored hls.js 1.6.13 and dash.js 5.2.0:
//
//   hls.js  capLevelToPlayerSize false, maxDevicePixelRatio Infinity, capLevelOnFPSDrop false, maxBufferLength 30,
//           maxMaxBufferLength 600 (it reads past maxBufferLength on low-bitrate streams,
//           up to maxBufferSize 60 MB), backBufferLength Infinity
//   dash.js streaming.abr.limitBitrateByPortal false, usePixelRatioInLimitBitrateByPortal false,
//           streaming.buffer.bufferTimeDefault 18, bufferTimeAtTopQuality 30,
//           bufferTimeAtTopQualityLongForm 60, bufferToKeep 20, streaming.abr.maxBitrate.video -1 (kbit/s)

import {SAVER} from './player-data.js';

export const AHEAD = 40, BEHIND = 30, CEILING_HEIGHT = 720;
// hls.js takes the smallest level at least as big as the player, so a phone held sideways (about 800 CSS
// pixels at a ratio near 3, so 2340 physical pixels) would be given 4K; at 2 it gets 1080p. dash.js keeps
// only pictures no wider than the player, so its full ratio never lets 4K through on a phone and stays.
export const MAX_PIXEL_RATIO = 2;
const CEILING_KBPS = 3000; // 720p's worth where a stream does not say its picture sizes

const ahead = on => (on ? SAVER.ahead : AHEAD);

/** hls.js options for the saver on or off (also put on a running player's config, which it reads as it loads). */
export function hlsTuning(on) {
  return {capLevelToPlayerSize: true, capLevelOnFPSDrop: true, maxBufferLength: ahead(on), maxMaxBufferLength: ahead(on), backBufferLength: BEHIND};
}

/**
 * The highest level a phone screen needs with the saver on: the last no taller than 720 lines, or, where heights
 * are unknown, no more than 3 Mbit/s; the lowest when none is. `levels` sorted from the lowest, as hls.js keeps them.
 */
export function saverCeiling(levels = []) {
  let top = 0;
  levels.forEach((l, i) => { if (l.height ? l.height <= CEILING_HEIGHT : (l.bitrate || l.bandwidth || 0) <= CEILING_KBPS * 1000) top = i; });
  return top;
}

/**
 * Counts the screen's pixel ratio at most 2 and keeps hls.js under the saver's ceiling. Its own size cap (capLevelToPlayerSize) sets autoLevelCapping every
 * second from getMaxLevel, so the ceiling goes in there; while the player has no size it is set directly.
 */
export function capHls(hls, saver) {
  if (hls.config) hls.config.maxDevicePixelRatio = MAX_PIXEL_RATIO; // read afresh at each size check
  const cap = hls.capLevelController;
  if (typeof cap?.getMaxLevel === 'function') {
    const own = cap.getMaxLevel.bind(cap);
    cap.getMaxLevel = top => own(saver() ? Math.min(top, saverCeiling(hls.levels)) : top);
  }
  const Hls = hls.constructor;
  hls.on?.(Hls?.Events?.MANIFEST_PARSED ?? 'hlsManifestParsed', () => capNow(hls, saver()));
}

/** Puts the ceiling on at once (the saver turned on), or takes away one put on here (turned off). */
export function capNow(hls, on) {
  if (!hls.levels?.length) return;
  const ceiling = saverCeiling(hls.levels), now = hls.autoLevelCapping;
  if (on && (now < 0 || now > ceiling)) { hls.autoLevelCapping = ceiling; hls.saverCapped = true; }
  else if (!on && hls.saverCapped) { hls.saverCapped = false; hls.autoLevelCapping = -1; } // the size cap sets its own again within a second
}

/** dash.js settings for the saver on or off; `player`, once the stream is known, gives the ceiling from its own picture sizes. */
export function dashTuning(on, player = null) {
  let kbps = -1;
  if (on) {
    let reps = [];
    try { reps = player?.getRepresentationsByType?.('video') || []; } catch {}
    const known = [...reps].sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
    kbps = known.length ? Math.ceil((known[saverCeiling(known)].bandwidth || CEILING_KBPS * 1000) / 1000) : CEILING_KBPS;
  }
  const t = ahead(on);
  return {streaming: {
    buffer: {bufferTimeDefault: t, bufferTimeAtTopQuality: t, bufferTimeAtTopQualityLongForm: t, bufferToKeep: BEHIND},
    abr: {limitBitrateByPortal: true, usePixelRatioInLimitBitrateByPortal: true, maxBitrate: {video: kbps}},
  }};
}
