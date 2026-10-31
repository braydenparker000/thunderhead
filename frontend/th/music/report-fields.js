// @ts-check
// What a playback batch may hold (API.md §11.16 reports; MUSIC.md §5.10): each event type's known
// fields and the playback log's known counters, and nothing else. The phone's copy of
// PLAYBACK_EVENTS, PLAYBACK_STATE, PLAYBACK_BATCH (shared/contract/reports.ts) and their cleaning
// (reports-clean.ts), which the Worker runs again on every batch; tests/music-report.test.mjs checks
// the two are the same. A field is `n` a number (to 0.1), `b` true or false, `id` a track id, `hex` a page id, `fmt` a
// codec's short name, `t` the browser's or the engine's own words (ui/scrub.js), `one:a|b` one of
// those words, an object of fields, or `[field]` a list. Any other field, or a value of another kind,
// is left out: a title, an artist, a file name or a search can't ride along under a new name.
import { cleanText } from '../../ui/scrub.js';

/** REPORT_LIMITS.text_max. */
export const TEXT_MAX = 160;
const LIST_MAX = 400;
const ID = /^[A-Za-z0-9_.:#-]{1,140}$/;
const HEX = /^[0-9a-f]{1,32}$/;
const FMT = /^[A-Za-z0-9.+-]{1,12}$/;

const SOURCE = 'one:offline copy|stream|device|demo';
const KIND = 'one:aborted|network|decode|not supported|unknown';
const CONTEXT = 'one:running|suspended|closed|interrupted';
const DECK = { deck: 'n' };
const TRACK = { id: 'id', format: 'fmt', kbps: 'n', rate: 'n', channels: 'n', source: SOURCE };
const MEDIA_ERROR = { code: 'n', kind: KIND, message: 't' };

/** Each event type and its fields; every event also has `n`, `t` and `type`. */
export const PLAYBACK_EVENTS = {
  track: TRACK, 'first sound': { track: 'id', ms: 'n' }, preload: { track: 'id', from: SOURCE },
  play: {}, pause: {}, hidden: {}, visible: {},
  loadstart: { deck: 'n', from: SOURCE }, playing: DECK, waiting: { deck: 'n', at: 'n' }, stalled: DECK, emptied: DECK, ended: DECK, abort: DECK,
  error: { deck: 'n', ...MEDIA_ERROR }, stream_error: { code: 'n', message: 't', atMs: 'n' }, stall: { atMs: 'n', readyState: 'n' },
  reload: { reason: 'one:error|stall|online', attempt: 'n', atMs: 'n' }, recovered: { after: 'n' }, gave_up: { after: 'n', atMs: 'n' },
  skip: { track: 'id' }, offline_skip: { track: 'id' }, copy_dropped: { track: 'id' }, offline_wait: {}, online: {},
  underrun: { count: 'n', ms: 'n' }, clipped: { samples: 'n', until: 'n' }, 'long task': { ms: 'n' },
  spliced: { ms: 'n', padMs: 'n', overlap: 'n' }, 'splice failed': {},
  'context running': {}, 'context suspended': {}, 'context closed': {}, 'context interrupted': {}, 'context error': {},
};

/** The playback log's counters (its snapshot). */
export const PLAYBACK_STATE = {
  version: 'n', sessionSeconds: 'n', cores: 'n', memoryGB: 'n',
  network: { type: 'one:slow-2g|2g|3g|4g', downlinkMbps: 'n', saveData: 'b' },
  output: { sampleRate: 'n', state: CONTEXT, baseLatencyMs: 'n', outputLatencyMs: 'n', latencyHint: 'one:interactive|balanced|playback', renderQuantum: 'n', engine: 'one:worklet|native', bypass: 'b', engineFailure: 't' },
  underruns: { supported: 'b', events: 'n', seconds: 'n', playedSeconds: 'n', latencyMs: { average: 'n', min: 'n', max: 'n' }, at: ['n'] },
  level: { meteredSeconds: 'n', peakDb: 'n', recentPeakDb: 'n', inputPeakDb: 'n', limiterMaxDb: 'n', limiterNowDb: 'n', clippedSamples: 'n', oversCaught: 'n', since: 'n', clippedReads: 'n', reads: 'n' },
  dsp: { enabled: 'b', eq: 'b', parametric: 'b', bands: 'n', preampDb: 'n', tone: 'b', reverb: 'b', limiter: 'b', volume: 'n' },
  track: TRACK,
  decks: [{ index: 'n', current: 'b', readyState: 'n', networkState: 'n', paused: 'b', bufferedAhead: 'n', waits: 'n', waitSeconds: 'n', stalls: 'n', errors: 'n', lastError: MEDIA_ERROR, startMs: ['n'], seekMs: ['n'] }],
  preloaded: { track: 'id', deck: 'n' },
  offline: { available: 'b', tracks: 'n', bytes: 'n', budget: 'n', wanted: 'n', ready: 'n', downloading: 'b', held: 'b', online: 'b', tooBig: 'n', failing: 'n', lastError: 't', downloads: 'n', downloadedBytes: 'n', failures: 'n', plays: 'n' },
  recovery: { errors: 'n', stalls: 'n', reloads: 'n', recovered: 'n', skipped: 'n', offlineSkips: 'n', gaveUp: 'n', attempts: 'n', waitingOnline: 'b' },
  longTasks: { count: 'n', totalMs: 'n', maxMs: 'n' },
  hidden: { count: 'n', seconds: 'n' },
  contextStates: [{ t: 'n', state: CONTEXT }],
};

/** A batch's own fields; then its events and counters. */
export const PLAYBACK_BATCH = { v: 'n', page: 'hex', seq: 'n', why: 'one:minute|hidden', build: 'n', t0: 'n', lost: 'b', dropped: 'n' };

/** A value kept as `field` says, or undefined to leave it out. @param {any} field @param {unknown} v @returns {unknown} */
export function keepField(field, v) {
  if (typeof field === 'string') {
    if (field === 'n') return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;
    if (field === 'b') return typeof v === 'boolean' ? v : undefined;
    if (typeof v !== 'string') return undefined;
    if (field === 'id') return ID.test(v) ? v : undefined;
    if (field === 'hex') return HEX.test(v) ? v : undefined;
    if (field === 'fmt') return FMT.test(v) ? v : undefined;
    if (field === 't') return cleanText(v, TEXT_MAX);
    return field.slice(4).split('|').includes(v) ? v : undefined;
  }
  if (Array.isArray(field)) {
    if (!Array.isArray(v)) return undefined;
    return v.slice(-LIST_MAX).map((x) => keepField(field[0], x)).filter((x) => x !== undefined);
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, f] of Object.entries(field)) {
    const x = keepField(f, /** @type {Record<string, unknown>} */ (v)[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

/** One event as sent: its number, time and type, and its type's own fields (another type: `other`). @param {unknown} e */
export function keepEvent(e) {
  const o = /** @type {Record<string, unknown>} */ (e !== null && typeof e === 'object' ? e : {});
  const type = typeof o.type === 'string' && Object.hasOwn(PLAYBACK_EVENTS, o.type) ? o.type : null;
  return {
    .../** @type {object} */ (keepField({ n: 'n', t: 'n' }, o)),
    type: type ?? 'other',
    ...(type ? /** @type {object} */ (keepField(/** @type {any} */ (PLAYBACK_EVENTS)[type], o)) : {}),
  };
}

/** A batch as sent: only its known fields. @param {Record<string, unknown>} b */
export function cleanBatch(b) {
  const out = /** @type {Record<string, unknown>} */ (keepField(PLAYBACK_BATCH, b));
  if (Array.isArray(b.events)) out.events = b.events.slice(-LIST_MAX).map(keepEvent);
  const state = keepField(PLAYBACK_STATE, b.state);
  if (state !== undefined) out.state = state;
  return out;
}
