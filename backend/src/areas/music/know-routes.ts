// /v1/music/know, /facts, /credits, /unmatched and /picks (MUSIC.md §19.3–19.7, API.md §11.9): what the
// Worker knows of the owner's music beyond their files, and the albums it suggests adding. Keyed reads
// only. Facts, credits and picks hold names and text from elsewhere (canonical names, Wikipedia,
// tags), and the unmatched list the owner's own catalog names: they are handed to the mind as songs'
// tags are (tags-read.ts): they mark no session, and a night session's read is recorded, which closes
// its web. The counts (`/know`) are numbers only. Never in the eval sandbox (422).
import { Hono } from 'hono';
import {
  type CreditsResponse,
  type FactsResponse,
  KNOW_LIMITS as K,
  type KnowStatus,
  PICK_STATES,
  type PickKind,
  type PickOrderResponse,
  type PickState,
  type PicksResponse,
  type UnmatchedResponse,
} from '../../../../shared/contract/know.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { MBID } from './history-mb';
import { clip } from './know-parse-mb';
import { isKind } from './picks-store';
import { previewResponse } from './preview-fetch';
import { tagsRead } from './tags-read';

const CONTROL = /\p{Cc}/u;
const ORDER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const noSandbox = () => {
  if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no music' }]);
};
const refOf = (v: string | undefined) => {
  const r = (v ?? '').trim();
  if (!r || r.length > K.name_chars || CONTROL.test(r))
    throw new ApiError('validation', [
      { path: 'ref', issue: `a MusicBrainz id or a name, 1 to ${K.name_chars} characters` },
    ]);
  return r;
};
const pickId = (v: string) => {
  if (!MBID.test(v))
    throw new ApiError('validation', [{ path: 'id', issue: 'a pick id (a MusicBrainz release group id)' }]);
  return v;
};
async function bodyOf(req: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => ({}));
  if (!b || typeof b !== 'object' || Array.isArray(b))
    throw new ApiError('validation', [{ path: 'body', issue: 'a JSON object' }]);
  return b as Record<string, unknown>;
}

export const knowRoutes = new Hono<AppEnv>()
  .get('/music/know', guard('GET /v1/music/know'), async (c) => {
    noSandbox();
    return c.json((await fresh(musicObject(c.env).knowStatus())) satisfies KnowStatus);
  })
  .get('/music/facts', guard('GET /v1/music/facts'), async (c) => {
    const ref = refOf(c.req.query('ref'));
    await tagsRead(c);
    return c.json((await fresh(musicObject(c.env).knowFacts(ref))) satisfies FactsResponse);
  })
  .get('/music/credits', guard('GET /v1/music/credits'), async (c) => {
    const ref = refOf(c.req.query('ref'));
    await tagsRead(c);
    return c.json((await fresh(musicObject(c.env).knowCredits(ref))) satisfies CreditsResponse);
  })
  .get('/music/unmatched', guard('GET /v1/music/unmatched'), async (c) => {
    noSandbox();
    await tagsRead(c);
    return c.json((await fresh(musicObject(c.env).knowUnmatched())) satisfies UnmatchedResponse);
  })
  .get('/music/picks', guard('GET /v1/music/picks'), async (c) => {
    noSandbox();
    const kind = c.req.query('kind');
    const state = c.req.query('state') ?? 'new';
    const limit = Number(c.req.query('limit') ?? K.picks_default);
    if (kind !== undefined && !isKind(kind))
      throw new ApiError('validation', [{ path: 'kind', issue: 'gap, new, neighbour, credit or influence' }]);
    if (!(PICK_STATES as readonly string[]).includes(state))
      throw new ApiError('validation', [{ path: 'state', issue: PICK_STATES.join(', ') }]);
    if (!Number.isInteger(limit) || limit < 1 || limit > K.picks_max)
      throw new ApiError('validation', [{ path: 'limit', issue: `1 to ${K.picks_max}` }]);
    await tagsRead(c);
    const r = await fresh(
      musicObject(c.env).picks({ kind: kind as PickKind | undefined, state: state as PickState, limit }),
    );
    return c.json(r satisfies PicksResponse);
  })
  // A pick's 30-second preview from Apple, passed through (preview-fetch.ts, MUSIC.md §19.7): the
  // owner's tap only; nothing is written.
  .get('/music/picks/:id/preview', guard('GET /v1/music/picks/:id/preview'), async (c) => {
    const pick = await fresh(musicObject(c.env).pickNames(pickId(c.req.param('id'))));
    if (!pick) throw new ApiError('not_found');
    return previewResponse(pick);
  })
  .post('/music/picks/:id/decline', guard('POST /v1/music/picks/:id/decline'), async (c) => {
    noSandbox();
    const id = pickId(c.req.param('id'));
    const b = await bodyOf(c.req);
    if (b.why !== undefined && (typeof b.why !== 'string' || b.why.length > K.why_chars))
      throw new ApiError('validation', [{ path: 'why', issue: `at most ${K.why_chars} characters` }]);
    const r = await fresh(musicObject(c.env).pickDecline(id, b.why ? clip(b.why, K.why_chars) : null));
    if (!r) throw new ApiError('not_found');
    return c.json(r);
  })
  .post('/music/picks/:id/order', guard('POST /v1/music/picks/:id/order'), async (c) => {
    noSandbox();
    const id = pickId(c.req.param('id'));
    const b = await bodyOf(c.req);
    if (b.order_id !== undefined && (typeof b.order_id !== 'string' || !ORDER_ID.test(b.order_id)))
      throw new ApiError('validation', [{ path: 'order_id', issue: 'the id th order new answered' }]);
    const r = await fresh(musicObject(c.env).pickOrder(id, (b.order_id as string | undefined) ?? null));
    if (!r) throw new ApiError('not_found');
    return c.json(r satisfies PickOrderResponse);
  });
