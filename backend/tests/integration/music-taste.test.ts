// Reading the taste (MUSIC.md §11.2–11.3): the MusicBrainz job resolves the most played artists one
// request a step, a step at most every 1.1 s, an unknown artist left as its name and never shown to
// the mind; ListenBrainz's similar artists fetched by id and kept a week (Last.fm's merged in when its
// key is set); `th music taste`'s counts, find weighted by history, and the brief's one taste line.
// Every outside service is a fake (history-helpers.ts fakeBrainz).
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MusicFindResponse } from '../../../shared/contract/music.ts';
import type {
  HistoryStatus,
  SimilarResponse,
  TasteResponse,
  TasteWeightsResponse,
} from '../../../shared/contract/taste.ts';
import { lookup, similarFetch, useFetch } from '../../src/areas/music/history-mb';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { ARTIST, fakeBrainz, mbidOf, putHistory, spotifyRows } from '../history-helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { seedCatalog } from '../music-helpers';

const alarm = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
const calls: string[] = [];
const fake = fakeBrainz(calls, new Set([2]));
const mbCalls = () => calls.filter((u) => u.startsWith('https://musicbrainz.org/')).length;
let p: Principals;
let ids: string[];

beforeAll(async () => {
  useFetch(fake);
  p = await principals();
  ids = await seedCatalog(
    [0, 0, 0, 1, 1, 5].map((a, i) => ({ title: `Invented song ${i}`, artist: ARTIST(a), genre: 'Pop' })),
    9_001,
  );
  const put = await putHistory(
    p.D,
    'Streaming_History_Audio_2021_0.json',
    new TextEncoder().encode(JSON.stringify(spotifyRows(400, 4))),
  );
  expect(put.status).toBe(202);
  for (let i = 0; i < 6; i++) {
    await alarm();
    if ((await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body.files[0]?.state === 'done')
      break;
  }
});

describe('the MusicBrainz job', () => {
  it('asks once a step and waits 1.1 s before the next, most played first', async () => {
    // The import's last alarm went on to the job's first step; more alarms in the same second ask nothing.
    await alarm();
    await alarm();
    expect(mbCalls()).toBe(1);
    const [job] = await coreSql<{ due_at: number; updated_at: number }>(
      "SELECT due_at, updated_at FROM jobs WHERE id = 'music.mb'",
    );
    expect(job.due_at - job.updated_at).toBe(1_100);
    // Its second guard: a lookup under 1.1 s after the last asks nothing.
    expect(await lookup(ARTIST(1))).toBe('wait');
    expect(mbCalls()).toBe(1);
  });

  it('resolves every artist due, leaves the unknown one as its name, then writes the taste line', async () => {
    for (let i = 0; i < 8; i++) {
      await coreSql("UPDATE jobs SET due_at = 0 WHERE id = 'music.mb' AND state <> 'done'");
      useFetch(fake);
      await alarm();
    }
    const s = (await apiJson<HistoryStatus>('GET', '/v1/music/history', { token: p.D })).body;
    expect([s.artists, s.resolved]).toEqual([4, 3]);
    expect(mbCalls()).toBe(4);
    const ua = calls.find((u) => u.includes('musicbrainz')) ?? '';
    expect(decodeURIComponent(ua)).toContain('artist:"Invented Artist');
    const [line] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'music.taste'");
    const text = JSON.parse(line.value_json) as string;
    expect(text).toMatch(/^taste: \d+ plays of 4 artists, 2019–2023, most in \d{4}; top: /);
    expect(text).not.toContain(ARTIST(2));
  });
});

describe('reading the taste', () => {
  it('th music taste: counts, ids and canonical names, the unknown artist with neither', async () => {
    const t = (await apiJson<TasteResponse>('GET', '/v1/music/taste?limit=4', as(p.C, CHAT_SESSION))).body;
    expect(t.artists).toBe(4);
    expect(t.top).toHaveLength(4);
    const unknown = t.top.find((a) => a.mbid === null);
    expect(unknown).toMatchObject({ name: null, songs: 0 });
    expect(unknown?.id).toMatch(/^h_[0-9a-f]{8}$/);
    expect(t.top.find((a) => a.mbid === mbidOf(0))).toMatchObject({ name: ARTIST(0), songs: 3 });
    expect(t.years.reduce((n, y) => n + y.plays, 0)).toBe(t.plays);
    expect((await apiJson('GET', '/v1/music/taste?limit=0', as(p.C, CHAT_SESSION))).status).toBe(422);
  });

  it('similar artists come from ListenBrainz by id, and are kept', async () => {
    const before = calls.length;
    const r = await apiJson<SimilarResponse>('GET', `/v1/music/similar/${mbidOf(0)}`, as(p.C, CHAT_SESSION));
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.mbid)).toEqual([mbidOf(1), mbidOf(2), mbidOf(3)]);
    expect(r.body.items[0]).toMatchObject({ name: ARTIST(1), score: 1, songs: 2 });
    expect(r.body.items[0].plays).toBeGreaterThan(0);
    expect(calls.slice(before)).toEqual([expect.stringContaining(`artist_mbids=${mbidOf(0)}`)]);
    await apiJson('GET', `/v1/music/similar/${mbidOf(0)}`, as(p.C, CHAT_SESSION));
    expect(calls.length).toBe(before + 1);
    expect((await apiJson('GET', '/v1/music/similar/not-an-id', as(p.C, CHAT_SESSION))).status).toBe(422);
  });

  it("with a Last.fm key, Last.fm's similar artists are merged in; without one it is never asked", async () => {
    const before = calls.length;
    const merged = await similarFetch({ LASTFM_API_KEY: 'invented-key' } as unknown as Env, mbidOf(0));
    expect(merged?.map((m) => m.mbid)).toEqual([mbidOf(1), mbidOf(7), mbidOf(2), mbidOf(3)]);
    expect(calls.slice(before).some((u) => u.includes('audioscrobbler'))).toBe(true);
    const plain = calls.length;
    await similarFetch({} as Env, mbidOf(1));
    expect(calls.slice(plain).some((u) => u.includes('audioscrobbler'))).toBe(false);
  });

  it('find --like-history weighs songs by the plays of their artist', async () => {
    const r = await apiJson<MusicFindResponse>('GET', '/v1/music/find?history=1&limit=10', as(p.C, CHAT_SESSION));
    expect(r.status).toBe(200);
    const got = r.body.items.map((i) => i.id);
    expect(new Set(got)).toEqual(new Set(ids.slice(0, 5)));
    expect(r.body.items.every((i) => (i.why.history ?? 0) > 0)).toBe(true);
    expect(r.body.items[0].why.history).toBe(1);
  });

  it("the DJ's weights: the phone's, by song id, the most played artist's at 1; none with the switch off", async () => {
    const weights = () => apiJson<TasteWeightsResponse>('GET', '/v1/music/taste/weights', { token: p.D });
    const on = await weights();
    expect([on.status, on.body.on]).toEqual([200, true]);
    expect(new Set(Object.keys(on.body.weights))).toEqual(new Set(ids.slice(0, 5)));
    expect(on.body.weights[ids[0]]).toBe(1);
    expect(Object.values(on.body.weights).every((w) => w > 0 && w <= 1)).toBe(true);
    expect((await apiJson('GET', '/v1/music/taste/weights', as(p.C, CHAT_SESSION))).status).toBe(403);
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'music.history': false } });
    expect((await weights()).body).toEqual({ on: false, weights: {} });
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'music.history': true } });
  });
});
