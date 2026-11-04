// `th report --headline "<…>" --line <kind>[@<ref>]:"<…>" … [--day <YYYY-MM-DD>]` (night step 12,
// BRIEFING.md "The report card"): the night's report, PUT /v1/briefing/report/:day for the run's
// day. The Briefing shows it first, folded to the headline, and the Worker posts it as the open
// day's first message when the owner hasn't written yet. A line's ref is `ledger:<id>` (a row this
// run wrote, from `th ledger --since <the run's start>`: the owner's Undo on the tile) or
// `app:<id>` (the app it opens). The Worker adds its own counts; your words never carry them.
// Checked here as the Worker checks it (limits, plain words, the phrase lint) before sending.
//
//   → {"day","ledger_id","message_id","lines","counts"}
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';
import {parseArgs} from './args.mjs';
import {getState} from './state.mjs';
import {lintText} from './lint.mjs';

const R = CONTRACT.night.report;
const LINE = /^([a-z_]+)(?:@([a-z]+:[0-9a-z-]+))?:([\s\S]*)$/;
const USAGE = 'usage: th report --headline "<…>" [--line <kind>[@ledger:<id>|@app:<id>]:"<…>" …] [--day <YYYY-MM-DD>]';

/** One plain line within `max`, through the phrase lint: the problem, or null. */
function problem(what, s, max) {
  if (!s.trim()) return `${what} is empty`;
  if (s.length > max) return `${what} is over ${max} characters`;
  if (/[\r\n]/.test(s)) return `${what} is one line`;
  if (/[!*_`#>[\]]|^\s*[-+]\s|^\s*\d+\.\s/.test(s)) return `${what}: plain words, no exclamation marks or Markdown`;
  const lint = lintText(s);
  return lint ? `${what}: ${lint}` : null;
}

/** The request body from the flags (exported for the tests). */
export function reportBody(flags) {
  const headline = typeof flags.headline === 'string' ? flags.headline.trim() : '';
  const bad = problem('the headline', headline, R.limits.headline);
  if (bad) throw invalid(`${bad}. ${USAGE}`);
  const raw = flags.line ?? [];
  if (raw.length > R.limits.lines) throw invalid(`at most ${R.limits.lines} lines`);
  const ref = new RegExp(R.ref);
  const lines = raw.map((l, i) => {
    const m = typeof l === 'string' ? LINE.exec(l) : null;
    if (!m) throw invalid(`line ${i + 1}: <kind>[@<ref>]:<text>. ${USAGE}`);
    const [, kind, at, text] = m;
    if (!R.kinds.includes(kind)) throw invalid(`line ${i + 1}: the kind is one of ${R.kinds.join(', ')}`);
    if (at && !ref.test(at)) throw invalid(`line ${i + 1}: a ref is ledger:<id> or app:<id>`);
    const why = problem(`line ${i + 1}`, text.trim(), R.limits.line);
    if (why) throw invalid(why);
    return {kind, text: text.trim(), ref: at ?? null};
  });
  const total = headline.length + lines.reduce((n, l) => n + l.text.length, 0);
  if (total > R.limits.total) throw invalid(`at most ${R.limits.total} characters in all`);
  return {headline, lines};
}

export async function report(argv) {
  const {flags} = parseArgs(argv, {repeat: ['line']});
  const day = typeof flags.day === 'string' ? flags.day : getState('night_day') ?? getState('day');
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid('--day is required (no night run day recorded)');
  const {data} = await request('PUT', `/v1/briefing/report/${day}`, {body: reportBody(flags)});
  out({day: data.day, ledger_id: data.ledger_id, message_id: data.message_id ?? null, lines: data.lines?.length ?? 0, counts: data.counts});
}
