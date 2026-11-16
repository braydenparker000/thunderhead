// What AstraPlayer (player.js) learns from a route that failed, so it is not
// taken twice. Mixed into AstraPlayer's prototype, so `this` is the player.
// The memory itself is route-memory.js (per device, localStorage).
//
// Sound passed through as it is (Dolby Digital, Dolby Digital Plus, DTS where
// the browser says it decodes them, plan.js): a browser can say yes and then
// fail. A decode error, a failed start, or a sound buffer that stays empty
// while the picture's fills, switches that sound to 'rebuilt' (decoded and
// converted here, as on every other phone) at the same place, once per film,
// and remembers it for this device so later films start rebuilt. If the
// rebuilt sound fails the same way straight after, the sound was not the
// cause: the memory is taken back and the usual recovery runs.
//
// A picture that fails to decode in remux and plays in the software decoder
// (fallBack) is remembered by its codec string: the next film with it plans
// straight to software. "Try again" on such a film, when the software decoder
// failed too, forgets it.

import {PASSABLE} from './plan.js';
import * as memory from './route-memory.js';

const EMPTY_CHECKS = 5; // seconds the sound buffer may stay empty while the picture's holds 2 s

const buffered = buffer => { try { const r = buffer.buffered; return r.length ? r.end(r.length - 1) - r.start(0) : 0; } catch { return 0; } };

export const routeMethods = {
  /** The device's memory as planner answers (caps.passFailed, caps.failedRoute). */
  routeCaps() { return {passFailed: codec => memory.passFailed(codec), failedRoute: codec => memory.failedRoute(codec)}; },

  /** The sound chosen now, when it is passed through and could be rebuilt instead. */
  passedSound() {
    const option = this.audio.find(a => a.id === this.selectedAudio)?.option;
    const codec = option?.track.codec;
    return this.mode === 'remux' && option?.delivery === 'direct' && PASSABLE.has(codec) && this.caps?.opusEncode ? option : null;
  },

  /** Every option of this codec becomes 'rebuilt', in the plan and the menu. */
  rebuildCodec(codec) {
    const swap = o => (o.track.codec === codec && o.delivery === 'direct' ? {...o, delivery: 'rebuilt'} : o);
    const options = this.plan.audioOptions.map(swap), chosen = this.plan.audio && swap(this.plan.audio);
    const audio = chosen && options.find(o => o.track === chosen.track);
    this.plan = {...this.plan, audioOptions: options, audio: audio ? {...audio} : chosen};
    for (const a of this.audio) if (a.option?.track.codec === codec) { a.option = options.find(o => o.track === a.option.track); a.delivery = a.option.delivery; }
  },

  /**
   * A decode failure while sound is passed through: switches it to rebuilt (true, handled) or leaves the failure
   * to the usual recovery (false). Also true while a switch is under way, so the old pipeline's last cries are ignored.
   */
  passThroughFailed(reason) {
    if (this.passSwitching === this.load_) return true;
    if (this.passSwitched && this.passFor === this.load_) {
      // The rebuilt sound fails as quickly: the picture was the trouble, not the sound.
      if (!(this.video.currentTime > this.passAt + 3)) memory.rememberPass(this.passSwitched, false);
      return false;
    }
    const option = this.passedSound();
    if (!option) return false;
    this.switchSound(option.track.codec, reason);
    return true;
  },

  /** Rebuilds the sound at the same place: a fresh remux pipeline, the menu updated; nothing said beyond the status line. */
  async switchSound(codec, reason) {
    const id = this.load_, at = this.started ? this.video.currentTime : this.video.currentTime || this.startTime || 0;
    const playing = this.playing, subtitle = this.selectedSubtitle;
    Object.assign(this, {passSwitching: id, passSwitched: codec, passFor: id, passAt: at});
    memory.rememberPass(codec);
    this.record('passthrough', {codec, at: +at.toFixed(2), reason});
    this.status('Preparing playback…');
    this.stopPassWatch();
    this.session?.destroy(); this.session = null;
    this.rebuildCodec(codec);
    try {
      await this.startRemux(at, id);
      if (id !== this.load_) return;
      this.passSwitching = null;
      if (this.selectedSubtitle !== subtitle) this.selectSubtitle(subtitle);
      if (playing || !this.started) this.video.play().catch(() => {});
      this.emit('tracks');
    } catch (error) {
      if (id !== this.load_) return;
      this.passSwitching = null;
      this.fail(reason, String(error?.message || error), {decode: !error?.kind});
    }
  },

  /** A remux start that threw with passed-through sound: tries once more with it rebuilt (true when that started). */
  async passRetry(error, startTime, id) {
    const option = !error?.kind && this.passedSound();
    if (!option) return false;
    const codec = option.track.codec;
    Object.assign(this, {passSwitched: codec, passFor: id, passAt: startTime});
    memory.rememberPass(codec);
    this.record('passthrough', {codec, at: startTime, reason: String(error?.message || error)});
    this.session?.destroy(); this.session = null;
    this.rebuildCodec(codec);
    try { await this.startRemux(startTime, id); return true; } catch {
      if (id === this.load_) memory.rememberPass(codec, false); // it failed rebuilt too: not the sound's fault
      return false;
    }
  },

  /**
   * Watches a remux session with passed-through sound: a sound buffer still empty after EMPTY_CHECKS seconds
   * while the picture's holds 2 s means the browser took the sound and did nothing with it. Ends on the first sound.
   */
  watchPassedSound(session) {
    this.stopPassWatch();
    if (!this.passedSound()) return;
    let empty = 0;
    this.passTimer = setInterval(() => {
      const audio = session.queues?.audio?.buffer, video = session.queues?.video?.buffer;
      if (this.session !== session || session.destroyed) return this.stopPassWatch();
      if (!audio) return;
      if (buffered(audio) > 0) return this.stopPassWatch();
      if (!video || buffered(video) < 2) { empty = 0; return; }
      if (++empty >= EMPTY_CHECKS) { this.stopPassWatch(); this.passThroughFailed('The sound did not start.'); }
    }, 1000);
  },

  stopPassWatch() { clearInterval(this.passTimer); this.passTimer = 0; },

  /** fallBack: a re-wrapped film's picture did not decode; remembered for software once software plays it. */
  routeFellBack(mode) {
    const codec = this.info?.video?.[0]?.codecString;
    if (mode !== 'remux' || !codec) return;
    memory.rememberFallback(codec);
    this.routePending = {codec, load: this.load_};
  },

  /** The software decoder shows a frame: a codec that fell back is confirmed, so later films start there. */
  routeSoftwareStarted() {
    const pending = this.routePending;
    if (pending?.load === this.load_) memory.confirmRoute(pending.codec);
    this.routePending = null;
  },

  /** Confirms a pending fallback once the software decoder's film has run 2 s past where it started. */
  watchSoftwareRoute(session, startTime) {
    if (this.routePending?.load !== this.load_) return;
    const signal = this.abort?.signal, video = this.video;
    const seen = () => {
      if (this.session !== session) return video.removeEventListener('timeupdate', seen);
      if (video.currentTime > startTime + 2) { video.removeEventListener('timeupdate', seen); this.routeSoftwareStarted(); }
    };
    video.addEventListener('timeupdate', seen, signal ? {signal} : undefined);
  },

  /** The software decoder failed: a codec that only just fell back was not the browser's fault. Remembers the film for "Try again". */
  routeSoftwareFailed() {
    const pending = this.routePending, codec = this.info?.video?.[0]?.codecString;
    if (pending?.load === this.load_) memory.forgetRoute(pending.codec);
    this.routePending = null;
    this.routeErrored = this.plan?.mode === 'software' && codec && memory.failedRoute(codec) ? {url: this.url, codec} : null;
  },

  /** A load of the same film right after its remembered route failed ("Try again"): the memory gives way. */
  routeRetry(url) {
    if (this.routeErrored?.url === url) memory.forgetRoute(this.routeErrored.codec);
    this.routeErrored = null;
  },
};
