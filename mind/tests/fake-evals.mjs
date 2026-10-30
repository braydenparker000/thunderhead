// The fake Worker's eval routes (EVALS.md §1.1, §8): a sandbox that counts its resets and keeps the
// write requests made with `TH-Sandbox: eval` (by route pattern, as the Worker records them), and
// the eval record. Enough to drive `th eval` end to end; the real rules are the Worker's own tests.
const HOUSEKEEPING = ['POST /v1/mind/brief', 'POST /v1/mind/status', 'POST /v1/mind/taint', 'POST /v1/mind/notes', 'POST /v1/evals/sandbox'];
const pattern = path => path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/g, '/:id');

/** @param {any} ctl the fake's control object */
export function evalRoutes(ctl) {
  const s = ctl.state;
  s.sandbox = {resets: 0, seed: null, attempts: [], ledger: {}};
  s.evalRuns = new Map();
  /** Called for every request: a sandbox write is kept, by its route pattern. */
  ctl.noteSandbox = (method, path, status) => {
    const route = `${method} ${pattern(path)}`;
    if (method !== 'GET' && !HOUSEKEEPING.includes(route)) s.sandbox.attempts.push({route, status, at: ctl.now()});
  };
  return [
    ['POST', /^\/v1\/evals\/sandbox$/, ['chat', 'night'], ({req, body}) => {
      if (req.headers['th-sandbox'] !== 'eval') return [422, {error: {code: 'validation', message: 'only in the eval sandbox'}}];
      Object.assign(s.sandbox, {resets: s.sandbox.resets + 1, seed: body.seed, attempts: [], ledger: {}});
      return {seeded: body.seed.length, thread_id: null};
    }],
    ['GET', /^\/v1\/evals\/sandbox$/, ['chat', 'night'], ({req}) => {
      if (req.headers['th-sandbox'] !== 'eval') return [422, {error: {code: 'validation', message: 'only in the eval sandbox'}}];
      return {reset_at: 1, ledger: s.sandbox.ledger, messages_outside: 0, replies: [], attempts: s.sandbox.attempts};
    }],
    ['PUT', /^\/v1\/evals\/runs\/([^/]+)$/, ['chat', 'night'], ({req, body, params}) => {
      if (req.headers['th-sandbox']) return [422, {error: {code: 'validation', message: 'not in the sandbox'}}];
      s.evalRuns.set(params[0], {...body, at: ctl.now()});
      return [201, {...body, at: ctl.now(), score: body.n ? body.passed / body.n : 0}];
    }],
    ['GET', /^\/v1\/evals\/runs$/, ['chat', 'night'], () => ({items: [...s.evalRuns.values()].reverse()})],
  ];
}
