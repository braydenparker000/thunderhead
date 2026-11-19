// What a film costs, and going easy on mobile data, for AstraPlayer (player.js).
// Mixed into AstraPlayer's prototype, so `this` is the player.
//
// dataUsed(): the bytes the current film has downloaded so far: the range
// reader's own count of body bytes received (including what was thrown away
// when a connection broke), or for HLS and DASH what their players report of
// the pieces they loaded; null where nothing counts (the browser's own playing).
//
// setDataSaver('auto' | true | false): with the saver on, the reader reads
// about 5 s of the film past what playback reads instead of 10 (never more
// than 8 MiB instead of 24), the pipelines keep 20 s ahead instead of 40, and
// the cache keeps 30 s behind besides (http-source.js, source-tuning.js). 'auto' (the default) is on when the phone asks to save
// data or is on a mobile network, and follows the network as it changes. It
// takes effect at once, on the film that is playing too.
//
// The memory budget (budget.js) goes with it: by the phone's memory, three quarters of it with the saver on, put on
// the reader each time the saver is (hold.js shares it out); and the engine's log gets its `memory` entries
// (player-memory.js).

import {BLOCK, READ_AHEAD} from './source-stream.js';
import {memoryBudget} from './budget.js';
import {memoryMethods} from './player-memory.js';

export const SAVER = {readAhead: 8 * BLOCK, ahead: 20, seconds: 5, keep: 55};
const FULL = {readAhead: READ_AHEAD, ahead: null, seconds: 10, keep: 80}; // keep: a 30 s back-seek, the pipelines' reach (remux.js TUNING.ahead) and the reader's

/** Whether the saver is on for a setting; 'auto' asks the connection (navigator.connection, where the browser has it). */
export function saverOn(setting = 'auto', connection = globalThis.navigator?.connection) {
  if (setting === true || setting === false) return setting;
  return !!(connection?.saveData || connection?.type === 'cellular');
}

/**
 * The read-ahead for the saver on or off: the reader's most in bytes and its reach in seconds of the film, the
 * pipelines' reach in seconds (null: remux.js's TUNING.ahead), and the seconds of the film the cache keeps.
 */
export function saverTuning(on) {
  return on ? {...SAVER} : {...FULL};
}

export const dataMethods = {
  dataUsed() {
    if (this.hls || this.dash) return this.adaptiveBytes ?? null;
    const source = this.probed?.source || this.source;
    if (!source || this.mode === 'native' || this.mode === 'unsupported') return null;
    return (this.bytesBefore || 0) + source.bytesFetched;
  },

  setDataSaver(setting = 'auto') {
    this.saverSetting = setting;
    const connection = globalThis.navigator?.connection;
    if (connection?.addEventListener && !this.onConnection) {
      this.onConnection = () => { if ((this.saverSetting ?? 'auto') === 'auto') this.applyDataSaver(); };
      connection.addEventListener('change', this.onConnection);
    }
    this.applyDataSaver();
  },

  /** Puts the saver's limits and the memory budget on the reader and the pipeline of the film loaded now (each load and session calls it too). */
  applyDataSaver() {
    this.dataSaver = saverOn(this.saverSetting ?? 'auto');
    const tuning = saverTuning(this.dataSaver);
    const source = this.probed?.source || this.source;
    this.budget = memoryBudget({saver: this.dataSaver});
    this.watchMemory?.(); // (a stand-in player in the tests has none)
    source?.setBudget?.(this.budget);
    if (this.info?.duration) source?.learn?.(this.info.duration); // a reader opened again (fallBack) learns the bitrate here
    source?.setReadAhead?.(tuning.readAhead, tuning);
    if (this.session && this.mode === 'remux') { this.session.ahead = tuning.ahead; this.session.onProgress?.(); }
  },

  /** A piece of an adaptive stream arrived (hls.js, dash.js). */
  countAdaptive(bytes) {
    if (bytes > 0) this.adaptiveBytes = (this.adaptiveBytes || 0) + bytes;
  },

  stopDataSaver() {
    if (this.onConnection) globalThis.navigator?.connection?.removeEventListener?.('change', this.onConnection);
    this.onConnection = null;
    this.stopMemory?.();
  },

  ...memoryMethods,
};
