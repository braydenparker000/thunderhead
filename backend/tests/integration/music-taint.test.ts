// Songs' tags are the owner's own songs (MUSIC.md §10.5, MEMORY.md §7; owner, 2026-11-22): the
// Worker marks no session it serves them to, but records a night session that read them (`songs` in
// GET /v1/mind/pending), whose web the PreToolUse hook closes, so no title leaves the Worker. A
// night principal reads songs' tags only from a claimed, live session (422 without one, 403 for a
// made-up one); the chat reads them freely. A taint (the evals' `th eval`, a web read) lasts only
// for its own session: no claim, fired, loose or manual, takes it over.
// The suite's cases run in order on one store.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PendingResponse, TodayResponse } from '../../../shared/contract/api';
import { dayBefore, HOUR } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, brief, firedWake, labelled, ownerSays, type Principals, principals } from '../memory-helpers';

let P = {} as Principals;
let yday = '';
const dayNote = (session: string, summary: string) =>
  apiJson<{ error?: { code: string }; provenance?: string }>('PUT', `/v1/memory/day-notes/${yday}`, {
    ...as(P.N, session),
    body: { summary, decisions: [], importance: 3 },
  });
/** The label a day note got (MEMORY.md §6 M11), or the status it was refused with. */
const noteLabel = async (session: string, summary: string) => {
  const r = await dayNote(session, summary);
  return r.status === 200 ? r.body.provenance : r.status;
};
const pending = async (token: string, session: string) =>
  (await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(token, session))).body;
const row = async (session: string) =>
  (
    await coreSql<{ tainted_at: number | null; taint_source: string | null; ended_at: number | null }>(
      'SELECT tainted_at, taint_source, ended_at FROM mind_sessions WHERE session_id = ?',
      session,
    )
  )[0];
/** The night sessions Core recorded as having read songs' tags. */
const readers = async () =>
  (
    await coreSql<{ session_id: string }>(
      'SELECT session_id FROM mind_sessions WHERE songs_at IS NOT NULL ORDER BY session_id',
    )
  ).map((r) => r.session_id);
/** A session's taint (its first and its last event) moved back `hours`. */
const toYesterday = (session: string, hours = 23) =>
  coreSql(
    'UPDATE mind_sessions SET tainted_at = ?1, taint_event_at = ?1 WHERE session_id = ?2',
    Date.now() - hours * HOUR,
    session,
  );
/** The next night's wake, fired for another session (a loose claim: R-6 unverified): 26 hours after
 * a taint moved to yesterday, so on a later logical day whatever the hour or a DST change. */
const nextWake = () => firedWake('night', `session_someone_${Math.random().toString(36).slice(2)}`, 3 * HOUR);

beforeAll(async () => {
  P = await principals();
  yday = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.day);
});

describe("the Worker records the night's songs and marks no session", () => {
  it("night N reads songs (step 11): unmarked, recorded as a reader, its day note still the owner's", async () => {
    await brief(P.N, 'cse_mt_n1', 'night');
    await brief(P.N, 'cse_mt_an', 'night');
    expect(await noteLabel('cse_mt_n1', 'A day with music.')).toBe('owner');
    expect(await pending(P.N, 'cse_mt_n1')).toMatchObject({ songs: false });
    // A night principal names its session, a claimed and live one, or gets no tags (a raw call can't
    // read them unrecorded); the device needs none.
    const song = `r2_native_${'0'.repeat(64)}`;
    for (const path of [
      '/v1/music/tracks?untagged=1&limit=5',
      `/v1/music/notes?ids=${song}`,
      '/v1/music/find?moods=calm',
    ]) {
      const bare = await apiJson<{ error: { code: string; details: { path: string }[] } }>('GET', path, { token: P.N });
      expect([bare.status, bare.body.error.details[0].path], path).toEqual([422, 'TH-Session']);
      const madeUp = await apiJson<{ error: { code: string } }>('GET', path, as(P.N, 'cse_mt_made_up'));
      expect([madeUp.status, madeUp.body.error.code], path).toEqual([403, 'session_required']);
    }
    expect(await row('cse_mt_made_up')).toBeUndefined();
    expect((await apiJson('GET', `/v1/music/notes?ids=${song}`, { token: P.D })).status).toBe(200);
    expect(await readers()).toEqual([]);
    expect((await apiJson('GET', '/v1/music/tracks?untagged=1&limit=5', as(P.N, 'cse_mt_n1'))).status).toBe(200);
    expect(await row('cse_mt_n1')).toMatchObject({ tainted_at: null, taint_source: null, ended_at: null });
    expect(await readers()).toEqual(['cse_mt_n1']);
    expect(await pending(P.N, 'cse_mt_n1')).toMatchObject({ songs: true });
    expect(await noteLabel('cse_mt_n1', 'Changed after the songs.')).toBe('owner');
    // The listening pass's read of one song names its neighbours: recorded too, still unmarked.
    await apiJson('GET', '/v1/music/find?moods=calm', as(P.N, 'cse_mt_an'));
    expect(await row('cse_mt_an')).toMatchObject({ tainted_at: null });
    expect(await readers()).toEqual(['cse_mt_an', 'cse_mt_n1']);
    await apiJson('POST', '/v1/mind/night', { ...as(P.N, 'cse_mt_n1'), body: { day: yday, action: 'start' } });
    const done = { day: yday, action: 'done', partial: true };
    expect((await apiJson('POST', '/v1/mind/night', { ...as(P.N, 'cse_mt_n1'), body: done })).status).toBe(200);
    expect((await row('cse_mt_n1')).ended_at).not.toBeNull();
  });

  it("the chat: unmarked, its writes the owner's, not recorded as a reader, and its web stays open", async () => {
    const said = await ownerSays(P.D, 'I like the quiet songs in the evening.');
    // The suite's own chat session holds the lease: let it lapse, as an idle session's does.
    await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await brief(P.C, 'cse_mt_c1', 'chat');
    expect((await apiJson('GET', '/v1/music/find?moods=calm', as(P.C, 'cse_mt_c1'))).status).toBe(200);
    expect((await apiJson('GET', '/v1/music/find?moods=calm', { token: P.C })).status).toBe(200);
    expect(await row('cse_mt_c1')).toMatchObject({ tainted_at: null });
    expect(await labelled(as(P.C, 'cse_mt_c1'), addOp([`msg:${said}`]))).toBe('owner');
    expect(await pending(P.C, 'cse_mt_c1')).toMatchObject({ songs: false });
    expect(await readers()).toEqual(['cse_mt_an', 'cse_mt_n1']);
  });
});

describe('a taint lasts only for its session: no claim takes it over', () => {
  it('night N tainted by step 9 (the evals): its own day note outside; every later claim clean', async () => {
    await brief(P.N, 'cse_mt_n2', 'night');
    await apiJson('POST', '/v1/mind/taint', { ...as(P.N, 'cse_mt_n2'), body: { source: 'th eval', ref_kind: 'file' } });
    expect(await noteLabel('cse_mt_n2', 'Labelled: tainted.')).toBe('outside');
    // cse_mt_n2 is still live: a loose claim on the next wake, a manual one and a same-day one start clean.
    await nextWake();
    const loose = await brief(P.N, 'cse_mt_n3', 'night');
    expect([loose.body.wake?.claim_match, loose.body.tainted]).toEqual(['loose', false]);
    expect((await row('cse_mt_n3')).tainted_at).toBeNull();
    expect(await noteLabel('cse_mt_n3', 'Clean after the evals.')).toBe('owner');
    await toYesterday('cse_mt_n2', 1 / 60);
    const manual = await brief(P.N, 'cse_mt_n4', 'night');
    expect([manual.body.wake?.claim_match, manual.body.tainted]).toEqual(['manual', false]);
    await firedWake('night', 'session_someone_today');
    const sameDay = await brief(P.N, 'cse_mt_n5', 'night');
    expect([sameDay.body.wake?.claim_match, sameDay.body.tainted]).toEqual(['loose', false]);
    expect(await noteLabel('cse_mt_n5', 'Clean the same day.')).toBe('owner');
    // The tainted session itself stays marked.
    expect(await noteLabel('cse_mt_n2', 'Still labelled.')).toBe('outside');
  });

  it("songs read before a claim don't close its web; a sibling's read after it does", async () => {
    expect(await pending(P.N, 'cse_mt_n5')).toMatchObject({ songs: false });
    await apiJson('GET', '/v1/music/tracks?untagged=1&limit=5', as(P.N, 'cse_mt_n4'));
    expect(await pending(P.N, 'cse_mt_n5')).toMatchObject({ songs: true });
    expect(await row('cse_mt_n5')).toMatchObject({ tainted_at: null });
  });
});
