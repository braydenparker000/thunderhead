// The senses' half of rule M5 (MEMORY.md §4, §6): an `observed` fact may rest on one `rollup:` ref
// that counts at least 10 of the owner's events, a routine of the senses
// (`rollup:routines/<type>/<weekdays>/<from>-<to>/<to day>`). Core's transaction can't call another
// object, so the memory route asks first: each distinct `rollup:` ref a batch cites is counted again
// by `Rollups.routineRef` (the Senses object's, which the senses' routines add), and the counts go
// into the batch with it; `cite()` (validate.ts) takes a ref counted at n ≥ 10 and refuses any
// other as `bad_evidence`. A Senses object without `routineRef`, or a call that fails, counts
// nothing, so until the senses' routines are in, a `rollup:` ref is refused as before.
import { coreObject } from '../../objects/core';
import { sensesObject } from '../../objects/senses';

/** What the route asks of the senses: a ref counted again, or null when it counts nothing. */
export interface Rollups {
  routineRef(ref: string, tz: string): Promise<{ n: number } | null>;
}

/** The Senses object as the source of counts. Typed here, not by the object's class, so this works
 * before and after the senses' routines add the method. */
export const sensesRollups = (env: Env): Rollups => ({
  async routineRef(ref, tz) {
    try {
      const stub = sensesObject(env) as unknown as { routineRef(ref: string, tz: string): Promise<unknown> };
      const r = (await stub.routineRef(ref, tz)) as { n?: unknown } | null;
      return r && typeof r.n === 'number' ? { n: r.n } : null;
    } catch {
      return null;
    }
  },
});

/** Where the route gets its counts (a test puts a stub here). */
export const ROLLUPS: { source: (env: Env) => Rollups } = { source: sensesRollups };

/** At most this many distinct `rollup:` refs are counted for one batch; any more stay uncounted. */
export const ROLLUPS_PER_BATCH = 20;

const ROLLUP = /^rollup:[A-Za-z0-9._:/-]{1,160}$/;

/** The `rollup:` refs a batch's ops cite (an add's evidence, a supersede's new version's, a
 * confirm's), distinct, in order, at most `ROLLUPS_PER_BATCH`. */
export function rollupRefs(ops: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of ops) {
    const op = raw as { evidence?: unknown; new?: { evidence?: unknown } } | null;
    for (const list of [op?.evidence, op?.new?.evidence])
      if (Array.isArray(list))
        for (const r of list)
          if (typeof r === 'string' && ROLLUP.test(r.trim()) && out.size < ROLLUPS_PER_BATCH) out.add(r.trim());
  }
  return [...out];
}

/** Each `rollup:` ref the batch cites, counted again in the owner's zone: ref → n (a ref left out
 * counts nothing). The zone is read from Core only when there is a ref to count. */
export async function rollupCounts(env: Env, ops: unknown[]): Promise<Record<string, number>> {
  const refs = rollupRefs(ops);
  if (!refs.length) return {};
  const settings = (await coreObject(env).settings()) as { 'owner.tz'?: unknown };
  const tz =
    typeof settings['owner.tz'] === 'string' && settings['owner.tz'] ? settings['owner.tz'] : env.OWNER_TZ || 'UTC';
  const source = ROLLUPS.source(env);
  const counts: Record<string, number> = {};
  for (const ref of refs) {
    const r = await source.routineRef(ref, tz);
    if (r) counts[ref] = r.n;
  }
  return counts;
}
