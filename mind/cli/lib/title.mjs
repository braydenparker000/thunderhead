// `th title <thread> <title> [--proposal <id>]`: names a thread, in the forgiving form
// (lib/forgive.mjs): the spaces around the title are trimmed and said; every fault comes back in
// one refusal with its rule and number. The title is never cut.
import {parseArgs} from './args.mjs';
import {out} from './io.mjs';
import {permitOut, proposalHeaders, request} from './http.mjs';
import {Faults, prose} from './forgive.mjs';

/** The Worker's limit on a thread's title (PATCH /v1/threads/:id). */
export const TITLE_MAX = 80;

export async function title(argv) {
  const {flags, rest} = parseArgs(argv);
  const [thread, ...words] = rest;
  const f = new Faults();
  if (!thread) f.add('thread', 'the thread\'s id (or today\'s)', 'none sent');
  const text = prose(f, 'title', words.length ? words.join(' ') : undefined, {max: TITLE_MAX});
  if (flags.proposal === true) f.add('--proposal', 'an approved card\'s id', 'none sent');
  f.done('th title <thread> <title, 1 to 80 characters> [--proposal <approved card id>]');
  const {data} = await request('PATCH', `/v1/threads/${encodeURIComponent(thread)}`, {headers: proposalHeaders(flags), body: {title: text}});
  out(f.with({ok: true, ...permitOut(data)}));
}
