#!/usr/bin/env node
// PreToolUse hook: per-role deny rules from TH_ROLE (RUNTIME.md §6.4). The rules live in lib/rules.mjs;
// this file gives them what needs git or the Worker (a push's protected paths, the owner's approvals).
//
// Output format (Claude Code hooks reference, https://code.claude.com/docs/en/hooks, "PreToolUse
// decision control", read 2026-10-28): exit 0 with
//   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}
// denies the call and shows the reason to Claude. Exit 0 with no output leaves the normal permission
// flow in charge. We never return "ask" (an unattended run would stall waiting for a human).
// With TH_ROLE unset the hook does nothing: that is the owner's own Claude Code, not a mind session.
// If this file can't run at all (missing, or a crash before it answers), the command in
// .claude/settings.json exits 2 in a mind session, which blocks the call: the hook fails closed.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {decide, isProtected} from './lib/rules.mjs';
import {allowedHosts, readInput, runTh} from './lib/hook-io.mjs';
import {getState} from '../cli/lib/state.mjs';

const real = path => { try { return realpathSync(path); } catch { return path; } };
const git = (cwd, args) => execFileSync('git', args, {cwd, encoding: 'utf8', timeout: 3000}).trim();

/** The commit `rev` grows from: where it meets origin/main, else `rev` itself. */
function base(cwd, rev = 'HEAD') {
  try { return git(cwd, ['merge-base', rev, 'origin/main']); } catch { return git(cwd, ['rev-parse', rev]); }
}

/** Each source a push sends (HEAD when it names none): its base and the protected paths it changes.
 * Renames count as both paths (--no-renames); a source git can't resolve denies the push. */
function pushProtected(cwd, sources) {
  const ctx = {cwd, projectDir: process.env.CLAUDE_PROJECT_DIR || cwd};
  return (sources.length ? sources : ['HEAD']).map(src => {
    let sha;
    try { sha = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${src}^{commit}`]); } catch { throw new Error(`the push source ${src} can't be resolved`); }
    const b = base(cwd, sha);
    const paths = git(cwd, ['diff', '--no-renames', '--name-only', `${b}..${sha}`]).split('\n').filter(p => p && isProtected(p, ctx));
    return {base: b, paths};
  });
}

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
        headSubject: () => git(cwd, ['log', '-1', '--format=%s']),
        tainted: Boolean(getState('tainted') || getState('taint_pending')),
        // A `repo.change` card the owner approved for these paths and that base (this branch's by default).
        approved: (paths, b) => runTh(['approved', '--paths', paths.join(','), '--sha', b ?? base(cwd)], {timeoutMs: 8_000}).code === 0,
        pushProtected: sources => pushProtected(cwd, sources),
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
