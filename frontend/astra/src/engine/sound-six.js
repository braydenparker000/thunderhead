// Rebuilt surround sound kept whole for Headphone surround (enhance/headphone.js), instead of mixed to stereo Opus.
//
// The browser will not encode more than two channels here (AudioEncoder: no to 6-channel Opus, to AAC, to FLAC)
// and its media source will not take uncompressed PCM in MP4 ('ipcm', 'fpcm', 'lpcm': all no), but it plays FLAC in
// MP4 with every channel, and FLAC lets a frame carry its samples as they are ("verbatim" subframes): no encoder is
// needed, only the frame's few header bytes and two checksums. So with Headphone surround on, a rebuilt track of 5 to
// 8 channels is written as such FLAC (16-bit) into an audio buffer of that type, and its channels reach the page's
// sound chain (from a session's start only: see soundMime). It is large (5.1 at 48 kHz: 576 kB a second, ten times the Opus), so it is used only while the owner
// has Headphone surround on, and the sound reads at most AHEAD seconds past the playhead. The centre is still raised
// here (the dialogue lift: the chain leaves rebuilt sound's centre to the engine) before it is placed.

import {placeable} from '../enhance/headphone.js';
import {mediaSourceClass} from './capabilities.js';
import {audioMime} from './plan.js';

// The frames and the writer live apart, where the sound worker can load them (flac-frames.js, sound-write.js).
export {FlacFrames, codedNumber} from './flac-frames.js';
export {wholeWriter} from './sound-write.js';

export const FLAC = 'audio/mp4; codecs="flac"';
/**
 * Seconds the placed sound comes out later than the plain mix: the browser's HRTF panners (their convolution, 6.2 ms)
 * and its limiter's look-ahead (6 ms), which the chain puts in its path for headphone surround (enhance/headphone.js,
 * sound-chain.js): 12.2 ms for an impulse through the chain offline, and 12 to 16 ms later than the AAC track and the
 * plain mix against the film's frames (frontend/astra/README.md, A slow link…). Nothing waits for Web Audio's own
 * delay, so whole surround, which only that chain plays, is written that much earlier than the picture.
 */
export const PLACED = 0.012;

/** Seconds the sound buffer's timestamps sit before the file's: its start, the owner's advance, the placed sound's delay. */
export const soundShift = session => session.offset + session.advance + (session.audioMime === FLAC ? PLACED : 0);
export const AHEAD = 15; // seconds of whole surround sound read past the playhead
let plays = null;

/** True when this browser's media source plays FLAC in MP4. */
export const flacPlays = () => plays ??= !!mediaSourceClass()?.isTypeSupported?.(FLAC);

/** True when the rebuilt `choice` would be written whole: Headphone surround is on and its layout can be placed. */
export const keepsSurround = (session, choice) => choice?.delivery === 'rebuilt' && !!session.surround && placeable(choice.track?.channels) && flacPlays();

/**
 * The audio buffer's type for `choice`: passed through as it is, rebuilt whole (FLAC) or rebuilt as stereo Opus. Whole
 * sound is chosen only as a session starts: Chrome keeps the channel layout its audio began with and converts what
 * comes later to it, so a buffer refilled (`was`: another track, the dialogue lift) keeps its kind, and the player
 * opens a fresh session to change it (player-sound.js setSurround).
 */
export function soundMime(session, choice, was = null) {
  if (choice.delivery !== 'rebuilt') return audioMime(choice.track);
  if (was) return was === FLAC ? FLAC : OPUS;
  return keepsSurround(session, choice) ? FLAC : OPUS;
}
const OPUS = 'audio/mp4; codecs="opus"';

/** Waits while whole surround sound read is more than AHEAD seconds past the playhead (on top of session.room). */
export async function sixRoom(session, timestamp, live) {
  while (live() && timestamp - session.offset - session.video.currentTime > AHEAD) await new Promise(resolve => setTimeout(resolve, 250));
  return live();
}
