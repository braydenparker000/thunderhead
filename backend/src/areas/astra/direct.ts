// The direct path (ASTRA.md §4.4, owner rulings 2026-11-18): with the owner's key and the torrent's
// hash, ask TorBox itself. A tap ("play") goes straight to createtorrent with add_only_if_cached:
// TorBox refusing it as not cached is the definite "not on TorBox yet", answered as such, since
// following the add-on's link is how an add-on adds an uncached torrent; an item already in the
// account answers its existing id (or, if TorBox refuses a second add, is found in the list). Then
// its files and the file's own address: three calls. A press ("ahead") never adds: checkcached, then
// the newest items of the account's list, then the address. A torrent found is remembered in memory
// (kept.ts), so the next ask for it costs requestdl alone. A file that cannot be told apart is never
// guessed: no address (an already cached item left in the account is harmless and uses no slot).
import { type AstraMode, type AstraStepName, ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { chooseFile, type Hints, typeOfName } from './files';
import { forget, type Known, recall, remember } from './kept';
import { fileLink } from './links';
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
const SAID = { existing: NOTE.saidExisting, new: NOTE.saidNew } as const;

/** The step under way and when it began, so trouble marks the right one. */
function stepper(r: Relay) {
  const s = { at: 'key' as AstraStepName, since: Date.now() };
  return Object.assign(s, {
    begin(step: AstraStepName) {
      s.at = step;
      s.since = Date.now();
    },
    fail(e: unknown) {
      mark(r, s.at, false, s.since, e instanceof TorboxTrouble ? e.note : NOTE.unreadable);
    },
  });
}

/** The file of a known torrent, and its address. */
async function finish(r: Relay, key: string, t: Known, ask: Ask, s: ReturnType<typeof stepper>) {
  s.begin('file');
  const file = t.files.length ? chooseFile(t.files, ask) : null;
  if (!file) {
    mark(r, 'file', false, s.since, t.files.length ? NOTE.fileUnclear : NOTE.noFiles);
    return null;
  }
  mark(r, 'file', true, s.since);
  s.begin('link');
  const link = await fileLink(r, key, t.id, file.id);
  mark(r, 'link', true, s.since, link.note);
  return { url: link.url, size: file.size, type: file.type ?? typeOfName(file.name) };
}

/** The film's TorBox address; NOT_CACHED when TorBox said for certain it is not cached; null when
 * the direct path could not finish for any other reason (its steps say why). */
export async function direct(r: Relay, key: string | null, ask: Ask): Promise<Found | typeof NOT_CACHED | null> {
  const s = stepper(r);
  if (!key) {
    mark(r, 'key', false, s.since, NOTE.noKey);
    return null;
  }
  mark(r, 'key', true, s.since);
  const hash = ask.hash;
  if (!hash) {
    mark(r, 'cached', false, s.since, NOTE.noHash);
    return null;
  }
  const known = recall(hash);
  if (known) {
    mark(r, 'owned', true, s.since, NOTE.remembered);
    try {
      return await finish(r, key, known, ask, s);
    } catch (e) {
      if (!(e instanceof TorboxTrouble && e.refused)) {
        s.fail(e);
        return null;
      }
      // TorBox no longer knows that id: forget it and take the whole path once.
      forget(hash);
      mark(r, s.at, false, s.since, NOTE.forgotten);
    }
  }
  try {
    let t: Known | null;
    if (ask.mode === 'ahead') {
      s.begin('cached');
      const cached = await checkCached(r, key, hash);
      mark(r, 'cached', cached.cached, s.since, cached.cached ? undefined : NOTE.notCached);
      if (!cached.cached) return NOT_CACHED;
      // A file that cannot be told apart now never will be: the list is not read for it.
      if (cached.files.length && !chooseFile(cached.files, ask)) {
        mark(r, 'file', false, Date.now(), NOTE.fileUnclear);
        return null;
      }
      s.begin('owned');
      t = await findOwned(r, key, hash, L.list_page_ahead);
      mark(r, 'owned', t !== null, s.since, t ? undefined : NOTE.notOwned);
    } else {
      s.begin('add');
      const added = await addCached(r, key, hash);
      if ('notCached' in added) {
        mark(r, 'add', false, s.since, NOTE.notCachedNow);
        return NOT_CACHED;
      }
      t = 'id' in added ? { id: added.id, files: [] } : await findOwned(r, key, hash, L.list_page);
      const note = 'id' in added ? (added.said ? SAID[added.said] : NOTE.saidNothing) : t ? NOTE.owned : added.refused;
      mark(r, 'add', t !== null, s.since, note);
    }
    if (!t) return null;
    if (!t.files.length) {
      s.begin('file');
      t = { id: t.id, files: await torrentFiles(r, key, t.id) };
    }
    if (t.files.length) remember(hash, t);
    return await finish(r, key, t, ask, s);
  } catch (e) {
    // The page then plays the add-on's own link, so the direct path never fails the request.
    s.fail(e);
    return null;
  }
}
