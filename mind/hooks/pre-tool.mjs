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
// It answers within 20 s, inside the 30 s settings.json gives it: a hook Claude Code times out is a
// non-blocking error, and the call would go ahead.
//
// An allowed call that may bring in outside text (lib/taint.mjs) marks the session `taint_pending`
// before it runs; the PostToolUse hook then sends `th taint`. A call that fails gets no PostToolUse,
// so without this its output would arrive untainted (RUNTIME.md §6.5).
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {decide, protectedRel} from './lib/rules.mjs';
import {allowedHosts, ownHosts, readInput, runTh} from './lib/hook-io.mjs';
import {taintOf} from './lib/taint.mjs';
import {getState, setState} from '../cli/lib/state.mjs';

const DEADLINE = Date.now() + 20_000;
const left = ms => {
  const t = Math.min(ms, DEADLINE - Date.now());
  if (t <= 0) throw new Error('it ran out of time');
  return t;
};
const real = path => { try { return realpathSync(path); } catch { return path; } };
const git = (cwd, args, ms = 3000) =>
  execFileSync('git', args, {cwd, encoding: 'utf8', timeout: left(ms), stdio: ['ignore', 'pipe', 'ignore']}).trim();

/** The commit `rev` grows from on this checkout's origin/main, else `rev` itself (for edits: th approved matches it to a card). */
function base(cwd, rev = 'HEAD') {
  try { return git(cwd, ['merge-base', rev, 'origin/main']); } catch { return git(cwd, ['rev-parse', rev]); }
}

/** main as the push's remote has it, asked of the remote (a session can move its own origin/main); it must be fetched. */
function remoteMain(dir, remote) {
  const where = remote || 'the default remote';
  const line = git(dir, ['ls-remote', '--heads', ...(remote ? [remote] : [])], 8000).split('\n').find(l => l.endsWith('\trefs/heads/main'));
  const sha = line?.split('\t')[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${where} has no main branch`);
  try { git(dir, ['cat-file', '-e', `${sha}^{commit}`]); } catch { throw new Error(`main on ${where} (${sha.slice(0, 12)}) isn't fetched: git fetch, then push again`); }
  return sha;
}

/** Each source a push sends (HEAD when it names none): its base on the remote's main and the
 * protected paths its commits change (renames count as both paths). Anything unknown throws, which denies. */
function pushProtected(cwd, push) {
  const dir = push.dir ? resolve(cwd, push.dir) : cwd;
  if (push.implicit) {
    // With no refspec, git's config decides what goes: only the plain defaults (HEAD to its branch) pass.
    let cfg = '';
    try { cfg = git(dir, ['config', '--get-regexp', '^(push\\.default|remote\\.pushdefault|remote\\..*\\.push|branch\\..*\\.pushremote)$']); } catch { /* none set */ }
    if (cfg.split('\n').some(l => l && !/^push\.default (simple|current|upstream|tracking)$/i.test(l)))
      throw new Error('git config changes what a bare push sends; name the remote and the branch (git push origin <branch>)');
  }
  const main = remoteMain(dir, push.remote);
  return (push.sources.length ? push.sources : ['HEAD']).map(src => {
    let sha, b;
    try { sha = git(dir, ['rev-parse', '--verify', '--quiet', `${src}^{commit}`]); } catch { throw new Error(`the push source ${src} can't be resolved`); }
    try { b = git(dir, ['merge-base', sha, main]); } catch { throw new Error(`${src} shares no history with main`); }
    // Plumbing, NUL-separated: no diff.relative, no quoted names, no rename detection.
    const paths = git(dir, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', b, sha]).split('\0').filter(p => p && protectedRel(p));
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
    const tmpDir = real(tmpdir());
    const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
    try {
      reason = decide(input, {
        role, cwd, projectDir, tmpDir,
        allowedHosts: allowedHosts(),
        headSubject: () => git(cwd, ['log', '-1', '--format=%s']),
        // A `repo.change` card the owner approved for these paths and that base (this branch's by default).
        approved: (paths, b) => runTh(['approved', '--paths', paths.join(','), '--sha', b ?? base(cwd)], {timeoutMs: left(8_000)}).code === 0,
        pushProtected: push => pushProtected(cwd, push),
      });
    } catch (error) {
      reason = `The pre-tool hook failed (${error?.message || error}), so the call is denied.`;
    }
    if (!reason && !getState('tainted') && !getState('taint_pending')) {
      let taint;
      try { taint = taintOf(input, {cwd, projectDir, tmpDir, ownHosts: ownHosts()}); } catch { taint = {source: 'hook', ref: ''}; }
      if (taint) setState('taint_pending', {...taint, at: Date.now()});
    }
  }
}
if (reason) {
  process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason}}) + '\n');
}
process.exitCode = 0;
