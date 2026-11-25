// The music knowledge's routes (know.ts, MUSIC.md §19), kept beside routes.ts, which spreads them into
// ROUTES: no import here, so the registry stays importable on its own. Every read is by key.
export const KNOW_ROUTES = {
  'GET /v1/music/know': { who: ['D', 'C', 'N', 'I'], phase: 'P5', note: 'how far the matching and the facts are, what each source filled, picks made, declined and added: counts only' },
  'GET /v1/music/facts': { who: ['C', 'N'], phase: 'P5', note: '?ref=<MusicBrainz id or name>: an artist or album, everything known, compact; free text from elsewhere under outside' },
  'GET /v1/music/credits': { who: ['C', 'N'], phase: 'P5', note: '?ref=<MusicBrainz id or name>: what in the library a person worked on, and their other work' },
  'GET /v1/music/unmatched': { who: ['D', 'C', 'N'], phase: 'P5', note: 'catalog albums left unmatched, with why, ≤ 200' },
  'GET /v1/music/picks': { who: ['D', 'C', 'N'], phase: 'P5', note: '?kind=&state=&limit=1-50: albums to add, scored over stored facts and the owner\'s listening; a mixed list' },
  'GET /v1/music/picks/:id/preview': { who: ['D'], phase: 'P5', note: 'a 30-second clip of the album from Apple\'s iTunes search, passed through (audio, ≤ 3 MB); 404 for none, 429 under a second after the last lookup' },
  'POST /v1/music/picks/:id/decline': { who: ['D', 'C'], phase: 'P5', note: '{why? ≤ 200}: never offered again; its artist weighs less' },
  'POST /v1/music/picks/:id/order': { who: ['D', 'C'], phase: 'P5', note: '{order_id?}: without, the words of a Muse order for that album; with the order th order new placed, the pick is ordered' },
} as const;
