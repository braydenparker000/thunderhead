// Songs' tags are outside text (MUSIC.md §10.5, MEMORY.md §7, RUNTIME.md §4.3): the Worker itself
// taints the mind session it serves them to, whatever the hooks did, and records a night session
// that read them (`songs` in GET /v1/mind/pending), whose web the PreToolUse hook closes. The taint
// carries like any other, except that a night claim on a wake the Worker fired on a later day starts
// clean once every tainted night session has ended: step 11's songs (or step 9's evals) don't label
// the next night's day note `outside` (MEMORY.md §6 M11; until 2026-11-02 they refused it). A live
// tainted session, a same-day claim or a manual one inherits.
// A mind principal reads songs' tags only from a claimed, live session (422 without one, 403 for a
// made-up one).
// The suite's cases run in order on one store.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PendingResponse, TodayResponse } from '../../../shared/contract/api';
import { MUSIC_TAINT_SOURCE } from '../../../shared/contract/music.ts';
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
/** A night session's work is over (`th night start` on a done run answers done and ends it). */
const endNight = async (session: string) => {
  const r = await apiJson('POST', '/v1/mind/night', { ...as(P.N, session), body: { day: yday, action: 'start' } });
  expect(r.status).toBe(200);
  expect((await row(session)).ended_at).not.toBeNull();
};
/** A session's taint (its first and its last event) moved back `hours` (23: yesterday evening, still
 * within the 24 hours a taint holds). */
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

describe("the Worker taints the mind session it serves songs' tags to", () => {
  it('night N reads songs (step 11): tainted, recorded as a reader, its day note outside after that', async () => {
    await brief(P.N, 'cse_mt_n1', 'night');
    await brief(P.N, 'cse_mt_an', 'night');
    expect(await noteLabel('cse_mt_n1', 'A day with music.')).toBe('owner');
    expect(await pending(P.N, 'cse_mt_n1')).toMatchObject({ songs: false });
    // A mind principal names its session, a claimed and live one, or gets no tags (a raw call can't
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
    expect(await row('cse_mt_n1')).toMatchObject({ taint_source: MUSIC_TAINT_SOURCE, ended_at: null });
    expect(await readers()).toEqual(['cse_mt_n1']);
    expect(await pending(P.N, 'cse_mt_n1')).toMatchObject({ songs: true });
    expect(await noteLabel('cse_mt_n1', 'Changed after the songs.')).toBe('outside');
    // The listening pass's read of one song names its neighbours: it marks too.
    await apiJson('GET', '/v1/music/find?moods=calm', as(P.N, 'cse_mt_an'));
    expect(await row('cse_mt_an')).toMatchObject({ taint_source: MUSIC_TAINT_SOURCE });
    expect(await readers()).toEqual(['cse_mt_an', 'cse_mt_n1']);
    await toYesterday('cse_mt_an', 25);
    // Marking it again keeps the first taint's time and source, and dates the latest event.
    const first = (await row('cse_mt_n1')).tainted_at;
    await new Promise((r) => setTimeout(r, 5));
    await apiJson('GET', '/v1/music/notes?ids=x', as(P.N, 'cse_mt_n1'));
    expect((await row('cse_mt_n1')).tainted_at).toBe(first);
    const [{ taint_event_at }] = await coreSql<{ taint_event_at: number }>(
      "SELECT taint_event_at FROM mind_sessions WHERE session_id = 'cse_mt_n1'",
    );
    expect(taint_event_at).toBeGreaterThan(first ?? 0);
    await apiJson('POST', '/v1/mind/night', { ...as(P.N, 'cse_mt_n1'), body: { day: yday, action: 'start' } });
    expect(
      (
        await apiJson('POST', '/v1/mind/night', {
          ...as(P.N, 'cse_mt_n1'),
          body: { day: yday, action: 'done', partial: true },
        })
      ).status,
    ).toBe(200);
    expect((await row('cse_mt_n1')).ended_at).not.toBeNull();
  });

  it('the chat: tainted like any outside text, carried to its next claim, and its web stays open', async () => {
    const said = await ownerSays(P.D, 'I like the quiet songs in the evening.');
    // The suite's own chat session holds the lease: let it lapse, as an idle session's does.
    const lapse = () => coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await lapse();
    await brief(P.C, 'cse_mt_c1', 'chat');
    expect((await apiJson('GET', '/v1/music/find?moods=calm', as(P.C, 'cse_mt_c1'))).status).toBe(200);
    expect(await row('cse_mt_c1')).toMatchObject({ taint_source: MUSIC_TAINT_SOURCE });
    expect(await labelled(as(P.C, 'cse_mt_c1'), addOp([`msg:${said}`]))).toBe('outside');
    expect(await pending(P.C, 'cse_mt_c1')).toMatchObject({ songs: false });
    expect(await readers()).toEqual(['cse_mt_an', 'cse_mt_n1']);
    await lapse();
    expect((await brief(P.C, 'cse_mt_c2', 'chat')).body.tainted).toBe(true);
    expect(await row('cse_mt_c2')).toMatchObject({ taint_source: `inherited:${MUSIC_TAINT_SOURCE}` });
  });
});

describe("the night after: a later day's fired wake starts clean once the tainted night has ended", () => {
  it('night N tainted by step 11 ended; night N+1 claims clean and writes its day note', async () => {
    await toYesterday('cse_mt_n1');
    await nextWake();
    const next = await brief(P.N, 'cse_mt_n2', 'night');
    expect([next.body.wake?.claim_match, next.body.tainted]).toEqual(['loose', false]);
    expect((await row('cse_mt_n2')).tainted_at).toBeNull();
    expect(await noteLabel('cse_mt_n2', 'The next night writes again.')).toBe('owner');
    expect(await pending(P.N, 'cse_mt_n2')).toMatchObject({ songs: false });
  });

  it('night N tainted by step 9 (the evals) ended; night N+1 claims clean too', async () => {
    await apiJson('POST', '/v1/mind/taint', { ...as(P.N, 'cse_mt_n2'), body: { source: 'th eval', ref_kind: 'file' } });
    expect(await noteLabel('cse_mt_n2', 'Labelled: tainted.')).toBe('outside');
    await endNight('cse_mt_n2');
    await toYesterday('cse_mt_n2', 22);
    await nextWake();
    expect((await brief(P.N, 'cse_mt_n3', 'night')).body.tainted).toBe(false);
    expect(await noteLabel('cse_mt_n3', 'Clean after the evals.')).toBe('owner');
  });

  it('a live tainted night session, and a made-up id on the next wake: it inherits', async () => {
    await apiJson('GET', '/v1/music/tracks?untagged=1&limit=5', as(P.N, 'cse_mt_n3'));
    await toYesterday('cse_mt_n3', 21);
    await nextWake();
    // cse_mt_n3 is still live: the claim could be it under a new id.
    const madeUp = await brief(P.N, 'cse_mt_madeup', 'night');
    expect([madeUp.body.wake?.claim_match, madeUp.body.tainted]).toEqual(['loose', true]);
    expect(await row('cse_mt_madeup')).toMatchObject({ taint_source: `inherited:${MUSIC_TAINT_SOURCE}` });
    expect(await noteLabel('cse_mt_madeup', 'Labelled: inherited.')).toBe('outside');
    // The songs were read before this claim: they don't close its web (a read after it would).
    expect(await pending(P.N, 'cse_mt_madeup')).toMatchObject({ songs: false });
  });

  it('a same-day claim inherits, a manual one or one on a wake fired that day', async () => {
    await endNight('cse_mt_n3');
    await endNight('cse_mt_madeup');
    // A taint from today (an ended session), then a manual claim (the 06:07 schedule's, or by hand).
    await toYesterday('cse_mt_n3', 1 / 60);
    const manual = await brief(P.N, 'cse_mt_n4', 'night');
    expect([manual.body.wake?.claim_match, manual.body.tainted]).toEqual(['manual', true]);
    await endNight('cse_mt_n4');
    // A wake fired the same day, once every tainted session ended: still inherits.
    await firedWake('night', 'session_someone_today');
    const sameDay = await brief(P.N, 'cse_mt_n5', 'night');
    expect([sameDay.body.wake?.claim_match, sameDay.body.tainted]).toEqual(['loose', true]);
    expect(await noteLabel('cse_mt_n5', 'Labelled: same day.')).toBe('outside');
  });
});
