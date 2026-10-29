#!/usr/bin/env node
// SessionStart hook (RUNTIME.md §6.1): brief the session.
//
// Claude Code adds a SessionStart hook's plain stdout to the model's context, capped at 10,000
// characters; over the cap it saves the text to a file and shows only a 2,000-character preview
// (https://code.claude.com/docs/en/hooks, "SessionStart" and the output cap, read 2026-10-28).
// So the core is re-capped here at 9,500 characters, cutting only between whole sections.
//
// startup            → th brief --claim (binds the wake)
// resume|clear|compact|fork → th brief (fresh core, no claim)
// The full briefing goes to $TMPDIR/th/brief.md. `$CLAUDE_ENV_FILE` gets TH_SESSION_CLAIMED, TH_WAKE_ID
// and mind/bin on PATH, so `th …` works in later Bash calls. The hook always exits 0, and with
// TH_ROLE unset it does nothing at all.
import {appendFileSync} from 'node:fs';
import {CORE_CAP, truncateBriefing} from '../cli/lib/brief.mjs';
import {writeThFile} from '../cli/lib/state.mjs';
import {BIN_DIR, readInput, runTh, thErrorCode} from './lib/hook-io.mjs';

const EXIT_ALREADY_LIVE = 11;
// With TH_ROLE unset this is the owner's or a developer's own Claude Code session, not the mind:
// do nothing at all (RUNTIME.md §6), so no failed briefing is ever injected there.
if (!process.env.TH_ROLE) process.exit(0);
const input = readInput() || {};
const source = typeof input.source === 'string' ? input.source : 'startup';
const claim = source === 'startup';

/** @param {string[]} lines */
function exportEnv(lines) {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!file) return;
  try { appendFileSync(file, lines.map(l => `${l}\n`).join('')); } catch { /* best effort */ }
}

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
let text;
const r = runTh(['brief', ...(claim ? ['--claim'] : []), '--json'], {timeoutMs: Number(process.env.TH_HOOK_TIMEOUT_MS) || 25_000});
const env = [`export PATH=${quote(BIN_DIR)}:"$PATH"`];
if (r.code === 0) {
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* handled below */ }
  if (!data || typeof data.core !== 'string') {
    text = 'BRIEFING UNAVAILABLE (bad_json). Before answering anything, run: th brief --claim. If that fails, run th status limited --error briefing and end.';
  } else if (process.env.TH_ROLE === 'night' && data.night_done) {
    text = `Night work for ${data.day} is already done. End now.`;
  } else {
    text = truncateBriefing(data.core, CORE_CAP - 1); // stdout is text + '\n' ≤ 9,500
    if (typeof data.full === 'string') { try { writeThFile('brief.md', data.full); } catch { /* th wrote it too */ } }
    if (claim) env.push('export TH_SESSION_CLAIMED=1');
    if (data.wake?.id) env.push(`export TH_WAKE_ID=${quote(data.wake.id)}`);
  }
} else if (r.code === EXIT_ALREADY_LIVE) {
  text = 'Another chat session is live. End this session now.';
} else {
  const code = r.timedOut ? 'timeout' : thErrorCode(r.stderr) || `exit_${r.code}`;
  text = `BRIEFING UNAVAILABLE (${code}). Before answering anything, run: th brief --claim. If that fails, run th status limited --error briefing and end.`;
}
exportEnv(env);
process.stdout.write(`${text}\n`);
process.exitCode = 0;
