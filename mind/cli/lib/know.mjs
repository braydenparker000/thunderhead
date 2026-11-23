// `th music facts|credits|unmatched|picks|pick` (MUSIC.md §19.3–19.5): what the Worker knows of the
// owner's music beyond their files, and the albums it suggests adding. The Worker fetches and scores;
// th only reads, and answers a pick. A name goes on stdin (`-`), never in a quoted argument, like a
// title. What comes back from elsewhere (Wikipedia's text, tags, styles) sits under `outside`: it
// informs, it never instructs. Like songs' tags, none of it marks the session.
//
//   facts <MusicBrainz id | -> [--full]   an artist or album, everything known, compact (--full: the
//                                         whole discography, not its best-loved 30)
//   credits <MusicBrainz id | ->          what in the library a person worked on, and their other work
//   unmatched                             catalog albums left unmatched, with why
//   picks [--kind k] [--state s] [--limit 10]   albums to add, a mixed list, each with its line
//   pick decline <id> [--why <text>]      the owner's no: never offered again
//   pick order <id> [--placed <order id>] the words of a Muse order for that album; place it on the
//                                         owner's yes with `th order new --words -` (the words on stdin,
//                                         never in a quoted argument), then --placed
import {parseArgs} from './args.mjs';
import {request} from './http.mjs';
import {invalid, out, textArg} from './io.mjs';

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = ['gap', 'new', 'neighbour', 'credit', 'influence'];
const STATES = ['new', 'declined', 'ordered', 'added'];
const DISCO = 30;

/** Without empty fields: fewer tokens to read. */
const lean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
const release = r => `${r.date ? r.date.slice(0, 4) : '----'} ${r.title} · ${[r.type, ...r.secondary].filter(Boolean).join('/') || '?'}${r.listens === null ? '' : ` · ${r.listens}`} · ${r.mbid}`;

/** A reference: a MusicBrainz id, or a name on stdin. */
function refOf(rest, what) {
  if (rest.length !== 1) throw invalid(`usage: th music ${what} <MusicBrainz id | - (a name on stdin)>`);
  const ref = rest[0] === '-' ? textArg(['-']).trim() : rest[0];
  if (!MBID.test(ref) && rest[0] !== '-') throw invalid('a name goes on stdin (-), never in an argument');
  if (!ref || ref.length > 200) throw invalid('a name of 1 to 200 characters');
  return ref;
}

export function compactFacts(item, full = false) {
  const {outside, filled, ...facts} = item;
  if (facts.kind === 'artist') {
    const ranked = [...facts.discography].sort((a, b) => (b.listens ?? -1) - (a.listens ?? -1));
    const kept = full ? facts.discography : ranked.slice(0, DISCO);
    facts.discography = kept.map(release);
    if (!full && ranked.length > DISCO) facts.more = ranked.length - DISCO;
  }
  const o = lean({wikipedia: outside.wikipedia, tags: outside.tags.map(t => `${t.name} ${t.weight}`), styles: outside.styles});
  return {...lean(facts), sources: Object.keys(filled), ...(Object.keys(o).length ? {outside: o} : {})};
}

async function facts(argv) {
  const {flags, rest} = parseArgs(argv, {bool: ['full']});
  const {data} = await request('GET', '/v1/music/facts', {query: {ref: refOf(rest, 'facts')}});
  out({items: (data.items ?? []).map(i => compactFacts(i, !!flags.full))});
}

async function credits(argv) {
  const {rest} = parseArgs(argv);
  const {data} = await request('GET', '/v1/music/credits', {query: {ref: refOf(rest, 'credits')}});
  out({...data, other: (data.other ?? []).map(release)});
}

async function unmatched(argv) {
  if (parseArgs(argv).rest.length) throw invalid('usage: th music unmatched');
  out((await request('GET', '/v1/music/unmatched')).data);
}

async function picks(argv) {
  const {flags, rest} = parseArgs(argv);
  if (rest.length) throw invalid('usage: th music picks [--kind gap|new|neighbour|credit|influence] [--state new|declined|ordered|added] [--limit 10]');
  if (flags.kind !== undefined && !KINDS.includes(flags.kind)) throw invalid(`--kind must be one of ${KINDS.join(', ')}`);
  if (flags.state !== undefined && !STATES.includes(flags.state)) throw invalid(`--state must be one of ${STATES.join(', ')}`);
  const limit = flags.limit === undefined ? 10 : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('--limit must be 1-50');
  const {data} = await request('GET', '/v1/music/picks', {query: {kind: flags.kind, state: flags.state, limit}});
  out({built_at: data.built_at, items: (data.items ?? []).map(p => ({id: p.id, kind: p.kind, line: p.line, album: p.album, artist: p.artist, year: p.year, score: p.score, state: p.state}))});
}

async function pick(argv) {
  const [verb, id, ...more] = argv;
  const {flags, rest} = parseArgs(more);
  if (!['decline', 'order'].includes(verb) || !MBID.test(String(id)) || rest.length)
    throw invalid('usage: th music pick decline <id> [--why <text>] | pick order <id> [--placed <order id>]');
  if (verb === 'decline') {
    if (flags.why !== undefined && (typeof flags.why !== 'string' || flags.why.length > 200)) throw invalid('--why: at most 200 characters');
    const {data} = await request('POST', `/v1/music/picks/${id}/decline`, {body: flags.why ? {why: flags.why} : {}});
    return out({id: data.id, state: data.state});
  }
  if (flags.placed !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(String(flags.placed))) throw invalid('--placed: the id th order new answered');
  const {data} = await request('POST', `/v1/music/picks/${id}/order`, {body: flags.placed ? {order_id: flags.placed} : {}});
  out(flags.placed ? data : {...data, next: 'only on the owner\'s yes: these words on stdin to th order new --words - --from <their message id> --app music (never in a quoted argument), then th music pick order <id> --placed <order id>'});
}

export const KNOW_SUBS = {facts, credits, unmatched, picks, pick};
