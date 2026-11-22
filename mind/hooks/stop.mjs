#!/usr/bin/env node
// Stop hook, bounded (RUNTIME.md §6.2): keeps a chat session from ending while an owner message is
// unanswered or no listener runs, and a reflex session while a tripped watchdog that wakes it has
// no report (`th handled`), at most 3 times in a row: every allowed stop resets the count, so a
// session that later stalls again can still be held.
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
// 1. allow: role ≠ chat (including TH_ROLE unset: not a mind session, so no output at all); the
//    local mark `closed` (th listen, th reply or th wait closed the session at the idle cut-off);
//    th pending fails (never trap a session we can't see); stop, day_closed or limited (also the
//    local mark StopFailure leaves); 3 blocks in a row already used (counted here, in
//    $TMPDIR/th/state/, and reset by every allowed stop).
// 2. block: an owner message is unanswered.
// 3. allow: a running background shell task is `th wait` or `th listen`, or the idle cut-off passed.
// 4. block: no listener runs. No session note is needed to end (owner, 2026-11-22).
import {getState, setState} from '../cli/lib/state.mjs';
import {readInput, runTh} from './lib/hook-io.mjs';

export const MAX_BLOCKS = 3;
const input = readInput() || {};
const env = process.env;
const blocksKey = () => `stop_blocks_${String(input.session_id || 'session').replace(/[^A-Za-z0-9_-]/g, '_')}`;
const allow = () => {
  if (env.TH_ROLE === 'chat' || env.TH_ROLE === 'reflex') setState(blocksKey(), 0); // consecutive, not per session
  process.exitCode = 0;
};
const block = reason => { process.stdout.write(JSON.stringify({decision: 'block', reason}) + '\n'); process.exitCode = 0; };

/** True if some background shell task is a running `th wait` or `th listen`; null when Claude Code sent no task list. */
function listenerRunning(tasks) {
  if (!Array.isArray(tasks)) return null;
  return tasks.some(t => t?.type === 'shell' && t?.status === 'running' && /(^|[\s/])th(\.mjs)?\s+(wait|listen)\b/.test(String(t?.command ?? '')));
}

/** API.md: pending carries idle_min and idle_cutoff_min. A Worker without them falls back to local state and 45 min. */
function idleMinutes(pending) {
  if (Number.isFinite(pending.idle_min)) return pending.idle_min;
  const since = getState('last_owner_at') ?? getState('claimed_at');
  return since ? (Date.now() - Number(since)) / 60_000 : 0;
}
const cutoffMinutes = pending => (Number.isFinite(pending.idle_cutoff_min) ? pending.idle_cutoff_min : 45);

/** The StopFailure hook's mark: usage limits count for 6 h, other API errors for 5 min. */
function recentlyLimited() {
  const mark = getState('limited');
  if (!mark?.at) return false;
  const ttl = ['rate_limit', 'billing_error'].includes(mark.error) ? 6 * 3_600_000 : 5 * 60_000;
  return Date.now() - mark.at < ttl;
}

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
  if (getState('closed') === true) return allow();
  const r = runTh(['pending'], {timeoutMs: Number(env.TH_HOOK_TIMEOUT_MS) || 15_000});
  if (r.code !== 0) return allow();
  let pending;
  try { pending = JSON.parse(r.stdout); } catch { return allow(); }
  if (pending.stop || pending.day_closed || pending.limited || recentlyLimited()) return allow();

  const key = blocksKey();
  const used = Number(getState(key, 0)) || 0;
  if (used >= MAX_BLOCKS) return allow();

  let reason = null;
  const unanswered = Array.isArray(pending.unanswered) ? pending.unanswered : [];
  if (unanswered.length) reason = `Owner message ${unanswered.at(-1)} is unanswered. Answer it: th reply.`;
  else if (listenerRunning(input.background_tasks) === false && idleMinutes(pending) < cutoffMinutes(pending)) {
    reason = 'No listener is running. Run th listen, or th wait in the background.';
  }
  if (!reason) return allow();
  setState(key, used + 1);
  return block(reason);
}

run();
