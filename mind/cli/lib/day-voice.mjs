// th note --day-voice (MEMORY.md §3.1, mind/skills/night.md): the night's one line on the day that
// closed, in its own voice, at most 200 characters, checked by the phrase lint here and again by
// the Worker (PUT /v1/memory/day-notes/:day/voice). The day is --day, else the night's own.
import {invalid, out, textArg} from './io.mjs';
import {request} from './http.mjs';
import {lintText} from './lint.mjs';
import {getState} from './state.mjs';

const MAX = 200;

export async function dayVoice(flags) {
  const line = flags['day-voice'] === true ? '' : textArg([String(flags['day-voice'])]).replace(/\s+/g, ' ').trim();
  if (!line) throw invalid('usage: th note --day-voice "<one line, ≤ 200 characters>" [--day <YYYY-MM-DD>]');
  if (line.length > MAX) throw invalid(`the line has ${line.length} characters (max ${MAX})`);
  const problem = lintText(line);
  if (problem) throw invalid(`the phrase lint refuses it (${problem})`);
  const day = typeof flags.day === 'string' ? flags.day : getState('night_day') ?? getState('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) throw invalid('which day? --day <YYYY-MM-DD> (th night start sets it)');
  const {data} = await request('PUT', `/v1/memory/day-notes/${day}/voice`, {body: {line}});
  out({day: data?.day ?? day, voice: data?.voice ?? line});
}
