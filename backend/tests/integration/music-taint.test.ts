// Reading songs' tags taints the session that read them, and only that one (MUSIC.md §10.5,
// RUNTIME.md §4.7, §12.1): the night's step 11 leaves the next night free to write its day note and
// facts, one "who is this?" in the chat leaves the next chat session free to remember; but a full
// taint in the same session still carries over (without the songs), and while a session's taint
// names songs, `GET /v1/mind/pending` says so (`songs`) for the hook that closes the web.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PendingResponse, TodayResponse } from '../../../shared/contract/api';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, brief, ownerSays, type Principals, principals, reason } from '../memory-helpers';

let P = {} as Principals;
let yday = '';
const taint = (token: string, session: string, source: string) =>
  apiJson('POST', '/v1/mind/taint', { ...as(token, session), body: { source, ref_kind: 'file' } });
const dayNote = (session: string, summary: string) =>
  apiJson<{ error?: { code: string } }>('PUT', `/v1/memory/day-notes/${yday}`, {
    ...as(P.N, session),
    body: { summary, decisions: [], importance: 3 },
  });
const pending = async (token: string, session: string) =>
  (await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(token, session))).body;
const source = async (session: string) =>
  (
    await coreSql<{ taint_source: string | null }>(
      'SELECT taint_source FROM mind_sessions WHERE session_id = ?',
      session,
    )
  )[0]?.taint_source ?? null;

beforeAll(async () => {
  P = await principals();
  yday = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.day);
});

describe('the songs taint holds for its own session only', () => {
  it('night N reads songs (step 11); night N+1 still writes its day note', async () => {
    await brief(P.N, 'cse_songs_night_1', 'night');
    expect((await dayNote('cse_songs_night_1', 'A day with music.')).status).toBe(200);
    expect((await taint(P.N, 'cse_songs_night_1', 'th music')).status).toBe(200);
    expect(await pending(P.N, 'cse_songs_night_1')).toMatchObject({ songs: true });
    // Within the session the taint stands: no memory writes after the songs.
    const same = await dayNote('cse_songs_night_1', 'Changed after the songs.');
    expect([same.status, same.body.error?.code]).toEqual([403, 'session_tainted']);
    // The next night's claim inherits nothing from it.
    const next = await brief(P.N, 'cse_songs_night_2', 'night');
    expect(next.body.tainted).toBe(false);
    expect((await dayNote('cse_songs_night_2', 'The next night writes again.')).status).toBe(200);
    expect(await pending(P.N, 'cse_songs_night_2')).toMatchObject({ songs: false });
  });

  it('a "who is this?" in the chat; the next chat session still remembers', async () => {
    const said = await ownerSays(P.D, 'I like the quiet songs in the evening.');
    // The suite's own chat session holds the lease: let it lapse, as an idle session's does.
    const lapse = () => coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await lapse();
    await brief(P.C, 'cse_songs_chat_1', 'chat');
    await taint(P.C, 'cse_songs_chat_1', 'th music');
    expect(await reason(as(P.C, 'cse_songs_chat_1'), addOp([`msg:${said}`]))).toBe('session_tainted');
    await lapse();
    const next = await brief(P.C, 'cse_songs_chat_2', 'chat');
    expect(next.body.tainted).toBe(false);
    expect(await reason(as(P.C, 'cse_songs_chat_2'), addOp([`msg:${said}`]))).toBeNull();
  });

  it('a full taint after the songs carries over, without the songs; songs after a full taint keep it full', async () => {
    await brief(P.N, 'cse_songs_night_3', 'night');
    await taint(P.N, 'cse_songs_night_3', 'th music');
    await taint(P.N, 'cse_songs_night_3', 'WebFetch');
    expect(await source('cse_songs_night_3')).toBe('WebFetch+songs');
    expect(await pending(P.N, 'cse_songs_night_3')).toMatchObject({ songs: true });
    const next = await brief(P.N, 'cse_songs_night_4', 'night');
    expect(next.body.tainted).toBe(true);
    expect(await source('cse_songs_night_4')).toBe('inherited:WebFetch');
    expect(await pending(P.N, 'cse_songs_night_4')).toMatchObject({ songs: false });
    expect((await dayNote('cse_songs_night_4', 'Refused: inherited.')).status).toBe(403);
    // Songs read after that full taint: still full (it carries), and now it names songs.
    await taint(P.N, 'cse_songs_night_4', 'th music');
    expect(await source('cse_songs_night_4')).toBe('inherited:WebFetch+songs');
    expect(await pending(P.N, 'cse_songs_night_4')).toMatchObject({ songs: true });
  });
});
