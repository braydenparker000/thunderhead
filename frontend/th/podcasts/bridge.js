// The ported Podcasts app's data move (P8, MIGRATION.md §7 step 5), inside its own service worker
// (podcasts/sw.js imports this). The app asks this site's own addresses `/podcasts/search`, `/browse`,
// `/feed`, `/audio` (once the old Worker's; MIGRATION.md §8: none leaves the phone for it now), its
// `<audio>` element and downloads too. This worker answers them from the new Worker, with the owner's session on this site:
// - search and browse from GET /v1/podcasts/directory, as they come;
// - a feed from GET /v1/podcasts/feed, read here into the page of episodes the app expects
//   (th/podcasts/feed.js; PODCASTS.md §4.1: the phone parses, the Worker stays inside its 10 ms),
//   kept 10 minutes so the "Show more" pages agree;
// - an episode's audio from GET /v1/podcasts/audio, byte ranges and all.
// The new Worker's refusals come back in the shape the app reads, `{error: words}`, and so does its
// not answering yet (signed out, an old session, the new Worker down): the app shows those words;
// nothing is asked of any other host. A framed copy of the app never gets the owner's session, unless
// home opened that frame itself (the island, th/ported/frames.js). Nothing here names an outside host.
import { FeedError, parseFeed, publicURL } from '/th/podcasts/feed.js';
// Home's own frames (the island) may have the session too (th/ported/frames.js sets self.thFrames).
import '/th/ported/frames.js';
import { sessionToken } from '/th/ported/session.js';
// The phone's data meter (th/data/worker.js): what this worker fetches, counted from its headers.
import '/th/data/worker.js';

const ROUTES = new Set(['/podcasts/search', '/podcasts/browse', '/podcasts/feed', '/podcasts/audio']);
const KEEP_MS = 10 * 60_000;
const PASS = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'];
/** "The new Worker can't answer yet" (no address for it) or "signed out": the app is told so, in its own shape. */
const NOT_READY = Symbol('not ready');
const SIGNED_OUT = Symbol('signed out');
/** The words for it (COPY.md: plain, short). */
const NOT_YET = { signedOut: 'Sign in to use Podcasts.', down: "Podcasts can't be reached right now." };
/** An answer from the network, counted for the data meter by its headers. @param {Response} r */
const counted = (r) => (/** @type {any} */ (self).thData?.count('podcasts', r), r);

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
    const frames = /** @type {any} */ (self).thFrames;
    if (frames) return frames.trusted(event.clientId);
    const c = await /** @type {any} */ (self).clients.get(event.clientId);
    return !c || c.frameType === 'top-level';
  },
};

let OLD = '';
/** @type {string | null} */
let api = null;
/** @type {Map<string, { raw: string, until: number }>} */
const feeds = new Map();

/** @param {unknown} body */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** @param {string} path @param {string} token @param {Record<string, string>} [headers] */
async function ask(path, token, headers = {}) {
  const r = counted(await deps.fetch(`${api}/v1/podcasts/${path}`, { headers: { ...headers, Authorization: `Bearer ${token}` }, cache: 'no-store' }));
  // The session refused (ended elsewhere, expired): signed out. Other refusals pass as they are (refusal()).
  if (r.status === 401) {
    await r.body?.cancel();
    throw SIGNED_OUT;
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
  if (!token) throw SIGNED_OUT;
  api ||= await deps.api().catch(() => '');
  if (!api) throw NOT_READY;
  if (url.pathname === '/podcasts/feed') return feed(url, token);
  if (url.pathname === '/podcasts/audio') return audio(req, url, token);
  return directory(url, token);
}

export const podcastsBridge = {
  /** The origin the app addresses (this site's own). @param {string} origin */
  use: (origin) => {
    OLD = new URL(origin).origin;
  },
  /** @param {URL} url */
  handles: (url) => !!OLD && url.origin === OLD && ROUTES.has(url.pathname),
  /** The answer to one of the app's requests: the new Worker's, or why it has none. @param {Request} req @param {any} event */
  answer: async (req, event) => {
    if (req.method !== 'GET') return json({ error: 'Not found' }, 404);
    // A frame home didn't open never gets the session: to it, the owner is signed out.
    if (!(await deps.topLevel(event))) return json({ error: NOT_YET.signedOut }, 401);
    try {
      return await fromNew(req);
    } catch (e) {
      if (e === SIGNED_OUT) return json({ error: NOT_YET.signedOut }, 401);
      if (e === NOT_READY) return json({ error: NOT_YET.down }, 503);
      // The network failed: the app's own "unavailable" line, as a fetch that failed.
      return Response.error();
    }
  },
  deps,
  reset: () => {
    api = null;
    feeds.clear();
  },
};
