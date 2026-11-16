// The engine's part of the sound features, for AstraPlayer (player.js). Mixed
// into AstraPlayer's prototype, so `this` is the player. Each setting is kept
// on the player and put on every remux session it starts (startRemux calls
// soundToSession), so a seek, a resume or another source keeps it.
//
// setSoundTap(tap | null): decoded sound for Skip intro (sound-tap.js). Remux
//   mode only: in native, HLS and DASH modes the browser decodes the sound out
//   of the page's reach, and the software decoder's sound is libmedia's own, so
//   the tap is accepted and simply never fed there.
// setDialogue(step 0-2): rebuilt sound (Dolby Digital, DTS, TrueHD) is mixed to
//   stereo by the engine, so the centre (where speech is) is raised there, by
//   centreGain(step). Sound passed through as it is is left to enhance/sound.js.
// setSurround(on): Headphone surround is on: rebuilt sound of 5 to 8 channels
//   is then kept whole (sound-six.js) rather than mixed to stereo, where this
//   browser plays it (canKeepSurround), so the page's chain can place it. The
//   browser fixes the sound's channels when a media source starts, so a change
//   (or a track whose kind differs) opens a fresh session at the same place.
// setAudioAdvance(seconds 0-1): the sound plays that much earlier than the
//   picture (remux mode; elsewhere accepted and nothing happens: the page's own
//   delay can only make sound later).
// routeSoftwareSound(makeChain): software-decoder mode (software-sound.js).

import {TapFeed} from './sound-tap.js';
import {centreGain} from '../enhance/sound-chain.js';
import {routeSoftwareSound} from './software-sound.js';
import {FLAC, flacPlays, soundMime} from './sound-six.js';
import {placeable} from '../enhance/headphone.js';

export const soundMethods = {
  setSoundTap(tap) {
    this.tapFeed?.close();
    this.tapFeed = tap && typeof tap.wants === 'function' && typeof tap.feed === 'function' ? new TapFeed(tap, line => this.record('tap', line)) : null;
    this.tapFeed?.forLoad(this.load_);
    if (this.mode === 'remux' && this.session) this.session.tap = this.tapFeed;
  },

  setDialogue(step) {
    this.dialogueStep = Math.max(0, Math.min(2, Math.round(Number(step) || 0)));
    if (this.mode === 'remux') this.session?.setCentre?.(centreGain(this.dialogueStep));
  },

  setSurround(on) {
    this.surroundOn = !!on;
    const session = this.mode === 'remux' && !this.reopening ? this.session : null;
    if (!session?.queues?.audio || !session.audio) return;
    session.surround = this.surroundOn;
    if ((soundMime(session, session.audio) === FLAC) !== (session.audioMime === FLAC)) this.reopenSound();
  },

  /** A fresh remux session where the film is, for the sound's other kind; the picture pauses briefly. */
  async reopenSound() {
    const id = this.load_, at = this.video.currentTime, playing = this.playing, subtitle = this.selectedSubtitle;
    const chosen = this.audio.find(a => a.id === this.selectedAudio)?.option;
    this.reopening = true;
    this.record('sound', this.surroundOn ? 'surround kept whole' : 'surround mixed to stereo');
    this.session?.destroy(); this.session = null;
    if (chosen && this.plan.audio) this.plan = {...this.plan, audio: {track: chosen.track, delivery: chosen.delivery}};
    try {
      await this.startRemux(at, id);
      if (id !== this.load_) return;
      if (this.selectedSubtitle !== subtitle) this.selectSubtitle(subtitle);
      if (playing) this.video.play().catch(() => {});
    } catch (error) {
      if (id === this.load_) this.fail('Playback stopped.', String(error?.message || error), {decode: !error?.kind});
    } finally { this.reopening = false; }
    if (id === this.load_) this.setSurround(this.surroundOn); // changed again meanwhile
  },

  /** Whether rebuilt sound of `channels` channels can reach the page whole here (remux mode). */
  canKeepSurround(channels) { return this.mode === 'remux' && placeable(channels) && flacPlays(); },

  setAudioAdvance(seconds) {
    this.audioAdvance = Math.max(0, Math.min(1, Number(seconds) || 0));
    if (this.mode === 'remux') this.session?.setAdvance?.(this.audioAdvance);
  },

  /** The sound chain `makeChain(audioContext)` in the software decoder's sound path; false when it cannot go in now. */
  routeSoftwareSound(makeChain) {
    if (this.mode !== 'software' || !this.session || typeof makeChain !== 'function') return false;
    return routeSoftwareSound(this.session, makeChain, line => this.record('sound', line));
  },

  /** Puts the sound settings on a remux session before it starts reading. */
  soundToSession(session) {
    session.tap = this.tapFeed?.forLoad(this.load_) ?? null;
    session.centre = centreGain(this.dialogueStep || 0);
    session.advance = this.audioAdvance || 0;
    session.surround = !!this.surroundOn;
  },
};
