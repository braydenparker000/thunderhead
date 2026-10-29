// `th help [command]`: the commands, then what this Worker build offers the role, read from the
// contract (mind/cli/contract.json), so a new route, verb or surface kind shows up here the moment
// the contract has it.
import {CONTRACT, routesFor} from './contract.mjs';
import {EXIT} from './io.mjs';

/** One line per command: usage, then what it does. The table in RUNTIME.md §5.3 has the details. */
export const USAGE = {
  brief: ['[--claim] [--full] [--section <n|name>] [--json]', 'the briefing (core on stdout; --claim binds the wake)'],
  wait: ['[--minutes 24] [--after <seq>]', 'listen: exit 0 messages/events · 3 timeout · 4 Stop · 5 day closed'],
  say: ['today|system [--reply-to <id>] [--kind text|progress|card|question|error] [--meta <json>] <text|->', 'post to today\'s thread (night/reflex: --kind error to system)'],
  amend: ['<message id> [--meta <json>] [--body <text|->]', 'change your own post (keeps a card current)'],
  history: ['today|<thread id> [--limit 40] [--before <seq>]', 'read a thread'],
  status: ['working|listening|stopping|limited [--thread <id>] [--note <text>] [--error <code>]', 'presence; working acknowledges what was handed out'],
  title: ['<thread id> <title>', 'name a thread'],
  note: ['--session <text|-> [--open <json>]', 'the session note (≤ 120 words)'],
  pending: ['', 'what the Stop hook reads: unanswered, stop, day_closed, limited, idle'],
  search: ['<query> [--sources messages,facts,…] [--since] [--until] [--thread <id>] [--limit 20]', 'federated search (recall is the same)'],
  recall: ['<query> [--sources …] [--kind …]', 'same as search'],
  verb: ['<app.action> [<args json>] --why <8–200 chars> [--schema <n>] [--device <id>] [--ref <ref>]', 'ask a phone to do something (undoable)'],
  surface: ['<app> <slot> --kind <k> --payload <json> --why <t> --topic <key> [--expires <iso>] · ls · rm <app> <slot>', 'place, list or clear a surface'],
  undo: ['<ledger id>', 'undo one of your actions'],
  ledger: ['[--since <iso>] [--kind <k>] [--limit 50]', 'what was done and why'],
  get: ['<path> [key=value …]', 'GET any route this role may call (see the list below)'],
  taint: ['--source <tool> --ref <url or id>', 'mark this session tainted (irreversible)'],
  health: ['[--deep]', 'Worker health'],
  errors: ['[--hours 24]', 'open errors'],
  help: ['[command]', 'this text'],
  // Later phases: the commands exist so the procedure never changes; the Worker answers when its
  // phase is built, and until then th exits 8 not_built.
  file: ['<attachment id> [--out <path>]', 'download an attachment (private bucket)'],
  remember: ['--kind <k> --text <t> --evidence <ids> [--subject] [--sensitivity 0|1] [--source]', 'add a fact (P3)'],
  confirm: ['<fact id> --evidence <ids>', 'confirm a fact (P3)'],
  supersede: ['<fact id> --text <t> --evidence <ids> [--reason <r>]', 'replace a fact (P3)'],
  forget: ['<fact id> --why <text>', 'propose forgetting a fact (a delete card for the owner)'],
  thread: ['add <text> --evidence <ids> | done <id> | drop <id> --why <t> | list', 'open threads (P3)'],
  propose: ['--class <c> --question <q> --why <t> --spec <json> --if-ignored <t> [--odds] [--options "A|B"] [--safe reject|snooze]', 'a decision card for the owner (the ops are listed below)'],
  decide: ['<proposal id> --by-message <message id> [--spec-hash <h>] [--reject]', 'record the owner\'s words as the decision (P4)'],
  order: ['new … | list | get <id> | cancel <id> --why <t>', 'work orders for Muse (P4)'],
  push: ['--title --body --ref --why --topic [--deadline]', 'a push (P8)'],
  day: ['<YYYY-MM-DD> [--part messages|ledger|notes [--cursor <c>]]', 'the night\'s input: counts and every part, or one page of a part (P3)'],
  daynote: ['<day> --summary --decisions <json> --importance <1-10>', 'the day note (P3)'],
  facts: ['--batch <file.json> [--night [--part <k>] [--day <day>]]', 'a batch of memory ops; --night: part k of step 4 for the night run\'s day (P3)'],
  night: ['start | step <n> done | step <n> cursor <c> | done [--partial] | steps [--day <day>]', 'the night run: where it stands, each step done, a saved place (P3)'],
};

export function helpText(command, role = process.env.TH_ROLE || '') {
  if (command && USAGE[command]) return `th ${command} ${USAGE[command][0]}\n  ${USAGE[command][1]}`;
  const lines = ['th: the mind\'s way to the Worker. Commands:'];
  for (const [name, [usage, what]] of Object.entries(USAGE)) lines.push(`  th ${name} ${usage}`.trimEnd(), `      ${what}`);
  lines.push('', `Routes this build offers${role ? ` the ${role} role` : ''} (th get takes the GETs):`);
  for (const r of routesFor(role)) lines.push(`  ${r.key}${r.note ? `  (${r.note})` : ''}`);
  lines.push('', 'Verbs (th verb):');
  for (const [name, v] of Object.entries(CONTRACT.verbs)) {
    const ver = Math.max(...Object.keys(v.versions).map(Number));
    const args = Object.keys(v.versions[ver].args.properties || {}).join(', ');
    lines.push(`  ${name} v${ver} {${args}}${v.queueable ? '' : ' (owner tap only)'}: ${v.doc}`);
  }
  lines.push('', 'Surface kinds (th surface):');
  for (const [name, k] of Object.entries(CONTRACT.surfaces)) lines.push(`  ${name} in ${Object.entries(k.slots).map(([a, p]) => `${a} ${p}`).join('; ')}: ${k.doc}`);
  lines.push('', 'Proposal ops (th propose --spec {"op": …, "args": {…}}):');
  for (const [name, o] of Object.entries(CONTRACT.proposals?.ops ?? {})) {
    const args = Object.keys(o.args.properties || {}).join(', ');
    lines.push(`  ${name} {${args}} --class ${o.classes.join('|')} (raised by ${o.by.join(' ')}): ${o.doc}`);
  }
  lines.push('', `Exit codes: ${Object.entries(EXIT).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  return lines.join('\n');
}
