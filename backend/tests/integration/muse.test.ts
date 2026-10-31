// P4 stage G: Muse's own thread (MUSE.md §4) and `muse.silent` after 26 hours without a call, which
// the Briefing page says plainly. (The Daily Board these once shared a file with was cut on
// 2026-10-31.)
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefingResponse } from '../../../shared/contract/briefing.ts';
import type { WatchdogsResponse } from '../../../shared/contract/watchdogs.ts';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let M = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));

beforeAll(async () => {
  p = await principals();
  M = await makeAgent(p.D, 'muse');
  await api('GET', '/v1/work/hello', { token: M });
});

describe("Muse's thread and silence", () => {
  it('notes go to its own thread, which the owner and the mind can read', async () => {
    const id = uuidv7();
    expect(
      (
        await api('POST', '/v1/work/thread/messages', {
          token: M,
          body: { id, body: 'The feed for the weather moved.' },
        })
      ).status,
    ).toBe(201);
    const t = await apiJson<{ items: { author: string; body: string }[] }>('GET', '/v1/work/thread', { token: p.D });
    expect(t.body.items.at(-1)).toMatchObject({ author: 'muse', body: 'The feed for the weather moved.' });
    expect(
      (await api('POST', '/v1/work/thread/messages', { token: M, body: { id, body: 'Something else' } })).status,
    ).toBe(409);
  });

  it('muse.silent trips after 26 hours without a call', async () => {
    await coreSql(
      "UPDATE settings SET value_json = json_set(value_json, '$.last', ?) WHERE key = 'muse.seen'",
      Date.now() - 27 * HOUR,
    );
    await watch();
    const items = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: p.D })).body.items;
    expect(items.find((i) => i.name === 'muse.silent')).toMatchObject({ state: 'tripped' });
    expect((await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D })).body.muse).toBe(
      "Muse hasn't checked in since yesterday.",
    );
  });
});
