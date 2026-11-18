// The connection to the film's host lost and found again, for Astra's range reader (http-source.js): the
// state the player shows ('reconnecting', 'connected', 'lost'), the failures counted while a download is
// tried again (source-stream.js streamFailed), the pause between tries, and a network change. Mixed into
// HttpSource's prototype, so `this` is the source.

import {TIMING} from './source-stream.js';

export const stateMethods = {
  /** Calls fn('reconnecting' | 'connected' | 'lost') when the connection to the host is lost and found again. */
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); },
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    for (const fn of this.stateListeners) fn(state);
  },

  /** Data arrived, or nothing waits for any: the failures counted so far are over. */
  calm() {
    this.failures = 0; this.failingSince = 0; this.progressAt = Date.now();
    if (this.state === 'reconnecting' || this.state === 'lost') this.setState('connected');
  },

  /** The pause before a retry; it ends at once when the phone is back online or the file is closed. */
  backOff(ms) {
    return new Promise(resolve => {
      const go = () => { clearTimeout(timer); this.retries.delete(go); resolve(); };
      const timer = setTimeout(go, ms);
      this.retries.add(go);
    });
  },

  // A new network (Wi-Fi to mobile data) leaves the old connections dead without a word: a download that has
  // brought nothing for a few seconds is asked again at once, without counting a failure. Its replacement waits
  // for the old one's connection slot to be given back (source-gate.js).
  restartQuiet() {
    const now = Date.now();
    for (const s of [...this.streams]) if (!s.paused && now - s.lastAt >= TIMING.quiet) { s.restart = true; s.abort(); }
  },
};
