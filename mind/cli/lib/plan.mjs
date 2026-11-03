// Later and plans (API.md §11.11): `th verb … --at <time>` runs a verb at that time, `th verb cancel
// <id>` takes a scheduled one back before it runs, `th verbs scheduled` lists what waits, and `th plan
// <file.json>` runs 2–8 verbs in order with one why, one undo and one line on home. Everything is
// checked against the contract before the network: each step's verb and args, the limits, and that
// no step that runs only as it is asked (`now_only`) is put off till later.
//
//   th plan <file.json|-> --why <t> [--what <home's line>] [--at <time>] [--proposal <id>]
//       → {"plan_id","status","ledger_id","fire_at","shifted","steps":[…],"permit"}
//   th verb cancel <verb or plan id>   → {"id","status"}
//   th verbs scheduled                 → {"items":[…]}
//
// The file is {"what": "Set up your evening.", "steps": [{"verb": "music.queue", "args": {…}}, …]}
// (or the steps alone, with --what); a step may name its "schema" and "device". <time> is an ISO
// time, owner-local (2026-11-03T18:00) or with its offset, or +90m, +2h, +1d. With --proposal (the
// approved plan.run card) send the same steps and the same absolute time again: the card approves
// exactly those.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {CONTRACT, checkVerb} from './contract.mjs';
import {permitOut, request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {invalid, need, out} from './io.mjs';
import {lintText} from './conv.mjs';

const S = CONTRACT.schedules;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const RELATIVE = /^\+(\d{1,6})([mhd])$/;
const UNIT = {m: 60_000, h: 3_600_000, d: 86_400_000};
const DAY = 86_400_000;
const seg = value => encodeURIComponent(String(value));

/** `--at` as the Worker takes it: an ISO time as given (owner-local or with its offset), or now
 * plus a span as UTC. Checked here against the days ahead when it can be (not an owner-local one). */
export function fireAt(at, now = Date.now()) {
  const rel = RELATIVE.exec(String(at));
  const ms = rel && Number(rel[1]) > 0 ? now + Number(rel[1]) * UNIT[rel[2]] : null;
  if (ms === null && !LOCAL.test(String(at)))
    throw invalid(`--at must be an ISO time (2026-11-03T18:00, owner-local, or with its offset) or +90m, +2h, +1d; got ${at}`);
  const abs = ms ?? (/(Z|[+-]\d{2}:\d{2})$/.test(at) ? Date.parse(at) : null);
  if (abs !== null && (abs < now - 60_000 || abs > now + S.limits.days_ahead * DAY))
    throw invalid(`--at must be within the next ${S.limits.days_ahead} days`);
  return ms === null ? String(at) : new Date(ms).toISOString();
}

/** A verb that runs only as it is asked may not wait. */
export function laterOk(name) {
  if (CONTRACT.verbs[name]?.now_only) throw invalid(`${name} runs only as it is asked, never later (no --at)`);
}

function steps(raw) {
  const list = Array.isArray(raw) ? raw : raw?.steps;
  const {min_steps: min, max_steps: max} = S.plans;
  if (!Array.isArray(list) || list.length < min || list.length > max) throw invalid(`a plan is ${min}–${max} steps`);
  return list.map((s, i) => {
    if (!s || typeof s !== 'object' || typeof s.verb !== 'string') throw invalid(`step ${i + 1} needs a "verb"`);
    const args = s.args ?? {};
    let schema;
    try { schema = checkVerb(s.verb, s.schema === undefined ? undefined : Number(s.schema), args); }
    catch (e) { throw invalid(`step ${i + 1}: ${e.message}`); }
    return {verb: s.verb, schema, args, ...(typeof s.device === 'string' ? {device_id: s.device} : {})};
  });
}

/** `th plan <file.json|-> --why <t> [--what <t>] [--at <time>] [--proposal <id>]`. */
export async function plan(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th plan <file.json|-> --why <text> [--what <home\'s line>] [--at <time>] [--proposal <id>]');
  let raw;
  try { raw = JSON.parse(rest[0] === '-' ? readFileSync(0, 'utf8') : readFileSync(rest[0], 'utf8')); }
  catch (e) { throw invalid(`${rest[0]}: ${e.code === 'ENOENT' ? 'no such file' : 'not valid JSON'}`); }
  const list = steps(raw);
  const why = need(flags, 'why');
  if (why.length < 8 || why.length > 200) throw invalid('--why must be 8–200 characters');
  const what = typeof flags.what === 'string' ? flags.what : raw?.what;
  if (typeof what !== 'string' || !what.trim() || what.length > S.plans.what)
    throw invalid(`a plan needs its line for home (--what or "what"), at most ${S.plans.what} characters`);
  const problem = lintText(what);
  if (problem) throw invalid(`the phrase lint refuses the line (${problem})`);
  if (flags.at !== undefined) for (const s of list) laterOk(s.verb);
  const id = uuidv7();
  const {data} = await request('POST', '/v1/verbs/plan', {body: {
    id, steps: list, why, what,
    fire_at: flags.at === undefined ? undefined : fireAt(flags.at),
    proposal_id: typeof flags.proposal === 'string' ? flags.proposal : undefined,
  }});
  out({plan_id: data.id || id, status: data.status ?? null, ledger_id: data.ledger_id ?? null, fire_at: data.fire_at ?? null,
    ...(data.shifted === undefined ? {} : {shifted: data.shifted}),
    steps: (data.steps || []).map(s => ({verb: s.verb, status: s.status ?? null, ledger_id: s.ledger_id ?? null})),
    ...permitOut(data)});
}

/** `th verb cancel <id>`: a scheduled verb or plan, before it runs. */
export async function cancel(id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw invalid('usage: th verb cancel <verb or plan id>');
  const {data} = await request('POST', `/v1/verbs/${seg(id)}/cancel`, {body: {}});
  out({id, status: data.status ?? null});
}

/** `th verbs scheduled`: what waits for its time, soonest first. */
export async function verbs(argv) {
  if (argv[0] !== 'scheduled' || argv.length !== 1) throw invalid('usage: th verbs scheduled');
  const {data} = await request('GET', '/v1/verbs/scheduled');
  out({items: (data.items || []).map(v => ({id: v.id, verb: v.verb, fire_at: v.fire_at ?? null,
    ...(v.verb === S.plan_action ? {what: v.args?.what ?? null, steps: (v.args?.steps || []).map(s => s.verb)} : {args: v.args}),
    created_at: v.created_at}))});
}
