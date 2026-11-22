// th voice: the voice page, how you talk (shared/contract/voice.ts). `th voice` prints it as text,
// with who changed it last; `th voice set --why "<why>"` reads the whole new page from stdin and
// replaces it (PUT /v1/mind/voice). The owner sees a line in the chat with Undo. Errors are one line
// naming the limit; the Worker checks every limit again.
import {readFileSync} from 'node:fs';
import {parseArgs} from './args.mjs';
import {invalid, out, ThError} from './io.mjs';
import {request} from './http.mjs';

const MAX = 4_000;
const WHY = [8, 200];

/** The page's last line: who changed it, when, and why. */
const lastLine = last => last
  ? `(changed by ${last.by === 'mind' ? 'you' : last.by === 'owner' ? 'the owner' : last.by}, ${new Date(last.at).toISOString().slice(0, 16).replace('T', ' ')} UTC${last.why ? `: ${last.why}` : ''})`
  : '(the first page: nobody has changed it yet)';

/** A Worker refusal as one line: its first issue (which names the limit), else its message. */
function oneLine(error) {
  if (!(error instanceof ThError)) return error;
  const issue = Array.isArray(error.details) ? error.details[0]?.issue : error.details?.reason;
  return issue ? new ThError(error.exit, error.code, String(issue), error.requestId) : error;
}

/** Local checks before the network: the page from stdin and the why. Returns the body. */
export function voiceBody(text, why) {
  const page = String(text ?? '').replace(/\s+$/, '');
  if (!page.trim()) throw invalid('usage: th voice set --why "<8–200 characters>" < page.txt (the whole page on stdin, 1 to 4,000 characters)');
  if (page.length > MAX) throw invalid(`the page has ${page.length} characters (at most 4,000)`);
  const w = typeof why === 'string' ? why.trim() : '';
  if (w.length < WHY[0] || w.length > WHY[1]) throw invalid(`the why has ${w.length} characters (${WHY[0]} to ${WHY[1]}): --why "<what the owner said or why>"`);
  return {text: page, why: w};
}

export async function voice(argv) {
  const {flags, rest} = parseArgs(argv);
  const sub = rest[0];
  try {
    if (sub === undefined) {
      const {data} = await request('GET', '/v1/mind/voice');
      out(`${data.text}\n\n${lastLine(data.last)}`);
      return;
    }
    if (sub !== 'set') throw invalid('usage: th voice | th voice set --why "<why>" < page.txt');
    const body = voiceBody(readFileSync(0, 'utf8'), flags.why);
    const {data} = await request('PUT', '/v1/mind/voice', {body});
    out({id: data.last?.id ?? null, by: data.last?.by ?? null, chars: data.text.length, told: 'a line in the chat with Undo'});
  } catch (error) {
    throw oneLine(error);
  }
}
