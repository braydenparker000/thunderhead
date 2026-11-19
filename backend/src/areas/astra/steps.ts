// The direct path's steps (direct.ts, added.ts): each TorBox call is a step with its own time, its
// trouble marked once on its own step; and the pieces every path ends with: the file a list names,
// the torrent's own listing, the file's address, a torrent remembered.
import type { AstraMode, AstraStepName } from '../../../../shared/contract/astra.ts';
import { chooseFile, type Hints, type TorrentFile, typeOfName } from './files';
import { type Known, remember } from './kept';
import { type FileAddress, fileLink } from './links';
import { TorboxTrouble, torrentFiles } from './torbox';
import { mark, type Relay } from './upstream';
import { NOTE } from './words';

export interface Found {
  url: string;
  size: number | null;
  type: string | null;
}
export type Ask = { hash: string | null; mode: AstraMode } & Hints;
export type Said = { ok: boolean; note?: string };

/** Trouble already marked on its own step. */
export const marked = new WeakSet<object>();
/** A step's note, led by `lead` (a fixed sentence saying what kind of try it was) when given. */
const led = (lead: string | undefined, note: string | undefined) => (lead ? (note ? `${lead} ${note}` : lead) : note);

/** One TorBox call as `name`, marked with its own time when it ends. Trouble marks it failed (as
 * `refusedNote` when TorBox refused it, if given) and goes on up. */
export async function step<T>(
  r: Relay,
  name: AstraStepName,
  work: () => Promise<T>,
  said: (v: T) => Said,
  refusedNote?: string,
  lead?: string,
) {
  const since = Date.now();
  try {
    const value = await work();
    const s = said(value);
    mark(r, name, s.ok, since, led(lead, s.note));
    return value;
  } catch (e) {
    throw failed(r, name, since, e, refusedNote, lead);
  }
}
/** Marks a step that ended in trouble, once; the trouble goes on up. */
export function failed(
  r: Relay,
  name: AstraStepName,
  since: number,
  e: unknown,
  refusedNote?: string,
  lead?: string,
): unknown {
  const refused = e instanceof TorboxTrouble && e.refused && refusedNote;
  const note = refused ? refusedNote : e instanceof TorboxTrouble ? e.note : NOTE.unreadable;
  mark(r, name, false, since, led(lead, note));
  if (e && typeof e === 'object') marked.add(e);
  return e;
}
/** A call started beside another: its trouble is read where it is awaited, never left unhandled. */
export const beside = <T>(p: Promise<T>): Promise<{ value: T } | { error: unknown }> =>
  p.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
export const settled = <T>(o: { value: T } | { error: unknown } | null): T | null =>
  o && 'value' in o ? o.value : null;
export const linked = (link: FileAddress): Said => ({ ok: true, note: link.note });

/** What the file step says of a list: the file the hints name, else why none can be told apart. */
export function fileSaid(files: TorrentFile[], ask: Ask, guess: TorrentFile | null = null): Said {
  const file = files.length ? chooseFile(files, ask) : null;
  if (!file) return { ok: false, note: files.length ? NOTE.fileUnclear : NOTE.noFiles };
  return { ok: true, note: guess && file.id !== guess.id ? NOTE.otherId : undefined };
}
/** The torrent's own listing, fresh, as the file step with its own time, and the file it names. */
export async function listing(
  r: Relay,
  key: string,
  id: number,
  hash: string,
  ask: Ask,
  guess: TorrentFile | null = null,
  lead?: string,
) {
  const files = await step(
    r,
    'file',
    () => torrentFiles(r, key, id, hash),
    (f) => fileSaid(f, ask, guess),
    undefined,
    lead,
  );
  return { files, file: files.length ? chooseFile(files, ask) : null };
}
/** The file named in a list already in hand (memory, the account's list, createtorrent's answer). */
export function choose(r: Relay, files: TorrentFile[], ask: Ask): TorrentFile | null {
  const s = fileSaid(files, ask);
  mark(r, 'file', s.ok, Date.now(), s.note);
  return s.ok ? chooseFile(files, ask) : null;
}
/** The address of a file whose id is TorBox's own. */
export async function address(
  r: Relay,
  key: string,
  id: number,
  file: TorrentFile,
  refusedNote?: string,
): Promise<Found> {
  const link = await step(r, 'link', () => fileLink(r, key, id, file.id), linked, refusedNote);
  return { url: link.url, size: file.size, type: file.type ?? typeOfName(file.name) };
}
/** A torrent known with TorBox's ids, remembered, and its file's address. */
export async function finish(r: Relay, key: string, hash: string, t: Known, ask: Ask, listed?: TorrentFile | null) {
  if (t.files.length) remember(hash, t);
  const file = listed === undefined ? choose(r, t.files, ask) : listed;
  return file ? address(r, key, t.id, file) : null;
}
