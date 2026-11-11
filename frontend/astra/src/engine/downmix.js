// Stereo from whatever a film's sound has, one decoded sample at a time.
//
// Mediabunny can do this itself (its `transform`), but it hands the result on
// in five-second blocks, so converted sound (Dolby Digital, DTS) could not
// start until five seconds of the file had been read: every start and every
// far seek waited for that. Mixed here, a sample goes on as soon as it is
// decoded. Sound that is not at 48 kHz still goes through Mediabunny, which
// also resamples.

const HALF = Math.SQRT1_2;

/**
 * Mixes interleaved samples of `channels` channels down (or up) to interleaved
 * stereo. Channel order is the usual one: L R, L R C, L R SL SR, L R C SL SR,
 * L R C LFE SL SR, L R C LFE BC SL SR, L R C LFE BL BR SL SR. The bass channel
 * is left out, as players do.
 * @param {Float32Array} source
 * @param {number} channels
 * @returns {Float32Array}
 */
export function toStereo(source, channels) {
  const frames = Math.floor(source.length / channels), out = new Float32Array(frames * 2);
  for (let n = 0, i = 0; n < frames; n++, i += channels) {
    let left, right;
    if (channels === 1) left = right = source[i];
    else if (channels === 2) { left = source[i]; right = source[i + 1]; }
    else if (channels === 3) { left = source[i] + HALF * source[i + 2]; right = source[i + 1] + HALF * source[i + 2]; }
    else if (channels === 4) { left = 0.5 * (source[i] + source[i + 2]); right = 0.5 * (source[i + 1] + source[i + 3]); }
    else if (channels === 5) { left = source[i] + HALF * (source[i + 2] + source[i + 3]); right = source[i + 1] + HALF * (source[i + 2] + source[i + 4]); }
    else if (channels === 6) { left = source[i] + HALF * (source[i + 2] + source[i + 4]); right = source[i + 1] + HALF * (source[i + 2] + source[i + 5]); }
    else if (channels === 7) { left = source[i] + HALF * (source[i + 2] + source[i + 5]) + 0.5 * source[i + 4]; right = source[i + 1] + HALF * (source[i + 2] + source[i + 6]) + 0.5 * source[i + 4]; }
    else { left = source[i] + HALF * source[i + 2] + 0.5 * (source[i + 4] + source[i + 6]); right = source[i + 1] + HALF * source[i + 2] + 0.5 * (source[i + 5] + source[i + 7]); }
    out[n * 2] = left; out[n * 2 + 1] = right;
  }
  return out;
}

/** True when sound at this rate can be mixed here: the Opus the browser plays is written at 48 kHz, and this does not resample. */
export const mixable = sampleRate => sampleRate === 48000;
