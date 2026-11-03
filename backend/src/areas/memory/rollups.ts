// The senses' half of rule M5 (MEMORY.md §4, §6): an `observed` fact may rest on one `rollup:` ref
// that counts at least 10 of the owner's events, a routine of the senses
// (`rollup:routines/<type>/<weekdays>/<from>-<to>/<to day>`). Core's transaction can't call another
// object, so the memory route asks first: once Core has said the caller may write memory at all
// (core-memory.ts `memoryWriter`, which also gives the owner's zone), each distinct `rollup:` ref the
// batch cites is counted again by the Senses object's `routineRef` (objects/senses.ts), and the
// counts go into the batch with it; `cite()` (validate.ts) takes a ref counted at n ≥ 10 and refuses
// any other as `bad_evidence`. A call that fails, or a count that takes longer than
// `ROLLUPS_TIMEOUT_MS` in all, counts nothing: the refs are then `bad_evidence`, never a 500.
import { sensesObject } from '../../objects/senses';

/** What the route asks of the senses: a ref counted again, or null when it counts nothing. */
export interface Rollups {
  routineRef(ref: string, tz: string): Promise<{ n: number } | null>;
}

/** The Senses object as the source of counts. */
export const sensesRollups = (env: Env): Rollups => ({
  async routineRef(ref, tz) {
    const r = await sensesObject(env).routineRef(ref, tz);
    return r && typeof r.n === 'number' ? { n: r.n } : null;
  },
});

/** Where the route gets its counts (a test puts a stub here). */
export const ROLLUPS: { source: (env: Env) => Rollups } = { source: sensesRollups };

/** At most this many distinct `rollup:` refs are counted for one batch; any more stay uncounted. */
export const ROLLUPS_PER_BATCH = 20;
/** The whole count's time limit (the senses answer in milliseconds; a stuck call must not hold the
 * night's batch). */
export const ROLLUPS_TIMEOUT_MS = 5_000;

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

/** Each ref counted again in the owner's zone `tz`: ref → n (a ref left out counts nothing). All of
 * them or none: any failure, or the time limit, counts nothing. */
export async function rollupCounts(env: Env, refs: string[], tz: string): Promise<Record<string, number>> {
  if (!refs.length) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), ROLLUPS_TIMEOUT_MS);
  });
  try {
    const source = ROLLUPS.source(env);
    const counted = Promise.all(refs.map(async (ref) => [ref, await source.routineRef(ref, tz)] as const));
    const got = await Promise.race([counted, late]);
    const counts: Record<string, number> = {};
    for (const [ref, r] of got ?? []) if (r) counts[ref] = r.n;
    return counts;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
