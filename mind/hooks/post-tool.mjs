#!/usr/bin/env node
// PostToolUse hook (RUNTIME.md §6.5). 1. Taint: the first time the session may have taken in text
// the owner did not write (lib/taint.mjs: every call but a short list of plainly local ones), it
// calls `th taint` once; from then on the Worker refuses the session's memory writes and its
// ask-first cards. 2. Live progress: while the chat session reports `working`, a Bash call's
// description becomes the presence note, at most one every 3 s.
// It never blocks and prints nothing; with TH_ROLE unset (the owner's own Claude Code) it does nothing.
//
// The taint fails closed: `taint_pending` is in th's state before `th taint` runs (the PreToolUse
// hook usually set it already), and only a `th taint` that got through clears it. So when th fails,
// times out, or this hook breaks or is killed, it stays, and th sends the taint before its next
// write. If this file can't run at all, the command in .claude/settings.json writes it.
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {ownHosts, readInput, runTh} from './lib/hook-io.mjs';
import {taintOf} from './lib/taint.mjs';
import {getState, setState} from '../cli/lib/state.mjs';

const PROGRESS_EVERY_MS = 3_000;
const real = path => { try { return realpathSync(path); } catch { return path; } };
const pending = taint => { if (!getState('taint_pending')) setState('taint_pending', {...taint, at: Date.now()}); };

const role = process.env.TH_ROLE || '';
const input = role ? readInput() : null;
if (role) {
  try {
    if (input === null) pending({source: 'hook', ref: ''});
    else run(input);
  } catch {
    if (!getState('tainted')) pending({source: 'hook', ref: ''});
  }
}

function run(input) {
  const cwd = input.cwd || process.cwd();
  const taint = getState('tainted') ? null : taintOf(input, {cwd, projectDir: process.env.CLAUDE_PROJECT_DIR || cwd, tmpDir: real(tmpdir()), ownHosts: ownHosts()});
  if (taint) {
    pending(taint);
    // The ref's kind is all the Worker hears (never the URL itself); th records the taint locally too.
    runTh(['taint', '--source', taint.source, '--ref', taint.ref], {timeoutMs: 8_000});
  }
  const description = input.tool_name === 'Bash' ? String(input.tool_input?.description ?? '').trim() : '';
  if (role === 'chat' && description && getState('status')?.state === 'working') {
    const last = getState('progress_at', 0);
    if (Date.now() - last >= PROGRESS_EVERY_MS) {
      setState('progress_at', Date.now());
      runTh(['status', 'working', '--note', description.slice(0, 140)], {timeoutMs: 8_000});
    }
  }
}
process.exitCode = 0;
