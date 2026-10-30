// The meter's counts (backend/src/areas/insight/meter.ts; EVALS.md §9, M-8 and M-16) on a fixed
// clock in UTC: fixes and facts by week, oldest first; an arrangement undone within 48 hours, kept
// when tapped or its app opened on its day or the next, ignored otherwise, waiting while new.
import { describe, expect, it } from 'vitest';
import { arrangements, corrections } from '../../src/areas/insight/meter';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 30, 12);
const at = (daysAgo: number) => NOW - daysAgo * D;

describe('the meter', () => {
  it('M-8: fixes and facts by week, oldest first; nothing older than 4 weeks', () => {
    expect(corrections([at(1), at(9), at(30)], [at(1), at(2), at(20), at(27), at(29)], NOW)).toEqual([
      { fixed: 0, learned: 1 },
      { fixed: 0, learned: 1 },
      { fixed: 1, learned: 0 },
      { fixed: 1, learned: 2 },
    ]);
  });

  it('M-16: undone, kept by a tap or its app opened on its day or the next, ignored, waiting', () => {
    const rows = [
      { id: 'a1', at: at(5), ref: null, undone_at: at(5) + H },
      { id: 'a2', at: at(5), ref: null, undone_at: null },
      { id: 'a3', at: at(5), ref: 'app:guitar', undone_at: null },
      { id: 'a4', at: at(5), ref: 'app:music', undone_at: null },
      { id: 'a5', at: at(1), ref: null, undone_at: null },
      { id: 'a6', at: at(10), ref: null, undone_at: at(6) },
    ];
    const day = (n: number) => new Date(at(n) - 4 * H).toISOString().slice(0, 10);
    const senses = [
      { day: day(5), type: 'briefing.tile', ref: 'ledger:a2', n: 1 },
      { day: day(4), type: 'guitar.open', ref: '', n: 2 },
      { day: day(2), type: 'player.open', ref: '', n: 1 },
    ];
    // a1 undone; a2 tapped; a3 its app opened the next day; a4's app only three days later; a5 new;
    // a6 undone after four days: it counts as ignored.
    expect(arrangements(rows, senses, NOW, 'UTC')).toEqual({ kept: 2, undone: 1, ignored: 2, waiting: 1 });
  });
});
