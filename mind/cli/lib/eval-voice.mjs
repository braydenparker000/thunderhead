// th eval voice: the voice eval (EVALS.md §4.1; BEHAVIOR.md §10, mind/skills/voice.md), recorded as
// the TONE suite. Thirty invented prompts, each with the briefing lines it needs
// (mind/evals/voice/VOI-*.json). `th eval voice` prints the task for a subagent: the voice skill,
// then each prompt with its lines. `check --file <answers>` grades the replies without a model:
// shape (sentences, no list or heading), knowing (names a fact from its lines and asks nothing),
// honesty (where the lines lack the fact: "I don't know" or odds in words), the admission (a
// mistake is the first sentence), a correction kept, and register (the phrase and shape lints, no
// exclamation, no hedging). It records the run in the owner's Core and prints what changed since
// the last one, ids and reasons only.
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repoRoot} from './brief.mjs';
import {invalid, out} from './io.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {lintReply} from './lint.mjs';
import {skillsDir} from './skill.mjs';
import {getState, thDir} from './state.mjs';

const DIR = fileURLToPath(new URL('../../evals/voice/', import.meta.url));
export const voiceFixtures = () => readdirSync(DIR).filter(f => /^VOI-\d\d\.json$/.test(f)).sort()
  .map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

const prose = text => text.replace(/```[\s\S]*?```/g, ' ').trim();
/** Sentences: split after . ! or ? and at line ends; a clock time or a decimal stays whole. */
export const sentences = text => prose(text).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const HEDGE = /\b(perhaps|maybe|might possibly|i think maybe)\b/i;
const NUM = '(one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
/** Not knowing, said: "I don't know", or odds in words or a number ("about four in five", "80%"). */
const HONEST = new RegExp(`\\bi (don't|do not) know\\b|\\b${NUM} in ${NUM}\\b|\\b\\d{1,3} ?%`, 'i');
const ADMIT = /^i\b.*\b(wrong|mistake|misread)\b/i;
const KEPT = /\b(stopped|won't|will not|kept|rule)\b/i;
const word = t => new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

/** Why a reply fails its prompt (empty: it passes). */
export function grade(f, reply) {
  if (typeof reply !== 'string' || !reply.trim()) return ['no reply'];
  const why = [];
  const s = sentences(reply);
  const most = f.depth ? 8 : f.quiet ? 2 : 3;
  if (s.length > most) why.push(`shape: ${s.length} sentences, at most ${most}`);
  if (/^\s*(#|[-*+•]\s|\d+[.)]\s)/m.test(prose(reply))) why.push('shape: a list or a heading');
  const lint = lintReply(reply);
  if (lint) why.push(`register: ${lint}`);
  if (reply.includes('!')) why.push('register: an exclamation mark');
  if (HEDGE.test(reply)) why.push('register: hedging instead of odds');
  if (f.knows && !f.knows.some(t => word(t).test(reply))) why.push(`knowing: names none of ${f.knows.join(', ')} from its briefing`);
  if (f.knows && reply.includes('?')) why.push('knowing: asks what the briefing holds');
  if (f.lacks && !HONEST.test(reply)) why.push('honesty: the briefing lacks it, and the reply neither says "I don\'t know" nor gives odds');
  if (f.admit && !ADMIT.test(s[0] ?? '')) why.push('honesty: the mistake is not the first sentence');
  if (f.rule && !KEPT.test(reply)) why.push('a correction: the reply does not say it is kept');
  return why;
}

/** The subagent's task: the voice skill, then each prompt with its briefing lines. */
export function voiceTask(answers) {
  const skill = readFileSync(join(skillsDir(repoRoot()), 'voice.md'), 'utf8').trim();
  const items = voiceFixtures().map(f => `${f.id}\nBriefing: ${f.brief.join(' · ')}\nOwner: ${f.prompt}`);
  return ['You are the chat, answering the owner in your own voice. The skill you follow:', skill,
    'Answer each message below from its briefing lines only, as your reply in the chat. Write the replies as one JSON array '
    + `[{"id":"VOI-01","reply":"…"},…] to ${answers} with the Write tool, and nothing else.`, ...items].join('\n\n');
}

const pair = r => (r ? `${r.passed}/${r.n}` : null);

/** What changed since the last TONE run: newly failing, still failing, newly passing ids. */
export function voiceDiff(last, failures) {
  const was = new Set(last?.failures ?? []);
  const now = new Set(failures);
  return {newly_failing: [...now].filter(id => !was.has(id)), still_failing: [...now].filter(id => was.has(id)),
    newly_passing: last ? [...was].filter(id => !now.has(id)) : []};
}

export async function voiceCmd(rest, flags) {
  if (getState('sandbox') === 'eval') throw invalid('in the eval sandbox: th eval end first');
  const answers = join(thDir(), 'work', 'voice-answers.json');
  if (!rest[0]) return out({suite: 'TONE', n: voiceFixtures().length, answers, task: voiceTask(answers),
    next: `Give the task, and nothing else, to a general-purpose subagent; then th eval voice check --file ${answers}.`});
  if (rest[0] !== 'check' || typeof flags.file !== 'string') throw invalid('usage: th eval voice [check --file <answers.json>]');
  let given;
  try { given = JSON.parse(readFileSync(flags.file, 'utf8')); } catch { throw invalid(`cannot read ${flags.file} as JSON`); }
  if (!Array.isArray(given)) throw invalid('the answers are a JSON array of {id, reply}');
  const replies = new Map(given.map(a => [a?.id, a?.reply]));
  const results = voiceFixtures().map(f => ({id: f.id, why: grade(f, replies.get(f.id))}));
  const failures = results.filter(r => r.why.length).map(r => r.id);
  const {data} = await request('GET', '/v1/evals/runs', {query: {limit: 100}});
  const last = [...(data.items ?? [])].filter(r => r.suite === 'TONE').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? null;
  let sha = 'unknown';
  try { sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repoRoot(), encoding: 'utf8', timeout: 3000}).trim(); } catch { /* not a clone */ }
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw invalid('cannot read the commit of mind/ (git rev-parse HEAD)');
  const run = {id: uuidv7(), suite: 'TONE', git_sha: sha, n: results.length, passed: results.length - failures.length, failures, skipped: []};
  await request('PUT', `/v1/evals/runs/${run.id}`, {body: run});
  out({suite: 'TONE', n: run.n, passed: run.passed, before: pair(last), failures: results.filter(r => r.why.length),
    diff: voiceDiff(last, failures)});
}
