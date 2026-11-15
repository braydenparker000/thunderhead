// What a film costs, and going easy on mobile data, for AstraPlayer (player.js).
// Mixed into AstraPlayer's prototype, so `this` is the player.
//
// dataUsed(): the bytes the current film has downloaded so far: the range
// reader's own count of body bytes received (including what was thrown away
// when a connection broke), or for HLS and DASH what their players report of
// the pieces they loaded; null where nothing counts (the browser's own playing).
//
// setDataSaver('auto' | true | false): with the saver on, the reader pauses
// 8 MiB past what playback reads instead of 24, and the pipelines keep 20 s
// ahead instead of 40. 'auto' (the default) is on when the phone asks to save
// data or is on a mobile network, and follows the network as it changes. It
// takes effect at once, on the film that is playing too.

import {BLOCK, READ_AHEAD} from './source-stream.js';

export const SAVER = {readAhead: 8 * BLOCK, ahead: 20};

/** Whether the saver is on for a setting; 'auto' asks the connection (navigator.connection, where the browser has it). */
export function saverOn(setting = 'auto', connection = globalThis.navigator?.connection) {
  if (setting === true || setting === false) return setting;
  return !!(connection?.saveData || connection?.type === 'cellular');
}

/** The read-ahead for the saver on or off: the reader's pause in bytes, and the pipelines' reach in seconds (null: remux.js's TUNING.ahead). */
export function saverTuning(on) {
  return on ? {...SAVER} : {readAhead: READ_AHEAD, ahead: null};
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

  /** Puts the saver's limits on the reader and the pipeline of the film loaded now (each load and session calls it too). */
  applyDataSaver() {
    this.dataSaver = saverOn(this.saverSetting ?? 'auto');
    const tuning = saverTuning(this.dataSaver);
    (this.probed?.source || this.source)?.setReadAhead?.(tuning.readAhead);
    if (this.session && this.mode === 'remux') { this.session.ahead = tuning.ahead; this.session.onProgress?.(); }
  },

  /** A piece of an adaptive stream arrived (hls.js, dash.js). */
  countAdaptive(bytes) {
    if (bytes > 0) this.adaptiveBytes = (this.adaptiveBytes || 0) + bytes;
  },

  stopDataSaver() {
    if (this.onConnection) globalThis.navigator?.connection?.removeEventListener?.('change', this.onConnection);
    this.onConnection = null;
  },
};
