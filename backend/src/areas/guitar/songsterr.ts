// Songsterr, as the old Worker served it to the ported Guitar app (the old repo's backend/songsterr.js;
// page and revision extraction adapted from songsterr-downloader, MIT, notice in
// frontend/guitar/licenses/). Owner ruling 2026-10-28: the owner has Songsterr's written permission
// for this project. Search, a song's tracks, and the chosen tracks' revisions, each checked.
import { get, SourceError } from './upstream';

const SITE = 'https://www.songsterr.com';
const CDNS = ['https://dqsljvtekg760.cloudfront.net', 'https://d3d3l6a6rcgkaf.cloudfront.net'];
const LIMIT = 6 * 1024 * 1024;
const WORDS = {
  unreachable: "Couldn't reach Songsterr. Please try again.",
  unavailable: 'Songsterr is unavailable. Please try again.',
  notFound: 'This Songsterr version is unavailable. Try another result.',
  tooLarge: 'This tab is too large. Try a shorter Songsterr version.',
  slow: 'Songsterr took too long. Please try again.',
};
type Obj = Record<string, unknown>;
const validId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
export const songUrl = (id: number) => `${SITE}/a/wsa/song-tab-s${id}`;

export function trackKind(t: Obj): string {
  const i = t.instrumentId as number;
  if (t.isDrums || i === 1024) return 'drums';
  if (t.isBassGuitar || (i >= 32 && i <= 39)) return 'bass';
  if (t.isGuitar || (i >= 24 && i <= 31)) return 'guitar';
  return 'other';
}
const track = (t: Obj) => ({
  partId: t.partId,
  instrumentId: t.instrumentId,
  name: String(t.name || t.title || t.instrument || 'Track').slice(0, 200),
  instrument: String(t.instrument || '').slice(0, 120),
  kind: trackKind(t),
  tuning: t.tuning,
  isDrums: !!t.isDrums,
});
const text = async (url: string) =>
  new TextDecoder().decode(
    (await get(url, { limit: LIMIT, accept: 'application/json,text/html', words: WORDS })).bytes,
  );
function parseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new SourceError('Songsterr returned invalid data. Try another version.');
  }
}

export async function searchSongs(query: string) {
  const q = query.trim();
  if (q.length < 2 || q.length > 160) throw new SourceError('Enter a song or artist (2–160 characters).', 400);
  const result = parseJSON(await text(`${SITE}/api/songs?pattern=${encodeURIComponent(q)}&size=30`));
  if (!Array.isArray(result)) throw new SourceError('Songsterr returned invalid search results.');
  const seen = new Set<number>();
  return (result as Obj[])
    .filter(
      (s) => validId(s.songId) && typeof s.title === 'string' && typeof s.artist === 'string' && s.hasPlayer !== false,
    )
    .filter((s) => {
      if (seen.has(s.songId as number)) return false;
      seen.add(s.songId as number);
      return true;
    })
    .slice(0, 30)
    .map((s) => ({
      songId: s.songId,
      url: songUrl(s.songId as number),
      title: (s.title as string).slice(0, 300),
      artist: (s.artist as string).slice(0, 200),
      tracks: Array.isArray(s.tracks) ? (s.tracks as Obj[]).slice(0, 128).map(track) : [],
    }));
}

export interface Meta {
  songId: number;
  revisionId: number;
  image: string;
  title: string;
  artist: string;
  tracks: ReturnType<typeof track>[];
}

export function parseMeta(html: string, songId: number): Meta {
  const state = html.match(/<script\b[^>]*\bid\s*=\s*["']state["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!state) throw new SourceError('Songsterr returned an invalid song page. Try another version.');
  const m = (parseJSON(state[1]) as { meta?: { current?: Obj } })?.meta?.current;
  const unavailable = () => new SourceError('This Songsterr version is unavailable. Try another result.', 404);
  if (
    !m ||
    m.songId !== songId ||
    !validId(m.revisionId) ||
    !/^[\w-]{1,160}$/.test(String(m.image)) ||
    !Array.isArray(m.tracks) ||
    !m.tracks.length ||
    m.tracks.length > 128
  )
    throw unavailable();
  if (m.isRestricted || m.isBlocked || m.isPublished === false) throw unavailable();
  const tracks = (m.tracks as Obj[])
    .filter((t) => Number.isSafeInteger(t.partId) && (t.partId as number) >= 0 && Number.isInteger(t.instrumentId))
    .map(track);
  if (!tracks.length) throw new SourceError('No usable tracks in this Songsterr version.');
  return {
    songId,
    revisionId: m.revisionId as number,
    image: m.image as string,
    title: String(m.title || 'Song').slice(0, 300),
    artist: String(m.artist || 'Unknown Artist').slice(0, 200),
    tracks,
  };
}

export async function getSong(songId: number): Promise<Meta> {
  if (!validId(songId)) throw new SourceError('Invalid song.', 400);
  return parseMeta(await text(songUrl(songId)), songId);
}

export function validateRevision(r: Obj, meta: Meta, partId: number): Obj {
  const bad = () => new SourceError("Couldn't generate this tab. Try another Songsterr version.");
  const measures = r?.measures as Obj[] | undefined;
  if (
    !r ||
    !Array.isArray(measures) ||
    !measures.length ||
    measures.length > 2000 ||
    (r.songId != null && r.songId !== meta.songId) ||
    (r.revisionId != null && r.revisionId !== meta.revisionId) ||
    (r.partId != null && r.partId !== partId)
  )
    throw bad();
  const ok = measures.every((m) => {
    const voices = m?.voices as Obj[] | undefined;
    return (
      Array.isArray(voices) &&
      voices.length <= 8 &&
      voices.every((v) => {
        const beats = v?.beats as Obj[] | undefined;
        return (
          v &&
          (v.rest || Array.isArray(beats)) &&
          (!beats ||
            (beats.length <= 512 &&
              beats.every((b) => b && (!b.notes || (Array.isArray(b.notes) && b.notes.length <= 64)))))
        );
      })
    );
  });
  if (!ok) throw bad();
  return r;
}

/** The chosen tracks' revisions, three at a time, never a partial selection. */
export async function getRevisions(meta: Meta, selected: Meta['tracks']) {
  const revisions: { trackMeta: Meta['tracks'][number]; revision: Obj }[] = [];
  let total = 0;
  for (let start = 0; start < selected.length; start += 3) {
    const group = await Promise.all(
      selected.slice(start, start + 3).map(async (t) => {
        let raw = '';
        for (let i = 0; i < CDNS.length; i++) {
          try {
            raw = await text(`${CDNS[i]}/${meta.songId}/${meta.revisionId}/${meta.image}/${t.partId}.json`);
            break;
          } catch (e) {
            if ((e as SourceError).status !== 404 || i === CDNS.length - 1) throw e;
          }
        }
        total += raw.length;
        if (total > 12 * 1024 * 1024) throw new SourceError('This tab is too large. Choose fewer tracks.', 413);
        return { trackMeta: t, revision: validateRevision(parseJSON(raw) as Obj, meta, t.partId as number) };
      }),
    );
    revisions.push(...group);
  }
  return revisions;
}
