// Standing permissions (shared/contract/permits.ts, API.md §11.11): the Worker checks every write
// the mind makes on the owner's things against the owner's `mind.permit.<class>`. Quiet and tell go
// ahead and say so in the answer and on the ledger row; ask is refused with the card to raise, and
// goes through once, with that card approved; a floor asks whatever the setting says; the owner's
// own writes are never gated. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, LedgerEntry, Permit, PermitRefusal, Surface, Verb } from '../../../shared/contract/api';
import { gate, positionFor } from '../../src/areas/mind/permit';
import { uuidv7 } from '../../src/lib/ids';
import type { Fail } from '../../src/lib/result';
import type { Db } from '../../src/objects/base';
import { Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core } from '../helpers';
import { CHAT_SESSION, ownerSays } from '../memory-helpers';
import { chat, clearAgentCards, decide, P, raise, setup } from '../proposal-helpers';

type Answer<T> = T & { permit?: Permit } & ErrorBody;

beforeAll(setup);

const settle = (body: Record<string, string>) => apiJson('PATCH', '/v1/settings', { token: P.D, body });
const appearance = (mode: 'day' | 'night', over: object = {}) => ({
  verb: 'shell.appearance',
  schema: 1,
  args: { mode },
  why: 'the owner asked for the dark look',
  ...over,
});
const queue = (body: object, headers: Record<string, string> = {}) =>
  apiJson<Answer<Verb>>('PUT', `/v1/verbs/${uuidv7()}`, {
    ...chat(),
    headers: { ...chat().headers, ...headers },
    body,
  });
const line = (text: string) => ({
  kind: 'line',
  schema: 1,
  payload: { text },
  why: 'a short line for the morning',
  topic_key: 'permits.test',
});
const place = (text: string, headers: Record<string, string> = {}) =>
  apiJson<Answer<Surface>>('PUT', '/v1/surfaces/home/line.2', {
    ...chat(),
    headers: { ...chat().headers, ...headers },
    body: line(text),
  });
const ledgerRow = async (id: string | null) =>
  (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=50', { token: P.D })).body.items.find(
    (r) => r.id === id,
  );
const refusal = (body: ErrorBody) => body.error.details as PermitRefusal;

/** Raises the card a refusal names and has the owner approve it with a tap: its id. */
async function approved(r: PermitRefusal): Promise<string> {
  const card = await raise({
    class: r.card.class,
    question: 'May I do this one thing?',
    why: 'Your standing permission says to ask first.',
    if_ignored: 'Nothing happens.',
    options: ['Do it', 'Not now'],
    spec: r.card.spec,
  });
  expect(card.status).toBe(201);
  expect(card.body.target).toBe(`${r.action}, once (${r.class === 'settings' ? 'Settings' : 'Lines and tiles'})`);
  const yes = await decide(card.body.id, { decision: 'approve', spec_hash: card.body.spec_hash });
  expect(yes.body.status).toBe('executed');
  return card.body.id;
}

describe('a verb under each position (settings: shell.appearance)', () => {
  it('tell, the default: queued, the answer and the ledger row say tell', async () => {
    const put = await queue(appearance('night'));
    expect(put.status).toBe(201);
    expect(put.body.permit).toEqual({ action: 'shell.appearance', class: 'settings', position: 'tell' });
    expect((await ledgerRow(put.body.ledger_id))?.permit).toBe('tell');
  });

  it('quiet: queued, marked quiet; the same call again answers the permit it ran under', async () => {
    await settle({ 'mind.permit.settings': 'quiet' });
    const id = uuidv7();
    const body = appearance('day');
    const put = await apiJson<Answer<Verb>>('PUT', `/v1/verbs/${id}`, { ...chat(), body });
    expect(put.status).toBe(201);
    expect(put.body.permit?.position).toBe('quiet');
    expect((await ledgerRow(put.body.ledger_id))?.permit).toBe('quiet');
    await settle({ 'mind.permit.settings': 'tell' });
    const again = await apiJson<Answer<Verb>>('PUT', `/v1/verbs/${id}`, { ...chat(), body });
    expect([again.status, again.body.permit?.position]).toEqual([200, 'quiet']);
  });

  it('ask: refused with the card to raise; once approved, that exact call goes through once', async () => {
    await settle({ 'mind.permit.settings': 'ask' });
    const no = await queue(appearance('night'));
    expect([no.status, no.body.error.code]).toEqual([403, 'proposal_required']);
    const r = refusal(no.body);
    expect(r).toMatchObject({
      reason: 'permit',
      action: 'shell.appearance',
      class: 'settings',
      position: 'ask',
      floor: null,
      card: { class: 'permit', spec: { v: 1, op: 'permit.allow', args: { action: 'shell.appearance' } } },
    });
    expect(r.card.spec.args.call).toMatch(/^[0-9a-f]{64}$/);
    // Nothing was queued, and the why is not part of what a card approves.
    expect((await queue(appearance('night', { why: 'another way to say it' }))).body.error.details).toEqual(r);
    const card = await approved(r);
    // Another call with this card is still refused, and says why.
    const other = await queue(appearance('day', { proposal_id: card }));
    expect([other.status, refusal(other.body).given]).toEqual([403, 'other_call']);
    const ok = await queue(appearance('night', { proposal_id: card }));
    expect(ok.status).toBe(201);
    expect(ok.body.permit).toEqual({ action: 'shell.appearance', class: 'settings', position: 'ask' });
    const row = await ledgerRow(ok.body.ledger_id);
    expect([row?.permit, row?.proposal_id]).toEqual(['ask', card]);
    // One approval, one action.
    const twice = await queue(appearance('night', { proposal_id: card }));
    expect([twice.status, refusal(twice.body).given]).toEqual([403, 'used']);
    await settle({ 'mind.permit.settings': 'tell' });
    await clearAgentCards();
  });

  it('a card still waiting does not count, and one call has one waiting card', async () => {
    await settle({ 'mind.permit.settings': 'ask' });
    const r = refusal((await queue(appearance('day'))).body);
    const body = {
      class: 'permit',
      question: 'May I switch to the light look?',
      why: 'You set settings to ask first.',
      if_ignored: 'Nothing changes.',
      options: ['Switch', 'Not now'],
      spec: r.card.spec,
    };
    const card = await raise(body);
    expect(card.status).toBe(201);
    const early = await queue(appearance('day', { proposal_id: card.body.id }));
    expect([early.status, refusal(early.body).given]).toEqual([403, 'waiting']);
    // Filed under another class than the action's, or a second card for the same call: refused.
    expect((await raise({ ...body, class: 'delete' })).status).toBe(422);
    expect((await raise(body)).status).toBe(409);
    // An action the standing permissions don't know is no card at all.
    const unknown = { ...body, spec: { ...r.card.spec, args: { ...r.card.spec.args, action: 'music.nothing' } } };
    expect((await raise(unknown)).status).toBe(422);
    await settle({ 'mind.permit.settings': 'tell' });
    await clearAgentCards();
  });
});

describe('a Core-internal op under each position (tiles: a home line)', () => {
  it('quiet, the default: placed, the answer and its arrangement row say quiet', async () => {
    const put = await place('Rain after four.');
    expect(put.status).toBe(200);
    expect(put.body.permit).toEqual({ action: 'surface.put', class: 'tiles', position: 'quiet' });
    expect((await ledgerRow(put.body.ledger_id))?.permit).toBe('quiet');
  });

  it('tell: placed and marked tell', async () => {
    await settle({ 'mind.permit.tiles': 'tell' });
    const put = await place('Rain after five.');
    expect(put.body.permit?.position).toBe('tell');
    expect((await ledgerRow(put.body.ledger_id))?.permit).toBe('tell');
  });

  it('ask: refused with its card; with the card approved (TH-Proposal) it is placed once', async () => {
    await settle({ 'mind.permit.tiles': 'ask' });
    const no = await place('Rain after six.');
    expect([no.status, no.body.error.code]).toEqual([403, 'proposal_required']);
    const r = refusal(no.body);
    expect(r).toMatchObject({ action: 'surface.put', class: 'tiles', position: 'ask', card: { class: 'permit' } });
    const card = await approved(r);
    const ok = await place('Rain after six.', { 'TH-Proposal': card });
    expect([ok.status, ok.body.permit?.position]).toEqual([200, 'ask']);
    const row = await ledgerRow(ok.body.ledger_id);
    expect([row?.permit, row?.proposal_id]).toEqual(['ask', card]);
    expect(refusal((await place('Rain after six.', { 'TH-Proposal': card })).body).given).toBe('used');
    expect((await place('Rain after six.', { 'TH-Proposal': 'not-a-card' })).status).toBe(400);
    await settle({ 'mind.permit.tiles': 'quiet' });
    await clearAgentCards();
  });
});

describe('the other gated writes', () => {
  it('Muse orders ask by default; a reminder tells; a title is quiet; the owner is never gated', async () => {
    const order = await apiJson<ErrorBody>('PUT', `/v1/work/orders/${uuidv7()}`, {
      ...chat(),
      body: {
        kind: 'research.brief',
        title: 'Bus timetable',
        spec: { v: 1, goal: 'Summarise it.', inputs: {}, constraints: [], done_when: 'Two sources agree.' },
        deadline_at: Date.now() + 3_600_000,
      },
    });
    expect([order.status, refusal(order.body).class, refusal(order.body).floor]).toEqual([403, 'muse', null]);
    const msg = await ownerSays(P.D, 'Remind me to call the garage at five');
    const set = await apiJson<Answer<{ reminder: { id: string } }>>('PUT', `/v1/reminders/${uuidv7()}`, {
      ...chat(),
      body: { text: 'Call the garage.', at: Date.now() + 3_600_000, source_message_id: msg },
    });
    expect([set.status, set.body.permit?.position]).toEqual([201, 'tell']);
    const gone = await apiJson<Answer<{ reminder: { state: string } }>>(
      'DELETE',
      `/v1/reminders/${set.body.reminder.id}`,
      chat(),
    );
    expect([gone.body.reminder.state, gone.body.permit?.action]).toEqual(['cancelled', 'reminder.cancel']);
    const today = await apiJson<{ thread: { id: string } }>('GET', '/v1/threads/today', { token: P.D });
    const titled = await apiJson<Answer<object>>('PATCH', `/v1/threads/${today.body.thread.id}`, {
      ...chat(),
      body: { title: 'The garage' },
    });
    expect([titled.status, titled.body.permit?.position]).toEqual([200, 'quiet']);
    // The owner sets reminders even with reminders at ask, and hears nothing about permits.
    await settle({ 'mind.permit.reminders': 'ask' });
    const own = await apiJson<Answer<object>>('PUT', `/v1/reminders/${uuidv7()}`, {
      token: P.D,
      body: { text: 'Water the plants.', at: Date.now() + 3_600_000 },
    });
    expect([own.status, own.body.permit]).toEqual([201, undefined]);
    const asked = await apiJson<ErrorBody>('PUT', `/v1/reminders/${uuidv7()}`, {
      ...chat(),
      body: { text: 'Call the garage again.', at: Date.now() + 7_200_000, source_message_id: msg },
    });
    expect([asked.status, refusal(asked.body).action]).toEqual([403, 'reminder.set']);
    await settle({ 'mind.permit.reminders': 'tell' });
  });
});

describe('floors', () => {
  const mind = { actor: 'mind:chat', who: 'C', session_id: CHAT_SESSION, device_id: null } as const;
  const inCore = <T>(fn: (db: Db) => T) =>
    runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => fn((o as unknown as { db: Db }).db));

  it('a floor asks even with its class at quiet, and its card is filed under the floor', async () => {
    await settle({ 'mind.permit.muse': 'quiet' });
    expect(await inCore((db) => positionFor(db, 'muse.order'))).toBe('quiet');
    expect(await inCore((db) => positionFor(db, 'muse.order_personal'))).toBe('ask');
    const thrown = await inCore((db) => {
      try {
        gate(new Writer(db, Date.now()), mind, 'muse.order_personal', { kind: 'x' }, 'work:x');
        return null;
      } catch (e) {
        const f = e as Fail;
        return { code: f.code, details: f.details };
      }
    });
    expect(thrown).toMatchObject({
      code: 'proposal_required',
      details: { action: 'muse.order_personal', class: 'muse', position: 'ask', floor: 'reach_people' },
    });
    expect((thrown as { details: PermitRefusal }).details.card.class).toBe('reach_people');
    await settle({ 'mind.permit.muse': 'ask' });
  });

  it('a value the catalogue no longer allows reads as the default', async () => {
    await inCore((db) =>
      db.run(
        "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES ('mind.permit.music', '\"always\"', 0, 'owner')",
      ),
    );
    expect(await inCore((db) => positionFor(db, 'music.create_playlist'))).toBe('quiet');
    await inCore((db) => db.run("DELETE FROM settings WHERE key = 'mind.permit.music'"));
  });
});
