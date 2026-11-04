// The daily Drive pass (PHOTOS.md §3.1), from the 15-minute cron once a logical day: the originals
// of photos purged from Recently deleted go to Drive's own trash (each on its own: one Drive no
// longer has, or will not let us reach, is done; a busy Drive's is kept for the next day), then the
// app's folder is listed from where the last pass stopped (ids, names, sizes, times; oldest change
// first, one page of at most 200 files) and each file the shelf does not know becomes a photo with
// no preview (the phone makes one when it is opened). The day is marked done whatever happened, so a
// failing or unlinked Drive is asked once a day, not every tick. Outbound calls a run: at most one
// token + 20 trashes + one listing = 22, under the free plan's 50 subrequests. Core's rows guard holds it.
import { PHOTO_LIMITS as L } from '../../../../shared/contract/photos.ts';
import { coreObject } from '../../objects/core';
import { listFolder, trash } from './google';
import { accessToken } from './token';

export async function drivePass(env: Env, now = Date.now()): Promise<{ added: number; trashed: number } | null> {
  const core = coreObject(env);
  const plan = await core.photosDrive(now);
  if (!plan.due) return null;
  const a = await accessToken(env, now).catch(() => 'failed' as const);
  const trashed: string[] = [];
  let list: Awaited<ReturnType<typeof listFolder>> = { files: [], cursor: plan.cursor };
  if (typeof a !== 'string') {
    for (const id of plan.gone.slice(0, L.trash_per_run)) if ((await trash(a.token, id)) === 'done') trashed.push(id);
    list = await listFolder(a.token, a.folder_id, plan.cursor, L.reconcile_files).catch(() => list);
  }
  const out = await core.photosReconciled(list.files, list.cursor, trashed, now);
  return { added: out.ok ? out.value : 0, trashed: trashed.length };
}
