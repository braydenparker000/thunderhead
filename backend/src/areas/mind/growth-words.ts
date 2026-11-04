// What night step 13 says and plans from a week's counts (growth.ts): for each of Guitar and Study,
// the Briefing tile (one sentence of what grew, from counts, never the owner's words), and the plan
// it sets through the C1 verbs, guitar.set_plan (the song practised most, its sections where the
// clean passes reached, at that tempo: never past what the owner played, so never more than the
// 6 BPM a week the skill allows) and study.mark_next (the book moved most, ties to the one with
// more highlights, from where the owner left off, a day of the pace they set with study.pace_goal,
// else of this week's, to the book's end: their own plan as they set it, BEHAVIOR.md §9). Under
// GROWTH.min_sessions it is silent: no tile, no plan, no word about it (law 4). Pure.
import {
  GROWTH,
  type GuitarSection,
  type GuitarWeek,
  type StudyPlace,
  type StudyWeek,
} from '../../../../shared/contract/growth.ts';

export interface Tile {
  label: string;
  value: string;
  detail: string;
  app: 'guitar' | 'study';
  path: string;
}
export interface Part {
  sessions: number;
  tile: { payload: Tile; why: string } | null;
  plan: { args: Record<string, unknown>; why: string } | null;
  reason: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dur = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
const dash = (bars: string) => bars.replace('-', '–');
/** A sentence of the first part and as many of the rest as fit in `max`, in order. */
function sentence(first: string, rest: (string | null)[], max = 60): string {
  const extra = rest.filter((p): p is string => Boolean(p));
  for (let k = extra.length; k >= 0; k--) {
    const s = `${[first, ...extra.slice(0, k)].join(', ')}.`;
    if (s.length <= max) return s;
  }
  return `${first.slice(0, max - 1)}.`;
}
const quiet = (sessions: number): Part => ({ sessions, tile: null, plan: null, reason: 'quiet' });

/** Tomorrow's sections: those with a clean pass this week, the ones still short of full tempo
 * first, then those that gained least, at the best clean tempo they reached. */
function sections(xs: GuitarSection[]): { key: string; bpm: number; bars: string }[] {
  return xs
    .filter((x) => x.best_bpm !== null && x.best_bpm >= 20)
    .sort((a, b) => Number(a.cleared) - Number(b.cleared) || a.gained - b.gained || (a.key < b.key ? -1 : 1))
    .slice(0, GROWTH.plan_sections)
    .map((x) => ({ key: x.key, bpm: Math.min(300, x.best_bpm as number), bars: x.bars }));
}

export function guitarWords(g: GuitarWeek): Part {
  if (g.sessions < GROWTH.min_sessions) return quiet(g.sessions);
  const song = g.songs[0];
  const picks = song ? sections(song.sections) : [];
  const top = g.songs
    .flatMap((s) => s.sections)
    .filter((x) => x.gained > 0)
    .sort((a, b) => b.gained - a.gained)[0];
  const first = picks[0];
  const [a, b] = first ? first.key.split('-') : [];
  const payload: Tile = {
    label: 'Practice',
    value: first ? `Next: bars ${dash(first.bars)} at ${first.bpm}` : `${dur(g.minutes)} this week`,
    detail: sentence(`${plural(g.sessions, 'session')} this week, ${dur(g.minutes)}`, [
      top ? `bars ${dash(top.bars)} up ${top.gained} bpm` : null,
      g.cleared ? `${plural(g.cleared, 'section')} clean at full tempo` : null,
    ]),
    app: 'guitar',
    path: first ? `/guitar/#play=${song.ref.slice(4)}&bars=${a}-${b}&bpm=${first.bpm}` : '/guitar/',
  };
  const why = `The week in Guitar, from its counts: ${plural(g.sessions, 'session')} on ${plural(g.days, 'day')}, ${g.minutes} minutes, ${plural(g.gained, 'section')} with a new best, ${g.cleared} clean at full tempo.`;
  return {
    sessions: g.sessions,
    tile: { payload, why },
    plan: first
      ? {
          args: {
            tab: song.ref,
            sections: picks.map((p) => ({ key: p.key, bpm: p.bpm })),
            label: 'Where this week reached',
          },
          why: "Tomorrow's sections from this week's practice: where the clean passes reached, at that tempo.",
        }
      : null,
    reason: first ? null : 'no_section',
  };
}

/** A printed page label, short enough for a tile (the PDF page when the book has none). */
const label = (p: StudyPlace, n: number) => (p.labels[String(n)] ?? String(n)).slice(0, 10);

export function studyWords(s: StudyWeek, places: StudyPlace[], goal: number | null = null): Part {
  if (s.reads < GROWTH.min_sessions) return quiet(s.reads);
  const hl = (ref: string) => places.find((p) => `book:${p.id}` === ref)?.highlights ?? 0;
  const book = s.items
    .filter((b) => b.pages > 0)
    .sort((a, b) => b.pages - a.pages || hl(b.ref) - hl(a.ref) || b.minutes - a.minutes || (a.ref < b.ref ? -1 : 1))[0];
  const place = book ? places.find((p) => `book:${p.id}` === book.ref) : undefined;
  const daily = goal !== null ? goal / 7 : book ? book.pages / Math.max(1, book.days) : 1;
  const pace = Math.min(GROWTH.passage_max, Math.max(1, Math.round(daily)));
  const at = place?.page ?? null;
  const end = at === null ? null : Math.min(at + pace, place?.pdf_pages ?? at + pace);
  const reason = !place || at === null ? 'no_place' : end === null || end <= at ? 'book_end' : null;
  const next =
    place && at !== null && end !== null && !reason
      ? end === at + 1
        ? `p. ${label(place, end)}`
        : `pp. ${label(place, at + 1)}–${label(place, end)}`
      : null;
  const highlights = places.reduce((n, p) => n + p.highlights, 0);
  const payload: Tile = {
    label: 'Study',
    value: next ? `Next: ${next}` : `${plural(s.pages, 'page')} this week`,
    detail: sentence(`${plural(s.pages, 'page')} on ${plural(s.days, 'day')}, ${dur(s.minutes)}`, [
      s.books > 1 ? `${s.books} books moved` : null,
      highlights ? plural(highlights, 'highlight') : null,
    ]),
    app: 'study',
    path: next && place && at !== null ? `/study/?book=${encodeURIComponent(place.id)}&p=${at + 1}` : '/study/',
  };
  const why = `The week in Study, from its counts: ${plural(s.pages, 'page')} on ${plural(s.days, 'day')}, ${s.minutes} minutes, in ${plural(s.books, 'book')}.`;
  return {
    sessions: s.reads,
    tile: { payload, why },
    plan:
      next && place && book && at !== null
        ? {
            args: { book: book.ref, left_off: `p. ${label(place, at)}`, next, page: at + 1 },
            why: `From where you left off, about a day's reading at ${goal !== null ? 'the pace you set' : "this week's pace"} (${plural(pace, 'page')}).`,
          }
        : null,
    reason,
  };
}
