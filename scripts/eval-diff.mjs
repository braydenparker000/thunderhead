// CI's check of a weekly improvement branch (`claude/weekly-*`; EVALS.md §7, RA-P9-02): the files it
// changes against main, the "evals:" line in its commit messages, and the Worker's eval record
// (read with the ci key), judged by mind/cli/lib/evaldiff.mjs. Prints numbers and file names only.
// Usage: TH_CI_TOKEN=… WORKER_URL=… node scripts/eval-diff.mjs --base origin/main
import { execFileSync } from 'node:child_process';
import { verdict } from '../mind/cli/lib/evaldiff.mjs';

const base = process.argv[process.argv.indexOf('--base') + 1] || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const paths = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const message = git('log', '--format=%B', `${base}..HEAD`);
const { TH_CI_TOKEN: token, WORKER_URL: worker } = process.env;
if (!token || !worker) {
  console.error('::error::TH_CI_TOKEN and WORKER_URL are needed to read the eval record');
  process.exit(1);
}
const res = await fetch(`${worker.replace(/\/$/, '')}/v1/evals/runs?limit=100`, {
  headers: { authorization: `Bearer ${token}`, 'TH-Client': 'ci/eval-diff' },
});
if (!res.ok) {
  console.error(`::error::the eval record answered ${res.status}`);
  process.exit(1);
}
const { items: runs } = await res.json();
const why = verdict({ paths, message, runs });
for (const w of why) console.error(`::error::${w}`);
console.log(why.length ? 'The weekly change may not ship.' : 'The eval diff is non-negative and the evals are untouched.');
process.exit(why.length ? 1 : 0);
