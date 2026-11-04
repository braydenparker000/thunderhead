// The briefing's assembly (MEMORY.md §9): every section in order, the core's cap and fill order
// (1, 2, 3, 4 and 8 always; then 6, 7, 5), cuts that point at the full file and past it, the night
// and reflex roles, and the full file's own budgets. The first layer is brief-layer.test.ts's.
import { describe, expect, it } from 'vitest';
import { renderRules } from '../../src/areas/memory/profile';
import { buildBrief, CORE_MAX, FULL_MAX } from '../../src/areas/mind/brief';
import { DAY, fact, input, msg, NOW, section, sections, thread } from '../brief-helpers';

describe('the briefing (MEMORY.md §9)', () => {
  it('an empty first day has every section in order, core 1–8 and full 1–15', () => {
    const b = buildBrief(input());
    expect(sections(b.core)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sections(b.full)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(b.core.match(/^## \d+\. .+$/gm)).toEqual([
      '## 1. Now',
      '## 2. The owner',
      '## 3. Waiting',
      '## 4. Standing rules',
      '## 5. Today so far',
      '## 6. Yesterday',
      '## 7. The day',
      '## 8. On demand',
    ]);
    expect(b.core).toContain('No standing rules yet.');
    expect(b.core).toContain('No open threads.');
    expect(b.core).toContain('Nothing in their own words yet.');
    // The first layer and the pointers are the same in the full file.
    expect(b.full.startsWith(b.core.slice(0, b.core.indexOf('\n\n## 3. ')))).toBe(true);
    expect(section(b.full, 8)).toBe(section(b.core, 8));
  });

  it('30 long waiting messages and 60 rules: the cap holds, 1, 2, 3, 4 and 8 stay, cuts are marked', () => {
    const waiting = Array.from({ length: 30 }, (_, i) => msg(i, `please look at this ${'x'.repeat(300)}`));
    const rules = Array.from({ length: 60 }, (_, i) =>
      fact({ kind: 'rule', text: `Rule number ${i} ${'y'.repeat(60)}` }),
    );
    const threads = Array.from({ length: 30 }, (_, i) => thread(i, `Loose end ${i} ${'z'.repeat(120)}`));
    const tail = Array.from({ length: 12 }, (_, i) => msg(40 + i, `tail ${'w'.repeat(400)}`));
    const b = buildBrief(input({ waiting, rules, threads, todayTail: tail }));
    expect(b.core.length).toBeLessThanOrEqual(CORE_MAX);
    expect(b.full.length).toBeLessThanOrEqual(FULL_MAX);
    expect(sections(b.core)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b.core).toMatch(/\(\+\d+ more waiting: th brief --section 3\)/);
    // The full file holds what the core cut, so `th brief --section 4` gives more, and points on.
    expect(section(b.full, 4).split('\n').length).toBeGreaterThan(section(b.core, 4).split('\n').length);
    expect(section(b.full, 4)).toContain('more: th get /v1/memory/facts kind=rule');
    expect(b.core).toMatch(/\(\+\d+ more: th brief --section 4\)/);
    // Section 2's loose ends point at every loose end, section 10, which points past the briefing.
    expect(section(b.core, 2)).toMatch(/\(\+\d+ more: th brief --section 10\)/);
    expect(section(b.full, 10)).toMatch(/\(\+\d+ more: th thread list\)/);
    expect(b.core).toContain('## 8. On demand\nFull briefing: $TMPDIR/th/brief.md');
    expect(b.core).not.toContain('(+cut: th brief --full)');
  });

  it('the rules render oldest first with pinned on top and no confidence', () => {
    const rules = [
      fact({ kind: 'rule', text: 'Second', recorded_at: NOW - DAY }),
      fact({ kind: 'rule', text: 'First', recorded_at: NOW - 2 * DAY }),
      fact({ kind: 'rule', text: 'Pinned', pinned: 1, recorded_at: NOW }),
    ];
    const text = renderRules(rules, 'UTC', 1_400);
    expect(text.split('\n').map((l) => l.split('] ')[1].split(' (')[0])).toEqual(['Pinned', 'First', 'Second']);
    expect(text).not.toMatch(/\(\d\.\d, /);
  });

  it("night role: sections 3 and 5 point at yesterday's thread", () => {
    const b = buildBrief(input({ role: 'night', yesterday: { threadId: 'y1', tail: [msg(1)], note: null } }));
    expect(b.core).toContain("## 3. Waiting\nYesterday's thread: y1, 1 messages; run th day 2026-11-03");
    expect(b.core).toContain('## 5. Today so far\nSee section 3.');
  });

  it('reflex reads no memory: its briefing names the memory sections without their content', () => {
    const rules = [fact({ kind: 'rule', text: 'A standing rule' })];
    const note = { body: 'A session note', created_at: NOW };
    const b = buildBrief(
      input({
        role: 'reflex',
        rules,
        profile: 'A profile line',
        days: [],
        note,
        facts: [fact({ text: 'Owner words' })],
      }),
    );
    for (const n of [2, 4, 9, 10, 11]) expect(section(b.full, n)).toContain('Not in the reflex briefing');
    for (const t of ['A standing rule', 'A profile line', 'A session note', 'Owner words'])
      expect(b.full).not.toContain(t);
    // Sections 2, 4, 9, 10 and 11, and the session-note line of 5.
    expect(b.full.match(/Not in the reflex briefing/g)).toHaveLength(6);
  });

  it('the later sections keep their budgets (today earlier ≤ 6,000)', () => {
    const earlier = Array.from({ length: 188 }, (_, i) => msg(i, 'e'.repeat(200)));
    const b = buildBrief(input({ todayEarlier: earlier }));
    const fifteen = section(b.full, 15);
    expect(fifteen.length).toBeLessThanOrEqual(6_100);
    expect(fifteen).toMatch(/\(\+\d+ more: th history today\)/);
  });
});
