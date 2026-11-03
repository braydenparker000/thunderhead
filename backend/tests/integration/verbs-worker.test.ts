// The Worker-side verbs of the shell (shared/contract/verbs.ts `side: 'worker'`, API.md §11.11):
// each runs through its area's own op inside the commit that queues it, after the permit gate, so
// the verb is `done` at once and its ledger row holds the inverse as `{op, args}`, which the
// ledger's undo runs. Per verb: it works, its undo puts back what was there, and under `ask` it is
// refused without a card (and nothing is written). Music's, Podcasts' and memory's are in
// verbs-worker-media.test.ts. Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import type { RemindersResponse } from '../../../shared/contract/reminders.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, HOUR } from '../../src/lib/time';
import { apiJson } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { chat, P, setup } from '../proposal-helpers';
import { doneNow, ledgerRow, refusal, settings, settle, undo, verb } from '../verb-helpers';

beforeAll(setup);

describe('settings.set', () => {
  it('sets a catalogued Worker setting at once, says so, and its undo puts the default back', async () => {
    const r = await doneNow(await verb('settings.set', { key: 'briefing.units', value: 'f' }));
    expect(r.result).toEqual({ previous: 'c' });
    expect(r.permit).toEqual({ action: 'settings.set', class: 'settings', position: 'tell' });
    expect((await settings())['briefing.units']).toBe('f');
    const row = await ledgerRow(r.ledger_id);
    expect(row).toMatchObject({ kind: 'verb', what: 'settings.set done', undoable: true, permit: 'tell' });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await settings())['briefing.units']).toBeUndefined();
    expect((await undo(r.ledger_id)).body.error.code).toBe('already_undone');
  });

  it('a value it already holds changes nothing and leaves nothing to undo', async () => {
    await settle({ 'briefing.due_days': 7 });
    const r = await doneNow(await verb('settings.set', { key: 'briefing.due_days', value: 7 }));
    expect(await ledgerRow(r.ledger_id)).toMatchObject({
      what: 'settings.set done (nothing changed)',
      undoable: false,
    });
  });

  it('an undo after the owner changed it again is a conflict, and changes nothing', async () => {
    const r = await doneNow(await verb('settings.set', { key: 'briefing.holidays', value: 'GB' }));
    await settle({ 'briefing.holidays': 'FR' });
    expect((await undo(r.ledger_id)).body.error.code).toBe('conflict');
    expect((await settings())['briefing.holidays']).toBe('FR');
  });

  it('never the standing permissions, the outside switch or privacy; only catalogued values', async () => {
    for (const key of ['mind.permit.music', 'mind.ask_outside', 'privacy.senses.music']) {
      const r = await verb('settings.set', { key, value: key === 'mind.permit.music' ? 'quiet' : false });
      expect([r.status, r.body.error.code], key).toEqual([403, 'forbidden']);
    }
    expect((await verb('settings.set', { key: 'no.such', value: 1 })).status).toBe(422);
    expect((await verb('settings.set', { key: 'briefing.units', value: 'k' })).status).toBe(422);
    // A setting kept on the phone is not the Worker's to set.
    expect((await verb('settings.set', { key: 'chat.fold', value: false })).status).toBe(422);
  });

  it('under ask: refused with its card, and nothing written', async () => {
    await settle({ 'mind.permit.settings': 'ask' });
    const r = await verb('settings.set', { key: 'briefing.units', value: 'f' });
    expect([r.status, refusal(r.body).action]).toEqual([403, 'settings.set']);
    expect((await settings())['briefing.units']).toBeUndefined();
    await settle({ 'mind.permit.settings': 'tell' });
  });
});

describe('briefing.pin_tile and briefing.unpin_tile', () => {
  const tile = (value: string) => ({
    kind: 'tile',
    schema: 1,
    payload: { label: 'Tile', value },
    why: 'From the plan you agreed.',
    topic_key: `pin.${value.toLowerCase()}`,
  });
  // After "Waiting on you" (the laws card the Worker raised for this session's file waits there).
  const order = async () => {
    const tiles = (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: P.D })).body.tiles;
    expect(tiles.findIndex((t) => t.kind !== 'waiting')).toBe(tiles.filter((t) => t.kind === 'waiting').length);
    return tiles.filter((t) => t.kind !== 'waiting').map((t) => (t.kind === 'night' ? t.slot : t.kind));
  };

  it('puts a tile right after what waits, newest pin first; each undo puts the pins back', async () => {
    await apiJson('PUT', '/v1/surfaces/briefing/practice', { ...chat(), body: tile('Practice') });
    await apiJson('PUT', '/v1/surfaces/briefing/study', { ...chat(), body: tile('Study') });
    expect(await order()).toEqual(['practice', 'study']);
    const pin = await doneNow(await verb('briefing.pin_tile', { tile: 'study' }));
    expect(pin.result).toEqual({ pinned: ['study'] });
    expect(pin.permit?.class).toBe('tiles');
    expect(await order()).toEqual(['study', 'practice']);
    const off = await doneNow(await verb('briefing.unpin_tile', { tile: 'study' }));
    expect(await order()).toEqual(['practice', 'study']);
    expect((await undo(off.ledger_id)).body.status).toBe('undone');
    expect(await order()).toEqual(['study', 'practice']);
    expect((await undo(pin.ledger_id)).body.status).toBe('undone');
    expect((await settings())['briefing.pins']).toBeUndefined();
  });

  it('only tiles the Briefing knows; under ask, refused', async () => {
    expect((await verb('briefing.pin_tile', { tile: 'weather' })).status).toBe(422);
    await settle({ 'mind.permit.tiles': 'ask' });
    expect((await verb('briefing.pin_tile', { tile: 'due' })).body.error.code).toBe('proposal_required');
    expect((await settings())['briefing.pins']).toBeUndefined();
    await settle({ 'mind.permit.tiles': 'quiet' });
  });
});

describe('reminder.move', () => {
  const reminder = async (at: number, token = P.D, source?: string) => {
    const id = uuidv7();
    const r = await apiJson('PUT', `/v1/reminders/${id}`, {
      ...(token === P.D ? { token } : chat()),
      body: { text: 'Call the garage', at, ...(source ? { source_message_id: source } : {}) },
    });
    expect(r.status).toBe(201);
    return id;
  };
  const one = async (id: string) =>
    (await apiJson<RemindersResponse>('GET', '/v1/reminders', { token: P.D })).body.items.find((x) => x.id === id);

  it("moves one the owner set only with the owner's message; its undo puts the time back", async () => {
    const was = Date.now() + 5 * HOUR;
    const id = await reminder(was);
    const to = was + DAY;
    const bare = await verb('reminder.move', { id, at: to });
    expect([bare.status, (bare.body.error.details as { path: string }[])[0].path]).toEqual([
      422,
      'args.source_message_id',
    ]);
    const asked = await ownerSays(P.D, 'Move my garage call to tomorrow');
    const r = await doneNow(await verb('reminder.move', { id, at: to, source_message_id: asked }));
    expect(r.result).toEqual({ at: to, fire_at: to });
    expect(r.permit?.position).toBe('tell');
    expect((await one(id))?.at).toBe(to);
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect(await one(id)).toMatchObject({ at: was, fire_at: was, state: 'set' });
  });

  it('a set reminder only, in the future; not from the night; under ask, refused', async () => {
    const asked = await ownerSays(P.D, 'Remind me to water the plants in two hours');
    const id = await reminder(Date.now() + 2 * HOUR, P.C, asked);
    expect((await verb('reminder.move', { id, at: Date.now() - DAY })).status).toBe(422);
    expect((await verb('reminder.move', { id: uuidv7(), at: Date.now() + DAY })).status).toBe(404);
    const night = { token: P.N, headers: { 'TH-Session': 'cse_memory_night_1' } };
    expect((await verb('reminder.move', { id, at: Date.now() + DAY }, {}, night)).status).toBe(403);
    await settle({ 'mind.permit.reminders': 'ask' });
    const at = Date.now() + 3 * HOUR;
    expect((await verb('reminder.move', { id, at })).body.error.code).toBe('proposal_required');
    expect((await one(id))?.at).not.toBe(at);
    await settle({ 'mind.permit.reminders': 'tell' });
    await apiJson('DELETE', `/v1/reminders/${id}`, { token: P.D });
    expect((await verb('reminder.move', { id, at })).status).toBe(409);
  });
});
