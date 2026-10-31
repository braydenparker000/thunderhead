// SQL for the phone's reports inside Core (DATA.md §4.1): one row per batch. Every query walks the
// table's own key (kind, at, id), so a page reads the rows it returns and the prune the rows it
// deletes; nothing reads the whole table. Stores never write the change feed, and a report writes
// none at all: nothing the phone or the mind shows changes when one arrives (perf is the same).
import { REPORT_KINDS, REPORT_LIMITS, type ReportKind } from '../../../../shared/contract/reports.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface ReportRow {
  kind: ReportKind;
  at: number;
  id: string;
  device_id: string;
  body_json: string;
}

/** Past every real time: the first page's cursor. */
export const NEWEST: [number, string] = [Number.MAX_SAFE_INTEGER, ''];

export function insert(db: Db, r: ReportRow): void {
  db.run(
    'INSERT INTO reports (kind, at, id, device_id, body_json) VALUES (?, ?, ?, ?, ?)',
    r.kind,
    r.at,
    r.id,
    r.device_id,
    r.body_json,
  );
}

/** One kind's reports taken at or after `since` and before the `[at, id]` cursor, newest first. */
export function page(db: Db, kind: ReportKind, since: number, before: [number, string], limit: number): ReportRow[] {
  return db.all<ReportRow>(
    `SELECT kind, at, id, device_id, body_json FROM reports
     WHERE kind = ? AND at >= ? AND (at, id) < (?, ?) ORDER BY at DESC, id DESC LIMIT ?`,
    kind,
    since,
    before[0],
    before[1],
    limit,
  );
}

/** Reports older than 30 days go, kind by kind, at most `max` a call (DATA.md §10). The cut is found
 * first (the `max`-th oldest past its time, if there are that many), then everything up to it goes
 * in one delete on the key: about two rows read per row deleted, and two when nothing is old
 * (a delete with RETURNING or an IN list reads three to five times as many). */
export function prune(db: Db, now: number, max: number): number {
  const old = now - REPORT_LIMITS.keep_days * DAY;
  let n = 0;
  for (const kind of REPORT_KINDS) {
    if (n >= max) break;
    const cut = db.one<{ at: number; id: string }>(
      'SELECT at, id FROM reports WHERE kind = ? AND at < ? ORDER BY at, id LIMIT 1 OFFSET ?',
      kind,
      old,
      max - n - 1,
    );
    n += cut
      ? db.run('DELETE FROM reports WHERE kind = ? AND (at, id) <= (?, ?)', kind, cut.at, cut.id)
      : db.run('DELETE FROM reports WHERE kind = ? AND at < ?', kind, old);
  }
  return n;
}
