// The Worker's refusals for threads, titles and surfaces name each rule with its number and what was
// sent (its length or type, never its value): no "Invalid input" reaches the mind (owner, 2026-11-22).
import { describe, expect, it } from 'vitest';
import { patchThread, threadTitle } from '../../src/areas/conversation/schema';
import { threadBody } from '../../src/areas/memory/routes';
import { putBody } from '../../src/areas/surfaces/routes';
import { ApiError } from '../../src/http/errors';
import { parse } from '../../src/http/validate';

function issues(schema: Parameters<typeof parse>[0], raw: unknown): { path: string; issue: string }[] {
  try {
    parse(schema, raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError & { details: { path: string; issue: string }[] }).details;
  }
  throw new Error('parsed');
}

describe('plain refusals', () => {
  it('an open thread: the limit and the length, every fault at once', () => {
    const got = issues(threadBody, { text: 'x'.repeat(212), owner: 'nobody', evidence: 'm1', extra: 1 });
    expect(got).toEqual([
      { path: 'text', issue: 'at most 200 characters; yours has 212' },
      { path: 'owner', issue: 'one of "mind", "owner"' },
      { path: 'evidence', issue: 'array; yours is string' },
      { path: '', issue: 'not a known field: extra' },
    ]);
  });
  it('a title: its length, and required when missing', () => {
    expect(issues(patchThread, { title: 't'.repeat(95) })).toEqual([
      { path: 'title', issue: 'at most 80 characters; yours has 95' },
    ]);
    expect(issues(threadTitle, {})).toEqual([{ path: 'title', issue: 'required: string' }]);
  });
  it('a surface: --why with its minimum, the topic key with its form', () => {
    const got = issues(putBody, {
      kind: 'line',
      schema: 1,
      payload: { text: 'Hi there' },
      why: 'short',
      topic_key: 'Big Topic',
    });
    expect(got.map((i) => i.path)).toEqual(['why', 'topic_key']);
    expect(got[0].issue).toBe('at least 8 characters; yours has 5');
    expect(got[1].issue).toMatch(/^the form /);
    for (const i of got) expect(i.issue).not.toContain('Invalid input');
  });
});
