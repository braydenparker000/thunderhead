// The briefing in parts (brief-parts.ts): three parts of whole sections in the order the hook prints
// them, each ≤ 9,400 characters; overflow drops whole sections from a part's end with the marker;
// waiting messages carry their memories; today's messages are whole up to 1,200 characters, oldest
// dropped first; the owner's profile is folded into section 2; every rule the owner gave, newest
// first; reflex reads no memory. And the recall pick: never the message's own conversation, never
// a memory labelled outside, at most 5, each ≤ 200 characters. Invented data only.
import { describe, expect, it } from 'vitest';
import { BRIEF_PARTS, RECALL_LIMITS } from '../../../shared/contract/mind-brief';
import { pickRecall, wantsRecall } from '../../src/areas/feed/recall';
import { briefParts, fitPart, PART_CUT } from '../../src/areas/mind/brief-parts';
import { fact, input, msg, NOW } from '../brief-helpers';

const heads = (part: string) => part.match(/^## .+$/gm);

describe('the briefing in parts', () => {
  it('three parts with their sections in order, each under the cap', () => {
    const parts = briefParts(input());
    expect(parts).toHaveLength(3);
    expect(heads(parts[0])).toEqual(['## 1. Now', '## 3. Waiting', '## 2. The owner', '## 4. Standing rules']);
    expect(heads(parts[1])).toEqual(["## Today's conversation", '## 5. Today so far']);
    expect(heads(parts[2])).toEqual([
      '## 10. Open threads',
      '## 6. Yesterday',
      '## 11. Last 7 days',
      '## 13. Your settings',
      '## 14. Health',
      '## 7. The day',
      '## 8. On demand',
    ]);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(BRIEF_PARTS.chars);
  });

  it('a waiting message carries its memories; the profile and every rule are in part 1', () => {
    const waiting = [msg(1, 'what did I say about the garden fence')];
    const rules = Array.from({ length: 12 }, (_, i) =>
      fact({ kind: 'rule', text: `Rule ${i}: keep replies short`, recorded_at: NOW - (20 - i) * 60_000 }),
    );
    const parts = briefParts(
      input({
        waiting,
        rules,
        profile: 'Lives with a cat called Pepper.\nWalks at dawn.',
        recall: { [waiting[0].id]: [{ ref: 'fact:x', kind: 'facts', text: 'The fence is painted green' }] },
      }),
    );
    expect(parts[0]).toContain(`${waiting[0].body}\n  recall [fact:x] The fence is painted green`);
    expect(parts[0]).toContain('Profile:\nLives with a cat called Pepper.');
    const rulesAt = parts[0].indexOf('## 4. Standing rules');
    expect(parts[0].indexOf('Rule 11:', rulesAt)).toBeLessThan(parts[0].indexOf('Rule 0:', rulesAt));
  });

  it("today's messages: whole up to 1,200 characters, oldest dropped first, under the cap", () => {
    const long = Array.from({ length: 30 }, (_, i) => msg(i + 1, `${i} `.repeat(800)));
    const parts = briefParts(input({ todayTail: long.slice(-12), todayEarlier: long.slice(0, -12) }));
    expect(parts[1].length).toBeLessThanOrEqual(BRIEF_PARTS.chars);
    expect(parts[1]).toContain('earlier: th history today)');
    expect(parts[1]).toContain(long[29].id);
    expect(parts[1]).not.toContain(`[${long[0].id}]`);
    for (const l of parts[1].split('\n')) expect(l.length).toBeLessThanOrEqual(1_200);
  });

  it('a part over the cap drops whole sections from its end with the marker', () => {
    const big = 'x'.repeat(5_000);
    const out = fitPart([
      ['A', big],
      ['B', big],
      ['C', 'small'],
    ]);
    expect(out).toBe(`## A\n${big}\n${PART_CUT}`);
  });

  it('reflex reads no memory in its parts', () => {
    const parts = briefParts(
      input({ role: 'reflex', profile: 'Secret profile line', rules: [fact({ kind: 'rule' })] }),
    );
    expect(parts.join('\n')).not.toContain('Secret profile line');
    expect(parts[0]).toContain('Not in the reflex briefing');
  });
});

describe('the recall pick', () => {
  const hit = (ref: string, over: Record<string, unknown> = {}) => ({
    source: 'facts' as const,
    ref,
    snippet: `snippet of ${ref}`,
    at: NOW,
    provenance: 'owner' as const,
    ...over,
  });

  it('keeps out the own conversation and outside memories; at most 5, each ≤ 200 characters', () => {
    const hits = [
      hit('msg:today', { source: 'messages', thread_id: 'today' }),
      hit('fact:out', { provenance: 'outside' }),
      hit('msg:old', { source: 'messages', thread_id: 'old', provenance: 'outside' }),
      ...Array.from({ length: 8 }, (_, i) => hit(`fact:${i}`, { snippet: 'y'.repeat(400) })),
    ];
    const got = pickRecall(hits, 'today');
    expect(got.map((r) => r.ref)).toEqual(['msg:old', 'fact:0', 'fact:1', 'fact:2', 'fact:3']);
    expect(got[0]).toEqual({ ref: 'msg:old', kind: 'messages', text: 'snippet of msg:old' });
    expect(got[1].text).toHaveLength(RECALL_LIMITS.text);
  });

  it('no search for a short message or one off the record', () => {
    expect(wantsRecall('ok thanks', 't', [])).toBe(false);
    expect(wantsRecall('what did we decide about the trip', 't', ['t'])).toBe(false);
    expect(wantsRecall('what did we decide about the trip', 't', [])).toBe(true);
  });
});
