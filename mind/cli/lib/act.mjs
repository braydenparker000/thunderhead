// Acting commands: propose, decide, approved, verb, order, surface, push, night
// (RUNTIME.md §5.3, BEHAVIOR.md §4, API.md §11.10–11.12, §11.19–11.20).
import {parseArgs} from './args.mjs';
import {EXIT, invalid, jsonFlag, need, out, toMs} from './io.mjs';
import {CONTRACT, checkProposal, checkSurface, checkVerb} from './contract.mjs';
import {request} from './http.mjs';
import {getState, setState} from './state.mjs';
import {uuidv7} from './ids.mjs';

export const CLASSES = ['delete', 'money', 'access', 'reach_people', 'memory_big'];
const seg = value => encodeURIComponent(String(value));

function bounded(flags, name, max) {
  const value = need(flags, name);
  if (value.length > max) throw invalid(`--${name} is over ${max} characters`);
  return value;
}

/** A decision card (BEHAVIOR.md §4): one question, why, two options (action, safe), if-ignored, odds. */
export async function propose(argv) {
  const {flags} = parseArgs(argv);
  const cls = need(flags, 'class');
  if (!CLASSES.includes(cls)) throw invalid(`--class must be one of ${CLASSES.join(', ')}`);
  const spec = jsonFlag(need(flags, 'spec'), 'spec');
  if (!spec || typeof spec !== 'object' || typeof spec.op !== 'string') throw invalid('--spec must be {"op": "...", "args": {...}}');
  const options = typeof flags.options === 'string' ? flags.options.split('|').map(s => s.trim()) : ['Do it', 'Not now'];
  if (options.length !== 2 || options.some(o => !o || o.length > 20)) throw invalid('--options must be "Action|Safe choice", each ≤ 20 characters');
  const odds = flags.odds === undefined ? undefined : Number(flags.odds);
  if (odds !== undefined && !(odds >= 0 && odds <= 1)) throw invalid('--odds must be between 0 and 1');
  const safe = flags.safe === undefined ? undefined : flags.safe;
  if (safe !== undefined && safe !== 'reject' && safe !== 'snooze') throw invalid('--safe must be reject (No) or snooze (Not yet)');
  const full = {v: 1, args: {}, ...spec};
  checkProposal(cls, full);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/proposals/${seg(id)}`, {body: {
    class: cls, question: bounded(flags, 'question', 80), why: bounded(flags, 'why', 140),
    if_ignored: bounded(flags, 'if-ignored', 140), odds, options, safe, spec: full,
  }});
  // `target`: the Worker's own line naming what a Yes changes (the card shows it under the question).
  out({proposal_id: data.id || id, spec_hash: data.spec_hash ?? null, target: data.target ?? null});
}

/**
 * Records the owner's own words as the decision (API.md §11.10: `{decision, spec_hash, by_message}`); the
 * Worker verifies the message and who records it (exit 6: not_owner_words, also for the laws card, which
 * takes a tap only; session_required unless this session holds the chat lease; session_tainted for an
 * approval from a tainted session). `spec_hash` is the hash of the spec the card showed
 * the owner: taken from --spec-hash (what `th propose` printed) or read from the waiting proposal.
 */
export async function decide(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['reject']});
  if (!rest[0] || typeof flags['by-message'] !== 'string') throw invalid('usage: th decide <proposal id> --by-message <message id> [--spec-hash <hash>] [--reject]');
  let specHash = typeof flags['spec-hash'] === 'string' ? flags['spec-hash'] : null;
  if (!specHash) {
    const {data} = await request('GET', '/v1/proposals', {query: {status: 'waiting', limit: 200}});
    specHash = (data.items || []).find(p => p.id === rest[0])?.spec_hash ?? null;
    if (!specHash) throw invalid(`no waiting proposal ${rest[0]} (pass --spec-hash if it is still on its card)`);
  }
  const {data} = await request('POST', `/v1/proposals/${seg(rest[0])}/decide`,
    {body: {decision: flags.reject ? 'reject' : 'approve', spec_hash: specHash, by_message: flags['by-message']}});
  out({status: data.status, ledger_id: data.ledger_id ?? null});
}

/**
 * Whether the owner approved changing these protected paths on a branch from this commit: an
 * executed `repo.change` card whose base is the commit and whose paths cover every one asked about
 * (RUNTIME.md §6.4). Exit 0 approved, 6 not approved. The pre-tool hook asks before an edit or a push.
 */
export async function approved(argv) {
  const {flags} = parseArgs(argv);
  const paths = String(need(flags, 'paths')).split(',').map(p => p.trim()).filter(Boolean);
  const sha = need(flags, 'sha');
  if (!paths.length || !/^[0-9a-f]{40}$/.test(sha)) throw invalid('usage: th approved --paths <p1,p2> --sha <40-hex commit>');
  // Always the owner's Core: an approval in the eval sandbox approves nothing real.
  const {data} = await request('GET', '/v1/proposals', {query: {status: 'all', limit: 200}, sandbox: false});
  const card = (data.items || []).find(p => p.status === 'executed' && p.spec?.op === 'repo.change' && p.spec.args?.base === sha &&
    paths.every(x => (p.spec.args.paths || []).includes(x)));
  out({approved: Boolean(card), proposal_id: card?.id ?? null});
  return card ? EXIT.ok : EXIT.forbidden;
}

/** why: the ledger line the owner reads (8–200 characters), required for every action. */
function why(flags) {
  const text = need(flags, 'why');
  if (text.length < 8 || text.length > 200) throw invalid('--why must be 8–200 characters');
  return text;
}

/** `th verb <app.action> [<args json>] --why <t>`: any verb in the contract, checked before sending. */
export async function verb(argv) {
  const {flags, rest} = parseArgs(argv);
  const [name, argsJson] = rest;
  if (!name || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(name)) throw invalid('usage: th verb <app>.<action> [<args json>] --why <text> [--schema <n>] [--device <id>] [--ref <ref>]');
  const args = jsonFlag(argsJson ?? flags.args, 'args') ?? {};
  const schema = checkVerb(name, flags.schema === undefined ? undefined : Number(flags.schema), args);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/verbs/${seg(id)}`, {body: {
    verb: name, schema, args, why: why(flags),
    ref: typeof flags.ref === 'string' ? flags.ref : undefined,
    device_id: typeof flags.device === 'string' ? flags.device : undefined,
    proposal_id: typeof flags.proposal === 'string' ? flags.proposal : undefined,
  }});
  out({verb_id: data.id || id, status: data.status ?? null, ledger_id: data.ledger_id ?? null});
}

/** Work orders for Muse (API.md §11.19): new | list | get | cancel. */
export async function order(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['personal']});
  const [sub, id] = rest;
  if (sub === 'new') {
    const kind = need(flags, 'kind');
    const title = typeof flags.title === 'string' ? flags.title : kind;
    if (title.length > 80) throw invalid('--title is over 80 characters');
    const orderId = uuidv7();
    await request('PUT', `/v1/work/orders/${seg(orderId)}`, {body: {kind, assignee: 'muse', title,
      spec: jsonFlag(need(flags, 'spec'), 'spec'), schema: jsonFlag(need(flags, 'schema'), 'schema'), personal: !!flags.personal,
      approval_id: typeof flags.approval === 'string' ? flags.approval : undefined, deadline_at: toMs(need(flags, 'deadline'), 'deadline')}});
    return out({id: orderId});
  }
  if (sub === 'list') {
    const {data} = await request('GET', '/v1/work/orders', {query: {status: 'all', limit: 200}});
    return out({items: data.items || []});
  }
  if (sub === 'get' && id) return out((await request('GET', `/v1/work/orders/${seg(id)}`)).data);
  if (sub === 'cancel' && id) {
    const why = need(flags, 'why');
    if (why.length < 8) throw invalid('--why must be at least 8 characters');
    const {data} = await request('POST', `/v1/work/orders/${seg(id)}/cancel`, {body: {why}});
    return out({id, status: data.status ?? 'cancelled'});
  }
  throw invalid('usage: th order new --kind <k> --spec <json> --schema <json> --deadline <iso> [--title <t>] [--personal --approval <id>] | list | get <id> | cancel <id> --why <t>');
}

/** `th surface <app> <slot> --kind … | ls | rm <app> <slot>`: any surface kind in the contract. */
export async function surface(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest[0] === 'ls') {
    const {data} = await request('GET', '/v1/surfaces', {query: {since_seq: flags.since}});
    return out({items: data.items || [], seq: data.seq ?? null});
  }
  if (rest[0] === 'rm') {
    const [, app, slot] = rest;
    if (!app || !slot) throw invalid('usage: th surface rm <app> <slot>');
    await request('DELETE', `/v1/surfaces/${seg(app)}/${seg(slot)}`);
    return out({ok: true});
  }
  const [app, slot] = rest;
  if (!app || !slot) throw invalid('usage: th surface <app> <slot> --kind <k> --payload <json> --why <t> --topic <key> [--expires <iso>] · ls · rm <app> <slot>');
  const kind = need(flags, 'kind');
  const payload = jsonFlag(need(flags, 'payload'), 'payload');
  const schema = checkSurface(app, slot, kind, flags.schema === undefined ? undefined : Number(flags.schema), payload);
  const topic = need(flags, 'topic');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(topic)) throw invalid('--topic is a slug: lowercase letters, digits, . _ -');
  const {data} = await request('PUT', `/v1/surfaces/${seg(app)}/${seg(slot)}`, {body: {
    kind, schema, payload, why: why(flags), topic_key: topic, expires_at: toMs(flags.expires, 'expires'),
  }});
  out({ledger_id: data.ledger_id ?? null});
}

export async function push(argv) {
  const {flags} = parseArgs(argv);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/pushes/${seg(id)}`, {body: {
    title: need(flags, 'title'), body: need(flags, 'body'), ref: need(flags, 'ref'), why: need(flags, 'why'),
    topic_key: need(flags, 'topic'), deadline: toMs(flags.deadline, 'deadline'),
  }});
  out({queued_until: data.queued_until ?? null});
}

const NIGHT_USAGE = 'usage: th night start | step <n> done | step <n> cursor <c> | done [--partial] | steps  [--day <YYYY-MM-DD>]';

/** `th night` (RUNTIME.md §12): the night run's progress. `start` works on the briefing's day (the
 * closed day the night works on), or `--day` for another closed day of the last week; the run's
 * day is kept, so the steps after it (and `th facts --night`) go to the same run without `--day`.
 * `steps` lists the steps from the contract. Out: where the run stands, `{resume_from, done,
 * cursor, skipped}`; a step out of order exits 7 with `resume_from` in the error's details. */
export async function night(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['partial']});
  const n = CONTRACT.night;
  if (rest[0] === 'steps')
    return out({steps: n.steps.map(({step, name, budget_min, cursor, phase, sunday}) => ({step, name, budget_min, cursor, phase, ...(sunday ? {sunday} : {})})),
      budget_min: n.budget_min});
  const day = typeof flags.day === 'string' ? flags.day
    : rest[0] === 'start' ? getState('day') : getState('night_day') ?? getState('day');
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw invalid('--day is required (no briefing day recorded)');
  const step = Number(rest[1]);
  let body;
  if (rest[0] === 'start' && rest.length === 1) body = {day, action: 'start'};
  else if (rest[0] === 'done' && rest.length === 1) body = {day, action: 'done', partial: flags.partial ? true : undefined};
  else if (rest[0] === 'step' && Number.isInteger(step) && rest[2] === 'done' && rest.length === 3) body = {day, action: 'step_done', step};
  else if (rest[0] === 'step' && Number.isInteger(step) && rest[2] === 'cursor' && rest[3] && rest.length === 4) body = {day, action: 'cursor', step, cursor: rest[3]};
  else throw invalid(NIGHT_USAGE);
  if (body.step !== undefined) {
    const known = n.steps.find(s => s.step === body.step);
    if (!known) throw invalid(`steps are ${n.steps.map(s => s.step).join(', ')}`);
    if (body.action === 'cursor' && !known.cursor) throw invalid(`step ${body.step} keeps no cursor`);
  }
  if (body.cursor !== undefined && body.cursor.length > n.cursor_max) throw invalid(`a cursor is at most ${n.cursor_max} characters`);
  const {data} = await request('POST', '/v1/mind/night', {body});
  setState('night_day', day);
  out({resume_from: data.resume_from ?? null, done: !!data.done, cursor: data.cursor ?? null, skipped: data.skipped ?? []});
}
