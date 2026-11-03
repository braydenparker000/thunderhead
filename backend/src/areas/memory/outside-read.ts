// Whether a memory read may carry outside text (MEMORY.md §6 M11f, kept.ts): always for the
// device; for a mind session only when it asked (`outside=1`), and then Core marks the session as
// having read outside text before the answer leaves the Worker (core-memory.ts `outsideRead`, as
// songs' tags are), so what it writes after is labelled `outside`. Nothing outside in the answer,
// nothing to mark. The routes: GET /v1/search, /v1/memory/facts, /day-notes and /open-threads
// (a fact's detail decides in Core, where its cited day notes are).
import type { Context } from 'hono';
import type { AppEnv } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

/** The read asked for outside text (`outside=1` or `true`). */
export const askedOutside = (c: Context<AppEnv>) => ['1', 'true'].includes(c.req.query('outside') ?? '');

/** `found`: the answer holds outside text. True when it may be served as it is. */
export async function servesOutside(c: Context<AppEnv>, found: boolean): Promise<boolean> {
  const caller = callerOf(c);
  if (caller.who === 'D') return true;
  if (!askedOutside(c)) return false;
  if (found) value(await fresh(coreObject(c.env).outsideRead(caller)));
  return true;
}

/** The answer as this caller may have it: `keep` maps a row to its kept-back form. */
export async function served<T extends { provenance?: string | null }>(
  c: Context<AppEnv>,
  items: T[],
  keep: (t: T) => T,
  found: (t: T) => boolean = (t) => t.provenance === 'outside',
): Promise<T[]> {
  return (await servesOutside(c, items.some(found))) ? items : items.map(keep);
}
