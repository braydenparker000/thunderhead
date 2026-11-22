// The fake Worker's list for the builder (shared/contract/issues.ts), close enough to drive `th
// issue`: a strict body, the owner's message as the source, idempotent PUTs, notes added, the list
// newest first. The real rules are the Worker's own tests (backend/tests/integration/issues.test.ts).
import {HttpError, hash} from './fake-worker.mjs';

/** @param {any} ctl the fake's control object */
export function issueRoutes(ctl) {
  const s = ctl.state;
  s.issues = new Map();
  const get = id => {
    const r = s.issues.get(id)?.value;
    if (!r) throw new HttpError(404, 'not_found');
    return r;
  };
  return [
    ['PUT', /^\/v1\/issues\/([^/]+)$/, ['chat'], ({params, body}) => {
      const had = s.issues.get(params[0]);
      if (had) { if (had.hash !== hash(body)) throw new HttpError(409, 'conflict'); return [200, {issue: had.value}]; }
      const extra = Object.keys(body).filter(k => !['title', 'what', 'where', 'kind', 'from_message_id'].includes(k));
      if (extra.length || !body.title || !body.what) throw new HttpError(422, 'validation');
      const source = s.messages.find(m => m.id === body.from_message_id);
      if (source?.origin !== 'owner_device')
        throw new HttpError(422, 'validation', 'from_message_id', [{path: 'from_message_id', issue: "not one of the owner's messages"}]);
      const value = {id: params[0], at: ctl.now(), title: body.title, what: body.what, where: body.where ?? null, kind: body.kind ?? 'annoying',
        origin: 'mind', from_message_id: source.id, release: 'abcdef012345', seen: null, state: 'open', done_at: null, updated_at: ctl.now(), notes: []};
      s.issues.set(params[0], {hash: hash(body), value});
      return [201, {issue: value}];
    }],
    ['GET', /^\/v1\/issues$/, ['chat', 'night', 'reflex'], ({query}) => {
      const state = query.get('state') ?? 'open';
      const all = [...s.issues.values()].map(r => r.value).filter(r => state === 'all' || r.state === state);
      return {items: all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)), more: false};
    }],
    ['GET', /^\/v1\/issues\/([^/]+)$/, ['chat', 'night', 'reflex'], ({params}) => ({issue: get(params[0])})],
    ['POST', /^\/v1\/issues\/([^/]+)\/notes$/, ['chat'], ({params, body}) => {
      const r = get(params[0]);
      if (Object.keys(body).join() !== 'text' || !body.text?.trim()) throw new HttpError(422, 'validation');
      r.notes.push({id: `${r.notes.length}`, at: ctl.now(), by: 'mind', text: body.text});
      return {issue: r};
    }],
  ];
}
