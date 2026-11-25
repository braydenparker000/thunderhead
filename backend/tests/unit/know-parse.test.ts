// Each source's parser against invented answers (MUSIC.md §19.2): MusicBrainz, ListenBrainz,
// Wikidata, Wikipedia, Last.fm and Discogs. Outside text comes out collapsed and capped; ids must be
// ids; nothing is guessed. The requests carry ids and canonical names only, and a key never sits in a
// URL that is stored or answered. Invented artists, albums and articles only; no network.
import { describe, expect, it } from 'vitest';
import { KNOW_LIMITS as K } from '../../../shared/contract/know.ts';
import { useFetch } from '../../src/areas/music/history-mb';
import { apply } from '../../src/areas/music/know-apply';
import { askFor, fetchAsk } from '../../src/areas/music/know-fetch';
import * as mb from '../../src/areas/music/know-parse-mb';
import * as web from '../../src/areas/music/know-parse-web';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const keys = { lastfm: true, discogs: true, listenbrainz: true };

describe('MusicBrainz and ListenBrainz', () => {
  it('a discography page: groups with types and dates, the total, bad ids left out', () => {
    const d = mb.parseDisco({
      'release-group-count': 140,
      'release-groups': [
        {
          id: id(1),
          title: '  Paper\n Lanterns ',
          'primary-type': 'Album',
          'secondary-types': [],
          'first-release-date': '2001-05-01',
        },
        {
          id: id(2),
          title: 'Live at the Pier',
          'primary-type': 'Album',
          'secondary-types': ['Live'],
          'first-release-date': '2003',
        },
        { id: 'not-an-id', title: 'Bad' },
      ],
    });
    expect(d.total).toBe(140);
    expect(d.items).toEqual([
      { mbid: id(1), title: 'Paper Lanterns', type: 'Album', secondary: [], date: '2001-05-01', listens: null },
      { mbid: id(2), title: 'Live at the Pier', type: 'Album', secondary: ['Live'], date: '2003', listens: null },
    ]);
  });

  it('an artist: type, origin, years, members either way, and its links', () => {
    const a = mb.parseArtist({
      name: 'Invented Band',
      type: 'Group',
      'begin-area': { name: 'Invented Town' },
      'life-span': { begin: '1990', end: '2010-06', ended: true },
      relations: [
        { type: 'member of band', direction: 'backward', artist: { id: id(10), name: 'Invented Singer' } },
        { type: 'member of band', direction: 'forward', artist: { id: id(11), name: 'Invented Supergroup' } },
        { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
        { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Invented_Band' } },
        { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/42-Invented-Band' } },
      ],
    });
    expect(a).toMatchObject({
      name: 'Invented Band',
      origin: 'Invented Town',
      begin: '1990',
      end: '2010-06',
      members: [{ mbid: id(10), name: 'Invented Singer' }],
      member_of: [{ mbid: id(11), name: 'Invented Supergroup' }],
      wd: 'Q123',
      wiki: 'Invented Band',
      discogs: 'artist/42',
    });
  });

  it("a release's tracks and label, and its credits, covers and samples", () => {
    const [r] = mb.parseReleases({
      releases: [
        {
          id: id(20),
          date: '2001-05-01',
          'label-info': [{ label: { name: 'Invented Label' } }],
          media: [{ tracks: [{ position: 1, title: 'First Light', recording: { id: id(21) } }] }],
        },
      ],
    });
    expect(r).toEqual({
      id: id(20),
      date: '2001-05-01',
      label: 'Invented Label',
      tracks: [{ position: 1, title: 'First Light', recording: id(21) }],
    });
    const c = mb.parseCredits({
      relations: [{ type: 'producer', artist: { id: id(30), name: 'Invented Producer' } }],
      media: [
        {
          tracks: [
            {
              title: 'First Light',
              recording: {
                relations: [
                  { type: 'instrument', attributes: ['bass guitar'], artist: { id: id(31), name: 'Invented Bassist' } },
                  {
                    type: 'performance',
                    attributes: ['cover'],
                    work: {
                      title: 'An Older Song',
                      relations: [{ type: 'composer', artist: { id: id(32), name: 'Invented Composer' } }],
                    },
                  },
                  {
                    type: 'samples material',
                    direction: 'forward',
                    recording: { title: 'A Loop', 'artist-credit': [{ name: 'Invented DJ' }] },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(c.credits.map((x) => [x.name, x.role])).toEqual([
      ['Invented Producer', 'producer'],
      ['Invented Bassist', 'bass guitar'],
      ['Invented Composer', 'composer'],
    ]);
    expect(c.covers).toEqual([{ song: 'First Light', of: 'An Older Song' }]);
    expect(c.samples).toEqual([{ song: 'First Light', of: 'A Loop (Invented DJ)' }]);
  });

  it("ListenBrainz's listens by release group", () => {
    expect(
      mb.parseLbTop([
        { release_group_mbid: id(1), total_listen_count: 900.4 },
        { release_group_mbid: 'x', total_listen_count: 5 },
      ]),
    ).toEqual({
      [id(1)]: 900,
    });
  });
});

describe('Wikidata, Wikipedia, Last.fm, Discogs', () => {
  const snak = (v: unknown) => ({ mainsnak: { datavalue: { value: v } } });
  it('an item: influences, awards, origin, years and its article; labels with MusicBrainz ids', () => {
    const item = web.parseWdItem(
      {
        entities: {
          Q123: {
            claims: {
              P737: [snak({ id: 'Q7' })],
              P166: [snak({ id: 'Q8' }), snak({ id: 'Q8' })],
              P740: [snak({ id: 'Q9' })],
              P571: [snak({ time: '+1990-00-00T00:00:00Z' })],
            },
            sitelinks: { enwiki: { title: 'Invented Band' } },
          },
        },
      },
      'Q123',
    );
    expect(item).toEqual({
      influenced_by: ['Q7'],
      awards: ['Q8'],
      origin: 'Q9',
      begin: '1990',
      end: null,
      wiki: 'Invented Band',
    });
    expect(web.parseWdSearch({ query: { search: [{ title: 'Q5' }, { title: 'Property:P1' }] } })).toEqual(['Q5']);
    expect(
      web.parseWdLabels({
        entities: {
          Q7: { labels: { en: { value: 'Invented Elder' } }, claims: { P434: [snak(id(7))] } },
          Q8: { labels: { en: { value: 'An Invented Prize' } } },
        },
      }),
    ).toEqual({ Q7: { name: 'Invented Elder', mbid: id(7) }, Q8: { name: 'An Invented Prize', mbid: null } });
  });

  it('an article: the lead and the reception section, collapsed and capped', () => {
    const long = 'word '.repeat(1000);
    const w = web.parseWiki({
      query: {
        pages: {
          1: {
            title: 'Paper Lanterns',
            extract: `Paper Lanterns is an invented album.\n\n${long}\n\n\n== Background ==\nNot this.\n\n\n== Critical reception ==\nInvented critics   liked it.\n\n\n== Track listing ==\nNo.`,
          },
        },
      },
    });
    expect(w?.lead.length).toBeLessThanOrEqual(K.wiki_lead);
    expect(w?.lead.startsWith('Paper Lanterns is an invented album. word word')).toBe(true);
    expect(w?.reception).toBe('Invented critics liked it.');
    expect(web.parseWiki({ query: { pages: { '-1': { title: 'Nothing', missing: '' } } } })).toBeNull();
  });

  it("Last.fm's tags, album and top albums; Discogs's styles and credits", () => {
    const tags = web.parseFmTags({
      toptags: {
        tag: [
          { name: 'Dream Pop', count: 100 },
          { name: ' x'.repeat(50), count: 3 },
        ],
      },
    });
    expect(tags[0]).toEqual({ name: 'dream pop', weight: 100 });
    expect(tags[1].name.length).toBeLessThanOrEqual(K.tag_chars);
    expect(
      web.parseFmAlbum({ album: { listeners: '1200', playcount: '9000', tags: { tag: [{ name: 'shoegaze' }] } } }),
    ).toEqual({
      listeners: 1200,
      playcount: 9000,
      tags: [{ name: 'shoegaze', weight: 0 }],
    });
    expect(web.parseFmTopAlbums({ topalbums: { album: [{ name: 'Paper Lanterns', playcount: 50 }] } })).toEqual([
      { name: 'Paper Lanterns', playcount: 50 },
    ]);
    expect(web.parseDcMaster({ styles: ['Shoegaze'], genres: ['Rock'], main_release: 77 })).toEqual({
      styles: ['Shoegaze', 'Rock'],
      main: 77,
    });
    expect(web.parseDcRelease({ extraartists: [{ name: 'Invented Engineer', role: 'Mixed By' }] })).toEqual([
      { mbid: null, name: 'Invented Engineer', role: 'Mixed By' },
    ]);
  });

  it('a discography over pages, then listens from ListenBrainz and Last.fm', () => {
    const page = (n: number) => ({
      items: [{ mbid: id(n), title: `Album ${n}`, type: 'Album', secondary: [], date: null, listens: null }],
      total: 150,
    });
    let a = apply('disco', 'artist', {}, {}, {}, page(1));
    expect([a.again, a.work.page]).toEqual([true, 100]);
    a = apply('disco', 'artist', a.facts, a.outside, a.work, page(2));
    expect([a.again, a.work.page, a.facts.discography?.length]).toEqual([false, 0, 2]);
    expect(apply('disco', 'lite', {}, {}, {}, page(1)).again).toBe(false);
    a = apply('lbtop', 'artist', a.facts, a.outside, a.work, { [id(1)]: 500 });
    a = apply('fmtop', 'artist', a.facts, a.outside, a.work, [{ name: 'Album 2 (Deluxe Edition)', playcount: 70 }]);
    expect(a.facts.discography?.map((r) => r.listens)).toEqual([500, 70]);
  });
});

describe('the requests', () => {
  it('carry ids and canonical names only; no key in a URL; nothing asked without what it needs', () => {
    const row = { mbid: id(1), name: 'Paper Lanterns', artist: 'Invented Band' };
    expect(askFor('disco', row, { page: 100 }, keys)?.url).toBe(
      `https://musicbrainz.org/ws/2/release-group?artist=${id(1)}&limit=100&offset=100&fmt=json`,
    );
    // Last.fm's album: by the release's id; else by MusicBrainz's own names (`named`); never before.
    expect(askFor('fmalb', row, {}, keys)).toBeNull();
    expect(askFor('fmalb', { ...row, title: 'Paper Lanterns' }, {}, keys)).toBeNull();
    expect(askFor('fmalb', row, { release: id(9) }, keys)?.url).toContain(`method=album.getinfo&mbid=${id(9)}`);
    const fm = askFor('fmalb', { ...row, title: 'Paper Lanterns' }, { named: true }, keys);
    expect(fm?.url).toContain('artist=Invented%20Band&album=Paper%20Lanterns');
    expect(fm?.url).not.toContain('api_key');
    const none = { lastfm: false, discogs: false, listenbrainz: false };
    expect(askFor('fmtags', row, {}, none)).toBeNull();
    expect(askFor('dcm', row, { discogs: 'master/5' }, none)).toBeNull();
    expect(askFor('lbtop', row, {}, none)).toBeNull();
    // ListenBrainz's labs host is asked without its token.
    expect(askFor('lbsim', row, {}, none)?.auth).toBeUndefined();
    expect(askFor('wd', row, {}, keys)).toBeNull();
    expect(askFor('wp', row, { wiki: 'Invented Band' }, keys)?.host).toBe('en.wikipedia.org');
  });

  it('go through the host gates, add the key at the call, and say only whose fault a failure is', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    useFetch(async (input, init) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
      if (String(input).includes('discogs')) return new Response('{"styles":["Shoegaze"]}');
      return new Response('nope', { status: 503 });
    });
    const env = { LASTFM_API_KEY: 'invented-key', DISCOGS_TOKEN: 'invented-token' } as unknown as Env;
    const ask = askFor('fmtags', { mbid: id(1), name: 'x' }, {}, keys);
    const got = await fetchAsk(env, 'fmtags', ask as NonNullable<typeof ask>, 10_000);
    expect(got).toEqual({ error: 'host', retry: undefined });
    expect(JSON.stringify(got)).not.toContain('invented-key');
    expect(seen[0].url).toContain('api_key=invented-key');
    expect(await fetchAsk(env, 'fmtags', ask as NonNullable<typeof ask>, 10_500)).toBe('wait');
    const dc = askFor('dcm', { mbid: id(1), name: 'x' }, { discogs: 'master/5' }, keys);
    expect(await fetchAsk(env, 'dcm', dc as NonNullable<typeof dc>, 10_600)).toEqual({
      ok: { styles: ['Shoegaze'], main: null },
    });
    expect(seen[1]).toEqual({ url: 'https://api.discogs.com/masters/5', auth: 'Discogs token=invented-token' });
    // Without the token Discogs is never asked, even if a request were made.
    expect(
      await fetchAsk({ DISCOGS_TOKEN: 'none' } as unknown as Env, 'dcm', dc as NonNullable<typeof dc>, 20_000),
    ).toEqual({ none: true });
    expect(seen).toHaveLength(2);
  });
});
