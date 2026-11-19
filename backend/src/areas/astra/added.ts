// A torrent just added (ASTRA.md §4.4; the owner's phone, 2026-11-19: the listing by the add's id
// answered 404 at once). Its files are known only by their places in checkcached's list, or not at
// all: requestdl for the file's place runs beside the torrent's own listing, which confirms the id or
// names the real one. When the listing does not know the torrent yet (a refusal such as a 404, no
// files, or an answer about another torrent), the direct path goes on, each its own step, stopping at
// the first that gives a file TorBox's own id: (a) the listing once more after a short wait (TorBox
// catching up); (b) the account's list, fresh, searched by the hash, which does not depend on the
// add's id; (c) else no address. The speculative requestdl is used only when a list confirms both
// the torrent's id and the file's; otherwise it is set aside. A hash search that finds the torrent
// under the very id whose listing named another torrent is a contradiction: nothing is used.
import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { chooseFile, type TorrentFile, typeOfName } from './files';
import { type Known, remember } from './kept';
import { fileLink } from './links';
import { address, type Ask, beside, choose, type Found, failed, listing, type Said, step } from './steps';
import { findOwned, TorboxTrouble } from './torbox';
import { mark, type Relay, timesNow, wait } from './upstream';
import { NOTE } from './words';

type Tried = { value: Awaited<ReturnType<typeof listing>> } | { error: unknown };
const aboutOther = (t: Tried) => 'error' in t && t.error instanceof TorboxTrouble && t.error.note === NOTE.otherTorrent;
/** Whether a listing just after an add says only that TorBox does not list the torrent yet. */
const notYet = (t: Tried) =>
  'error' in t ? (t.error instanceof TorboxTrouble && t.error.refused) || aboutOther(t) : t.value.files.length === 0;

/** What the search by hash says: found (under the add's id or another), contradicted, or not found. */
export const foundSaid =
  (addedId: number | null, other = false) =>
  (o: Known | null): Said => {
    if (!o) return { ok: false, note: NOTE.notFoundByHash };
    if (o.id === addedId && other) return { ok: false, note: NOTE.contradicted };
    return { ok: true, note: addedId !== null && o.id !== addedId ? NOTE.foundOtherId : NOTE.foundByHash };
  };

/** The file's address for a torrent the add named `id`. `again` false: the listing alone (an id
 * taken from the account's list already, so neither the retry nor the search would add anything). */
export async function afterAdd(
  r: Relay,
  key: string,
  hash: string,
  id: number,
  places: TorrentFile[],
  ask: Ask,
  again = true,
): Promise<Found | null> {
  const guess = places.length ? chooseFile(places, ask) : null;
  const since = Date.now();
  const early = guess ? beside(fileLink(r, key, id, guess.id)) : null;
  let pending = early !== null;
  const setAside = () => {
    if (pending) mark(r, 'link', false, since, NOTE.setAside);
    pending = false;
  };
  /** The speculative ask when a list confirmed its torrent and its file; else the file asked for now. */
  const use = async (tid: number, file: TorrentFile): Promise<Found> => {
    if (!early || !guess || tid !== id || file.id !== guess.id) {
      setAside();
      return address(r, key, tid, file);
    }
    pending = false;
    const link = await early;
    if ('error' in link) throw failed(r, 'link', since, link.error);
    mark(r, 'link', true, since, link.value.note);
    return { url: link.value.url, size: file.size, type: file.type ?? typeOfName(file.name) };
  };

  let tried: Tried = await beside(listing(r, key, id, hash, ask, guess));
  let other = aboutOther(tried);
  const t = timesNow();
  // (a) TorBox catching up: once more after a short wait, when the request has time for it.
  if (again && notYet(tried) && r.deadline - Date.now() > t.again_ms + 1000) {
    await wait(t.again_ms);
    tried = await beside(listing(r, key, id, hash, ask, guess, NOTE.listedAgain));
    other ||= aboutOther(tried);
  }
  if (!again || !notYet(tried)) {
    if ('error' in tried) {
      setAside();
      throw tried.error;
    }
    const { files, file } = tried.value;
    if (files.length) remember(hash, { id, files });
    if (!file) {
      setAside();
      return null;
    }
    return use(id, file);
  }
  // (b) The account's list, fresh, by the hash; its id is the one used and remembered.
  const found = await step(r, 'owned', () => findOwned(r, key, hash, L.list_page, true), foundSaid(id, other)).catch(
    (e: unknown) => {
      setAside();
      throw e;
    },
  );
  if (!found || (found.id === id && other)) {
    setAside();
    return null;
  }
  if (found.files.length) remember(hash, found);
  const file = choose(r, found.files, ask);
  if (!file) {
    setAside();
    return null;
  }
  return use(found.id, file);
}
