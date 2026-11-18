// The direct path (ASTRA.md §4.4, owner rulings 2026-11-18): with the owner's key and the torrent's
// hash, ask TorBox itself. Is it cached? A definite "no" (from checkcached, or from the add) is
// answered as such, so the caller never follows the add-on's link, which is how an add-on adds an
// uncached torrent: nothing uncached is ever added by Astra. Which file is it (stop before adding
// when it cannot be told apart)? Mode "play" then adds it with add_only_if_cached, which for an item
// already in the account answers its existing id, or, if TorBox refuses a second add, finds it in
// the list; mode "ahead" never adds and only looks at the newest items of the list. Then the file's
// own address, for the file server nearest the phone. At most four TorBox calls when nothing is
// retried: checkcached, createtorrent, the torrent's files, requestdl (or checkcached, the list,
// requestdl).
import { type AstraMode, type AstraStepName, ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { chooseFile, type Hints, type TorrentFile, typeOfName } from './files';
import { addCached, checkCached, fileLink, findOwned, TorboxTrouble, torrentFiles } from './torbox';
import { mark, type Relay } from './upstream';
import { NOTE } from './words';

export interface Found {
  url: string;
  size: number | null;
  type: string | null;
}

/** TorBox said for certain that it does not have the torrent ready. */
export const NOT_CACHED = { notCached: true } as const;

/** The film's TorBox address; NOT_CACHED when TorBox said for certain it is not cached; null when
 * the direct path could not finish for any other reason (its steps say why). */
export async function direct(
  r: Relay,
  key: string | null,
  ask: { hash: string | null; mode: AstraMode } & Hints,
): Promise<Found | typeof NOT_CACHED | null> {
  let at: AstraStepName = 'key';
  let since = Date.now();
  const begin = (step: AstraStepName) => {
    at = step;
    since = Date.now();
  };
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
    begin('cached');
    const cached = await checkCached(r, key, hash);
    if (!cached.cached) {
      mark(r, 'cached', false, since, NOTE.notCached);
      return NOT_CACHED;
    }
    mark(r, 'cached', true, since);
    // A file that cannot be told apart now never will be: nothing is added for it.
    if (cached.files.length && !chooseFile(cached.files, ask)) {
      mark(r, 'file', false, Date.now(), NOTE.fileUnclear);
      return null;
    }
    let torrent: { id: number; files: TorrentFile[] } | null;
    if (ask.mode === 'ahead') {
      begin('owned');
      torrent = await findOwned(r, key, hash, L.list_page_ahead);
      mark(r, 'owned', torrent !== null, since, torrent ? undefined : NOTE.notOwned);
      if (!torrent) return null;
    } else {
      begin('add');
      const added = await addCached(r, key, hash);
      if ('notCached' in added) {
        mark(r, 'add', false, since, NOTE.notCachedNow);
        return NOT_CACHED;
      }
      torrent = 'id' in added ? { id: added.id, files: [] } : await findOwned(r, key, hash, L.list_page);
      mark(r, 'add', torrent !== null, since, 'refused' in added ? (torrent ? NOTE.owned : added.refused) : undefined);
      if (!torrent) return null;
    }
    begin('file');
    const files = torrent.files.length ? torrent.files : await torrentFiles(r, key, torrent.id);
    const file = files.length ? chooseFile(files, ask) : null;
    if (!file) {
      mark(r, 'file', false, since, files.length ? NOTE.fileUnclear : NOTE.noFiles);
      return null;
    }
    mark(r, 'file', true, since);
    begin('link');
    const url = await fileLink(r, key, torrent.id, file.id);
    mark(r, 'link', true, since);
    return { url, size: file.size, type: file.type ?? typeOfName(file.name) };
  } catch (e) {
    // The follow path may still finish, so the direct path never fails the request.
    mark(r, at, false, since, e instanceof TorboxTrouble ? e.note : NOTE.unreadable);
    return null;
  }
}
