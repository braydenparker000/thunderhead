// `th reports [--kind playback] [--since <ms|iso>] [--limit 50] [--cursor <c>]` (RUNTIME.md §5.3): the
// batches the owner's phone sent about how the apps ran (GET /v1/ops/reports, kept 30 days), read
// back as one compact summary: the totals over the batches read, then one line per batch, newest
// first. An event the phone sent twice (a batch the Worker kept whose answer was lost, sent again)
// has the same page and number (`n`), and counts once in the totals (`repeats` says how many were
// left out). `stalls` are the player's own (`stall`: no sound for a while), not the browser's
// `stalled`, which both show under `events`. `errors` are the newest 5. Music's playback batches
// carry timings, counts and track ids only (MUSIC.md §5.10); for a batch's every event, `th get
// /v1/ops/reports kind=playback limit=1`.
//
//   → {"kind","batches","from","to","devices","pages","events":{type: n},"repeats","first_sound_ms":{n,p50,p90,max},
//      "waits":{count,seconds},"stalls","errors":[…],"items":[{id,at,device,page,seq,why,events,types}],"next"}
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out, toMs} from './io.mjs';
import {parseArgs} from './args.mjs';

const KINDS = CONTRACT.reports?.kinds ?? ['playback'];
const PAGE_MAX = CONTRACT.reports?.limits?.page_max ?? 200;
/** Errors listed in the totals, newest first. */
const ERRORS_SHOWN = 5;
const ERROR_TYPES = new Set(['error', 'stream_error', 'context error', 'gave_up']);

const count = (into, key, n = 1) => { into[key] = (into[key] ?? 0) + n; };
/** The value at fraction `p` of the sorted list (nearest rank). */
const rank = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const events = r => (Array.isArray(r.body?.events) ? r.body.events : []);

/** The summary of a page of reports (newest first), as `th reports` prints it. */
export function summarize(items, kind = null, next = null) {
  const types = {};
  const firstSound = [];
  const errors = [];
  const seen = new Set();
  let waits = 0, waitSeconds = 0, stalls = 0, repeats = 0;
  // Newest first, each batch's events too, so the errors kept are the newest.
  for (const r of items) {
    for (const e of [...events(r)].reverse()) {
      if (typeof e?.type !== 'string') continue;
      const key = r.body?.page && Number.isInteger(e.n) ? `${r.body.page}:${e.n}` : null;
      if (key && seen.has(key)) { repeats++; continue; }
      if (key) seen.add(key);
      count(types, e.type);
      if (e.type === 'first sound' && Number.isFinite(e.ms)) firstSound.push(e.ms);
      if (e.type === 'stall') stalls++;
      if (ERROR_TYPES.has(e.type) && errors.length < ERRORS_SHOWN)
        errors.push({at: r.at, type: e.type, ...(e.kind ? {kind: e.kind} : {}), ...(e.code !== undefined ? {code: e.code} : {}), ...(e.track ? {track: e.track} : {})});
    }
  }
  // Waits are the decks' own counters, which run for the whole page load: each page's newest batch.
  const newestOfPage = new Map();
  for (const r of items) if (r.body?.page && !newestOfPage.has(r.body.page)) newestOfPage.set(r.body.page, r);
  for (const r of newestOfPage.values())
    for (const d of Array.isArray(r.body?.state?.decks) ? r.body.state.decks : []) {
      waits += Number(d.waits) || 0;
      waitSeconds += Number(d.waitSeconds) || 0;
    }
  firstSound.sort((a, b) => a - b);
  return {
    kind: kind ?? 'all',
    batches: items.length,
    from: items.at(-1)?.at ?? null,
    to: items[0]?.at ?? null,
    devices: new Set(items.map(r => r.device_id)).size,
    pages: new Set(items.map(r => r.body?.page).filter(Boolean)).size,
    events: types,
    repeats,
    first_sound_ms: firstSound.length
      ? {n: firstSound.length, p50: rank(firstSound, 0.5), p90: rank(firstSound, 0.9), max: firstSound.at(-1)}
      : null,
    waits: {count: waits, seconds: Math.round(waitSeconds * 10) / 10},
    stalls,
    errors,
    items: items.map(r => {
      const t = {};
      for (const e of events(r)) if (typeof e?.type === 'string') count(t, e.type);
      return {id: r.id, at: r.at, device: String(r.device_id ?? '').slice(0, 8), page: r.body?.page ?? null,
        seq: r.body?.seq ?? null, why: r.body?.why ?? null, events: events(r).length, types: t};
    }),
    next,
  };
}

/** @param {string[]} argv */
export async function reports(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th reports [--kind playback] [--since <ms|iso>] [--limit 50] [--cursor <c>]');
  const kind = flags.kind === undefined ? null : String(flags.kind);
  if (kind !== null && !KINDS.includes(kind)) throw invalid(`--kind must be one of ${KINDS.join(', ')}`);
  const limit = flags.limit === undefined ? 50 : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) throw invalid(`--limit must be 1-${PAGE_MAX}`);
  const since = toMs(flags.since, 'since');
  const query = {limit, ...(kind ? {kind} : {}), ...(since !== undefined ? {since} : {}), ...(flags.cursor ? {cursor: String(flags.cursor)} : {})};
  const {data} = await request('GET', '/v1/ops/reports', {query});
  out(summarize(data.items ?? [], kind, data.next ?? null));
}
