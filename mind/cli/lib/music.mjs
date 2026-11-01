// `th music analysis <track id>`, `th music like <track id> [--n 10]`, `th music jobs [--max 500]`
// (RUNTIME.md §5.3, §12 step 6): how one song sounds and the songs nearest it, from the listening pass
// (GET /v1/music/analysis/:id), and the night's part of that pass. `jobs` collects any job an Actions
// run left uncollected (issued over 6 hours ago), asks for the next one (up to 500 songs; once every
// song is analysed, the neighbours step) and dispatches .github/workflows/jobs-audio.yml with the job's
// id only, through the GitHub CLI and the session's own GitHub access. It prints counts, the kind and
// the id, never a song's hash.
//
//   analysis → {"id","state","analysis":{bpm,key,camelot,energy,valence,arousal,vocals,moods,top_moods,…}}
//   like     → {"id","like":[{id,title,artist,sim}],"like_at"}
//   jobs     → {"collected":{state: n},"issued":{"kind","job_id","count"}|null,"dispatched":bool,"reason"?}
import {spawnSync} from 'node:child_process';
import {parseArgs} from './args.mjs';
import {repoOf} from './ci.mjs';
import {CONTRACT} from './contract.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';

const seg = (value) => encodeURIComponent(String(value));
const LIMITS = CONTRACT.listen?.limits ?? {max_tracks: 500, like_max: 50};
const USAGE = 'usage: th music analysis <track id> | like <track id> [--n 10] | jobs [--max 500]';
/** A job issued this long ago with no collect yet: its run is over (it takes at most 5 hours). */
const COLLECT_AFTER_MS = 6 * 60 * 60 * 1000;

/** Dispatches the workflow for one job; true when GitHub took it. */
export function dispatch(jobId, {run = spawnSync, gh = process.env.TH_GH || 'gh', repo} = {}) {
  const r = run(gh, ['workflow', 'run', 'jobs-audio.yml', '--ref', 'main', '-f', `job_id=${jobId}`, '-R', repo ?? repoOf()],
    {encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'ignore', 'ignore']});
  return r.status === 0;
}

/** Collects the jobs whose runs are over; how each ended, by state. */
async function collectOpen(now) {
  const {data} = await request('GET', '/v1/jobs', {query: {open: 1}});
  const counts = {};
  for (const j of data.items ?? []) {
    if (j.state !== 'issued' || now - j.issued_at < COLLECT_AFTER_MS) continue;
    let state;
    try {
      state = (await request('POST', `/v1/jobs/${seg(j.job_id)}/collect`, {body: {}})).data.state ?? 'validating';
    } catch (e) {
      // 409 no manifest yet (the run failed or still runs: it expires on its own), 410 expired, 422 rejected.
      state = {conflict: 'waiting', expired: 'expired', invalid_result: 'rejected'}[e.code];
      if (!state) throw e;
    }
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}

/** The next job: analysis first, the neighbours step once nothing waits for analysis. */
async function nextJob(max) {
  for (const query of [{kind: 'audio.analysis', max}, {kind: 'audio.neighbours'}]) {
    let res;
    try {
      res = await request('GET', '/v1/jobs/next', {query});
    } catch (e) {
      if (e.code === 'conflict') return {busy: true};
      throw e;
    }
    if (res.status === 200 && res.data?.job_id)
      return {kind: res.data.kind, job_id: res.data.job_id, count: res.data.shas?.length ?? res.data.n ?? 0};
  }
  return null;
}

/** @param {string[]} argv @param {{run?: typeof spawnSync, now?: () => number, repo?: string}} [deps] */
export async function music(argv, deps = {}) {
  const [sub, ...tail] = argv;
  const {flags, rest} = parseArgs(tail);
  if (sub === 'analysis' || sub === 'like') {
    if (rest.length !== 1) throw invalid(USAGE);
    const n = flags.n === undefined ? 10 : Number(flags.n);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.like_max) throw invalid(`--n must be 1-${LIMITS.like_max}`);
    const {data} = await request('GET', `/v1/music/analysis/${seg(rest[0])}`, {query: {like: sub === 'like' ? n : 0}});
    if (sub === 'analysis') out({id: data.id, state: data.state, analysis: data.analysis});
    else out({id: data.id, like: data.like, like_at: data.like_at});
    return;
  }
  if (sub !== 'jobs' || rest.length) throw invalid(USAGE);
  const max = flags.max === undefined ? LIMITS.max_tracks : Number(flags.max);
  if (!Number.isInteger(max) || max < 1 || max > LIMITS.max_tracks) throw invalid(`--max must be 1-${LIMITS.max_tracks}`);
  const collected = await collectOpen((deps.now ?? Date.now)());
  const next = await nextJob(max);
  if (!next || next.busy) {
    out({collected, issued: null, dispatched: false, ...(next?.busy ? {reason: 'open_jobs'} : {})});
    return;
  }
  const ok = dispatch(next.job_id, {run: deps.run, repo: deps.repo});
  // Not taken: the job expires in 72 hours and its songs are offered again.
  out({collected, issued: next, dispatched: ok, ...(ok ? {} : {reason: 'dispatch_refused'})});
}
