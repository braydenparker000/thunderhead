// `th help [command]`: the commands, then what this Worker build offers the role, read from the
// contract (mind/cli/contract.json), so a new route, verb or surface kind shows up here the moment
// the contract has it.
import {CONTRACT, routesFor} from './contract.mjs';
import {EXIT} from './io.mjs';

/** One line per command: usage, then what it does. The table in RUNTIME.md §5.3 has the details. */
export const USAGE = {
  brief: ['[--claim] [--full] [--section <n|name>] [--json]', 'the briefing (core on stdout; --claim binds the wake)'],
  wait: ['[--minutes 24] [--after <seq>]', 'listen: exit 0 messages/events · 3 timeout · 4 Stop · 5 day closed'],
  say: ['today|system [--reply-to <id>] [--kind text|progress|card|question|error] [--meta <json>] <text|->', 'post to today\'s thread (night/reflex: --kind error to system). The phone shows Markdown: ### headings, - and 1. lists, > quotes, **bold**, *italic*, `code`, | tables |. When a picture says it better, --meta {"blocks":[…]} adds up to 4 blocks under the words: stats {items:[{label,value,change?,direction?}]}, chart {kind:line|column|bar,text,labels,series:[{name,values}],unit?}, timeline {items:[{date,label,text}]}, comparison {items:[{label,text}]}, agenda {items:[{at,label,place?}]}, explanation {steps:[…]}, callout {kind:context|watch,text}. --meta {"followups":["Play it now","Make it longer"]} offers up to 2 short next asks (≤ 40 characters) as taps under the reply; the owner\'s tap comes back as their message, its reply_to this one'],
  amend: ['<message id> [--meta <json>] [--body <text|->]', 'change your own post (keeps a card current)'],
  history: ['today|<thread id> [--limit 40] [--before <seq>]', 'read a thread'],
  status: ['working|listening|stopping|limited [--thread <id>] [--note <text>] [--error <code>]', 'presence; working acknowledges what was handed out'],
  title: ['<thread id> <title>', 'name a thread'],
  note: ['--session <text|-> [--open <json>]', 'the session note (≤ 120 words)'],
  pending: ['', 'what the Stop hook reads: unanswered, stop, day_closed, limited, idle'],
  search: ['<query> [--sources messages,facts,…] [--since] [--until] [--thread <id>] [--limit 20]', 'federated search (recall is the same)'],
  recall: ['<query> [--sources …] [--kind …]', 'same as search'],
  verb: ['<app.action> [<args json>] --why <8–200 chars> [--schema <n>] [--device <id>] [--ref <ref>]', 'ask a phone to do something (undoable)'],
  surface: ['<app> <slot> --kind <k> --payload <json> --why <t> --topic <key> [--ref app:<id>] [--expires <iso>] · ls · rm <app> <slot>', 'place, list or clear a surface; --ref names the app it is about, so opening that app counts as using it'],
  undo: ['<ledger id>', 'undo one of your actions'],
  ledger: ['[--since <iso>] [--kind <k>] [--limit 50]', 'what was done and why'],
  get: ['<path> [key=value …]', 'GET any route this role may call (see the list below)'],
  library: ['cite <question>', 'the blocks of the owner\'s books an answer may cite (then say with --meta cite.q)'],
  taint: ['--source <tool> --ref <url or id>', 'mark this session tainted (irreversible)'],
  health: ['[--deep]', 'Worker health'],
  errors: ['[--hours 24]', 'open errors'],
  help: ['[command]', 'this text'],
  file: ['<id|file:id> [--out <path>]', 'save an attachment from the Worker to $TMPDIR/th/files/<id>.<ext>; prints path, type, name and a voice memo\'s words (text)'],
  remind: ['<when> <text|-> --from <owner message id> | list | cancel <id> [--from <owner message id>]', 'a reminder the owner asked for in that message (sent in the last 48 h, at most 3 from one, 5 from you a day): <when> is an ISO time with its offset or +90m, +2h, +1d; delivered once at that time as a line and a push, a time in quiet hours moved to their end (shifted: true says so in the reply). Cancel one the owner set on the phone only with --from naming the message that asked'],
  // Later phases: the commands exist so the procedure never changes; the Worker answers when its
  // phase is built, and until then th exits 8 not_built.
  remember: ['--kind <k> --text <t> --evidence <ids> [--subject] [--sensitivity 0|1] [--source]', 'add a fact (P3)'],
  confirm: ['<fact id> --evidence <ids>', 'confirm a fact (P3)'],
  supersede: ['<fact id> --text <t> --evidence <ids> [--reason <r>]', 'replace a fact (P3)'],
  forget: ['<fact id> --why <text>', 'propose forgetting a fact (a delete card for the owner)'],
  thread: ['add <text> --evidence <ids> | done <id> | drop <id> --why <t> | list', 'open threads (P3)'],
  propose: ['--class <c> --question <q> --why <t> --spec <json> --if-ignored <t> [--odds] [--options "A|B"] [--safe reject|snooze]', 'a decision card for the owner (the ops are listed below)'],
  approved: ['--paths <p1,p2> --sha <commit>', 'whether the owner approved changing these protected paths on a branch from that commit (exit 6: not approved)'],
  eval: ['begin | list | inj <id> | check <id> [--answer <text>] | end | week', 'the injection suite in the eval sandbox, then the week\'s eval line and at most one improvement (night step 9, Sundays)'],
  read: ['--kinds | --check <kind> [--json <answer> | --file <path>] (else stdin)', 'check the reader subagent\'s answer and work only from what this prints (it taints the session)'],
  reflex: ['', 'what to do now: the reflex procedure and each tripped watchdog with its handling (P4)'],
  handled: ['<watchdog> --outcome fixed|reported|nothing --note <text>', 'report what you did about a tripped watchdog (the reflex reports each one)'],
  drill: ['<watchdog>', 'only when the owner asks for a watchdog drill: trip it by hand so mind-reflex handles it (db.size is a good one)'],
  decide: ['<proposal id> --by-message <message id> [--spec-hash <h>] [--reject]', 'record the owner\'s words as the decision (P4)'],
  order: ['new --kind <k> --spec <json> --deadline <iso> [--title <t>] | list | get <id> | cancel <id> --why <t>', 'work orders for Muse; its result schema is the kind\'s (P4)'],
  muse: ['notes [--after <seq>] | note <text>', 'Muse\'s own thread (P4)'],
  push: ['--title --body --ref --why --topic [--deadline]', 'a push (P8)'],
  predict: ['<category> --p <0.01-0.99> --why <text> [--n <n> | --time <HH:MM> | --card <id> | --app <app>] [--day <day>] | list [--open] | skill',
    'a prediction about the open day, resolved from what the owner does once it ends: chat.any (they write), chat.count --n 2-50 (at least n messages), chat.before --time (their first message before then), decision.answered --card <id> (they answer that waiting card), app.open --app music|guitar|podcasts|astra|media|study (they open that app, as their phone reports it). Honest odds; at most 12 a day; a chat one only before their first message (P9)'],
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
  lines.push('', 'Reader kinds (the reader subagent answers in one; th read --check <kind>):');
  for (const [name, k] of Object.entries(CONTRACT.reader?.kinds ?? {})) lines.push(`  ${name}: ${k.doc}`);
  lines.push('', `Exit codes: ${Object.entries(EXIT).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  return lines.join('\n');
}
