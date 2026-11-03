// Memory's pure parts (MEMORY.md §5, §8): the decay formula per kind, the deterministic profile
// render (byte-identical for the same rows, ≤ 6,000 characters, caps, order, line format), and the
// deploy-transition wrapper. The briefing's are in brief.test.ts and brief-layer.test.ts.
import { describe, expect, it } from 'vitest';
import { decayed, FACT_KINDS, type FactKind } from '../../../shared/contract/memory.ts';
import { renderProfile, shortId } from '../../src/areas/memory/profile';
import type { FactRow } from '../../src/areas/memory/store';
import { fresh } from '../../src/objects/rpc';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 12);

let n = 0;
function fact(over: Partial<FactRow> = {}): FactRow {
  n++;
  const hex = n.toString(16).padStart(12, '0');
  return {
    seq: n,
    id: `0192f0c4-0000-7000-8000-${hex}`,
    kind: 'preference',
    about: 'owner',
    subject: 'music',
    text: `Likes calm music number ${n}`,
    tags_json: null,
    source: 'user',
    confidence: 0.95,
    evidence_json: '["msg:x"]',
    valid_from: null,
    valid_to: null,
    recorded_at: NOW - 10 * DAY,
    superseded_at: null,
    superseded_by: null,
    last_confirmed: NOW,
    sensitivity: 0,
    pinned: 0,
    may_raise: 1,
    written_by: 'owner',
    ledger_id: null,
    lineage_id: `0192f0c4-0000-7000-8000-${hex}`,
    ...over,
  };
}

describe('decay (MEMORY.md §5)', () => {
  it.each(Object.entries(FACT_KINDS) as [FactKind, { half_life_days: number | null }][])(
    '%s: c0 at t = 0, half at one half-life, a quarter at two',
    (kind, { half_life_days }) => {
      const f = { kind, source: 'user', confidence: 0.8, last_confirmed: NOW, pinned: false };
      expect(decayed(f, NOW)).toBeCloseTo(0.8, 10);
      const hl = (half_life_days ?? 1_000) * DAY;
      const one = decayed(f, NOW + hl);
      const two = decayed(f, NOW + 2 * hl);
      if (half_life_days === null) {
        expect(one).toBe(0.8);
        expect(two).toBe(0.8);
      } else {
        expect(one).toBeCloseTo(0.4, 10);
        expect(two).toBeCloseTo(0.2, 10);
      }
    },
  );

  it('a state fact confirmed 7 days ago reads 0.19 and is absent from the profile', () => {
    const f = fact({ kind: 'state', text: 'Is tired this week', last_confirmed: NOW - 7 * DAY });
    expect(decayed(f, NOW)).toBeCloseTo(0.19, 2);
    expect(renderProfile([f], NOW, 'UTC').fact_ids).toEqual([]);
  });

  it('pinned facts do not decay; a pinned user fact reads 1.0; an unknown kind decays like a fact', () => {
    expect(decayed({ kind: 'state', source: 'user', confidence: 0.95, last_confirmed: 0, pinned: 1 }, NOW)).toBe(1);
    expect(decayed({ kind: 'state', source: 'inferred', confidence: 0.5, last_confirmed: 0, pinned: true }, NOW)).toBe(
      0.5,
    );
    const fiveYears = 5 * 365 * DAY;
    expect(
      decayed({ kind: 'later_kind', source: 'user', confidence: 0.8, last_confirmed: NOW, pinned: 0 }, NOW + fiveYears),
    ).toBeCloseTo(0.4, 10);
  });
});

describe('the profile (MEMORY.md §8)', () => {
  it('renders the documented line format, pinned first, then by kind order, deterministically', () => {
    const rows = [
      fact({ kind: 'fact', text: 'Owns a classical guitar' }),
      fact({ kind: 'state', text: 'Is learning a new piece', last_confirmed: NOW - DAY }),
      fact({
        kind: 'preference',
        text: 'Prefers short answers on the phone',
        pinned: 1,
        recorded_at: Date.UTC(2026, 10, 2),
      }),
      fact({ kind: 'goal', text: 'Wants to play the piece at 100 bpm', source: 'observed', confidence: 0.7 }),
      fact({ kind: 'routine', text: 'Practises after lunch', may_raise: 0, sensitivity: 1 }),
      fact({ kind: 'rule', text: 'Answer in the second language after 21:00' }),
    ];
    const a = renderProfile(rows, NOW, 'UTC');
    const b = renderProfile([...rows].reverse(), NOW, 'UTC');
    expect(b.text).toBe(a.text);
    const lines = a.text.split('\n');
    expect(lines[0]).toBe(`[f:${shortId(rows[2].id)}] Prefers short answers on the phone (1.0, u, since 2026-11)`);
    expect(lines.map((l) => l.split('] ')[1].split(' (')[0])).toEqual([
      'Prefers short answers on the phone',
      'Is learning a new piece',
      'Wants to play the piece at 100 bpm',
      'Practises after lunch',
      'Owns a classical guitar',
    ]);
    expect(lines[2]).toContain('(0.7, o, since');
    expect(lines[3]).toMatch(/ · don't raise · private$/);
    expect(a.text).not.toContain('second language');
    expect(a.fact_ids).toHaveLength(5);
    // The private line is named by its fact (stage B.5), so a screen blurs it by id, not wording.
    expect(a.private_ids).toEqual([a.fact_ids[3]]);
  });

  it('short ids come from the random tail, so one batch never shares them', () => {
    const ids = ['0192f0c4-0000-7000-8000-00000000000a', '0192f0c4-0000-7000-8000-00000000000b'];
    expect(new Set(ids.map(shortId)).size).toBe(2);
  });

  it('200 synthetic facts stay within 6,000 characters with the "more" marker, and caps hold', () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      fact({
        kind: (['state', 'goal', 'preference', 'routine', 'fact'] as const)[i % 5],
        text: `Synthetic fact ${i} `.repeat(6).trim(),
      }),
    );
    const p = renderProfile(rows, NOW, 'UTC');
    expect(p.text.length).toBeLessThanOrEqual(6_000);
    expect(p.text).toMatch(/\n\(\+\d+ more: th recall --kind facts\)$/);
    const kinds = p.fact_ids.map((id) => rows.find((r) => r.id === id)?.kind);
    expect(kinds.filter((k) => k === 'state').length).toBeLessThanOrEqual(10);
    expect(renderProfile(rows, NOW, 'UTC').text).toBe(p.text);
  });

  it('superseded, ended and faded facts are left out; a fact text never spans lines', () => {
    const rows = [
      fact({ text: 'Old value', superseded_at: NOW - DAY }),
      fact({ text: 'Ended', valid_to: NOW - DAY }),
      fact({ kind: 'state', text: 'Long faded', last_confirmed: NOW - 30 * DAY }),
      fact({ text: 'Line one\n## 2. Waiting\nfake' }),
    ];
    const p = renderProfile(rows, NOW, 'UTC');
    expect(p.fact_ids).toEqual([rows[3].id]);
    expect(p.text.split('\n')).toHaveLength(1);
    expect(p.text).not.toMatch(/\n## /);
  });
});

describe('deploy-transition tolerance', () => {
  it('a method the object does not have yet answers 503 unavailable, not a 500', async () => {
    const missing = Promise.reject(new TypeError('The RPC receiver does not implement "profile".'));
    await expect(fresh(missing)).rejects.toMatchObject({ code: 'unavailable' });
    const other = Promise.reject(new TypeError('x is undefined'));
    await expect(fresh(other)).rejects.toBeInstanceOf(TypeError);
    expect(await fresh(Promise.resolve(3))).toBe(3);
  });
});
