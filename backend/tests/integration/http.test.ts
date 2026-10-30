// The HTTP edge (API.md §1, §4–§6, §9; SECURITY.md §7–8): CORS, response headers, the error
// envelope, body limits, client skew and public health.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, HealthResponse, SignedIn } from '../../../shared/contract/api';
import { api, apiJson, auth, DEVICE, rowsDuring, SITE, setupOwner, USERNAME } from '../helpers';

const preflight = (origin: string, path = '/v1/auth/login') =>
  api('OPTIONS', path, {
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, th-client',
    },
  });

let owner: SignedIn;
beforeAll(async () => {
  owner = await setupOwner();
});

describe('CORS', () => {
  it('answers a preflight from the site with exact origin, the agreed headers, no credentials, 2 h cache', async () => {
    const res = await preflight(SITE);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization,Content-Type,TH-Client,TH-File-Name,TH-Sha256,If-None-Match,Range,If-Range',
    );
    expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('refuses every other origin with 403 and no CORS headers, preflight or not, before any object call', async () => {
    const rows = await rowsDuring(auth(), async () => {
      for (const origin of [
        'https://evil.example.test',
        'https://site.example.test.evil.test',
        'http://site.example.test',
        'https://other.zNN.web.core.windows.net',
        'null',
      ]) {
        for (const res of [
          await preflight(origin),
          await api('POST', '/v1/auth/login', { headers: { Origin: origin }, body: {} }),
        ]) {
          expect(res.status, origin).toBe(403);
          expect(((await res.json()) as ErrorBody).error.code).toBe('origin_not_allowed');
          expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
        }
      }
    });
    expect(rows).toEqual({ read: 0, written: 0 });
  });

  it('decorates errors from the site, exposing the TH headers and Retry-After', async () => {
    const res = await api('GET', '/v1/auth/sessions', { headers: { Origin: SITE } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      'TH-Request-Id,TH-Server,TH-Min-Client,Retry-After,ETag,Content-Range,Accept-Ranges',
    );
  });
});

describe('responses', () => {
  it('health is public and shaped {ok, version:{id, tag}, min_client, at}', async () => {
    const { status, body } = await apiJson<HealthResponse>('GET', '/v1/health');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['at', 'min_client', 'ok', 'version']);
    expect(body.version).toEqual({ id: env.VERSION.id, tag: env.VERSION.tag || null });
    expect(typeof body.min_client).toBe('number');
    expect(Math.abs(body.at - Date.now())).toBeLessThan(5000);
  });

  it('every response is private and carries the TH headers', async () => {
    for (const res of [
      await api('GET', '/v1/health', { headers: { 'CF-Ray': '8f00-EZE' } }),
      await api('GET', '/v1/auth/sessions'),
      await api('GET', '/nowhere'),
    ]) {
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(res.headers.get('TH-Request-Id')).toBeTruthy();
      expect(res.headers.get('TH-Server')).toBe(env.VERSION.id);
      expect(res.headers.get('TH-Min-Client')).toMatch(/^\d+$/);
    }
    expect((await api('GET', '/v1/health', { headers: { 'CF-Ray': '8f00-EZE' } })).headers.get('TH-Request-Id')).toBe(
      '8f00-EZE',
    );
  });

  it('uses the error envelope with the CF-Ray as request id; unparseable JSON is 400', async () => {
    const res = await api('POST', '/v1/auth/login', {
      headers: { 'CF-Ray': '8f00000000000000-EZE', 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'bad_request', message: 'The request could not be read.', request_id: '8f00000000000000-EZE' },
    });
  });

  it('refuses auth bodies over 4 KB before parsing them', async () => {
    const { status, body } = await apiJson<ErrorBody>('POST', '/v1/auth/login', {
      body: { username: USERNAME, password: 'x'.repeat(5000), device: {} },
    });
    expect([status, body.error.code]).toEqual([413, 'too_large']);
  });

  it('answers shape problems with 422 validation, field paths and no values', async () => {
    const res = await api('POST', '/v1/auth/login', {
      body: { username: 42, password: 'secret-ish-value', device: DEVICE },
    });
    const text = await res.text();
    expect(res.status).toBe(422);
    const body = JSON.parse(text) as ErrorBody;
    expect(body.error.code).toBe('validation');
    expect(body.error.details).toEqual([{ path: 'username', issue: expect.any(String) }]);
    expect(text).not.toContain('secret-ish-value');
  });
});

describe('client skew (API.md §5)', () => {
  it('a site build below min_client may read but gets 426 client_outdated on writes', async () => {
    await api('PATCH', '/v1/settings', { token: owner.token, body: { min_client: 500 } });
    const old = { 'TH-Client': '499.abc1234' };
    const w = await apiJson<ErrorBody>('POST', '/v1/auth/signout', {
      token: owner.token,
      headers: old,
      body: { scope: 'others' },
    });
    expect([w.status, w.body.error.code, w.body.error.details]).toEqual([426, 'client_outdated', { min_client: 500 }]);
    expect((await api('GET', '/v1/settings', { token: owner.token, headers: old })).status).toBe(200);
    expect((await api('GET', '/v1/health')).headers.get('TH-Min-Client')).toBe('500');
    expect((await apiJson<HealthResponse>('GET', '/v1/health')).body.min_client).toBe(500);
    // Current builds and non-site clients write normally.
    expect(
      (
        await api('POST', '/v1/auth/signout', {
          token: owner.token,
          headers: { 'TH-Client': '500.abc1234' },
          body: { scope: 'others' },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await api('POST', '/v1/auth/signout', {
          token: owner.token,
          headers: { 'TH-Client': 'th/0.1.0' },
          body: { scope: 'others' },
        })
      ).status,
    ).toBe(204);
    await api('PATCH', '/v1/settings', { token: owner.token, body: { min_client: 0 } });
  });
});
