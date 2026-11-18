// Changing what a re-wrapped film's sound is (remux.js): another track, the sound moved earlier than the picture, the
// centre mixed again. Mixed into RemuxSession's prototype, so `this` is the session. Only the audio buffer changes.
//
// Another track, or the same mixed again, is written over the old from a second past the playhead (SWITCH.join): the
// old sound plays on until there and the new one from there, and the picture never stops. Emptying the buffer instead
// meant seeking in place to make Chrome let go of the sound it had already decoded, which stopped the picture: on a
// 25 Mbit/s film, Dolby Digital Plus to TrueHD, 0.9 to 1.2 s on a fast machine and 1.8 to 2.7 s with the page six
// times slower (frontend/astra/README.md, Converted sound). Chrome decodes about 0.2 s of sound ahead, but each time
// its sound runs short while playing it doubles that store, up to 3 s, until the next seek: written over then, the
// old sound went on for up to 3 s and the new one came that much later. So the sound is written over only while the
// film has not run short since its last seek (session.ranShort, rebuffer.js), with at least the join's length and
// half a second more buffered ahead, and sound whose timestamps change (moved earlier) never is; otherwise the buffer
// is emptied and the film seeks in place, which also brings Chrome's store back to its size. A join whose new sound
// came too late to follow on (a slow phone) makes the next one longer, up to SWITCH.most seconds. Each join moved the
// sound against the picture by -27 to +17 ms (the tracks' own timing differs; a seek sets it right), so after
// SWITCH.row joins in a row the next change seeks in place again: twelve joins in a row moved it 47 ms once.

import {loadDecoders} from './audio-decoders.js';
import {bufferedEnd} from './mse.js';
import {hasCentre} from '../enhance/sound-chain.js';
import {soundMime, soundShift} from './sound-six.js';

export const SWITCH = {join: 1, most: 2.5, row: 2, keep: true}; // keep: off, every change empties the buffer (tests compare the two)

export const switchMethods = {
  /** Switches to another audio track: only the audio buffer is refilled. */
  async setAudio(choice) {
    if (this.destroyed || !this.queues.audio) return;
    const ticket = this.tickets.audio = (this.tickets.audio || 0) + 1; // a track chosen later wins, even while this one's decoder downloads
    if (choice.delivery === 'rebuilt') {
      this.emit('status', 'Loading the audio decoder…');
      // Refused: the track playing now plays on, and the player says so (player-start.js converterLate).
      try { await loadDecoders(choice.track.codec); } catch (error) {
        if (ticket !== this.tickets.audio || this.destroyed) return;
        if (error?.kind !== 'network') throw error;
        return this.emit('converter', {codec: choice.track.codec, failed: true, kept: true});
      }
    }
    return this.serial('audio', () => this.refillAudio(choice, {join: true}), ticket);
  },

  /**
   * Fills the audio buffer again with `choice` (another track, or the same one changed). `join`: the old sound is kept a
   * second past the playhead and the new one written from there, when enough is buffered; else the buffer is emptied
   * and filled again from just before the playhead.
   */
  async refillAudio(choice = this.audio, {join = false} = {}) {
    const was = this.audioMime, mime = soundMime(this, choice, was); // rebuilt: whole (FLAC, sound-six.js) or stereo Opus, as it began
    const queue = this.queues.audio, v = this.video;
    const lead = () => bufferedEnd(queue.buffer, v.currentTime) - v.currentTime, ahead = this.joinLead || SWITCH.join;
    const keep = join && SWITCH.keep && !v.seeking && !this.ranShort && (this.joined || 0) < SWITCH.row && lead() >= ahead + 0.5 && (mime === was || !!queue.buffer.changeType);
    this.audioMime = mime;
    this.audio = choice;
    this.ended.audio = false;
    const generation = await queue.reset({clear: !keep, mime: !keep && mime !== was ? mime : null});
    if (this.destroyed) return;
    queue.buffer.timestampOffset = -soundShift(this);
    let from = Math.max(0, v.currentTime + this.advance - 0.3);
    if (keep) {
      const at = v.currentTime + ahead;
      await queue.run(() => queue.buffer.remove(at, Infinity)).catch(() => {});
      if (this.destroyed || queue.generation !== generation) return;
      if (mime !== was) queue.buffer.changeType(mime); // what is buffered of the old kind stays and plays to the join
      from = at + this.advance;
      this.stats.joins = (this.stats.joins || 0) + 1; this.joined = (this.joined || 0) + 1;
      // The new sound not there when the old ran out: the next join is longer.
      const late = () => { if (queue.generation === generation && v.currentTime >= at - 0.5) this.joinLead = Math.min(SWITCH.most, ahead + 0.75); };
      v.addEventListener('waiting', late, {once: true});
      setTimeout(() => v.removeEventListener('waiting', late), (ahead + 5) * 1000);
    }
    this.flushAudio = keep ? null : generation; // see room()
    this.pumpAudio(generation, from + this.offset).catch(e => this.fail(e));
  },

  /** Sound `seconds` (0-1) earlier than the picture: the audio buffer's timestamps move back that much, refilled. */
  setAdvance(seconds) {
    const d = Math.min(1, Math.max(0, Number(seconds) || 0));
    if (d === this.advance) return;
    this.advance = d;
    if (this.queues.audio) return this.serial('refill', () => this.refillAudio()); // after any track change asked before it
  },

  /** The gain on the centre channel as rebuilt sound is mixed to stereo (dialogue lift); sound not yet mixed is mixed again. */
  setCentre(gain) {
    const g = gain > 0 ? gain : 1;
    if (g === this.centre) return;
    this.centre = g;
    if (this.queues.audio && this.audio?.delivery === 'rebuilt' && hasCentre(this.audio.track.channels)) return this.serial('refill', () => this.refillAudio(this.audio, {join: true}));
  },
};
