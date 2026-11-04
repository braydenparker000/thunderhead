// th watch: the day pulse (RUNTIME.md §3, API.md §11.8). A watch is a condition you store that,
// met once, wakes the chat with your why and note (a live session hears it as a `th wait` event
// instead), within the owner's wake budget (`mind.wake_budget`, a day; the Worker refuses the rest
// and your briefing counts them). No standing permission gates it: it is your own bookkeeping.
//
//   th watch set at <when> --why <8–200> [--note <≤140>]                  → {"id","state","until","ledger_id"}
//   th watch set event <sense type|reminder.fired> [--ref <ref>] --why … [--note …]
//   th watch set change <work|verb|proposal|prediction> [--ref <ref>] --why … [--note …]
//   th watch cancel <id>                                                  → {"id","state","ledger_id"}
//   th watch list                                                         → GET /v1/mind/watches
//
// <when> is an ISO time with its offset or +90m, +2h, +1d (as `th remind`), at most 7 days ahead.
// `th undo <ledger_id>` takes either back. The note is what the wake carries back to you.
import {parseArgs} from './args.mjs';
import {CONTRACT, checkVerb} from './contract.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {invalid, need, out} from './io.mjs';
import {whenMs} from './remind.mjs';

const USAGE = 'usage: th watch set at <when> | set event <type> [--ref <ref>] | set change <kind> [--ref <ref>] --why <8–200> [--note <≤140>] | cancel <id> | list';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const W = CONTRACT.watches;
const seg = value => encodeURIComponent(String(value));

/** The watch.set args for `th watch set <kind> <what>`, checked against the contract before the network. */
export function watchArgs(kind, what, flags, now = Date.now()) {
  if (!W.kinds.includes(kind)) throw invalid(`a watch is ${W.kinds.join(', ')}; got ${kind ?? '(none)'}`);
  if (!what) throw invalid(USAGE);
  const why = need(flags, 'why');
  const args = {kind, why};
  if (kind === 'at') {
    args.at = whenMs(what, now);
    if (args.at <= now) throw invalid('<when> must be still to come');
    if (args.at > now + W.limits.ahead_days * 86_400_000) throw invalid(`<when> is at most ${W.limits.ahead_days} days ahead`);
  } else {
    const known = kind === 'change' ? Object.keys(W.changes) : [...senseTypes(), ...Object.keys(W.worker_events)];
    if (!known.includes(what)) throw invalid(`a ${kind} watch names one of: ${known.join(', ')}`);
    args.type = what;
  }
  if (typeof flags.ref === 'string') {
    if (kind === 'at') throw invalid('--ref goes with an event or a change watch');
    args.ref = flags.ref;
  }
  if (typeof flags.note === 'string') args.note = flags.note;
  checkVerb('watch.set', 1, args);
  return args;
}

/** The sense types an event watch may name (the verb's own list, from the contract). */
function senseTypes() {
  const props = CONTRACT.verbs['watch.set'].versions['1'].args.properties ?? {};
  return (props.type?.enum ?? []).filter(t => !Object.hasOwn(W.changes, t) && !Object.hasOwn(W.worker_events, t));
}

async function put(name, args, why) {
  const id = uuidv7();
  const {data} = await request('PUT', `/v1/verbs/${seg(id)}`, {body: {verb: name, schema: 1, args, why}});
  return data;
}

/** @param {string[]} argv */
export async function watch(argv) {
  const {flags, rest} = parseArgs(argv);
  const [sub, a, b] = rest;
  if (sub === 'list' && rest.length === 1) return out((await request('GET', '/v1/mind/watches')).data);
  if (sub === 'cancel' && rest.length === 2) {
    if (!UUID.test(a)) throw invalid(`not a watch id: ${a}`);
    const data = await put('watch.cancel', {id: a}, typeof flags.why === 'string' ? flags.why : 'no longer needed');
    return out({id: a, state: data.result?.state ?? null, ledger_id: data.ledger_id ?? null});
  }
  if (sub !== 'set' || rest.length !== 3) throw invalid(USAGE);
  const args = watchArgs(a, b, flags);
  const data = await put('watch.set', args, args.why);
  out({id: data.result?.watch_id ?? data.id, state: data.result?.state ?? null, until: data.result?.until ?? null, ledger_id: data.ledger_id ?? null});
}
