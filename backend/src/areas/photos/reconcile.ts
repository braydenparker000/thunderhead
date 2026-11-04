// The daily Drive pass (PHOTOS.md §3.1), from the 15-minute cron once a logical day: the originals
// of photos purged from Recently deleted go to Drive's own trash, then the app's folder is listed
// from where the last pass stopped (ids, names, sizes, times; oldest change first, pages of 100,
// at most 200 files a run) and each file the shelf does not know becomes a photo with no preview
// (the phone makes one when it is opened). Without a live grant it waits for one; Core's rows guard
// holds it with the other heavy work.
import { PHOTO_LIMITS as L } from '../../../../shared/contract/photos.ts';
import { coreObject } from '../../objects/core';
import { listFolder, trash } from './google';
import { accessToken } from './token';

export async function drivePass(env: Env, now = Date.now()): Promise<{ added: number; trashed: number } | null> {
  const core = coreObject(env);
  const plan = await core.photosDrive(now);
  if (!plan.due) return null;
  const a = await accessToken(env, now);
  if (typeof a === 'string') return null;
  const trashed: string[] = [];
  for (const id of plan.gone) {
    await trash(a.token, id);
    trashed.push(id);
  }
  const list = await listFolder(a.token, a.folder_id, plan.cursor, L.reconcile_files);
  const out = await core.photosReconciled(list.files, list.cursor, trashed, now);
  return { added: out.ok ? out.value : 0, trashed: trashed.length };
}
