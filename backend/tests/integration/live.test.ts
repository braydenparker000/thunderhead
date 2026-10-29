// The live channel (API.md §12): a phone trades its token for a single-use ticket, connects,
// gets `hello`, and after a message posted over HTTP receives exactly one `changed` frame with
// kinds ["message", …]. Signing the session out closes its socket with 4401.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { LiveFrame, LiveTicket } from '../../../shared/contract/api';
import { LIVE_PROTOCOL } from '../../../shared/contract/feed.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, authSql, DEVICE, login, loginOk, PASSWORD, setupOwner, USERNAME } from '../helpers';

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
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(String(e.data)));
  });
  ws.addEventListener('close', (e) => {
    closed = e.code;
  });
  return { ws, frames, ticket: body.ticket, closed: () => closed };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

const recovery = { token: '', code: '' };

describe('live channel', () => {
  it('hello, then exactly one changed frame per committed message', async () => {
    const { token, recovery_code } = await setupOwner();
    recovery.token = token;
    recovery.code = recovery_code;
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

  it('a ticket minted before a sign-out cannot open a socket after it', async () => {
    const owner = await loginOk('192.0.2.32');
    const { body } = await apiJson<LiveTicket>('POST', '/v1/live/ticket', { token: owner.token });
    expect((await api('POST', '/v1/auth/signout', { token: owner.token, body: { scope: 'this' } })).status).toBe(204);
    const r = await api('GET', `/v1/live?ticket=${body.ticket}`, { headers: { Upgrade: 'websocket' } });
    expect(r.status).toBe(401);
  });

  it('a session evicted by the device limit loses its socket', async () => {
    const owner = await loginOk('192.0.2.33');
    const live = await connect(owner.token);
    await until(() => live.frames.length > 0);
    // Fill the device list to the limit with idle copies, the evictee idlest of all.
    const [row] = await authSql<{ n: number }>('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL');
    for (let i = row.n; i < 50; i++)
      await authSql(
        `INSERT INTO sessions (token_hash, id, label, standalone, created_at, last_seen_at, idle_expires_at, credential_version)
         SELECT ?, ?, label, standalone, created_at, last_seen_at, idle_expires_at, credential_version FROM sessions WHERE id = ?`,
        `fake-hash-${i}`,
        `fake-session-${i}`,
        owner.session_id,
      );
    await authSql('UPDATE sessions SET last_seen_at = 0 WHERE id = ?', owner.session_id);
    expect((await login('192.0.2.34')).status).toBe(200);
    await until(() => live.closed() !== null);
    expect(live.closed()).toBe(4401);
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
  // Last: it changes the password the other tests sign in with.
  it('recovery closes every live socket', async () => {
    const live = await connect(recovery.token);
    await until(() => live.frames.length > 0);
    const r = await api('POST', '/v1/auth/recover', {
      ip: '192.0.2.35',
      body: { username: USERNAME, code: recovery.code, new_password: `${PASSWORD} recovered`, device: DEVICE },
    });
    expect(r.status).toBe(200);
    await until(() => live.closed() !== null);
    expect(live.closed()).toBe(4401);
  });
});
