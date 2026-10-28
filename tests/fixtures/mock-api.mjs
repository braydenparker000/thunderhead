// A stand-in for the Worker's /v1/auth routes inside Playwright (route interception), so the
// sign-in pages and Settings can be driven end to end with no network. Synthetic data only.
export const API = 'https://api.th.test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, TH-Client',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
  'access-control-max-age': '600',
};

/** Fixed test values: a token shape, never a real one. */
export const TOKEN = 'test-session-token';
export const RECOVERY = '7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC';

/**
 * Routes the API host for `page`. `state` is mutable from the test; `calls` records every request
 * as "METHOD /path" with its JSON body.
 */
export async function mockApi(page, overrides = {}) {
  const now = Date.now();
  const state = {
    setup: 'done',
    setup_fp: 'missing',
    reset: 'none',
    login: () => [200, { token: TOKEN, session_id: 's1', idle_days: 90 }],
    me: () => [200, { session_id: 's1', label: 'Android phone · Chrome', notices: [], recovery_confirmed: true }],
    sessions: [
      { id: 's1', label: 'Android phone · Chrome', platform: 'Android', browser: 'Chrome', standalone: false, region: 'Region', country: 'XX', last_country: 'XX', signed_in_at: now - 5 * 86_400_000, last_seen_at: now, this_device: true },
      { id: 's2', label: 'Windows · Edge', platform: 'Windows', browser: 'Edge', standalone: false, region: 'Region', country: 'XX', last_country: 'XX', signed_in_at: now - 40 * 86_400_000, last_seen_at: now - 2 * 86_400_000, this_device: false },
    ],
    agents: [{ id: 'a1', name: 'ci', role: 'ci', created_at: now - 10 * 86_400_000, created_on: 'Android phone · Chrome', last_used_at: now - 3_600_000 * 3, last_country: 'XX' }],
    ...overrides,
  };
  const calls = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    let body = null;
    try { body = req.postDataJSON(); } catch {}
    calls.push({ call: `${req.method()} ${url.pathname}`, body, auth: req.headers().authorization ?? null, client: req.headers()['th-client'] ?? null, query: url.search });
    const [status, json] = answer(state, req.method(), url, body);
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: json === null ? '' : JSON.stringify(json) });
  });
  return { state, calls };
}

const err = (status, code, extra = {}) => [status, { error: { code, message: code, request_id: 'test', ...extra } }];

function answer(state, method, url, body) {
  const p = url.pathname;
  const k = `${method} ${p}`;
  if (k === 'GET /v1/auth/state') {
    if (url.searchParams.get('reset_fp')) return [200, { setup: state.setup, reset: state.reset, usable_after: state.usable_after }];
    return [200, url.searchParams.get('fp') ? { setup: state.setup, setup_fp: state.setup_fp } : { setup: state.setup }];
  }
  if (k === 'POST /v1/auth/login') return state.login(body);
  if (k === 'POST /v1/auth/setup') return state.setupAnswer ? state.setupAnswer(body) : [201, { token: TOKEN, session_id: 's1', idle_days: 90, recovery_code: RECOVERY }];
  if (k === 'POST /v1/auth/recover') return state.recoverAnswer ? state.recoverAnswer(body) : [200, { token: TOKEN, session_id: 's1', idle_days: 90, recovery_code: RECOVERY }];
  if (k === 'GET /v1/auth/me') return state.me();
  if (k === 'POST /v1/auth/signout') return [204, null];
  if (k === 'POST /v1/auth/recovery-code/confirm') return [204, null];
  if (k === 'POST /v1/auth/recovery-code') return body.current_password === 'right password here' ? [200, { recovery_code: RECOVERY }] : err(401, 'current_password_wrong');
  if (k === 'POST /v1/auth/password') return body.current_password === 'right password here' ? [200, {}] : err(401, 'current_password_wrong');
  if (k === 'GET /v1/auth/sessions') return [200, { items: state.sessions }];
  if (k === 'GET /v1/auth/agents') return [200, { items: state.agents }];
  if (k === 'POST /v1/auth/agents') {
    if (body.current_password !== 'right password here') return err(401, 'current_password_wrong');
    state.agents = [...state.agents, { id: 'a2', name: body.name, role: body.role, created_at: Date.now(), created_on: 'Android phone · Chrome', last_used_at: null, last_country: null }];
    return [201, { id: 'a2', token: 'test-agent-token-shown-once' }];
  }
  if (method === 'DELETE' && p.startsWith('/v1/auth/agents/')) { state.agents = state.agents.filter(a => a.id !== p.split('/').pop()); return [204, null]; }
  if (method === 'DELETE' && p.startsWith('/v1/auth/sessions/')) { state.sessions = state.sessions.filter(s => s.id !== p.split('/').pop()); return [204, null]; }
  if (method === 'PATCH' && p.startsWith('/v1/auth/sessions/')) return [200, { ...state.sessions[0], label: body.label }];
  if (method === 'POST' && /^\/v1\/auth\/notices\/[^/]+\/ack$/.test(p)) return [204, null];
  if (k === 'POST /v1/auth/breakglass/cancel') return [204, null];
  return err(404, 'not_found');
}
