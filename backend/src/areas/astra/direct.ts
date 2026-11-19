// The direct path (ASTRA.md §4.4, owner rulings 2026-11-18 and 2026-11-19): with the owner's key and
// the torrent's hash, ask TorBox itself, waiting for as few calls in a row as the rules allow.
// A press ("ahead") never adds: checkcached (with its file list) and the newest items of the
// account's list are asked together. In the account: the file's address (requestdl). Ready on
// TorBox but not in the account: what was learnt (the file list) is kept in memory (kept.ts) and the
// answer says so (READY), so the tap needs only createtorrent and requestdl. A tap ("play") goes to
// createtorrent with add_only_if_cached, checkcached beside it when no press left the file list:
// TorBox refusing the add as not cached is the definite "not on TorBox yet", answered as such, since
// following the add-on's link is how an add-on adds an uncached torrent. checkcached gives files no
// ids, only places, so requestdl for the file's place runs beside the torrent's own listing, which
// confirms its id; a file whose id is another is asked for again by that id (createtorrent's answer,
// when it lists files with their ids, needs no listing at all). A torrent found in the account is
// remembered, so the next ask costs requestdl alone. Every call is a step with its own time; calls
// made together overlap. A file that cannot be told apart is never guessed: no address (an already
// cached item left in the account is harmless and uses no slot).
import { type AstraMode, type AstraStepName, ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { chooseFile, type Hints, type TorrentFile, typeOfName } from './files';
import { forget, type Known, recall, recallReady, remember, rememberReady } from './kept';
import { type FileAddress, fileLink } from './links';
import { addCached, checkCached, findOwned, TorboxTrouble, torrentFiles } from './torbox';
import { mark, type Relay } from './upstream';
import { NOTE } from './words';

export interface Found {
  url: string;
  size: number | null;
  type: string | null;
}
type Ask = { hash: string | null; mode: AstraMode } & Hints;

/** TorBox said for certain that it does not have the torrent ready. */
export const NOT_CACHED = { notCached: true } as const;
/** A press found the torrent ready on TorBox and told its file apart, but the account does not hold
 * it: no address before a tap, and the tap needs only createtorrent and requestdl. */
export const READY = { ready: true } as const;
const SAID = { existing: NOTE.saidExisting, new: NOTE.saidNew } as const;

/** Trouble already marked on its own step. */
const marked = new WeakSet<object>();
type Said = { ok: boolean; note?: string };

/** One TorBox call as `name`, marked with its own time when it ends. Trouble marks it failed (as
 * `refusedNote` when TorBox refused it, if given) and goes on up. */
async function step<T>(
  r: Relay,
  name: AstraStepName,
  work: () => Promise<T>,
  said: (v: T) => Said,
  refusedNote?: string,
) {
  const since = Date.now();
  try {
    const value = await work();
    const s = said(value);
    mark(r, name, s.ok, since, s.note);
    return value;
  } catch (e) {
    throw failed(r, name, since, e, refusedNote);
  }
}
/** Marks a step that ended in trouble, once; the trouble goes on up. */
function failed(r: Relay, name: AstraStepName, since: number, e: unknown, refusedNote?: string): unknown {
  const refused = e instanceof TorboxTrouble && e.refused && refusedNote;
  mark(r, name, false, since, refused ? refusedNote : e instanceof TorboxTrouble ? e.note : NOTE.unreadable);
  if (e && typeof e === 'object') marked.add(e);
  return e;
}
/** A call started beside another: its trouble is read where it is awaited, never left unhandled. */
const beside = <T>(p: Promise<T>): Promise<{ value: T } | { error: unknown }> =>
  p.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const settled = <T>(o: { value: T } | { error: unknown } | null): T | null => (o && 'value' in o ? o.value : null);
const linked = (link: FileAddress): Said => ({ ok: true, note: link.note });
const cachedSaid = (c: { cached: boolean }): Said => ({ ok: c.cached, note: c.cached ? undefined : NOTE.notCached });

/** What the file step says of a list: the file the hints name, else why none can be told apart. */
function fileSaid(files: TorrentFile[], ask: Ask, guess: TorrentFile | null = null): Said {
  const file = files.length ? chooseFile(files, ask) : null;
  if (!file) return { ok: false, note: files.length ? NOTE.fileUnclear : NOTE.noFiles };
  return { ok: true, note: guess && file.id !== guess.id ? NOTE.otherId : undefined };
}
/** The torrent's own listing, fresh, as the file step with its own time, and the file it names. */
async function listing(r: Relay, key: string, id: number, hash: string, ask: Ask, guess: TorrentFile | null = null) {
  const files = await step(
    r,
    'file',
    () => torrentFiles(r, key, id, hash),
    (f) => fileSaid(f, ask, guess),
  );
  return { files, file: files.length ? chooseFile(files, ask) : null };
}
/** The file named in a list already in hand (memory, the account's list, createtorrent's answer). */
function choose(r: Relay, files: TorrentFile[], ask: Ask): TorrentFile | null {
  const s = fileSaid(files, ask);
  mark(r, 'file', s.ok, Date.now(), s.note);
  return s.ok ? chooseFile(files, ask) : null;
}
/** The address of a file whose id is TorBox's own. */
async function address(r: Relay, key: string, id: number, file: TorrentFile, refusedNote?: string): Promise<Found> {
  const link = await step(r, 'link', () => fileLink(r, key, id, file.id), linked, refusedNote);
  return { url: link.url, size: file.size, type: file.type ?? typeOfName(file.name) };
}
/** A torrent known with TorBox's ids, remembered, and its file's address. */
async function finish(r: Relay, key: string, hash: string, t: Known, ask: Ask, listed?: TorrentFile | null) {
  if (t.files.length) remember(hash, t);
  const file = listed === undefined ? choose(r, t.files, ask) : listed;
  return file ? address(r, key, t.id, file) : null;
}

/** A torrent just added, its files known only by their places in checkcached's list: requestdl for
 * that place beside the torrent's own listing, which confirms the id or names the real one. A
 * speculative ask the listing does not confirm is set aside at once (marked so, never waited for):
 * the real id is asked for straight away. */
async function confirm(r: Relay, key: string, hash: string, id: number, places: TorrentFile[], ask: Ask) {
  const guess = chooseFile(places, ask);
  const since = Date.now();
  const early = guess ? beside(fileLink(r, key, id, guess.id)) : null;
  const listed = await beside(listing(r, key, id, hash, ask, guess));
  const file = 'value' in listed ? listed.value.file : null;
  const confirmed = early !== null && file !== null && guess !== null && file.id === guess.id;
  if (early && !confirmed) mark(r, 'link', false, since, NOTE.setAside);
  if ('error' in listed) throw listed.error;
  if (listed.value.files.length) remember(hash, { id, files: listed.value.files });
  if (!file) return null;
  if (!confirmed || !early) return address(r, key, id, file);
  const link = await early;
  if ('error' in link) throw failed(r, 'link', since, link.error);
  mark(r, 'link', true, since, link.value.note);
  return { url: link.value.url, size: file.size, type: file.type ?? typeOfName(file.name) };
}

/** A press: what can be known without adding, asked together. Ready from memory only when this
 * press's own hints name a file there (a season pack shares one hash among its episodes). */
async function press(r: Relay, key: string, hash: string, ask: Ask) {
  const kept = recallReady(hash);
  if (kept && chooseFile(kept.files, ask)) {
    mark(r, 'cached', true, Date.now(), NOTE.rememberedReady);
    return READY;
  }
  const ownedSaid = (t: Known | null): Said => ({ ok: t !== null, note: t ? undefined : NOTE.notOwned });
  const [looked, held] = await Promise.all([
    beside(step(r, 'cached', () => checkCached(r, key, hash), cachedSaid)),
    beside(step(r, 'owned', () => findOwned(r, key, hash, L.list_page_ahead), ownedSaid)),
  ]);
  if ('error' in looked) throw looked.error;
  const cached = looked.value;
  if (!cached.cached) return NOT_CACHED;
  // A file that cannot be told apart now never will be.
  if (cached.files.length && !chooseFile(cached.files, ask)) {
    mark(r, 'file', false, Date.now(), NOTE.fileUnclear);
    return null;
  }
  const owned = settled(held);
  if (owned?.files.length) return finish(r, key, hash, owned, ask);
  if (owned) {
    const { files, file } = await listing(r, key, owned.id, hash, ask);
    return finish(r, key, hash, { id: owned.id, files }, ask, file);
  }
  if (!cached.files.length) return null;
  rememberReady(hash, { files: cached.files });
  return READY;
}

/** A tap: the add, checkcached beside it when no press left the file list, then the address. */
async function tap(r: Relay, key: string, hash: string, ask: Ask) {
  const ready = recallReady(hash);
  const look = ready ? null : beside(step(r, 'cached', () => checkCached(r, key, hash), cachedSaid));
  const addSaid = (a: Awaited<ReturnType<typeof addCached>>): Said => {
    if ('id' in a) return { ok: true, note: a.said ? SAID[a.said] : NOTE.saidNothing };
    return { ok: false, note: 'notCached' in a ? NOTE.notCachedNow : a.refused };
  };
  const tried = await beside(step(r, 'add', () => addCached(r, key, hash), addSaid));
  const looked = settled(look ? await look : null);
  const places = ready?.files ?? looked?.files ?? [];
  // No id from the add, and checkcached said for certain it is not cached: "not on TorBox yet",
  // whatever else stopped the add (never the list, never the add-on's link).
  const noId = 'error' in tried || !('id' in tried.value);
  if ((noId && looked?.cached === false) || ('value' in tried && 'notCached' in tried.value)) {
    forget(hash);
    return NOT_CACHED;
  }
  if ('error' in tried) throw tried.error;
  const added = tried.value;
  if ('notCached' in added) return NOT_CACHED;
  const listSaid = (o: Known | null): Said => ({ ok: o !== null, note: o ? NOTE.owned : NOTE.notListed });
  const t: Known | null =
    'id' in added
      ? { id: added.id, files: added.files }
      : await step(r, 'owned', () => findOwned(r, key, hash, L.list_page), listSaid);
  if (!t) return null;
  if (t.files.length) return finish(r, key, hash, t, ask);
  if (places.length) return confirm(r, key, hash, t.id, places, ask);
  const { files, file } = await listing(r, key, t.id, hash, ask);
  return finish(r, key, hash, { id: t.id, files }, ask, file);
}

/** The film's TorBox address; NOT_CACHED when TorBox said for certain it is not cached; READY when a
 * press found it ready but not in the account; null when the direct path could not finish for any
 * other reason (its steps say why). */
export async function direct(
  r: Relay,
  key: string | null,
  ask: Ask,
): Promise<Found | typeof NOT_CACHED | typeof READY | null> {
  const since = Date.now();
  if (!key) {
    mark(r, 'key', false, since, NOTE.noKey);
    return null;
  }
  mark(r, 'key', true, since);
  const hash = ask.hash;
  if (!hash) {
    mark(r, 'cached', false, since, NOTE.noHash);
    return null;
  }
  try {
    const known = recall(hash);
    if (known) {
      mark(r, 'owned', true, Date.now(), NOTE.remembered);
      try {
        const file = choose(r, known.files, ask);
        return file ? await address(r, key, known.id, file, NOTE.forgotten) : null;
      } catch (e) {
        if (!(e instanceof TorboxTrouble && e.refused)) throw e;
        // TorBox no longer knows that id: forget it and take the whole path once.
        forget(hash);
      }
    }
    return ask.mode === 'ahead' ? await press(r, key, hash, ask) : await tap(r, key, hash, ask);
  } catch (e) {
    // The page then plays the add-on's own link, so the direct path never fails the request.
    if (!(e && typeof e === 'object' && marked.has(e))) mark(r, 'file', false, Date.now(), NOTE.unreadable);
    return null;
  }
}
