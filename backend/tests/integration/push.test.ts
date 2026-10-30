// P8: Web Push through the new Worker (SECURITY.md §10, BEHAVIOR.md §3.4, API.md), the test acting
// as the push service and the phone: the key for devices only; a subscription only to a known push
// service; a test push this phone decrypts to a kind and an id, whose words it then fetches; the
// mind's nudge held while a phone shows Thunderhead and sent once none does, refused 2 h within
// another, idempotent under its id; a new
// sign-in's notice pushed in generic words; a subscription gone at the push service (410) or with
// its session's sign-out is deleted.
import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LiveTicket } from '../../../shared/contract/api';
import { useFetch } from '../../src/areas/push/outbox';
import { deliver } from '../../src/areas/push/routes';
import { api, apiJson, authSql, loginOk, makeAgent, setupOwner } from '../helpers';
import { type Phone, phone, received } from '../push-helpers';

let D = '';
let C = '';
let mine: Phone;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-phone-1';
let got: { url: string; headers: Headers; body: Uint8Array }[] = [];
let status = 201;

/** A phone with Thunderhead open: its live socket (API.md §12). */
async function looking(token: string) {
  const { body } = await apiJson<LiveTicket>('POST', '/v1/live/ticket', { token });
  const res = await exports.default.fetch(
    new Request(`https://api.example.test/v1/live?ticket=${body.ticket}`, { headers: { Upgrade: 'websocket' } }),
  );
  const ws = res.webSocket as WebSocket;
  ws.accept();
  const closed = new Promise((r) => ws.addEventListener('close', r));
  return {
    close: async () => {
      ws.close(1000);
      await closed;
    },
  };
}
const subscribe = (token: string, p: Phone, endpoint = ENDPOINT) =>
  api('PUT', '/v1/push/subscription', { token, body: { endpoint, keys: p.keys } });
const payloads = async (p: Phone) =>
  Promise.all(got.map(async (g) => JSON.parse(await received(p, g.body)) as { k: string; id: string }));
const nudge = (title = 'Leave by 16:40', topic = 'trip.leave') => ({
  title,
  body: 'The bus is 10 minutes early today.',
  why: 'time-bound: the bus leaves early',
  topic_key: topic,
});

beforeAll(async () => {
  useFetch(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    got.push({
      url,
      headers: new Headers(init?.headers),
      body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
    });
    return new Response(null, { status });
  });
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  mine = await phone();
  // Quiet hours off for these tests (the rules' clock is checked in tests/unit/webpush.test.ts).
  await apiJson('PATCH', '/v1/settings', { token: D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
});
afterAll(() => useFetch((...a) => fetch(...a)));

describe('Web Push', () => {
  it('the key is for devices; a subscription only to a known push service', async () => {
    const key = await apiJson<{ vapid_public_key: string }>('GET', '/v1/push/key', { token: D });
    expect(key.status).toBe(200);
    expect(key.body.vapid_public_key).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect((await api('GET', '/v1/push/key', { token: C })).status).toBe(403);
    expect((await subscribe(D, mine, 'https://evil.example/push')).status).toBe(422);
    expect((await subscribe(D, mine)).status).toBe(204);
    // The agent key made above left its notice waiting: it goes as soon as there is a phone.
    got = [];
    await deliver(env);
    const [p] = await payloads(mine);
    expect(p.k).toBe('security');
    expect((await apiJson('GET', `/v1/push/items/${p.id}`, { token: D })).body).toEqual({
      title: 'Thunderhead',
      body: 'A new agent key was made for Thunderhead',
      url: '/settings/agents/',
    });
  });

  it('a test push reaches this phone as a kind and an id; the words come from the Worker', async () => {
    got = [];
    const r = await apiJson<{ sent: number }>('POST', '/v1/push/test', { token: D });
    expect(r.body).toEqual({ sent: 1 });
    expect(got.map((g) => g.url)).toEqual([ENDPOINT]);
    const h = got[0].headers;
    expect([h.get('Content-Encoding'), h.get('TTL'), h.get('Urgency')]).toEqual(['aes128gcm', '600', 'high']);
    expect(h.get('Authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
    const [p] = await payloads(mine);
    expect(p.k).toBe('test');
    const words = await apiJson('GET', `/v1/push/items/${p.id}`, { token: D });
    expect(words.body).toEqual({ title: 'Thunderhead', body: 'This is a test. Nothing needs you.', url: '/' });
    expect((await api('GET', `/v1/push/items/${p.id}`, { token: C })).status).toBe(403);
  });

  it('the mind’s nudge waits while a phone shows Thunderhead, then goes; another within 2 h is refused; the same id is the same answer', async () => {
    got = [];
    expect((await api('PUT', '/v1/pushes/nudge-0001', { token: C, body: nudge('Leave now!') })).status).toBe(422);
    const showing = await looking(D);
    const first = await apiJson<{ queued_until: number }>('PUT', '/v1/pushes/nudge-0001', { token: C, body: nudge() });
    expect(first.status).toBe(202);
    await deliver(env);
    expect(got).toEqual([]);
    await showing.close();
    await deliver(env);
    const sent = await payloads(mine);
    expect(sent).toEqual([{ k: 'nudge', id: 'nudge-0001' }]);
    expect(got[0].headers.get('Urgency')).toBe('normal');
    expect((await apiJson('GET', '/v1/push/items/nudge-0001', { token: D })).body).toEqual({
      title: 'Leave by 16:40',
      body: 'The bus is 10 minutes early today.',
      url: '/',
    });
    expect((await apiJson('PUT', '/v1/pushes/nudge-0001', { token: C, body: nudge() })).body).toEqual(first.body);
    expect(
      (await apiJson<{ error: { code: string } }>('PUT', '/v1/pushes/nudge-0001', { token: C, body: nudge('Other') }))
        .body.error.code,
    ).toBe('conflict');
    const again = await apiJson<{ error: { code: string } }>('PUT', '/v1/pushes/nudge-0002', {
      token: C,
      body: nudge('Later', 'trip.other'),
    });
    expect([again.status, again.body.error.code]).toEqual([409, 'push_gap']);
    expect((await api('PUT', '/v1/pushes/nudge-0003', { token: D, body: nudge() })).status).toBe(403);
  });

  it('a new sign-in pushes its notice in generic words', async () => {
    got = [];
    await loginOk('192.0.2.20');
    await deliver(env);
    const [p] = await payloads(mine);
    expect(p.k).toBe('security');
    expect((await apiJson('GET', `/v1/push/items/${p.id}`, { token: D })).body).toEqual({
      title: 'Thunderhead',
      body: 'New sign-in to Thunderhead',
      url: '/settings/devices/',
    });
  });

  it('a subscription goes when its push service says gone, and with its session', async () => {
    const other = await loginOk('192.0.2.30');
    expect(
      (await subscribe(other.token, await phone(), 'https://fcm.googleapis.com/fcm/send/test-phone-2')).status,
    ).toBe(204);
    const count = async () => (await authSql<{ n: number }>('SELECT count(*) AS n FROM push_subscriptions'))[0].n;
    expect(await count()).toBe(2);
    expect((await api('POST', '/v1/auth/signout', { token: other.token, body: { scope: 'this' } })).status).toBe(204);
    expect(await count()).toBe(1);
    status = 410;
    expect((await apiJson('POST', '/v1/push/test', { token: D })).body).toEqual({ sent: 0 });
    status = 201;
    expect(await count()).toBe(0);
  });
});
