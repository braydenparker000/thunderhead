// A pick's preview (MUSIC.md §19.7), the pure parts: the search address sent to Apple's iTunes Search
// API (a pick's artist and album as MusicBrainz names them, nothing of the owner), the one result
// whose artist and album are the pick's, and the allow-list a preview address must pass before the
// Worker fetches it. Apple's answer is outside data: read here for one address and never kept.
import { fold, norm } from './know-match';

export const PREVIEW = {
  /** The one host asked, and its gap per isolate (one lookup a second). */
  host: 'itunes.apple.com',
  gap_ms: 1_000,
  /** The largest clip passed through (a 30-second preview is well under 1 MB). */
  max_bytes: 3 * 1024 * 1024,
  /** Pick ids remembered per isolate, with their preview address or a miss. */
  remembered: 200,
} as const;

/** The search for one album's songs: artist and album, the words alone. */
export function searchUrl(artist: string, album: string): string {
  const term = `${artist} ${album}`.replace(/\s+/g, ' ').trim();
  return `https://${PREVIEW.host}/search?media=music&entity=song&limit=25&term=${encodeURIComponent(term)}`;
}

/** A preview address the Worker may fetch: https on Apple's hosts only, no port or credentials. */
export function allowedPreview(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2_000) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  return h.endsWith('.apple.com') || h.endsWith('.mzstatic.com') ? u.href : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The preview address of the pick's album in Apple's answer: the artist the same after folding, the
 * album the same or the start of Apple's name (" - EP", " - Single" after it), the same album before
 * a longer one and the lowest track number first. Null when no result matches. */
export function matchPreview(answer: unknown, artist: string, album: string): string | null {
  const results = (answer as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  const a = norm(artist);
  const t = fold(album);
  if (!a || !t) return null;
  let best: { rank: number; track: number; url: string } | null = null;
  for (const r of results as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || norm(str(r.artistName)) !== a) continue;
    const c = fold(str(r.collectionName));
    const rank = c === t ? 0 : c.startsWith(`${t} `) ? 1 : -1;
    if (rank < 0) continue;
    const url = allowedPreview(r.previewUrl);
    if (!url) continue;
    const track = typeof r.trackNumber === 'number' && r.trackNumber > 0 ? r.trackNumber : Number.MAX_SAFE_INTEGER;
    if (!best || rank < best.rank || (rank === best.rank && track < best.track)) best = { rank, track, url };
  }
  return best?.url ?? null;
}
