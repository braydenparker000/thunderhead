// The fake Worker's listening-pass routes (API.md §11.22), close enough to drive `th music`: a test
// puts jobs and one song's analysis in; next issues what the test queued; collect answers by the
// job's `collect` field. The real rules are the Worker's own tests (backend listen*.test.ts).
import {HttpError} from './fake-worker.mjs';

/** @param {any} ctl the fake's control object */
export function listenRoutes(ctl) {
  const s = ctl.state;
  s.jobs = [];
  /** What GET /v1/jobs/next gives, by kind, in turn: a job, or null for 204, or 'busy' for 409. */
  s.nextJobs = {'audio.analysis': [], 'audio.neighbours': []};
  s.analysis = {};
  return [
    ['GET', /^\/v1\/jobs$/, ['chat', 'night', 'reflex'], ({query}) =>
      ({items: s.jobs.filter(j => query.get('open') !== '1' || ['issued', 'validating'].includes(j.state))})],
    ['GET', /^\/v1\/jobs\/next$/, ['night'], ({query}) => {
      const kind = query.get('kind');
      if (!(kind in s.nextJobs)) throw new HttpError(422, 'validation');
      const next = s.nextJobs[kind].shift() ?? null;
      if (next === 'busy') throw new HttpError(409, 'conflict');
      if (!next) return [204, null];
      s.jobs.push({job_id: next.job_id, kind, state: 'issued', issued_at: ctl.now(), count: next.shas?.length ?? next.n});
      return next;
    }],
    ['POST', /^\/v1\/jobs\/([^/]+)\/collect$/, ['night'], ({params}) => {
      const j = s.jobs.find(x => x.job_id === params[0]);
      if (!j) throw new HttpError(404, 'not_found');
      if (j.collect === 'no_manifest') throw new HttpError(409, 'conflict');
      if (j.collect === 'expired') throw new HttpError(410, 'expired');
      if (j.collect === 'bad') throw new HttpError(422, 'invalid_result');
      j.state = 'validating';
      return [202, {state: 'validating'}];
    }],
    ['GET', /^\/v1\/music\/analysis\/([^/]+)$/, ['chat', 'night'], ({params, query}) => {
      const a = s.analysis[decodeURIComponent(params[0])];
      if (!a) throw new HttpError(404, 'not_found');
      const like = Number(query.get('like') ?? 10);
      return {...a, like: a.like.slice(0, like)};
    }],
  ];
}
