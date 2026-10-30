// A chat file's name, type and bucket key going in, and its headers coming out (API.md §11.7,
// SECURITY.md §9). Pure functions: the route reads the request headers and calls these.
import { FILE_LIMITS } from '../../../../shared/contract/files.ts';
import { ApiError } from '../../http/errors';
import { uuidv7Time } from '../../lib/ids';

const bad = (path: string, issue: string) => new ApiError('validation', [{ path, issue }]);

/** `TH-File-Name`, URL-encoded by the sender, made safe to show and to put in a header: no
 * slashes (each becomes `_`), no control or format characters, no leading dots or spaces. */
export function safeName(header: string | undefined): string {
  if (!header) throw bad('TH-File-Name', 'required (URL-encoded)');
  let name: string;
  try {
    name = decodeURIComponent(header);
  } catch {
    throw bad('TH-File-Name', 'not URL-encoded');
  }
  name = name
    .normalize('NFC')
    .replace(/[/\\]/g, '_')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/^[.\s]+/u, '')
    .trim();
  if (!name) throw bad('TH-File-Name', 'empty once made safe');
  if ([...name].length > FILE_LIMITS.name) throw bad('TH-File-Name', `at most ${FILE_LIMITS.name} characters`);
  return name;
}

const ESSENCE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `Content-Type` as stored: its essence (`type/subtype`, lower case, parameters dropped), or
 * `application/octet-stream` when absent or malformed. A form body is refused (415): files go up
 * as their own bytes. */
export function mediaType(header: string | undefined): string {
  const essence = (header ?? '').split(';')[0].trim().toLowerCase();
  if (essence.startsWith('multipart/') || essence === 'application/x-www-form-urlencoded')
    throw new ApiError('unsupported_media_type');
  return ESSENCE.test(essence) ? essence : 'application/octet-stream';
}

/** `TH-Seconds`: a voice memo's length as the phone recorded it, audio only, 0 < s ≤ 600. */
export function memoSeconds(header: string | undefined, type: string): number | null {
  if (header === undefined) return null;
  const s = Number(header);
  if (!type.startsWith('audio/')) throw bad('TH-Seconds', 'only on audio');
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(header.trim()) || !(s > 0) || s > FILE_LIMITS.memo_seconds)
    throw bad('TH-Seconds', `seconds, more than 0 and at most ${FILE_LIMITS.memo_seconds}`);
  return s;
}

/** The extension a bucket key gets: from this fixed list, else `bin`. */
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};
export const extFor = (type: string) => EXT[type] ?? 'bin';

/** `chat/files/<YYYY>/<MM>/<id>.<ext>` (DATA.md §7.1), the month in UTC from the UUIDv7's own
 * time, so a retry of the same id always names the same key. */
export function fileKey(id: string, type: string): string {
  const d = new Date(uuidv7Time(id));
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `chat/files/${d.getUTCFullYear()}/${month}/${id}.${extFor(type)}`;
}

/** Shown in place (images, audio, video, PDFs) or saved; the name as RFC 6266 / 5987 give it:
 * an ASCII fallback, then the exact name in UTF-8. */
export function disposition(name: string, type: string): string {
  const inline = /^(image|audio|video)\//.test(type) || type === 'application/pdf';
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const exact = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

/** Whether `If-None-Match` names this strong ETag (or `*`). */
export function unchanged(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const tag = t.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

/** Every header a file's bytes (or its 304) carry, besides the length: private and immutable (the
 * id never names other bytes), never sniffed, and inert if opened on its own. */
export function servingHeaders(f: { name: string; type: string; sha256: string }): Record<string, string> {
  return {
    'Content-Type': f.type,
    ETag: `"${f.sha256}"`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Content-Disposition': disposition(f.name, f.type),
  };
}
