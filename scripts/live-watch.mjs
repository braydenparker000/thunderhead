#!/usr/bin/env node
// The live watch (.github/workflows/live-watch.yml): every 30 minutes the read-only live checks run against the
// site and the Worker, and this decides what the one issue "The live site check is failing" needs. Two failed runs
// in a row open it (or comment on the open one); a passing run closes it. The issue carries the failing checks'
// names and the run's link only (no person, never an address with a query, never a response body). It also says
// what the Worker should be told (`tell=down|up|none` in GITHUB_OUTPUT): the site failing twice running while the
// Worker answers, or the site passing again after a failed run; the Worker pushes the owner once each way.
// Usage: GH_TOKEN=… GH_REPO=<owner>/<repo> RUN_ID=… [SITE=… WORKER=…] node scripts/live-watch.mjs <tap file> <passed|failed>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TITLE = 'The live site check is failing';
export const WORKFLOW = 'live-watch.yml';

/** The names of the top-level checks a TAP report marks `not ok`, with any address cut to a plain word. */
export function failingChecks(tap) {
  const names = [];
  for (const line of String(tap).split('\n')) {
    const m = /^not ok \d+ - (.*?)(?: # .*)?$/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/\\#/g, '#').replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '(an address)').replace(/\?\S*/g, '').trim().slice(0, 200);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** What the issue needs: `open`, `comment`, `close` or `none`. `previous` is the conclusion of the run before this
 * one (`success`, `failure`, …, or null when unknown: counted as a failure, since a missed outage costs more than an
 * early issue). `open` is the open issue's number, or null. */
export function decide({ passed, previous, open }) {
  if (passed) return open ? 'close' : 'none';
  if (open) return 'comment';
  return previous === 'success' ? 'none' : 'open';
}

/** What the Worker should be told: `down` when the site failed twice running and the Worker answers (only GitHub can
 * tell when the Worker itself is down), `up` when the site passes after a run that failed (the Worker ignores an `up`
 * it was never told was down), else `none`. */
export function tell({ site, worker, previous }) {
  if (site === 'failed') return worker === 'passed' && previous !== 'success' ? 'down' : 'none';
  return site === 'passed' && previous !== null && previous !== 'success' ? 'up' : 'none';
}

/** The issue's text: the failing checks by name and the run's link. */
export function body(names, runUrl) {
  const list = names.length ? names.map((n) => `- ${n}`).join('\n') : '- (no check name was reported: the run failed before its checks)';
  return `The scheduled live check failed twice in a row.\n\nFailing checks:\n${list}\n\nRun: ${runUrl.split(/[?#]/)[0]}\n`;
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tapFile, verdict] = process.argv.slice(2);
  const repo = process.env.GH_REPO ?? '';
  const runId = process.env.RUN_ID ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(runId)) throw new Error('GH_REPO and RUN_ID must be set');
  const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${runId}`;
  let tap = '';
  try { tap = readFileSync(tapFile, 'utf8'); } catch {}
  let previous = null;
  try {
    const runs = JSON.parse(gh('api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=completed&per_page=10`)).workflow_runs ?? [];
    previous = runs.find((r) => String(r.id) !== runId)?.conclusion ?? null;
  } catch (e) { console.error(`live-watch: the run before is unknown (${String(e?.message ?? e).split('\n')[0]})`); }
  const word = tell({ site: process.env.SITE, worker: process.env.WORKER, previous });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tell=${word}\n`);
  console.log(`live-watch: tell the Worker: ${word}`);
  const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--search', `"${TITLE}" in:title`, '--json', 'number,title', '--limit', '20'));
  const open = issues.find((i) => i.title === TITLE)?.number ?? null;
  const action = decide({ passed: verdict === 'passed', previous, open });
  const file = join(process.env.RUNNER_TEMP || tmpdir(), 'live-watch-body.md');
  writeFileSync(file, action === 'close' ? `The live check passes again.\n\nRun: ${runUrl}\n` : body(failingChecks(tap), runUrl));
  if (action === 'open') gh('issue', 'create', '--title', TITLE, '--body-file', file);
  else if (action === 'comment') gh('issue', 'comment', String(open), '--body-file', file);
  else if (action === 'close') gh('issue', 'close', String(open), '--comment', readFileSync(file, 'utf8'));
  console.log(`live-watch: ${verdict}, the run before: ${previous ?? 'unknown'}, issue: ${open ?? 'none'} → ${action}`);
}
