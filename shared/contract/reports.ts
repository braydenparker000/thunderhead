// Reports the phone sends about how the apps run (NEXT-BATCH.md part 1): Music's playback log
// first, in small batches. The Worker keeps each batch as one row for 30 days and gives it back to
// the owner's devices and the mind, never to CI (a batch is listening history by track id, and CI's
// logs are public). Timings, counts and track ids only, never titles or words. What a batch may
// hold is a list of known fields (`PLAYBACK_BATCH`, `PLAYBACK_EVENTS`, `PLAYBACK_STATE`): the phone
// keeps only those, and the Worker keeps only those again (`cleanReport`); any other field is
// dropped, and every text has its addresses cut to their host, quoted text cut and at most
// `text_max` characters (reports-clean.ts). frontend/ui/scrub.js and
// frontend/th/music/report-fields.js are the phone's copies; tests/music-report.test.mjs checks
// they agree.
import type { Id, JsonObject, Ms } from './api.ts';

/** What a batch is about. `playback`: Music's playback log since the batch before. */
export const REPORT_KINDS = ['playback'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LIMITS = {
  /** A batch's `body` as JSON, in bytes. */
  body_bytes: 32 * 1024,
  /** A text in a batch (a browser's or engine's own message), in characters. */
  text_max: 160,
  /** How long a batch is kept, in days. */
  keep_days: 30,
  /** Batches one device may send in any 5 minutes (the phone sends one a minute while music
   * plays, and one when the page is hidden). */
  per_5_min: 6,
  /** Batches in one page of `GET /v1/ops/reports`. */
  page_max: 200,
  /** One page's batches in bytes, at most: a page ends before the batch that would pass it. */
  page_bytes: 512 * 1024,
} as const;

/**
 * How a field is kept (reports-clean.ts `keepField`). `n` a number (to 0.1), `b` true or false, `id`
 * a track id, `hex` a page id, `fmt` a codec's short name, `t` a browser's or engine's own words
 * (`cleanText`), `one:a|b` one of those words, an object of fields, or `[field]` a list of them. A
 * value of another kind is dropped.
 */
export type ReportField =
  | 'n'
  | 'b'
  | 'id'
  | 'hex'
  | 'fmt'
  | 't'
  | `one:${string}`
  | readonly [ReportField]
  | { readonly [key: string]: ReportField };

const SOURCE = 'one:offline copy|stream|device|demo';
const KIND = 'one:aborted|network|decode|not supported|unknown';
const CONTEXT = 'one:running|suspended|closed|interrupted';
const DECK = { deck: 'n' } as const;
const TRACK = { id: 'id', format: 'fmt', kbps: 'n', rate: 'n', channels: 'n', source: SOURCE } as const;
const MEDIA_ERROR = { code: 'n', kind: KIND, message: 't' } as const;

/** Each event type of the playback log (music/src/player/playback-log.js, stream-guard.js, the
 * engine, th/music/report.js) and its fields; every event also has `n` (its number in the page
 * load), `t` (ms since the log began) and `type`. Another type goes as `other`, with no fields. */
export const PLAYBACK_EVENTS = {
  track: TRACK,
  'first sound': { track: 'id', ms: 'n' },
  preload: { track: 'id', from: SOURCE },
  play: {},
  pause: {},
  hidden: {},
  visible: {},
  loadstart: { deck: 'n', from: SOURCE },
  playing: DECK,
  waiting: { deck: 'n', at: 'n' },
  stalled: DECK,
  emptied: DECK,
  ended: DECK,
  abort: DECK,
  error: { deck: 'n', ...MEDIA_ERROR },
  stream_error: { code: 'n', message: 't', atMs: 'n' },
  stall: { atMs: 'n', readyState: 'n' },
  reload: { reason: 'one:error|stall|online', attempt: 'n', atMs: 'n' },
  recovered: { after: 'n' },
  gave_up: { after: 'n', atMs: 'n' },
  skip: { track: 'id' },
  offline_skip: { track: 'id' },
  copy_dropped: { track: 'id' },
  offline_wait: {},
  online: {},
  underrun: { count: 'n', ms: 'n' },
  clipped: { samples: 'n', until: 'n' },
  'long task': { ms: 'n' },
  spliced: { ms: 'n', padMs: 'n', overlap: 'n' },
  'splice failed': {},
  'context running': {},
  'context suspended': {},
  'context closed': {},
  'context interrupted': {},
  'context error': {},
} as const satisfies Record<string, Record<string, ReportField>>;

/** The playback log's counters (its snapshot: what Settings › Playback log shows). */
export const PLAYBACK_STATE = {
  version: 'n',
  sessionSeconds: 'n',
  cores: 'n',
  memoryGB: 'n',
  network: { type: 'one:slow-2g|2g|3g|4g', downlinkMbps: 'n', saveData: 'b' },
  output: {
    sampleRate: 'n',
    state: CONTEXT,
    baseLatencyMs: 'n',
    outputLatencyMs: 'n',
    latencyHint: 'one:interactive|balanced|playback',
    renderQuantum: 'n',
    engine: 'one:worklet|native',
    bypass: 'b',
    engineFailure: 't',
  },
  underruns: {
    supported: 'b',
    events: 'n',
    seconds: 'n',
    playedSeconds: 'n',
    latencyMs: { average: 'n', min: 'n', max: 'n' },
    at: ['n'],
  },
  level: {
    meteredSeconds: 'n',
    peakDb: 'n',
    recentPeakDb: 'n',
    inputPeakDb: 'n',
    limiterMaxDb: 'n',
    limiterNowDb: 'n',
    clippedSamples: 'n',
    oversCaught: 'n',
    since: 'n',
    clippedReads: 'n',
    reads: 'n',
  },
  dsp: {
    enabled: 'b',
    eq: 'b',
    parametric: 'b',
    bands: 'n',
    preampDb: 'n',
    tone: 'b',
    reverb: 'b',
    limiter: 'b',
    volume: 'n',
  },
  track: TRACK,
  decks: [
    {
      index: 'n',
      current: 'b',
      readyState: 'n',
      networkState: 'n',
      paused: 'b',
      bufferedAhead: 'n',
      waits: 'n',
      waitSeconds: 'n',
      stalls: 'n',
      errors: 'n',
      lastError: MEDIA_ERROR,
      startMs: ['n'],
      seekMs: ['n'],
    },
  ],
  preloaded: { track: 'id', deck: 'n' },
  offline: {
    available: 'b',
    tracks: 'n',
    bytes: 'n',
    budget: 'n',
    wanted: 'n',
    ready: 'n',
    downloading: 'b',
    held: 'b',
    online: 'b',
    tooBig: 'n',
    failing: 'n',
    lastError: 't',
    downloads: 'n',
    downloadedBytes: 'n',
    failures: 'n',
    plays: 'n',
  },
  recovery: {
    errors: 'n',
    stalls: 'n',
    reloads: 'n',
    recovered: 'n',
    skipped: 'n',
    offlineSkips: 'n',
    gaveUp: 'n',
    attempts: 'n',
    waitingOnline: 'b',
  },
  longTasks: { count: 'n', totalMs: 'n', maxMs: 'n' },
  hidden: { count: 'n', seconds: 'n' },
  contextStates: [{ t: 'n', state: CONTEXT }],
} as const satisfies Record<string, ReportField>;

/** A playback batch's own fields (th/music/report-batch.js `batchOf`); then its events and counters. */
export const PLAYBACK_BATCH = {
  v: 'n',
  page: 'hex',
  seq: 'n',
  why: 'one:minute|hidden',
  build: 'n',
  t0: 'n',
  lost: 'b',
  dropped: 'n',
} as const satisfies Record<string, ReportField>;

export interface ReportRequest {
  kind: ReportKind;
  body: JsonObject;
}

export interface ReportCreated {
  id: Id;
  at: Ms;
}

export interface Report {
  id: Id;
  kind: ReportKind;
  /** The device session that sent it. */
  device_id: string;
  /** When the Worker took it. */
  at: Ms;
  body: JsonObject;
}
