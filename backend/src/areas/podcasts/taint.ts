// What podcast publishers wrote (show titles, feed addresses, a feed) is outside text: when the
// Worker serves it to a mind principal, Core marks that request's session tainted first
// (core-podcasts.ts `podcastsRead`), so no client, flag or path trick can read it clean. The
// owner's device is never marked. API.md §11.25, RUNTIME.md §12.1.
import type { Context } from 'hono';
import { type AppEnv, principalOf, whoOf } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

export async function taintMindReader(c: Context<AppEnv>): Promise<void> {
  if (whoOf(principalOf(c)) === 'D') return;
  value(await fresh(coreObject(c.env).podcastsRead(callerOf(c))));
}
