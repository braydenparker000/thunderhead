// @ts-check
// Music's playback log to the Worker (NEXT-BATCH.md part 1; API.md §11.16 reports; MUSIC.md §5.10),
// so a stall or a slow start on the owner's phone can be looked at later (`th reports`). The player's
// own log (music/src/player/playback-log.js) keeps the events; this sends what the Worker hasn't
// taken yet, once a minute while music plays and once when the page is hidden, one batch at a time,
// each at most 30 KB with known fields only (report-batch.js, report-fields.js: timings, counts and
// track ids, never titles, artists, file names or more of an address than its host). Only signed in
// on this site, and only from a top-level page or home's own frame (a copy another site frames never gets the session,
// th/ported/session.js). A batch with no answer in 15 s, or a 408, 429 or 5xx, goes again later; after
// a 401 or 403 nothing goes until the session changes. It also adds to the log the time to first
// sound of each play: from the play asked for (a new song while playing, or Play) to its deck's first
// `playing`, as a `first sound` event with the track id and the milliseconds.
// Loaded by th/music/dj.js `installDj`, which the player already runs at start.
import { CONFIG } from '/config.js';
import { framedByOther, sessionToken } from '/th/ported/session.js';
import { batches } from './report-batch.js';

const EVERY_MS = 60_000;
/** The session is read again after this long (a sign-out stops the batches, a new sign-in starts them). */
const TOKEN_MS = 60_000;
/** A batch with no answer by then counts as not taken (it goes again). */
const TIMEOUT_MS = 15_000;
const STATE_PLAYING = 1;

/**
 * Times each play's first sound into the player's log once the log exists, and, signed in on a
 * top-level page, starts the batches.
 * @param {any} ctx the player's context @param {{ everyMs?: number }} [o]
 */
export function installReport(ctx, o = {}) {
  if (ctx.reporting) return;
  ctx.reporting = true;
  let tries = 0;
  const start = () => {
    const log = ctx.playbackLog;
    if (!log) {
      if (++tries < 20) setTimeout(start, 500);
      return;
    }
    firstSound(ctx, log);
    if (!framedByOther() && CONFIG.api) run(ctx, log, o.everyMs ?? EVERY_MS);
  };
  start();
}

/** @param {any} ctx @param {any} log @param {number} everyMs */
function run(ctx, log, everyMs) {
  /** @type {string | null} */
  let token = null;
  let tokenAt = 0;
  const readToken = () => {
    tokenAt = Date.now();
    sessionToken().then((t) => { token = t; }, () => {});
  };
  readToken();
  const b = batches({
    log,
    everyMs,
    page: Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join(''),
    build: CONFIG.build || 0,
    playing: () => ctx.player?.state === STATE_PLAYING,
    token: () => {
      if (Date.now() - tokenAt > TOKEN_MS) readToken();
      return token;
    },
    post: async (body, key) => {
      const r = await fetch(`${CONFIG.api}/v1/ops/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ kind: 'playback', body }),
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { ok: r.ok, status: r.status, retryAfter: Number(r.headers.get('Retry-After')) || 0 };
    },
  });
  ctx.bus.subscribe('bus_player', (/** @type {string} */ msg) => { if (msg === 'msg_player_playing_state_changed') b.follow(); });
  b.follow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') b.hidden(); });
  addEventListener('pagehide', () => b.hidden());
}

/**
 * The time to first sound of each play, as a `first sound` event in the log.
 * @param {any} ctx @param {any} log
 */
function firstSound(ctx, log) {
  const p = ctx.player;
  /** @type {{ track: string, at: number } | null} */
  let asked = null;
  const ask = () => {
    const el = p?.audio;
    // Already sounding (the engine joined it to the song before, or it never stopped): no wait to time.
    asked = p?.track?.id && !(el && !el.paused && el.readyState >= 3 && el._heard) ? { track: p.track.id, at: performance.now() } : null;
  };
  ctx.bus.subscribe('bus_player', (/** @type {string} */ msg, /** @type {unknown} */ _src, /** @type {any} */ d) => {
    if (msg === 'msg_player_track_changed' && !d?.meta) {
      if (p?.state === STATE_PLAYING) ask();
      else asked = null;
    } else if (msg === 'msg_player_playing_state_changed') {
      if (!d?.playing) asked = null;
      else if (asked?.track !== p?.track?.id) ask();
    }
  });
  for (const el of p?.decks ?? [])
    el.addEventListener('playing', () => {
      if (!asked || el !== p.audio || p.track?.id !== asked.track) return;
      log.log('first sound', { track: asked.track, ms: Math.round(performance.now() - asked.at) });
      asked = null;
    });
}
