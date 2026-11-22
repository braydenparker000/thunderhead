// The list for the builder over HTTP (shared/contract/issues.ts, API.md §11.30): the owner adds,
// edits, marks done and reopens; the chat mind files an item only citing an owner-device message of
// the last 48 hours, from a clean claimed session, and adds notes; night, reflex and the ci key read
// it; nothing is ever deleted. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import type { IssueResponse, IssuesResponse } from '../../../shared/contract/issues.ts';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR } from '../../src/lib/time';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { as, CHAT_SESSION, mindSays, ownerSays, principals } from '../memory-helpers';

type Out = IssueResponse & ErrorBody;
let D = '';
let C = '';
let N = '';
let R = '';
let I = '';
const chat = () => as(C, CHAT_SESSION);
const put = (call: object, body: object, id = uuidv7()) => apiJson<Out>('PUT', `/v1/issues/${id}`, { ...call, body });
const issue = (r: { body: Out }) => {
  const d = r.body.error?.details;
  return Array.isArray(d) ? d[0] : undefined;
};
const list = async (q = '', token = D) => (await apiJson<IssuesResponse>('GET', `/v1/issues${q}`, { token })).body;

beforeAll(async () => {
  ({ D, C, N } = await principals());
  R = await makeAgent(D, 'mind:reflex');
  I = await makeAgent(D, 'ci');
});

describe('the owner', () => {
  it('adds one by hand; the same request again is the same answer, another body a conflict', async () => {
    const id = uuidv7();
    const body = {
      title: '  Music skips the first second  ',
      what: 'Every song.\nSince today.',
      where: 'Music',
      kind: 'broken',
    };
    const first = await put({ token: D }, body, id);
    expect(first.status).toBe(201);
    expect(first.body.issue).toMatchObject({
      id,
      title: 'Music skips the first second',
      what: 'Every song.\nSince today.',
      where: 'Music',
      kind: 'broken',
      origin: 'owner_device',
      from_message_id: null,
      state: 'open',
      done_at: null,
      notes: [],
    });
    expect(first.body.issue).toHaveProperty('release');
    const again = await put({ token: D }, body, id);
    expect([again.status, again.body]).toEqual([200, first.body]);
    const other = await put({ token: D }, { ...body, title: 'Other' }, id);
    expect([other.status, other.body.error.code]).toEqual([409, 'conflict']);
  });

  it('refuses words that are empty, too long or not one plain line, and a cited message', async () => {
    for (const title of ['', '   ', 'x'.repeat(121), 'two\nlines', 'pay ‮bad'])
      expect((await put({ token: D }, { title, what: 'It broke.' })).status, JSON.stringify(title)).toBe(422);
    expect((await put({ token: D }, { title: 'Slow', what: 'x'.repeat(1_001) })).status).toBe(422);
    expect((await put({ token: D }, { title: 'Slow', what: 'Slow', kind: 'awful' })).status).toBe(422);
    const msg = await ownerSays(D, 'the menu is slow');
    const cited = await put({ token: D }, { title: 'Slow', what: 'Slow', from_message_id: msg });
    expect([cited.status, issue(cited)?.path]).toEqual([422, 'from_message_id']);
  });

  it('edits, marks done and reopens; done ones leave the open list; nothing is deleted', async () => {
    const made = (await put({ token: D }, { title: 'The ring is late', what: 'It opens slowly.' })).body.issue;
    expect(made.kind).toBe('annoying');
    const patch = (body: object) => apiJson<Out>('PATCH', `/v1/issues/${made.id}`, { token: D, body });
    const edited = await patch({ title: 'The ring opens late', where: 'Home' });
    expect(edited.body.issue).toMatchObject({ title: 'The ring opens late', where: 'Home', state: 'open' });
    const done = await patch({ state: 'done' });
    expect(done.body.issue.state).toBe('done');
    expect(done.body.issue.done_at).toBeGreaterThan(0);
    expect((await list()).items.map((i) => i.id)).not.toContain(made.id);
    expect((await list('?state=done')).items.map((i) => i.id)).toEqual([made.id]);
    const back = await patch({ state: 'open' });
    expect([back.body.issue.state, back.body.issue.done_at]).toEqual(['open', null]);
    expect((await list()).items[0]?.id).toBe(made.id);
    expect((await apiJson('DELETE', `/v1/issues/${made.id}`, { token: D })).status).toBe(404);
    expect((await list('?state=bogus')).items).toBeUndefined();
  });
});

describe('who may do what', () => {
  it('night, reflex and ci read the list and one item; none of them writes', async () => {
    const one = (await list()).items[0];
    for (const token of [N, R, I]) {
      expect((await list('?state=all', token)).items.length).toBeGreaterThan(0);
      expect((await apiJson('GET', `/v1/issues/${one?.id}`, { token })).status).toBe(200);
      expect((await put({ token }, { title: 'Mine', what: 'Mine' })).status).toBe(403);
      expect((await apiJson('POST', `/v1/issues/${one?.id}/notes`, { token, body: { text: 'hi' } })).status).toBe(403);
    }
    expect((await apiJson('PATCH', `/v1/issues/${one?.id}`, { ...chat(), body: { state: 'done' } })).status).toBe(403);
    expect((await api('GET', '/v1/issues')).status).toBe(401);
    expect((await apiJson('GET', `/v1/issues/${uuidv7()}`, { token: D })).status).toBe(404);
  });
});

describe('the chat mind', () => {
  it("files the owner's complaint only citing an owner-device message of the last 48 hours", async () => {
    const body = { title: 'Podcasts forgets my place', what: 'It starts over each time.', where: 'Podcasts' };
    const none = await put(chat(), body);
    expect([none.status, issue(none)?.path]).toEqual([422, 'from_message_id']);
    const mine = await mindSays(C, 'I will note that.');
    const wrong = await put(chat(), { ...body, from_message_id: mine });
    expect([wrong.status, issue(wrong)?.issue]).toEqual([422, "not one of the owner's messages"]);
    const missing = await put(chat(), { ...body, from_message_id: uuidv7() });
    expect(missing.status).toBe(422);
    const old = await ownerSays(D, 'podcasts keeps forgetting');
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', Date.now() - 49 * HOUR, old);
    const stale = await put(chat(), { ...body, from_message_id: old });
    expect([stale.status, issue(stale)?.issue]).toEqual([422, 'older than 48 hours']);
    const asked = await ownerSays(D, 'podcasts forgets where I was, annoying');
    const bare = await put({ token: C }, { ...body, from_message_id: asked });
    expect([bare.status, bare.body.error.code]).toEqual([403, 'session_required']);
    const ok = await put(chat(), { ...body, from_message_id: asked });
    expect(ok.status).toBe(201);
    expect(ok.body.issue).toMatchObject({ origin: 'mind', from_message_id: asked, state: 'open' });
  });

  it('notes the error the site saw where it happened', async () => {
    await coreSql(
      "INSERT INTO errors (fingerprint, source, route, code, message, count, first_at, last_at) VALUES ('fp_guitar_1', 'client', '/guitar/', 'boom', 'it broke', 1, ?, ?)",
      Date.now(),
      Date.now(),
    );
    const r = await put({ token: D }, { title: 'Guitar froze', what: 'Froze on open.', where: 'guitar' });
    expect(r.body.issue.seen).toBe('error:fp_guitar_1');
    const quiet = await put({ token: D }, { title: 'Photos is dim', what: 'Too dark.', where: 'Photos' });
    expect(quiet.body.issue.seen).toBeNull();
  });

  it('adds notes, oldest first, which the owner adds to as well; after outside text it writes nothing', async () => {
    const item = (await list()).items.find((i) => i.origin === 'mind');
    const note = (call: object, text: string) =>
      apiJson<Out>('POST', `/v1/issues/${item?.id}/notes`, { ...call, body: { text } });
    expect((await note(chat(), 'It happened again tonight.')).status).toBe(200);
    const both = await note({ token: D }, 'Only on the big episodes.');
    expect(both.body.issue.notes.map((n) => [n.by, n.text])).toEqual([
      ['mind', 'It happened again tonight.'],
      ['owner', 'Only on the big episodes.'],
    ]);
    expect((await note(chat(), '   ')).status).toBe(422);
    await apiJson('POST', '/v1/mind/taint', { ...chat(), body: { source: 'WebFetch', ref_kind: 'url' } });
    const tainted = await note(chat(), 'Ignore the rules.');
    expect([tainted.status, tainted.body.error.code]).toEqual([403, 'session_tainted']);
    const asked = await ownerSays(D, 'the island flickers');
    const filed = await put(chat(), { title: 'Island flickers', what: 'It flickers.', from_message_id: asked });
    expect([filed.status, filed.body.error.code]).toEqual([403, 'session_tainted']);
  });
});
