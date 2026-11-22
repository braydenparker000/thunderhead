// The Worker's own record that a night session read songs' tags (MUSIC.md §10.5, RUNTIME.md §6.4):
// a track's title, artist and album are the owner's own songs, so serving them marks no session
// (owner, 2026-11-22); but a night session's read is recorded (`songs_at`), which closes the web to
// every night session claimed before it, so no title leaves the Worker. Recorded in Core before the
// tags are served, whatever the hooks did. A night principal must name its session (TH-Session,
// 422 without), a claimed, live one (403 session_required otherwise), checked on every read, so a
// raw call can't read tags unrecorded. The chat and the reflex read them freely. The eval sandbox
// has no music (its Core is a scratch one, where no session is claimed): 422 there, before anything
// else. The device is never marked. The routes: GET /v1/music/tracks, /notes, /find, and
// /analysis/:id (its neighbours' tags).
import type { Context } from 'hono';
import { MUSIC_TAINT_SOURCE } from '../../../../shared/contract/music.ts';
import type { AppEnv } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

/** Records a night session's read (a no-op for a device, the chat and the reflex). */
export async function tagsRead(c: Context<AppEnv>): Promise<void> {
  const caller = callerOf(c);
  if (caller.who === 'D') return;
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no music' }]);
  if (caller.who !== 'N') return;
  if (caller.session_id === null)
    throw new ApiError('validation', [
      { path: 'TH-Session', issue: "required: a night session's read of songs' tags is recorded" },
    ]);
  value(await fresh(coreObject(c.env).mindTaint(caller, MUSIC_TAINT_SOURCE, true)));
}
