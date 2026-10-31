// The phone's reports (NEXT-BATCH.md part 1): a batch about how an app ran, kept as one row. The
// phone sends timings, counts and track ids, never titles or words; the Worker checks it once more
// before keeping it: every address is cut to its host, a session or key token is removed, a text
// is at most 300 characters and the batch at most 32 KB as JSON. A device sends at most 6 batches
// in any 5 minutes (counted by the Core layer in memory, so the count costs no row).
import type { Json, JsonObject } from '../../../../shared/contract/api';
import {
  REPORT_KINDS,
  REPORT_LIMITS,
  type Report,
  type ReportCreated,
  type ReportKind,
  type ReportRequest,
} from '../../../../shared/contract/reports.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as store from './store';

/** How deep a batch's objects and lists may nest. */
const DEPTH = 8;
const TEXT_MAX = 300;
const KEY_MAX = 64;
const WINDOW_MS = 5 * MINUTE;
const ADDRESS = /\bhttps?:\/\/([^/\s?#]+)\S*/g;
const TOKEN = /\b(th1|thm|ths|thc|thw|thfp)_[A-Za-z0-9_-]{8,}/g;

/** A text as kept: each address only its host, no token, at most 300 characters. */
export const scrubText = (s: string): string => s.replace(ADDRESS, '$1/…').replace(TOKEN, '[token]').slice(0, TEXT_MAX);

function scrub(v: Json, depth: number): Json {
  if (typeof v === 'string') return scrubText(v);
  if (v === null || typeof v !== 'object') return v;
  if (depth >= DEPTH) throw invalid('body', `nested deeper than ${DEPTH}`);
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const out: JsonObject = {};
  for (const [k, x] of Object.entries(v)) out[scrubText(k).slice(0, KEY_MAX)] = scrub(x, depth + 1);
  return out;
}

/** Whether one more batch from this device fits in the window; if so, it is counted. */
export function admit(sent: Map<string, number[]>, device: string, now: number): boolean {
  const times = (sent.get(device) ?? []).filter((t) => t > now - WINDOW_MS);
  if (times.length >= REPORT_LIMITS.per_5_min) {
    sent.set(device, times);
    return false;
  }
  // A handful of devices at most; a map grown past that starts over rather than grow.
  if (sent.size > 64) sent.clear();
  sent.set(device, [...times, now]);
  return true;
}

/** Keeps one batch, taken now, as one row. */
export function put(w: Writer, deviceId: string, r: ReportRequest): ReportCreated {
  const body_json = JSON.stringify(scrub(r.body, 0));
  if (new TextEncoder().encode(body_json).length > REPORT_LIMITS.body_bytes) throw new Fail('too_large');
  const id = uuidv7(w.at);
  store.insert(w.db, { kind: r.kind, at: w.at, id, device_id: deviceId, body_json });
  return { id, at: w.at };
}

const shown = (r: store.ReportRow): Report => ({
  id: r.id,
  kind: r.kind,
  device_id: r.device_id,
  at: r.at,
  body: JSON.parse(r.body_json) as JsonObject,
});

/** Newest first: one kind, or every kind merged (each read on its own key, `limit` rows at most). */
export function list(
  db: Db,
  kind: ReportKind | null,
  since: number,
  limit: number,
  after: [number, string] | null,
): Report[] {
  const kinds: readonly ReportKind[] = kind ? [kind] : REPORT_KINDS;
  const rows = kinds.flatMap((k) => store.page(db, k, since, after ?? store.NEWEST, limit));
  rows.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return rows.slice(0, limit).map(shown);
}
