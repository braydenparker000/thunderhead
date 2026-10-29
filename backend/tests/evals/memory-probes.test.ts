// Memory evals, the Worker's half (EVALS.md §3, MEMORY.md §11 acceptance): the synthetic seed
// (mind/evals/seed.jsonl) goes in through the real API as a session would write it, and every
// probe in mind/evals/probes/memory.json must be answerable from what a fresh session gets
// (search over facts, the profile, the rules): a stated fact is recalled (A), the newer value wins
// over the one it replaced (D), nothing is invented where memory is empty (E), and a forgotten
// fact is gone from the briefing and search. Future memory changes must keep these passing.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SearchResponse } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson } from '../helpers';
import { addOp, as, brief, CHAT_SESSION, ops, ownerSays, type Principals, principals } from '../memory-helpers';

const raw = (files: Record<string, unknown>) => Object.values(files)[0] as string;
const seed = raw(import.meta.glob('../../../mind/evals/seed.jsonl', { query: '?raw', import: 'default', eager: true }));
const probes = JSON.parse(
  raw(import.meta.glob('../../../mind/evals/probes/memory.json', { query: '?raw', import: 'default', eager: true })),
) as {
  probes: { id: string; cat: string; query: string; expected_keys: string[]; forbidden_keys: string[] }[];
  rules: { id: string; expected_keys: string[] }[];
  forgotten: string[];
};

type Line =
  | { t: 'say'; ref: string; body: string }
  | { t: 'add'; ref: string; kind: string; subject: string; text: string; evidence: string[] }
  | { t: 'supersede'; of: string; ref: string; text: string; evidence: string[] }
  | { t: 'forget'; of: string };

let P = {} as Principals;
let core = '';
let full = '';
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const section = (text: string, n: number) => {
  const at = text.indexOf(`## ${n}. `);
  const next = text.indexOf('\n## ', at + 1);
  return at < 0 ? '' : text.slice(at, next < 0 ? undefined : next);
};

beforeAll(async () => {
  P = await principals();
  const ids = new Map<string, string>();
  const ev = (refs: string[]) => refs.map((r) => `msg:${ids.get(r)}`);
  for (const l of seed
    .trim()
    .split('\n')
    .map((x) => JSON.parse(x) as Line)) {
    if (l.t === 'say') ids.set(l.ref, await ownerSays(P.D, l.body));
    else if (l.t === 'add') {
      const op = addOp(ev(l.evidence), { kind: l.kind as never, subject: l.subject, text: l.text });
      ids.set(l.ref, op.id);
      expect((await ops(as(P.C, CHAT_SESSION), [op])).status).toBe(200);
    } else if (l.t === 'supersede') {
      const id = uuidv7();
      const r = await ops(as(P.C, CHAT_SESSION), [
        { op: 'supersede', id: ids.get(l.of), new: { id, text: l.text, evidence: ev(l.evidence) } },
      ]);
      expect(r.body.applied).toHaveLength(1);
      ids.set(l.ref, id);
    } else expect((await ops({ token: P.D }, [{ op: 'forget', id: ids.get(l.of) }])).status).toBe(200);
  }
  const b = (await brief(P.C, CHAT_SESSION, 'chat')).body;
  core = b.core;
  full = b.full;
});

const recall = async (q: string) =>
  (await apiJson<SearchResponse>('GET', `/v1/search?q=${encodeURIComponent(q)}&sources=facts`, { token: P.D })).body
    .items;

describe('memory probes on the synthetic seed', () => {
  it.each(probes.probes)('$id ($cat): $query', async (p) => {
    const hits = await recall(p.query);
    // What a fresh session has for this question: the fact hits and the profile.
    const known = fold([...hits.map((h) => h.snippet.replace(/[«»]/g, '')), section(full, 8)].join('\n'));
    for (const k of p.forbidden_keys) expect(known, `${p.id} must not surface "${k}"`).not.toContain(fold(k));
    if (p.cat === 'E') expect(hits, `${p.id}: nothing to recall`).toEqual([]);
    else {
      expect(hits.length, `${p.id}: recalled`).toBeGreaterThan(0);
      for (const k of p.expected_keys) expect(fold(hits[0].snippet), `${p.id} top hit has "${k}"`).toContain(fold(k));
    }
  });

  it.each(probes.rules)('$id: the standing rule is in core section 3', (r) => {
    for (const k of r.expected_keys) expect(section(core, 3)).toContain(k);
  });

  it('a forgotten fact is in no briefing section and no fact search', async () => {
    for (const words of probes.forgotten) {
      for (const n of [3, 4, 8, 9]) expect(fold(section(full, n))).not.toContain(fold(words));
      expect(await recall(words)).toEqual([]);
    }
  });
});
