// The pure half of find (areas/music/find.ts): the query string checked, and the listening pass's
// rows read leniently (its table is step 3's, built on another branch): neighbours as ids or as
// {id, score}, scores clamped to 0–1, moods outside the list dropped, and a row that isn't JSON
// left out rather than breaking find.
import { describe, expect, it } from 'vitest';
import { listeningMap, parseFind } from '../../src/areas/music/find';

const id = (c: string) => `r2_native_${c.repeat(64)}`;

describe('parseFind', () => {
  it('takes moods, one occasion, an energy by word or number, like and a limit', () => {
    expect(parseFind({ moods: 'calm, dreamy', occasion: 'wind-down', energy: 'low', limit: '10' })).toEqual({
      moods: ['calm', 'dreamy'],
      occasion: 'wind-down',
      energy: 0.2,
      like: null,
      history: false,
      limit: 10,
    });
    expect(parseFind({ energy: '0.65' })).toMatchObject({ energy: 0.65, limit: 30 });
    expect(parseFind({ energy: '1' })).toMatchObject({ energy: 1 });
    expect(parseFind({ like: id('a') })).toMatchObject({ like: id('a'), moods: [] });
  });

  it('names what is wrong', () => {
    const issues = (q: Record<string, string>) =>
      'issues' in parseFind(q) ? (parseFind(q) as { issues: { path: string }[] }).issues.map((i) => i.path) : [];
    expect(issues({ moods: 'happy' })).toEqual(['moods']);
    expect(issues({ moods: 'calm', energy: '-1' })).toEqual(['energy']);
    expect(issues({ moods: 'calm', energy: '0.5.1' })).toEqual(['energy']);
    expect(issues({ moods: 'calm', limit: '2.5' })).toEqual(['limit']);
    expect(issues({})).toEqual(['moods']);
  });
});

describe('listeningMap', () => {
  it('reads neighbours as ids or scored, clamps, drops unknown moods and unreadable rows', () => {
    const map = listeningMap([
      {
        track_id: id('1'),
        energy: 1.4,
        moods_json: JSON.stringify({ calm: 0.9, happy: 0.8, dark: -1 }),
        neighbours_json: JSON.stringify([id('2'), id('3')]),
      },
      {
        track_id: id('4'),
        energy: null,
        moods_json: null,
        neighbours_json: JSON.stringify([{ id: id('5'), score: 0.4 }, { nope: 1 }]),
      },
      { track_id: id('6'), energy: 0.5, moods_json: '{not json', neighbours_json: null },
    ]);
    expect(map.get(id('1'))).toEqual({
      e: 1,
      m: { calm: 0.9 },
      neighbours: [
        { id: id('2'), score: 1 },
        { id: id('3'), score: 0.5 },
      ],
    });
    expect(map.get(id('4'))).toEqual({ e: null, m: {}, neighbours: [{ id: id('5'), score: 0.4 }] });
    expect(map.has(id('6'))).toBe(false);
  });
});
