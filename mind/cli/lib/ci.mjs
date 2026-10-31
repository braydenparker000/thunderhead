// `th ci <sha> [--workflow ci|deploy] [--card <message id>] [--minutes 40]` (RUNTIME.md §5.3): waits
// for GitHub Actions on one commit and says how it ended. The repository is public, so GitHub's
// public API answers without a token (60 calls an hour per address: a poll every 20 s, at most 45 an
// hour). Exit 0 passed, 1 failed, 3 still running when the time is up, 9 GitHub unreachable. With
// --card, a progress card (a message the session posted) is kept current as the run moves.
import {spawnSync} from 'node:child_process';
import {parseArgs} from './args.mjs';
import {EXIT, ThError, invalid, out} from './io.mjs';
import {request} from './http.mjs';

const seg = (value) => encodeURIComponent(String(value));
const POLL_MS = 20_000;
const FILE = {ci: 'ci.yml', deploy: 'deploy.yml'};

/** owner/repo from TH_REPO, else the git remote (a github.com URL or a proxy's …/owner/repo path). */
export function repoOf(env = process.env, remote = () => spawnSync('git', ['remote', 'get-url', 'origin'], {encoding: 'utf8'}).stdout ?? '') {
  if (env.TH_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.TH_REPO)) return env.TH_REPO;
  const m = /([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/.exec(remote());
  if (!m) throw invalid('no GitHub repository: set TH_REPO=owner/repo or run inside the clone');
  return `${m[1]}/${m[2]}`;
}

/** The run of `workflow` on `sha`, newest first, or null while GitHub has none yet. */
export async function runOf(repo, sha, workflow, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, {
      headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'thunderhead-th'},
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ThError(EXIT.unreachable, 'unreachable', 'GitHub did not answer (is api.github.com on this environment\'s network list?)');
  }
  if (res.status === 403 || res.status === 429) throw new ThError(EXIT.budget, 'budget', 'GitHub\'s hourly limit for this address is used up');
  if (!res.ok) throw new ThError(EXIT.unreachable, 'unreachable', `GitHub answered ${res.status}`);
  const runs = (await res.json()).workflow_runs ?? [];
  const mine = runs.filter((r) => String(r.path ?? '').endsWith(`/${FILE[workflow]}`));
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return mine[0] ?? null;
}

/** What a run's state reads as on the card and in the answer. */
export const stateOf = (run) => (!run ? 'waiting' : run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'passed' : 'failed');

/** @param {string[]} argv @param {{ fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number, repo?: string }} [deps] */
export async function ci(argv, deps = {}) {
  const {flags, rest} = parseArgs(argv);
  const sha = rest[0];
  const workflow = flags.workflow === undefined ? 'ci' : String(flags.workflow);
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !(workflow in FILE)) throw invalid('usage: th ci <40-hex commit> [--workflow ci|deploy] [--card <message id>] [--minutes 40]');
  const minutes = flags.minutes === undefined ? 40 : Number(flags.minutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw invalid('--minutes must be 1–120');
  const {fetch: f = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now} = deps;
  const repo = deps.repo ?? repoOf();
  const card = typeof flags.card === 'string' ? flags.card : null;
  const end = now() + minutes * 60_000;
  let shown = '';
  for (;;) {
    const run = await runOf(repo, sha, workflow, f);
    const state = stateOf(run);
    if (card && state !== shown) {
      shown = state;
      const words = {waiting: 'Waiting for GitHub to start', running: 'Running', passed: 'Passed', failed: 'Failed'}[state];
      await request('PATCH', `/v1/messages/${seg(card)}`, {body: {body: `${workflow === 'ci' ? 'Checks' : 'Deploy'} on ${sha.slice(0, 7)}: ${words}.`}});
    }
    if (state === 'passed' || state === 'failed') {
      out({state, url: run.html_url ?? null});
      return state === 'passed' ? EXIT.ok : EXIT.unexpected;
    }
    if (now() + POLL_MS > end) {
      out({state, url: run?.html_url ?? null});
      return EXIT.timeout;
    }
    await sleep(POLL_MS);
  }
}
