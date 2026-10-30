// Guitar's other sources (the old repo's backend/guitar-sources.js): GProTab search and Guitar Pro
// downloads (it came over with the port, owner decision 2026-10-28), and the guitar samples the
// player plays (FluidR3 GM, CC BY 3.0). Fixed hosts, checked paths, bounded bodies.
import { get, SourceError } from './upstream';

const GPROTAB = 'https://gprotab.net';
const SOUNDS = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
export const INSTRUMENTS = new Set([
  'acoustic_guitar_nylon',
  'acoustic_guitar_steel',
  'electric_guitar_clean',
  'electric_guitar_jazz',
  'electric_guitar_muted',
  'overdriven_guitar',
  'distortion_guitar',
  'guitar_harmonics',
]);
export const NOTE = /^(?:A|Bb|B|C|Db|D|Eb|E|F|Gb|G|Ab)[0-7]$/;
const TAB_PATH = /^[a-z0-9][a-z0-9-]{0,99}\/[a-z0-9][a-z0-9-]{0,159}$/;
const DAY = 86_400;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();

/** GProTab's search page lists each tab as a band link followed by a tab link. */
export function parseGprotabSearch(html: string) {
  const results: { path: string; artist: string; title: string }[] = [];
  const seen = new Set<string>();
  const pattern =
    /<a\s+href="\/en\/tabs\/([a-z0-9-]+)"\s+class="tab-band"\s*>([^<]{1,200})<\/a>\s*<a\s+href="\/en\/tabs\/([a-z0-9-]+\/[a-z0-9-]+)"\s+class="tab-name"\s*>([^<]{1,300})<\/a>/gi;
  for (const m of html.matchAll(pattern)) {
    const path = m[3].toLowerCase();
    if (!TAB_PATH.test(path) || !path.startsWith(`${m[1].toLowerCase()}/`) || seen.has(path)) continue;
    seen.add(path);
    results.push({ path, artist: decode(m[2]).slice(0, 200), title: decode(m[4]).slice(0, 300) });
    if (results.length >= 40) break;
  }
  return results;
}

export async function searchGprotab(query: string) {
  const q = query.trim();
  if (q.length < 2 || q.length > 120) throw new SourceError('Enter a song or artist (2–120 characters).', 400);
  const { bytes } = await get(`${GPROTAB}/en/search?type=0&q=${encodeURIComponent(q)}`, {
    limit: 1024 * 1024,
    accept: 'text/html',
  });
  return parseGprotabSearch(new TextDecoder().decode(bytes));
}

/** Guitar Pro 3–5 open with a "FICHIER GUITAR PRO" banner, GP6 (.gpx) with BCFZ/BCFS, GP7+ is a zip. */
export function guitarProFormat(b: Uint8Array): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 31 && ascii(1, 19) === 'FICHIER GUITAR PRO') return `gp${ascii(21, 22).match(/[345]/)?.[0] || '5'}`;
  if (b.length > 4 && ['BCFZ', 'BCFS'].includes(ascii(0, 4))) return 'gpx';
  if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) return 'gp';
  return '';
}

export async function gprotabFile(path: string) {
  const clean = path.replace(/^\/?en\/tabs\//, '').toLowerCase();
  if (!TAB_PATH.test(clean)) throw new SourceError('Invalid tab.', 400);
  const { bytes } = await get(`${GPROTAB}/en/tabs/${clean}?download`, {
    limit: 4 * 1024 * 1024,
    accept: 'application/octet-stream',
    ttl: DAY,
  });
  const format = guitarProFormat(bytes);
  if (!format) throw new SourceError('This tab is not a Guitar Pro file. Try another version.', 422);
  return { bytes, format };
}

export async function sound(instrument: string, note: string): Promise<Uint8Array> {
  if (!INSTRUMENTS.has(instrument) || !NOTE.test(note)) throw new SourceError('Not found', 404);
  const { bytes } = await get(`${SOUNDS}${instrument}-mp3/${note}.mp3`, {
    limit: 256 * 1024,
    accept: 'audio/mpeg',
    ttl: 30 * DAY,
  });
  const mp3 =
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!mp3) throw new SourceError('Invalid sample');
  return bytes;
}
