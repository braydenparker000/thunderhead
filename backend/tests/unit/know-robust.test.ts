// The music knowledge's parsers and the job's planning against odd answers (MUSIC.md §19.2): no
// parser throws on any input; a bad or oversized answer is the row's, never the host's; a member is
// listed once however many instruments or periods MusicBrainz relates them by; the credits' cap keeps
// every person before anyone's second role; Retry-After is honoured, capped; a host refused is skipped,
// never blocking another host's source, and a row with nothing else to ask is parked. Invented names.
import { describe, expect, it } from 'vitest';
import { KNOW_LIMITS as K } from '../../../shared/contract/know.ts';
import { fmParse, lbParse, useFetch } from '../../src/areas/music/history-mb';
import { askFor, fetchAsk, MAX_BYTES, retryAfter } from '../../src/areas/music/know-fetch';
import { knowJob } from '../../src/areas/music/know-job';
import * as mb from '../../src/areas/music/know-parse-mb';
import * as web from '../../src/areas/music/know-parse-web';
import { nextAsk, refused, rowFailed } from '../../src/areas/music/know-plan';
import type { FactsRow } from '../../src/areas/music/know-store';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const keys = { lastfm: true, discogs: true };

const ODD: unknown[] = [
  null,
  undefined,
  0,
  -1,
  Number.NaN,
  '',
  '%',
  '%E0%A4%A',
  '\u0000‮',
  [],
  [null, 1, 'x', [[]]],
  {},
  { relations: [{ url: { resource: 'https://en.wikipedia.org/wiki/Bad%Link_%ZZ' } }, null, 5] },
  { 'release-groups': 'x', releases: [{ media: 'no' }, { id: id(1), media: [{ tracks: [null, { recording: 7 }] }] }] },
  { entities: { Q1: null, Q2: { claims: { P737: [null, { mainsnak: null }] }, labels: 5 } } },
  { query: { pages: { 1: { extract: 42 } }, search: 'x' } },
  { toptags: { tag: 'x' }, topalbums: { album: [null] }, album: null, similarartists: { artist: 3 } },
  { styles: [null, 3, { a: 1 }], extraartists: [{ name: {} }] },
  { media: [{ tracks: [{ recording: { relations: [null, { artist: 1 }, { type: 'performance', work: 'x' }] } }] }] },
  JSON.parse('{"__proto__": {"x": 1}, "constructor": 1}'),
];

describe('no parser throws, whatever comes back', () => {
  const parsers: [string, (j: unknown) => unknown][] = [
    ['disco', mb.parseDisco],
    ['releases', mb.parseReleases],
    ['artist', mb.parseArtist],
    ['group', mb.parseGroup],
    ['credits', mb.parseCredits],
    ['lbtop', mb.parseLbTop],
    ['wdItem', (j) => web.parseWdItem(j, 'Q2')],
    ['wdSearch', web.parseWdSearch],
    ['wdLabels', web.parseWdLabels],
    ['wiki', web.parseWiki],
    ['fmTags', web.parseFmTags],
    ['fmAlbum', web.parseFmAlbum],
    ['fmTop', web.parseFmTopAlbums],
    ['dcMaster', web.parseDcMaster],
    ['dcRelease', web.parseDcRelease],
    ['lbSimilar', (j) => lbParse(j, id(1))],
    ['fmSimilar', (j) => fmParse(j, id(1))],
  ];
  for (const [name, parse] of parsers)
    it(name, () => {
      for (const j of ODD) expect(() => parse(j), `${name}(${JSON.stringify(j)})`).not.toThrow();
    });
  it('a bare % in a Wikipedia link stays as it is', () => {
    expect(mb.parseUrls([{ url: { resource: 'https://en.wikipedia.org/wiki/Bad%Link' } }]).wiki).toBe('Bad%Link');
  });
});

describe('real shapes, invented names', () => {
  it('a member related once per instrument and period is listed once, before the cap', () => {
    const rel = (n: number, attr: string) => ({
      type: 'member of band',
      direction: 'backward',
      attributes: [attr],
      artist: { id: id(n), name: `Invented Member ${n}` },
    });
    const a = mb.parseArtist({
      relations: [1, 2, 3, 4, 5].flatMap((n) =>
        ['guitar', 'keys', 'original', 'vocals', 'bass', 'drums', 'piano'].map((x) => rel(n, x)),
      ),
    });
    expect(a.members.map((m) => m.name)).toEqual([1, 2, 3, 4, 5].map((n) => `Invented Member ${n}`));
  });

  it("the credits' cap keeps every person before anyone's second role, one entry a person and role", () => {
    const tracks = Array.from({ length: 12 }, (_, t) => ({
      title: `Song ${t}`,
      recording: {
        relations: [
          ...['piano', 'organ', 'synth', 'bells', 'harp', 'guitar'].map((x) => ({
            type: 'instrument',
            attributes: [x],
            artist: { id: id(1), name: 'Invented Player' },
          })),
          { type: 'engineer', artist: { id: id(100 + t), name: `Invented Engineer ${t}` } },
        ],
      },
    }));
    const c = mb.parseCredits({ media: [{ tracks }] });
    expect(c.credits.length).toBeLessThanOrEqual(K.credits);
    expect(new Set(c.credits.map((x) => x.mbid)).size).toBe(13);
    expect(new Set(c.credits.map((x) => `${x.mbid}|${x.role}`)).size).toBe(c.credits.length);
  });
});

describe('failures and their cost', () => {
  it('Retry-After in seconds or as a date, capped at six hours; nothing when unreadable', () => {
    expect(retryAfter('120', 0)).toBe(120_000);
    expect(retryAfter(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(retryAfter('999999', 0)).toBe(6 * 3_600_000);
    expect(retryAfter('soon', 0)).toBeUndefined();
    expect(retryAfter(null, 0)).toBeUndefined();
  });

  it('refusals back a host off 5, 20, 60 seconds (or its Retry-After), then leave it five minutes', () => {
    let h = refused(undefined, undefined, 0);
    expect(h.until).toBe(5_000);
    expect(refused(h, undefined, 0).until).toBe(20_000);
    expect(refused(refused(h, undefined, 0), undefined, 0).until).toBe(60_000);
    h = refused(h, 600_000, 0);
    expect(h.until).toBe(600_000);
    h = refused(refused(h, undefined, 0), undefined, 0);
    expect([h.fails, h.until]).toEqual([0, K.host_left_ms]);
  });

  it('a row tries a source three times a round, then gives it up', () => {
    let w = rowFailed({}, 'wp');
    expect(w.gaveUp).toBe(false);
    w = rowFailed(rowFailed(w.work, 'wp').work, 'wp');
    expect(w.gaveUp).toBe(true);
    expect(w.work.tries?.wp).toBeUndefined();
  });

  it('a source on a refused host is skipped, never blocking the next; with none left, the row is parked', () => {
    const row = {
      id: `g:${id(1)}`,
      name: 'x',
      todo: 'wds,wp,dcm',
      work_json: JSON.stringify({ wd: 'Q1', wiki: 'X', discogs: 'master/1' }),
    } as FactsRow;
    const hosts = { 'www.wikidata.org': { fails: 1, until: 5_000 } };
    const n = nextAsk(row, {}, hosts, keys, 0);
    expect('source' in n && n.source).toBe('wp');
    const all = {
      ...hosts,
      'en.wikipedia.org': { fails: 1, until: 3_000 },
      'api.discogs.com': { fails: 2, until: 9_000 },
    };
    expect(nextAsk(row, {}, all, keys, 0)).toEqual({ park: 3_000, drop: ['wds'] });
    // A keyed source with no key goes, whatever waits before it.
    expect(nextAsk(row, {}, all, { lastfm: false, discogs: false }, 0)).toEqual({ park: 3_000, drop: ['wds', 'dcm'] });
  });

  it('an answer over the size cap is nothing, not a failure (not asked again this round); a bad one is the row’s', async () => {
    const big = 'x'.repeat(MAX_BYTES + 10);
    useFetch(async () => new Response(`[${JSON.stringify(big)}]`));
    const ask = askFor('lbtop', { mbid: id(1), name: 'x' }, {}, keys);
    expect(await fetchAsk({} as Env, 'lbtop', ask as NonNullable<typeof ask>, 5000)).toEqual({ none: true });
    useFetch(async () => new Response('<html>no</html>'));
    expect(await fetchAsk({} as Env, 'lbtop', ask as NonNullable<typeof ask>, 10000)).toEqual({ error: 'row' });
    // Not allowed is the host's, for the longest rest: no row pays three requests for it.
    useFetch(async () => new Response('no', { status: 401 }));
    expect(await fetchAsk({} as Env, 'lbtop', ask as NonNullable<typeof ask>, 12000)).toEqual({
      error: 'host',
      retry: 6 * 3_600_000,
    });
    useFetch(async () => new Response('busy', { status: 429, headers: { 'Retry-After': '30' } }));
    expect(await fetchAsk({} as Env, 'lbtop', ask as NonNullable<typeof ask>, 15000)).toEqual({
      error: 'host',
      retry: 30_000,
    });
  });
});

describe('the job and a short wait', () => {
  it('waits out a back-off of up to stay_ms itself, and ends only for a longer one', () => {
    const never = new Proxy(
      {},
      {
        get: () => {
          throw new Error('a short wait writes nothing');
        },
      },
    ) as never;
    expect(knowJob.step(never, null, { n: 7 }, { know: 0, wait: 60_000, idle: true })).toEqual({
      next: { n: 7 },
      after: 60_000,
      rows: 0,
    });
    expect(knowJob.step(never, null, null, { know: 0, wait: K.stay_ms, idle: true })).toEqual({
      next: { n: 0 },
      after: K.stay_ms,
      rows: 0,
    });
    expect(() => knowJob.step(never, null, null, { know: 0, wait: K.stay_ms + 1, idle: true })).toThrow();
    expect(K.host_left_ms).toBeLessThanOrEqual(K.stay_ms);
  });
});
