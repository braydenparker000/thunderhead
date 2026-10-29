// The live channel (API.md §12): a phone trades its token for a single-use ticket, connects,
// gets `hello`, and after a message posted over HTTP receives exactly one `changed` frame with
// kinds ["message", …]. Signing the session out closes its socket with 4401.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { LiveFrame, LiveTicket } from '../../../shared/contract/api';
import { LIVE_PROTOCOL } from '../../../shared/contract/feed.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, loginOk, setupOwner } from '../helpers';

async function connect(token: string) {
  const { body } = await apiJson<LiveTicket>('POST', '/v1/live/ticket', { token });
  const res = await exports.default.fetch(
    new Request(`https://api.example.test/v1/live?ticket=${body.ticket}`, { headers: { Upgrade: 'websocket' } }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket as WebSocket;
  ws.accept();
  const frames: LiveFrame[] = [];
  let closed: number | null = null;
  ws.addEventListener('message', (e) => frames.push(JSON.parse(String(e.data))));
  ws.addEventListener('close', (e) => {
    closed = e.code;
  });
  return { ws, frames, ticket: body.ticket, closed: () => closed };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

describe('live channel', () => {
  it('hello, then exactly one changed frame per committed message', async () => {
    const { token } = await setupOwner();
    const live = await connect(token);
    await until(() => live.frames.length > 0);
    expect(live.frames[0]).toMatchObject({ t: 'hello', v: LIVE_PROTOCOL, min_client: 0 });
    await apiJson('PUT', `/v1/messages/${uuidv7()}`, { token, body: { body: 'ping over http' } });
    await until(() => live.frames.length > 1);
    await new Promise((r) => setTimeout(r, 200));
    const changed = live.frames.filter((f) => f.t === 'changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].t === 'changed' && changed[0].kinds).toEqual(expect.arrayContaining(['message']));
    live.ws.close(1000);
  });

  it('a ticket works once', async () => {
    const owner = await loginOk('192.0.2.30');
    const live = await connect(owner.token);
    const again = await api('GET', `/v1/live?ticket=${live.ticket}`, { headers: { Upgrade: 'websocket' } });
    expect(again.status).toBe(401);
    live.ws.close(1000);
  });

  it('signing out closes the socket with 4401', async () => {
    const owner = await loginOk('192.0.2.31');
    const live = await connect(owner.token);
    await until(() => live.frames.length > 0);
    expect((await api('POST', '/v1/auth/signout', { token: owner.token, body: { scope: 'this' } })).status).toBe(204);
    await until(() => live.closed() !== null);
    expect(live.frames.at(-1)).toEqual({ t: 'bye', code: 'session_revoked' });
    expect(live.closed()).toBe(4401);
  });
});
