// A stand-in for the Worker inside Playwright (route interception): the /v1/auth routes, so the
// sign-in pages and Settings can be driven end to end, and the conversation's routes with a live
// socket (page.routeWebSocket), so home's chat can be too. No network; synthetic data only.
import { memoryAnswer, memoryState } from './mock-memory.mjs';

export const API = 'https://api.th.test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, TH-Client',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
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
  state.chat = chatState(overrides.chat);
  state.memory = 'memory' in overrides ? overrides.memory : memoryState(now);
  const calls = [];
  await page.routeWebSocket(/\/v1\/live\?ticket=/, (ws) => {
    state.chat.sockets.push(ws);
    ws.onMessage((m) => {
      if (m === 'ping') ws.send('pong');
    });
    ws.send(JSON.stringify({ t: 'hello', v: 1, seq: state.chat.seq, min_client: 0 }));
  });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    let body = null;
    try { body = req.postDataJSON(); } catch {}
    calls.push({ call: `${req.method()} ${url.pathname}`, body, auth: req.headers().authorization ?? null, client: req.headers()['th-client'] ?? null, query: url.search });
    const c = state.chat;
    // A load the test made slow or made fail (`c.slow[path] = ms`, `c.fail[path] = times`).
    if (c.fail[url.pathname] > 0) {
      c.fail[url.pathname]--;
      return route.fulfill({ status: 503, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 'unavailable', message: 'down', request_id: 't' } }) });
    }
    const [status, json] = answer(state, req.method(), url, body);
    if (c.slow[url.pathname]) await new Promise((r) => setTimeout(r, c.slow[url.pathname]));
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: json === null ? '' : JSON.stringify(json) });
  });
  return { state, calls, chat: chatControls(state.chat) };
}

const DAY = '2026-10-29';
const THREAD = { id: '0192f0c4-0000-7000-8000-0000000000aa', day: DAY, kind: 'daily', status: 'open', title: null, title_source: null, summary: null, continues: null, message_count: 0, started_at: 0, updated_at: 0, filed_at: null };

/** The conversation's state; `overrides` set presence, messages, a reply to give, failures. */
function chatState(o = {}) {
  return {
    thread: o.messages?.length ? { ...THREAD } : null,
    messages: o.messages ?? [],
    seq: 0,
    changes: [],
    presence: o.presence ?? { state: 'asleep', note: null, since: null },
    stop: null,
    surfaces: o.surfaces ?? [],
    verbs: o.verbs ?? [],
    results: [],
    sockets: [],
    /** null, or { after: ms, text, meta? }: the mind answers each owner message. */
    reply: o.reply ?? null,
    failSay: o.failSay ?? 0,
    typing: 0,
    /** Per path: answer this many ms late, or with a 503 this many times. */
    slow: {},
    fail: { ...o.fail },
  };
}

/** Commits a change: the feed row, then a `changed` frame on every socket (API.md §12). */
function changed(c, kind) {
  c.seq++;
  c.changes.push({ seq: c.seq, kind, ref: null, at: Date.now() });
  for (const ws of c.sockets) try { ws.send(JSON.stringify({ t: 'changed', seq: c.seq, kinds: [kind] })); } catch {}
}

function message(c, fields) {
  if (!c.thread) c.thread = { ...THREAD };
  const m = { seq: c.messages.length + 1, thread_id: THREAD.id, origin: fields.author === 'owner' ? 'owner_device' : fields.author, kind: 'text', meta: null, attachments: [], reply_to: null, created_at: Date.now(), delivered_at: null, acked_at: null, answered_at: null, ...fields };
  c.messages.push(m);
  changed(c, 'message');
  return m;
}

/** Test controls: the mind replies, posts a system line, changes presence, places a surface. */
function chatControls(c) {
  return {
    reply: (text, extra = {}) => message(c, { id: crypto.randomUUID(), author: 'mind', body: text, ...extra }),
    system: (text) => message(c, { id: crypto.randomUUID(), author: 'system', origin: 'system', body: text }),
    presence: (s) => { c.presence = { state: s, note: null, since: Date.now() }; changed(c, 'mind_status'); },
    surface: (s) => { c.surfaces = [s]; changed(c, 'surface'); },
    verb: (v) => { c.verbs.push(v); changed(c, 'verb'); },
    get state() { return c; },
  };
}

function chatAnswer(c, method, p, url, body) {
  const k = `${method} ${p}`;
  if (k === 'GET /v1/threads/today') return [200, { thread: c.thread, messages: c.messages, seq: c.seq, day: DAY }];
  if (method === 'PUT' && p.startsWith('/v1/messages/')) {
    const id = p.split('/').pop();
    const found = c.messages.find((m) => m.id === id);
    if (found) return [200, found];
    if (c.failSay > 0) { c.failSay--; return [503, { error: { code: 'unavailable', message: 'down', request_id: 't' } }]; }
    const m = message(c, { id, author: 'owner', body: body.body });
    if (c.reply) setTimeout(() => { m.answered_at = Date.now(); message(c, { id: crypto.randomUUID(), author: 'mind', body: c.reply.text, meta: c.reply.meta ?? null, reply_to: id }); }, c.reply.after);
    return [201, m];
  }
  if (k === 'GET /v1/changes') {
    const after = Number(url.searchParams.get('after')) || 0;
    if (after > c.seq) return [410, { error: { code: 'resync_required', message: 'resync', request_id: 't' } }];
    const items = c.changes.filter((x) => x.seq > after);
    return [200, { items, next_after: items.at(-1)?.seq ?? after, more: false }];
  }
  if (k === 'POST /v1/live/ticket') return [200, { ticket: `thw_${'0'.repeat(22)}`, expires_at: Date.now() + 30_000 }];
  if (k === 'GET /v1/settings') return [200, { 'owner.tz': 'UTC', min_client: 0, 'mind.status': c.presence, ...(c.stop ? { 'mind.stop': c.stop } : {}) }];
  if (k === 'GET /v1/surfaces') return [200, { items: c.surfaces, seq: c.seq }];
  if (k === 'POST /v1/mind/typing') { c.typing++; return [204, null]; }
  if (k === 'POST /v1/mind/stop') { c.stop = { at: Date.now(), seq: c.seq + 1, cleared_at: null }; changed(c, 'mind_status'); return [204, null]; }
  if (k === 'GET /v1/verbs/pending') return [200, { items: c.verbs.filter((v) => v.status === 'pending') }];
  if (method === 'POST' && /^\/v1\/verbs\/[^/]+\/claim$/.test(p)) {
    const v = c.verbs.find((x) => x.id === p.split('/')[3]);
    if (!v || v.status !== 'pending') return [409, { error: { code: 'already_claimed', message: 'taken', request_id: 't' } }];
    v.status = 'claimed';
    return [200, v];
  }
  if (method === 'POST' && /^\/v1\/verbs\/[^/]+\/result$/.test(p)) {
    const v = c.verbs.find((x) => x.id === p.split('/')[3]);
    v.status = body.ok ? 'done' : 'failed';
    c.results.push({ id: v.id, ...body });
    return [200, v];
  }
  return null;
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
  return memoryAnswer(state.memory, method, p, url, body) ?? chatAnswer(state.chat, method, p, url, body) ?? err(404, 'not_found');
}
