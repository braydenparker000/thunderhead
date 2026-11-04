// Watches, the day pulse (RUNTIME.md §3, shared/contract/watches.ts): `watch.set` and
// `watch.cancel` run as Worker-side verbs with no class gate, from a claimed session; GET
// /v1/mind/watches lists them with the wake budget; at most 20 wait; a time at most 7 days ahead;
// an event's ref must be one its type carries (none for a sensitive type), a change's its own kind's;
// the wake budget at Off refuses new ones; the undo of each takes it back; an outside watch's words
// are kept back from a clean session.
import { beforeAll, describe, expect, it } from 'vitest';
import { DAY, HOUR, MINUTE } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { cancelWatch, listWatches, setWatch, WHY } from '../watch-helpers';

let p: Principals;
const chat = () => as(p.C, CHAT_SESSION);
const issue = (b: { error?: { details?: unknown } }) => JSON.stringify(b.error?.details ?? null);

beforeAll(async () => {
  p = await principals();
});

describe('watch.set and the list', () => {
  it('sets each kind at once, unguarded, with its ledger row; the list shows them with the budget', async () => {
    const at = Date.now() + 2 * HOUR;
    const a = await setWatch(chat(), { kind: 'at', at, note: 'the drive at six' });
    expect([a.status, a.body.status], JSON.stringify(a.body)).toEqual([201, 'done']);
    expect(a.body.result).toEqual({ watch_id: a.body.id, state: 'live', until: at });
    expect(a.body.permit).toBeUndefined();
    const e = await setWatch(chat(), { kind: 'event', type: 'guitar.session', ref: 'tab:example-piece' });
    const c = await setWatch(chat(), { kind: 'change', type: 'work' });
    expect([e.status, c.status]).toEqual([201, 201]);
    const [row] = await coreSql<{ what: string; why: string; undoable: number }>(
      'SELECT what, why, undoable FROM ledger WHERE verb_id = ?',
      a.body.id,
    );
    expect(row).toEqual({ what: 'watch.set done', why: WHY, undoable: 1 });
    const list = await listWatches({ token: p.D });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ live: 3, budget: 12, used: 0, refused: 0 });
    const got = list.body.items.find((w) => w.id === a.body.id);
    expect(got).toMatchObject({
      kind: 'at',
      at,
      why: WHY,
      note: 'the drive at six',
      state: 'live',
      provenance: 'owner',
    });
    expect(list.body.items.find((w) => w.id === e.body.id)).toMatchObject({
      type: 'guitar.session',
      ref: 'tab:example-piece',
    });
    // The mind roles read it too.
    expect((await listWatches(as(p.N, 'cse_memory_night_1'))).status).toBe(200);
  });

  it('refuses what does not fit: a past or far time, fields of another kind, a ref its type does not carry', async () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ kind: 'at', at: Date.now() - MINUTE }, /still to come/],
      [{ kind: 'at', at: Date.now() + 8 * DAY }, /7 days ahead/],
      [{ kind: 'at' }, /required with kind at/],
      [{ kind: 'at', at: Date.now() + HOUR, type: 'music.play' }, /only with kind event or change/],
      [{ kind: 'event', type: 'work' }, /a sense type or reminder.fired/],
      [{ kind: 'change', type: 'guitar.session' }, /work, verb, proposal or prediction/],
      [{ kind: 'event', type: 'guitar.session', ref: 'music:r2_song00000001' }, /a tab ref/],
      [{ kind: 'event', type: 'card.decide', ref: 'proposal:x' }, /no ref an agent may see/],
      [{ kind: 'event', type: 'reminder.fired', ref: 'msg:x' }, /a reminder:<id> ref/],
      [{ kind: 'change', type: 'verb', ref: 'work:x' }, /a verb:<id> ref/],
    ];
    for (const [args, why] of bad) {
      const r = await setWatch(chat(), args);
      expect([r.status, r.body.error?.code], JSON.stringify(args)).toEqual([422, 'validation']);
      expect(issue(r.body), JSON.stringify(args)).toMatch(why);
    }
    // The schema: an unknown event type, a short why, a long note, an extra field.
    for (const args of [
      { kind: 'event', type: 'music.nothing' },
      { kind: 'at', at: Date.now() + HOUR, why: 'short' },
      { kind: 'at', at: Date.now() + HOUR, note: 'x'.repeat(141) },
      { kind: 'at', at: Date.now() + HOUR, extra: 1 },
    ])
      expect((await setWatch(chat(), args)).status, JSON.stringify(args)).toBe(422);
  });

  it('needs a claimed session of its role: a made-up one is refused', async () => {
    const r = await setWatch(as(p.C, 'cse_never_claimed'), { kind: 'at', at: Date.now() + HOUR });
    expect([r.status, r.body.error?.code]).toEqual([403, 'session_required']);
  });
});

describe('the cap, cancel and undo', () => {
  it('at most 20 wait at once; a cancelled one makes room', async () => {
    const live = (await listWatches({ token: p.D })).body.live;
    const ids: string[] = [];
    for (let i = live; i < 20; i++) {
      const r = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR + i * MINUTE });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    const over = await setWatch(chat(), { kind: 'at', at: Date.now() + 3 * HOUR });
    expect(over.status).toBe(422);
    expect(issue(over.body)).toMatch(/at most 20 watches wait at once/);
    const gone = await cancelWatch(chat(), ids[0]);
    expect([gone.status, gone.body.result.state]).toEqual([201, 'cancelled']);
    expect((await setWatch(chat(), { kind: 'at', at: Date.now() + 3 * HOUR })).status).toBe(201);
    // Cancelling it again: it no longer waits (410); one never set: 404.
    expect((await cancelWatch(chat(), ids[0])).status).toBe(410);
    expect((await cancelWatch(chat(), '01234567-89ab-7def-8123-456789abcdef')).status).toBe(404);
    // Its undo would make 21: refused while 20 wait.
    const [{ ledger_id }] = await coreSql<{ ledger_id: string }>(
      'SELECT ledger_id FROM verbs WHERE id = ?',
      gone.body.id,
    );
    expect((await apiJson('POST', `/v1/ledger/${ledger_id}/undo`, { token: p.D, body: {} })).status).toBe(409);
    for (const id of ids.slice(1)) await cancelWatch(chat(), id);
  });

  it('undo: a set watch is cancelled while it waits; a cancelled one waits again', async () => {
    const r = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR });
    const undo = (verbId: string) =>
      coreSql<{ ledger_id: string }>('SELECT ledger_id FROM verbs WHERE id = ?', verbId).then(([v]) =>
        apiJson<{ status: string }>('POST', `/v1/ledger/${v.ledger_id}/undo`, { token: p.D, body: {} }),
      );
    expect((await undo(r.body.id)).body.status).toBe('undone');
    const state = async () =>
      (await coreSql<{ state: string }>('SELECT state FROM watches WHERE id = ?', r.body.id))[0].state;
    expect(await state()).toBe('cancelled');
    const second = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR });
    const c = await cancelWatch(chat(), second.body.id);
    expect((await undo(c.body.id)).body.status).toBe('undone');
    expect((await coreSql<{ state: string }>('SELECT state FROM watches WHERE id = ?', second.body.id))[0].state).toBe(
      'live',
    );
  });
});

describe('the budget at Off, and outside words', () => {
  it('with the wake budget at Off, no new watch is set', async () => {
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'mind.wake_budget': 0 } });
    const r = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR });
    expect(r.status).toBe(422);
    expect(issue(r.body)).toMatch(/watches are off/);
    expect((await listWatches({ token: p.D })).body.budget).toBe(0);
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'mind.wake_budget': 12 } });
  });

  it('a watch set after outside text keeps its words back from a clean session, not from the owner', async () => {
    await apiJson('POST', '/v1/mind/taint', { ...chat(), body: { source: 'WebFetch' } });
    const r = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR, note: 'from a page' });
    expect(r.status).toBe(201);
    const owner = (await listWatches({ token: p.D })).body.items.find((w) => w.id === r.body.id);
    expect(owner).toMatchObject({ provenance: 'outside', why: WHY, note: 'from a page' });
    // The tainted session itself reads them; a new, clean night session does not.
    expect((await listWatches(chat())).body.items.find((w) => w.id === r.body.id)?.note).toBe('from a page');
    await brief(p.N, 'cse_watch_clean_night', 'night');
    const clean = (await listWatches(as(p.N, 'cse_watch_clean_night'))).body.items.find((w) => w.id === r.body.id);
    expect(clean).toMatchObject({ provenance: 'outside', why: null, note: null });
    // No session at all: kept back too.
    expect((await listWatches({ token: p.N })).body.items.find((w) => w.id === r.body.id)?.why).toBeNull();
  });
});
