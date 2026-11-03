// The Worker-side verbs of Music, Podcasts and memory (shared/contract/verbs.ts `side: 'worker'`,
// API.md §11.11): marking an episode played, saving a mix, the owner's "never play this again" and a
// fact in their own words; and the gate's own rules (never below tell; a refusal writes nothing).
// The shell's are in verbs-worker.test.ts. Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { MusicMixesResponse } from '../../../shared/contract/api';
import type { PodcastPage, PodcastProgress } from '../../../shared/contract/podcasts.ts';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { chat, P, setup } from '../proposal-helpers';
import { doneNow, FEED, ledgerRow, type Out, SONG, settle, undo, verb } from '../verb-helpers';

beforeAll(setup);

describe('podcasts.mark_played', () => {
  const key = (n: number) => `${FEED}#ep${n}`;
  const position = async (k: string) =>
    (
      await apiJson<PodcastPage<PodcastProgress>>('GET', '/v1/podcasts/progress?since=0', { token: P.D })
    ).body.items.find((p) => p.key === k);

  it('marks it played where every phone takes it; its undo puts back where it was left', async () => {
    const at = Date.now() - 60_000;
    await apiJson('PUT', '/v1/podcasts/progress', {
      token: P.D,
      body: { items: [{ key: key(1), position_s: 120, duration_s: 3000, played: false, updated_at: at }] },
    });
    const r = await doneNow(await verb('podcasts.mark_played', { key: key(1) }));
    expect(r.permit).toEqual({ action: 'podcasts.mark_played', class: 'podcasts', position: 'quiet' });
    expect(await position(key(1))).toMatchObject({ played: true, position_s: 0, duration_s: 3000 });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect(await position(key(1))).toMatchObject({ played: false, position_s: 120, duration_s: 3000 });
    // Played already: nothing changes, nothing to undo.
    await doneNow(await verb('podcasts.mark_played', { key: key(1) }));
    const again = await doneNow(await verb('podcasts.mark_played', { key: key(1) }));
    expect((await ledgerRow(again.ledger_id))?.undoable).toBe(false);
  });

  it('a bad key is refused; under ask, refused and unmarked', async () => {
    expect((await verb('podcasts.mark_played', { key: 'not a key' })).status).toBe(422);
    await settle({ 'mind.permit.podcasts': 'ask' });
    expect((await verb('podcasts.mark_played', { key: key(2) })).body.error.code).toBe('proposal_required');
    expect(await position(key(2))).toBeUndefined();
    await settle({ 'mind.permit.podcasts': 'quiet' });
  });
});

describe('music.mix_save', () => {
  const mixes = async () => (await apiJson<MusicMixesResponse>('GET', '/v1/music/mixes', { token: P.D })).body.items;

  it('keeps a named mix under the verb id, listed for the mind; its undo deletes it', async () => {
    const r = await doneNow(
      await verb('music.mix_save', { name: 'Drive home', refs: [SONG(1), SONG(2), SONG(1)], recipe: 'calm, drive' }),
    );
    expect(r.result).toEqual({ mix_id: r.id, tracks: 2 });
    expect((await mixes()).find((m) => m.id === r.id)).toMatchObject({
      name: 'Drive home',
      tracks: 2,
      recipe: 'calm, drive',
    });
    const listed = await apiJson<MusicMixesResponse>('GET', '/v1/music/mixes', chat());
    expect(listed.status).toBe(200);
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await mixes()).some((m) => m.id === r.id)).toBe(false);
  });

  it('under ask: refused, and no mix kept', async () => {
    await settle({ 'mind.permit.music': 'ask' });
    const before = (await mixes()).length;
    expect((await verb('music.mix_save', { name: 'Late', refs: [SONG(3)] })).body.error.code).toBe('proposal_required');
    expect((await mixes()).length).toBe(before);
    await settle({ 'mind.permit.music': 'quiet' });
  });
});

describe("music.never and memory.note: the owner's words, through memory's rules", () => {
  const never = () => (core() as unknown as { musicNever(): Promise<string[]> }).musicNever();
  const current = async (id: string) =>
    (await coreSql<{ superseded_at: number | null }>('SELECT superseded_at FROM facts WHERE id = ?', id))[0]
      ?.superseded_at === null;

  it('music.never: a rule from their message; find leaves the song out; its undo closes the rule', async () => {
    const said = await ownerSays(P.D, 'Never play that one again');
    const r = await doneNow(await verb('music.never', { ref: SONG(7), evidence: [`msg:${said}`] }));
    const fact = (r.result as { fact_id: string }).fact_id;
    expect(await never()).toContain('r2_song00000007');
    // Memory's own row is the verb's: one row, its undo and the permit it ran under.
    expect(await ledgerRow(r.ledger_id)).toMatchObject({ kind: 'memory', undoable: true, permit: 'quiet' });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect(await never()).not.toContain('r2_song00000007');
    expect(await current(fact)).toBe(false);
  });

  it("music.never: refused on the mind's own words, and under ask", async () => {
    const mine = await apiJson('PUT', `/v1/messages/${uuidv7()}`, { ...chat(), body: { body: 'I will skip it.' } });
    expect(mine.status).toBe(201);
    const id = (mine.body as { id: string }).id;
    expect((await verb('music.never', { ref: SONG(8), evidence: [`msg:${id}`] })).status).toBe(422);
    await settle({ 'mind.permit.music': 'ask' });
    const said = await ownerSays(P.D, 'Not that song again');
    expect((await verb('music.never', { ref: SONG(8), evidence: [`msg:${said}`] })).body.error.code).toBe(
      'proposal_required',
    );
    expect(await never()).not.toContain('r2_song00000008');
    await settle({ 'mind.permit.music': 'quiet' });
  });

  it('memory.note: no class and no card, even with every class on ask; its undo closes the fact', async () => {
    for (const c of ['music', 'settings', 'outside']) await settle({ [`mind.permit.${c}`]: 'ask' });
    const said = await ownerSays(P.D, 'I take my coffee black');
    const r = await doneNow(
      await verb('memory.note', { text: 'Takes coffee black', kind: 'preference', evidence: [`msg:${said}`] }),
    );
    expect(r.permit).toBeUndefined();
    const fact = (r.result as { fact_id: string }).fact_id;
    expect(await current(fact)).toBe(true);
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect(await current(fact)).toBe(false);
    // M3: only the owner's own messages are its evidence.
    const mind = await apiJson<{ id: string }>('PUT', `/v1/messages/${uuidv7()}`, {
      ...chat(),
      body: { body: 'Noted.' },
    });
    expect(
      (await verb('memory.note', { text: 'Likes tea', kind: 'preference', evidence: [`msg:${mind.body.id}`] })).status,
    ).toBe(422);
    await settle({ 'mind.permit.music': 'quiet', 'mind.permit.settings': 'tell', 'mind.permit.outside': 'ask' });
  });
});

describe('the gate', () => {
  it('honours never-below-tell: podcasts.unfollow under quiet runs as tell', async () => {
    await settle({ 'mind.permit.podcasts': 'quiet' });
    const r = await verb('podcasts.unfollow', { show_id: '0123456789abcdef' });
    expect([r.status, r.body.status, r.body.permit?.position]).toEqual([201, 'pending', 'tell']);
    const unf = await verb('podcasts.follow', { feed_url: FEED, title: 'A show' });
    expect(unf.body.permit?.position).toBe('quiet');
  });

  it('a Worker-side refusal rolls the whole call back: no verb, no ledger row', async () => {
    const id = uuidv7();
    const r = await apiJson<Out>('PUT', `/v1/verbs/${id}`, {
      ...chat(),
      body: { verb: 'settings.set', schema: 1, args: { key: 'privacy.errors', value: false }, why: 'turning it off' },
    });
    expect(r.status).toBe(403);
    expect(await coreSql('SELECT id FROM verbs WHERE id = ?', id)).toEqual([]);
  });

  it('the Core object still answers a Worker of the release before (no zone, nothing prepared)', async () => {
    const out = await (core() as unknown as Core).putVerb(
      { actor: 'mind:chat', who: 'C', session_id: 'cse_memory_chat_1', device_id: null },
      uuidv7(),
      { verb: 'briefing.pin_tile', schema: 1, args: { tile: 'due' }, why: 'the owner pins Due' },
      'x'.repeat(64),
    );
    expect(out.ok && out.value.verb.status).toBe('done');
  });
});
