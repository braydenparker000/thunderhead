// Memory commands: recall, remember, confirm, supersede, forget, thread, day, daynote, facts
// (RUNTIME.md §5.3, MEMORY.md §3, API.md §11.13). Writes are small operations, never documents.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {invalid, jsonFlag, list, need, out, toMs} from './io.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';

export const FACT_KINDS = ['preference', 'routine', 'fact', 'goal', 'state', 'rule'];
const SOURCES = ['user', 'observed', 'inferred'];
const seg = value => encodeURIComponent(String(value));

/** Evidence ids: a bare id is a message (`msg:<id>`); anything with a kind prefix is kept. */
export function evidenceRefs(value, {required = true} = {}) {
  const refs = list(value).map(r => (/^[a-z][a-z0-9]{1,15}:/.test(r) ? r : `msg:${r}`));
  if (required && !refs.length) throw invalid('--evidence needs at least one id');
  if (refs.length > 20) throw invalid('--evidence takes at most 20 ids');
  return refs;
}

function factText(flags) {
  const text = need(flags, 'text');
  if (text.length > 280) throw invalid('--text is over 280 characters (one claim per fact)');
  return text;
}

async function ops(list) {
  const {data} = await request('POST', '/v1/memory/ops', {body: {batch_id: uuidv7(), ops: list}});
  return data;
}

/** {fact_id, ledger_id} when applied, {fact_id: null, proposal_id} when the Worker routed it to the owner. */
function factResult(data) {
  const applied = data.applied?.[0];
  if (applied) return {fact_id: applied.fact_id, ledger_id: applied.ledger_id};
  return {fact_id: null, proposal_id: data.proposals?.[0]?.proposal_id ?? null};
}

/** `th search` / `th recall`: federated search over the contract's sources (default: all built ones). */
export async function recall(argv) {
  const {flags, rest} = parseArgs(argv);
  const q = rest.join(' ').trim();
  if (!q) throw invalid('usage: th search <query> [--sources messages,facts,…] [--since <date>] [--until <date>] [--thread <id>] [--limit 20]');
  if (q.length > 200) throw invalid('the query is over 200 characters');
  const asked = typeof flags.sources === 'string' ? flags.sources : typeof flags.kind === 'string' && flags.kind !== 'all' ? flags.kind : '';
  const sources = list(asked);
  const known = Object.keys(CONTRACT.search_sources);
  const bad = sources.find(s => !known.includes(s));
  if (bad) throw invalid(`unknown search source ${bad}; sources: ${known.join(', ')}`);
  const {data} = await request('GET', '/v1/search', {query: {
    q, sources: sources.length ? sources.join(',') : undefined, since: toMs(flags.since, 'since'), until: toMs(flags.until, 'until'),
    thread: typeof flags.thread === 'string' ? flags.thread : undefined, limit: Number(flags.limit) || 20,
  }});
  out({items: (data.items || []).map(({source, ref, at, snippet, score}) => ({source, ref, at, snippet, score}))});
}

export async function remember(argv) {
  const {flags} = parseArgs(argv);
  const kind = need(flags, 'kind');
  if (!FACT_KINDS.includes(kind)) throw invalid(`--kind must be one of ${FACT_KINDS.join(', ')}`);
  const source = flags.source ?? 'user';
  if (!SOURCES.includes(source)) throw invalid('--source must be user, observed or inferred');
  const sensitivity = Number(flags.sensitivity ?? 0);
  if (sensitivity !== 0 && sensitivity !== 1) throw invalid('--sensitivity must be 0 or 1');
  const data = await ops([{op: 'add', id: uuidv7(), kind, subject: typeof flags.subject === 'string' ? flags.subject : 'owner',
    text: factText(flags), source, evidence: evidenceRefs(flags.evidence), valid_from: toMs(flags['valid-from'], 'valid-from'), sensitivity}]);
  out(factResult(data));
}

export async function confirm(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th confirm <fact id> --evidence <ids>');
  await ops([{op: 'confirm', id: rest[0], evidence: evidenceRefs(flags.evidence)}]);
  out({ok: true});
}

export async function supersede(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th supersede <fact id> --text <t> --evidence <ids> [--reason <r>]');
  // Fields not given are inherited from the old fact by the Worker (see README "Findings").
  const fresh = {id: uuidv7(), text: factText(flags), evidence: evidenceRefs(flags.evidence),
    kind: flags.kind, subject: flags.subject, source: flags.source,
    sensitivity: flags.sensitivity === undefined ? undefined : Number(flags.sensitivity)};
  const data = await ops([{op: 'supersede', id: rest[0], new: fresh, reason: typeof flags.reason === 'string' ? flags.reason : undefined}]);
  out(factResult(data));
}

/** Forgetting is owner-only, so the mind can only propose it (class `delete`). */
export async function forget(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th forget <fact id> --why <text>');
  const why = need(flags, 'why');
  if (why.length > 140) throw invalid('--why is over 140 characters');
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/proposals/${seg(id)}`, {body: {
    class: 'delete', question: 'Forget this fact for good?', why, if_ignored: 'Nothing happens; the fact stays.',
    options: ['Forget it', 'Keep it'], spec: {v: 1, op: 'memory.forget', args: {id: rest[0]}},
  }});
  out({proposal_id: data.id || id});
}

/** Open threads (commitments): add | done | drop | list. */
export async function thread(argv) {
  const {flags, rest} = parseArgs(argv);
  const [sub, ...words] = rest;
  if (sub === 'list') {
    const {data} = await request('GET', '/v1/memory/open-threads', {query: {status: 'open'}});
    return out({items: data.items || []});
  }
  if (sub === 'add') {
    const text = words.join(' ').trim();
    if (!text) throw invalid('usage: th thread add <text> [--owner mind|owner] [--due <date>] --evidence <ids>');
    const owner = flags.owner ?? 'mind';
    if (owner !== 'mind' && owner !== 'owner') throw invalid('--owner must be mind or owner');
    const id = uuidv7();
    await request('PUT', `/v1/memory/open-threads/${seg(id)}`,
      {body: {text, owner, due_at: toMs(flags.due, 'due'), evidence: evidenceRefs(flags.evidence)}});
    return out({id});
  }
  if (sub === 'done' || sub === 'drop') {
    const id = words[0];
    if (!id) throw invalid(`usage: th thread ${sub} <id>${sub === 'drop' ? ' --why <text>' : ''}`);
    const why = sub === 'drop' ? need(flags, 'why') : undefined;
    await request('PATCH', `/v1/memory/open-threads/${seg(id)}`, {body: {status: sub === 'done' ? 'done' : 'dropped', why}});
    return out({id});
  }
  throw invalid('usage: th thread add <text> --evidence <ids> | done <id> | drop <id> --why <t> | list');
}

const dayArg = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw invalid('a day must be YYYY-MM-DD');
  return value;
};

/** Night input: one call per part. */
export async function day(argv) {
  const {rest} = parseArgs(argv);
  const d = dayArg(rest[0]);
  const part = async name => (await request('GET', `/v1/mind/day/${d}`, {query: {part: name}})).data;
  const [stats, messages, ledgerPage, notes] = [await part('stats'), await part('messages'), await part('ledger'), await part('notes')];
  out({stats, messages: messages.items ?? [], ledger: ledgerPage.items ?? [], session_notes: notes.items ?? [],
    events_summary: stats?.events ?? null});
}

export async function daynote(argv) {
  const {flags, rest} = parseArgs(argv);
  const d = dayArg(rest[0]);
  const decisions = jsonFlag(flags.decisions, 'decisions') ?? [];
  const importance = Number(flags.importance);
  if (!Array.isArray(decisions)) throw invalid('--decisions must be a JSON array of strings');
  if (!(importance >= 1 && importance <= 10)) throw invalid('--importance must be 1-10');
  const {data} = await request('PUT', `/v1/memory/day-notes/${d}`, {body: {summary: need(flags, 'summary'), decisions, importance}});
  out({version: data.version ?? null});
}

/** One batch of memory ops from a file: `{"ops":[…]}` or `[…]`. */
export async function facts(argv) {
  const {flags} = parseArgs(argv);
  let parsed;
  try { parsed = JSON.parse(readFileSync(need(flags, 'batch'), 'utf8')); } catch (e) { throw invalid(`--batch: ${e.message}`); }
  const list = Array.isArray(parsed) ? parsed : parsed.ops;
  if (!Array.isArray(list) || !list.length || list.length > 50) throw invalid('--batch must hold 1–50 ops');
  const data = await ops(list.map(op => (op.op === 'add' && !op.id ? {...op, id: uuidv7()} : op)));
  out({applied: (data.applied || []).length, proposed: (data.proposals || []).length, rejected: data.rejected || []});
}
