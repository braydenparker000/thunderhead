// Shared plumbing for the Claude Code hooks: read the event JSON from stdin, run `th` as a child
// process (so its proxy re-exec and exit codes apply exactly as in the session), and list the
// hosts the environment allows.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const TH_PATH = fileURLToPath(new URL('../../cli/th.mjs', import.meta.url));
export const BIN_DIR = fileURLToPath(new URL('../../bin', import.meta.url));

/** The hook's input JSON; `null` when stdin is not valid JSON. */
export function readInput() {
  let text = '';
  try { text = readFileSync(0, 'utf8'); } catch { return {}; }
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Runs th with the given arguments.
 * @returns {{code: number|null, stdout: string, stderr: string, timedOut: boolean}}
 */
export function runTh(args, {timeoutMs = 25_000} = {}) {
  const r = spawnSync(process.execPath, [TH_PATH, ...args], {encoding: 'utf8', timeout: timeoutMs, env: process.env});
  return {code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM'};
}

/** The error code th printed on stderr (`{"error":{"code":…}}`), if any. */
export function thErrorCode(stderr) {
  for (const line of String(stderr).split('\n').reverse()) {
    try { const code = JSON.parse(line)?.error?.code; if (code) return String(code); } catch { /* not JSON */ }
  }
  return null;
}

/** Hosts the environment's network list allows: the Worker, the site, GitHub's API, plus TH_ALLOWED_HOSTS. */
export function allowedHosts(env = process.env) {
  const hosts = ['api.github.com'];
  for (const url of [env.TH_API, env.TH_SITE]) {
    try { if (url) hosts.push(new URL(url).hostname.toLowerCase()); } catch { /* ignore a bad URL */ }
  }
  for (const h of String(env.TH_ALLOWED_HOSTS || '').split(',')) if (h.trim()) hosts.push(h.trim().toLowerCase());
  return hosts;
}

/** The Worker's and the site's hosts: text from them is the owner's own (lib/taint.mjs). */
export function ownHosts(env = process.env) {
  const hosts = [];
  for (const url of [env.TH_API, env.TH_SITE]) {
    try { if (url) hosts.push(new URL(url).hostname.toLowerCase()); } catch { /* ignore a bad URL */ }
  }
  return hosts;
}
