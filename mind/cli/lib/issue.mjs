// th issue: the list for the builder (shared/contract/issues.ts, API.md §11.30). When the owner says
// something is broken or annoying, file it in their words, naming the message they said it in (an
// owner message of the last 48 hours); a building session reads the list later. Forgiving
// (lib/forgive.mjs): trims and says so, takes a kind in any case and a `msg:` id, and refuses once
// with every fault. Nothing is ever deleted; notes are only added.
//
//   th issue add --title <≤ 120> --what <≤ 1,000> [--where <app or page>] [--kind annoying|broken|idea] --from <owner message id>
//        → {"id","state","seen","repaired"?}
//   th issue note <id> "<text>"|-     → {"id","notes"}
//   th issue ls [--state open|done|all] → {"items":[…],"more"}
import {parseArgs} from './args.mjs';
import {Faults, oneOf, prose, sent} from './forgive.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {invalid, out, textArg} from './io.mjs';

/** ISSUE_LIMITS in shared/contract/issues.ts; the Worker checks them again. */
export const LIMITS = {title: 120, what: 1000, where: 60, note: 1000};
const KINDS = ['annoying', 'broken', 'idea'];
const STATES = ['open', 'done', 'all'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USAGE = 'th issue add --title <≤ 120> --what <≤ 1,000> [--where <app or page>] [--kind annoying|broken|idea] --from <owner message id> | note <id> "<text>" | ls [--state open|done|all]';
const seg = value => encodeURIComponent(String(value));

/** An id as sent: trimmed, lowercased, a `msg:` (or other `kind:`) prefix dropped, each said once. */
function idOf(f, field, value) {
  if (typeof value !== 'string' || !value.trim()) { f.add(field, 'an id (a UUIDv7)', 'none sent'); return undefined; }
  let id = value.trim().toLowerCase();
  if (id !== value) f.fix(`${field}: trimmed and lowercased`);
  const bare = id.replace(/^[a-z]{2,16}:/, '');
  if (bare !== id) { f.fix(`${field}: dropped the "${id.slice(0, id.length - bare.length)}" before the id`); id = bare; }
  if (!UUID.test(id)) { f.add(field, 'an id (a UUIDv7)', sent(value)); return undefined; }
  return id;
}

/** A kind in any case, or a near word for one ("bug", "annoyance"), said once. */
function kindOf(f, value) {
  if (value === undefined) return undefined;
  const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
  const near = {bug: 'broken', broke: 'broken', annoyance: 'annoying', annoyed: 'annoying', wish: 'idea'};
  const kind = typeof v === 'string' && near[v] ? near[v] : v;
  if (KINDS.includes(kind) && kind !== value) f.fix(`--kind: ${JSON.stringify(value)} → ${kind}`);
  return oneOf(f, '--kind', kind, KINDS);
}

async function add(flags) {
  const f = new Faults();
  const title = prose(f, '--title', flags.title, {max: LIMITS.title});
  const what = prose(f, '--what', flags.what, {max: LIMITS.what});
  const where = flags.where === undefined ? undefined : prose(f, '--where', flags.where, {max: LIMITS.where});
  const kind = kindOf(f, flags.kind);
  const from = idOf(f, '--from', flags.from);
  f.done(USAGE);
  const body = {title, what, ...(where ? {where} : {}), ...(kind ? {kind} : {}), from_message_id: from};
  const {data} = await request('PUT', `/v1/issues/${seg(uuidv7())}`, {body});
  out(f.with({id: data.issue.id, state: data.issue.state, seen: data.issue.seen}));
}

async function note(rest) {
  const f = new Faults();
  const id = idOf(f, '<id>', rest[0]);
  const text = prose(f, '<text>', rest.length > 1 ? textArg(rest.slice(1)) : undefined, {max: LIMITS.note});
  f.done(USAGE);
  const {data} = await request('POST', `/v1/issues/${seg(id)}/notes`, {body: {text}});
  out(f.with({id: data.issue.id, notes: data.issue.notes.length}));
}

async function ls(flags) {
  const f = new Faults();
  const state = oneOf(f, '--state', typeof flags.state === 'string' ? flags.state.toLowerCase() : flags.state, STATES, {fallback: 'open'});
  f.done(USAGE);
  out(f.with((await request('GET', '/v1/issues', {query: {state}})).data));
}

/** @param {string[]} argv */
export async function issue(argv) {
  const {flags, rest} = parseArgs(argv);
  const [sub, ...tail] = rest;
  if (sub === 'add' && !tail.length) return add(flags);
  if (sub === 'note') return note(tail);
  if (sub === 'ls' || sub === 'list') return ls(flags);
  throw invalid(`usage: ${USAGE}`);
}
