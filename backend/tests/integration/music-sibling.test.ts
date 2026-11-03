// The final verification's H1, L2 and L4 (RUNTIME.md §4.3, §6.4; MEMORY.md §7): a night session
// can't read songs' tags under a sibling's id and stay clean. Every taint event is dated, so a
// sibling's read after a claim counts against that claim's memory writes; a night session's web
// closes once any night session read songs' tags since it claimed; a night call that names no
// session is closed. A session note written after outside text reaches no clean reader's briefing
// or day in its own words. The cases run in order on one store. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PendingResponse, TodayResponse } from '../../../shared/contract/api';
import { LEFT_OUT } from '../../src/areas/mind/notes';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, HOUR } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import {
  addOp,
  as,
  brief,
  firedWake,
  labelled,
  ownerSays,
  type Principals,
  principals,
  reason,
} from '../memory-helpers';

let P = {} as Principals;
let yday = '';
const dayNote = (session: string, summary: string) =>
  apiJson<{ error?: { code: string } }>('PUT', `/v1/memory/day-notes/${yday}`, {
    ...as(P.N, session),
    body: { summary, decisions: [], importance: 3 },
  });
const songs = async (call: { token: string; headers?: Record<string, string> }) =>
  (await apiJson<PendingResponse>('GET', '/v1/mind/pending', call)).body.songs;
const tags = (session: string) => apiJson('GET', '/v1/music/tracks?untagged=1&limit=5', as(P.N, session));

beforeAll(async () => {
  P = await principals();
  yday = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: P.D })).body.day);
  // Last night's session N0: tainted by its songs 23 hours ago (within the 24 hours a taint holds).
  await brief(P.N, 'cse_sib_n0', 'night');
  await tags('cse_sib_n0');
  const t = Date.now() - 23 * HOUR;
  await coreSql(
    "UPDATE mind_sessions SET tainted_at = ?1, taint_event_at = ?1, songs_at = ?1, ended_at = ?1 WHERE session_id = 'cse_sib_n0'",
    t,
  );
});

describe('a sibling session id', () => {
  it("the verifier's scenario: a sibling claim that reads tags leaves N1 refused for memory, its web closed", async () => {
    // N1: tonight's session, the very one the Worker fired after N0's taint: clean.
    await firedWake('night', 'session_sib_n1');
    expect((await brief(P.N, 'cse_sib_n1', 'night')).body.tainted).toBe(false);
    expect(await songs(as(P.N, 'cse_sib_n1'))).toBe(false);
    const said = await ownerSays(P.D, 'Tomorrow I start the new routine.');
    expect(await reason(as(P.N, 'cse_sib_n1'), addOp([`msg:${said}`]))).toBeNull();
    // N1 claims a sibling id by hand (it inherits N0's taint) and reads songs' tags as that id.
    expect((await brief(P.N, 'cse_sib_x', 'night')).body.tainted).toBe(true);
    const [x] = await coreSql<{ tainted_at: number }>(
      "SELECT tainted_at FROM mind_sessions WHERE session_id = 'cse_sib_x'",
    );
    expect((await tags('cse_sib_x')).status).toBe(200);
    // The read is a dated event (the inherited first taint keeps its time), after N1's claim.
    const [after] = await coreSql<{ tainted_at: number; taint_event_at: number; claimed: number }>(
      `SELECT x.tainted_at, x.taint_event_at, n1.claimed_at AS claimed FROM mind_sessions x, mind_sessions n1
       WHERE x.session_id = 'cse_sib_x' AND n1.session_id = 'cse_sib_n1'`,
    );
    expect(after.tainted_at).toBe(x.tainted_at);
    expect(after.taint_event_at).toBeGreaterThanOrEqual(after.claimed);
    // N1, under its own id: what it writes is labelled outside (MEMORY.md §6 M11), and its web is closed.
    expect(await labelled(as(P.N, 'cse_sib_n1'), addOp([`msg:${said}`]))).toBe('outside');
    const note = await dayNote('cse_sib_n1', 'Written after a sibling read the songs.');
    expect([note.status, (note.body as { provenance?: string }).provenance]).toEqual([200, 'outside']);
    expect(await songs(as(P.N, 'cse_sib_n1'))).toBe(true);
  });

  it("a read before a session claimed doesn't close its web; a later one does, by any night session", async () => {
    await firedWake('night', 'session_sib_n2');
    expect((await brief(P.N, 'cse_sib_n2', 'night')).body.tainted).toBe(false);
    expect(await songs(as(P.N, 'cse_sib_n2'))).toBe(false);
    expect((await tags('cse_sib_n1')).status).toBe(200);
    expect(await songs(as(P.N, 'cse_sib_n2'))).toBe(true);
  });

  it('L2: a night call naming no session, or one the Worker never saw, is closed; the chat never', async () => {
    expect(await songs({ token: P.N })).toBe(true);
    expect(await songs(as(P.N, 'cse_sib_unknown'))).toBe(true);
    expect(await songs(as(P.C, 'cse_memory_chat_1'))).toBe(false);
    expect(await songs({ token: P.C })).toBe(false);
  });
});

describe('L4: a session note written after outside text', () => {
  it('reaches no clean reader in its own words: the night’s day and the next briefing leave it out', async () => {
    const post = (session: string, body: string) =>
      apiJson('POST', '/v1/mind/notes', { ...as(P.N, session), body: { id: uuidv7(), body, open_items: [] } });
    // Step 10's note, written by a night that read songs (step 11): kept, marked, its words held back.
    expect((await post('cse_sib_n1', 'A synthetic note after the songs.')).status).toBe(201);
    const [marked] = await coreSql<{ id: string; tainted: number }>(
      'SELECT id, tainted FROM session_notes ORDER BY created_at DESC LIMIT 1',
    );
    expect(marked.tainted).toBe(1);
    // The next clean night (the taints a day old): it reads the day's notes through `th day`, where
    // the note is a line saying one was left out (moved into yesterday here), and the chat's briefing
    // shows the same line as its latest note.
    await coreSql(
      `UPDATE mind_sessions SET tainted_at = ?1, taint_event_at = ?1, songs_at = NULL, ended_at = coalesce(ended_at, ?2)
       WHERE role = 'night'`,
      Date.now() - 25 * HOUR,
      Date.now(),
    );
    await firedWake('night', 'session_sib_n3');
    const next = await brief(P.N, 'cse_sib_n3', 'night');
    expect(next.body.tainted).toBe(false);
    expect(next.body.full).not.toContain('A synthetic note after the songs.');
    await coreSql('UPDATE session_notes SET created_at = ? WHERE id = ?', Date.now() - 24 * HOUR, marked.id);
    const day = await apiJson<{ items: { body: string; open_items: unknown[] }[] }>(
      'GET',
      `/v1/mind/day/${yday}?part=notes`,
      as(P.N, 'cse_sib_n3'),
    );
    expect(day.body.items.map((i) => [i.body, i.open_items])).toEqual([[LEFT_OUT, []]]);
    await coreSql('UPDATE session_notes SET created_at = ? WHERE id = ?', Date.now(), marked.id);
    await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await firedWake('chat', 'session_sib_chat');
    const chat = await brief(P.C, 'cse_sib_chat', 'chat');
    expect(chat.body.full).toContain(`: ${LEFT_OUT}`);
    expect(chat.body.full).not.toContain('A synthetic note after the songs.');
    // A clean session's note is read as written.
    expect((await post('cse_sib_n3', 'A synthetic clean note.')).status).toBe(201);
    await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await firedWake('chat', 'session_sib_chat_2');
    expect((await brief(P.C, 'cse_sib_chat_2', 'chat')).body.full).toContain('A synthetic clean note.');
  });
});
