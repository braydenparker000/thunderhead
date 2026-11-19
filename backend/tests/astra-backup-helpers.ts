// The owner's Astra copy in tests (integration/astra-backup*.test.ts): one request helper through the
// real app with the test bucket, and copies shaped like a real phone's. Everything is invented: the
// add-on addresses (addon.example, with an invented key in the path), the titles and the times.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { app } from '../src/app';

/** An invented add-on address of the kind that carries its settings and a debrid key in its path. */
export const ADDON = 'https://addon.example/eyJpbnZlbnRlZCI6dHJ1ZX0-sealed-invented-key-0011/manifest.json';
export const ADDON_SECRET = 'eyJpbnZlbnRlZCI6dHJ1ZX0-sealed-invented-key-0011';

export interface Answer<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  text: string;
  body: T & { error?: { code: string; details?: unknown; message: string } };
}

/** One request to /v1/astra/backup with a token, a body (an object, or text sent as it is) and,
 * when given, other bindings (`VAULT: undefined` for a config without the bucket). */
export async function backup<T = Record<string, unknown>>(
  method: 'GET' | 'PUT' | 'DELETE',
  token: string | null,
  body?: unknown,
  over: Partial<Env> = {},
): Promise<Answer<T>> {
  const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.10' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request('https://api.example.test/v1/astra/backup', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await app.fetch(request, { ...env, ...over } as Env, createExecutionContext());
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: (text ? JSON.parse(text) : null) as Answer<T>['body'],
  };
}

const meta = (i: number, type: string) => ({
  id: `tt${String(1_000_000 + i).padStart(7, '0')}`,
  type,
  name: `An Invented ${type === 'series' ? 'Series' : 'Film'} Number ${i}`,
  poster: `https://images.example/poster/${i}/w342-abcdefghijklmnopqrstuvwxyz0123456789.jpg`,
  background: `https://images.example/background/${i}/original-abcdefghijklmnopqrstuvwxyz.jpg`,
  logo: `https://images.example/logo/${i}/w500-abcdefghijkl.png`,
  releaseInfo: '2001–2004',
  genres: ['Drama', 'Mystery', 'Science Fiction'],
});

/** A phone's data shaped as Astra's store keeps it: `progress` episodes with a next episode each,
 * `library` titles, `watched` episodes, and a few add-ons. */
export function realStore(n: { progress: number; library: number; watched: number }, at = 1_763_600_000_000) {
  const progress: Record<string, unknown> = {};
  for (let i = 0; i < n.progress; i++) {
    const m = meta(i, 'series');
    const videoId = `${m.id}:${1 + (i % 9)}:${1 + (i % 24)}`;
    progress[`series:${m.id}|${videoId}`] = {
      ...{ type: 'series', id: m.id, videoId, season: 1 + (i % 9), episode: 1 + (i % 24) },
      ...{ time: 812.5, duration: 2640, updated: at - i * 60_000, completed: false },
      meta: m,
      next: {
        videoId: `${m.id}:${1 + (i % 9)}:${2 + (i % 24)}`,
        season: 1 + (i % 9),
        episode: 2 + (i % 24),
        title: `The Invented Episode Title ${i}`,
        thumbnail: `https://images.example/episode/${i}/thumb-abcdefghijklmnop.jpg`,
      },
    };
  }
  const library: Record<string, unknown> = {};
  for (let i = 0; i < n.library; i++) {
    const m = meta(50_000 + i, i % 2 ? 'series' : 'movie');
    library[`${m.type}:${m.id}`] = { ...m, added: at - i * 3_600_000 };
  }
  const watched: Record<string, number> = {};
  for (let i = 0; i < n.watched; i++)
    watched[`series:tt${2_000_000 + (i >> 5)}|tt${2_000_000 + (i >> 5)}:1:${i & 31}`] = at - i;
  const addons = [
    { url: 'https://v3-cinemeta.strem.io/manifest.json', enabled: true, name: 'Cinemeta' },
    { url: ADDON, enabled: true, name: 'Invented Streams' },
    ...Array.from({ length: 8 }, (_, i) => ({
      url: `https://addon${i}.example/c/x${i}/manifest.json`,
      enabled: true,
      name: `Add-on ${i}`,
    })),
  ];
  const settings = { posterWidth: 126, hero: true, hiddenRows: ['example:movie:top'], readyAhead: true };
  return { addons, library, progress, watched, settings, recentSearches: ['invented', 'example film'] };
}

/** A `sync/1` copy of a store, every key changed at `at`. */
export function copyOf(store: Record<string, unknown>, at = 1_763_600_000_000) {
  return { astra: 'sync/1', keys: Object.fromEntries(Object.entries(store).map(([k, value]) => [k, { at, value }])) };
}
