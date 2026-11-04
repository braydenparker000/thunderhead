// Invented listening-history exports for the taste suites (MUSIC.md §11.1): the three formats with
// made-up artists, albums and times, and a zip of them built with the runtime's CompressionStream.
// No real person's history: the artists are "Invented Artist n".
export const ARTIST = (i: number) => `Invented Artist ${i}`;
const iso = (y: number, i: number) => new Date(Date.UTC(y, i % 12, 1 + (i % 27), 12, i % 60)).toISOString();

/** Spotify's extended streaming history: `n` streams over `artists` artists and years 2019–2023;
 * every fifth is under 30 s, and every 50th is a podcast (no artist). */
export function spotifyRows(n: number, artists = 40, albums = 3) {
  return Array.from({ length: n }, (_, i) => ({
    ts: iso(2019 + (Math.floor(i / 7) % 5), i),
    platform: 'android',
    ms_played: i % 5 === 0 ? 12_000 : 180_000,
    conn_country: 'ZZ',
    master_metadata_track_name: i % 50 === 0 ? null : `Invented song ${i}`,
    master_metadata_album_artist_name: i % 50 === 0 ? null : ARTIST(i % artists),
    master_metadata_album_album_name: i % 50 === 0 ? null : `Invented album ${i % albums}`,
    spotify_track_uri: null,
    episode_name: i % 50 === 0 ? 'An invented episode' : null,
  }));
}

/** YouTube Music's takeout watch history: Music entries with an artist's "- Topic" channel, and a
 * plain YouTube entry, which is not music. */
export function youtubeRows(n: number, artists = 10) {
  return [
    ...Array.from({ length: n }, (_, i) => ({
      header: 'YouTube Music',
      title: `Watched Invented song ${i}`,
      titleUrl: 'https://music.youtube.com/watch?v=example',
      subtitles: [{ name: `${ARTIST(i % artists)} - Topic`, url: 'https://www.youtube.com/channel/example' }],
      time: iso(2022 + (i % 2), i),
      products: ['YouTube'],
    })),
    { header: 'YouTube', title: 'Watched an invented video', time: iso(2022, 1), products: ['YouTube'] },
  ];
}

/** Last.fm's scrobbles as the exporter's json pages, one now playing, which is not a scrobble yet. */
export function lastfmPages(n: number, artists = 10) {
  const track = Array.from({ length: n }, (_, i) => ({
    artist: { mbid: '', '#text': ARTIST(i % artists) },
    album: { mbid: '', '#text': `Invented album ${i % 2}` },
    name: `Invented song ${i}`,
    date: { uts: String(Date.UTC(2015 + (i % 3), 3, 1) / 1000), '#text': '01 Apr 2015, 00:00' },
  }));
  return [{ track: [{ ...track[0], '@attr': { nowplaying: 'true' }, date: undefined }, ...track] }];
}

export const lastfmCsv = (n: number, artists = 10) =>
  Array.from(
    { length: n },
    (_, i) =>
      `"${ARTIST(i % artists)}","Invented album, ${i % 2}",Invented song ${i},0${1 + (i % 9)} Feb 2018 10:0${i % 10}`,
  ).join('\n');

const enc = new TextEncoder();
async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** A zip of these entries, deflated (or stored); no CRC, which the reader doesn't check. */
export async function zip(entries: { name: string; text: string; store?: boolean }[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = enc.encode(e.text);
    const data = e.store ? raw : await deflate(raw);
    const name = enc.encode(e.name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(8, e.store ? 0 : 8, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(10, e.store ? 0 : 8, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    locals.push(new Uint8Array(head.buffer), name, data);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/** A fake MusicBrainz, ListenBrainz and Last.fm: each artist n gets an id, a few are unknown. */
export const mbidOf = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
export function fakeBrainz(calls: string[], unknown = new Set<number>()): typeof fetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://musicbrainz.org/')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('query') ?? '');
      const i = Number(/Invented Artist (\d+)/i.exec(q)?.[1] ?? -1);
      if (i < 0 || unknown.has(i)) return json({ artists: [] });
      return json({ artists: [{ id: mbidOf(i), name: ARTIST(i), score: 100 }] });
    }
    if (url.startsWith('https://labs.api.listenbrainz.org/'))
      return json([1, 2, 3].map((k) => ({ artist_mbid: mbidOf(k), name: ARTIST(k), score: 400 - k * 100 })));
    if (url.startsWith('https://ws.audioscrobbler.com/'))
      return json({ similarartists: { artist: [{ name: ARTIST(7), mbid: mbidOf(7), match: '0.9' }] } });
    return new Response('no', { status: 404 });
  };
}

/** Puts an export through PUT /v1/music/history, as the phone does. */
export async function putHistory(token: string, name: string, bytes: Uint8Array) {
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const { exports } = await import('cloudflare:workers');
  const r = await exports.default.fetch(
    new Request('https://api.example.test/v1/music/history', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '192.0.2.10',
        'TH-File-Name': encodeURIComponent(name),
        'TH-Sha256': sha,
      },
      body: bytes,
    }),
  );
  return { sha, status: r.status, body: (await r.json()) as Record<string, unknown> };
}
