// SQL for the night's report inside Core (BRIEFING.md "The report card", DATA.md §4.1): one row
// per closed day in `night_reports`, read by its day, put whole, and pruned after 30 days.
import { NIGHT_REPORT_LIMITS, type NightReport } from '../../../../shared/contract/night-report.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface ReportRow {
  day: string;
  written_at: number;
  session_id: string;
  headline: string;
  lines_json: string;
  counts_json: string;
  req_sha256: string;
  ledger_id: string;
  message_id: string | null;
}

const COLS = 'day, written_at, session_id, headline, lines_json, counts_json, req_sha256, ledger_id, message_id';

export const reportRow = (db: Db, day: string): ReportRow | null =>
  db.one<ReportRow>(`SELECT ${COLS} FROM night_reports WHERE day = ?`, day);

export function putRow(db: Db, r: ReportRow): void {
  db.run(
    `INSERT INTO night_reports (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET written_at = excluded.written_at, session_id = excluded.session_id,
       headline = excluded.headline, lines_json = excluded.lines_json, counts_json = excluded.counts_json,
       req_sha256 = excluded.req_sha256, ledger_id = excluded.ledger_id, message_id = excluded.message_id`,
    r.day,
    r.written_at,
    r.session_id,
    r.headline,
    r.lines_json,
    r.counts_json,
    r.req_sha256,
    r.ledger_id,
    r.message_id,
  );
}

export function setCounts(db: Db, day: string, counts: string): void {
  db.run('UPDATE night_reports SET counts_json = ? WHERE day = ?', counts, day);
}

export function removeRow(db: Db, day: string): void {
  db.run('DELETE FROM night_reports WHERE day = ?', day);
}

export function toReport(r: ReportRow): NightReport {
  return {
    day: r.day,
    written_at: r.written_at,
    headline: r.headline,
    lines: JSON.parse(r.lines_json),
    counts: JSON.parse(r.counts_json),
    ledger_id: r.ledger_id,
    message_id: r.message_id,
  };
}

/** The daily prune: reports of days more than 30 days old. */
export function pruneReports(db: Db, now: number, max: number): number {
  const before = new Date(now - NIGHT_REPORT_LIMITS.keep_days * DAY).toISOString().slice(0, 10);
  const gone = db.all<{ day: string }>('SELECT day FROM night_reports WHERE day < ? LIMIT ?', before, max);
  for (const g of gone) removeRow(db, g.day);
  return gone.length;
}
