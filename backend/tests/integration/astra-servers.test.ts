// GET /v1/astra/torbox/servers (SECURITY.md §8.2): TorBox's speed-test list, asked by the Worker
// with the key and the phone's address, handed to the owner's device as each server group's label,
// region and test file address. An address carrying the key or a token, or not public https, is left
// out and the note counts them; TorBox's answer is read whether it comes in its usual envelope, bare,
// or keyed by region. Its own count of 6 a minute, then 429, leaves the taps theirs. Invented hosts,
// key and groups.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AstraServersResponse } from '../../../shared/contract/astra.ts';
import { forgetMinute } from '../../src/areas/astra/routes';
import { forgetServersMinute } from '../../src/areas/astra/servers';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import { KEY, LINK, relay, stubFetch, torboxCalls, world } from '../astra-helpers';
import { makeAgent, setupOwner } from '../helpers';

type Answer = AstraServersResponse & { error?: { code: string; retry_after?: number } };
let D = '';
let C = '';
const servers = (key: string | undefined = KEY) => relay<Answer>(D, { key, path: '/v1/astra/torbox/servers' });
/** TorBox's speed-test list answers `data` (in its envelope unless `bare`). */
const speedtest = (data: unknown, o: { bare?: boolean; status?: number } = {}) => {
  world.hosts.set('api.torbox.app', (req) => {
    if (!req.url.includes('/speedtest')) return new Response('', { status: 404 });
    if (req.headers.authorization !== `Bearer ${KEY}`)
      return Response.json({ success: false, error: 'BAD_TOKEN' }, { status: 403 });
    if (o.status) return new Response('', { status: o.status });
    return Response.json(o.bare ? data : { success: true, error: null, detail: 'Invented.', data });
  });
};
const LIST = [
  { name: 'latm', region: 'Invented South', url: 'https://speed.latm.tb-cdn.example/test/1mb.bin' },
  { group: 'wnam', region_name: 'Invented West', domain: 'speed.wnam.tb-cdn.example', path: '/test/1mb.bin' },
  { region: 'Invented East', url: 'https://store-1.enam.tb-cdn.example/test/1mb.bin' },
  { name: 'keyed', region: 'Invented North', url: `https://speed.keyed.tb-cdn.example/t.bin?x=${KEY}` },
  { name: 'tokened', region: 'Invented North', url: 'https://speed.tok.tb-cdn.example/t.bin?token=invented' },
  { name: 'plain', region: 'Invented North', url: 'http://speed.plain.tb-cdn.example/t.bin' },
  { name: '<b>odd</b>', url: 'https://speed.odd.example/t.bin' },
];

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  forgetMinute();
  forgetServersMinute();
  useTimes();
});
afterAll(() => {
  useFetch();
  useTimes();
});

describe('GET /v1/astra/torbox/servers', () => {
  it('the owner’s device only; without the key, says so and asks nobody', async () => {
    expect((await relay(C, { key: KEY, path: '/v1/astra/torbox/servers' })).status).toBe(403);
    const { status, body } = await servers('none');
    expect([status, body]).toEqual([200, { servers: [], note: 'No TorBox key is set on your server.' }]);
    expect(world.asked).toEqual([]);
  });

  it('each group’s label, region and test file; none with a token, none but public https', async () => {
    speedtest(LIST);
    const { status, body, text } = await servers();
    expect(status).toBe(200);
    expect(body.servers).toEqual([
      { group: 'latm', region: 'Invented South', url: 'https://speed.latm.tb-cdn.example/test/1mb.bin' },
      { group: 'wnam', region: 'Invented West', url: 'https://speed.wnam.tb-cdn.example/test/1mb.bin' },
      { group: 'enam', region: 'Invented East', url: 'https://store-1.enam.tb-cdn.example/test/1mb.bin' },
    ]);
    expect(body.note).toBe("2 of TorBox's test files were left out: the address carried a token.");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('token=');
    const asked = new URL(torboxCalls()[0].url);
    expect([asked.pathname, asked.searchParams.get('region'), asked.searchParams.get('test_length')]).toEqual([
      '/v1/api/speedtest',
      'all',
      'short',
    ]);
    expect(asked.searchParams.get('user_ip')).toBe('192.0.2.10');
    expect(torboxCalls()[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('reads a bare list, and one keyed by region', async () => {
    speedtest([{ name: 'latm', url: 'https://speed.latm.tb-cdn.example/a.bin' }], { bare: true });
    expect((await servers()).body).toEqual({
      servers: [{ group: 'latm', region: null, url: 'https://speed.latm.tb-cdn.example/a.bin' }],
    });
    speedtest({
      'Invented South': [{ url: 'https://s.latm.tb-cdn.example/a.bin' }],
      latm2: { path: 'https://x.example/b' },
    });
    expect((await servers()).body.servers).toEqual([
      { group: 'latm', region: 'Invented South', url: 'https://s.latm.tb-cdn.example/a.bin' },
      { group: 'latm2', region: null, url: 'https://x.example/b' },
    ]);
  });

  it('TorBox failing, or refusing the key: no servers, and why', async () => {
    speedtest([], { status: 503 });
    useTimes({ retry_ms: 5 });
    expect((await servers()).body).toEqual({ servers: [], note: 'TorBox answered with status 503.' });
    speedtest([]);
    expect((await servers()).body).toEqual({
      servers: [],
      note: 'TorBox listed no test files the phone may be given.',
    });
    expect((await servers('invented-wrong-key')).body).toEqual({ servers: [], note: 'TorBox did not accept the key.' });
  });

  it('6 a minute, then 429, on its own count: a tap still goes through', async () => {
    speedtest(LIST);
    for (let i = 0; i < 6; i++) expect((await servers()).status).toBe(200);
    const over = await servers();
    expect([over.status, over.body.error?.code]).toEqual([429, 'rate_limited']);
    expect(over.body.error?.retry_after).toBeGreaterThan(0);
    const tap = await relay(D, { key: 'none', body: { link: LINK, mode: 'play' } });
    expect(tap.status).toBe(200);
  });
});
