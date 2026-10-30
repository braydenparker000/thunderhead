// th remind: the reminders the owner asks for in words (HOME.md §6.2, BEHAVIOR.md §3.4). The
// Worker delivers each once at its time, as a line in today's conversation and a push, and moves a
// time inside the owner's quiet hours to their end. Only the owner's own words make one: `--from`
// names the owner's message that asked (sent in the last 48 hours, at most 3 reminders from it; at
// most 5 from the mind in any 24 hours). One the owner set on the phone is taken back only with
// `--from` naming the owner's message that asked; the mind's own need none.
//
//   th remind <when> <text|-> --from <owner message id>   → {"id","fire_at","shifted"}
//   th remind list                                        → {"items":[…]}
//   th remind cancel <id> [--from <owner message id>]     → {"id","state"}
//
// <when> is an ISO 8601 time with its offset (2026-10-31T19:00:00+02:00) or a relative +90m, +2h, +1d.
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {invalid, need, out, textArg} from './io.mjs';

const USAGE = 'usage: th remind <when: ISO time with offset | +90m | +2h | +1d> <text|-> --from <owner message id> | list | cancel <id> [--from <owner message id>]';
/** REMINDER_LIMITS.text in shared/contract/reminders.ts; the Worker checks it again. */
const MAX_TEXT = 200;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const RELATIVE = /^\+(\d{1,6})([mhd])$/;
const UNIT = {m: 60_000, h: 3_600_000, d: 86_400_000};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const seg = value => encodeURIComponent(String(value));

/** `when` → ms: an ISO time that states its offset (never the machine's zone), or now plus a span. */
export function whenMs(when, now = Date.now()) {
  const rel = RELATIVE.exec(when);
  if (rel && Number(rel[1]) > 0) return now + Number(rel[1]) * UNIT[rel[2]];
  const ms = ISO.test(when) ? Date.parse(when) : Number.NaN;
  if (!Number.isFinite(ms)) throw invalid(`<when> must be an ISO time with its offset (2026-10-31T19:00:00+02:00) or +90m, +2h, +1d; got ${when}`);
  return ms;
}

/** @param {string[]} argv */
export async function remind(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest[0] === 'list' && rest.length === 1) return out((await request('GET', '/v1/reminders')).data);
  if (rest[0] === 'cancel' && rest.length === 2) {
    if (!UUID.test(rest[1])) throw invalid(`not a reminder id: ${rest[1]}`);
    const from = flags.from;
    if (from !== undefined && (typeof from !== 'string' || !UUID.test(from)))
      throw invalid(`--from must be the owner's message id; got ${from}`);
    const query = from ? `?source_message_id=${seg(from)}` : '';
    const {data} = await request('DELETE', `/v1/reminders/${seg(rest[1])}${query}`);
    return out({id: data.reminder.id, state: data.reminder.state});
  }
  if (rest.length < 2) throw invalid(USAGE);
  const at = whenMs(rest[0]);
  const text = textArg(rest.slice(1)).trim();
  if (!text) throw invalid('the reminder needs its words');
  if (text.length > MAX_TEXT) throw invalid(`the reminder is over ${MAX_TEXT} characters`);
  const from = need(flags, 'from');
  if (!UUID.test(from)) throw invalid(`--from must be the owner's message id; got ${from}`);
  const {data} = await request('PUT', `/v1/reminders/${seg(uuidv7())}`, {body: {text, at, source_message_id: from}});
  const r = data.reminder;
  out({id: r.id, fire_at: r.fire_at, shifted: r.fire_at !== r.at});
}
