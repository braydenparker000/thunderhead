// Night step 13's words (backend/src/areas/mind/growth-words.ts, law 4: notice, remind once, let go):
// over many invented weeks, every tile and why passes the phrase lint, keeps the Briefing's limits
// and none of GROWTH_NEVER's words; under 3 sessions nothing at all; a plan never goes past the
// tempo the owner reached; the passage keeps to the owner's own pace when they set one, stops at the
// book's end and needs a place to start from.
import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  GROWTH_NEVER,
  type GuitarWeek,
  type StudyPlace,
  type StudyWeek,
} from '../../../shared/contract/growth.ts';
import { lintMindText } from '../../../shared/contract/lint.ts';
import { SURFACE_KINDS } from '../../../shared/contract/surfaces.ts';
import { guitarWords, studyWords } from '../../src/areas/mind/growth-words';

const guitar = (sessions: number, minutes: number, gained: number, cleared: boolean): GuitarWeek => ({
  from: '2026-10-25',
  to: '2026-10-31',
  sessions,
  minutes,
  days: Math.min(7, sessions),
  cleared: cleared ? 1 : 0,
  gained: gained ? 1 : 0,
  songs: [
    {
      ref: 'tab:s7',
      outside: false,
      sessions,
      minutes,
      sections: [
        { key: '0-3', bars: '1-4', best_bpm: 80 + gained, before_bpm: 80, gained, cleared, clean: 4 },
        { key: '4-7', bars: '5-8', best_bpm: null, before_bpm: null, gained: 0, cleared: false, clean: 0 },
      ],
    },
  ],
});
const study = (reads: number, pages: number, books = 1): StudyWeek => ({
  from: '2026-10-25',
  to: '2026-10-31',
  reads,
  pages,
  minutes: pages * 2,
  days: Math.min(7, reads),
  books,
  items: [{ ref: 'book:b1', reads, pages, minutes: pages * 2, days: Math.min(7, reads) }],
});
const place = (page: number | null, pdf_pages = 400, highlights = 0): StudyPlace => ({
  id: 'b1',
  page,
  pdf_pages,
  labels: {},
  highlights,
});
const words = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? [];
const tileOk = (t: object) => SURFACE_KINDS.tile.versions[1].safeParse(t).success;

describe('the growth note’s words', () => {
  it('never scold, pass the lint and fit the tile, whatever the week', () => {
    for (const sessions of [3, 4, 9, 40])
      for (const minutes of [5, 59, 60, 61, 600, 4000])
        for (const gained of [0, 1, 6, 30])
          for (const cleared of [false, true]) {
            const g = guitarWords(guitar(sessions, minutes, gained, cleared));
            const s = studyWords(study(sessions, minutes, cleared ? 3 : 1), [place(minutes, 9999, gained)]);
            for (const part of [g, s]) {
              expect(part.tile).not.toBeNull();
              const t = part.tile as NonNullable<typeof part.tile>;
              expect(tileOk(t.payload), JSON.stringify(t.payload)).toBe(true);
              for (const text of [t.payload.value, t.payload.detail, t.why, part.plan?.why ?? '']) {
                expect(lintMindText(text), text).toBeNull();
                expect(
                  words(text).filter((w) => (GROWTH_NEVER as readonly string[]).includes(w)),
                  text,
                ).toEqual([]);
              }
              expect(t.payload.detail.endsWith('.')).toBe(true);
            }
          }
  });

  it('under 3 sessions, silence', () => {
    for (const n of [0, 1, GROWTH.min_sessions - 1]) {
      expect(guitarWords(guitar(n, 30, 6, true))).toEqual({ sessions: n, tile: null, plan: null, reason: 'quiet' });
      expect(studyWords(study(n, 40), [place(10)])).toEqual({ sessions: n, tile: null, plan: null, reason: 'quiet' });
    }
  });

  it('plans at the tempo reached, never past it; no clean pass, no plan', () => {
    const g = guitarWords(guitar(5, 90, 6, false));
    expect(g.plan?.args).toMatchObject({ tab: 'tab:s7', sections: [{ key: '0-3', bpm: 86 }] });
    const none = guitar(5, 90, 0, false);
    none.songs[0].sections[0].best_bpm = null;
    expect(guitarWords(none)).toMatchObject({ plan: null, reason: 'no_section' });
    expect(guitarWords(none).tile?.payload).toMatchObject({ value: '1 h 30 min this week', path: '/guitar/' });
  });

  it('the passage: a day’s pace from where the owner left off, to the book’s end; none without a place', () => {
    expect(studyWords(study(4, 40), [place(10)]).plan?.args).toEqual({
      book: 'book:b1',
      left_off: 'p. 10',
      next: 'pp. 11–20',
      page: 11,
    });
    expect(studyWords(study(4, 40), [place(398, 400)]).plan?.args).toMatchObject({ next: 'pp. 399–400' });
    expect(studyWords(study(4, 40), [place(399, 400)]).plan?.args).toMatchObject({ next: 'p. 400' });
    expect(studyWords(study(4, 40), [place(400, 400)])).toMatchObject({ plan: null, reason: 'book_end' });
    expect(studyWords(study(4, 40), [place(null)])).toMatchObject({ plan: null, reason: 'no_place' });
    expect(studyWords(study(4, 40), [])).toMatchObject({ plan: null, reason: 'no_place' });
    expect(studyWords(study(4, 4000), [place(1)]).plan?.args).toMatchObject({
      next: `pp. 2–${1 + GROWTH.passage_max}`,
    });
    // The pace the owner set (study.pace_goal: 70 pages a week) over this week's.
    const own = studyWords(study(4, 40), [place(10)], 70);
    expect(own.plan?.args).toMatchObject({ next: 'pp. 11–20' });
    expect(studyWords(study(4, 40), [place(10)], 35).plan).toMatchObject({ args: { next: 'pp. 11–15' } });
    expect(own.plan?.why).toContain('the pace you set');
  });
});
