// The Worker's own record that a mind session read songs' tags (MUSIC.md §10.5, MEMORY.md §7): a
// track's title, artist and album come from its file, which someone else wrote, so serving them to a
// mind session taints that session as a file would (source `th music`): a dated taint event on every
// read, already tainted or not, so a sibling's read after a claim counts against that claim. A night
// session's read is also recorded (`songs_at`), which closes the web to every night session claimed
// before it (RUNTIME.md §6.4). Recorded in Core before the tags are served, whatever the hooks did.
// A mind principal must name its session (TH-Session, 422 without), a claimed, live one of its role
// (403 session_required otherwise), checked on every read, so a raw call can't read tags unrecorded.
// The eval sandbox has no music (its Core is a scratch one, where no session is claimed): 422 there,
// before anything else. The device is never marked. The routes: GET /v1/music/tracks, /notes, /find,
// and /analysis/:id (its neighbours' tags).
import type { Context } from 'hono';
import { MUSIC_TAINT_SOURCE } from '../../../../shared/contract/music.ts';
import type { AppEnv } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

/** Marks the calling mind session (a no-op for a device). */
export async function tagsRead(c: Context<AppEnv>): Promise<void> {
  const caller = callerOf(c);
  if (caller.who === 'D') return;
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no music' }]);
  if (caller.session_id === null)
    throw new ApiError('validation', [
      { path: 'TH-Session', issue: "required: songs' tags taint the session that reads them" },
    ]);
  value(await fresh(coreObject(c.env).mindTaint(caller, MUSIC_TAINT_SOURCE, true)));
}
