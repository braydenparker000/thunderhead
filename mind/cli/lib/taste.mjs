// `th music taste [--limit 10]` and `th music similar <artist id> [--limit 20]` (RUNTIME.md §5.3,
// MUSIC.md §16.3): the owner's taste from their own listening history. taste prints their top artists
// and years by plays: counts, MusicBrainz ids and canonical names only (an artist MusicBrainz could
// not name is an opaque id with no name); similar prints ListenBrainz's artists like one, by its
// MusicBrainz id, each with the owner's plays of them and their songs in the catalog. Nothing here
// is the owner's free text or anyone else's, so neither taints the session.
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {invalid, out} from './io.mjs';

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const limitOf = (v, max, fallback) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw invalid(`--limit must be 1-${max}`);
  return n;
};

export async function taste(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th music taste [--limit 10]');
  const {data} = await request('GET', '/v1/music/taste', {query: {limit: limitOf(flags.limit, 50, 10)}});
  out(data);
}

export async function similar(argv) {
  const {flags, rest} = parseArgs(argv);
  const id = String(rest[0] ?? '');
  if (rest.length !== 1 || !MBID.test(id)) throw invalid('usage: th music similar <artist id (a MusicBrainz id from th music taste)> [--limit 20]');
  const limit = limitOf(flags.limit, 50, 20);
  const {data} = await request('GET', `/v1/music/similar/${id}`);
  out({...data, items: (data.items ?? []).slice(0, limit)});
}
