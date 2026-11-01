// NEXT-BATCH.md part 7, the night's side of Podcasts (RUNTIME.md §12.1, API.md §11.25): what
// publishers wrote (show titles, feed addresses, a feed) is served to a mind only from a named,
// claimed session, which the Worker marks tainted first (no TH-Session: 422, so raw curl gets
// nothing; a made-up one: 403); the night reads only a followed show's feed, at most 40 a UTC day,
// counted in a stored row; the owner's device is never marked or counted. Synthetic shows only.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { useFetch } from '../../src/areas/podcasts/upstream';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';

const FEED = 'https://feeds.example.org/invented-a.xml';
const OTHER = 'https://feeds.example.org/invented-b.xml';
const SESSION = 'cse_podcasts_night_reads';
let D = '';
let N = '';
let C = '';

beforeAll(async () => {
  D = (await setupOwner()).token;
  N = await makeAgent(D, 'mind:night');
  C = await makeAgent(D, 'mind:chat');
  const claim = await apiJson('POST', '/v1/mind/brief', {
    token: N,
    headers: { 'TH-Session': SESSION },
    body: { claim: true, session_id: SESSION, role: 'night', constitution_sha256: 'a'.repeat(64), th_version: '0.1.0' },
  });
  expect(claim.status).toBe(200);
  const show = (feed_url: string, followed: boolean) => ({
    feed_url,
    title: 'Invented Show',
    author: '',
    artwork: '',
    followed,
    updated_at: Date.now() - 60_000,
  });
  await apiJson('PUT', '/v1/podcasts/follows', { token: D, body: { items: [show(FEED, true), show(OTHER, false)] } });
});

const taintOf = async (session: string) =>
  (
    await coreSql<{ tainted_at: number | null; taint_source: string | null }>(
      'SELECT tainted_at, taint_source FROM mind_sessions WHERE session_id = ?',
      session,
    )
  )[0];

describe('a mind session that reads what publishers wrote is marked tainted by the Worker', () => {
  it('no TH-Session is refused (raw curl sends none); a made-up one too; the claimed one is marked', async () => {
    const bare = await apiJson<{ error: { code: string } }>('GET', '/v1/podcasts/follows?since=0', { token: N });
    expect([bare.status, bare.body.error.code]).toEqual([422, 'validation']);
    const madeUp = await apiJson<{ error: { code: string } }>('GET', '/v1/podcasts/progress?since=0', {
      token: N,
      headers: { 'TH-Session': 'cse_made_up' },
    });
    expect([madeUp.status, madeUp.body.error.code]).toEqual([403, 'session_required']);
    expect(await taintOf('cse_made_up')).toBeUndefined();
    expect((await taintOf(SESSION)).tainted_at).toBeNull();
    const ok = await apiJson('GET', '/v1/podcasts/follows?since=0', { token: N, headers: { 'TH-Session': SESSION } });
    expect(ok.status).toBe(200);
    expect(await taintOf(SESSION)).toEqual({ tainted_at: expect.any(Number), taint_source: 'podcasts' });
    // The owner's device is never marked, and reads without a session.
    expect((await apiJson('GET', '/v1/podcasts/follows?since=0', { token: D })).status).toBe(200);
  });
});

describe('the night’s feed reads', () => {
  const RSS = '<?xml version="1.0"?><rss><channel><title>Show</title></channel></rss>';
  const asked: string[] = [];
  beforeAll(() =>
    useFetch(async (input) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response(RSS, { headers: { 'Content-Type': 'application/rss+xml' } });
    }),
  );
  afterAll(() => useFetch((...a) => fetch(...a)));
  const feed = (
    token: string,
    url = FEED,
    session: Record<string, string> = token === N ? { 'TH-Session': SESSION } : {},
  ) =>
    app.fetch(
      new Request(`https://api.example.test/v1/podcasts/feed?url=${encodeURIComponent(url)}`, {
        headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10', ...session },
      }),
      env,
      createExecutionContext(),
    );

  it('mind:night reads only a followed show’s feed; the owner’s device any public one', async () => {
    asked.length = 0;
    const elsewhere = 'https://elsewhere.example.org/anything.xml';
    const r = await feed(N, elsewhere);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('not_followed');
    expect((await feed(N, OTHER)).status).toBe(403); // unfollowed
    expect(asked).toEqual([]);
    expect((await feed(D, elsewhere)).status).toBe(200);
    expect(asked).toEqual([elsewhere]);
    // A followed show's feed, but no session (curl): refused before anything is fetched.
    asked.length = 0;
    expect((await feed(N, FEED, {})).status).toBe(422);
    expect(asked).toEqual([]);
  });

  it('at most 40 a UTC day for mind:night, counted in a stored row; the owner’s device is never counted', async () => {
    await coreSql("DELETE FROM settings WHERE key = 'podcasts.night_reads'");
    for (let i = 0; i < 40; i++) expect((await feed(N)).status).toBe(200);
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await coreSql<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = 'podcasts.night_reads'",
    );
    expect(JSON.parse(row.value_json)).toEqual({ day, n: 40 });
    const r = await feed(N);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await feed(D)).status).toBe(200);
    expect((await feed(C)).status).toBe(403);
    // The count is the row's (a restart reads it back), and a new UTC day starts it over.
    await coreSql(
      "UPDATE settings SET value_json = ? WHERE key = 'podcasts.night_reads'",
      JSON.stringify({ day: '2026-01-01', n: 40 }),
    );
    expect((await feed(N)).status).toBe(200);
  });
});
