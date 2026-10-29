// The reflex's two commands (RUNTIME.md §3, OPERATIONS.md §8.2). `th reflex` prints the procedure
// and every tripped watchdog with what to do about it: the procedure and each watchdog's `handle`
// come from the contract (shared/contract/watchdogs.ts), so mind/ROLES.md stays under 6,000
// characters. `th handled` reports what the session did about one trip; the Stop hook keeps a
// reflex session going until each tripped watchdog that wakes it has its report. `th drill` trips
// one by hand when the owner asks (SETUP.md M2), to check that the reflex handles it.
import {parseArgs} from './args.mjs';
import {invalid, need, out} from './io.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';

const OUTCOMES = ['fixed', 'reported', 'nothing'];
const W = () => CONTRACT.watchdogs;

/** The tripped watchdogs a reflex session must still report (they wake it, and have no report yet). */
export const unreported = items => items.filter(i => i.state === 'tripped' && !i.handled && W().items[i.name]?.wakes);

export async function reflex(argv) {
  parseArgs(argv);
  const {data} = await request('GET', '/v1/ops/watchdogs');
  const items = data.items || [];
  const tripped = items.filter(i => i.state === 'tripped').map(i => ({
    name: i.name, severity: i.severity, since: i.since, detail: i.detail, slo: i.slo,
    handle: W().items[i.name]?.handle ?? null, handled: i.handled,
  }));
  out({
    procedure: W().reflex_procedure,
    tripped,
    unreported: unreported(items).map(i => i.name),
    ok: items.filter(i => i.state === 'ok').map(i => i.name),
    later: items.filter(i => i.state === 'later').length,
  });
}

export async function handled(argv) {
  const {flags, rest} = parseArgs(argv);
  const name = rest[0];
  const outcome = need(flags, 'outcome');
  const note = String(need(flags, 'note'));
  if (!name || !(name in W().items)) throw invalid(`usage: th handled <watchdog> --outcome ${OUTCOMES.join('|')} --note <text>; watchdogs: ${Object.keys(W().items).join(', ')}`);
  if (!OUTCOMES.includes(outcome)) throw invalid(`--outcome must be one of ${OUTCOMES.join(', ')}`);
  if (note.length < 8 || note.length > 200) throw invalid('--note must be 8-200 characters');
  const {data} = await request('POST', `/v1/ops/watchdogs/${encodeURIComponent(name)}/handled`, {body: {outcome, note}});
  out(data);
}

export async function drill(argv) {
  const {rest} = parseArgs(argv);
  const name = rest[0];
  if (!name || !(name in W().items)) throw invalid(`usage: th drill <watchdog>; watchdogs: ${Object.keys(W().items).join(', ')}`);
  const {data} = await request('POST', `/v1/ops/watchdogs/${encodeURIComponent(name)}/drill`, {body: {}});
  out(data);
}
