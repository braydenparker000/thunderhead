// @ts-check
// The live channel (API.md §12, EXTENDING.md rule 7): one socket for every feature. The phone
// trades its token for a 30-second single-use ticket and connects; `hello` and `changed` carry
// the newest seq, and the caller pulls what changed from GET /v1/changes. Frame types this build
// doesn't know are ignored. A dropped socket reconnects after 1, 2, 5, 10, then every 30 s (with
// jitter); the back-off starts over only once a socket has stayed up for 30 s, so one that is
// accepted and dropped at once doesn't reconnect every second. 4401 means signed out and 4426
// means this build is too old, and neither retries. One socket at a time, counting one still
// being connected. Pings pause while the page is hidden. Pure apart from the socket and the clock
// it is given, so node tests drive it with fakes.

/** @typedef {import('../../../shared/contract/api.ts').LiveFrame} LiveFrame */
/** @typedef {{ send(data: string): void, close(code?: number): void, onmessage: ((e: { data: unknown }) => void) | null,
 *   onclose: ((e: { code: number }) => void) | null, onerror: ((e: unknown) => void) | null }} Socket */
/** @typedef {'connecting' | 'open' | 'waiting' | 'signed_out' | 'outdated' | 'stopped'} LiveState */

import { CLOSE_CODES, FRAME_TYPES } from '../contract.js';

export const BACKOFF_S = Object.freeze([1, 2, 5, 10, 30]);
/** The client pings this often while open; the Worker answers without waking Core. */
export const PING_MS = 30_000;
/** How long a socket must stay up before the back-off starts over. */
export const HEALTHY_MS = 30_000;

/**
 * @param {{
 *   connect: () => Promise<Socket>,
 *   onFrame: (f: LiveFrame) => void,
 *   onState?: (s: LiveState) => void,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 *   cancel?: (t: unknown) => void,
 *   random?: () => number,
 *   hidden?: () => boolean,
 * }} o
 */
export function createLive({
  connect,
  onFrame,
  onState = () => {},
  schedule = setTimeout,
  cancel = (t) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (t)),
  random = Math.random,
  hidden = () => false,
}) {
  /** @type {Socket | null} */
  let ws = null;
  /** @type {unknown} */
  let timer = null;
  /** @type {unknown} */
  let ping = null;
  /** @type {unknown} */
  let healthy = null;
  let attempt = 0;
  let connecting = false;
  let state = /** @type {LiveState} */ ('stopped');
  let running = false;
  const set = (/** @type {LiveState} */ s) => {
    state = s;
    onState(s);
  };

  function retry() {
    if (!running) return;
    set('waiting');
    const s = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)];
    attempt++;
    timer = schedule(open, s * 1000 * (0.75 + random() * 0.5));
  }

  function keepAlive() {
    cancel(ping);
    ping = schedule(() => {
      ping = null;
      if (!ws || state !== 'open' || hidden()) return; // wake() starts them again
      try {
        ws.send('ping');
      } catch {}
      keepAlive();
    }, PING_MS);
  }

  async function open() {
    if (!running || ws || connecting) return;
    connecting = true;
    set('connecting');
    /** @type {Socket} */
    let sock;
    try {
      sock = await connect();
    } catch (e) {
      // A refused ticket means this device is signed out; anything else is the network.
      if (/** @type {{ status?: number }} */ (e)?.status === 401) return stop('signed_out');
      return retry();
    } finally {
      connecting = false;
    }
    if (!running || ws) return sock.close(1000);
    ws = sock;
    sock.onmessage = (e) => {
      if (e.data === 'pong') return;
      /** @type {any} */
      let f = null;
      try {
        f = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!f || typeof f.t !== 'string' || !FRAME_TYPES.includes(f.t)) return; // a newer frame: ignore it
      if (f.t === 'hello') {
        set('open');
        keepAlive();
        cancel(healthy);
        healthy = schedule(() => {
          if (ws === sock) attempt = 0;
        }, HEALTHY_MS);
      }
      onFrame(f);
    };
    sock.onerror = () => {};
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      cancel(ping);
      cancel(healthy);
      if (e.code === CLOSE_CODES.revoked) return stop('signed_out');
      if (e.code === CLOSE_CODES.outdated) return stop('outdated');
      retry();
    };
  }

  /** @param {LiveState} final */
  function stop(final = 'stopped') {
    running = false;
    cancel(timer);
    cancel(ping);
    cancel(healthy);
    const s = ws;
    ws = null;
    try {
      s?.close(1000);
    } catch {}
    set(final);
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      open();
    },
    stop,
    /** Reconnect now (the page came back, or the network did), skipping the back-off; with a
     * socket open, start the pings again. */
    wake() {
      if (!running || connecting) return;
      if (ws) {
        if (state === 'open' && ping === null) keepAlive();
        return;
      }
      cancel(timer);
      attempt = 0;
      open();
    },
    get state() {
      return state;
    },
  };
}
