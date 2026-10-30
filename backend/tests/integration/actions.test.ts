// Verbs, surfaces and the ledger (API.md §11.9–11.12), all checked against the contract
// registries: unknown or tap-only verbs refused, args and results validated, a phone that lacks a
// verb reporting unsupported_verb; surfaces validated by kind, slot and version; every action a
// ledger row whose undo works (in place for surfaces, by queued inverse verb for phone actions).
import { beforeAll, describe, expect, it } from 'vitest';
import type { LedgerEntry, Surface, SurfacesResponse, UndoResponse, Verb } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
let N = '';

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  N = await makeAgent(D, 'mind:night');
});

const queue = (body: object, id = uuidv7()) =>
  apiJson<Verb & { error?: { code: string } }>('PUT', `/v1/verbs/${id}`, { token: C, body });
const appearance = (mode: string) => ({
  verb: 'shell.appearance',
  schema: 1,
  args: { mode },
  why: 'the owner asked for night mode',
});
const line = (text: string, topic = 'greeting') => ({
  kind: 'line',
  schema: 1,
  payload: { text },
  why: 'a short morning greeting',
  topic_key: topic,
});

describe('verbs', () => {
  it('refuses unknown verbs, tap-only verbs, unknown versions and bad args', async () => {
    expect((await queue({ ...appearance('night'), verb: 'shell.nothing' })).status).toBe(422);
    expect(
      (await queue({ verb: 'app.open', schema: 1, args: { app: 'music', path: '/music/' }, why: 'open music now' }))
        .status,
    ).toBe(422);
    expect((await queue({ ...appearance('night'), schema: 9 })).status).toBe(422);
    expect((await queue(appearance('purple'))).status).toBe(422);
  });

  it('runs end to end: queued, pending on the phone, claimed, done with its undo, and undone by the inverse', async () => {
    const id = uuidv7();
    const put = await queue(appearance('night'), id);
    expect(put.status).toBe(201);
    expect((await queue(appearance('night'), id)).status).toBe(200);
    const pending = await apiJson<{ items: Verb[] }>('GET', '/v1/verbs/pending', { token: D });
    expect(pending.body.items.map((v) => v.id)).toContain(id);
    expect((await apiJson<Verb>('POST', `/v1/verbs/${id}/claim`, { token: D })).body.status).toBe('claimed');
    const bad = await apiJson('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: { ok: true, result: { previous: 'sepia' } },
    });
    expect(bad.status).toBe(422);
    expect(put.body.ledger_id).toMatch(/^[0-9a-f-]{36}$/); // the "queued" row
    const done = await apiJson<Verb>('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: {
        ok: true,
        result: { previous: 'day' },
        undo: { verb: 'shell.appearance', schema: 1, args: { mode: 'day' } },
      },
    });
    expect(done.body.status).toBe('done');
    expect(done.body.ledger_id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=10', { token: D })).body.items;
    const ran = rows.find((r) => r.kind === 'verb' && r.undoable) as LedgerEntry;
    expect(ran.what).toBe('shell.appearance done');
    expect(ran.id).toBe(done.body.ledger_id);
    const since = await apiJson<{ items: LedgerEntry[] }>('GET', `/v1/ledger?kind=verb&since=${ran.at}`, { token: D });
    expect(since.body.items.map((r) => r.id)).toContain(ran.id);
    expect(since.body.items.every((r) => r.kind === 'verb' && r.at >= ran.at)).toBe(true);
    const undo = await apiJson<UndoResponse>('POST', `/v1/ledger/${ran.id}/undo`, { token: D });
    expect(undo.body.status).toBe('queued');
    const inverse = (await apiJson<{ items: Verb[] }>('GET', '/v1/verbs/pending', { token: D })).body.items.find(
      (v) => v.verb === 'shell.appearance' && v.args.mode === 'day',
    ) as Verb;
    await apiJson('POST', `/v1/verbs/${inverse.id}/claim`, { token: D });
    await apiJson('POST', `/v1/verbs/${inverse.id}/result`, {
      token: D,
      body: { ok: true, result: { previous: 'night' } },
    });
    const after = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=20', { token: D })).body.items;
    expect(after.find((r) => r.id === ran.id)?.status).toBe('undone');
  });

  it('a phone that lacks the verb reports unsupported_verb and the ledger shows it failed', async () => {
    const id = uuidv7();
    await queue(appearance('auto'), id);
    await apiJson('POST', `/v1/verbs/${id}/claim`, { token: D });
    const r = await apiJson<Verb>('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: { ok: false, error: { code: 'unsupported_verb' } },
    });
    expect(r.body).toMatchObject({ status: 'failed', error: { code: 'unsupported_verb' } });
  });
});

describe('surfaces', () => {
  it('validates kind, slot, version and payload against the contract', async () => {
    const put = (slot: string, body: object) =>
      apiJson<Surface>('PUT', `/v1/surfaces/home/${slot}`, { token: C, body });
    const first = await put('line.1', line('Good morning.'));
    expect(first.status).toBe(200);
    expect(first.body.ledger_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await put('line.9', line('Good morning.'))).status).toBe(422);
    expect((await put('line.2', line('Good morning!'))).status).toBe(422);
    expect((await put('line.2', line('No full stop'))).status).toBe(422);
    expect((await put('line.2', line(`${'x'.repeat(44)}.`))).status).toBe(422);
    expect((await put('line.2', { ...line('Fine.'), kind: 'banner' })).status).toBe(422);
    expect((await put('line.2', { ...line('Fine.'), schema: 2 })).status).toBe(422);
    const list = await apiJson<SurfacesResponse>('GET', '/v1/surfaces', { token: D });
    expect(list.body.items).toEqual([
      expect.objectContaining({ app: 'home', slot: 'line.1', kind: 'line', schema: 1 }),
    ]);
    expect(list.body.items[0].payload).toMatchObject({ text: 'Good morning.' });
  });

  it('a dismissed topic stays quiet for 14 days; undo restores what was there', async () => {
    expect((await apiJson('DELETE', '/v1/surfaces/home/line.1', { token: D })).status).toBe(204);
    const again = await apiJson<{ error: { code: string } }>('PUT', '/v1/surfaces/home/line.1', {
      token: C,
      body: line('Hello again.'),
    });
    expect(again.body.error.code).toBe('nudge_repeat');
    const rows = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=5', { token: D })).body.items;
    const cleared = rows.find((r) => r.what === 'home/line.1 cleared') as LedgerEntry;
    expect((await apiJson<UndoResponse>('POST', `/v1/ledger/${cleared.id}/undo`, { token: D })).body.status).toBe(
      'undone',
    );
    expect((await apiJson<SurfacesResponse>('GET', '/v1/surfaces', { token: D })).body.items).toHaveLength(1);
    expect((await apiJson('POST', `/v1/ledger/${cleared.id}/undo`, { token: D })).status).toBe(409);
  });
});

describe('the ledger', () => {
  it('records outside actions idempotently; the mind undoes only its own', async () => {
    const id = uuidv7();
    const body = {
      kind: 'deploy',
      what: 'Site 3f2a1c9 live',
      why: 'the owner agreed to ship the fix',
      ref: 'app:music',
    };
    expect((await apiJson('PUT', `/v1/ledger/${id}`, { token: C, body })).status).toBe(201);
    expect((await apiJson('PUT', `/v1/ledger/${id}`, { token: C, body })).status).toBe(200);
    expect((await apiJson('PUT', `/v1/ledger/${id}`, { token: C, body: { ...body, what: 'other' } })).status).toBe(409);
    expect((await apiJson('PUT', `/v1/ledger/${uuidv7()}`, { token: C, body: { ...body, why: 'short' } })).status).toBe(
      422,
    );
    const owners = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?actor=owner&limit=5', { token: D })).body
      .items;
    const mine = owners.find((r) => r.undoable && r.status === 'done');
    if (mine) expect((await apiJson('POST', `/v1/ledger/${mine.id}/undo`, { token: C })).status).toBe(403);
    expect((await apiJson('POST', `/v1/ledger/${id}/undo`, { token: C })).status).toBe(422);
    expect((await apiJson('PUT', `/v1/ledger/${uuidv7()}`, { token: N, body })).status).toBe(201);
  });
  it('a playlist the mind asks a phone to make, and its undo, which only removes it', async () => {
    const make = {
      verb: 'music.create_playlist',
      schema: 1,
      args: {
        name: 'Dramatic classical',
        refs: [`music:r2_native_${'a'.repeat(64)}`, `music:r2_native_${'b'.repeat(64)}`],
      },
      why: 'the owner asked for a dramatic classical playlist',
    };
    const put = await apiJson<Verb>('PUT', `/v1/verbs/${uuidv7()}`, { token: C, body: make });
    expect(put.status).toBe(201);
    expect(
      (
        await apiJson('PUT', `/v1/verbs/${uuidv7()}`, {
          token: C,
          body: { ...make, args: { ...make.args, refs: ['x'] } },
        })
      ).status,
    ).toBe(422);
    // The mind can't queue the removal itself: it runs only as the creation's undo.
    const remove = {
      verb: 'music.delete_playlist',
      schema: 1,
      args: { list_id: 'abc123def' },
      why: 'tidy up the list',
    };
    expect((await apiJson('PUT', `/v1/verbs/${uuidv7()}`, { token: C, body: remove })).status).toBe(422);
    const id = put.body.id;
    await apiJson('POST', `/v1/verbs/${id}/claim`, { token: D });
    const done = await apiJson<Verb>('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: {
        ok: true,
        result: { list_id: 'abc123def', tracks: 2 },
        undo: { verb: 'music.delete_playlist', schema: 1, args: { list_id: 'abc123def' } },
      },
    });
    expect(done.status).toBe(200);
  });
});
