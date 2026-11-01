// The Worker's own record that a mind session read songs' tags (MUSIC.md §10.5, MEMORY.md §7): a
// track's title, artist and album come from its file, which someone else wrote, so serving them to a
// mind session taints that session as a file would (source `th music`), and for a night session also
// records that it read them, which closes the web to it (RUNTIME.md §6.4). Recorded before the tags
// are served, whatever the hooks did, so deleting th's own state on the mind's side skips nothing.
// The routes: GET /v1/music/tracks, /notes, /find, and /analysis/:id (its neighbours' tags). This
// isolate remembers the sessions it marked, so a run of calls asks the objects once.
import type { Context } from 'hono';
import { MUSIC_TAINT_SOURCE } from '../../../../shared/contract/music.ts';
import type { AppEnv } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';

const marked = new Set<string>();

/** For tests: forget the sessions this isolate marked. */
export function forgetMarked(): void {
  marked.clear();
}

/** Marks the calling mind session (no-op for a device, or a call without TH-Session). */
export async function tagsRead(c: Context<AppEnv>): Promise<void> {
  const caller = callerOf(c);
  if (caller.who === 'D' || caller.session_id === null) return;
  const key = `${caller.who}:${caller.session_id}`;
  if (marked.has(key)) return;
  value(await fresh(coreObject(c.env).mindTaint(caller, MUSIC_TAINT_SOURCE)));
  if (caller.who === 'N') await fresh(musicObject(c.env).markReader(caller.session_id, Date.now()));
  if (marked.size >= 512) marked.clear();
  marked.add(key);
}
