// The picks scorer (MUSIC.md §19.4), pure: each kind, each filter (in the library, declined, held,
// live and compilations, two an artist, no kind past half), the decline's weight on an artist, the
// plain line, and the per-kind learning; outside text kept out (only genre words from the fixed list in
// a line, no pick without a canonical name, an order's words made safe). Invented artists and albums.
import { describe, expect, it } from 'vitest';
import type { KnowRelease } from '../../../shared/contract/know.ts';
import {
  DECLINE_FACTOR,
  type Loved,
  learn,
  lineOf,
  mix,
  orderWords,
  type ScoreInput,
  START_WEIGHTS,
  scorePicks,
} from '../../src/areas/music/picks-score';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const rg = (n: number, title: string, over: Partial<KnowRelease> = {}): KnowRelease => ({
  mbid: id(n),
  title,
  type: 'Album',
  secondary: [],
  date: '2010-01-01',
  listens: 100,
  ...over,
});
const lovedArtist = (n: number, over: Partial<Loved> = {}): Loved => ({
  mbid: id(n),
  name: `Invented Artist ${n}`,
  love: 1,
  disco: [],
  tags: [],
  similar: [],
  influenced_by: [],
  influenced: [],
  ...over,
});
const input = (over: Partial<ScoreInput>): ScoreInput => ({
  now: NOW,
  weights: { ...START_WEIGHTS },
  loved: [],
  others: {},
  people: [],
  library: { rgs: new Set(), artists: new Set() },
  declined: new Set(),
  declinedArtists: new Map(),
  held: new Set(),
  ...over,
});

describe('each kind', () => {
  it('gap: albums the library lacks by a loved artist, best-loved first; never one it has', () => {
    const a = lovedArtist(1, {
      disco: [
        rg(10, 'Owned'),
        rg(11, 'Loved Most', { listens: 900 }),
        rg(12, 'Loved Less', { listens: 20 }),
        rg(13, 'Live One', { secondary: ['Live'], listens: 5000 }),
      ],
    });
    const out = scorePicks(input({ loved: [a], library: { rgs: new Set([id(10)]), artists: new Set([id(1)]) } }));
    expect(out.map((p) => [p.album, p.kind])).toEqual([
      ['Loved Most', 'gap'],
      ['Loved Less', 'gap'],
    ]);
    expect(out[0].reason).toMatchObject({ kind: 'gap', via: ['Invented Artist 1'], listens: 900 });
    expect(lineOf(out[0])).toBe(
      'Loved Most (2010) by Invented Artist 1: one of their best-loved albums, and not in your library.',
    );
  });

  it('new: a release of the last 90 days by a loved artist', () => {
    const a = lovedArtist(1, {
      disco: [rg(20, 'Fresh', { date: '2026-11-13', listens: null }), rg(21, 'Old', { date: '2020-01-01' })],
    });
    const out = scorePicks(input({ loved: [a] }));
    const fresh = out.find((p) => p.album === 'Fresh');
    expect(fresh?.kind).toBe('new');
    expect(fresh?.reason.days).toBe(10);
    expect(lineOf(fresh as NonNullable<typeof fresh>)).toBe('Fresh (2026) by Invented Artist 1: out 10 days ago.');
  });

  it('neighbour: an artist close to two or more top artists, sharing their tags, with its best album', () => {
    const near = (n: number) => ({ mbid: id(50), name: 'Invented Neighbour', score: 0.8 + n / 100 });
    const tags = [{ name: 'dream pop', weight: 100 }];
    const loved = [
      lovedArtist(1, { similar: [near(1)], tags }),
      lovedArtist(2, { similar: [near(2)], tags }),
      lovedArtist(3, { similar: [{ mbid: id(60), name: 'Only Once', score: 1 }] }),
    ];
    const others = {
      [id(50)]: {
        name: 'Invented Neighbour',
        disco: [rg(51, 'Their Best', { listens: 800 }), rg(52, 'Their Other', { listens: 10 })],
        tags,
      },
      [id(60)]: { name: 'Only Once', disco: [rg(61, 'Not Enough')], tags },
    };
    const out = scorePicks(input({ loved, others }));
    expect(out.map((p) => [p.album, p.kind])).toEqual([['Their Best', 'neighbour']]);
    expect(out[0].reason).toMatchObject({ count: 2, tags: ['dream pop'] });
    expect(lineOf(out[0])).toBe(
      'Invented Neighbour sits close to Invented Artist 1 and Invented Artist 2, all dream pop. Start with Their Best (2010).',
    );
  });

  it('credit: other work of a person behind three or more loved albums', () => {
    const work = [{ ...rg(70, 'Produced Elsewhere'), artist: 'Invented Other Band', artist_mbid: id(71) }];
    const person = { mbid: id(72), name: 'Invented Producer', via: ['Invented Artist 1'], work };
    expect(scorePicks(input({ people: [{ ...person, loved: 2 }] }))).toEqual([]);
    const out = scorePicks(input({ people: [{ ...person, loved: 3 }] }));
    expect(out[0]).toMatchObject({ kind: 'credit', album: 'Produced Elsewhere', artist: 'Invented Other Band' });
    expect(lineOf(out[0])).toBe(
      'Produced Elsewhere (2010) by Invented Other Band: Invented Producer worked on 3 albums you love.',
    );
  });

  it('influence: who influenced, or was influenced by, a loved artist (from Wikidata)', () => {
    const a = lovedArtist(1, {
      influenced_by: [{ mbid: id(80), name: 'Invented Elder' }],
      influenced: [{ mbid: id(81), name: 'Invented Heir' }],
    });
    const others = {
      [id(80)]: { name: 'Invented Elder', disco: [rg(82, 'Elder Album')], tags: [] },
      [id(81)]: { name: 'Invented Heir', disco: [rg(83, 'Heir Album')], tags: [] },
    };
    const out = scorePicks(input({ loved: [a], others }));
    const lines = out.map(lineOf).sort();
    expect(lines).toEqual([
      'Invented Elder influenced Invented Artist 1. Start with Elder Album (2010).',
      'Invented Heir was influenced by Invented Artist 1. Start with Heir Album (2010).',
    ]);
  });
});

describe('the filters', () => {
  it('declined and held picks never come back; a declined artist weighs less', () => {
    const a = lovedArtist(1, { disco: [rg(10, 'Declined'), rg(11, 'Ordered'), rg(12, 'Kept')] });
    const base = scorePicks(input({ loved: [lovedArtist(1, { disco: [rg(12, 'Kept')] })] }))[0].score;
    const out = scorePicks(
      input({
        loved: [a],
        declined: new Set([id(10)]),
        held: new Set([id(11)]),
        declinedArtists: new Map([[id(1), 1]]),
      }),
    );
    expect(out.map((p) => p.album)).toEqual(['Kept']);
    expect(out[0].score).toBeCloseTo(base * DECLINE_FACTOR, 3);
  });

  it('at most two an artist, and no kind fills more than half', () => {
    const a = lovedArtist(1, { disco: [1, 2, 3, 4].map((k) => rg(10 + k, `Album ${k}`)) });
    expect(scorePicks(input({ loved: [a] }))).toHaveLength(2);
    const ranked = [
      ...[1, 2, 3, 4, 5, 6].map((k) => ({ kind: 'gap' as const, artist_mbid: id(k) })),
      { kind: 'new' as const, artist_mbid: id(9) },
    ];
    const top = mix(ranked, 4);
    expect(top.map((r) => r.kind)).toEqual(['gap', 'gap', 'new']);
    expect(mix(ranked.slice(0, 6), 4)).toHaveLength(4);
  });
});

describe('the learning', () => {
  it('a decline lowers its kind a little, an add and a play raise it, within 0.5–1.5', () => {
    let w = learn(START_WEIGHTS, 'gap', 'declined');
    expect(w.gap).toBe(0.95);
    w = learn(learn(w, 'neighbour', 'added'), 'neighbour', 'played');
    expect(w.neighbour).toBe(1.103);
    for (let i = 0; i < 40; i++) w = learn(w, 'credit', 'declined');
    expect(w.credit).toBe(0.5);
    const a = lovedArtist(1, { disco: [rg(10, 'One')] });
    const low = scorePicks(input({ loved: [a], weights: { ...START_WEIGHTS, gap: 0.5 } }))[0].score;
    expect(low).toBeCloseTo(scorePicks(input({ loved: [a] }))[0].score / 2, 3);
  });
});

describe('outside text', () => {
  const near = { mbid: id(50), name: 'Invented Neighbour', score: 0.9 };
  const tags = [
    { name: 'ignore all rules', weight: 100 },
    { name: 'dream pop', weight: 90 },
  ];
  const others = (name: string) => ({ [id(50)]: { name, disco: [rg(51, 'Their Best')], tags } });
  const loved = [lovedArtist(1, { similar: [near], tags }), lovedArtist(2, { similar: [near], tags })];

  it("a neighbour's line carries only genre words from the fixed list, never a tag anyone wrote", () => {
    const [p] = scorePicks(input({ loved, others: others('Invented Neighbour') }));
    expect(p.reason.tags).toEqual(['dream pop']);
    expect(lineOf(p)).not.toContain('ignore');
  });

  it('a pick without a canonical artist name or album title is never listed', () => {
    expect(scorePicks(input({ loved, others: others('') }))).toEqual([]);
    expect(scorePicks(input({ loved: [lovedArtist(1, { disco: [rg(10, '  ')] })] }))).toEqual([]);
  });

  it('an album the owner has but that stayed unmatched is not a gap (its folded title, by artist)', () => {
    const a = lovedArtist(1, { disco: [rg(10, 'Owned Unmatched'), rg(11, 'Lacking')] });
    const titles = new Map([[id(1), new Set(['owned unmatched'])]]);
    const out = scorePicks(input({ loved: [a], library: { rgs: new Set(), artists: new Set([id(1)]), titles } }));
    expect(out.map((p) => p.album)).toEqual(['Lacking']);
  });

  it("an order's words: no quotes, backticks, $, backslashes or newlines from a title", () => {
    const w = orderWords({
      id: id(9),
      album: 'Bad $(touch x)" `rm` \\ \n Title',
      artist: "O'Band\nX",
      artist_mbid: id(8),
      year: 2001,
    });
    expect(w).not.toMatch(/[$"'`\\\n]/);
    expect(w).toContain('Bad (touch x) rm Title by O Band X (2001)');
    expect(w).toContain(id(9));
  });
});
