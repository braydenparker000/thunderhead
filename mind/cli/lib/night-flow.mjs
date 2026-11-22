// The night in one pass (RUNTIME.md §12, 2026-11-22). Two halves:
//  - `closesThrough`/`autoClose`: in a night session, a writing command that succeeded closes its
//    own step and every earlier one still open (POST /v1/mind/night `through`), so a normal night
//    never runs `th night step <n> done`. A step of several commands (loose ends, facts, arranging)
//    is closed by the next step's first command, or by the report or `th night done`.
//  - `nightPlan`: what `th night start` prints beside where the run stands: the closed day in brief
//    (counts, routines, the owner's messages, how the day's arrangements were met), the errors and
//    the deep health in one line each (whole only when something is wrong), and for each step due
//    tonight one line with the exact command; the rest listed with why not tonight.
// Every read here is counts and ids, the owner's own messages and the Worker's own words: never a
// song's tags (the Worker marks any read of them, so songs are offered without a count), a book's
// title or a web page, so nothing here labels the session.
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {getState, setState, briefPath} from './state.mjs';
import {readFileSync} from 'node:fs';
import {sectionOf} from './brief.mjs';

const ORDER = CONTRACT.night.steps.map(s => s.step);
const pos = step => ORDER.indexOf(step);

/** The step a command closes through (inclusive), or null for one that closes nothing. */
export function closesThrough(command, argv = []) {
  const sub = argv.find(a => !a.startsWith('-'));
  switch (command) {
    case 'daynote': return 2;
    case 'note': return argv.includes('--day-voice') ? 1 : null;
    case 'title': return 1;
    case 'thread': return sub === 'list' ? null : 2;
    case 'facts': return argv.includes('--night') ? 3 : null;
    case 'surface': return ['ls', 'topics'].includes(sub) ? null : 4;
    case 'podcasts': return sub === 'new' ? 4 : null;
    case 'growth': return 13;
    case 'report': return 12;
    case 'eval': return sub === 'begin' ? 8 : null;
    case 'music': return ['page', 'note'].includes(sub) ? 9 : null;
    default: return null;
  }
}

/** After a command succeeded in a night session that ran `th night start`: close through its step.
 * A failure never fails the command; it is said on stderr. */
export async function autoClose(command, argv) {
  if (process.env.TH_ROLE !== 'night' || command === 'night') return;
  const day = getState('night_day');
  const step = closesThrough(command, argv);
  if (!day || step === null || getState('night_closed') === day) return;
  const reached = getState('night_through');
  if (reached?.day === day && reached.pos >= pos(step)) return;
  try {
    const {data} = await request('POST', '/v1/mind/night', {body: {day, action: 'through', step}});
    setState('night_through', {day, pos: pos(step)});
    if (data?.done) setState('night_closed', day);
  } catch (e) {
    process.stderr.write(`${JSON.stringify({note: `night step ${step} not closed: ${e?.message ?? e}`})}\n`);
  }
}

const settle = p => p.then(r => r.data).catch(() => null);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** The owner's messages printed at most; past it, the rest is a page away. */
const OWNER_SHOWN = 30;

/** How the closed day's arrangements were met: section 7's lines of this session's briefing. */
function arrangements() {
  try {
    const seven = sectionOf(readFileSync(briefPath(), 'utf8'), 7) ?? '';
    return seven.split('\n').filter(l => l.includes(' ← ')).slice(0, 8);
  } catch { return []; }
}

/** Why a step is not due tonight by the contract (the Worker's rule in night.ts), or null. The
 * weekly step is offered on its own night, the one into Sunday; on another night the Worker runs it
 * only when that night missed it, and `th growth` says so itself. */
function notDue(s, day) {
  if (!CONTRACT.night.built_phases.includes(s.phase) || s.deferred) return 'not built yet';
  const saturday = new Date(`${day}T12:00:00Z`).getUTCDay() === 6;
  if (s.sunday && !saturday) return 'not Sunday';
  if (s.weekly && !saturday) return "not the week's day (the night into Sunday)";
  return null;
}

/** What `th night start` adds to the run's state. `run`: the Worker's answer. */
export async function nightPlan(day, run) {
  const since = Date.now() - 24 * 3_600_000;
  const [stats, page, routines, errs, health, threads, books] = await Promise.all([
    settle(request('GET', `/v1/mind/day/${day}`, {query: {part: 'stats'}})),
    settle(request('GET', `/v1/mind/day/${day}`, {query: {part: 'messages'}})),
    settle(request('POST', '/v1/senses/query', {body: {name: 'routines', params: {to: day}}})),
    settle(request('GET', '/v1/ops/errors', {query: {status: 'open', since, limit: 50}, retry: false})),
    settle(request('GET', '/v1/ops/health/deep', {retry: false})),
    settle(request('GET', '/v1/memory/open-threads', {query: {status: 'open'}})),
    settle(request('GET', '/v1/library/books', {retry: false})),
  ]);
  const owner = (page?.items ?? []).filter(m => m.author === 'owner');
  const thread = page?.items?.[0]?.thread_id ?? null;
  const habits = routines?.rows ?? [];
  const errors = errs?.items ?? null;
  const agreed = (threads?.items ?? []).filter(t => (t.tags ?? []).includes('agreed')).map(t => t.id);
  const queued = books?.items ? books.items.filter(b => b.state === 'queued').length : null;
  const healthOk = health?.ok === true;
  const moreMessages = page?.next ? `th day ${day} --part messages --cursor ${page.next}` : null;
  const ownerMore = owner.length > OWNER_SHOWN;

  const offer = {
    1: moreMessages || ownerMore ? `the rest of the day: ${moreMessages ?? `th day ${day} --part messages`}` : null,
    2: `th daynote ${day} --summary "<≤ 150 words>" --decision "<one thing decided>" --importance <1-10> --voice "<≤ 200 chars: what you noticed>"${thread ? ' --title "<the day\'s thread title, ≤ 80>"' : ''}`,
    3: owner.length ? 'th thread add "<a commitment>" --evidence msg:<message id> · th thread done <loose end id>' : null,
    4: owner.length || habits.length
      ? 'th recall --each - --kind facts <<\'EOF\' <one subject a line> EOF, then th facts --batch - --night <<\'EOF\' {"ops":[{"op":"add","kind":"<state|goal|preference|routine|habit|fact>","subject":"owner","text":"<the fact>","source":"<user|observed|inferred>","evidence":["msg:<message id>"]}, {"op":"confirm","id":"<fact id>","evidence":["msg:<id>"]}]} EOF'
      : null,
    7: 'th podcasts new · th surface home line.<1-3> --kind line --payload \'{"text":"<2-44 chars>"}\' --why "<≤ 140>" --topic <key> --ref app:<id> · th surface briefing <practice|study|built|note.1|note.2|note.3> --kind tile --payload \'{"label":"<≤ 24>","value":"<≤ 32>","detail":"<≤ 60>"}\' --why "<≤ 140>" --topic <key>',
    13: 'th growth',
    5: agreed.length || (errors && errors.length) || (health && !healthOk)
      ? `${agreed.length ? `fix only the loose ends tagged agreed, each on a branch (th skill code): ${agreed.join(', ')}` : 'look at the errors or health above; fix nothing not agreed'}`
      : null,
    12: 'th report --headline "<≤ 60>" --note - <<\'EOF\' <the morning note in your voice, ≤ 1,200 chars: what you did, what you noticed, something they would enjoy, what is waiting> EOF',
    6: queued === 0 ? null : 'node mind/jobs/study-ingest.mjs',
    8: null,
    9: 'th eval begin, then exactly what it prints',
    11: 'th music page (no items: nothing to note), then th music note <<\'EOF\' [{"n":1,"known":true,"moods":["…"],"occasions":["…"],"themes":["…"],"language":"…","era":"…","energy":0.5,"conf":0.7}] EOF, page by page',
    10: 'th night done',
  };
  const why = {
    1: 'the day is above', 3: 'no messages from the owner', 4: 'no messages from the owner and no routines',
    5: 'no loose end tagged agreed, no open errors, health ok', 6: 'no book queued',
  };
  const todo = [];
  const notTonight = [];
  const from = pos(run.resume_from);
  for (const s of CONTRACT.night.steps) {
    if (pos(s.step) < from) continue;
    const skip = notDue(s, day);
    if (skip) notTonight.push({step: s.step, why: skip});
    else if (offer[s.step]) todo.push({step: s.step, run: offer[s.step]});
    else notTonight.push({step: s.step, why: why[s.step] ?? 'nothing to do'});
  }
  return {
    day_brief: {
      counts: stats ? {messages: stats.messages, owner: stats.owner, mind: stats.mind, ledger: stats.ledger, notes: stats.notes} : null,
      owner_messages: owner.slice(0, OWNER_SHOWN).map(m => ({id: m.id, body: clip(String(m.body ?? ''), 400)})),
      routines: habits.length,
      arrangements: arrangements(),
    },
    errors: errors === null ? 'unknown' : errors.length ? {open: errors.length, items: errors.slice(0, 10)} : 'none open in 24 h',
    health: health === null ? 'unknown' : healthOk ? 'ok' : health,
    todo,
    not_tonight: notTonight,
    the_rule: 'each writing command closes its own step and the open ones before it; th night done closes the rest',
  };
}
