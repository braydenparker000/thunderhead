// Outside facts nobody kept (MEMORY.md §6 M11g, PRIVACY.md §2; owner ruling 2026-11-03): the daily
// prune pass drops a fact labelled `outside` whose version waited 90 days for the owner's Keep, as
// the owner's forget would (versions, FTS entries, the ledger rows' words and undo; a tombstone
// stays), with one ledger row that says how many. A kept one never expires, nor a pinned one, one the
// import left for review, or one from before the label.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { OUTSIDE_KEEP_DAYS } from '../../src/areas/memory/expire';
import { DAY } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { addOp, as, brief, labelled, ops, ownerSays, type Principals, principals } from '../memory-helpers';

let P = {} as Principals;
const READ = 'cse_expiry_read';
const outside = () => as(P.N, READ);
const device = () => ({ token: P.D });
const ids: Record<'old' | 'recent' | 'kept' | 'pinned' | 'unlabelled' | 'imported', string> = {
  old: '',
  recent: '',
  kept: '',
  pinned: '',
  unlabelled: '',
  imported: '',
};
/** Every version of a fact's lineage, written `days` ago. */
const age = (id: string, days: number) =>
  coreSql(
    'UPDATE facts SET recorded_at = ? WHERE lineage_id = (SELECT lineage_id FROM facts WHERE id = ?)',
    Date.now() - days * DAY,
    id,
  );
const present = async (id: string) => (await coreSql('SELECT 1 AS x FROM facts WHERE id = ?', id)).length === 1;
const tick = async () => {
  await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
  return runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(Date.now()));
};

beforeAll(async () => {
  P = await principals();
  const said = await ownerSays(P.D, 'I like calm music in the evening.');
  await brief(P.N, READ, 'night');
  await apiJson('POST', '/v1/mind/taint', { ...outside(), body: { source: 'WebFetch', ref_kind: 'url' } });
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) {
    const op = addOp([`msg:${said}`], {
      text: `An outside fact (${k})`,
      ...(k === 'imported' ? { source: 'inferred', tags: ['imported'] } : {}),
    });
    expect(await labelled(outside(), op), k).toBe('outside');
    ids[k] = op.id;
  }
  const kept = await ops(device(), [{ op: 'confirm', id: ids.kept }]);
  expect(kept.body.applied[0].provenance).toBe('owner');
  await ops(device(), [{ op: 'pin', id: ids.pinned, pinned: true }]);
  await coreSql('UPDATE facts SET provenance = NULL WHERE id = ?', ids.unlabelled);
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) await age(ids[k], OUTSIDE_KEEP_DAYS + 1);
  await age(ids.recent, OUTSIDE_KEEP_DAYS - 1);
});

describe('the prune pass drops what nobody kept', () => {
  it('drops an outside fact 90 days unkept, as a forget would, and says how many only', async () => {
    const [row] = await coreSql<{ id: string }>('SELECT ledger_id AS id FROM facts WHERE id = ?', ids.old);
    await tick();
    expect(await present(ids.old)).toBe(false);
    expect(await coreSql('SELECT id FROM fact_tombstones WHERE id = ?', ids.old)).toEqual([{ id: ids.old }]);
    expect(await coreSql('SELECT rowid FROM facts_fts WHERE facts_fts MATCH \'"old"\'')).toEqual([]);
    const [wrote] = await coreSql<{ why: string; undoable: number }>(
      'SELECT why, undoable FROM ledger WHERE id = ?',
      row.id,
    );
    expect(wrote).toEqual({ why: 'dropped: nobody kept it', undoable: 0 });
    const said = await coreSql<{ what: string; why: string; ref: string | null }>(
      "SELECT what, why, ref FROM ledger WHERE actor = 'worker' AND what LIKE 'dropped %'",
    );
    expect(said).toEqual([
      { what: 'dropped 1 outside fact nobody kept', why: "outside facts wait 90 days for the owner's keep", ref: null },
    ]);
  });

  it('keeps a kept one, a pinned one, a younger one, one left for review and one from before the label', async () => {
    for (const k of ['recent', 'kept', 'pinned', 'unlabelled', 'imported'] as const)
      expect(await present(ids[k]), k).toBe(true);
    // Nothing more to drop the next day either.
    await tick();
    expect((await coreSql("SELECT 1 AS x FROM ledger WHERE actor = 'worker' AND what LIKE 'dropped %'")).length).toBe(
      1,
    );
  });
});
