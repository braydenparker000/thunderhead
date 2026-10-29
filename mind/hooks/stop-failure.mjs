#!/usr/bin/env node
// StopFailure hook (RUNTIME.md §6.3): a turn ended on an API error. Claude Code ignores this hook's
// output and exit code (https://code.claude.com/docs/en/hooks, "StopFailure", read 2026-10-28); it is
// for reporting only. Input carries `error` (rate_limit, overloaded, billing_error, server_error, …).
// Reports `th status limited --error <error>` and leaves a local mark so the Stop hook never blocks.
import {setState} from '../cli/lib/state.mjs';
import {readInput, runTh} from './lib/hook-io.mjs';

// With TH_ROLE unset (not a mind session) it does nothing at all.
if (process.env.TH_ROLE) {
  const input = readInput() || {};
  const error = /^[a-z_]{1,40}$/.test(String(input.error ?? '')) ? input.error : 'unknown';
  setState('limited', {error, at: Date.now()});
  runTh(['status', 'limited', '--error', error], {timeoutMs: 8000});
}
process.exitCode = 0;
