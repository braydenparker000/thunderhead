// The fake Worker's watches (API.md §11.8, RUNTIME.md §3), close enough to drive `th watch` and
// `th brief`: watch.set and watch.cancel answered as Worker-side verbs (done at once, idempotent by
// the verb's id), the 20 cap, GET /v1/mind/watches, and a test control that fires one as the
// Worker would: a chat wake with reason `watch`, the briefing's section 1 naming it. The real rules
// are the Worker's own tests (backend/tests/integration/watches*.test.ts).
import {HttpError, hash} from './fake-worker.mjs';

const LIVE = 20;
const WAITING = ['live', 'queued'];

/** @param {any} ctl the fake's control object */
export function watchRoutes(ctl) {
  const s = ctl.state;
  s.watches = new Map();
  s.pulse = null;
  const waiting = () => [...s.watches.values()].filter(w => WAITING.includes(w.state)).length;
  /** watch.set / watch.cancel, from the fake's PUT /v1/verbs/:id (fake-routes.mjs). */
  ctl.watchVerb = (id, body, actor) => {
    const had = s.verbs.get(id);
    if (had) { if (had.hash !== hash(body)) throw new HttpError(409, 'conflict'); return had.value; }
    const a = body.args ?? {};
    let result;
    if (body.verb === 'watch.set') {
      if (waiting() >= LIVE) throw new HttpError(422, 'validation', 'args', [{path: 'args', issue: `at most ${LIVE} watches wait at once: cancel one first`}]);
      const until = a.kind === 'at' ? a.at : ctl.now() + 7 * 86_400_000;
      s.watches.set(id, {id, kind: a.kind, at: a.at ?? null, type: a.type ?? null, ref: a.ref ?? null, why: a.why, note: a.note ?? null,
        provenance: 'owner', state: 'live', created_at: ctl.now(), until, met_at: null, settled_at: null, by: null, wake_id: null});
      result = {watch_id: id, state: 'live', until};
    } else {
      const w = s.watches.get(a.id);
      if (!w) throw new HttpError(404, 'not_found');
      if (!WAITING.includes(w.state)) throw new HttpError(410, 'expired');
      Object.assign(w, {state: 'cancelled', settled_at: ctl.now()});
      result = {watch_id: w.id, state: 'cancelled', until: w.until};
    }
    const value = {id, verb: body.verb, schema: body.schema, args: a, status: 'done', result, ledger_id: ctl.addLedger(actor, 'verb', `${body.verb} done`).id};
    s.verbs.set(id, {hash: hash(body), value});
    return value;
  };
  /** Fires a watch as the Worker does: one chat wake, its reason in the briefing (test control). */
  ctl.fireWatch = id => {
    const w = s.watches.get(id);
    const wake = {id: `wake-${id}`, task: 'chat', reason: 'watch', status: 'fired'};
    s.wakes.push(wake);
    Object.assign(w, {state: 'fired', settled_at: ctl.now(), by: 'wake', wake_id: wake.id});
    s.pulse = [`wakes today: 1 of 12, ${waiting()} watches live`, `watch ${id} fired (${w.kind}): ${w.why}${w.note ? ` · note: ${w.note}` : ''}`];
    return wake;
  };
  return [
    ['GET', /^\/v1\/mind\/watches$/, ['chat', 'night', 'reflex'], () => ({
      items: [...s.watches.values()].sort((x, y) => WAITING.includes(y.state) - WAITING.includes(x.state)),
      live: waiting(), budget: 12, used: s.wakes.filter(w => w.reason === 'watch').length, refused: 0,
    })],
  ];
}
