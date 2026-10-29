#!/usr/bin/env node
// Stop hook, bounded (RUNTIME.md §6.2): keeps a chat session from ending while an owner message is
// unanswered or no background `th wait` is running, and a reflex session while a tripped watchdog
// that wakes it has no report (`th handled`), at most 3 times per session.
//
// Format (Claude Code hooks reference, https://code.claude.com/docs/en/hooks, "Stop input" and
// "Stop decision control", read 2026-10-28):
// - input: common fields (session_id, cwd, …) plus stop_hook_active, last_assistant_message,
//   background_tasks [{id, type: "shell"|…, status, description, command}] and session_crons;
// - block: exit 0 with {"decision":"block","reason":"…"} (reason is required and is shown to Claude);
// - allow: exit 0 with no output. Claude Code also caps consecutive continuations at 8; ours is 3.
//
// Decision, in order (reflex: allow when th reflex fails or after 3 blocks; block while its
// `unreported` list isn't empty; else allow):
// 1. allow: role ≠ chat (including TH_ROLE unset: not a mind session, so no output at all); th pending
//    fails (never trap a session we can't see); stop, day_closed or limited (also the local mark
//    StopFailure leaves); 3 blocks already used (counted here, in $TMPDIR/th/state/); past the idle
//    cutoff (the Worker's idle_min ≥ idle_cutoff_min) with a session note written.
// 2. block: an owner message is unanswered.
// 3. block: no running shell task runs `th wait`, and the idle cutoff hasn't passed.
// 4. allow.
import {getState, setState} from '../cli/lib/state.mjs';
import {readInput, runTh} from './lib/hook-io.mjs';

export const MAX_BLOCKS = 3;
const input = readInput() || {};
const env = process.env;

const allow = () => { process.exitCode = 0; };
const block = reason => { process.stdout.write(JSON.stringify({decision: 'block', reason}) + '\n'); process.exitCode = 0; };

/** True if some background shell task is a running `th wait`; null when Claude Code sent no task list. */
function waitRunning(tasks) {
  if (!Array.isArray(tasks)) return null;
  return tasks.some(t => t?.type === 'shell' && t?.status === 'running' && /(^|[\s/])th(\.mjs)?\s+wait\b/.test(String(t?.command ?? '')));
}

/** API.md: pending carries idle_min and idle_cutoff_min. A Worker without them falls back to local state and 120 min. */
function idleMinutes(pending) {
  if (Number.isFinite(pending.idle_min)) return pending.idle_min;
  const since = getState('last_owner_at') ?? getState('claimed_at');
  return since ? (Date.now() - Number(since)) / 60_000 : 0;
}
const cutoffMinutes = pending => (Number.isFinite(pending.idle_cutoff_min) ? pending.idle_cutoff_min : 120);

/** The StopFailure hook's mark: usage limits count for 6 h, other API errors for 5 min. */
function recentlyLimited() {
  const mark = getState('limited');
  if (!mark?.at) return false;
  const ttl = ['rate_limit', 'billing_error'].includes(mark.error) ? 6 * 3_600_000 : 5 * 60_000;
  return Date.now() - mark.at < ttl;
}

const blocksKey = () => `stop_blocks_${String(input.session_id || 'session').replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** Reflex: every tripped watchdog that woke it gets a report before it ends. */
function reflexStop() {
  const r = runTh(['reflex'], {timeoutMs: Number(env.TH_HOOK_TIMEOUT_MS) || 15_000});
  if (r.code !== 0) return allow();
  let left;
  try { left = JSON.parse(r.stdout).unreported; } catch { return allow(); }
  if (!Array.isArray(left) || !left.length) return allow();
  const used = Number(getState(blocksKey(), 0)) || 0;
  if (used >= MAX_BLOCKS) return allow();
  setState(blocksKey(), used + 1);
  return block(`Watchdog ${left.join(', ')} has no report yet. Say what you did: th handled ${left[0]} --outcome fixed|reported|nothing --note "<what you saw and did>".`);
}

function run() {
  if (env.TH_ROLE === 'reflex') return reflexStop();
  if (env.TH_ROLE !== 'chat') return allow();
  const r = runTh(['pending'], {timeoutMs: Number(env.TH_HOOK_TIMEOUT_MS) || 15_000});
  if (r.code !== 0) return allow();
  let pending;
  try { pending = JSON.parse(r.stdout); } catch { return allow(); }
  if (pending.stop || pending.day_closed || pending.limited || recentlyLimited()) return allow();

  const key = blocksKey();
  const used = Number(getState(key, 0)) || 0;
  if (used >= MAX_BLOCKS) return allow();

  const pastCutoff = idleMinutes(pending) >= cutoffMinutes(pending);
  if (pastCutoff && getState('note_at')) return allow();

  let reason = null;
  const unanswered = Array.isArray(pending.unanswered) ? pending.unanswered : [];
  if (unanswered.length) reason = `Owner message ${unanswered[0]} is unanswered. Answer it with th say before ending.`;
  else if (waitRunning(input.background_tasks) === false && !pastCutoff) {
    reason = `No th wait is running. Start: th wait --minutes ${Number(env.TH_WAIT_MINUTES) || 24} (run_in_background), then end your turn.`;
  }
  if (!reason) return allow();
  setState(key, used + 1);
  return block(reason);
}

run();
