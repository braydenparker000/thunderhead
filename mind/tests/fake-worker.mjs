// A fake Worker (node:http, in-memory) implementing the mind-facing /v1 routes of docs/engineering/API.md
// closely enough to test `th` and the hooks: bearer auth or a "proxy-injected" role, per-role scopes,
// error envelopes, idempotent PUTs, live wait with leases, acknowledgement and requeue, Stop and day close.
// Synthetic data only. Test controls are plain methods on the returned object.
import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {extraRoutes} from './fake-routes.mjs';

// Deliberately short and fake: the repository's credential scan rejects anything token-length.
export const TOKENS = {chat: 'thm_fake_chat_token', night: 'thm_fake_night_token', reflex: 'thm_fake_reflex_token'};
const canon = v => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
export const hash = v => createHash('sha256').update(canon(v)).digest('hex');
export class HttpError extends Error { constructor(status, code, message = code, details = undefined) { super(message); this.status = status; this.code = code; this.details = details; } }

export function createFake(options = {}) {
  const o = {holdUnitMs: 1000, leaseMs: 90_000, ackMs: 120_000, injectRole: null, day: '2026-10-28', ...options};
  const today = {id: '0192f0c4-0000-7000-8000-000000000001', day: o.day, kind: 'daily', status: 'open', title: null, title_source: null};
  const s = {seq: 0, threads: [today], messages: [], wakes: [], lease: null, stop: null, dayClosed: null, events: [],
    notes: [], facts: [], openThreads: new Map(), proposals: new Map(), verbs: new Map(), orders: new Map(), ledger: [],
    files: new Map(), tainted: new Set(), statuses: [], fires: [], takes: [], requests: [], failures: [], batches: new Map(),
    dayNotes: new Map(), night: new Map(), surfaces: new Map(), pushes: new Map(), errors: []};
  let waiters = [];
  const notify = () => { const w = waiters; waiters = []; w.forEach(fn => fn()); };
  const now = () => Date.now();
  const leaseLive = () => s.lease && s.lease.until > now();

  function addLedger(actor, kind, what, ref = null, extra = {}) {
    const row = {seq: ++s.seq, id: randomUUID(), at: now(), actor, kind, what, why: 'synthetic test entry', ref, status: 'done', undoable: kind !== 'note', ...extra};
    s.ledger.push(row);
    return row;
  }

  /** Requeue handed-out messages not acknowledged within ackMs. */
  function tick() {
    for (const m of s.messages) {
      if (m.author === 'owner' && m.delivered_at && !m.acked_at && !m.answered_at && now() - m.delivered_at > o.ackMs) {
        m.delivered_at = null; m.delivered_to = null; m.requeues = (m.requeues || 0) + 1;
        if (!leaseLive()) s.fires.push({reason: 'requeue', message: m.id, at: now()});
      }
    }
  }

  const ctl = {
    state: s, options: o,
    addOwnerMessage(body, extra = {}) {
      const m = {seq: ++s.seq, id: randomUUID(), thread_id: today.id, author: 'owner', origin: 'owner_device', kind: 'text', body, meta: null,
        attachments: [], reply_to: null, created_at: now(), delivered_at: null, delivered_to: null, acked_at: null, answered_at: null, ...extra};
      s.messages.push(m);
      if (!leaseLive()) s.fires.push({reason: 'message', message: m.id, at: now()});
      notify();
      return m;
    },
    addEvent(type, ref) { s.events.push({seq: ++s.seq, type, ref, at: now()}); notify(); },
    tapStop() { s.stop = {seq: ++s.seq, at: now(), cleared: false}; notify(); },
    closeDay() { s.dayClosed = {seq: ++s.seq, at: now()}; notify(); },
    fireWake(task = 'chat', reason = 'message') { const w = {id: randomUUID(), task, reason, status: 'fired', fired_at: now()}; s.wakes.push(w); return w; },
    /** The next `times` requests matching method+path prefix fail with status/code; `after` = handle first, then fail (lost response). */
    failNext(method, prefix, status, code, times = 1, after = false) { s.failures.push({method, prefix, status, code, times, after}); },
    unanswered: () => s.messages.filter(m => m.author === 'owner' && !m.answered_at && m.thread_id === today.id).map(m => m.id),
    tick, notify, addLedger, now, leaseLive, today,
  };

  function auth(req) {
    const h = req.headers.authorization;
    if (h) {
      const role = Object.keys(TOKENS).find(r => `Bearer ${TOKENS[r]}` === h);
      if (!role) throw new HttpError(401, 'unauthorized');
      return role;
    }
    if (o.injectRole) return o.injectRole;
    throw new HttpError(401, 'unauthorized');
  }

  function renewLease(role, session) {
    if (role !== 'chat' || !session) return;
    if (!leaseLive() || s.lease.session === session) s.lease = {session, until: now() + o.leaseMs};
  }

  function buildCore(role) {
    const waiting = s.messages.filter(m => m.author === 'owner' && !m.answered_at);
    return [`## 1. Now\nRole: ${role}. Day ${o.day}. laws: pinned.`,
      `## 2. Waiting\n${waiting.map(m => `[${m.id}] ${m.body}`).join('\n') || 'Nothing waiting.'}`,
      '## 3. Standing rules\n(none)', '## 4. Open threads\n(none)', '## 5. Today so far\n(none)', '## 6. Yesterday\n(no day note)',
      '## 7. Pointer\nFull briefing: $TMPDIR/th/brief.md · Search: th recall "<q>"'].join('\n\n');
  }

  async function liveWait(ctx) {
    const after = Number(ctx.query.get('after')) || 0;
    const timeout = Math.min(25, Math.max(1, Number(ctx.query.get('timeout')) || 25));
    s.takes.push({after, timeout, session: ctx.session, at: now()});
    const deadline = now() + timeout * o.holdUnitMs;
    for (;;) {
      tick();
      const msgs = s.messages.filter(m => m.author === 'owner' && !m.answered_at && !m.acked_at &&
        (m.delivered_at === null || (m.delivered_to === ctx.session && m.seq > after)));
      const signals = [...(s.dayClosed ? ['day_closed'] : []), ...(s.stop && !s.stop.cleared && s.stop.seq > after ? ['stop'] : [])];
      if (s.seq > after || msgs.length || signals.length || now() >= deadline || ctl.closed) {
        for (const m of msgs) { m.delivered_at = now(); m.delivered_to = ctx.session; }
        return {seq: s.seq, changed: s.seq > after, kinds: msgs.length ? ['message'] : [], messages: msgs.slice(0, 20),
          events: s.events.filter(e => e.seq > after).map(({type, ref, at}) => ({type, ref, at})), signals};
      }
      await new Promise(resolve => { const t = setTimeout(resolve, Math.max(0, deadline - now())); t.unref(); waiters.push(() => { clearTimeout(t); resolve(); }); });
      renewLease(ctx.role, ctx.session);
    }
  }

  const routes = [
    ['GET', /^\/v1\/health$/, null, () => ({ok: true, version: {id: 'fake', tag: null}, min_client: 0, at: now()})],
    ['GET', /^\/v1\/live\/wait$/, ['chat', 'night', 'reflex'], liveWait],
    ['POST', /^\/v1\/mind\/brief$/, ['chat', 'night', 'reflex'], ({role, body, session}) => {
      if (body.role !== role) throw new HttpError(403, 'forbidden', 'role mismatch');
      if (!/^[0-9a-f]{64}$|^none$/.test(String(body.constitution_sha256))) throw new HttpError(422, 'validation', 'constitution_sha256');
      if (body.claim && role === 'chat' && leaseLive() && s.lease.session !== body.session_id) throw new HttpError(409, 'already_live');
      let wake = null;
      if (body.claim) {
        const open = s.wakes.find(w => w.task === role && w.status === 'fired');
        wake = open || {id: randomUUID(), task: role, reason: 'manual', status: 'fired'};
        if (!open) s.wakes.push(wake);
        s.claimedAt = now();
        Object.assign(wake, {status: 'claimed', session_id: body.session_id, claim_match: open ? 'loose' : 'manual', claimed_at: now()});
        if (role === 'chat') s.lease = {session: session || body.session_id, until: now() + o.leaseMs};
        for (const m of s.messages) if (m.author === 'owner' && !m.answered_at && !m.delivered_at) { m.delivered_at = now(); m.delivered_to = body.session_id; }
      }
      const core = o.coreOverride ?? buildCore(role);
      return {wake: wake && {id: wake.id, reason: wake.reason, claim_match: wake.claim_match}, day: o.day, seq: s.seq, core,
        full: o.fullOverride ?? `${core}\n\n## 8. Profile\n(no facts yet)`, night_done: Boolean(o.nightDone), tainted: s.tainted.has(body.session_id)};
    }],
    ['POST', /^\/v1\/mind\/status$/, ['chat', 'night', 'reflex'], ({body, session}) => {
      if (!['working', 'listening', 'stopping', 'limited'].includes(body.state)) throw new HttpError(422, 'validation');
      s.statuses.push({...body, session, at: now()});
      if (body.state === 'working') for (const m of s.messages) if (m.author === 'owner' && m.delivered_at && !m.acked_at) m.acked_at = now();
      return null;
    }],
    ['GET', /^\/v1\/mind\/pending$/, ['chat', 'night', 'reflex'], () => {
      const lastOwner = s.messages.filter(m => m.author === 'owner' && m.thread_id === today.id).at(-1);
      const since = lastOwner?.created_at ?? s.claimedAt ?? now();
      const claimed = s.wakes.filter(w => w.status === 'claimed').at(-1);
      const cutoff = o.lean ? 30 : claimed?.reason === 'prewarm' && !lastOwner ? 10 : 120;
      return {unanswered: ctl.unanswered(), stop: !!(s.stop && !s.stop.cleared), day_closed: !!s.dayClosed, limited: !!o.limited,
        idle_min: Math.floor((now() - since) / 60_000), idle_cutoff_min: cutoff, ...(o.pendingExtra || {})};
    }],
    ['PUT', /^\/v1\/messages\/([^/]+)$/, ['chat', 'night', 'reflex'], ({role, body, params, session}) => {
      if (role !== 'chat' && body.kind !== 'error') throw new HttpError(403, 'forbidden', 'this role may post only kind error');
      if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 16000) throw new HttpError(422, 'validation', 'body');
      if (body.kind && !['text', 'progress', 'card', 'question', 'error'].includes(body.kind)) throw new HttpError(422, 'validation', 'kind');
      const existing = s.messages.find(m => m.id === params[0]);
      if (existing) { if (existing.body_hash !== hash(body)) throw new HttpError(409, 'conflict'); return [200, existing]; }
      if (body.thread_id !== undefined && body.thread_id !== 'system') throw new HttpError(422, 'validation', 'thread_id is only system');
      if (body.thread_id === 'system' && role === 'chat') throw new HttpError(422, 'validation', 'only night and reflex');
      const thread = today;
      const m = {seq: ++s.seq, id: params[0], thread_id: thread.id, author: 'mind', origin: 'mind', kind: body.kind || 'text', body: body.body,
        meta: body.meta ?? null, attachments: body.attachments || [], reply_to: body.reply_to ?? null, created_at: now(), body_hash: hash(body), session};
      s.messages.push(m);
      for (const x of s.messages) {
        if (x.author !== 'owner' || role !== 'chat') continue;
        if (x.delivered_at && !x.acked_at) x.acked_at = now();
        const target = s.messages.find(y => y.id === m.reply_to);
        if (target && x.seq <= target.seq && !x.answered_at) x.answered_at = now();
      }
      if (s.stop && !s.stop.cleared && m.kind === 'text') ctl.clearStopAfterReply = true; // the reply clears the Stop
      notify();
      return [201, m];
    }],
    ['PATCH', /^\/v1\/messages\/([^/]+)$/, ['chat'], ({body, params}) => {
      const m = s.messages.find(x => x.id === params[0]);
      if (!m) throw new HttpError(404, 'not_found');
      if (m.author !== 'mind') throw new HttpError(403, 'forbidden', 'own posts only');
      if (body.body !== undefined) m.body = body.body;
      if (body.meta !== undefined) m.meta = body.meta;
      return m;
    }],
    ['GET', /^\/v1\/threads\/today$/, ['chat', 'night', 'reflex'], () => ({thread: today, messages: s.messages.filter(m => m.thread_id === today.id).slice(-50), seq: s.seq})],
    ['GET', /^\/v1\/threads\/([^/]+)\/messages$/, ['chat', 'night', 'reflex'], ({params, query}) => {
      if (!s.threads.some(t => t.id === params[0])) throw new HttpError(404, 'not_found');
      const before = Number(query.get('before_seq')) || Infinity;
      return {items: s.messages.filter(m => m.thread_id === params[0] && m.seq < before).slice(-(Number(query.get('limit')) || 50)), next: null};
    }],
    ['PATCH', /^\/v1\/threads\/([^/]+)$/, ['chat', 'night'], ({params, body}) => {
      const t = s.threads.find(x => x.id === params[0]);
      if (!t) throw new HttpError(404, 'not_found');
      if (t.title_source === 'owner') throw new HttpError(409, 'conflict', 'owner title');
      return Object.assign(t, {title: body.title ?? t.title, title_source: 'mind'});
    }],
    ...extraRoutes(ctl),
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const log = {method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: {...req.headers}, at: now()};
    s.requests.push(log);
    const send = (status, data, headers = {}) => {
      const stopHeader = s.stop && !s.stop.cleared ? {'TH-Stop': '1'} : {};
      res.writeHead(status, {'Content-Type': 'application/json', 'TH-Request-Id': `req-${s.requests.length}`, ...stopHeader, ...headers});
      res.end(data === null || status === 204 ? undefined : JSON.stringify(data));
      if (ctl.clearStopAfterReply) { ctl.clearStopAfterReply = false; s.stop.cleared = true; }
    };
    try {
      if (url.pathname.startsWith('/_files/')) {
        const f = s.files.get(url.pathname.slice(8));
        if (!f) return send(404, {error: {code: 'not_found'}});
        res.writeHead(200, {'Content-Type': f.type}); return res.end(f.bytes);
      }
      const failure = s.failures.find(f => f.times > 0 && f.method === req.method && url.pathname.startsWith(f.prefix));
      if (failure && !failure.after && failure.status === 200) { failure.times--; res.writeHead(200, {'Content-Type': 'text/plain'}); return res.end('not json'); }
      if (failure && !failure.after) { failure.times--; return send(failure.status, {error: {code: failure.code, message: 'injected', request_id: 'inj'}}); }
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw new HttpError(404, 'not_found', 'no such route');
      const [, re, roles, handler] = route;
      const role = roles ? auth(req) : null;
      if (roles && !roles.includes(role)) throw new HttpError(403, 'forbidden');
      const session = req.headers['th-session'] || '';
      tick(); // time passed before this request arrived: requeue first, then renew
      renewLease(role, session);
      const isJson = (req.headers['content-type'] || '').includes('json');
      let body = {};
      if (isJson && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad_request'); } }
      const result = await handler({req, role, session, body, raw, params: re.exec(url.pathname).slice(1), query: url.searchParams, base: `http://127.0.0.1:${server.address().port}`});
      if (failure && failure.after) { failure.times--; return send(failure.status, {error: {code: failure.code, message: 'injected after handling'}}); }
      const [status, data] = Array.isArray(result) ? result : [result === null ? 204 : 200, result];
      send(status, data);
    } catch (error) {
      if (error instanceof HttpError) return send(error.status, {error: {code: error.code, message: error.message, request_id: `req-${s.requests.length}`, details: error.details}});
      send(500, {error: {code: 'internal', message: String(error?.message || error)}});
    }
  });

  ctl.start = () => new Promise(resolve => server.listen(0, '127.0.0.1', () => { ctl.url = `http://127.0.0.1:${server.address().port}`; resolve(ctl); }));
  ctl.stop = () => new Promise(resolve => { ctl.closed = true; notify(); server.closeAllConnections?.(); server.close(() => resolve()); });
  return ctl;
}
