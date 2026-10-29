#!/usr/bin/env node
// PostToolUse hook (RUNTIME.md §6.5). 1. Taint: the first time the session takes in text the owner
// did not write (lib/taint.mjs), it calls `th taint` once; from then on the Worker refuses the
// session's memory writes and its ask-first cards. 2. Live progress: while the chat session reports
// `working`, a Bash call's description becomes the presence note, at most one every 3 s.
// It never blocks and prints nothing; with TH_ROLE unset (the owner's own Claude Code) it does nothing.
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {readInput, runTh} from './lib/hook-io.mjs';
import {taintOf} from './lib/taint.mjs';
import {getState, setState} from '../cli/lib/state.mjs';

const PROGRESS_EVERY_MS = 3_000;
const real = path => { try { return realpathSync(path); } catch { return path; } };
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

const role = process.env.TH_ROLE || '';
const input = role ? readInput() : null;
if (input) {
  const ownHosts = [process.env.TH_API, process.env.TH_SITE].map(u => (u ? hostOf(u) : null)).filter(Boolean);
  const taint = getState('tainted') ? null : taintOf(input, {cwd: input.cwd || process.cwd(), tmpDir: real(tmpdir()), ownHosts});
  // The ref's kind is all the Worker hears (never the URL itself); th records the taint locally too.
  if (taint) runTh(['taint', '--source', taint.source, '--ref', taint.ref], {timeoutMs: 8_000});
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
