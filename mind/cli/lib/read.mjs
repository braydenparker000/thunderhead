// th read: the reader subagent's answers (RUNTIME.md §6.6; BEHAVIOR.md §11 rule 6). `th read --kinds`
// lists the kinds the reader (.claude/agents/reader.md) answers in, from the contract. `th read
// --check <kind>` takes its answer (stdin, `--json` or `--file`), marks this session tainted (the
// answer is outside text still, whether or not it passes), checks it against the kind's schema and
// the rules a schema can't say, and prints the checked object: the only thing the session works
// from. Exit 8 names the first problem; the session then works from nothing it read.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';
import {check} from './schema.mjs';
import {getState, setState} from './state.mjs';

const READER = CONTRACT.reader;

/** The answer as the session passed it on: one JSON object, perhaps inside a code fence. */
export function parseAnswer(text) {
  const t = String(text).trim().replace(/^```(?:json)?[ \t]*\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const v = JSON.parse(t);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* below */ }
  throw invalid('the reader’s answer is not one JSON object');
}

const sentences = s => (String(s).match(/[.!?]+(?=["'”’)\]]*(\s|$))/g) ?? []).length || 1;

/** Every URL or path an answer names. */
const sourcesOf = a => [a.source, ...(a.links ?? []), ...(a.sources ?? []), ...(a.items ?? []).map(i => i?.source)]
  .filter(s => typeof s === 'string');

/** The first problem with an answer of this kind, or null. */
export function problem(kind, a) {
  const spec = READER.kinds[kind];
  if (!spec) return `no reader kind "${kind}" (th read --kinds)`;
  const p = check(a, spec.schema);
  if (p) return p;
  const leak = sourcesOf(a).find(s => /[?#]/.test(s));
  if (leak) return `a source or link carries a query or fragment (${leak.slice(0, 80)})`;
  if (typeof a.quote === 'string' && sentences(a.quote) > READER.limits.quote_sentences)
    return `quote: at most ${READER.limits.quote_sentences} sentence`;
  if ('instructions_seen' in a && a.instructions_seen !== (a.instructions_note !== null))
    return a.instructions_seen ? 'instructions_note: say in a few words what they asked for' : 'instructions_note: null when none were seen';
  return null;
}

export async function read(argv) {
  const {flags} = parseArgs(argv, {bool: ['kinds']});
  if (flags.kinds) {
    return out({kinds: Object.fromEntries(Object.entries(READER.kinds).map(([n, k]) => [n, k.doc])), limits: READER.limits,
      agent: '.claude/agents/reader.md'});
  }
  const kind = typeof flags.check === 'string' ? flags.check : null;
  if (!kind) throw invalid('usage: th read --kinds | th read --check <kind> [--json <answer> | --file <path>] (else stdin)');
  const text = typeof flags.json === 'string' ? flags.json : readFileSync(typeof flags.file === 'string' ? flags.file : 0, 'utf8');
  // Tainted first: the session has the answer in its context, checked or not (MEMORY.md §7).
  if (!getState('tainted')) {
    await request('POST', '/v1/mind/taint', {body: {source: 'reader', ref_kind: /"https?:\/\//.test(text) ? 'url' : 'file'}});
    setState('tainted', true);
  }
  const answer = parseAnswer(text);
  const why = problem(kind, answer);
  if (why) throw invalid(`reader answer refused: ${why}`);
  out({ok: true, kind, tainted: true, answer});
}
