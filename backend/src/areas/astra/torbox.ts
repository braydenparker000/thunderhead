// TorBox's API for Astra's relay (RULES: api.torbox.app/v1/api, `Authorization: Bearer <key>`,
// requestdl takes the key as `token`). Each call has its own time limit (8 s) inside the request's
// (25 s); a 429 or 5xx is tried once more after a short wait, never again; every call is counted
// on the request and refused past `torbox_calls_max`. TorBox's description of its answers is thin,
// so every answer is read defensively: `{success, error, detail, data}` with any of them missing.
// TorBox's own words (`detail`) are read for what they say but never passed on: a step's note comes
// from words.ts. The file's own address (requestdl) is in links.ts.
import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { mediaType, type TorrentFile } from './files';
import { ask, type Relay, TimedOut, timed, timesNow, wait } from './upstream';
import { NOTE } from './words';

const API = 'https://api.torbox.app/v1/api';
const UA = 'Thunderhead-Astra/1.0 (personal app; 1 viewer)';

/** A call that could not be made or answered; `note` says why in fixed words. `refused`: TorBox
 * answered and said no (a 4xx other than the key's or a busy one, or success false), as it does for
 * a torrent id it no longer knows. */
export class TorboxTrouble extends Error {
  constructor(
    readonly note: string,
    readonly refused = false,
  ) {
    super('torbox');
    this.name = 'TorboxTrouble';
  }
}

interface Body {
  success?: unknown;
  error?: unknown;
  detail?: unknown;
  data?: unknown;
}
export interface Answer {
  status: number;
  body: Body;
  /** The JSON as sent, for an answer that may not be TorBox's usual envelope (the speed-test list). */
  json: unknown;
  /** A redirect's Location, as sent. */
  location: string | null;
}

export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const AUTH_ERRORS = new Set(['BAD_TOKEN', 'AUTH_ERROR', 'NO_AUTH']);

/** Why an answer is not a success, in fixed words, or null when it is one. */
export function trouble(a: Answer): string | null {
  if (a.status === 401 || a.status === 403 || AUTH_ERRORS.has(String(a.body.error))) return NOTE.badKey;
  if (a.status === 429) return NOTE.busy;
  if (a.status < 200 || a.status > 299) return NOTE.status(a.status);
  return a.body.success === true ? null : NOTE.refused;
}

/** One call: `path` under the API, or a whole TorBox address (a permanent link, which carries its
 * own token). Tried once more on a 429 or 5xx when time allows. */
export async function call(
  r: Relay,
  target: string,
  o: { key?: string; form?: Record<string, string>; until?: number } = {},
): Promise<Answer> {
  const t = timesNow();
  const url = target.startsWith('https://') ? target : `${API}${target}`;
  const until = Math.min(o.until ?? r.deadline, r.deadline);
  for (let attempt = 0; ; attempt++) {
    const ms = Math.min(t.torbox_ms, until - Date.now());
    if (ms <= 0) throw new TorboxTrouble(NOTE.slow);
    if (r.calls >= L.torbox_calls_max) throw new TorboxTrouble(NOTE.budget);
    r.calls++;
    let answer: Answer;
    try {
      answer = await timed(ms, async (signal) => {
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        if (o.key) headers.Authorization = `Bearer ${o.key}`;
        let body: FormData | undefined;
        if (o.form) {
          body = new FormData();
          for (const [k, v] of Object.entries(o.form)) body.set(k, v);
        }
        const res = await ask(url, { method: body ? 'POST' : 'GET', headers, body, redirect: 'manual', signal });
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON (an HTML error page): the status says enough.
        }
        return {
          status: res.status,
          body: record(parsed) as Body,
          json: parsed,
          location: res.headers.get('Location'),
        };
      });
    } catch (e) {
      throw new TorboxTrouble(e instanceof TimedOut ? NOTE.slow : NOTE.unreachable);
    }
    const again = answer.status === 429 || answer.status >= 500;
    if (!again || attempt > 0 || until - Date.now() < t.retry_ms + 1000) return answer;
    await wait(t.retry_ms);
  }
}

export const must = (a: Answer): Answer => {
  const why = trouble(a);
  const no = a.status >= 400 && a.status < 500 && why !== NOTE.badKey && why !== NOTE.busy;
  if (why) throw new TorboxTrouble(why, why === NOTE.refused || no);
  return a;
};

/** A torrent's file as TorBox lists it; `at` is its place, used when TorBox gives no id. */
function fileOf(v: unknown, at: number): TorrentFile | null {
  const f = record(v);
  const name = typeof f.name === 'string' ? f.name : typeof f.short_name === 'string' ? f.short_name : null;
  if (!name) return null;
  const size = Number.isSafeInteger(f.size) ? (f.size as number) : null;
  return { id: Number.isSafeInteger(f.id) ? (f.id as number) : at, name, size, type: mediaType(f.mimetype) };
}
const filesOf = (v: unknown): TorrentFile[] =>
  (Array.isArray(v) ? v : []).map(fileOf).filter((f): f is TorrentFile => f !== null);
/** A file list only when TorBox gave every file its own id (a place in a list is not one). */
const filesWithIds = (v: unknown): TorrentFile[] => {
  const list = Array.isArray(v) ? v : [];
  return list.length && list.every((f) => Number.isSafeInteger(record(f).id)) ? filesOf(list) : [];
};

/** Whether TorBox has the torrent ready, and its files when it lists them. `data` is an object
 * keyed by hash (format=object), a list (format=list), or empty when nothing is cached: only then
 * is "not cached" definite. Any other shape leaves it unknown, which is trouble, not "not cached". */
export async function checkCached(r: Relay, key: string, hash: string) {
  const q = new URLSearchParams({ hash, format: 'object', list_files: 'true' });
  const { body } = must(await call(r, `/torrents/checkcached?${q}`, { key }));
  const ours = (e: unknown) => String(record(e).hash).toLowerCase() === hash;
  const data = body.data;
  if (!data || typeof data !== 'object') throw new TorboxTrouble(NOTE.unreadable);
  const obj = record(data);
  const entry = Array.isArray(data)
    ? data.find(ours)
    : (obj[hash] ?? obj[hash.toUpperCase()] ?? Object.values(obj).find(ours));
  // `true` (an answer without files) is cached too; its files are then learnt after the add.
  return entry ? { cached: true, files: filesOf(record(entry).files) } : { cached: false, files: [] };
}

/** What TorBox's words said of an add: an item already in the account, a new one, or neither. */
function said(detail: unknown): 'existing' | 'new' | null {
  const d = String(detail ?? '');
  if (/already|exist|duplicate/i.test(d)) return 'existing';
  return /\b(added|created|queued)\b/i.test(d) ? 'new' : null;
}

/** Adds the torrent only if TorBox already has it ready (add_only_if_cached), seeding off, no zip.
 * TorBox refusing it as not cached is the definite "not on TorBox yet". TorBox's description of
 * the answer is empty: its files are taken only when it lists them, each with its id. */
export async function addCached(
  r: Relay,
  key: string,
  hash: string,
): Promise<
  { id: number; said: 'existing' | 'new' | null; files: TorrentFile[] } | { notCached: true } | { refused: string }
> {
  const form = {
    magnet: `magnet:?xt=urn:btih:${hash}`,
    add_only_if_cached: 'true',
    seed: '3',
    allow_zip: 'false',
    as_queued: 'false',
  };
  const a = await call(r, '/torrents/createtorrent', { key, form });
  const data = record(a.body.data);
  const id = data.torrent_id ?? data.id;
  if (!trouble(a) && Number.isSafeInteger(id))
    return { id: id as number, said: said(a.body.detail), files: filesWithIds(data.files) };
  if (a.body.error === 'DOWNLOAD_NOT_CACHED' || /not\s+cached/i.test(String(a.body.detail ?? '')))
    return { notCached: true };
  const why = trouble(a) ?? NOTE.refused;
  // A refused key or a busy TorBox is no reason to look through the list.
  if (why === NOTE.badKey || why === NOTE.busy || a.status >= 500) throw new TorboxTrouble(why);
  return { refused: why };
}

/** The torrent in the owner's account with this hash, and its files, from the list's first `page`
 * items (a press reads only the newest: `list_page_ahead`). */
export async function findOwned(r: Relay, key: string, hash: string, page: number) {
  const q = new URLSearchParams({ offset: '0', limit: String(page) });
  const { body } = must(await call(r, `/torrents/mylist?${q}`, { key }));
  const list = Array.isArray(body.data) ? body.data : [];
  const t = list.map(record).find((e) => String(e.hash).toLowerCase() === hash && Number.isSafeInteger(e.id));
  return t ? { id: t.id as number, files: filesOf(t.files) } : null;
}

/** One torrent's files, fresh. */
export async function torrentFiles(r: Relay, key: string, id: number): Promise<TorrentFile[]> {
  const q = new URLSearchParams({ id: String(id), bypass_cache: 'true' });
  const { body } = must(await call(r, `/torrents/mylist?${q}`, { key }));
  const one = Array.isArray(body.data) ? body.data.map(record).find((e) => e.id === id) : record(body.data);
  return filesOf(one?.files);
}

/** GET /v1/astra/torbox: whether TorBox takes the key, and the plan number it gives. */
export async function account(r: Relay, key: string) {
  try {
    const a = await call(r, '/user/me', { key });
    const why = trouble(a);
    if (why === NOTE.badKey) return { ok: false, plan: null, note: why };
    if (why) return { ok: null, plan: null, note: why };
    const plan = record(a.body.data).plan;
    return { ok: true, plan: Number.isSafeInteger(plan) ? (plan as number) : null };
  } catch (e) {
    return { ok: null, plan: null, note: e instanceof TorboxTrouble ? e.note : NOTE.unreachable };
  }
}
