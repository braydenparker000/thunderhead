// Astra's relay tests (integration/astra*.test.ts): a stub TorBox and stub add-on and file hosts
// behind the relay's swappable fetch, and one request helper. Everything is invented: the key, the
// hashes, the hosts (addon.example, cdn.example, …) and the films.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { AstraPlayResponse, AstraStep, AstraTorboxResponse } from '../../shared/contract/astra.ts';
import { app } from '../src/app';

export const KEY = 'invented-torbox-key-0000-1111-2222';
export const HASH = 'aa11bb22cc33dd44ee55ff6600778899aabbccdd';
export const OTHER = '0123456789abcdef0123456789abcdef01234567';
export const LINK = `https://addon.example/api/v1/debrid/playback/sealed/-/eyJpbnZlbnRlZCI6dHJ1ZX0/tt0000001/Invented.Film.2001.mkv`;
export const FILE_NAME = 'Invented.Film.2001.mkv';
export const SITE = 'https://site.example.test';
export const MB = 1024 * 1024;
export const TORBOX = 'https://api.torbox.app/v1/api';
/** An invented TorBox file server: its "tb-cdn" label is what marks one. */
export const FILE_SERVER = 'store-039.wnam.tb-cdn.example';

export interface Asked {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: Record<string, string> | null;
}
type Handler = (req: Asked, signal: AbortSignal | undefined) => Response | Promise<Response>;

/** The stub world: every request the relay made, and how each host answers (set per test). */
export const world = {
  asked: [] as Asked[],
  hosts: new Map<string, Handler>(),
};

/** The relay's fetch: records the request, then asks the host's handler (404 without one). */
export const stubFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  let form: Record<string, string> | null = null;
  if (init?.body instanceof FormData)
    form = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, String(v)]));
  const req = { url, method: init?.method ?? 'GET', headers, form };
  world.asked.push(req);
  const handler = world.hosts.get(new URL(url).hostname);
  return handler ? handler(req, init?.signal ?? undefined) : new Response('', { status: 404 });
};

export const torboxCalls = () => world.asked.filter((a) => a.url.startsWith(TORBOX));
export const pathsAsked = () => torboxCalls().map((a) => new URL(a.url).pathname.replace('/v1/api', ''));

/** A handler that never answers until its request is aborted. */
export const never: Handler = (_req, signal) =>
  new Promise((_resolve, reject) =>
    signal?.addEventListener('abort', () => reject(new DOMException('gone', 'AbortError'))),
  );

export interface Torrent {
  id: number;
  hash: string;
  files: { id: number; name: string; size: number; mimetype?: string }[];
}

/** A TorBox that knows which hashes are cached and which torrents the account holds (newest first;
 * the list honours `offset` and `limit`). `add` says how createtorrent answers for an item already
 * held: its id, or a duplicate refusal; `'not-cached'` refuses every add as not cached. `link`
 * replaces requestdl's address; `cachedData` replaces checkcached's `data`. */
export function torbox(o: {
  cached: Torrent[];
  owned: Torrent[];
  add?: 'id' | 'duplicate' | 'not-cached';
  nextId?: number;
  link?: string;
  cachedData?: unknown;
  addDetail?: string;
}): Handler {
  return (req) => {
    const u = new URL(req.url);
    const path = u.pathname.replace('/v1/api', '');
    const ok = (data: unknown) => Response.json({ success: true, error: null, detail: 'Invented.', data });
    if (path === '/user/me') {
      if (req.headers.authorization !== `Bearer ${KEY}`)
        return Response.json({ success: false, error: 'BAD_TOKEN', detail: 'Invented.' }, { status: 403 });
      return ok({ id: 1, email: 'owner@example.com', plan: 2, customer: 'cus_invented' });
    }
    if (path === '/torrents/requestdl') {
      const token = u.searchParams.get('token');
      if (token !== KEY && token !== 'permalink-token')
        return Response.json({ success: false, error: 'BAD_TOKEN' }, { status: 403 });
      const id = Number(u.searchParams.get('torrent_id'));
      if (token === KEY && !o.owned.some((t) => t.id === id))
        return Response.json({ success: false, error: 'ITEM_NOT_FOUND' }, { status: 404 });
      const file = `https://${FILE_SERVER}/dl/${id}/${u.searchParams.get('file_id')}`;
      // A permanent link (redirect=true) answers with its redirect, as TorBox's do.
      if (u.searchParams.get('redirect') === 'true')
        return new Response(null, { status: 302, headers: { Location: file } });
      return ok(o.link ?? file);
    }
    if (req.headers.authorization !== `Bearer ${KEY}`)
      return Response.json({ success: false, error: 'NO_AUTH' }, { status: 401 });
    if (path === '/torrents/checkcached') {
      const hash = u.searchParams.get('hash') ?? '';
      const t = o.cached.find((c) => c.hash === hash);
      if ('cachedData' in o) return ok(o.cachedData);
      return ok(
        t
          ? { [hash]: { name: 'Invented', size: 1, hash, files: t.files.map(({ name, size }) => ({ name, size })) } }
          : {},
      );
    }
    if (path === '/torrents/createtorrent') {
      const hash = /btih:([0-9a-f]{40})/.exec(req.form?.magnet ?? '')?.[1] ?? '';
      const t = o.cached.find((c) => c.hash === hash);
      if (!t || o.add === 'not-cached')
        return Response.json({ success: false, error: 'DOWNLOAD_NOT_CACHED', detail: 'Invented.' }, { status: 400 });
      const held = o.owned.find((c) => c.hash === hash);
      if (held && o.add === 'duplicate')
        return Response.json({ success: false, error: 'DUPLICATE_ITEM' }, { status: 400 });
      if (!held) o.owned.push({ ...t, id: o.nextId ?? 500 });
      const data = { torrent_id: (held ?? o.owned[o.owned.length - 1]).id, hash, auth_id: 'invented' };
      return Response.json({ success: true, error: null, detail: o.addDetail ?? 'Invented.', data });
    }
    if (path === '/torrents/mylist') {
      const shape = (t: Torrent) => ({
        id: t.id,
        hash: t.hash,
        name: 'Invented',
        files: t.files.map((f) => ({ ...f, short_name: f.name.split('/').pop() })),
      });
      const id = u.searchParams.get('id');
      if (id) {
        const t = o.owned.find((c) => c.id === Number(id));
        return t ? ok(shape(t)) : Response.json({ success: false, error: 'ITEM_NOT_FOUND' }, { status: 404 });
      }
      const offset = Number(u.searchParams.get('offset') ?? 0);
      return ok(o.owned.slice(offset, offset + Number(u.searchParams.get('limit') ?? 1000)).map(shape));
    }
    return new Response('', { status: 404 });
  };
}

/** The add-on answers its link with a 302 to `to`. */
export const forward =
  (to: string): Handler =>
  () =>
    new Response(null, { status: 302, headers: { Location: to } });

/** A file host that answers a one-byte range of a film of `size` bytes. */
export const film =
  (size: number, headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' }): Handler =>
  () =>
    new Response('x', {
      status: 206,
      headers: { 'Content-Type': 'video/x-matroska', 'Content-Range': `bytes 0-0/${size}`, ...headers },
    });

export type PlayBody = Record<string, unknown>;
export type PlayAnswer = AstraPlayResponse & {
  error?: { code: string; details: { reason: string; steps: AstraStep[] }; retry_after?: number };
};

/** One request through the real app, with the given TorBox key (or none) and device token. */
export async function relay<T = PlayAnswer>(
  token: string,
  o: { body?: PlayBody; key?: string; path?: string; origin?: string; follow?: 'on' | 'off' } = {},
): Promise<{ status: number; body: T; text: string }> {
  const headers = new Headers({ Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '192.0.2.10' });
  if (o.body) headers.set('Content-Type', 'application/json');
  if (o.origin) headers.set('Origin', o.origin);
  const path = o.path ?? (o.body ? '/v1/astra/play' : '/v1/astra/torbox');
  const request = new Request(`https://api.example.test${path}`, {
    method: o.body ? 'POST' : 'GET',
    headers,
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const e = { ...env, TORBOX_KEY: o.key ?? 'none', ASTRA_FOLLOW: o.follow ?? env.ASTRA_FOLLOW } as Env;
  const res = await app.fetch(request, e, createExecutionContext());
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as T, text };
}

export type TorboxAnswer = AstraTorboxResponse & { error?: { code: string } };
