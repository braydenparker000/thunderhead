#!/usr/bin/env node
// Whether Test (.github/workflows/ci.yml, the checks in checks.yml) already passed on exactly the files
// Deploy is about to put live, so Deploy's job `tested` can skip running them again. The commit Test ran
// on is the pull request's head: a merge's second parent, or the pushed commit itself. It counts only
// when its tree is this commit's tree (the same files) and GitHub reports a completed, successful Test
// run on it. Prints `tested` or `untested` (the reason goes to stderr); any error or doubt is `untested`.
// Usage: GH_TOKEN=… GITHUB_REPOSITORY=<owner>/<repo> node scripts/tree-tested.mjs [commit]   (default HEAD)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WORKFLOW = 'ci.yml';

/** The commit Test ran on, from `git rev-list --parents -n 1 <commit>`; null for an octopus merge. */
export function headOf(line) {
  const [sha, ...parents] = line.trim().split(/\s+/);
  if (parents.length > 2) return null;
  return parents.length === 2 ? parents[1] : sha;
}

/** True when the API's list of runs holds a completed, successful run on `sha` whose tree is `tree`. */
export function passed(answer, sha, tree) {
  const runs = Array.isArray(answer?.workflow_runs) ? answer.workflow_runs : [];
  return runs.some(
    (r) => r?.head_sha === sha && r.status === 'completed' && r.conclusion === 'success' && r.head_commit?.tree_id === tree,
  );
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
  return passed(answer, head, tree)
    ? ['tested', `Test passed on ${head}, tree ${tree}`]
    : ['untested', `no completed, successful Test run on ${head} with tree ${tree}`];
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
