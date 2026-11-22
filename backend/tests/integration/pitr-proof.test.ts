// The point-in-time check (OPERATIONS.md §4.4, areas/backups/proof.ts): on each class's scratch copy
// `pitr-proof` only, never Auth, at the first tick of a deploy; the outcome in the ledger, the
// setting `backups.pitr` and deep health. Cloudflare's point-in-time API is not supported in local
// development (it keeps no durable log of changes here), so the check runs against a fake behind the
// same interface (areas/backups/pitr.ts `usePitr`): these tests prove the order, the guards and what
// is recorded, never that Cloudflare restores. Only the live check proves that.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeepHealthResponse } from '../../../shared/contract/api';
import type { PitrProofs } from '../../../shared/contract/backups.ts';
import { type Pitr, pitrFailure, usePitr } from '../../src/areas/backups/pitr';
import { runProofs } from '../../src/areas/backups/proof';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

const calls: { cls: string; name: string; op: string }[] = [];
let broken = false;
/** Bookmarks are names; the scratch copy's restart drops the marker row, as the real restore would. */
const fake = (ctx: DurableObjectState, cls: string, name: string): Pitr => ({
  current: async () => {
    calls.push({ cls, name, op: 'current' });
    return `now-${cls}`;
  },
  forTime: async () => {
    calls.push({ cls, name, op: 'forTime' });
    return `at-${cls}`;
  },
  arm: async () => {
    if (broken) throw new Error("This Durable Object's storage back-end does not implement point-in-time recovery.");
    calls.push({ cls, name, op: 'arm' });
    return `undo-${cls}`;
  },
  restart: () => {
    calls.push({ cls, name, op: 'restart' });
    ctx.storage.sql.exec("DELETE FROM _pitr_proof WHERE k = 'marker'");
  },
});

let p: Principals;
const tick = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(Date.now()));
const proofs = async () =>
  (await coreSql<{ v: string }>("SELECT value_json AS v FROM settings WHERE key = 'backups.pitr'")).map(
    (r) => JSON.parse(r.v) as PitrProofs,
  )[0];

beforeAll(async () => {
  usePitr(fake);
  p = await principals();
});
afterAll(() => usePitr(null));

describe('the point-in-time check', () => {
  it('runs on each class scratch copy only, never Auth, and is recorded in the ledger and deep health', async () => {
    await tick();
    const got = await proofs();
    expect(Object.fromEntries(Object.entries(got.classes).map(([k, v]) => [k, v?.outcome]))).toEqual({
      core: 'ok',
      music: 'ok',
      senses: 'ok',
      library: 'ok',
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.name === 'pitr-proof' && c.cls !== 'auth')).toBe(true);
    expect(calls.filter((c) => c.op === 'arm').map((c) => c.cls)).toEqual(['core', 'music', 'senses', 'library']);
    const note = await coreSql<{ what: string }>("SELECT what FROM ledger WHERE ref LIKE 'pitr:%'");
    expect(note[0]?.what).toMatch(/core ok, music ok, senses ok, library ok/);
    const deep = (await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: p.D })).body;
    expect(deep.backups?.pitr?.classes.music?.outcome).toBe('ok');
    // Not again on the same deploy.
    const before = calls.length;
    await tick();
    expect(calls.length).toBe(before);
  });

  it('a marker still there after the restart is `failed`, never `ok`', async () => {
    usePitr((ctx, cls, name) => ({ ...fake(ctx, cls, name), restart: () => undefined }));
    try {
      expect((await runProofs(env, Date.now())).core).toMatchObject({ outcome: 'failed', code: 'marker_kept' });
    } finally {
      usePitr(fake);
    }
  });

  it('records `unsupported` from the real API, which local development lacks, and `failed` with a code', async () => {
    usePitr(null);
    try {
      const out = await runProofs(env, Date.now());
      for (const cls of ['core', 'music', 'senses', 'library'] as const)
        expect(out[cls]).toMatchObject({ outcome: 'unsupported', code: 'unsupported' });
    } finally {
      usePitr(fake);
    }
    broken = true;
    try {
      expect((await runProofs(env, Date.now())).music).toMatchObject({ outcome: 'unsupported' });
    } finally {
      broken = false;
    }
    expect(pitrFailure(new TypeError('boom: private words'))).toEqual({ outcome: 'failed', code: 'TypeError' });
  });
});
