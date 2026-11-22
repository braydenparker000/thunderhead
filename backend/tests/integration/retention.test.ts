// Old backups (areas/backups/retention.ts, DATA.md §11.3): off by default, so nothing is deleted
// until the owner turns on "Keep 8 weekly and 12 monthly backups"; on, exactly the rule's sets go,
// never the newest complete backup of a part, never anything outside `backups/` of the private
// bucket, never the music bucket; the mind cannot turn it on.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { prunePlan } from '../../src/areas/backups/retention';
import { ownerOnly } from '../../src/areas/settings/mind-set';
import { DAY } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, core } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const tick = (at = Date.now()) =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(at));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// 70 weekly sets, newest first, a week apart (about 16 months): Core, Music and the senses complete
// in each; Study's only complete one is the 40th, and the newest set is still being written.
const NOW = Date.now();
const DATES = Array.from({ length: 70 }, (_, i) => day(NOW - (i + 1) * 7 * DAY));
// No tick here falls on a Sunday, whose tick would start the weekly backup first and wait for it:
// the first one (`off`) on today or tomorrow, then the pass, turned on, runs on the next day.
const sunday = (ms: number) => new Date(ms).getUTCDay() === 0;
const FIRST = NOW + (sunday(NOW) ? DAY : 0);
const NEXT = FIRST + (sunday(FIRST + DAY) ? 2 : 1) * DAY;
// A set under a name of another shape (none is written today) is never deleted.
const ODD = ['2020-01-05-copy'];
function keysOf(date: string, i: number): string[] {
  const out: string[] = [];
  for (const cls of ['core', 'music', 'senses', 'library']) {
    out.push(`backups/${date}/${cls}/ledger.0001.jsonl.gz`);
    const complete = cls === 'library' ? i === 39 : i > 0;
    if (complete) out.push(`backups/${date}/${cls}/manifest.json`);
  }
  return out;
}
const ALL = [...DATES.flatMap(keysOf), ...ODD.flatMap((d) => keysOf(d, 5))];
const OUTSIDE = ['drills/2026-01/report.json', 'restores/0000.json', 'backups/README'];

/** The rule, written out plainly: the 8 newest weekly sets, the newest of each of the 12 newest
 * months, Study's only complete one (old), and the set under another name. */
function expectedKept(): Set<string> {
  const keep = new Set(DATES.slice(0, 8));
  const months: string[] = [];
  for (const d of DATES)
    if (!months.includes(d.slice(0, 7)) && months.length < 12) {
      months.push(d.slice(0, 7));
      keep.add(d);
    }
  keep.add(DATES[39]);
  keep.add(ODD[0]);
  return keep;
}

async function bucketKeys(bucket: R2Bucket): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    out.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

beforeAll(async () => {
  p = await principals();
  for (const k of [...ALL, ...OUTSIDE]) await env.VAULT.put(k, 'x');
  await env.MEDIA.put('backups/2020-01-05/core/manifest.json', 'x');
});

describe('old backups', () => {
  it('the rule keeps the newest complete backup of every part, even when it is old', () => {
    const { drop } = prunePlan(ALL);
    expect(drop.some((k) => k.includes(DATES[39]))).toBe(false);
    // Without Study's old one, the 8 weekly and 12 monthly decide alone.
    const noStudy = ALL.filter((k) => !k.includes('/library/'));
    const kept = new Set(noStudy.filter((k) => !prunePlan(noStudy).drop.includes(k)).map((k) => k.split('/')[1]));
    const months = new Set<string>();
    const want = new Set(DATES.slice(0, 8));
    for (const d of DATES)
      if (!months.has(d.slice(0, 7)) && months.size < 12) {
        months.add(d.slice(0, 7));
        want.add(d);
      }
    want.add(ODD[0]);
    expect([...kept].sort()).toEqual([...want].sort());
  });

  it('off (the default): the daily pass deletes nothing', async () => {
    await tick(FIRST);
    expect((await bucketKeys(env.VAULT)).filter((k) => ALL.includes(k) || OUTSIDE.includes(k)).length).toBe(
      ALL.length + OUTSIDE.length,
    );
  });

  it('only the owner turns it on; the mind may not', async () => {
    // The mind's `settings.set` refuses every privacy.* key (settings/mind-set.ts ownerOnly).
    expect(ownerOnly('privacy.backups.prune')).toBe(true);
    expect((await api('PATCH', '/v1/settings', { token: p.C, body: { 'privacy.backups.prune': true } })).status).toBe(
      403,
    );
    expect((await api('PATCH', '/v1/settings', { token: p.D, body: { 'privacy.backups.prune': true } })).status).toBe(
      200,
    );
  });

  it('on: deletes exactly the sets the rule drops, nothing outside backups/, never the music bucket', async () => {
    await tick(NEXT);
    const left = await bucketKeys(env.VAULT);
    const keep = expectedKept();
    const sets = new Set(left.filter((k) => ALL.includes(k)).map((k) => k.split('/')[1]));
    expect([...sets].sort()).toEqual([...keep].sort());
    for (const k of ALL) expect(left.includes(k)).toBe(keep.has(k.split('/')[1]));
    for (const k of OUTSIDE) expect(left).toContain(k);
    expect(await env.MEDIA.head('backups/2020-01-05/core/manifest.json')).not.toBeNull();
    // Once a day: a second tick the same day deletes nothing more.
    await tick(NEXT);
    expect((await bucketKeys(env.VAULT)).length).toBe(left.length);
  });
});
