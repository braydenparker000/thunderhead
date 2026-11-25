// A server error's message in the log (http/scrub.ts, owner 2026-11-25): what explains an outage
// stays; an address, an email, a long quoted string or a key-like run becomes `…`; whitespace is
// collapsed and the line is at most 300 characters.
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onError } from '../../src/http/errors';
import { MESSAGE_MAX, scrubMessage } from '../../src/http/scrub';

describe('scrubMessage', () => {
  it('keeps a plain message as it is', () => {
    expect(scrubMessage("Cannot read properties of undefined (reading 'get')")).toBe(
      "Cannot read properties of undefined (reading 'get')",
    );
    expect(scrubMessage('D1_ERROR: SQLITE_CONSTRAINT_PRIMARYKEY on track_notes')).toBe(
      'D1_ERROR: SQLITE_CONSTRAINT_PRIMARYKEY on track_notes',
    );
  });

  it('drops a whole address, its query and an add-on key in its path included', () => {
    const out = scrubMessage(
      'fetch failed for https://addon.example/eyJpbnZlbnRlZCI6dHJ1ZX0/manifest.json?token=abc and http://x.example?b=1',
    );
    expect(out).toBe('fetch failed for … and …');
  });

  it('drops emails, long quoted strings and long hex or base64 runs', () => {
    expect(scrubMessage('no account for someone@example.com')).toBe('no account for …');
    expect(scrubMessage('bad title "a long title someone typed, word after word"')).toBe('bad title …');
    expect(scrubMessage("short 'quoted bit' stays")).toBe("short 'quoted bit' stays");
    expect(scrubMessage('hash aa11bb22cc33dd44ee55ff6600778899aabbccdd not found')).toBe('hash … not found');
    expect(scrubMessage('key dGhpcyBpcyBhIHNlY3JldCBrZXk= refused')).toBe('key … refused');
    expect(scrubMessage('id 0123456789abcdef01234 is short')).toBe('id 0123456789abcdef01234 is short');
  });

  it('collapses whitespace and caps the length', () => {
    expect(scrubMessage('  one\n\ttwo   three \n')).toBe('one two three');
    const long = scrubMessage('word '.repeat(200));
    expect(long.length).toBe(MESSAGE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('takes anything: no message is an empty one', () => {
    expect(scrubMessage(undefined)).toBe('');
    expect(scrubMessage(42)).toBe('42');
  });
});

describe('the error log line', () => {
  afterEach(() => vi.restoreAllMocks());

  it('carries the scrubbed message beside the name', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => void lines.push(String(line)));
    const app = new Hono()
      .get('/x', () => {
        throw new TypeError('fetch failed for https://addon.example/secret-path-0011/manifest.json');
      })
      .onError(onError);
    const res = await app.request('/x');
    expect(res.status).toBe(500);
    const logged = JSON.parse(lines.find((l) => l.includes('"evt":"error"')) ?? '{}');
    expect([logged.name, logged.message]).toEqual(['TypeError', 'fetch failed for …']);
  });
});
