#!/usr/bin/env node
// PreToolUse hook: per-role deny rules from TH_ROLE (RUNTIME.md §6.4). The rules live in lib/rules.mjs.
//
// Output format (Claude Code hooks reference, https://code.claude.com/docs/en/hooks, "PreToolUse
// decision control", read 2026-10-28): exit 0 with
//   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}
// denies the call and shows the reason to Claude. Exit 0 with no output leaves the normal permission
// flow in charge. We never return "ask" (an unattended run would stall waiting for a human).
// With TH_ROLE unset the hook does nothing: that is the owner's own Claude Code, not a mind session.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {decide} from './lib/rules.mjs';
import {allowedHosts, readInput} from './lib/hook-io.mjs';

const real = path => { try { return realpathSync(path); } catch { return path; } };

const input = readInput();
const role = process.env.TH_ROLE || '';
let reason = null;
if (role) {
  if (input === null) reason = 'The pre-tool hook could not read its input, so the call is denied.';
  else {
    const cwd = input.cwd || process.cwd();
    try {
      reason = decide(input, {
        role, cwd,
        projectDir: process.env.CLAUDE_PROJECT_DIR || cwd,
        tmpDir: real(tmpdir()),
        allowedHosts: allowedHosts(),
        headSubject: () => execFileSync('git', ['log', '-1', '--format=%s'], {cwd, encoding: 'utf8', timeout: 3000}).trim(),
      });
    } catch (error) {
      reason = `The pre-tool hook failed (${error?.message || error}), so the call is denied.`;
    }
  }
}
if (reason) {
  process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason}}) + '\n');
}
process.exitCode = 0;
