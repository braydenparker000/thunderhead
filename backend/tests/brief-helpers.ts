// Synthetic rows for the briefing's pure tests (MEMORY.md §9): a fact, a message, a loose end, the
// builder's input with every field at rest, and section helpers. Invented data only.
import type { Message } from '../../shared/contract/api';
import type { OpenThreadRow } from '../src/areas/memory/notes';
import type { FactRow } from '../src/areas/memory/store';
import type { BriefInput } from '../src/areas/mind/brief';

export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 10, 3, 12);

let n = 0;
const hex = (i: number) => i.toString(16).padStart(12, '0');

export function fact(over: Partial<FactRow> = {}): FactRow {
  n++;
  return {
    seq: n,
    id: `0192f0c4-0000-7000-8000-${hex(n)}`,
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
    lineage_id: `0192f0c4-0000-7000-8000-${hex(n)}`,
    ...over,
  };
}

export const msg = (i: number, body = `message number ${i}`): Message => ({
  seq: i,
  id: `0192f0c4-0000-7000-8000-${hex(i)}`,
  thread_id: 't',
  author: 'owner',
  origin: 'owner_device',
  kind: 'text',
  body,
  meta: null,
  attachments: [],
  reply_to: null,
  created_at: NOW - (100 - i) * 60_000,
  delivered_at: null,
  acked_at: null,
  answered_at: null,
});

export const thread = (i: number, text: string, provenance: 'owner' | 'outside' = 'owner'): OpenThreadRow => ({
  id: `0192f0c4-0000-7000-8000-${hex(900 + i)}`,
  text,
  owner: 'mind',
  due_at: null,
  tags_json: null,
  status: 'open',
  evidence_json: '[]',
  opened_at: NOW - (10 - i) * DAY,
  last_progress_at: null,
  closed_at: null,
  closed_why: null,
  provenance,
});

export function input(over: Partial<BriefInput> = {}): BriefInput {
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

/** The section numbers in order, and one section's text (heading included). */
export const sections = (text: string) => [...text.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
export const section = (text: string, k: number) => {
  const start = text.indexOf(`## ${k}. `);
  const end = text.indexOf(`\n## ${k + 1}. `, start);
  return text.slice(start, end < 0 ? undefined : end).replace(/\n+$/, '');
};
