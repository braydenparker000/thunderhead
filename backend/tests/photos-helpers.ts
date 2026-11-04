// Photos' test helpers (PHOTOS.md): a fake Google that answers the consent's code, refresh tokens,
// the folder, pages of the folder's listing and the trash, and records what it was asked; a photo's
// registration body. Every id, name, camera and token here is invented.
import { exports } from 'cloudflare:workers';
import { useGoogle } from '../src/areas/photos/google';
import { uuidv7 } from '../src/lib/ids';
import { apiJson, SITE } from './helpers';

export interface FakeGoogle {
  calls: { method: string; url: string; body: string }[];
  /** Files in the app's folder, as Drive lists them. */
  folder: { id: string; name: string; size: string; modifiedTime: string; mimeType: string }[];
  /** Google refuses the refresh token from now on (the owner removed the app's access). */
  revoked: boolean;
  minted: number;
  trashed: string[];
  /** What Drive says of a file at registration, by id (default: in the app's folder, the size and
   * hash of photoBody), or 404 for a file Drive does not have. */
  meta: Record<string, { parents?: string[]; size?: number; sha256?: string } | 404>;
  /** A trash that fails, by id, with this status. */
  trashFail: Record<string, number>;
}

export function fakeGoogle(): FakeGoogle {
  const g: FakeGoogle = { calls: [], folder: [], revoked: false, minted: 0, trashed: [], meta: {}, trashFail: {} };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  useGoogle(async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    const method = init?.method ?? 'GET';
    g.calls.push({ method, url, body });
    const u = new URL(url);
    if (u.pathname === '/token') {
      const f = new URLSearchParams(body);
      if (f.get('grant_type') === 'authorization_code')
        return f.get('code') === 'good-code'
          ? json({ access_token: `fake-access-${++g.minted}`, expires_in: 3599, refresh_token: 'fake-refresh-1' })
          : json({ error: 'invalid_grant' }, 400);
      if (g.revoked) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: `fake-access-${++g.minted}`, expires_in: 3599 });
    }
    if (u.pathname === '/revoke') return json({});
    if (u.pathname === '/drive/v3/files' && method === 'POST') return json({ id: 'folder-made-1' });
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') ?? '';
      if (q.startsWith('name =')) return json({ files: [] });
      const after = /modifiedTime > '([^']+)'/.exec(q)?.[1];
      const all = g.folder
        .filter((f) => !after || f.modifiedTime > after)
        .sort((a, b) => (a.modifiedTime < b.modifiedTime ? -1 : 1));
      const start = Number(u.searchParams.get('pageToken') ?? 0);
      const size = Number(u.searchParams.get('pageSize') ?? 100);
      const page = all.slice(start, start + size);
      return json({ files: page, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
    }
    if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'owner@example.test' } });
    const fileId = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'PATCH') {
      if (g.trashFail[fileId]) return json({ error: { status: 'FAIL' } }, g.trashFail[fileId]);
      g.trashed.push(fileId);
      return json({ id: 'x' });
    }
    if (u.pathname.startsWith('/drive/v3/files/')) {
      const m = g.meta[fileId] ?? {};
      if (m === 404) return json({ error: { status: 'NOT_FOUND' } }, 404);
      return json({
        parents: m.parents ?? ['folder-made-1'],
        size: String(m.size ?? 31_457_280),
        sha256Checksum: m.sha256 ?? 'a'.repeat(64),
        trashed: false,
      });
    }
    return json({ error: { status: 'NOT_FOUND' } }, 404);
  });
  return g;
}

/** The body of PUT /v1/photos/:id for an invented RAF in Drive. */
export function photoBody(o: { drive?: string; taken?: number; name?: string } = {}) {
  return {
    drive_id: o.drive ?? `drive-${uuidv7().slice(-12)}`,
    name: o.name ?? 'DSCF0001.RAF',
    format: 'raf',
    bytes: 31_457_280,
    sha256: 'a'.repeat(64),
    camera: 'FUJIFILM X-E5',
    film: 'Classic Chrome',
    width: 7728,
    height: 5152,
    taken_at: o.taken ?? Date.UTC(2026, 9, 30, 17, 0),
  };
}

/** A tiny JPEG-shaped preview body (synthetic, starts FF D8). */
export const previewBytes = (n = 2048) => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set([0xff, 0xd9], n - 2);
  return b;
};

/** Links Drive through the routes with the fake Google's good code (Connect, then the callback). */
export async function connectDrive(token: string): Promise<Response> {
  const r = await apiJson<{ url: string }>('POST', '/v1/photos/drive/connect', { token, headers: { Origin: SITE } });
  const state = new URL(r.body.url).searchParams.get('state');
  return exports.default.fetch(
    new Request(`https://api.example.test/v1/photos/drive/callback?code=good-code&state=${state}`, {
      redirect: 'manual',
    }),
  );
}
