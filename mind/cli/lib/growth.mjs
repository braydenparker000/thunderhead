// The owner's growth in Guitar and Study (shared/contract/growth.ts, RUNTIME.md §12 step 13):
//   th guitar week [--to <YYYY-MM-DD>]  a week of Guitar: sessions, minutes, days, and each song's
//                                       sections with their best clean tempo, the tempo a new best
//                                       gained and whether they were clean at full tempo
//   th study week [--to <YYYY-MM-DD>]   a week of Study: reading stints, pages, minutes, days, books moved
//   th growth [--day <YYYY-MM-DD>]      night step 13: the Worker writes the Briefing's practice and
//                                       study tiles from those counts and sets tomorrow's section and
//                                       the next passage (guitar.set_plan, study.mark_next); silent
//                                       under 3 sessions
// The week is the 7 logical days that end on --to (default: the night's day, else the briefing's).
// Counts and ids only: a song whose id holds a title's words (a GProTab key) comes marked
// `outside: true`, an id to pass on, never to quote; a book is its id (its title: th get
// /v1/library/books). Nothing here taints the session.
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';
import {getState} from './state.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v, flag) => {
  const day = typeof v === 'string' ? v : getState('night_day') ?? getState('day') ?? new Date().toISOString().slice(0, 10);
  if (!DAY.test(day)) throw invalid(`--${flag} is a day, YYYY-MM-DD`);
  return day;
};

/** `th guitar week` / `th study week`: one of the senses' fixed week questions. */
const week = (app, name) => async argv => {
  const {flags, rest} = parseArgs(argv);
  if (rest[0] !== 'week' || rest.length > 1) throw invalid(`usage: th ${app} week [--to <YYYY-MM-DD>]`);
  const {data} = await request('POST', '/v1/senses/query', {body: {name, params: {to: dayOf(flags.to, 'to')}}});
  out({...(data.rows?.[0] ?? {}), rows_read: data.rows_read ?? null});
};
export const guitar = week('guitar', 'guitar_week');
export const study = week('study', 'study_week');

export async function growth(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th growth [--day <YYYY-MM-DD>]');
  const {data} = await request('PUT', `/v1/mind/growth/${dayOf(flags.day, 'day')}`, {body: {}});
  out(data);
}
