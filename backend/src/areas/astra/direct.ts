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
// when it lists files with their ids, needs no listing at all; added.ts: a listing that does not know
// the new torrent yet is asked again, then the account's list by the hash). A torrent found in the account is
// remembered, so the next ask costs requestdl alone. Every call is a step with its own time; calls
// made together overlap. A file that cannot be told apart is never guessed: no address (an already
// cached item left in the account is harmless and uses no slot).
import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { afterAdd, foundSaid } from './added';
import { chooseFile } from './files';
import { forget, type Known, recall, recallReady, rememberReady } from './kept';
import {
  type Ask,
  address,
  beside,
  choose,
  type Found,
  finish,
  listing,
  marked,
  type Said,
  settled,
  step,
} from './steps';
import { addCached, checkCached, findOwned, TorboxTrouble } from './torbox';
import { mark, type Relay } from './upstream';
import { NOTE } from './words';

export type { Found } from './steps';

/** TorBox said for certain that it does not have the torrent ready. */
export const NOT_CACHED = { notCached: true } as const;
/** A press found the torrent ready on TorBox and told its file apart, but the account does not hold
 * it: no address before a tap, and the tap needs only createtorrent and requestdl. */
export const READY = { ready: true } as const;
const SAID = { existing: NOTE.saidExisting, new: NOTE.saidNew } as const;
const cachedSaid = (c: { cached: boolean }): Said => ({ ok: c.cached, note: c.cached ? undefined : NOTE.notCached });

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

/** A tap: the add, checkcached beside it when no press left the file list, then the address
 * (added.ts: the listing that confirms the file's id, asked again and searched for by the hash
 * when TorBox does not list the new torrent yet). */
async function tap(r: Relay, key: string, hash: string, ask: Ask) {
  const ready = recallReady(hash);
  const look = ready ? null : beside(step(r, 'cached', () => checkCached(r, key, hash), cachedSaid));
  const addSaid = (a: Awaited<ReturnType<typeof addCached>>): Said => {
    if ('id' in a) return { ok: true, note: a.said ? SAID[a.said] : NOTE.saidNothing };
    if ('noId' in a) return { ok: true, note: a.queued ? NOTE.addQueued : NOTE.addNoId };
    return { ok: false, note: 'notCached' in a ? NOTE.notCachedNow : a.refused };
  };
  const tried = await beside(step(r, 'add', () => addCached(r, key, hash), addSaid));
  const looked = settled(look ? await look : null);
  const places = ready?.files ?? looked?.files ?? [];
  // The add failed or was refused, and checkcached said for certain it is not cached: "not on
  // TorBox yet", whatever else stopped the add (never the list, never the add-on's link).
  const failedAdd = 'error' in tried || 'refused' in tried.value;
  if ((failedAdd && looked?.cached === false) || ('value' in tried && 'notCached' in tried.value)) {
    forget(hash);
    return NOT_CACHED;
  }
  if ('error' in tried) throw tried.error;
  const added = tried.value;
  if ('notCached' in added) return NOT_CACHED;
  if ('id' in added) {
    if (added.files.length) return finish(r, key, hash, { id: added.id, files: added.files }, ask);
    return afterAdd(r, key, hash, added.id, places, ask);
  }
  // No torrent id from the add (refused again, or an answer naming none): the account's list by the hash.
  const listSaid = (o: Known | null): Said => ({ ok: o !== null, note: o ? NOTE.owned : NOTE.notListed });
  const said = 'noId' in added ? foundSaid(null) : listSaid;
  const t = await step(r, 'owned', () => findOwned(r, key, hash, L.list_page, true), said);
  if (!t) return null;
  if (t.files.length) return finish(r, key, hash, t, ask);
  return afterAdd(r, key, hash, t.id, places, ask, false);
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
