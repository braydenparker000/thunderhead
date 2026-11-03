// The briefing's delegation line (RUNTIME.md §6.6): section 7 names the subagents each role may
// hand work to.
import { describe, expect, it } from 'vitest';
import { type BriefInput, buildBrief } from '../../src/areas/mind/brief';

const NOW = Date.UTC(2026, 10, 3, 12);

function input(over: Partial<BriefInput> = {}): BriefInput {
  return {
    role: 'chat',
    constitution: 'a'.repeat(64),
    laws: 'laws: pinned',
    decisions: [],
    tainted: false,
    now: NOW,
    tz: 'UTC',
    day: '2026-11-03',
    wakeReason: 'message',
    wakesToday: 1,
    prewarmsLeft: 8,
    backoffUntil: 0,
    quietUntil: 0,
    threadId: 'today',
    waiting: [],
    todayTail: [],
    todayEarlier: [],
    note: null,
    yesterday: { threadId: null, tail: [], note: null },
    ledger: [],
    errorsOpen: 0,
    watchdogs: [],
    rules: [],
    threads: [],
    profile: 'Nothing known yet.',
    days: [],
    night: null,
    ...over,
  };
}

describe('the briefing: delegation (RUNTIME.md §6.6)', () => {
  it('section 7 names the subagents to delegate to, by role (RUNTIME.md §6.6)', () => {
    const seven = (role: 'chat' | 'night' | 'reflex') => buildBrief(input({ role })).core.split('## 7. ')[1];
    for (const name of ['reader', 'researcher', 'night-step', 'coder'])
      expect(seven('chat') + seven('night')).toContain(name);
    expect(seven('night')).toContain('night-step for mechanical steps');
    expect(seven('reflex')).toMatch(/reader for outside text, nothing else$/);
  });
});
