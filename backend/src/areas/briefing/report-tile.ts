// The Briefing's "Overnight" tile (BRIEFING.md "The report card"): the report of the night before
// the open day, from the quiet hours' end (06:30 or the owner's later end) to the end of the open
// day; folded to the headline and the counts, its lines each with the place an `app:` ref opens or
// the Undo of the row a `ledger:` ref names (open while that row can be undone, undone once it
// was). Reads the report's row, the quiet end and the rows its lines name.
import type { ReportTile } from '../../../../shared/contract/briefing.ts';
import { APPS, appBuilt } from '../../../../shared/contract/feed.ts';
import { nightReportCountsLine } from '../../../../shared/contract/night-report.ts';
import { dayBefore, zonedMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { rowStates } from '../ledger/night-rows';
import { quietWindow } from '../settings/quiet';
import { reportRow, toReport } from './report-store';

export function reportTile(db: Db, c: { now: number; tz: string; day: string }): ReportTile | null {
  const row = reportRow(db, dayBefore(c.day));
  if (!row || c.now < zonedMinute(c.day, quietWindow(db).end, c.tz)) return null;
  const r = toReport(row);
  const idOf = (ref: string | null) => (ref?.startsWith('ledger:') ? ref.slice('ledger:'.length) : null);
  const states = new Map(
    rowStates(
      db,
      r.lines.flatMap((l) => idOf(l.ref) ?? []),
    ).map((s) => [s.id, s]),
  );
  return {
    kind: 'report',
    label: 'Overnight',
    value: r.headline,
    detail: nightReportCountsLine(r.counts),
    day: r.day,
    lines: r.lines.map((l) => {
      const app = l.ref?.startsWith('app:') ? l.ref.slice('app:'.length) : null;
      const s = states.get(idOf(l.ref) ?? '');
      return {
        kind: l.kind,
        text: l.text,
        path: app && appBuilt(app) ? APPS[app].path : null,
        ledger_id: s ? s.id : null,
        undo: s?.status === 'undone' ? 'undone' : s?.status === 'done' && s.undoable ? 'open' : null,
      };
    }),
    cut: r.counts.steps_cut,
  };
}
