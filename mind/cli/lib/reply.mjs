// `th reply` and `th listen`: the chat loop in one round trip per reply.
//
// th reply [--to <message id>] [--minutes N] [every th say option] <<'EOF' … EOF
//   sends the answer on stdin exactly as `th say today --reply-to <id> -` does (printing its {"id"}),
//   then listens as `th listen`. Without --to: the newest owner message handed to this session and
//   not yet answered (what the wait last printed; else the Worker's unanswered list). A failed send
//   exits with its own error and code and does not listen.
// th listen [--minutes N]: the listening half alone (default 9 minutes). Exit 0/4/5 as th wait,
//   3 {"quiet":{"idle_min","closes_in_min"}} after N quiet minutes, 12 {"closed":…} at the cut-off.
import {parseArgs} from './args.mjs';
import {EXIT, invalid} from './io.mjs';
import {request} from './http.mjs';
import {say} from './conv.mjs';
import {LISTEN_MINUTES, handed, listenLoop} from './wait.mjs';

/** The flags reply keeps for itself; every other argument goes to th say as given. */
const OWN = ['to', 'minutes'];

function strip(argv) {
  const kept = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2).split('=')[0] : null;
    if (name === 'reply-to') throw invalid('th reply takes --to <message id>');
    if (!OWN.includes(name)) { kept.push(argv[i]); continue; }
    if (!argv[i].includes('=') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) i++;
  }
  return kept;
}

function minutesOf(flags) {
  if (flags.minutes === undefined) return LISTEN_MINUTES;
  const n = Number(flags.minutes);
  if (!(n > 0)) throw invalid('--minutes must be a positive number');
  return n;
}

async function newestUnanswered() {
  const local = handed().at(-1)?.id;
  if (local) return local;
  try {
    const {data} = await request('GET', '/v1/mind/pending', {retry: false});
    return Array.isArray(data?.unanswered) ? data.unanswered.at(-1) ?? null : null;
  } catch { return null; }
}

export async function listen(argv) {
  const {flags} = parseArgs(argv);
  return listenLoop({minutes: minutesOf(flags), cutoff: true, quiet: true});
}

export async function reply(argv) {
  const {flags, rest} = parseArgs(argv, {repeat: ['attach']});
  const minutes = minutesOf(flags);
  const sayArgs = strip(argv);
  if (rest.some(r => r !== '-')) throw invalid("th reply reads the answer from stdin: th reply [--to <id>] <<'EOF' … EOF");
  const to = typeof flags.to === 'string' ? flags.to : await newestUnanswered();
  if (!to) throw invalid('no owner message is waiting for an answer here: name one with --to, or run th listen');
  await say(['today', '--reply-to', to, ...sayArgs.filter(a => a !== '-'), '-']);
  const code = await listenLoop({minutes, cutoff: true, quiet: true});
  return typeof code === 'number' ? code : EXIT.ok;
}
