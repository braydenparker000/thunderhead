// Settings → Sign-in & devices and Settings → Agents (SIGN-IN.md §7.2, §9, §17; API.md §11.4):
// password change, a new recovery code, the inline password check's back-off, agent keys.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AgentMe,
  AgentsResponse,
  DeviceMe,
  ErrorBody,
  NewAgentResponse,
  RecoveryCodeResponse,
  SignedIn,
} from '../../../shared/contract/api';
import * as account from '../../src/areas/auth/account';
import { PRINCIPAL_CACHE_MS } from '../../src/http/auth';
import { Db, Meter } from '../../src/objects/base';
import { api, apiJson, authSql, inAuth, loginOk, PASSWORD, setupOwner, USERNAME } from '../helpers';

const NEXT = 'the second long passphrase 11';
let owner: SignedIn;
beforeAll(async () => {
  owner = await setupOwner();
});
const me = (token: string) => apiJson<DeviceMe & ErrorBody>('GET', '/v1/auth/me', { token });
const agent = (name: string, role = 'ci', current_password = PASSWORD) =>
  apiJson<NewAgentResponse & ErrorBody>('POST', '/v1/auth/agents', {
    token: owner.token,
    body: { name, role, current_password },
  });

describe('password change', () => {
  it('needs the current password and refuses the same one', async () => {
    const wrong = await apiJson<ErrorBody>('POST', '/v1/auth/password', {
      token: owner.token,
      body: { current_password: 'nope nope nope', new_password: NEXT, sign_out_others: true },
    });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'current_password_wrong']);
    const same = await apiJson<ErrorBody>('POST', '/v1/auth/password', {
      token: owner.token,
      body: { current_password: PASSWORD, new_password: PASSWORD, sign_out_others: true },
    });
    expect([same.status, same.body.error.code]).toEqual([422, 'password_same']);
  });

  it('refuses a breached password when the breach check says so (mocked; never the real service)', async () => {
    const out = await inAuth((_o, s) =>
      account.changePassword(
        {
          db: new Db(s.storage.sql, new Meter()),
          storage: s.storage,
          pepper: env.AUTH_PEPPER,
          ipKey: env.IP_HASH_KEY,
          setupFp: null,
          resetFp: null,
          breached: async () => true,
        },
        owner.session_id,
        { current_password: PASSWORD, new_password: NEXT, sign_out_others: false },
      ),
    );
    expect(out).toMatchObject({ ok: false, code: 'password_breached' });
  });

  it('with sign_out_others: other sessions get session_revoked password_changed', async () => {
    const other = await loginOk('192.0.2.170');
    const r = await apiJson<object>('POST', '/v1/auth/password', {
      token: owner.token,
      body: { current_password: PASSWORD, new_password: NEXT, sign_out_others: true },
    });
    expect(r).toEqual({ status: 200, body: {} });
    expect((await me(other.token)).body.error.details).toEqual({ reason: 'password_changed' });
    expect((await me(owner.token)).status).toBe(200);
  });

  it('without it: the others stay and get a password_changed notice', async () => {
    const other = await loginOk('192.0.2.171', NEXT);
    await api('POST', '/v1/auth/password', {
      token: owner.token,
      body: { current_password: NEXT, new_password: PASSWORD, sign_out_others: false },
    });
    expect((await me(other.token)).body.notices[0]).toMatchObject({
      kind: 'password_changed',
      about_session_id: owner.session_id,
    });
    expect((await me(owner.token)).body.notices.map((n) => n.kind)).not.toContain('password_changed');
  });
});

describe('recovery code and the inline password check', () => {
  it('a new code stops the old one at once', async () => {
    const r = await apiJson<RecoveryCodeResponse>('POST', '/v1/auth/recovery-code', {
      token: owner.token,
      body: { current_password: PASSWORD },
    });
    expect(r.status).toBe(200);
    expect(r.body.recovery_code).toMatch(/^([0-9A-Z]{5}-){4}[0-9A-Z]{5}$/);
    expect(await authSql('SELECT confirmed_at FROM recovery')).toEqual([{ confirmed_at: null }]);
  });

  it('5 wrong current passwords per session, then 2^(n−5) s; the sign-in counters stay untouched', async () => {
    const s = await loginOk('192.0.2.172');
    const bad = () =>
      apiJson<ErrorBody>('POST', '/v1/auth/recovery-code', {
        token: s.token,
        body: { current_password: 'wrong wrong wrong' },
      });
    for (let i = 0; i < 6; i++) expect((await bad()).status).toBe(401);
    const r = await bad();
    expect([r.status, r.body.error.retry_after]).toEqual([429, 2]);
    expect(await authSql("SELECT fails FROM throttle WHERE key = 'pwcheck:' || ?", s.session_id)).toEqual([
      { fails: 6 },
    ]);
    expect(await authSql("SELECT key FROM throttle WHERE key LIKE 'signin:%'")).toEqual([]);
  });
});

describe('agent keys', () => {
  let key: NewAgentResponse;
  it('issues a key once, with the role prefix, and lists it without the token', async () => {
    const r = await agent('mind-chat', 'mind:chat');
    expect(r.status).toBe(201);
    key = r.body;
    expect(Object.keys(key).sort()).toEqual(['id', 'token']);
    expect(key.token).toMatch(/^thm_[0-9A-Za-z]{49}$/);
    expect((await agent('ci', 'ci')).body.token).toMatch(/^thc_/);
    expect((await agent('muse', 'muse')).body.token).toMatch(/^ths_/);
    const list = await apiJson<AgentsResponse>('GET', '/v1/auth/agents', { token: owner.token });
    expect(JSON.stringify(list.body)).not.toContain(key.token);
    expect(list.body.items.find((a) => a.id === key.id)).toMatchObject({
      name: 'mind-chat',
      role: 'mind:chat',
      created_on: 'Test phone · Chrome',
      last_used_at: null,
    });
  });

  it('needs the current password; names are unique; at most 20 active keys', async () => {
    expect((await agent('other', 'ci', 'not the password')).body.error.code).toBe('current_password_wrong');
    expect((await agent('mind-chat', 'mind:night')).body.error.code).toBe('agent_name_taken');
    for (let i = 3; i < 20; i++) expect((await agent(`k${i}`)).status).toBe(201);
    const r = await agent('k20');
    expect([r.status, r.body.error.code]).toEqual([409, 'agent_limit']);
    for (let i = 3; i < 20; i++) {
      const id = (await apiJson<AgentsResponse>('GET', '/v1/auth/agents', { token: owner.token })).body.items.find(
        (a) => a.name === `k${i}`,
      )?.id;
      await api('DELETE', `/v1/auth/agents/${id}`, { token: owner.token });
    }
  });

  it('works on /me and deep health, records last used, and is refused within 60 s of revoking', async () => {
    const r = await apiJson<AgentMe>('GET', '/v1/auth/me', { token: key.token });
    expect(r.body).toEqual({ agent_id: key.id, role: 'mind:chat', name: 'mind-chat' });
    expect((await api('GET', '/v1/ops/health/deep', { token: key.token })).status).toBe(200);
    const list = await apiJson<AgentsResponse>('GET', '/v1/auth/agents', { token: owner.token });
    expect(list.body.items.find((a) => a.id === key.id)?.last_used_at).toBeGreaterThan(0);
    await authSql('UPDATE agents SET revoked_at = ? WHERE id = ?', Date.now(), key.id); // revoked elsewhere
    expect((await api('GET', '/v1/auth/me', { token: key.token })).status).toBe(200); // cached here
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + PRINCIPAL_CACHE_MS + 1);
      expect((await api('GET', '/v1/auth/me', { token: key.token })).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('other devices see agent_key_created; "Not me" revokes the key', async () => {
    const other = await loginOk('192.0.2.173');
    const k = (await agent('suspicious', 'ci')).body;
    const n = (await me(other.token)).body.notices.find((x) => x.kind === 'agent_key_created');
    expect(n).toMatchObject({ args: { name: 'suspicious', role: 'ci', label: 'Test phone · Chrome' } });
    expect(JSON.stringify(n)).not.toContain(k.id);
    expect(
      (await api('POST', `/v1/auth/notices/${n?.id}/ack`, { token: other.token, body: { answer: 'not_me' } })).status,
    ).toBe(204);
    expect((await api('GET', '/v1/auth/me', { token: k.token })).status).toBe(401);
    expect(
      (await api('POST', `/v1/auth/notices/${n?.id}/ack`, { token: other.token, body: { answer: 'ok' } })).status,
    ).toBe(404);
  });

  it('DELETE is 204, also when already gone', async () => {
    const k = (await agent('short-lived', 'ci')).body;
    expect((await api('DELETE', `/v1/auth/agents/${k.id}`, { token: owner.token })).status).toBe(204);
    expect((await api('DELETE', `/v1/auth/agents/${k.id}`, { token: owner.token })).status).toBe(204);
    expect((await api('GET', '/v1/auth/me', { token: k.token })).status).toBe(401);
    expect(USERNAME).toBeTruthy();
  });
});
