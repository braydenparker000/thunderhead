#!/usr/bin/env node
// SessionStart hook (RUNTIME.md §6.1): give the session its laws, its role and its briefing.
//
// Claude Code adds a SessionStart hook command's plain stdout to the model's context, capped at
// 10,000 characters for each hook command on its own; the commands for one event run in parallel;
// over the cap the model gets a file path and a 2,000-character preview
// (https://code.claude.com/docs/en/hooks, read 2026-11-22). So .claude/settings.json runs this file
// five times, one piece each, every piece ≤ 9,500 characters and starting with a heading line that
// says what it is (the order they arrive in is not fixed):
//   laws      mind/CONSTITUTION.md, needing nothing from the Worker
//   brief 1   the claim (startup: th brief --claim; resume|clear|compact: th brief, no claim), the
//             env file, $TMPDIR/th/brief.md, then the Worker's answer to $TMPDIR/th/state/brief_parts.json,
//             and part 1 (or the error, already-live or night-done line)
//   role      the `## <name>` section of mind/ROLES.md: the answer's role_section, else TH_ROLE's;
//             then the voice page the answer carries (`voice`), under `## How you talk`
//   brief 2|3 their part, or nothing when the answer has none
// role and brief 2|3 wait for that state file (written after their own start), and give up
// silently at 27 s; after a failed claim only brief 1 speaks. A Worker without `parts` gets the old
// `core` cut to fit from brief 1, and nothing from brief 2|3. `$CLAUDE_ENV_FILE` gets
// TH_SESSION_CLAIMED, TH_WAKE_ID and mind/bin on PATH, so `th …` works in later Bash calls. Every
// command exits 0, and with TH_ROLE unset none does anything at all.
import {appendFileSync} from 'node:fs';
import {CORE_CAP, truncateBriefing} from '../cli/lib/brief.mjs';
import {getState, setState, writeThFile} from '../cli/lib/state.mjs';
import {BIN_DIR, readInput, runTh, thErrorCode} from './lib/hook-io.mjs';
import {constitutionText, roleText} from './lib/laws.mjs';

const STARTED = Date.now();
const EXIT_ALREADY_LIVE = 11;
const STATE_KEY = 'brief_parts';
/** A state file counts when written after this command started, less a little for clocks between
 * processes started together (a compaction comes minutes after the last briefing, never seconds). */
const SLACK_MS = 3_000;
const WAIT_MS = Number(process.env.TH_HOOK_WAIT_MS) || 27_000;

// With TH_ROLE unset this is the owner's or a developer's own Claude Code session, not the mind:
// do nothing at all (RUNTIME.md §6), so no failed briefing is ever injected there.
if (!process.env.TH_ROLE) process.exit(0);
const role = process.env.TH_ROLE;
const [mode = 'brief', which = '1'] = process.argv.slice(2);

/** One piece to stdout: its heading line, then the text, the whole ≤ CORE_CAP. */
const print = (heading, text) => process.stdout.write(`${`${heading}\n${text}`.slice(0, CORE_CAP - 1)}\n`);

/** The state file brief 1 wrote for this start, or null after WAIT_MS. */
async function waitForAnswer() {
  const until = STARTED + WAIT_MS;
  for (;;) {
    const s = getState(STATE_KEY);
    if (s && typeof s.at === 'number' && s.at >= STARTED - SLACK_MS) return s;
    if (Date.now() >= until) return null;
    await new Promise(r => setTimeout(r, 100));
  }
}

/** brief 1: the claim and everything today's hook did, then the answer for the others. */
function briefOne() {
  const input = readInput() || {};
  const source = typeof input.source === 'string' ? input.source : 'startup';
  const claim = source === 'startup';
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const env = [`export PATH=${quote(BIN_DIR)}:"$PATH"`];
  const fail = code => `BRIEFING UNAVAILABLE (${code}). Before answering anything, run: th brief --claim. If that fails, run th status limited --error briefing and end.`;
  let text;
  let answer = {ok: false};
  const r = runTh(['brief', ...(claim ? ['--claim'] : []), '--json'], {timeoutMs: Number(process.env.TH_HOOK_TIMEOUT_MS) || 25_000});
  if (r.code === 0) {
    let data = null;
    try { data = JSON.parse(r.stdout); } catch { /* handled below */ }
    if (!data || typeof data.core !== 'string') {
      text = fail('bad_json');
    } else if (role === 'night' && data.night_done) {
      text = `Night work for ${data.day} is already done. End now.`;
    } else {
      const parts = Array.isArray(data.parts) ? data.parts.filter(p => typeof p === 'string' && p) : [];
      answer = {ok: true, parts, ...(typeof data.role_section === 'string' ? {role_section: data.role_section} : {}),
        ...(typeof data.voice === 'string' && data.voice.trim() ? {voice: data.voice} : {})};
      if (typeof data.full === 'string') { try { writeThFile('brief.md', data.full); } catch { /* th wrote it too */ } }
      if (claim) env.push('export TH_SESSION_CLAIMED=1');
      if (data.wake?.id) env.push(`export TH_WAKE_ID=${quote(data.wake.id)}`);
    }
  } else if (r.code === EXIT_ALREADY_LIVE) {
    text = 'Another chat session is live. End this session now.';
  } else {
    text = fail(r.timedOut ? 'timeout' : thErrorCode(r.stderr) || `exit_${r.code}`);
  }
  setState(STATE_KEY, {at: Date.now(), ...answer});
  const file = process.env.CLAUDE_ENV_FILE;
  if (file) { try { appendFileSync(file, env.map(l => `${l}\n`).join('')); } catch { /* best effort */ } }
  if (text !== undefined) return print('# Briefing', text);
  if (answer.parts.length) return print(`# Briefing, part 1 of ${answer.parts.length}`, answer.parts[0]);
  // A Worker on the previous release: its core, cut between whole sections to fit this piece.
  const heading = '# Briefing';
  let core;
  try { core = JSON.parse(r.stdout).core; } catch { core = ''; }
  print(heading, truncateBriefing(core, CORE_CAP - heading.length - 2));
}

async function main() {
  if (mode === 'laws') {
    const laws = constitutionText();
    if (laws) process.stdout.write(`${laws.slice(0, CORE_CAP - 1)}\n`);
    return;
  }
  if (mode === 'brief' && which === '1') return briefOne();
  if (mode !== 'role' && mode !== 'brief') return;
  const answer = await waitForAnswer();
  if (!answer?.ok) return;
  if (mode === 'role') {
    const named = typeof answer.role_section === 'string' ? roleText(answer.role_section) : '';
    const text = named || roleText(role);
    // The voice page (the site keeps it; `th voice`) rides with the role: how to talk beside what to do.
    const voice = typeof answer.voice === 'string' ? `\n\n## How you talk (the owner's page: th voice)\n${answer.voice}` : '';
    if (text || voice) print('# Your role (mind/ROLES.md)', `${text}${voice}`);
    return;
  }
  const n = Number(which);
  const part = Number.isInteger(n) && n >= 2 ? answer.parts?.[n - 1] : undefined;
  if (typeof part === 'string' && part) print(`# Briefing, part ${n} of ${answer.parts.length}`, part);
}

await main();
process.exitCode = 0;
