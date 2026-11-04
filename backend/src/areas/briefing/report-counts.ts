// The night's report's counts (BRIEFING.md "The report card"): the Worker's own record of the run,
// never the mind's words. From Core's rows since the run began: the night's ledger rows (facts
// remembered and confirmed, loose ends opened, closed and dropped), its predictions and the run's
// record (the steps a hard stop cut). Songs, mixes and pages are kept in the Music and Library
// objects and are not counted here (null).
import type { NightReportCounts } from '../../../../shared/contract/night-report.ts';
import type { Db } from '../../objects/base';
import { nightWhats } from '../ledger/night-rows';
import { cutSteps, nightRun } from '../mind/night';
import { madeSince } from '../predictions/ops';

export function countsOf(db: Db, day: string): NightReportCounts {
  const run = nightRun(db, day);
  const since = run?.started_at ?? Number.MAX_SAFE_INTEGER;
  const whats = run ? nightWhats(db, since) : new Map<string, number>();
  const n = (...starts: string[]) =>
    [...whats].reduce((sum, [what, k]) => (starts.some((s) => what.startsWith(s)) ? sum + k : sum), 0);
  return {
    facts_added: n('remembered a '),
    facts_confirmed: n('confirmed a '),
    loose_ends_closed: n('closed a loose end', 'dropped a loose end'),
    loose_ends_added: n('opened a loose end'),
    pages_read: null,
    songs_noted: null,
    mixes: null,
    predictions: run ? madeSince(db, 'mind:night', since) : 0,
    steps_cut: run?.done_at != null ? cutSteps(run) : [],
  };
}
