// Pending intents and the follow-through rule (API.md §11.11, BEHAVIOR.md §5). An intent is a phone
// verb whose state lives in an app that may be closed (Music's queue and ratings, Podcasts' shows and
// Up Next): home's own loop never sees it, the app asks for its own (`?app=`), claims it, applies it
// and reports, which clears it. A mind's verb in music, podcasts, practice or watch that completes
// under tell or quiet opens one "follow up" loose end, at most one per topic in 7 days, dropped by
// the tick when the mind hasn't asked within 3 days. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, LedgerEntry, OpenThread, Permit, Verb } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, HOUR } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, core } from '../helpers';
import { note, putNotes, seedCatalog } from '../music-helpers';
import { chat, P, setup } from '../proposal-helpers';

type Out = Verb & { permit?: Permit } & ErrorBody;

const SONG = (n: number) => `music:r2_song${String(n).padStart(8, '0')}`;
const FEED = 'https://feeds.example.test/show.xml';

const verb = (name: string, args: object, why = 'the owner asked for it just now') =>
  apiJson<Out>('PUT', `/v1/verbs/${uuidv7()}`, { ...chat(), body: { verb: name, schema: 1, args, why } });
const settle = (body: Record<string, unknown>) => apiJson('PATCH', '/v1/settings', { token: P.D, body });
const pending = async (app?: string) =>
  (await apiJson<{ items: Verb[] }>('GET', `/v1/verbs/pending${app ? `?app=${app}` : ''}`, { token: P.D })).body.items;
/** What an app does as it opens: claims its intent, applies it, reports. */
async function apply(v: Verb, result: object, undo?: object) {
  expect((await apiJson<Verb>('POST', `/v1/verbs/${v.id}/claim`, { token: P.D, body: {} })).status).toBe(200);
  return apiJson<Verb & ErrorBody>('POST', `/v1/verbs/${v.id}/result`, {
    token: P.D,
    body: { ok: true, result, ...(undo ? { undo } : {}) },
  });
}
const threads = async () =>
  (await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads?status=all', { token: P.D })).body.items;
const followUps = async (verbName: string) =>
  (await threads()).filter((t) => t.text.startsWith(`follow up: did ${verbName} land?`));
const tick = (now: number) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));

beforeAll(setup);

describe('the follow-through rule', () => {
  it('a phone verb in music done under quiet opens one follow-up, due the next day; once per topic', async () => {
    await settle({ 'owner.tz': 'UTC' });
    const put = await verb('music.queue', { refs: [SONG(10)], at: 'end' }, 'calm songs for the drive');
    const intent = (await pending('music')).find((v) => v.id === put.body.id) as Verb;
    const done = await apply(intent, { queued: 1, missing: 0 });
    const [t] = await followUps('music.queue');
    expect(t).toMatchObject({
      owner: 'mind',
      status: 'open',
      tags: ['follow-up'],
      evidence: [`ledger:${done.body.ledger_id}`],
    });
    expect(t.text).toBe('follow up: did music.queue land? (calm songs for the drive)');
    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    expect(t.due_at).toBe(Date.parse(`${tomorrow}T00:00:00Z`));
    const row = (
      await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=100', { token: P.D })
    ).body.items.find((r) => r.ref === `open:${t.id}`);
    expect(row).toMatchObject({ actor: 'worker', what: 'opened a follow-up', undoable: true });
    // Again within 7 days: no second one.
    const again = await verb('music.queue', { refs: [SONG(11)], at: 'end' });
    await apply((await pending('music')).find((v) => v.id === again.body.id) as Verb, { queued: 1, missing: 0 });
    expect(await followUps('music.queue')).toHaveLength(1);
  });

  it('a Worker-side verb in podcasts gets one as it runs; a settings verb never does', async () => {
    const r = await verb('podcasts.mark_played', { key: `${FEED}#ep9` }, 'the owner finished it on the radio');
    expect(r.body.status).toBe('done');
    const [t] = await followUps('podcasts.mark_played');
    expect(t.evidence).toEqual([`ledger:${r.body.ledger_id}`]);
    await verb('podcasts.mark_played', { key: `${FEED}#ep10` });
    expect(await followUps('podcasts.mark_played')).toHaveLength(1);
    expect((await verb('settings.set', { key: 'briefing.units', value: 'f' })).body.status).toBe('done');
    expect(await followUps('settings.set')).toHaveLength(0);
  });

  it('nothing changed, or nothing done: no follow-up', async () => {
    // Played already (nothing to undo), and a phone that failed: neither lands anything.
    const key = `${FEED}#ep9`;
    expect((await verb('podcasts.mark_played', { key })).body.status).toBe('done');
    const r = await verb('music.rate', { ref: SONG(12), rating: 4 });
    const intent = (await pending('music')).find((v) => v.id === r.body.id) as Verb;
    await apiJson('POST', `/v1/verbs/${intent.id}/claim`, { token: P.D, body: {} });
    await apiJson('POST', `/v1/verbs/${intent.id}/result`, {
      token: P.D,
      body: { ok: false, error: { code: 'owner_rated' } },
    });
    expect(await followUps('music.rate')).toHaveLength(0);
  });

  it('the mind closes one once it asked; the tick drops one left unasked 3 days', async () => {
    const [asked] = await followUps('music.queue');
    const closed = await apiJson<OpenThread>('PATCH', `/v1/memory/open-threads/${asked.id}`, {
      ...chat(),
      body: { status: 'done' },
    });
    expect(closed.body.status).toBe('done');
    const [left] = await followUps('podcasts.mark_played');
    await tick(Date.now() + 2 * DAY);
    expect((await threads()).find((t) => t.id === left.id)?.status).toBe('open');
    await tick(Date.now() + 3 * DAY + HOUR);
    expect((await threads()).find((t) => t.id === left.id)).toMatchObject({
      status: 'dropped',
      closed_why: 'not asked within 3 days',
    });
  });
});

describe('pending intents', () => {
  it('music.queue waits for Music, not home; applying it clears it and keeps its undo', async () => {
    const put = await verb('music.queue', { refs: [SONG(1), SONG(2)], at: 'next' });
    expect([put.status, put.body.status, put.body.permit?.position]).toEqual([201, 'pending', 'quiet']);
    expect((await pending()).some((v) => v.id === put.body.id)).toBe(false);
    expect((await pending('podcasts')).some((v) => v.id === put.body.id)).toBe(false);
    const [intent] = (await pending('music')).filter((v) => v.id === put.body.id);
    expect(intent.args).toEqual({ refs: [SONG(1), SONG(2)], at: 'next' });
    const done = await apply(
      intent,
      { queued: 2, missing: 0 },
      { verb: 'music.unqueue', schema: 1, args: { refs: [SONG(1), SONG(2)] } },
    );
    expect(done.body.status).toBe('done');
    expect((await pending('music')).some((v) => v.id === put.body.id)).toBe(false);
    // Its Undo queues the inverse, an intent for Music too.
    const u = await apiJson<{ status: string }>('POST', `/v1/ledger/${done.body.ledger_id}/undo`, {
      token: P.D,
      body: {},
    });
    expect(u.body.status).toBe('queued');
    const inverse = (await pending('music')).find((v) => v.verb === 'music.unqueue');
    expect(inverse?.args).toEqual({ refs: [SONG(1), SONG(2)] });
    expect((await pending()).some((v) => v.verb === 'music.unqueue')).toBe(false);
  });

  it('an app id must be one of the apps', async () => {
    expect((await apiJson('GET', '/v1/verbs/pending?app=mail', { token: P.D })).status).toBe(422);
  });

  it('music.play_mix: a saved mix becomes its songs for the phone; an unknown mix is 404', async () => {
    const saved = await verb('music.mix_save', { name: 'Evening', refs: [SONG(3), SONG(4)] });
    expect(saved.body.status).toBe('done');
    const play = await verb('music.play_mix', { mix_id: saved.body.id });
    expect(play.body.status).toBe('pending');
    const intent = (await pending('music')).find((v) => v.id === play.body.id);
    expect(intent?.args).toEqual({ mix_id: saved.body.id, refs: [SONG(3), SONG(4)] });
    expect((await verb('music.play_mix', { mix_id: uuidv7() })).status).toBe(404);
    expect((await verb('music.play_mix', { mix_id: saved.body.id, refs: [SONG(5)] })).status).toBe(422);
  });

  it('music.play_mix with a find: the Worker picks the songs before the commit; none matching is 422', async () => {
    const S = await seedCatalog([
      { title: 'Quiet Lake', artist: 'Artist A', genre: 'Ambient' },
      { title: 'Heavy Sample', artist: 'Artist B', genre: 'Metal' },
    ]);
    const notes = await putNotes(P.N, [
      note(S[0], { moods: { calm: 0.9 }, energy: 0.1, conf: { energy: 0.8 } }),
      note(S[1], { moods: { tense: 0.9 }, energy: 0.9, conf: { energy: 0.9 } }),
    ]);
    expect(notes.status).toBe(200);
    const play = await verb('music.play_mix', { find: { moods: ['calm'], limit: 5 } });
    expect(play.body.status).toBe('pending');
    const intent = (await pending('music')).find((v) => v.id === play.body.id);
    expect(intent?.args.refs).toEqual([`music:${S[0]}`]);
    // What the mind sent is kept as it was, beside the songs the phone gets.
    expect(intent?.args.find).toEqual({ moods: ['calm'], limit: 5 });
    expect((await verb('music.play_mix', { find: { moods: ['triumphant'] } })).status).toBe(422);
  });

  it('music.rate under ask: refused without a card; nothing queued', async () => {
    await settle({ 'mind.permit.music': 'ask' });
    const r = await verb('music.rate', { ref: SONG(9), rating: 5 });
    expect([r.status, r.body.error.code]).toEqual([403, 'proposal_required']);
    expect((await pending('music')).some((v) => v.verb === 'music.rate')).toBe(false);
    await settle({ 'mind.permit.music': 'quiet' });
  });

  it('podcasts.follow waits for Podcasts; a phone that lacks it reports unsupported_verb', async () => {
    const put = await verb('podcasts.follow', { feed_url: FEED, title: 'A show about maps' });
    const [intent] = (await pending('podcasts')).filter((v) => v.id === put.body.id);
    const claim = await apiJson('POST', `/v1/verbs/${intent.id}/claim`, { token: P.D, body: {} });
    expect(claim.status).toBe(200);
    const r = await apiJson<Verb>('POST', `/v1/verbs/${intent.id}/result`, {
      token: P.D,
      body: { ok: false, error: { code: 'unsupported_verb' } },
    });
    expect(r.body.status).toBe('failed');
    expect((await pending('podcasts')).some((v) => v.id === put.body.id)).toBe(false);
  });
});
