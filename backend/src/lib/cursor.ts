// Opaque pagination cursors (API.md §8): base64url JSON naming the route they belong to, so a
// cursor from another route is refused with 400 bad_request.
import { ApiError } from '../http/errors';

export function encodeCursor(route: string, key: unknown[]): string {
  return btoa(JSON.stringify({ r: route, k: key }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCursor(route: string, cursor: string | undefined): unknown[] | null {
  if (!cursor) return null;
  try {
    const json = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))) as { r?: unknown; k?: unknown };
    if (json.r === route && Array.isArray(json.k)) return json.k;
  } catch {
    // fall through
  }
  throw new ApiError('bad_request');
}
