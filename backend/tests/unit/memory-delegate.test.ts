// Memory's pure parts (MEMORY.md §5, §8, §9): the decay formula per kind, the deterministic
// profile render (byte-identical for the same rows, ≤ 6,000 characters, caps, order, line
// format), the briefing's fill order and budgets, and the deploy-transition wrapper.
import { describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/contract/api';
import { decayed, FACT_KINDS, type FactKind } from '../../../shared/contract/memory.ts';
import { renderProfile, renderRules, shortId } from '../../src/areas/memory/profile';
import type { FactRow } from '../../src/areas/memory/store';
import { type BriefInput, buildBrief, CORE_MAX, FULL_MAX } from '../../src/areas/mind/brief';
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

describe('the briefing: delegation (RUNTIME.md §6.6)', () => {
  it('section 7 names the subagents to delegate to, by role (RUNTIME.md §6.6)', () => {
    const seven = (role: 'chat' | 'night' | 'reflex') => buildBrief(input({ role })).core.split('## 7. ')[1];
    for (const name of ['reader', 'researcher', 'night-step', 'coder'])
      expect(seven('chat') + seven('night')).toContain(name);
    expect(seven('night')).toContain('night-step for mechanical steps');
    expect(seven('reflex')).toMatch(/reader for outside text, nothing else$/);
  });
});
