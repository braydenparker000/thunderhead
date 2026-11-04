// The three listening-history exports (MUSIC.md §16.1), read into plays and summed by artist, album
// and the year of the play: Spotify's extended streaming history (`Streaming_History_Audio_*.json`,
// and the older account-data `StreamingHistory*.json`), YouTube Music's takeout watch history
// (`watch-history.json`, only the entries headed "YouTube Music") and a Last.fm export (its scrobbles
// as json pages or as csv). Track titles are read past and never kept: a play keeps its artist, album,
// year and milliseconds only. A row that names no artist or no time is counted as skipped.
import { TASTE_LIMITS as L, type TasteSource } from '../../../../shared/contract/taste.ts';

export interface Play {
  artist: string;
  album: string;
  year: number;
  ms: number;
  /** 1 when it counts as a play (Spotify: 30 s or more), 0 when only its minutes count. */
  play: 0 | 1;
}
/** One summary row: `k` the artist's key, `n` its name as first spelled, `a` album, `y` year, `p`
 * plays, `m` minutes (one decimal). */
export interface SummaryRow {
  k: string;
  n: string;
  a: string;
  y: number;
  p: number;
  m: number;
}
export interface Parsed {
  source: TasteSource;
  plays: Play[];
  skipped: number;
}

type O = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
const text = (v: unknown): string => (v && typeof v === 'object' ? str((v as O)['#text'] ?? (v as O).name) : str(v));

/** An artist's key: the same artist however a file spelled its case, spaces or "- Topic" channel. */
export const keyOf = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+-\s+topic$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The UTC year of a time (an ISO string, `YYYY-MM-DD hh:mm`, `31 Jan 2020, 12:34`, or seconds since
 * 1970), or 0 when it is none. */
export function yearOf(v: unknown): number {
  const ms =
    typeof v === 'number' || /^\d{9,11}$/.test(String(v ?? ''))
      ? Number(v) * 1000
      : Date.parse(
          String(v ?? '')
            .replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/, '$1T$2Z')
            .replace(',', ''),
        );
  const y = Number.isFinite(ms) ? new Date(ms).getUTCFullYear() : 0;
  return y >= 2000 && y <= 2100 ? y : 0;
}

function spotify(rows: O[]): Omit<Parsed, 'source'> {
  const plays: Play[] = [];
  let skipped = 0;
  for (const r of rows) {
    const artist = str(r.master_metadata_album_artist_name ?? r.artistName);
    const ms = Number(r.ms_played ?? r.msPlayed);
    const year = yearOf(r.ts ?? r.endTime);
    if (!artist || !year || !Number.isFinite(ms) || ms < 0) {
      skipped++;
      continue;
    }
    plays.push({ artist, album: str(r.master_metadata_album_album_name), year, ms, play: ms >= L.play_ms ? 1 : 0 });
  }
  return { plays, skipped };
}

function youtube(rows: O[]): Omit<Parsed, 'source'> {
  const plays: Play[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.header !== 'YouTube Music') continue;
    const sub = Array.isArray(r.subtitles) ? (r.subtitles[0] as O | undefined) : undefined;
    const artist = str(sub?.name).replace(/\s+-\s+Topic$/, '');
    const year = yearOf(r.time);
    if (!artist || !year) skipped++;
    else plays.push({ artist, album: '', year, ms: 0, play: 1 });
  }
  return { plays, skipped };
}

function lastfmRows(rows: O[]): Omit<Parsed, 'source'> {
  const plays: Play[] = [];
  let skipped = 0;
  for (const r of rows) {
    if ((r['@attr'] as O | undefined)?.nowplaying) continue;
    const artist = text(r.artist);
    const d = r.date as O | string | number | undefined;
    const year = yearOf(d && typeof d === 'object' ? (d.uts ?? d['#text']) : (d ?? r.uts ?? r.timestamp));
    if (!artist || !year) skipped++;
    else plays.push({ artist, album: text(r.album), year, ms: 0, play: 1 });
  }
  return { plays, skipped };
}

/** One csv line's cells (quotes as RFC 4180 has them). */
export function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Last.fm's csv: with a header naming `artist` (and `album`, `uts` or `date`), or without one in
 * the common `artist,album,track,date` order. */
function lastfmCsv(body: string): Omit<Parsed, 'source'> {
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.length ? cells(lines[0]).map((c) => c.trim().toLowerCase()) : [];
  const named = head.includes('artist');
  const at = (n: string, d: number) => (named ? head.indexOf(n) : d);
  const [ai, bi, ui, di] = [
    at('artist', 0),
    at('album', 1),
    at('uts', -1),
    named ? Math.max(head.indexOf('date'), head.indexOf('utc_time')) : 3,
  ];
  const rows = (named ? lines.slice(1) : lines).map((l) => {
    const c = cells(l);
    return { artist: c[ai], album: c[bi], date: ui >= 0 && c[ui] ? c[ui] : c[di] } as O;
  });
  return lastfmRows(rows);
}

const pagesOf = (j: unknown): O[] | null => {
  if (Array.isArray(j) && j.every((p) => p && typeof p === 'object' && Array.isArray((p as O).track)))
    return j.flatMap((p) => (p as { track: O[] }).track);
  const rt = (j as { recenttracks?: { track?: unknown } } | null)?.recenttracks?.track;
  return Array.isArray(rt) ? (rt as O[]) : null;
};

/** Which export a file is, by its name and then its first row; null when it is none of the three. */
export function sourceOf(name: string, j: unknown): TasteSource | null {
  if (/\.csv$/i.test(name)) return 'lastfm';
  if (/streaming_?history/i.test(name)) return 'spotify';
  if (/watch-history/i.test(name)) return 'youtube';
  if (pagesOf(j)) return 'lastfm';
  const first = Array.isArray(j) ? (j[0] as O | undefined) : undefined;
  if (!first || typeof first !== 'object') return null;
  if ('ms_played' in first || 'msPlayed' in first) return 'spotify';
  if ('header' in first && 'time' in first) return 'youtube';
  if ('artist' in first && ('date' in first || 'uts' in first || 'timestamp' in first)) return 'lastfm';
  return null;
}

/** One file of an export, read; null when it is not one of the three. */
export function parseExport(name: string, body: string): Parsed | null {
  if (/\.csv$/i.test(name)) return { source: 'lastfm', ...lastfmCsv(body) };
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch {
    return null;
  }
  const source = sourceOf(name, j);
  if (!source) return null;
  if (source === 'lastfm') return { source, ...lastfmRows(pagesOf(j) ?? (Array.isArray(j) ? (j as O[]) : [])) };
  if (!Array.isArray(j)) return null;
  return { source, ...(source === 'spotify' ? spotify(j as O[]) : youtube(j as O[])) };
}

/** Plays summed by artist key, album and year, in key order (so a file's parts are the same on every run). */
export function summarise(plays: Play[]): SummaryRow[] {
  const by = new Map<string, SummaryRow>();
  for (const p of plays) {
    const k = keyOf(p.artist);
    if (!k) continue;
    const id = `${k}\u0000${p.album.toLowerCase()}\u0000${p.year}`;
    const row = by.get(id) ?? { k, n: p.artist, a: p.album, y: p.year, p: 0, m: 0 };
    row.p += p.play;
    row.m += p.ms / 60_000;
    by.set(id, row);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, r]) => ({ ...r, m: Math.round(r.m * 10) / 10 }));
}
