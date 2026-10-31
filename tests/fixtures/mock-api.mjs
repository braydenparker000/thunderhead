// A stand-in for the Worker inside Playwright (route interception): the /v1/auth routes, so the
// sign-in pages and Settings can be driven end to end, and the conversation's routes with a live
// socket (page.routeWebSocket), so home's chat can be too. No network; synthetic data only.
import { briefingAnswer, briefingState } from './mock-briefing.mjs';
import { EXPORT_ID, exportAnswer, exportState, ZIP_BYTES } from './mock-export.mjs';
import { memoryAnswer, memoryState } from './mock-memory.mjs';
import { proposalsAnswer, proposalsState } from './mock-proposals.mjs';
import { threadsAnswer, threadsState } from './mock-threads.mjs';

export const API = 'https://api.th.test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, TH-Client, TH-File-Name, TH-Sha256, TH-Seconds',
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
  state.export = 'export' in overrides ? overrides.export : exportState();
  state.briefing = 'briefing' in overrides ? overrides.briefing : briefingState();
  state.proposals = proposalsState(overrides.proposals);
  state.threads = overrides.threads ?? threadsState();
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
    // Chat files (the + sheet): bytes in, bytes out, kept by id like the Worker's.
    const fileId = /^\/v1\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (fileId && req.method() === 'PUT') {
      const h = req.headers();
      const bytes = req.postDataBuffer() ?? Buffer.alloc(0);
      const f = { ref: `file:${fileId}`, name: decodeURIComponent(h['th-file-name'] ?? 'file'), type: h['content-type'], bytes: bytes.length, ...(h['th-seconds'] ? { seconds: Number(h['th-seconds']) } : {}) };
      c.files[fileId] = { ...f, body: bytes, sha256: h['th-sha256'] };
      calls.at(-1).file = c.files[fileId];
      return route.fulfill({ status: 201, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(f) });
    }
    if (fileId && req.method() === 'GET') {
      const f = c.files[fileId];
      if (!f) return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 'not_found', message: 'no', request_id: 't' } }) });
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body: f.body });
    }
    if (req.method() === 'GET' && url.pathname === `/v1/export/${EXPORT_ID}/zip` && state.export?.started)
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/zip' }, body: Buffer.from(ZIP_BYTES) });
    const [status, json] = answer(state, req.method(), url, body);
    if (c.slow[url.pathname]) await new Promise((r) => setTimeout(r, c.slow[url.pathname]));
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: json === null ? '' : JSON.stringify(json) });
  });
  const proposals = {
    /** A card arrives while the page is open (a `proposal` change). */
    add: (p) => { state.proposals.items.push(p); changed(state.chat, 'proposal'); },
    get state() { return state.proposals; },
  };
  return { state, calls, chat: chatControls(state.chat), proposals };
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
    /** The owner's "go quiet" end (the setting `quiet.until`), or 0. */
    quietUntil: o.quietUntil ?? 0,
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
    /** Chat files by id: `{ ref, name, type, bytes, seconds?, body, sha256 }`. */
    files: { ...o.files },
    /** Reminders by id; `shiftTo` moves every new one's delivery there (quiet hours). */
    reminders: {},
    shiftTo: o.shiftTo ?? 0,
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
    system: (text, meta = null) => message(c, { id: crypto.randomUUID(), author: 'system', origin: 'system', body: text, meta }),
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
    const attachments = (body.attachments ?? []).map((ref) => {
      const { body: _b, sha256: _s, ...a } = c.files[ref.replace(/^file:/, '')];
      return a;
    });
    const m = message(c, { id, author: 'owner', body: body.body, attachments });
    if (c.reply) setTimeout(() => { m.answered_at = Date.now(); message(c, { id: crypto.randomUUID(), author: 'mind', body: c.reply.text, meta: c.reply.meta ?? null, reply_to: id }); }, c.reply.after);
    return [201, m];
  }
  if (k === 'GET /v1/changes') {
    const after = Number(url.searchParams.get('after')) || 0;
    if (after > c.seq) return [410, { error: { code: 'resync_required', message: 'resync', request_id: 't' } }];
    const items = c.changes.filter((x) => x.seq > after);
    return [200, { items, next_after: items.at(-1)?.seq ?? after, more: false }];
  }
  if (method === 'PUT' && p.startsWith('/v1/reminders/')) {
    const id = p.split('/').pop();
    const r = (c.reminders[id] ??= { id, text: body.text, at: body.at, fire_at: c.shiftTo || body.at, state: 'set', origin: 'owner_device', created_at: Date.now(), fired_at: null, message_id: null });
    return [201, { reminder: r }];
  }
  if (method === 'DELETE' && p.startsWith('/v1/reminders/')) {
    const r = c.reminders[p.split('/').pop()];
    if (!r) return [404, { error: { code: 'not_found', message: 'no', request_id: 't' } }];
    r.state = 'cancelled';
    return [200, { reminder: r }];
  }
  if (k === 'POST /v1/live/ticket') return [200, { ticket: `thw_${'0'.repeat(22)}`, expires_at: Date.now() + 30_000 }];
  const settings = () => ({ 'owner.tz': 'UTC', min_client: 0, 'mind.status': c.presence, ...(c.stop ? { 'mind.stop': c.stop } : {}), ...(c.quietUntil ? { 'quiet.until': c.quietUntil } : {}) });
  if (k === 'GET /v1/settings') return [200, settings()];
  if (k === 'PATCH /v1/settings' && body && 'quiet.until' in body) { c.quietUntil = body['quiet.until']; changed(c, 'setting'); return [200, settings()]; }
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

/** The meter (GET /v1/insight, P9): a month of synthetic counts. */
const skill = (category, resolved, s) => ({ category, open: 1, resolved, brier: 0.2, brier_base: 0.25, skill: s, bins: [] });
const INSIGHT = {
  corrections: [{ fixed: 0, learned: 3 }, { fixed: 1, learned: 5 }, { fixed: 0, learned: 2 }, { fixed: 1, learned: 2 }],
  memory: [{ passed: 35, n: 40, at: Date.UTC(2026, 10, 1, 9) }, { passed: 34, n: 40, at: Date.UTC(2026, 9, 25, 9) }],
  arrangements: { kept: 4, undone: 1, ignored: 5, waiting: 2 },
  skill: [skill('chat.any', 34, 0.23), skill('chat.before', 12, null), skill('app.open', 31, -0.05), skill('chat.count', 0, null)],
};

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
  if (method === 'PUT' && p.startsWith('/v1/senses/batches/')) return [200, { accepted: body.events.length, rejected: [] }];
  if (k === 'GET /v1/insight') return [200, state.insight ?? INSIGHT];
  return (
    proposalsAnswer(state.proposals, method, p, url, body, (kind) => changed(state.chat, kind)) ??
    memoryAnswer(state.memory, method, p, url, body) ??
    exportAnswer(state.export, method, p, body) ??
    briefingAnswer(state.briefing, method, p, body) ??
    chatAnswer(state.chat, method, p, url, body) ??
    threadsAnswer(state.threads, method, p, url, state.chat.thread, state.memory?.facts) ??
    err(404, 'not_found')
  );
}
