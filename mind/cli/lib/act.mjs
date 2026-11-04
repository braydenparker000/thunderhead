// Acting commands: propose, decide, approved, verb, order, surface, push, predict, night
// (RUNTIME.md §5.3, BEHAVIOR.md §4, API.md §11.10–11.12, §11.19–11.20); plans and what waits for
// its time are in plan.mjs.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {EXIT, invalid, jsonFlag, need, out, textArg, toMs} from './io.mjs';
import {CONTRACT, checkProposal, checkSurface, checkVerb} from './contract.mjs';
import {permitOut, proposalHeaders, request} from './http.mjs';
import {getState, setState} from './state.mjs';
import {uuidv7} from './ids.mjs';
import {cancel, fireAt, laterOk} from './plan.mjs';

/** The card classes (shared/contract/proposals.ts); `permit` is a standing permission set to Ask. */
export const CLASSES = Object.keys(CONTRACT.proposals.classes);
const seg = value => encodeURIComponent(String(value));

function bounded(flags, name, max) {
  const value = need(flags, name);
  if (value.length > max) throw invalid(`--${name} is over ${max} characters`);
  return value;
}

/** The owner's message that asked for this (`--asked-by <message id>`): a reply, so the owner's
 * speech setting (quiet, silent) never holds it back (BEHAVIOR.md §3.7). */
const askedBy = flags => (typeof flags['asked-by'] === 'string' ? flags['asked-by'] : undefined);

/** A decision card (BEHAVIOR.md §4): one question, why, two options (action, safe), if-ignored, odds
 * (required on an arrangement's card, class permit: how sure you are the owner wants it). */
export async function propose(argv) {
  const {flags} = parseArgs(argv);
  const cls = need(flags, 'class');
  if (!CLASSES.includes(cls)) throw invalid(`--class must be one of ${CLASSES.join(', ')}`);
  const spec = jsonFlag(need(flags, 'spec'), 'spec');
  if (!spec || typeof spec !== 'object' || typeof spec.op !== 'string') throw invalid('--spec must be {"op": "...", "args": {...}}');
  const options = typeof flags.options === 'string' ? flags.options.split('|').map(s => s.trim()) : ['Do it', 'Not now'];
  if (options.length !== 2 || options.some(o => !o || o.length > 20)) throw invalid('--options must be "Action|Safe choice", each ≤ 20 characters');
  const {odds_min: lo, odds_max: hi} = CONTRACT.proposals.limits;
  if (flags.odds === undefined && CONTRACT.proposals.odds_required.includes(cls))
    throw invalid(`--odds is required for a ${cls} card (an arrangement): how sure you are the owner wants it, ${lo}–${hi}`);
  const odds = flags.odds === undefined ? undefined : Number(flags.odds);
  if (odds !== undefined && !(odds >= lo && odds <= hi)) throw invalid(`--odds must be between ${lo} and ${hi}`);
  const safe = flags.safe === undefined ? undefined : flags.safe;
  if (safe !== undefined && safe !== 'reject' && safe !== 'snooze') throw invalid('--safe must be reject (No) or snooze (Not yet)');
  const full = {v: 1, args: {}, ...spec};
  checkProposal(cls, full);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/proposals/${seg(id)}`, {body: {
    class: cls, question: bounded(flags, 'question', 80), why: bounded(flags, 'why', 140),
    if_ignored: bounded(flags, 'if-ignored', 140), odds, options, safe, spec: full, asked_by: askedBy(flags),
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

/** `th verb <app.action> [<args json>] --why <t> [--at <time>]`: any verb in the contract, checked
 * before sending; with --at it waits for that time (plan.mjs). `th verb cancel <id>` takes a scheduled
 * one back before it runs. */
export async function verb(argv) {
  const {flags, rest} = parseArgs(argv);
  const [name, argsJson] = rest;
  if (name === 'cancel' && rest.length === 2) return cancel(rest[1]);
  if (!name || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(name)) throw invalid('usage: th verb <app>.<action> [<args json>] --why <text> [--at <time>] [--schema <n>] [--device <id>] [--ref <ref>] | cancel <id>');
  // `-`: the args JSON on stdin, so text from elsewhere (a song's title in a mix's name) is never
  // inside a quoted shell argument.
  const raw = argsJson ?? flags.args;
  const args = jsonFlag(raw === '-' ? readFileSync(0, 'utf8') : raw, 'args') ?? {};
  const schema = checkVerb(name, flags.schema === undefined ? undefined : Number(flags.schema), args);
  if (flags.at !== undefined) laterOk(name);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/verbs/${seg(id)}`, {body: {
    verb: name, schema, args, why: why(flags),
    ref: typeof flags.ref === 'string' ? flags.ref : undefined,
    device_id: typeof flags.device === 'string' ? flags.device : undefined,
    proposal_id: typeof flags.proposal === 'string' ? flags.proposal : undefined,
    fire_at: flags.at === undefined ? undefined : fireAt(flags.at),
  }});
  out({verb_id: data.id || id, status: data.status ?? null, ledger_id: data.ledger_id ?? null,
    ...(flags.at === undefined ? {} : {fire_at: data.fire_at ?? null, shifted: Boolean(data.shifted)}), ...permitOut(data)});
}

/** Work orders for Muse (API.md §11.19, MUSE-PROTOCOL.md): new | list | get | cancel. An order is a
 * `muse.request`: words (at most 500 characters) and, optionally, the app it belongs in. Placing one
 * is the standing permission `muse.order` (ask by default: `--proposal <card>` once approved). */
export async function order(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['personal']});
  const [sub, id] = rest;
  if (sub === 'new') {
    if (flags.kind !== undefined && flags.kind !== 'muse.request') throw invalid('--kind: muse.request is the one kind an order is placed of');
    // No order kind carries the owner's data: one that would needs a reach_people card first.
    if (flags.personal) throw invalid('no personal order kinds are built: the owner\'s data never goes to Muse without a reach_people card');
    const words = need(flags, 'words');
    if (words.length > 500) throw invalid('--words is over 500 characters');
    const title = typeof flags.title === 'string' ? flags.title : words.replace(/\s+/g, ' ').slice(0, 60);
    if (title.length > 80) throw invalid('--title is over 80 characters');
    const app = typeof flags.app === 'string' ? flags.app : undefined;
    const deadline = flags.deadline === undefined ? Date.now() + 3 * 86_400_000 : toMs(flags.deadline, 'deadline');
    const orderId = uuidv7();
    const {data} = await request('PUT', `/v1/work/orders/${seg(orderId)}`, {headers: proposalHeaders(flags), body: {kind: 'muse.request', title,
      spec: {v: 1, words, ...(app ? {app} : {})}, deadline_at: deadline}});
    return out({id: orderId, state: data.state ?? null, ...permitOut(data)});
  }
  if (sub === 'list') {
    const {data} = await request('GET', '/v1/work/orders', {query: {status: 'all', limit: 100}});
    return out({items: data.items || []});
  }
  if (sub === 'get' && id) return out((await request('GET', `/v1/work/orders/${seg(id)}`)).data);
  if (sub === 'cancel' && id) {
    const why = need(flags, 'why');
    if (why.length < 8) throw invalid('--why must be at least 8 characters');
    const {data} = await request('POST', `/v1/work/orders/${seg(id)}/cancel`, {body: {why}});
    return out({id, status: data.status ?? 'cancelled'});
  }
  throw invalid('usage: th order new --words <text> [--app <app>] [--title <t>] [--deadline <iso>] [--proposal <id>] | list | get <id> | cancel <id> --why <t>');
}

/** `th muse notes [--after <seq>] [--order <id>] | note <text>`: Muse's own thread, or one order's
 * progress lines (MUSE-PROTOCOL.md). */
export async function muse(argv) {
  const {flags, rest} = parseArgs(argv);
  const [sub, ...words] = rest;
  if (sub === 'notes') return out((await request('GET', '/v1/work/thread', {query: {after: flags.after ?? 0, ...(typeof flags.order === 'string' ? {order: flags.order} : {})}})).data);
  if (sub === 'note' && words.length) {
    const noteId = uuidv7();
    await request('POST', '/v1/work/thread/messages', {body: {id: noteId, body: words.join(' ')}});
    return out({id: noteId});
  }
  throw invalid('usage: th muse notes [--after <seq>] [--order <id>] | note <text>');
}

/** `th surface <app> <slot> --kind … | ls | rm <app> <slot> | topics | said <topic> | reopen <topic>
 * --by-message <id>`: any surface kind in the contract; what lands per topic (BEHAVIOR.md §3.6). A
 * topic that rests answers 422 topic_quiet (exit 8) with the day it reopens. */
export async function surface(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest[0] === 'ls') {
    const {data} = await request('GET', '/v1/surfaces', {query: {since_seq: flags.since}});
    return out({items: data.items || [], seq: data.seq ?? null});
  }
  if (rest[0] === 'topics' && rest.length === 1) return out((await request('GET', '/v1/insight/topics')).data);
  if ((rest[0] === 'said' || rest[0] === 'reopen') && rest.length === 2) {
    const topic = rest[1];
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(topic)) throw invalid('the topic is a slug: lowercase letters, digits, . _ -');
    // Reopening is the owner's: their own words, which the Worker checks as it checks a card's.
    const body = rest[0] === 'said' ? {} : {by_message: need(flags, 'by-message')};
    const {data} = await request('POST', `/v1/surfaces/topics/${seg(topic)}/${rest[0]}`, {body});
    return out(data);
  }
  if (rest[0] === 'rm') {
    const [, app, slot] = rest;
    if (!app || !slot) throw invalid('usage: th surface rm <app> <slot>');
    await request('DELETE', `/v1/surfaces/${seg(app)}/${seg(slot)}`);
    return out({ok: true});
  }
  const [app, slot] = rest;
  if (!app || !slot) throw invalid('usage: th surface <app> <slot> --kind <k> --payload <json> --why <t> --topic <key> [--expires <iso>] [--asked-by <message id>] · ls · rm <app> <slot> · topics · said <topic> · reopen <topic> --by-message <id>');
  const kind = need(flags, 'kind');
  const given = need(flags, 'payload');
  const payload = jsonFlag(given === '-' ? readFileSync(0, 'utf8') : given, 'payload');
  const schema = checkSurface(app, slot, kind, flags.schema === undefined ? undefined : Number(flags.schema), payload);
  const topic = need(flags, 'topic');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(topic)) throw invalid('--topic is a slug: lowercase letters, digits, . _ -');
  const {data} = await request('PUT', `/v1/surfaces/${seg(app)}/${seg(slot)}`, {headers: proposalHeaders(flags), body: {
    kind, schema, payload, why: why(flags), topic_key: topic, expires_at: toMs(flags.expires, 'expires'),
    // The app it is about (`app:music`): its opening counts as the owner acting on it (EVALS.md M-16).
    ref: typeof flags.ref === 'string' ? flags.ref : undefined,
    asked_by: askedBy(flags),
  }});
  out({ledger_id: data.ledger_id ?? null, ...permitOut(data)});
}

export async function push(argv) {
  const {flags} = parseArgs(argv);
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/pushes/${seg(id)}`, {body: {
    title: need(flags, 'title'), body: need(flags, 'body'), ref: need(flags, 'ref'), why: need(flags, 'why'),
    topic_key: need(flags, 'topic'), deadline: toMs(flags.deadline, 'deadline'), asked_by: askedBy(flags),
  }});
  out({queued_until: data.queued_until ?? null});
}

const PREDICT_USAGE = 'usage: th predict <category> --p <0.01-0.99> --why <text> [--n <n> | --time <HH:MM> | --card <id> | --app <app>] [--day <day>] | list [--open] | skill';
const nextDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** `th predict` (P9, EVALS.md M-18): a prediction about the open day (the day after the briefing's),
 * which the Worker resolves from what the owner does once the day is over; `list` and `skill`. */
export async function predict(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['open']});
  if (rest[0] === 'list' && rest.length === 1) return out((await request('GET', '/v1/predictions', {query: flags.open ? {open: 1} : {}})).data);
  if (rest[0] === 'skill' && rest.length === 1) return out((await request('GET', '/v1/predictions/skill')).data);
  if (rest.length !== 1) throw invalid(PREDICT_USAGE);
  const args = {};
  if (flags.n !== undefined) args.n = Number(flags.n);
  if (flags.time !== undefined) args.time = String(flags.time);
  if (flags.card !== undefined) args.id = String(flags.card);
  if (flags.app !== undefined) args.app = String(flags.app);
  const briefed = getState('day');
  const day = typeof flags.day === 'string' ? flags.day : briefed ? nextDay(briefed) : null;
  if (!day) throw invalid('--day is required (no briefing day recorded)');
  const {data} = await request('PUT', `/v1/predictions/${seg(uuidv7())}`, {body: {
    category: rest[0], args, day, p: Number(need(flags, 'p')), why: need(flags, 'why'),
  }});
  out({id: data.id, day: data.day});
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
