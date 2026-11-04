// What lands (BEHAVIOR.md §3.6, EVALS.md §9) on a fixed clock, in UTC: each arrangement's outcome by
// the meter's own rule, the counts per topic and place, the streak (ignored or undone in a row, a kept
// resets it, a line never seen and one not decided yet skipped, counted only since the topic reopened
// or last rested), the trip at three, worst first; the briefing's lines; the odds in words.
import { describe, expect, it } from 'vitest';
import { LANDS, type TopicLands } from '../../../shared/contract/lands.ts';
import { oddsRequired, oddsWords } from '../../../shared/contract/proposals.ts';
import {
  byDay,
  countTopics,
  outcomeOf,
  type Placed,
  streakOf,
  type TopicMarks,
  trips,
  worstFirst,
} from '../../src/areas/insight/lands';
import { arrangements, type Rollup } from '../../src/areas/insight/meter';
import { landsLines, landsRow, oddsLine, speechLine } from '../../src/areas/mind/brief-learn';
import { DAY, HOUR } from '../../src/lib/time';

const NOW = Date.UTC(2026, 10, 20, 12);
const TZ = 'UTC';
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

let n = 0;
/** A home line (or a tile) placed `daysAgo` days ago on `topic`. */
function placed(topic: string, daysAgo: number, over: Partial<Placed> = {}): Placed {
  n++;
  return {
    id: `a${n}`,
    at: NOW - daysAgo * DAY,
    ref: null,
    undone_at: null,
    line: 1,
    topic_key: topic,
    place: 'home',
    ...over,
  };
}
const seen = (a: Placed): Rollup => ({ day: day(a.at), type: 'line.seen', ref: `ledger:${a.id}`, n: 1 });
const tapped = (a: Placed): Rollup => ({ day: day(a.at), type: 'briefing.tile', ref: `ledger:${a.id}`, n: 1 });
const dismissed = (a: Placed): Rollup => ({ day: day(a.at), type: 'line.dismiss', ref: `ledger:${a.id}`, n: 1 });

describe('each arrangement by the meter’s rule', () => {
  it('kept, undone, ignored, unseen and waiting agree with the meter one row at a time', () => {
    const kept = placed('t', 5, { line: 0, place: 'briefing' });
    const undone = placed('t', 5, { undone_at: NOW - 5 * DAY + HOUR });
    const ignored = placed('t', 5);
    const unseen = placed('t', 5);
    const waiting = placed('t', 1);
    const senses = [tapped(kept), seen(ignored)];
    const days = byDay(senses);
    expect([kept, undone, ignored, unseen, waiting].map((a) => outcomeOf(a, days, NOW, TZ))).toEqual([
      'kept',
      'undone',
      'ignored',
      'unseen',
      'waiting',
    ]);
    expect(arrangements([kept, undone, ignored, unseen, waiting], senses, NOW, TZ)).toEqual({
      kept: 1,
      undone: 1,
      ignored: 1,
      unseen: 1,
      waiting: 1,
    });
  });
});

describe('the streak', () => {
  it('counts ignored and undone in a row; a kept resets it; unseen and waiting never break it', () => {
    expect(streakOf(['ignored', 'undone', 'ignored'])).toBe(3);
    expect(streakOf(['ignored', 'ignored', 'kept', 'ignored'])).toBe(1);
    expect(streakOf(['ignored', 'unseen', 'undone', 'waiting', 'ignored'])).toBe(3);
    expect(streakOf(['ignored', 'ignored', 'kept'])).toBe(0);
    expect(streakOf([])).toBe(0);
  });
});

describe('per topic and place, over the window', () => {
  const marks = new Map<string, TopicMarks>();
  it('three passed over in a row trip the rule; one kept between holds it back', () => {
    const ep = [placed('episodes.new', 9), placed('episodes.new', 6), placed('episodes.new', 3)];
    const bars = [
      placed('practice.bars', 9, { line: 0, place: 'briefing' }),
      placed('practice.bars', 8, { line: 0, place: 'briefing' }),
      placed('practice.bars', 6),
      placed('practice.bars', 4),
    ];
    const senses = [seen(ep[0]), dismissed(ep[1]), seen(ep[2]), seen(bars[2]), tapped(bars[1]), seen(bars[3])];
    const items = countTopics(
      [...ep, ...bars].sort((a, b) => a.at - b.at),
      byDay(senses),
      marks,
      NOW,
      TZ,
    );
    const by = Object.fromEntries(items.map((t) => [t.topic_key, t]));
    expect(by['episodes.new']).toMatchObject({ kept: 0, ignored: 3, streak: 3, places: ['home'], quiet_until: null });
    expect(trips(by['episodes.new'])).toBe(true);
    // ignored, kept, ignored, ignored: two in a row since the kept.
    expect(by['practice.bars']).toMatchObject({ kept: 1, ignored: 3, streak: 2, places: ['home', 'briefing'] });
    expect(trips(by['practice.bars'])).toBe(false);
  });

  it('a topic that reopened, or rested, counts its streak only from then; one resting does not trip again', () => {
    const rows = [placed('x', 9), placed('x', 7), placed('x', 5), placed('x', 3)];
    const senses = rows.map(seen);
    const reopened = new Map<string, TopicMarks>([
      ['x', { quiet_from: null, quiet_until: null, said_at: null, reopened_at: NOW - 6 * DAY, ...{} }],
    ]);
    const [t] = countTopics(rows, byDay(senses), reopened, NOW, TZ);
    expect([t.ignored, t.streak]).toEqual([4, 2]);
    const resting = new Map<string, TopicMarks>([
      ['x', { quiet_from: NOW - DAY, quiet_until: NOW + 29 * DAY, said_at: NOW, reopened_at: null }],
    ]);
    const [r] = countTopics(rows, byDay(senses), resting, NOW, TZ);
    expect(r).toMatchObject({ streak: 0, quiet_until: NOW + 29 * DAY, reopens: day(NOW + 29 * DAY), said: true });
    expect(trips(r)).toBe(false);
    // Its 30 days over, it is open again, and what came before it rested does not count.
    const over = new Map<string, TopicMarks>([
      ['x', { quiet_from: NOW - 31 * DAY, quiet_until: NOW - DAY, said_at: NOW - 30 * DAY, reopened_at: null }],
    ]);
    expect(countTopics(rows, byDay(senses), over, NOW, TZ)[0]).toMatchObject({
      quiet_until: null,
      said: false,
      streak: 4,
    });
  });

  it('worst first: resting, then the longest streak, then the most turned down', () => {
    const t = (topic_key: string, o: Partial<TopicLands>): TopicLands => ({
      topic_key,
      places: ['home'],
      kept: 0,
      undone: 0,
      ignored: 0,
      unseen: 0,
      waiting: 0,
      streak: 0,
      quiet_until: null,
      reopens: null,
      said: false,
      ...o,
    });
    const list = [
      t('a', { kept: 5 }),
      t('b', { ignored: 2, streak: 2 }),
      t('c', { quiet_until: NOW + DAY, reopens: day(NOW + DAY) }),
      t('d', { ignored: 4, kept: 1, streak: 1 }),
      t('e', { ignored: 1, streak: 2 }),
    ];
    expect(list.sort(worstFirst).map((x) => x.topic_key)).toEqual(['c', 'b', 'e', 'd', 'a']);
  });
});

describe('the briefing’s lines', () => {
  const rest: TopicLands = {
    topic_key: 'episodes.new',
    places: ['home'],
    kept: 0,
    undone: 1,
    ignored: 2,
    unseen: 0,
    waiting: 0,
    streak: 3,
    quiet_until: NOW + 30 * DAY,
    reopens: '2026-12-20',
    said: false,
  };
  it('section 1 states the position, and for quiet what is spent', () => {
    expect(speechLine({ speech: 'as_needed', lines: 0, cards: 0 })).toMatch(/^speech: as needed · no daily caps/);
    expect(speechLine({ speech: 'quiet', lines: 1, cards: 0 })).toContain('today 1 of 1 home line, 0 of 1 card');
    expect(speechLine({ speech: 'silent', lines: 0, cards: 0 })).toMatch(/^speech: silent .*reminders still ring$/);
  });
  it('a short table, worst first, at most 8 rows; the resting topic to say once; the odds', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      ...rest,
      topic_key: `t${i}`,
      quiet_until: null,
      reopens: null,
      streak: 1,
    }));
    const lines = landsLines([rest, ...rows], [{ category: 'chat.any', n: 20, claimed: 0.7, right: 0.62, brier: 0.2 }]);
    expect(lines[0]).toMatch(/^What lands, 30 days \(kept\/undone\/ignored\/unseen\), worst first/);
    expect(lines[1]).toBe('episodes.new (home) 0/1/2/0 · 3 in a row · rests until 2026-12-20, not said yet');
    expect(lines.filter((l) => /^t\d/.test(l))).toHaveLength(LANDS.brief_rows - 1);
    expect(lines).toContain('(+3 more: th surface topics)');
    expect(lines.find((l) => l.startsWith('Say once'))).toContain('th surface said <topic> (episodes.new)');
    expect(lines.at(-1)).toBe('Your odds last 28 days: chat.any 62 % right of 70 % claimed (20)');
    expect(landsRow({ ...rest, said: true })).toBe('episodes.new (home) 0/1/2/0 · 3 in a row · rests until 2026-12-20');
    // Nothing placed and nothing settled: no lines at all.
    expect(landsLines([], [])).toEqual([]);
    expect(oddsLine([])).toBeNull();
  });
});

describe('odds on cards', () => {
  it('in words from one function: below .4 a guess, to .75 fairly sure, above sure', () => {
    expect([0.05, 0.39, 0.4, 0.75, 0.76, 0.95].map(oddsWords)).toEqual([
      'a guess',
      'a guess',
      'fairly sure',
      'fairly sure',
      'sure',
      'sure',
    ]);
  });
  it('required for an arrangement (class permit), optional for the floors and memory_big', () => {
    expect(oddsRequired('permit')).toBe(true);
    for (const c of ['delete', 'money', 'access', 'reach_people', 'memory_big'] as const)
      expect(oddsRequired(c)).toBe(false);
  });
});
