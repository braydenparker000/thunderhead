// `th report --headline "<…>" --note - <<'EOF' … EOF [--line <kind>[@<ref>]:"<…>" …] [--day <d>]`
// (night step 12, BRIEFING.md "The report card"): the night's morning note, PUT
// /v1/briefing/report/:day for the run's day. The note is plain text in your own voice, 1 to 1,200
// characters (what you did overnight, what you noticed, something the owner would enjoy, what is
// waiting), on stdin (`--note -` or a lone `-`) or as `--note "<text>"`; paragraphs are kept. The
// Briefing shows it on its first tile under the headline, and the Worker posts it as the open day's
// first message when the owner hasn't written yet. Lines are optional: an unknown kind becomes
// `note`, a line over the limit is cut at a word with an ellipsis, and a ref (`ledger:<id>`, a row
// this run wrote: the owner's Undo on the tile; or `app:<id>`) is optional. The Worker adds its own
// counts; your words never carry them.
//
//   → {"day","ledger_id","message_id","note","lines","counts"}
import {readFileSync} from 'node:fs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';
import {parseArgs} from './args.mjs';
import {getState} from './state.mjs';

const R = CONTRACT.night.report;
const NOTE_MAX = R.limits.note ?? 1200;
const LINE = /^([a-z_]+)(?:@([a-z]+:[0-9a-z-]+))?:([\s\S]*)$/;
const USAGE = 'usage: th report --headline "<≤ 60>" --note - <<\'EOF\' <your morning note> EOF [--line <kind>[@ledger:<id>|@app:<id>]:"<…>" …] [--day <YYYY-MM-DD>]';

/** One plain line within `max`: the problem, or null. No refusal for style (owner, 2026-11-22). */
function problem(what, s, max) {
  if (!s.trim()) return `${what} is empty`;
  if (s.length > max) return `${what} is over ${max} characters`;
  if (/[\r\n]/.test(s)) return `${what} is one line`;
  if (/[*_`#>[\]]|^\s*[-+]\s|^\s*\d+\.\s/.test(s)) return `${what}: no Markdown`;
  return null;
}

/** A line cut at a word to fit `max`, ending with an ellipsis. */
export function cut(s, max) {
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1);
  const at = room.lastIndexOf(' ');
  return `${(at > max / 2 ? room.slice(0, at) : room).replace(/[\s,;:.-]+$/, '')}…`;
}

/** The note: blank lines between paragraphs kept, runs of spaces inside a line folded. */
function noteOf(raw) {
  const text = String(raw).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw invalid(`the note is empty. ${USAGE}`);
  if (text.length > NOTE_MAX) throw invalid(`the note has ${text.length} characters (max ${NOTE_MAX})`);
  return text;
}

/** The request body from the flags and the note (exported for the tests). */
export function reportBody(flags, note) {
  const headline = typeof flags.headline === 'string' ? flags.headline.trim() : '';
  const bad = problem('the headline', headline, R.limits.headline);
  if (bad) throw invalid(`${bad}. ${USAGE}`);
  const raw = flags.line ?? [];
  if (raw.length > R.limits.lines) throw invalid(`at most ${R.limits.lines} lines`);
  const ref = new RegExp(R.ref);
  const lines = raw.map((l, i) => {
    const m = typeof l === 'string' ? LINE.exec(l) : null;
    const [, kind, at, text] = m ?? [null, 'note', null, String(l)];
    if (at && !ref.test(at)) throw invalid(`line ${i + 1}: a ref is ledger:<id> or app:<id>, or none`);
    const fitted = cut(text.replace(/\s+/g, ' ').trim(), R.limits.line);
    const why = problem(`line ${i + 1}`, fitted, R.limits.line);
    if (why) throw invalid(why);
    return {kind: R.kinds.includes(kind) ? kind : 'note', text: fitted, ref: at ?? null};
  });
  const total = headline.length + lines.reduce((n, l) => n + l.text.length, 0);
  if (total > R.limits.total) throw invalid(`at most ${R.limits.total} characters in all, headline and lines`);
  return note === undefined ? {headline, lines} : {headline, note: noteOf(note), lines};
}

export async function report(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['line']});
  const day = typeof flags.day === 'string' ? flags.day : getState('night_day') ?? getState('day');
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid('--day is required (no night run day recorded)');
  const stdin = flags.note === '-' || rest.includes('-');
  if (flags.note === true) throw invalid(`--note needs the text, or - for stdin. ${USAGE}`);
  const note = stdin ? readFileSync(0, 'utf8') : flags.note;
  const {data} = await request('PUT', `/v1/briefing/report/${day}`, {body: reportBody(flags, note)});
  out({day: data.day, ledger_id: data.ledger_id, message_id: data.message_id ?? null, note: data.note != null,
    lines: data.lines?.length ?? 0, counts: data.counts});
}
