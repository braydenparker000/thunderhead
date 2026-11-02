// B1: the event list as contract (shared/contract/senses.ts SENSE_TYPES, API.md §11.14). Every type
// the phone may send is taken in its own shape; the same event with a field the list doesn't name,
// a value of the wrong kind or a ref of another kind is refused with its reason, and so is a type
// the list doesn't have. A type's sensitivity is a floor. An app whose switch the owner turned off
// (Settings › Privacy, `privacy.senses.<app>`) keeps nothing, its ratings included.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SENSE_TYPES,
  type SenseBatchResponse,
  type SenseField,
  type SenseTypeName,
} from '../../../shared/contract/senses.ts';
import { forgetOwner } from '../../src/areas/senses/routes';
import { uuidv7 } from '../../src/lib/ids';
import type { Senses } from '../../src/objects/senses';
import { api, apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const NOW = Date.now();
const senses = () => env.SENSES.get(env.SENSES.idFromName('owner')) as unknown as DurableObjectStub<Senses>;
const sql = <T>(q: string, ...b: unknown[]) =>
  runInDurableObject(senses(), (_o, s) => s.storage.sql.exec(q, ...(b as SqlStorageValue[])).toArray() as T[]);
const put = (events: unknown[]) =>
  apiJson<SenseBatchResponse>('PUT', `/v1/senses/batches/${uuidv7()}`, { token: p.D, body: { events } });
const setSwitch = async (key: string, on: boolean) => {
  expect((await api('PATCH', '/v1/settings', { token: p.D, body: { [key]: on } })).status).toBe(200);
  forgetOwner();
};

/** An invented value of a field's kind. */
const sample = (f: SenseField): unknown => {
  if (typeof f !== 'string') return f[0];
  return {
    id: 'b12-16',
    ref: 'music:r2_native_aaaa',
    ids: ['b1-4', 'b5-8'],
    ms: 61_000,
    int: 3,
    num: 72.5,
    bool: true,
  }[f];
};
/** A ref of the first kind a type allows. */
const REFS: Record<string, string> = {
  music: 'music:r2_native_aaaa',
  podcast: 'podcast:0123456789abcdef/ep42',
  tab: 'tab:example-piece#b12-16',
  book: 'book:0192f0c4-0000-7000-8000-000000000001',
  astra: 'astra:series:tt0000001:1:2',
  media: 'media:1AbCdEfGhIjKlMnOp',
  app: 'app:podcasts',
  setting: 'setting:appearance.glass',
  ledger: 'ledger:0192f0c4-0000-7000-8000-000000000002',
  proposal: 'proposal:0192f0c4-0000-7000-8000-000000000003',
};
const shaped = (type: SenseTypeName, over: Record<string, unknown> = {}) => {
  const spec = SENSE_TYPES[type];
  const data = Object.fromEntries(Object.entries(spec.data).map(([k, f]) => [k, sample(f as SenseField)]));
  return {
    id: uuidv7(),
    at: NOW - 60_000,
    type,
    ...(spec.ref.length ? { ref: REFS[spec.ref[0]] } : {}),
    ...(Object.keys(data).length ? { data } : {}),
    ...over,
  };
};
const TYPES = Object.keys(SENSE_TYPES) as SenseTypeName[];

beforeAll(async () => {
  p = await principals();
});
afterAll(() => forgetOwner());

describe('the event list', () => {
  it('takes every listed type in its own shape', async () => {
    for (const app of ['music', 'podcasts', 'guitar', 'study', 'media', 'shell', 'home'])
      await setSwitch(`privacy.senses.${app}`, true);
    const r = await put(TYPES.map((t) => shaped(t)));
    expect(r.body).toEqual({ accepted: TYPES.length, rejected: [] });
  });

  it.each(TYPES)(
    '%s: refuses a field the list does not name, a value of the wrong kind and a ref of another kind',
    async (type) => {
      const spec = SENSE_TYPES[type];
      const base = shaped(type);
      const events: unknown[] = [
        { ...base, id: uuidv7(), data: { ...(base.data ?? {}), title: 'An invented title' } },
        { ...base, id: uuidv7(), ref: 'thread:0192f0c4-0000-7000-8000-000000000004' },
      ];
      const reasons = ['bad_data', 'bad_ref'];
      const first = Object.keys(spec.data)[0];
      if (first) {
        events.push({ ...base, id: uuidv7(), data: { ...base.data, [first]: { nested: 'words' } } });
        reasons.push('bad_data');
      }
      const r = await put(events);
      expect(r.body.accepted).toBe(0);
      expect(r.body.rejected.map((x) => x.reason)).toEqual(reasons);
    },
  );

  it('refuses a type the list does not have, even of a known app', async () => {
    const r = await put([
      { id: uuidv7(), at: NOW - 1_000, type: 'podcast.titles' },
      { id: uuidv7(), at: NOW - 1_000, type: 'health.note', data: { note: 'private' } },
      { id: uuidv7(), at: NOW - 1_000, type: 'study.query', data: { q: 'words the owner typed' } },
    ]);
    expect(r.body).toEqual({
      accepted: 0,
      rejected: [
        { i: 0, reason: 'bad_type' },
        { i: 1, reason: 'bad_type' },
        { i: 2, reason: 'bad_type' },
      ],
    });
  });

  it('keeps a type’s sensitivity as a floor: the phone may raise it, never lower it', async () => {
    const low = shaped('study.highlight', { sensitivity: 0 });
    const raised = shaped('study.read', { sensitivity: 1 });
    expect((await put([low, raised])).body.accepted).toBe(2);
    const rows = await sql<{ id: string; sensitivity: number }>(
      'SELECT id, sensitivity FROM events WHERE id IN (?, ?)',
      low.id,
      raised.id,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.sensitivity]))).toEqual({ [low.id]: 1, [raised.id]: 1 });
  });
});

describe('the privacy switches', () => {
  it('an app switched off keeps nothing, its ratings neither; the others go on', async () => {
    await setSwitch('privacy.senses.podcasts', false);
    await setSwitch('privacy.senses.music', false);
    const play = shaped('podcast.play');
    const rate = shaped('music.rate', { ref: 'music:r2_native_switched', data: { rating: 1 } });
    const open = shaped('ring.choice');
    const r = await put([play, rate, open]);
    expect(r.body).toEqual({
      accepted: 1,
      rejected: [
        { i: 0, reason: 'switched_off' },
        { i: 1, reason: 'switched_off' },
      ],
    });
    expect(await sql('SELECT type FROM events WHERE id IN (?, ?, ?)', play.id, rate.id, open.id)).toEqual([
      { type: 'ring.choice' },
    ]);
    // On again: taken again.
    await setSwitch('privacy.senses.podcasts', true);
    await setSwitch('privacy.senses.music', true);
    expect((await put([shaped('podcast.play')])).body.accepted).toBe(1);
  });
});
