// Google, as the Worker asks it (PHOTOS.md §3.7): the consent address, the code and refresh-token
// exchanges, the app's folder, one page of the folder's files and a file to the trash. Scope
// drive.file only: the app sees the files it made and nothing else in the Drive. Tests swap the
// fetch (the Worker never calls Google in a test). Nothing here logs a token or a name.
import { DRIVE_SCOPE, type DriveFile } from '../../../../shared/contract/photos.ts';

export const GOOGLE = {
  consent: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  files: 'https://www.googleapis.com/drive/v3/files',
  about: 'https://www.googleapis.com/drive/v3/about',
} as const;
const FOLDER = 'application/vnd.google-apps.folder';

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch Google is asked with. */
export function useGoogle(f: typeof fetch): void {
  fetcher = f;
}

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`google ${status} ${reason}`);
  }
}

export interface Client {
  id: string;
  secret: string;
  redirect: string;
}

async function ask<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { error?: string | { status?: string } };
  if (!res.ok) {
    const e = body.error;
    throw new GoogleError(res.status, typeof e === 'string' ? e : (e?.status ?? 'error'));
  }
  return body as T;
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function consentUrl(c: Client, state: string): string {
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE.consent}?${q}`;
}

type Tokens = { access_token: string; expires_in: number; refresh_token?: string };

export async function exchange(c: Client, code: string, now: number) {
  const t = await ask<Tokens>(
    GOOGLE.token,
    form({
      code,
      client_id: c.id,
      client_secret: c.secret,
      redirect_uri: c.redirect,
      grant_type: 'authorization_code',
    }),
  );
  return {
    access_token: t.access_token,
    expires_at: now + t.expires_in * 1000,
    refresh_token: t.refresh_token ?? null,
  };
}

/** A new access token; 'revoked' when Google no longer honours the grant. */
export async function refresh(c: Client, token: string, now: number) {
  try {
    const t = await ask<Tokens>(
      GOOGLE.token,
      form({ refresh_token: token, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' }),
    );
    return { access_token: t.access_token, expires_at: now + t.expires_in * 1000 };
  } catch (e) {
    if (e instanceof GoogleError && e.reason === 'invalid_grant') return 'revoked' as const;
    throw e;
  }
}

/** The app's folder by name (one it made before, after a reconnect), or a new one. */
export async function folder(token: string, name: string): Promise<string> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false`;
  const found = await ask<{ files: { id: string }[] }>(
    `${GOOGLE.files}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`,
    { headers: bearer(token) },
  );
  if (found.files?.[0]?.id) return found.files[0].id;
  const made = await ask<{ id: string }>(`${GOOGLE.files}?fields=id`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER }),
  });
  return made.id;
}

type Listed = { id?: string; name?: string; size?: string; modifiedTime?: string; mimeType?: string };

/** The folder's files changed after `after` (an RFC 3339 time), oldest first, at most `max` in
 * ONE page (one subrequest: the daily pass stays far under the free plan's 50 a run); returns them
 * checked, and the newest time seen, from where the next run goes on. */
export async function listFolder(token: string, folderId: string, after: string | null, max: number) {
  const files: DriveFile[] = [];
  let cursor = after;
  const q = `'${folderId}' in parents and trashed = false${after ? ` and modifiedTime > '${after}'` : ''}`;
  const params = new URLSearchParams({
    q,
    orderBy: 'modifiedTime',
    pageSize: String(max),
    fields: 'files(id, name, size, modifiedTime, mimeType)',
  });
  const r = await ask<{ files?: Listed[] }>(`${GOOGLE.files}?${params}`, { headers: bearer(token) });
  for (const f of (r.files ?? []).slice(0, max)) {
    const modified = Date.parse(f.modifiedTime ?? '');
    if (f.modifiedTime && Number.isFinite(modified)) cursor = f.modifiedTime;
    if (!f.id || !/^[A-Za-z0-9_-]{1,160}$/.test(f.id) || !Number.isFinite(modified) || f.mimeType === FOLDER) continue;
    files.push({
      id: f.id,
      name: String(f.name ?? 'Untitled'),
      size: Number(f.size) || 0,
      modified,
      mime: String(f.mimeType ?? ''),
    });
  }
  return { files, cursor };
}

/** An original to Drive's own trash (the owner can still take it back there for 30 days):
 * `done` when it is there or no longer ours to reach (404, 403), `retry` on anything else. */
export async function trash(token: string, id: string): Promise<'done' | 'retry'> {
  try {
    await ask(`${GOOGLE.files}/${encodeURIComponent(id)}?fields=id`, {
      method: 'PATCH',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    return 'done';
  } catch (e) {
    return e instanceof GoogleError && (e.status === 404 || e.status === 403) ? 'done' : 'retry';
  }
}

/** A file's parents, size and SHA-256 as Drive has them (the check at registration), or null when
 * Drive does not know it or it is not ours to see. */
export async function fileMeta(token: string, id: string) {
  try {
    const f = await ask<{ parents?: string[]; size?: string; sha256Checksum?: string; trashed?: boolean }>(
      `${GOOGLE.files}/${encodeURIComponent(id)}?fields=parents,size,sha256Checksum,trashed`,
      { headers: bearer(token) },
    );
    return {
      parents: f.parents ?? [],
      size: Number(f.size),
      sha256: f.sha256Checksum ?? null,
      trashed: f.trashed === true,
    };
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

/** The Google account that gave the consent, by its address (Settings › Photos shows it). */
export async function account(token: string): Promise<string | null> {
  const a = await ask<{ user?: { emailAddress?: string } }>(`${GOOGLE.about}?fields=user(emailAddress)`, {
    headers: bearer(token),
  });
  return a.user?.emailAddress?.slice(0, 200) ?? null;
}

export async function revoke(token: string): Promise<void> {
  // In the body, never the address (SECURITY.md rule 8: no tokens in URLs).
  await fetcher(GOOGLE.revoke, form({ token })).catch(() => undefined);
}
