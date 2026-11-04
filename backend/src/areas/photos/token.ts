// The Drive access token (PHOTOS.md §3.7): minted in the Worker from the sealed refresh token,
// kept in the Auth object's memory until five minutes before it expires, handed only to the
// owner's phone (POST /v1/photos/upload-token) and to the Worker's own daily Drive pass. A grant
// Google refuses is marked revoked, and Settings › Photos says so in a plain line.

import { present } from '../../lib/secrets';
import { MINUTE } from '../../lib/time';
import { authObject } from '../../objects/auth';
import { type Client, refresh } from './google';

/** The OAuth client from the Worker's secrets; `origin` is the Worker's own (for the callback). */
export function clientOf(env: Env, origin = ''): Client | null {
  const e = env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
  const id = present(e.GOOGLE_CLIENT_ID);
  const secret = present(e.GOOGLE_CLIENT_SECRET);
  return id && secret ? { id, secret, redirect: `${origin}/v1/photos/drive/callback` } : null;
}

export type Access = { token: string; expires_at: number; folder_id: string };
export type NoAccess = 'not_configured' | 'not_connected' | 'revoked';

export async function accessToken(env: Env, now = Date.now()): Promise<Access | NoAccess> {
  const client = clientOf(env);
  if (!client) return 'not_configured';
  const auth = authObject(env);
  const g = await auth.driveGrant(5 * MINUTE);
  if (!g) return 'not_connected';
  if (g.access) return { ...g.access, folder_id: g.folder_id };
  const t = await refresh(client, g.refresh, now);
  if (t === 'revoked') {
    await auth.driveRevoked();
    return 'revoked';
  }
  const access = { token: t.access_token, expires_at: t.expires_at };
  await auth.driveAccessPut(access);
  return { ...access, folder_id: g.folder_id };
}
