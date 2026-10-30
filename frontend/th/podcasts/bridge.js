// The ported Podcasts app's data move (P8, MIGRATION.md §7 step 5), inside its own service worker
// (podcasts/sw.js imports this). The app is unchanged: it still asks the old Worker's addresses
// (`…/podcasts/search`, `/browse`, `/feed`, `/audio`), its `<audio>` element and downloads too. This
// worker answers them from the new Worker instead, with the owner's session on this site:
// - search and browse from GET /v1/podcasts/directory, as they come;
// - a feed from GET /v1/podcasts/feed, read here into the page of episodes the app expects
//   (th/podcasts/feed.js; PODCASTS.md §4.1: the phone parses, the Worker stays inside its 10 ms),
//   kept 10 minutes so the "Show more" pages agree;
// - an episode's audio from GET /v1/podcasts/audio, byte ranges and all.
// The new Worker's refusals come back in the shape the app reads, `{error: words}`. Until it can
// answer (signed out, an old session, the new Worker down), the request goes to the old Worker as
// before, and the new one is asked again 5 minutes later. A framed copy of the app never gets the
// owner's session. Nothing here names an outside host; podcasts/sw.js names the old Worker (`use`).
import { FeedError, parseFeed, publicURL } from '/th/podcasts/feed.js';
import { sessionToken } from '/th/ported/session.js';

const ROUTES = new Set(['/podcasts/search', '/podcasts/browse', '/podcasts/feed', '/podcasts/audio']);
const RETRY_MS = 5 * 60_000;
const KEEP_MS = 10 * 60_000;
const PASS = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'];
/** "The new Worker can't answer yet": fall back, and ask again later. */
const NOT_READY = Symbol('not ready');

const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  token: sessionToken,
  /** The API's origin from this site's config.js (written at deploy), or ''. */
  api: async () => {
    const text = await (await fetch('/config.js', { cache: 'no-cache' })).text();
    const m = /CONFIG = (\{.*\});/.exec(text);
    return m ? String(JSON.parse(m[1]).api || '') : '';
  },
  /** @param {any} event */
  topLevel: async (event) => {
    if (!event?.clientId) return true;
    const c = await /** @type {any} */ (self).clients.get(event.clientId);
    return !c || c.frameType === 'top-level';
  },
};

let OLD = '';
let offUntil = 0;
/** @type {string | null} */
let api = null;
/** @type {Map<string, { raw: string, until: number }>} */
const feeds = new Map();

/** @param {unknown} body */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** @param {string} path @param {string} token @param {Record<string, string>} [headers] */
async function ask(path, token, headers = {}) {
  const r = await deps.fetch(`${api}/v1/podcasts/${path}`, { headers: { ...headers, Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if ([401, 403, 503].includes(r.status)) {
    await r.body?.cancel();
    throw NOT_READY;
  }
  return r;
}

/** The new Worker's refusal in the old Worker's shape, its words kept. @param {Response} r */
async function refusal(r) {
  let words = '';
  try {
    const e = (await r.json()).error;
    words = e?.details?.reason ?? e?.message ?? '';
  } catch {}
  return json({ error: words || 'The podcast service is unavailable.' }, r.status);
}

/** @param {URL} url @param {string} token */
async function directory(url, token) {
  const q = new URLSearchParams();
  if (url.pathname.endsWith('/search')) q.set('q', url.searchParams.get('q') || '');
  else q.set('category', url.searchParams.get('category') || 'popular');
  if (url.searchParams.has('country')) q.set('country', url.searchParams.get('country') || '');
  const r = await ask(`directory?${q}`, token);
  return r.ok ? new Response(r.body, { headers: { 'Content-Type': 'application/json' } }) : refusal(r);
}

/** @param {URL} url @param {string} token */
async function feed(url, token) {
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 199) return json({ error: 'Invalid episode page' }, 400);
  try {
    const address = publicURL(url.searchParams.get('url') || '');
    const had = feeds.get(address);
    let raw = had && had.until > deps.now() ? had.raw : undefined;
    if (raw === undefined) {
      const r = await ask(`feed?url=${encodeURIComponent(address)}`, token);
      if (!r.ok) return refusal(r);
      raw = await r.text();
      feeds.delete(address);
      feeds.set(address, { raw, until: deps.now() + KEEP_MS });
      if (feeds.size > 4) feeds.delete(/** @type {string} */ (feeds.keys().next().value));
    }
    return json(parseFeed(raw, address, { offset, limit: 40 }));
  } catch (e) {
    if (e instanceof FeedError) return json({ error: e.message }, e.status);
    throw e;
  }
}

/** @param {Request} req @param {URL} url @param {string} token */
async function audio(req, url, token) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const h of ['Range', 'If-Range']) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const q = new URLSearchParams({ feed: url.searchParams.get('feed') || '', id: url.searchParams.get('id') || '' });
  const r = await ask(`audio?${q}`, token, headers);
  if (r.status >= 400 && r.status !== 416) return refusal(r);
  const out = new Headers();
  for (const h of PASS) {
    const v = r.headers.get(h);
    if (v !== null) out.set(h, v);
  }
  return new Response(r.body, { status: r.status, headers: out });
}

/** @param {Request} req */
async function fromNew(req) {
  const url = new URL(req.url);
  const token = await deps.token();
  if (!token) throw NOT_READY;
  api ??= await deps.api();
  if (!api) throw NOT_READY;
  if (url.pathname === '/podcasts/feed') return feed(url, token);
  if (url.pathname === '/podcasts/audio') return audio(req, url, token);
  return directory(url, token);
}

export const podcastsBridge = {
  /** The origin the app addresses (the old Worker's). @param {string} origin */
  use: (origin) => {
    OLD = new URL(origin).origin;
  },
  /** @param {URL} url */
  handles: (url) => !!OLD && url.origin === OLD && ROUTES.has(url.pathname),
  /** The answer to one of the app's requests to the old Worker. @param {Request} req @param {any} event */
  answer: async (req, event) => {
    if (req.method === 'GET' && deps.now() >= offUntil && (await deps.topLevel(event))) {
      try {
        return await fromNew(req);
      } catch (e) {
        if (e === NOT_READY) offUntil = deps.now() + RETRY_MS;
      }
    }
    return deps.fetch(req);
  },
  deps,
  reset: () => {
    offUntil = 0;
    api = null;
    feeds.clear();
  },
};
