#!/usr/bin/env node
// Whether Test (.github/workflows/ci.yml, the checks in checks.yml) already passed on exactly the files
// Deploy is about to put live, so Deploy's job `tested` can skip running them again. The commit Test ran
// on is the pull request's head: a merge's second parent, or the pushed commit itself. It counts only
// when its tree is this commit's tree (the same files) and GitHub reports a completed, successful Test
// run on it that ran every suite: Test's job `record` is named SCOPE_JOB only when its `scope` found no
// lab or Astra narrowing (scripts/lab-scope.mjs), and a run without that job (a narrowed run, or one from
// before 2026-11-21) does not count. Prints `tested` or `untested` (the reason goes to stderr); any error
// or doubt is `untested`.
// Usage: GH_TOKEN=… GITHUB_REPOSITORY=<owner>/<repo> node scripts/tree-tested.mjs [commit]   (default HEAD)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WORKFLOW = 'ci.yml';
/** The name ci.yml gives its job `record` when the run checked every suite. */
export const SCOPE_JOB = 'Scope: full';

/** The commit Test ran on, from `git rev-list --parents -n 1 <commit>`; null for an octopus merge. */
export function headOf(line) {
  const [sha, ...parents] = line.trim().split(/\s+/);
  if (parents.length > 2) return null;
  return parents.length === 2 ? parents[1] : sha;
}

/** The ids of the completed, successful runs on `sha` whose tree is `tree`, from the API's list of runs. */
export function matching(answer, sha, tree) {
  const runs = Array.isArray(answer?.workflow_runs) ? answer.workflow_runs : [];
  return runs
    .filter((r) => r?.head_sha === sha && r.status === 'completed' && r.conclusion === 'success' && r.head_commit?.tree_id === tree)
    .map((r) => r.id);
}

/** True when the API's list of runs holds a completed, successful run on `sha` whose tree is `tree`. */
export const passed = (answer, sha, tree) => matching(answer, sha, tree).length > 0;

/** True when a run's jobs (the API's answer for one run) hold the successful SCOPE_JOB: the run checked every suite. */
export function fullScope(answer) {
  const jobs = Array.isArray(answer?.jobs) ? answer.jobs : [];
  return jobs.some((j) => j?.name === SCOPE_JOB && j.status === 'completed' && j.conclusion === 'success');
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
const git = (...args) => run('git', args);

/** [verdict, reason] for `commit`. */
function decide(commit) {
  const tree = git('rev-parse', `${commit}^{tree}`);
  const head = headOf(git('rev-list', '--parents', '-n', '1', commit));
  if (!head) return ['untested', 'a merge of more than two parents'];
  try {
    git('cat-file', '-e', `${head}^{commit}`);
  } catch {
    git('fetch', '--no-tags', '--depth=1', 'origin', head);
  }
  const headTree = git('rev-parse', `${head}^{tree}`);
  if (headTree !== tree) return ['untested', `${head} has another tree (${headTree}; this commit's is ${tree})`];
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return ['untested', 'GITHUB_REPOSITORY is not set'];
  const answer = JSON.parse(run('gh', ['api', `repos/${repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${head}&status=success&per_page=100`]));
  const ids = matching(answer, head, tree);
  if (!ids.length) return ['untested', `no completed, successful Test run on ${head} with tree ${tree}`];
  for (const id of ids) {
    if (!/^\d+$/.test(String(id))) continue;
    if (fullScope(JSON.parse(run('gh', ['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`])))) return ['tested', `Test passed on ${head}, tree ${tree}, every suite (run ${id})`];
  }
  return ['untested', `Test passed on ${head} only with a narrowed scope (no "${SCOPE_JOB}" job)`];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = decide(process.argv[2] ?? 'HEAD');
  } catch (e) {
    result = ['untested', `error: ${String(e?.message ?? e).split('\n')[0]}`];
  }
  console.error(`tree-tested: ${result[1]}`);
  console.log(result[0]);
}
