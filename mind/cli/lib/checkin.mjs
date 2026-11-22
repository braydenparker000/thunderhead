// A check-in (the night routine waking by itself in the day, backend/src/areas/mind/checkin.ts):
//   th checkin say            the one message into today's conversation, its text on stdin (no
//                             reply-to, no notification; a second message is 409 conflict)
//   th checkin done [--nothing "<why>"]
//                             ends the check-in and prints the outcome: said, lines (a home line or
//                             tile, no message) or nothing (with why)
// Only a night session whose claim is a check-in may, within 10 minutes of its claim (403 after);
// the Worker ends it by itself then.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {uuidv7} from './ids.mjs';
import {invalid, out} from './io.mjs';

const USAGE = 'usage: th checkin say (text on stdin) | th checkin done [--nothing "<why>"]';

export async function checkin(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest[0] === 'say' && rest.length === 1 && flags.nothing === undefined) {
    const body = readFileSync(0, 'utf8').replace(/\n+$/, '');
    if (!body.trim()) throw invalid('th checkin say reads the message from stdin: th checkin say <<\'EOF\' … EOF');
    const {data} = await request('POST', '/v1/mind/checkin', {body: {action: 'say', id: uuidv7(), body}});
    return out(data);
  }
  if (rest[0] === 'done' && rest.length === 1) {
    if (flags.nothing !== undefined && (typeof flags.nothing !== 'string' || !flags.nothing.trim()))
      throw invalid('--nothing takes why, in a few words');
    const body = {action: 'done', ...(typeof flags.nothing === 'string' ? {nothing: flags.nothing} : {})};
    const {data} = await request('POST', '/v1/mind/checkin', {body});
    return out(data);
  }
  throw invalid(USAGE);
}
