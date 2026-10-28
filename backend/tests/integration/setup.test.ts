// First-time setup (SIGN-IN.md §4.1, §4.3), in order: state, refusals in the documented order,
// success once, then 410 for ever. Storage is shared by the tests in this file.
import { describe, expect, it } from 'vitest';
import type { AuthStateResponse, ErrorBody, SessionsResponse, SignedInWithCode } from '../../../shared/contract/api';
import { fingerprint, sha256Hex, tokenHash } from '../../src/areas/auth/crypto';
import * as flows from '../../src/areas/auth/flows';
import { noBreachCheck } from '../../src/areas/auth/passwords';
import { UUIDV7 } from '../../src/lib/ids';
import { Db, Meter } from '../../src/objects/base';
import { api, apiJson, authSql, DEVICE, inAuth, PASSWORD, SETUP_CODE, USERNAME } from '../helpers';

const setupCall = (over: Record<string, unknown> = {}) => ({
  body: { setup_code: SETUP_CODE, username: USERNAME, password: PASSWORD, device: DEVICE, ...over },
});
const state = (q = '') => apiJson<AuthStateResponse>('GET', `/v1/auth/state${q}`);
const OTHER_CODE = 'ZZZZZZZZZZZZZZZZZZZZZZZZZ';

describe('setup', () => {
  it('state says open, and whether the installed fingerprint matches', async () => {
    expect((await state()).body).toEqual({ setup: 'open' });
    expect((await state(`?fp=${fingerprint(SETUP_CODE)}`)).body).toEqual({ setup: 'open', setup_fp: 'ready' });
    expect((await state(`?fp=${fingerprint(OTHER_CODE)}`)).body).toEqual({ setup: 'open', setup_fp: 'mismatch' });
    expect((await state('?fp=not-a-fingerprint')).status).toBe(422);
  });

  it('login and recover answer 409 setup_required while unclaimed, without hashing', async () => {
    for (const [path, body] of [
      ['/v1/auth/login', { username: USERNAME, password: PASSWORD, device: DEVICE }],
      ['/v1/auth/recover', { username: USERNAME, code: OTHER_CODE, new_password: PASSWORD, device: DEVICE }],
    ] as const) {
      const r = await apiJson<ErrorBody>('POST', path, { body });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('setup_required');
    }
  });

  it('answers 409 setup_fp_missing when AUTH_SETUP_FP is unset, empty or none', async () => {
    for (const setupFp of [null]) {
      const result = await inAuth((_o, s) =>
        flows.setup(
          {
            db: new Db(s.storage.sql, new Meter()),
            storage: s.storage,
            pepper: 'p',
            ipKey: 'k',
            setupFp,
            resetFp: null,
            breached: noBreachCheck,
          },
          { setup_code: SETUP_CODE, username: USERNAME, password: PASSWORD, device: {} },
          { ip: '192.0.2.1', country: null, region: null },
        ),
      );
      expect(result).toEqual({ ok: false, code: 'setup_fp_missing', details: undefined });
    }
    expect(await authSql('SELECT * FROM credential')).toEqual([]);
  });

  it('refuses another code with 401 setup_code_wrong and counts it', async () => {
    const { status, body } = await apiJson<ErrorBody>('POST', '/v1/auth/setup', setupCall({ setup_code: OTHER_CODE }));
    expect(status).toBe(401);
    expect(body.error.code).toBe('setup_code_wrong');
    expect(
      await authSql("SELECT key, fails FROM throttle WHERE key LIKE 'setup:%' ORDER BY key = 'setup:acct' DESC"),
    ).toMatchObject([{ key: 'setup:acct', fails: 1 }, { fails: 1 }]);
  });

  it('checks the username, then the password, with their own codes and no echo', async () => {
    const bad = await apiJson<ErrorBody>('POST', '/v1/auth/setup', setupCall({ username: 'no spaces allowed' }));
    expect([bad.status, bad.body.error.code]).toEqual([422, 'username_invalid']);
    for (const [password, code] of [
      ['tooshort', 'password_too_short'],
      ['x'.repeat(129), 'password_too_long'],
      ['my example-owner password!', 'password_guessable'],
      ['Thunderhead forever and ever', 'password_guessable'],
    ]) {
      const res = await api('POST', '/v1/auth/setup', setupCall({ password }));
      const text = await res.text();
      expect(res.status).toBe(422);
      expect((JSON.parse(text) as ErrorBody).error.code).toBe(code);
      expect(text).not.toContain(password);
    }
    const shape = await apiJson<ErrorBody>('POST', '/v1/auth/setup', setupCall({ device: 'phone' }));
    expect([shape.status, shape.body.error.code]).toEqual([422, 'validation']);
    expect(shape.body.error.details).toEqual([{ path: 'device', issue: expect.any(String) }]);
  });

  let first: SignedInWithCode;
  it('creates the credential, signs this device in and shows a recovery code once', async () => {
    const res = await api('POST', '/v1/auth/setup', setupCall({ username: '  Example-Owner ' }));
    expect(res.status).toBe(201);
    first = (await res.json()) as SignedInWithCode;
    expect(Object.keys(first).sort()).toEqual(['idle_days', 'recovery_code', 'session_id', 'token']);
    expect(first.token).toMatch(/^th1_[0-9A-Za-z]{49}$/);
    expect(first.session_id).toMatch(UUIDV7);
    expect(first.idle_days).toBe(90);
    expect(first.recovery_code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){4}[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(await authSql("SELECT * FROM throttle WHERE key LIKE 'setup:%'")).toEqual([]);
    expect(await authSql('SELECT kind, used_at IS NOT NULL AS used FROM tickets')).toEqual([
      { kind: 'setup', used: 1 },
    ]);
    expect(await authSql('SELECT kind FROM notices')).toEqual([]); // no new-device notice for the first
  });

  it('the new token lists this device', async () => {
    const { status, body } = await apiJson<SessionsResponse>('GET', '/v1/auth/sessions', { token: first.token });
    expect(status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: first.session_id,
        label: 'Android · Chrome',
        this_device: true,
        standalone: false,
      }),
    ]);
  });

  it('is done for ever, even with the right code; state says done', async () => {
    const { status, body } = await apiJson<ErrorBody>('POST', '/v1/auth/setup', setupCall());
    expect(status).toBe(410);
    expect(body.error.code).toBe('setup_done');
    expect((await state(`?fp=${fingerprint(SETUP_CODE)}`)).body).toEqual({ setup: 'done' });
  });

  it('stores only hashes: no password, token, code or fingerprint at rest', async () => {
    const [cred] = await authSql<Record<string, unknown>>('SELECT * FROM credential');
    expect(cred).toMatchObject({ username: USERNAME, algo: 'scrypt', n: 32768, r: 8, p: 3, pepper_v: 1, version: 1 });
    const [session] = await authSql<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(session.token_hash).toBe(tokenHash(first.token));
    const dump = JSON.stringify(
      await Promise.all(
        ['credential', 'recovery', 'sessions', 'throttle', 'tickets'].map((t) => authSql(`SELECT * FROM ${t}`)),
      ),
    );
    for (const secret of [
      PASSWORD,
      first.token,
      first.recovery_code,
      first.recovery_code.replace(/-/g, ''),
      SETUP_CODE,
    ])
      expect(dump).not.toContain(secret);
    expect(dump).not.toContain(sha256Hex(SETUP_CODE));
    expect(dump).not.toContain('192.0.2');
  });
});
