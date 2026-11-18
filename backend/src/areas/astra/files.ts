// Which file of a torrent the owner tapped (ASTRA.md §4.4: Astra never picks between streams, and
// the Worker never guesses between files). The rules, in order: the add-on's index when it names a
// file and agrees with the name and size the page gave; else the one file of that name (narrowed by
// size when several share it); else the one file of that size; else the torrent's one video, sample
// files and small files set aside. Two candidates left is a refusal. An add-on may count files
// differently from TorBox's ids, so the name and size win over the index when they disagree.
import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';

export interface TorrentFile {
  /** TorBox's file id (a position in checkcached's list, which has no ids). */
  id: number;
  /** The path inside the torrent. */
  name: string;
  size: number | null;
  type: string | null;
}

export interface Hints {
  fileIndex: number | null;
  fileName: string | null;
  fileSize: number | null;
}

const VIDEO = /\.(mkv|mp4|m4v|webm|avi|mov|ts|m2ts|mts|wmv|flv|mpe?g|ogv|3gp|divx)$/i;
const SAMPLE = /(^|[\\/._\s-])sample([\\/._\s-]|$)/i;
const TYPES: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
};
/** A media type as `type/subtype`, nothing else of the header. */
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]{1,40}\/[a-z0-9!#$&^_.+-]{1,60}$/;

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The type a file's extension implies, or null. */
export function typeOfName(path: string): string | null {
  return TYPES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''] ?? null;
}

/** A Content-Type or a TorBox mimetype reduced to `type/subtype`, or null when it is not one. */
export function mediaType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.split(';')[0].trim().toLowerCase();
  return MEDIA_TYPE.test(t) ? t : null;
}

export const isVideo = (path: string, type: string | null) => Boolean(type?.startsWith('video/')) || VIDEO.test(path);

const only = <T>(list: T[]): T | null => (list.length === 1 ? list[0] : null);

/** The file the hints name, or null when it cannot be told apart (never a guess between two). */
export function chooseFile(files: TorrentFile[], h: Hints): TorrentFile | null {
  const named = (f: TorrentFile) => h.fileName !== null && baseName(f.name) === baseName(h.fileName);
  const sized = (f: TorrentFile) => h.fileSize !== null && f.size === h.fileSize;
  if (h.fileIndex !== null) {
    const at = files.find((f) => f.id === h.fileIndex);
    if (at && (h.fileName === null || named(at)) && (h.fileSize === null || sized(at))) return at;
  }
  const byName = files.filter(named);
  const pick = only(byName) ?? (byName.length > 1 ? only(byName.filter(sized)) : null) ?? only(files.filter(sized));
  if (pick) return pick;
  return only(
    files.filter(
      (f) => VIDEO.test(f.name) && !SAMPLE.test(f.name) && (f.size === null || f.size >= L.small_file_bytes),
    ),
  );
}
