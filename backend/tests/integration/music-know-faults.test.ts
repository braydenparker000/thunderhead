// The music knowledge when things go wrong (MUSIC.md §19.2): a discography that answers garbage costs
// its own row three tries and nothing else (MusicBrainz is not backed off), its albums wait unmatched
// rather than being judged against nothing, and are matched once the discography is read whole; a
// host that refuses with Retry-After is left alone that long while the other hosts' work goes on; a
// restore (the facts are not backed up) ends with the facts fetched again and the picks rebuilt.
// Every outside service is a fake (know-helpers.ts); invented music only.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type FactsResponse,
  KNOW_LIMITS as K,
  type KnowStatus,
  type PicksResponse,
} from '../../../shared/contract/know.ts';
import { SOURCES } from '../../src/areas/music/know-fetch';
import { keysArrived } from '../../src/areas/music/know-state';
import type { Db } from '../../src/objects/base';
import { apiJson } from '../helpers';
import { mbidOf } from '../history-helpers';
import { fakeWorld, gid, inMusic, musicSql, runJob, seedKnow, tick, world } from '../know-helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

const wd = world();
let p: Principals;
const chat = () => as(p.C, CHAT_SESSION);
const hosts = async () =>
  JSON.parse(
    (await musicSql<{ value_json: string }>("SELECT value_json FROM music_state WHERE key = 'know.hosts'"))[0]
      ?.value_json ?? '{}',
  );
const albums = () =>
  musicSql<{ album: string; state: string; reason: string | null }>(
    'SELECT album, state, reason FROM know_albums ORDER BY album',
  );

beforeAll(async () => {
  p = await principals();
  await seedKnow();
});

describe('a bad answer is its row’s alone', () => {
  it('a discography that is not JSON: three tries, then its albums wait unmatched; MusicBrainz goes on', async () => {
    wd.discoBroken = true;
    await tick();
    await runJob(fakeWorld(wd));
    const disco = wd.calls.filter((u) => u.includes(`release-group?artist=${mbidOf(0)}`));
    expect(disco).toHaveLength(3);
    expect((await hosts())['musicbrainz.org']?.refused_at).toBeUndefined();
    const a = await albums();
    expect(a.find((x) => x.album === 'Night Orchard')).toMatchObject({ state: 'unmatched', reason: 'lookup_failed' });
    expect(a.find((x) => x.album.startsWith('Paper'))).toMatchObject({ state: 'unmatched', reason: 'lookup_failed' });
    // Other rows were worked: Muse's album and its artist.
    expect(a.find((x) => x.album === 'glass harbour [mine]')?.state).toBe('matched');
  });

  it('once the discography is read whole (the weekly refresh), those albums are matched', async () => {
    wd.discoBroken = false;
    // A week on: the daily pass and the weekly top refresh are due, and the discography's round is old.
    await musicSql(
      "UPDATE music_state SET value_json = json_set(value_json, '$.refreshed', 0, '$.top_at', 0) WHERE key = 'know.state'",
    );
    await musicSql("UPDATE know_facts SET work_json = json_set(work_json, '$.disco_at', 0) WHERE kind = 'artist'");
    await tick(Date.now() + 2 * 3_600_000);
    await runJob(fakeWorld(wd));
    const a = await albums();
    expect(a.find((x) => x.album.startsWith('Paper'))?.state).toBe('matched');
    expect(a.find((x) => x.album === 'Night Orchard')?.reason).toBe('several_release_groups');
  });
});

describe('a host that refuses', () => {
  it('is left alone for its Retry-After, asked once, while the other hosts’ work goes on', async () => {
    wd.status.set('en.wikipedia.org', 429);
    wd.retryAfter = '600';
    await musicSql(
      "UPDATE know_facts SET busy = 1, todo = 'wp,fmtags,wdr' WHERE id IN (?, ?)",
      `a:${mbidOf(0)}`,
      `g:${gid(101)}`,
    );
    const before = wd.calls.length;
    const at = Date.now();
    await tick(at + 4 * 3_600_000);
    await runJob(fakeWorld(wd));
    const asked = wd.calls.slice(before);
    expect(asked.filter((u) => u.includes('wikipedia')).length).toBe(1);
    expect(asked.some((u) => u.includes('wikidata'))).toBe(true);
    const wiki = (await hosts())['en.wikipedia.org'];
    expect(wiki.until).toBeGreaterThanOrEqual(at + 600_000);
    expect(wiki.until).toBeLessThan(at + 700_000);
    const s = (await apiJson<KnowStatus>('GET', '/v1/music/know', { token: p.D })).body;
    expect(s.hosts.wikipedia.refused_at).toBeGreaterThan(0);
    expect(s.hosts.wikipedia.until).toBe(wiki.until);
    // Its rows are parked, their list kept, until it may be asked.
    const [row] = await musicSql<{ busy: number; todo: string; due_at: number }>(
      'SELECT busy, todo, due_at FROM know_facts WHERE id = ?',
      `g:${gid(101)}`,
    );
    expect(row).toEqual({ busy: 0, todo: 'wp', due_at: wiki.until });
    wd.status.clear();
  });
});

describe('a restore', () => {
  it('brings back matches and answers without the facts: they are fetched again, and the picks rebuilt', async () => {
    await musicSql('DELETE FROM know_facts');
    await musicSql('DELETE FROM know_names');
    await musicSql('DELETE FROM know_credits');
    await musicSql("DELETE FROM picks WHERE state = 'new'");
    await musicSql("UPDATE music_state SET value_json = '{}' WHERE key = 'know.hosts'");
    await tick(Date.now() + 8 * 3_600_000);
    await runJob(fakeWorld(wd));
    const f = (await apiJson<FactsResponse>('GET', `/v1/music/facts?ref=${mbidOf(0)}`, chat())).body;
    expect(f.items[0]).toMatchObject({ kind: 'artist', type: 'Group' });
    const picks = (await apiJson<PicksResponse>('GET', '/v1/music/picks', chat())).body;
    expect(picks.items.map((i) => i.album)).toContain('The Loved One');
  });
});

describe('MusicBrainz refusing a lookup', () => {
  it('costs the artist no try, backs the host off in seconds, and a failed lookup is tried again later', async () => {
    const key = (await musicSql<{ artist_key: string }>('SELECT artist_key FROM know_albums LIMIT 1'))[0]
      ?.artist_key as string;
    const tries = async () =>
      (await musicSql<{ tries: number }>('SELECT max(tries) AS tries FROM know_albums WHERE artist_key = ?', key))[0]
        ?.tries;
    const before = await tries();
    const now = Date.now();
    for (let i = 0; i < 5; i++) await inMusic((o) => o.knowLookup(key, 'refused', now));
    expect(await tries()).toBe(before);
    const h = (await hosts())['musicbrainz.org'];
    expect(h.until - now).toBeLessThanOrEqual(K.host_left_ms);
    expect(K.host_left_ms).toBeLessThanOrEqual(300_000);
    // An answer that could not be read is the artist's: it costs a try.
    await inMusic((o) => o.knowLookup(key, 'error', now));
    expect(await tries()).toBe((before ?? 0) + 1);
    // A lookup that failed long ago comes due again; a fresh failure waits.
    await musicSql(
      "UPDATE know_albums SET state = 'unmatched', reason = 'lookup_failed', tries = 99, artist_mbid = NULL, hint = NULL, at = ? WHERE artist_key = ?",
      now,
      key,
    );
    await inMusic((o) => o.knowNext(now + 60_000));
    expect((await albums()).filter((a) => a.reason === 'lookup_failed').length).toBeGreaterThan(0);
    await inMusic((o) => o.knowNext(now + K.relook_ms + 60_000));
    expect((await albums()).filter((a) => a.reason === 'lookup_failed')).toHaveLength(0);
  });
});

describe('a key the owner adds later', () => {
  it('puts its sources back on the rows that service never filled, once', async () => {
    const dbOf = (o: unknown) => (o as { db: Db }).db;
    const todo = async (kind: string) =>
      (await musicSql<{ todo: string; busy: number }>('SELECT todo, busy FROM know_facts WHERE kind = ?', kind)).map(
        (r) => r.todo.split(',').filter(Boolean),
      );
    // As the job left them with no keys: done, and nothing of Discogs or Last.fm filled.
    await musicSql("UPDATE know_facts SET todo = '', busy = 0, filled_json = '{\"musicbrainz\":1}'");
    await inMusic((o) => keysArrived(dbOf(o), { lastfm: false, discogs: false, listenbrainz: false }, SOURCES));
    expect((await todo('album')).every((t) => t.length === 0)).toBe(true);
    // Discogs's token arrives: albums ask Discogs again; artists (no Discogs source) and Last.fm's stay.
    const dc = { lastfm: false, discogs: true, listenbrainz: false };
    const n = await inMusic((o) => keysArrived(dbOf(o), dc, SOURCES));
    const albumsNow = await todo('album');
    // (What it answers is the rows written, index entries with them.)
    expect(n).toBeGreaterThan(0);
    expect(albumsNow.length).toBeGreaterThan(0);
    expect(albumsNow.every((t) => t.join() === 'dcm,dcr')).toBe(true);
    expect((await todo('artist')).every((t) => t.length === 0)).toBe(true);
    // Seen now: a second look changes nothing, and a row Discogs has filled is not asked again.
    expect(await inMusic((o) => keysArrived(dbOf(o), dc, SOURCES))).toBe(0);
    await musicSql("UPDATE know_facts SET todo = '', filled_json = '{\"discogs\":1}' WHERE kind = 'album'");
    await musicSql("DELETE FROM music_state WHERE key = 'know.keys'");
    await inMusic((o) => keysArrived(dbOf(o), dc, SOURCES));
    expect((await todo('album')).every((t) => t.length === 0)).toBe(true);
    // ListenBrainz's token arrives: artists ask its popularity again, even where its labs host (no
    // token) filled the family; albums (no ListenBrainz source) stay.
    await musicSql("UPDATE know_facts SET filled_json = '{\"listenbrainz\":1}' WHERE kind = 'artist'");
    const all = { lastfm: false, discogs: true, listenbrainz: true };
    expect(await inMusic((o) => keysArrived(dbOf(o), all, SOURCES))).toBeGreaterThan(0);
    expect((await todo('artist')).every((t) => t.join() === 'lbtop')).toBe(true);
    expect((await todo('album')).every((t) => t.length === 0)).toBe(true);
    expect(await inMusic((o) => keysArrived(dbOf(o), all, SOURCES))).toBe(0);
  });
});
