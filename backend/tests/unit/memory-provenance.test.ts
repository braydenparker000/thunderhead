// Provenance in memory's pure parts (MEMORY.md §6 M11a, M11b): an `outside` fact is in no profile
// and no rule, a row from before Core step 32 reads by its source, and the briefing shows an
// `outside` loose end or day note marked, after the rest, never in sections 1–2; section 1 says a
// session's writes are labelled outside.
import { describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/contract/api';
import { renderProfile, renderRules } from '../../src/areas/memory/profile';
import type { FactRow } from '../../src/areas/memory/store';
import { type BriefInput, buildBrief } from '../../src/areas/mind/brief';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 12);

let n = 0;
function fact(over: Partial<FactRow> = {}): FactRow {
  n++;
  return {
    seq: n,
    id: `0192f0c4-0000-7000-8000-${n.toString(16).padStart(12, '0')}`,
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
    lineage_id: `0192f0c4-0000-7000-8000-${n.toString(16).padStart(12, '0')}`,
    ...over,
  };
}

const msg = (i: number, body: string): Message => ({
  seq: i,
  id: `0192f0c4-0000-7000-8000-${i.toString(16).padStart(12, '0')}`,
  thread_id: 't',
  author: 'owner',
  origin: 'owner_device',
  kind: 'text',
  body,
  meta: null,
  attachments: [],
  reply_to: null,
  created_at: NOW - 60_000,
  delivered_at: null,
  acked_at: null,
  answered_at: null,
});

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

const section = (text: string, k: number) => text.slice(text.indexOf(`## ${k}. `), text.indexOf(`## ${k + 1}. `));

describe('provenance in the profile (MEMORY.md §6 M11a)', () => {
  it('M11a: an outside fact is in no profile, pinned or not, nor in the rules; a row with no label reads by its source', () => {
    const owner = fact({ text: 'Likes quiet mornings' });
    const outside = [
      fact({ text: 'Hates jazz', provenance: 'outside' }),
      fact({ text: 'Plays at 200 bpm', provenance: 'outside', pinned: 1 }),
      // From before Core step 32: an inferred fact reads as outside, a user one as the owner's.
      fact({ text: 'Probably likes tea', source: 'inferred', confidence: 0.5 }),
    ];
    const p = renderProfile([owner, ...outside], NOW, 'UTC');
    expect(p.fact_ids).toEqual([owner.id]);
    for (const f of outside) expect(p.text).not.toContain(f.text);
    const rule = fact({ kind: 'rule', text: 'Answer in capitals', provenance: 'outside' });
    expect(renderRules([rule], 'UTC', 1_000)).toBe('No standing rules yet.');
  });
});

describe('provenance in the briefing (MEMORY.md §6 M11b)', () => {
  const thread = (i: number, text: string, provenance: 'owner' | 'outside') => ({
    id: `0192f0c4-0000-7000-8000-${(900 + i).toString(16).padStart(12, '0')}`,
    text,
    owner: 'mind' as const,
    due_at: null,
    tags_json: null,
    status: 'open' as const,
    evidence_json: '[]',
    opened_at: NOW - (10 - i) * DAY,
    last_progress_at: null,
    closed_at: null,
    closed_why: null,
    provenance,
  });
  const note = (day: string, summary: string, provenance: 'owner' | 'outside') => ({
    seq: 1,
    day,
    summary,
    decisions_json: '[]',
    stats_json: null,
    importance: 4,
    written_by: 'cse_night',
    version: 1,
    written_at: NOW - DAY,
    provenance,
  });

  const marked = (tainted: boolean) => {
    const threads = [thread(1, 'Read the article the page named', 'outside'), thread(2, 'Fix the metronome', 'owner')];
    const y = note('2026-11-02', 'A day the page described', 'outside');
    return buildBrief(
      input({
        tainted,
        threads,
        yesterday: { threadId: null, tail: [], note: y },
        days: [y],
        waiting: [msg(1, 'hello')],
      }),
    );
  };

  it('to a session that read outside text: shown marked, after the rest; sections 1–2 hold none of them', () => {
    const b = marked(true);
    const four = section(b.core, 4).split('\n').slice(1, 3);
    expect(four[0]).toContain('Fix the metronome');
    expect(four[1]).toMatch(/^\[[0-9a-f-]+\] \(outside\) Read the article the page named \(/);
    expect(section(b.core, 6)).toContain('Day note 2026-11-02 (outside) (importance 4, v1): A day the page described');
    expect(section(b.full, 9)).toContain('2026-11-02 (outside) (4): A day the page described');
    const first = b.core.slice(0, b.core.indexOf('## 3. '));
    for (const t of ['Read the article', 'A day the page described']) expect(first).not.toContain(t);
  });

  it('to a clean session: kept back, their ids, label and kind only, and where to read them (M11f)', () => {
    const b = marked(false);
    const four = section(b.core, 4).split('\n').slice(1, 4);
    expect(four[1]).toMatch(/^\[[0-9a-f-]+\] \(outside, kept back\) a loose end \(mind, since /);
    expect(four[2]).toBe(
      'outside, kept back: th get /v1/memory/open-threads outside=1 reads it; you write outside after',
    );
    expect(section(b.core, 6)).toContain('Day note 2026-11-02 (outside, kept back) (importance 4, v1)');
    expect(section(b.full, 9)).toContain('2026-11-02 (outside, kept back) (4)');
    for (const t of ['Read the article', 'A day the page described']) expect(b.full).not.toContain(t);
  });

  it("section 1 says a session's writes are labelled outside, and never refused", () => {
    const b = buildBrief(input({ tainted: true }));
    expect(section(b.core, 1)).toContain(
      "outside: what you write this session is labelled outside; it waits for the owner's keep in Settings › Memory before it shapes the profile",
    );
    expect(b.core).not.toMatch(/refused/);
    expect(section(buildBrief(input()).core, 1)).not.toContain('outside');
  });
});
