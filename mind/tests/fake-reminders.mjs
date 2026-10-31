// The fake Worker's reminder routes (API.md §11.24), close enough to drive `th remind`: a strict
// body, the owner's message as the source (at most 3 from one), idempotent PUTs, a time inside fake
// quiet hours (22:00–06:30 UTC) moved to their end, and one the owner set taken back only with the
// owner's message that asked. The real rules are the Worker's own tests.
import {HttpError, hash} from './fake-worker.mjs';

const QUIET_END_MIN = 6 * 60 + 30;
const DAY = 86_400_000;

/** The end of fake quiet hours for a time inside them, else the time. */
function fireAt(at) {
  const minute = Math.floor((at % DAY) / 60_000);
  if (minute >= QUIET_END_MIN && minute < 22 * 60) return at;
  const day = at - (at % DAY) + (minute >= 22 * 60 ? DAY : 0);
  return day + QUIET_END_MIN * 60_000;
}

/** @param {any} ctl the fake's control object */
export function reminderRoutes(ctl) {
  const s = ctl.state;
  s.reminders = new Map();
  return [
    ['PUT', /^\/v1\/reminders\/([^/]+)$/, ['chat'], ({params, body}) => {
      const had = s.reminders.get(params[0]);
      if (had) { if (had.hash !== hash(body)) throw new HttpError(409, 'conflict'); return [200, {reminder: had.value}]; }
      const extra = Object.keys(body).filter(k => !['text', 'at', 'source_message_id'].includes(k));
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (extra.length || !text || text.length > 200 || !Number.isInteger(body.at)) throw new HttpError(422, 'validation');
      const source = s.messages.find(m => m.id === body.source_message_id);
      if (!source || source.origin !== 'owner_device')
        throw new HttpError(422, 'validation', 'source_message_id', [{path: 'source_message_id', issue: "not one of the owner's messages"}]);
      if ([...s.reminders.values()].filter(r => r.source === source.id).length >= 3)
        throw new HttpError(422, 'validation', 'source_message_id', [{path: 'source_message_id', issue: 'at most 3 reminders from one message'}]);
      const value = {id: params[0], text, at: body.at, fire_at: fireAt(body.at), state: 'set', origin: 'mind', created_at: ctl.now(), fired_at: null, message_id: null};
      s.reminders.set(params[0], {hash: hash(body), source: source.id, value});
      return [201, {reminder: value}];
    }],
    ['GET', /^\/v1\/reminders$/, ['chat', 'night'], () =>
      ({items: [...s.reminders.values()].map(r => r.value).sort((a, b) => a.fire_at - b.fire_at || (a.id < b.id ? -1 : 1))})],
    ['DELETE', /^\/v1\/reminders\/([^/]+)$/, ['chat'], ({params, query}) => {
      const r = s.reminders.get(params[0])?.value;
      if (!r) throw new HttpError(404, 'not_found');
      if (r.origin !== 'mind') {
        const source = s.messages.find(m => m.id === query.get('source_message_id'));
        if (source?.origin !== 'owner_device')
          throw new HttpError(422, 'validation', 'source_message_id', [{path: 'source_message_id', issue: "the owner's message that asked to take it back"}]);
      }
      if (r.state === 'done') throw new HttpError(410, 'expired');
      r.state = 'cancelled';
      return {reminder: r};
    }],
  ];
}
