// The phone's reports (NEXT-BATCH.md part 1): a batch about how an app ran, kept as one row. The
// Worker keeps only the batch's known fields (`cleanReport` in shared/contract/reports-clean.ts,
// the same list the phone sends by): any other field is dropped, every text has its addresses cut
// to their host, quoted text cut and at most 160 characters, and the batch is at most 32 KB as
// JSON. A device sends at most 6 batches in any 5 minutes (counted by the Core layer in memory, so
// the count costs no row). A list is the rows as kept, their JSON passed on as it is, at most
// 512 KB a page.
import {
  REPORT_KINDS,
  REPORT_LIMITS,
  type ReportCreated,
  type ReportKind,
  type ReportRequest,
} from '../../../../shared/contract/reports.ts';
import { cleanReport } from '../../../../shared/contract/reports-clean.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { MINUTE, SECOND } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as store from './store';

const WINDOW_MS = 5 * MINUTE;
const utf8 = new TextEncoder();

/** Counts one more batch from this device and returns 0 when it fits in the window, or else the
 * seconds until it would (and counts nothing). */
export function admit(sent: Map<string, number[]>, device: string, now: number): number {
  const times = (sent.get(device) ?? []).filter((t) => t > now - WINDOW_MS);
  if (times.length >= REPORT_LIMITS.per_5_min) {
    sent.set(device, times);
    return Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / SECOND));
  }
  // A handful of devices at most; a map grown past that starts over rather than grow.
  if (sent.size > 64) sent.clear();
  sent.set(device, [...times, now]);
  return 0;
}

/** Keeps one batch, taken now, as one row. */
export function put(w: Writer, deviceId: string, r: ReportRequest): ReportCreated {
  const body_json = JSON.stringify(cleanReport(r.kind, r.body));
  if (utf8.encode(body_json).length > REPORT_LIMITS.body_bytes) throw new Fail('too_large');
  const id = uuidv7(w.at);
  store.insert(w.db, { kind: r.kind, at: w.at, id, device_id: deviceId, body_json });
  return { id, at: w.at };
}

/** Newest first: one kind, or every kind merged (each read on its own key, `limit` rows at most), and
 * ended before the row that would pass 512 KB (always at least one). `more`: the page was cut short. */
export function list(
  db: Db,
  kind: ReportKind | null,
  since: number,
  limit: number,
  after: [number, string] | null,
): { rows: store.ReportRow[]; more: boolean } {
  const kinds: readonly ReportKind[] = kind ? [kind] : REPORT_KINDS;
  const all = kinds.flatMap((k) => store.page(db, k, since, after ?? store.NEWEST, limit));
  all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const rows: store.ReportRow[] = [];
  let bytes = 0;
  for (const r of all.slice(0, limit)) {
    bytes += utf8.encode(r.body_json).length;
    if (rows.length && bytes > REPORT_LIMITS.page_bytes) return { rows, more: true };
    rows.push(r);
  }
  return { rows, more: rows.length === limit };
}
