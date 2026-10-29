// The fake Worker's other mind-facing routes: notes, taint, files, search, memory, proposals, verbs,
// ledger, surfaces, pushes, work orders, night, ops. Shapes follow docs/engineering/API.md §11.
import {randomUUID, createHash} from 'node:crypto';
import {HttpError, hash} from './fake-worker.mjs';

const ALL = ['chat', 'night', 'reflex'];
const CN = ['chat', 'night'];
const EXECUTORS = ['verb', 'memory.forget', 'memory.apply_batch', 'agents.revoke', 'files.delete', 'ops.restore', 'music.delete_from_catalog'];
const ASK_FIRST_VERBS = ['music.delete_playlist', 'files.delete'];
const actorOf = role => `mind:${role}`;

/** @param {any} ctl the fake's control object */
export function extraRoutes(ctl) {
  const s = ctl.state;
  const idem = (map, id, body, make) => {
    const h = hash(body);
    if (map.has(id)) { const prev = map.get(id); if (prev.hash !== h) throw new HttpError(409, 'conflict'); return [200, prev.value]; }
    const value = make();
    map.set(id, {hash: h, value});
    return [201, value];
  };
  const refExists = ref => {
    const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    if (kind === 'msg') return s.messages.find(m => m.id === id) || null;
    if (kind === 'day') return {origin: 'worker'};
    return null;
  };
  const tainted = session => s.tainted.has(session);

  function validateAdd(op, i, session) {
    const ev = op.evidence || [];
    if (!ev.length || ev.length > 20 || ev.some(r => !refExists(r))) return {i, reason: 'bad_evidence'};
    if (op.source === 'user' && ev.some(r => refExists(r)?.origin !== 'owner_device')) return {i, reason: 'not_owner_evidence'};
    if (op.kind === 'rule' && op.source !== 'user') return {i, reason: 'rule_needs_owner'};
    if (String(op.text || '').length > 280) return {i, reason: 'too_long'};
    if (tainted(session)) return {i, reason: 'session_tainted'};
    return null;
  }

  return [
    ['POST', /^\/v1\/mind\/notes$/, ALL, ({body, session}) => {
      if (!body.id || typeof body.body !== 'string' || body.body.split(/\s+/).filter(Boolean).length > 120) throw new HttpError(422, 'validation');
      if (!s.notes.some(n => n.id === body.id)) s.notes.push({...body, session, at: ctl.now()});
      return [201, {id: body.id}];
    }],
    ['POST', /^\/v1\/mind\/taint$/, ALL, ({session}) => { s.tainted.add(session); return {tainted: true}; }],
    ['PUT', /^\/v1\/files\/([^/]+)$/, ['chat'], ({params, raw, req}) => {
      if (createHash('sha256').update(raw).digest('hex') !== req.headers['th-sha256']) throw new HttpError(422, 'validation', 'sha256 mismatch');
      s.files.set(params[0], {bytes: raw, type: req.headers['content-type'], name: decodeURIComponent(req.headers['th-file-name'] || '')});
      return [201, {ref: `file:${params[0]}`, bytes: raw.length, type: req.headers['content-type']}];
    }],
    ['POST', /^\/v1\/media\/sign$/, CN, ({body, base}) => {
      const refs = body.refs || [];
      return {items: refs.filter(r => s.files.has(r.slice(5))).map(ref => ({ref, url: `${base}/_files/${ref.slice(5)}`, expires_at: ctl.now() + 3_600_000})),
        errors: refs.filter(r => !s.files.has(r.slice(5))).map(ref => ({ref, code: 'not_found'}))};
    }],
    ['GET', /^\/v1\/search$/, CN, ({query}) => {
      const q = (query.get('q') || '').toLowerCase();
      const sources = (query.get('sources') || query.get('kind') || '').split(',').filter(Boolean);
      if (!q || q.length > 200) throw new HttpError(422, 'validation');
      if (sources.some(x => !['messages', 'facts', 'day_notes', 'library'].includes(x))) throw new HttpError(422, 'validation', 'unknown source');
      const want = x => !sources.length || sources.includes(x);
      const items = [];
      if (want('messages')) for (const m of s.messages) if (m.body.toLowerCase().includes(q)) items.push({source: 'messages', ref: `msg:${m.id}`, snippet: m.body.slice(0, 200), at: m.created_at, score: 1, thread_id: m.thread_id});
      if (want('facts')) for (const f of s.facts) if (!f.superseded_at && f.text.toLowerCase().includes(q)) items.push({source: 'facts', ref: `fact:${f.id}`, snippet: f.text, at: f.recorded_at, score: 2});
      return {items: items.slice(0, Number(query.get('limit')) || 20)};
    }],
    ['POST', /^\/v1\/memory\/ops$/, CN, ({body, role, session}) => {
      const ops = body.ops || [];
      if (!body.batch_id || !ops.length || ops.length > 50) throw new HttpError(422, 'validation');
      // API.md §11.13: each op is validated on its own; valid ops apply, rejected ones are listed;
      // all rejected → 422 (403 session_tainted when the reason is taint).
      const rejected = [];
      ops.forEach((op, i) => {
        let reason = null;
        if (op.op === 'add') reason = validateAdd(op, i, session)?.reason ?? null;
        else if (op.op === 'confirm' || op.op === 'supersede') {
          if (tainted(session)) reason = 'session_tainted';
          else if (!s.facts.some(f => f.id === op.id && !f.superseded_at)) reason = 'unknown_ref';
        } else reason = 'device_only';
        if (reason) rejected.push({i, reason});
      });
      if (rejected.length === ops.length) {
        if (rejected.every(r => r.reason === 'session_tainted')) throw new HttpError(403, 'session_tainted');
        throw new HttpError(422, 'validation', rejected.map(r => r.reason).join(','));
      }
      const valid = new Set(ops.map((_, i) => i).filter(i => !rejected.some(r => r.i === i)));
      return idem(s.batches, body.batch_id, body, () => {
        const applied = [], proposals = [];
        ops.forEach((op, i) => {
          if (!valid.has(i)) return;
          if (op.op === 'add') {
            if (op.source === 'inferred' && op.sensitivity === 1) { proposals.push({i, proposal_id: randomUUID()}); return; }
            s.facts.push({...op, op: undefined, recorded_at: ctl.now(), superseded_at: null});
            applied.push({i, fact_id: op.id, ledger_id: ctl.addLedger(actorOf(role), 'memory', `remember ${op.id}`).id});
          } else if (op.op === 'confirm') {
            const f = s.facts.find(x => x.id === op.id); f.last_confirmed = ctl.now();
            applied.push({i, fact_id: f.id, ledger_id: ctl.addLedger(actorOf(role), 'memory', `confirm ${f.id}`).id});
          } else {
            const old = s.facts.find(x => x.id === op.id);
            const fresh = {kind: old.kind, subject: old.subject, source: old.source, sensitivity: old.sensitivity, ...Object.fromEntries(Object.entries(op.new).filter(([, v]) => v !== undefined))};
            if (old.source === 'user' && fresh.source !== 'user') { proposals.push({i, proposal_id: randomUUID()}); return; }
            old.superseded_at = ctl.now(); old.superseded_by = fresh.id;
            s.facts.push({...fresh, recorded_at: ctl.now(), superseded_at: null});
            applied.push({i, fact_id: fresh.id, ledger_id: ctl.addLedger(actorOf(role), 'memory', `supersede ${old.id}`).id});
          }
        });
        return {applied, proposals, rejected};
      });
    }],
    ['GET', /^\/v1\/memory\/open-threads$/, CN, ({query}) => ({items: [...s.openThreads.values()].filter(t => query.get('status') === 'all' || t.status === 'open')})],
    ['PUT', /^\/v1\/memory\/open-threads\/([^/]+)$/, CN, ({params, body}) => {
      if (!body.text || !Array.isArray(body.evidence) || !body.evidence.length) throw new HttpError(422, 'validation');
      const row = {id: params[0], status: 'open', ...body};
      s.openThreads.set(params[0], row);
      return row;
    }],
    ['PATCH', /^\/v1\/memory\/open-threads\/([^/]+)$/, CN, ({params, body}) => {
      const row = s.openThreads.get(params[0]);
      if (!row) throw new HttpError(404, 'not_found');
      if (!['done', 'dropped'].includes(body.status) || (body.status === 'dropped' && !body.why)) throw new HttpError(422, 'validation');
      return Object.assign(row, {status: body.status, closed_why: body.why ?? null});
    }],
    ['PUT', /^\/v1\/memory\/day-notes\/([^/]+)$/, ['night'], ({params, body}) => {
      if (!body.summary || !(body.importance >= 1 && body.importance <= 10)) throw new HttpError(422, 'validation');
      const version = (s.dayNotes.get(params[0])?.version || 0) + 1;
      s.dayNotes.set(params[0], {...body, version});
      return {day: params[0], version};
    }],
    ['GET', /^\/v1\/mind\/day\/([^/]+)$/, ['night'], ({query}) => (query.get('part') === 'stats'
      ? {messages: s.messages.length, owner_messages: s.messages.filter(m => m.author === 'owner').length}
      : {items: query.get('part') === 'messages' ? s.messages : query.get('part') === 'ledger' ? s.ledger : s.notes, next: null})],
    ['POST', /^\/v1\/mind\/night$/, ['night'], ({body}) => {
      const run = s.night.get(body.day) || {step: 0, done: false};
      if (body.action === 'step_done') run.step = Math.max(run.step, body.step);
      if (body.action === 'done') run.done = true;
      s.night.set(body.day, run);
      return {resume_from: run.step + 1, done: run.done};
    }],
    ['PUT', /^\/v1\/proposals\/([^/]+)$/, ALL, ({params, body, role}) => {
      const ok = ['delete', 'money', 'access', 'reach_people', 'memory_big'].includes(body.class) && body.question?.length <= 80 &&
        body.why?.length <= 140 && body.if_ignored && Array.isArray(body.options) && body.options.length === 2 && EXECUTORS.includes(body.spec?.op);
      if (!ok) throw new HttpError(422, 'validation', 'card');
      if (!s.proposals.has(params[0]) && [...s.proposals.values()].filter(p => p.value.status === 'waiting').length >= 3) throw new HttpError(409, 'decision_budget');
      return idem(s.proposals, params[0], body, () => ({id: params[0], ...body, created_by: actorOf(role), created_at: ctl.now(), seq: ++s.seq, spec_hash: hash(body.spec), status: 'waiting'}));
    }],
    ['GET', /^\/v1\/proposals$/, ALL, ({query}) => ({items: [...s.proposals.values()].map(p => p.value)
      .filter(p => query.get('status') === 'all' || p.status === (query.get('status') || 'waiting')), next: null})],
    ['POST', /^\/v1\/proposals\/([^/]+)\/decide$/, ['chat'], ({params, body}) => {
      const p = s.proposals.get(params[0])?.value;
      if (!p) throw new HttpError(404, 'not_found');
      if (!body.by_message) throw new HttpError(422, 'validation', 'by_message is required from mind:chat');
      if (p.status !== 'waiting') throw new HttpError(409, 'already_decided');
      if (body.spec_hash !== p.spec_hash) throw new HttpError(409, 'spec_mismatch');
      const m = s.messages.find(x => x.id === body.by_message);
      const latest = m && s.messages.filter(x => x.thread_id === m.thread_id && x.author === 'owner').at(-1);
      if (!m || m.origin !== 'owner_device' || m.seq < p.seq || latest !== m) throw new HttpError(403, 'not_owner_words');
      Object.assign(p, {status: body.decision === 'reject' ? 'rejected' : 'approved', decided_via: 'words', decided_message_id: m.id});
      return {status: p.status, ledger_id: ctl.addLedger('owner', 'proposal', `decide ${p.id}`, `msg:${m.id}`, {proposal_id: p.id}).id};
    }],
    ['PUT', /^\/v1\/verbs\/([^/]+)$/, CN, ({params, body, role}) => {
      if (typeof body.why !== 'string' || body.why.length < 8 || body.why.length > 200) throw new HttpError(422, 'validation', 'why');
      if (ASK_FIRST_VERBS.includes(body.verb) && s.proposals.get(body.proposal_id)?.value.status !== 'approved') throw new HttpError(403, 'proposal_required');
      return idem(s.verbs, params[0], body, () => ({id: params[0], ...body, status: 'pending', ledger_id: ctl.addLedger(actorOf(role), 'verb', body.verb).id}));
    }],
    ['GET', /^\/v1\/ledger$/, ALL, ({query}) => {
      const since = Number(query.get('since')) || 0, kind = query.get('kind');
      return {items: [...s.ledger].reverse().filter(r => r.at >= since && (!kind || r.kind === kind)), next: null};
    }],
    ['POST', /^\/v1\/ledger\/([^/]+)\/undo$/, ['chat'], ({params}) => {
      const row = s.ledger.find(r => r.id === params[0]);
      if (!row) throw new HttpError(404, 'not_found');
      if (row.status === 'undone') throw new HttpError(409, 'already_undone');
      row.status = 'undone';
      return {undo_ledger_id: ctl.addLedger('mind:chat', 'undo', `undo ${row.id}`).id, status: 'undone'};
    }],
    ['PUT', /^\/v1\/surfaces\/([^/]+)\/([^/]+)$/, CN, ({params, body, role}) => {
      if (!body.why || body.why.length < 8 || !body.topic_key) throw new HttpError(422, 'validation');
      const row = {app: params[0], slot: params[1], ...body, written_at: ctl.now(), ledger_id: ctl.addLedger(actorOf(role), 'arrangement', `${params[0]}/${params[1]}`).id};
      s.surfaces.set(`${params[0]}/${params[1]}`, row);
      return row;
    }],
    ['GET', /^\/v1\/surfaces$/, ALL, () => ({items: [...s.surfaces.values()], seq: s.seq})],
    ['DELETE', /^\/v1\/surfaces\/([^/]+)\/([^/]+)$/, CN, ({params}) => {
      s.surfaces.delete(`${params[0]}/${params[1]}`);
      return null;
    }],
    ['PUT', /^\/v1\/pushes\/([^/]+)$/, ['chat'], ({params, body}) => {
      if (ctl.options.quietHours) throw new HttpError(409, 'quiet_hours');
      return idem(s.pushes, params[0], body, () => ({queued_until: ctl.now() + 60_000}));
    }],
    ['PUT', /^\/v1\/work\/orders\/([^/]+)$/, CN, ({params, body}) => {
      if (body.assignee !== 'muse' || !body.kind || !body.title || body.title.length > 80 || !body.spec || !body.schema ||
        typeof body.personal !== 'boolean' || !Number.isFinite(body.deadline_at)) throw new HttpError(422, 'validation');
      if (body.personal && s.proposals.get(body.approval_id)?.value.status !== 'approved') throw new HttpError(403, 'needs_approval');
      return idem(s.orders, params[0], body, () => ({id: params[0], ...body, status: 'queued'}));
    }],
    ['GET', /^\/v1\/work\/orders$/, ALL, () => ({items: [...s.orders.values()].map(o => o.value), next: null})],
    ['GET', /^\/v1\/work\/orders\/([^/]+)$/, ALL, ({params}) => {
      const o = s.orders.get(params[0])?.value;
      if (!o) throw new HttpError(404, 'not_found');
      return o;
    }],
    ['POST', /^\/v1\/work\/orders\/([^/]+)\/cancel$/, CN, ({params, body}) => {
      if (!body.why || body.why.length < 8) throw new HttpError(422, 'validation');
      const o = s.orders.get(params[0])?.value;
      if (!o) throw new HttpError(404, 'not_found');
      o.status = 'cancelled';
      return {status: 'cancelled'};
    }],
    ['GET', /^\/v1\/ops\/health\/deep$/, ALL, () => ({ok: true, version: {id: 'fake', tag: null}, errors_open: s.errors.length, wakes_today: s.wakes.length})],
    ['GET', /^\/v1\/ops\/errors$/, ALL, ({query}) => ({items: s.errors.filter(e => (e.last_at ?? e.at) >= (Number(query.get('since')) || 0)), next: null})],
  ];
}
