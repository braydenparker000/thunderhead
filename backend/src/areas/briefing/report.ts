// The night's report (BRIEFING.md "The report card"; contract in night-report.ts): night step 12
// puts it with `th report` (PUT /v1/briefing/report/:day) from a claimed, live, untainted night
// session, for a closed day with a night run. The same body again answers the stored report and
// writes nothing; a new body from the same session replaces it, and another session's is 409.
// Every version is a ledger row whose undo takes it back (the one before, or none). Each line's
// `ledger:` ref must be a row the night wrote: the tile's Undo is that row's. When it is first put
// for the night before the open day and the open day's thread has no owner message yet, the Worker
// (not the mind: the night may not post) adds it as that thread's first message, author mind,
// origin night: no push, no wake. A message in the chat is never rewritten, so a replacement or an
// undo changes the tile only. The counts are the Worker's (counts.ts), again when the run is done.

import {
  type NightReport,
  nightReportCountsLine,
  nightReportProblem,
  type PutNightReportRequest,
} from '../../../../shared/contract/night-report.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { ownerCount } from '../conversation/day';
import { today as todayThread } from '../conversation/ops';
import * as convo from '../conversation/store';
import { rowStates } from '../ledger/night-rows';
import { claimedSession } from '../mind/guards';
import { nightDayOf, nightRun } from '../mind/night';
import { countsOf } from './report-counts';
import { putRow, type ReportRow, removeRow, reportRow, setCounts, toReport } from './report-store';

export const REPORT_UNDO_OPS = ['report.delete', 'report.restore'];
const REF = 'app:briefing#report';

export function putReport(
  w: Writer,
  c: Caller,
  day: string,
  r: PutNightReportRequest,
  reqHash: string,
  ctx: { today: string; tz: string },
): NightReport {
  const { db } = w;
  if (day >= ctx.today) throw invalid('day', 'a day that has closed');
  const g = claimedSession(db, c.session_id, 'night');
  const stored = reportRow(db, day);
  if (stored && stored.req_sha256 === reqHash) return toReport(stored);
  if (g.tainted) throw new Fail('session_tainted');
  if (!nightRun(db, day)) throw invalid('day', 'the day of a night run');
  const problem = nightReportProblem(r);
  if (problem) throw new Fail('validation', [problem]);
  const lines = r.lines.map((l) => ({ kind: l.kind, text: l.text.trim(), ref: l.ref ?? null }));
  const ids = lines.flatMap((l) => (l.ref?.startsWith('ledger:') ? [l.ref.slice('ledger:'.length)] : []));
  const own = new Set(
    rowStates(db, ids)
      .filter((s) => s.actor === 'mind:night')
      .map((s) => s.id),
  );
  for (const [i, l] of lines.entries())
    if (l.ref?.startsWith('ledger:') && !own.has(l.ref.slice('ledger:'.length)))
      throw invalid(`lines.${i}.ref`, 'not a ledger row the night wrote');
  if (stored && stored.session_id !== c.session_id)
    throw new Fail('conflict', { reason: 'another night session wrote this report' });
  const ledgerId = w.ledger({
    kind: 'arrangement',
    actor: c.actor,
    session_id: c.session_id,
    what: `briefing/report ← ${day}`,
    why: stored ? "the night's report again, replacing the one before" : "the night's report of its work",
    topic_key: 'night.report',
    undo: stored ? { op: 'report.restore', args: { day, row: stored } } : { op: 'report.delete', args: { day } },
  });
  const row: ReportRow = {
    day,
    written_at: w.at,
    session_id: c.session_id ?? '',
    headline: r.headline.trim(),
    lines_json: JSON.stringify(lines),
    counts_json: JSON.stringify(countsOf(db, day)),
    req_sha256: reqHash,
    ledger_id: ledgerId,
    message_id: stored?.message_id ?? null,
  };
  if (!row.message_id && day === nightDayOf(ctx.today)) row.message_id = firstMessage(w, c, row, ctx);
  putRow(db, row);
  w.change('surface', REF);
  return toReport(row);
}

/** The open day's first message, unless the owner has already written that day. */
function firstMessage(w: Writer, c: Caller, row: ReportRow, ctx: { today: string; tz: string }): string | null {
  const open = convo.dailyThread(w.db, ctx.today);
  if (open && ownerCount(w.db, open.id) > 0) return null;
  const thread = open ?? todayThread(w, ctx.tz);
  const r = toReport(row);
  const counts = nightReportCountsLine(r.counts);
  const body = [r.headline, r.lines.map((l) => `- ${l.text}`).join('\n'), counts === 'Nothing to count' ? '' : counts]
    .filter(Boolean)
    .join('\n\n');
  const id = uuidv7(w.at);
  convo.insertMessage(w.db, {
    id,
    thread_id: thread.id,
    author: 'mind',
    origin: 'night',
    kind: 'text',
    body,
    meta: { report: row.day },
    reply_to: null,
    created_at: w.at,
    device_id: null,
    session_id: c.session_id,
    req_sha256: '',
  });
  w.change('message', `msg:${id}`);
  return id;
}

/** The run is done: what the later steps did (and what the hard stop cut) joins the counts. */
export function recount(w: Writer, day: string): void {
  const row = reportRow(w.db, day);
  const counts = row ? JSON.stringify(countsOf(w.db, day)) : null;
  if (!row || !counts || counts === row.counts_json) return;
  setCounts(w.db, day, counts);
  w.change('surface', REF);
}

/** Core-internal undo (ledger/ops.ts dispatches by `op`): only the report's newest version is undone. */
export function undoReport(w: Writer, ledgerId: string, op: string, args: { day?: string; row?: ReportRow }): void {
  const now = args.day ? reportRow(w.db, args.day) : null;
  if (!args.day || (op === 'report.restore' && !args.row)) throw new Fail('validation', { reason: 'not_undoable' });
  if (now?.ledger_id !== ledgerId) throw new Fail('conflict', { reason: 'a newer report replaced it' });
  if (op === 'report.delete') removeRow(w.db, args.day);
  else if (args.row) putRow(w.db, { ...args.row, message_id: now.message_id });
  w.change('surface', REF);
}
