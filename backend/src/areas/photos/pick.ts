// POST /v1/photos/from-drive (PHOTOS.md §3.1, API.md §11.26): files the owner picked in Google's
// picker, which made each visible to this app (the scope stays drive.file). The Worker asks Drive
// for each one's metadata (one call a file, at most 20 a request, so a request stays far under the
// free plan's 50 subrequests; the phone sends the rest in further requests) and registers the ones
// the shelf does not know, with no preview, the way the daily pass does (ops.ts `found`). The files
// stay where they are in Drive; the shelf keeps their ids. Nothing here logs a name or a token.
import * as z from 'zod/mini';
import {
  type DriveFile,
  type FromDriveResponse,
  PHOTO_LIMITS as L,
  photoFormat,
} from '../../../../shared/contract/photos.ts';
import { ApiError } from '../../http/errors';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { pickedFile } from './google';
import { accessToken } from './token';

export const pickBody = z.strictObject({
  ids: z
    .array(z.string().check(z.regex(/^[A-Za-z0-9_-]{1,160}$/)))
    .check(z.minLength(1), z.maxLength(L.pick_per_request)),
});

const ISSUE = {
  folder: 'a folder, not a photo',
  trashed: "in Drive's trash",
  missing: 'not in Drive, or not shared with this app',
};

export async function fromDrive(env: Env, ids: string[]): Promise<FromDriveResponse> {
  let a: Awaited<ReturnType<typeof accessToken>>;
  try {
    a = await accessToken(env);
  } catch {
    throw new ApiError('upstream');
  }
  if (a === 'not_configured') throw new ApiError('not_configured');
  if (typeof a === 'string')
    throw new ApiError('conflict', [{ path: 'drive', issue: 'Google Drive is not connected' }]);
  const unique = [...new Set(ids)];
  let metas: Awaited<ReturnType<typeof pickedFile>>[];
  try {
    const token = a.token;
    metas = await Promise.all(unique.map((id) => pickedFile(token, id)));
  } catch {
    throw new ApiError('upstream');
  }
  const files: DriveFile[] = [];
  const refused: FromDriveResponse['refused'] = [];
  metas.forEach((m, i) => {
    const id = unique[i] as string;
    if (m === null) refused.push({ id, issue: ISSUE.missing });
    else if (typeof m === 'string') refused.push({ id, issue: ISSUE[m] });
    else if (photoFormat(m.name, m.mime) === 'other') refused.push({ id, issue: 'not a RAF, DNG, JPEG or HEIC file' });
    else files.push(m);
  });
  const out = files.length ? value(await fresh(coreObject(env).photosFromDrive(files))) : { added: [], already: [] };
  return { ...out, refused };
}
