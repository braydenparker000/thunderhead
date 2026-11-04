// Routines (API.md §11.11 "Routines", MIND-PLAN §3.6): arrangements the owner approves once, which
// then run without a session. You only propose one, always as a card (class routine, op
// routine.propose): the plan as th plan takes it (1–8 steps, its line for home) and one condition.
// The owner's yes stores it; it runs quietly at its time under the permit it had then.
//
//   th routine propose <file.json|-> --name <≤40> (--at HH:MM [--days weekdays|weekends|mon,wed] |
//       --after <sense type> | --fact <observed fact id>) --why <8–140> --question <q> --if-ignored <t>
//       --odds 0.05-0.95 [--what <home's line>] [--options "A|B"] [--asked-by <message id>]
//       → {"routine_id","proposal_id","spec_hash","target"}
//   th routine list                 → {"items":[{id,name,when,on,steps,next_at,last_run_at,last_ledger_id,last_error}]}
//   th routine cancel <routine id>  → {"id","status"}: switches it off (only the owner switches one on);
//       a card still waiting for the owner is cancelled instead
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {CONTRACT, checkProposal, checkVerb} from './contract.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {ThError, invalid, need, out} from './io.mjs';
import {lintText} from './conv.mjs';

const R = CONTRACT.routines;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_SETS = {weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weekends: ['sat', 'sun']};
const seg = value => encodeURIComponent(String(value));

/** `--days`: weekdays, weekends, or a list of mon…sun. */
export function days(value) {
  const list = DAY_SETS[value] ?? String(value).split(',').map(d => d.trim().toLowerCase());
  if (!list.length || list.some(d => !R.days.includes(d))) throw invalid(`--days must be weekdays, weekends or a list of ${R.days.join(',')}`);
  return R.days.filter(d => list.includes(d));
}

/** The one condition the flags name. */
export function condition(flags) {
  const named = ['at', 'after', 'fact'].filter(k => flags[k] !== undefined);
  if (named.length !== 1) throw invalid('a routine needs exactly one of --at HH:MM, --after <sense type>, --fact <observed fact id>');
  if (flags.at !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(flags.at))) throw invalid('--at must be HH:MM (07:30), the owner\'s clock');
    return {at: String(flags.at), ...(flags.days === undefined ? {} : {days: days(flags.days)})};
  }
  if (flags.days !== undefined) throw invalid('--days goes with --at only');
  if (flags.after !== undefined) return {after: String(flags.after)};
  if (!UUID.test(String(flags.fact))) throw invalid('--fact must be an observed fact id');
  return {fact: String(flags.fact)};
}

function steps(raw) {
  const list = Array.isArray(raw) ? raw : raw?.steps;
  if (!Array.isArray(list) || list.length < R.limits.min_steps || list.length > R.limits.max_steps)
    throw invalid(`a routine is ${R.limits.min_steps}–${R.limits.max_steps} steps`);
  return list.map((s, i) => {
    if (!s || typeof s !== 'object' || typeof s.verb !== 'string') throw invalid(`step ${i + 1} needs a "verb"`);
    if (CONTRACT.verbs[s.verb]?.now_only) throw invalid(`step ${i + 1}: ${s.verb} runs only as it is asked, never on its own`);
    const args = s.args ?? {};
    let schema;
    try { schema = checkVerb(s.verb, s.schema === undefined ? undefined : Number(s.schema), args); }
    catch (e) { throw invalid(`step ${i + 1}: ${e.message}`); }
    return {verb: s.verb, schema, args, ...(typeof s.device === 'string' ? {device_id: s.device} : {})};
  });
}

const bounded = (flags, name, min, max) => {
  const v = need(flags, name);
  if (v.length < min || v.length > max) throw invalid(`--${name} must be ${min}–${max} characters`);
  return v;
};

async function propose(argv) {
  const {flags, rest} = parseArgs(argv);
  if (!rest[0]) throw invalid('usage: th routine propose <file.json|-> --name <name> (--at HH:MM [--days …] | --after <type> | --fact <id>) --why <t> --question <q> --if-ignored <t> --odds <p>');
  let raw;
  try { raw = JSON.parse(rest[0] === '-' ? readFileSync(0, 'utf8') : readFileSync(rest[0], 'utf8')); }
  catch (e) { throw invalid(`${rest[0]}: ${e.code === 'ENOENT' ? 'no such file' : 'not valid JSON'}`); }
  const list = steps(raw);
  const name = bounded(flags, 'name', 1, R.limits.name);
  const why = bounded(flags, 'why', 8, 140);
  const what = typeof flags.what === 'string' ? flags.what : raw?.what;
  if (typeof what !== 'string' || !what.trim() || what.length > CONTRACT.schedules.plans.what)
    throw invalid(`a routine needs its line for home (--what or "what"), at most ${CONTRACT.schedules.plans.what} characters`);
  for (const t of [name, what]) {
    const problem = lintText(t);
    if (problem) throw invalid(`the phrase lint refuses "${t}" (${problem})`);
  }
  const {odds_min: lo, odds_max: hi} = CONTRACT.proposals.limits;
  const odds = Number(need(flags, 'odds'));
  if (!(odds >= lo && odds <= hi)) throw invalid(`--odds must be between ${lo} and ${hi}: how sure you are the owner wants it`);
  const options = typeof flags.options === 'string' ? flags.options.split('|').map(s => s.trim()) : ['Set it up', 'Not now'];
  if (options.length !== 2 || options.some(o => !o || o.length > 20)) throw invalid('--options must be "Action|Safe choice", each ≤ 20 characters');
  const id = uuidv7();
  const spec = {v: 1, op: 'routine.propose', args: {id, name, why, what, steps: list, condition: condition(flags)}};
  checkProposal('routine', spec);
  const {data} = await request('PUT', `/v1/proposals/${seg(id)}`, {body: {
    class: 'routine', question: bounded(flags, 'question', 1, 80), why, if_ignored: bounded(flags, 'if-ignored', 1, 140),
    odds, options, spec, ...(typeof flags['asked-by'] === 'string' ? {asked_by: flags['asked-by']} : {}),
  }});
  out({routine_id: id, proposal_id: data.id || id, spec_hash: data.spec_hash ?? null, target: data.target ?? null});
}

async function list(argv) {
  if (argv.length) throw invalid('usage: th routine list');
  const {data} = await request('GET', '/v1/routines');
  out({items: (data.items || []).map(r => ({id: r.id, name: r.name, when: r.when, on: r.on, steps: r.steps, next_at: r.next_at ?? null,
    last_run_at: r.last_run_at ?? null, last_ledger_id: r.last_undone ? null : r.last_ledger_id ?? null, last_error: r.last_error ?? null}))});
}

/** Off for a stored one; a card still waiting is cancelled (the routine and its card share the id). */
async function cancel(argv) {
  const id = argv[0];
  if (!id || argv.length !== 1 || !UUID.test(id)) throw invalid('usage: th routine cancel <routine id>');
  try {
    const {data} = await request('POST', `/v1/routines/${seg(id)}/switch`, {body: {on: false}});
    out({id, status: data.on ? 'on' : 'off'});
  } catch (e) {
    if (!(e instanceof ThError) || e.code !== 'not_found') throw e;
    await request('POST', `/v1/proposals/${seg(id)}/cancel`, {body: {why: 'the mind took the routine back before the owner answered'}});
    out({id, status: 'cancelled'});
  }
}

/** `th routine propose|list|cancel`. */
export async function routine(argv) {
  const [sub, ...tail] = argv;
  if (sub === 'propose') return propose(tail);
  if (sub === 'list') return list(tail);
  if (sub === 'cancel') return cancel(tail);
  throw invalid('usage: th routine propose|list|cancel (th help routine)');
}
