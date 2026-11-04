// The night's report (BRIEFING.md "The report card"): night step 12 puts it with `th report`
// (PUT /v1/briefing/report/:day). The Briefing shows it as its first tile after the weather, folded
// to the headline, and the Worker posts it as the first message of the open day's chat. One per
// closed day, kept 30 days in Core. Its words are the mind's; its counts are the Worker's own
// record of the run, never the mind's words. `nightReportProblem` is the check the Worker makes
// and `th report` makes before sending, so both say the same thing.
import { lintMindText } from './lint.ts';

export const NIGHT_REPORT_KINDS = [
  'memory',
  'loose_ends',
  'built',
  'reading',
  'music',
  'health',
  'predictions',
  'note',
] as const;
export type NightReportKind = (typeof NIGHT_REPORT_KINDS)[number];

export const NIGHT_REPORT_LIMITS = { headline: 60, lines: 6, line: 100, total: 800, keep_days: 30 } as const;

/** A line's ref: an app to open (`app:<id>`) or what the night did (`ledger:<id>`, its Undo). */
export const NIGHT_REPORT_REF = /^(app:[a-z]{2,16}|ledger:[0-9a-f-]{36})$/;

export interface NightReportLine {
  kind: NightReportKind;
  text: string;
  ref: string | null;
}

/** Counted by the Worker from its own rows of the run: this session's ledger rows (facts, loose
 * ends), its predictions and the run's record (`steps_cut`), again when the run is done. Songs,
 * mixes and pages live in other objects and are not counted yet (null). */
export interface NightReportCounts {
  facts_added: number;
  facts_confirmed: number;
  loose_ends_closed: number;
  loose_ends_added: number;
  pages_read: number | null;
  songs_noted: number | null;
  mixes: number | null;
  predictions: number;
  /** What a hard stop cut, in run order. */
  steps_cut: number[];
}

export interface NightReport {
  /** The closed day the night worked on. */
  day: string;
  written_at: number;
  headline: string;
  lines: NightReportLine[];
  counts: NightReportCounts;
  /** The ledger row of this version of the report (undo: the one before, or none). */
  ledger_id: string;
  /** The first message of the open day's chat, when it was posted. */
  message_id: string | null;
}

/** PUT /v1/briefing/report/:day. */
export interface PutNightReportRequest {
  headline: string;
  lines: { kind: NightReportKind; text: string; ref?: string | null }[];
}

const oneLine = (s: string) => !/[\r\n]/.test(s);
const plain = (s: string) => !/[!*_`#>[\]]|^\s*[-+]\s|^\s*\d+\.\s/.test(s);

/** What is wrong with a report, as `{path, issue}`, or null: the limits, one plain line each (no
 * exclamation marks, Markdown or emoji) and the shared phrase lint. */
export function nightReportProblem(r: PutNightReportRequest): { path: string; issue: string } | null {
  const L = NIGHT_REPORT_LIMITS;
  const text = (path: string, s: unknown, max: number) => {
    if (typeof s !== 'string' || !s.trim()) return { path, issue: 'required' };
    if (s.length > max) return { path, issue: `at most ${max} characters` };
    if (!oneLine(s)) return { path, issue: 'one line' };
    if (!plain(s)) return { path, issue: 'plain words: no exclamation marks or Markdown' };
    const lint = lintMindText(s);
    return lint ? { path, issue: lint } : null;
  };
  const head = text('headline', r.headline, L.headline);
  if (head) return head;
  if (!Array.isArray(r.lines) || r.lines.length > L.lines) return { path: 'lines', issue: `at most ${L.lines}` };
  let total = r.headline.length;
  for (const [i, l] of r.lines.entries()) {
    if (!(NIGHT_REPORT_KINDS as readonly string[]).includes(l?.kind))
      return { path: `lines.${i}.kind`, issue: `one of ${NIGHT_REPORT_KINDS.join(', ')}` };
    const bad = text(`lines.${i}.text`, l.text, L.line);
    if (bad) return bad;
    if (l.ref != null && !NIGHT_REPORT_REF.test(l.ref))
      return { path: `lines.${i}.ref`, issue: 'app:<id> or ledger:<id>' };
    total += l.text.length;
  }
  return total > L.total ? { path: 'lines', issue: `at most ${L.total} characters in all` } : null;
}

/** The counts in one line, as the tile's detail: "3 facts · 2 loose ends · 40 songs noted". */
export function nightReportCountsLine(c: NightReportCounts): string {
  const n = (k: number | null, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : null);
  const parts = [
    n(c.facts_added + c.facts_confirmed, 'fact', 'facts'),
    n(c.loose_ends_added + c.loose_ends_closed, 'loose end', 'loose ends'),
    n(c.pages_read, 'page read', 'pages read'),
    n(c.songs_noted, 'song noted', 'songs noted'),
    n(c.mixes, 'mix', 'mixes'),
    n(c.predictions, 'prediction', 'predictions'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing to count';
}
