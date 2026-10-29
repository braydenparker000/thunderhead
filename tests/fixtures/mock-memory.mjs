// The memory routes of the mocked Worker (API.md §11.13), for the Memory page's browser tests:
// facts with versions and evidence, the profile, ops, open threads and day notes, all synthetic.
// `state.memory = null` answers 404 like a Worker from before memory.

const DAY = 86_400_000;

/** One synthetic fact with every field of the wire shape. */
const fact = (id, fields, now = Date.now()) => ({
  id, kind: 'preference', about: 'owner', subject: null, text: '', tags: [], source: 'user', confidence: 0.95, confidence_now: 0.95,
  evidence: [`msg:${id}-m`], valid_from: null, valid_to: null, recorded_at: now - 20 * DAY, superseded_at: null, superseded_by: null,
  last_confirmed: now - 2 * DAY, sensitivity: 0, pinned: false, may_raise: true, written_by: 'owner', ledger_id: null, ...fields,
});

/** A synthetic memory: a few facts in different kinds and states, one rule, one loose end, one day. */
export function memoryState(now = Date.now(), over = {}) {
  const f = (id, fields) => fact(id, fields, now);
  return {
    facts: [
      f('0192f0c4-0000-7000-8000-000000000001', { kind: 'preference', text: 'Likes calm music in the evening', confidence_now: 0.86 }),
      f('0192f0c4-0000-7000-8000-000000000002', { kind: 'goal', text: 'Wants the second piece at 100 bpm', pinned: true, confidence_now: 1 }),
      f('0192f0c4-0000-7000-8000-000000000003', { kind: 'routine', text: 'Practises after lunch', source: 'inferred', confidence: 0.5, confidence_now: 0.46 }),
      f('0192f0c4-0000-7000-8000-000000000004', { kind: 'rule', text: 'Keep answers short on the phone' }),
      f('0192f0c4-0000-7000-8000-000000000005', { kind: 'routine', text: 'Prays every morning', tags: ['faith'], may_raise: false, sensitivity: 1 }),
      f('0192f0c4-0000-7000-8000-000000000006', { kind: 'state', text: 'Was tired last month', confidence_now: 0.04 }),
      f('0192f0c4-0000-7000-8000-000000000007', { kind: 'fact', text: 'Has a herb garden on the balcony', source: 'inferred', tags: ['imported'], confidence: 0.6, confidence_now: 0.58 }),
      f('0192f0c4-0000-7000-8000-000000000008', { kind: 'telepathy', text: 'A kind from a later build', source: 'dreamed', confidence_now: 0.7 }),
    ],
    threads: [{ id: '0192f0c4-0000-7000-8000-0000000000t1', text: 'Fix the metronome bug', owner: 'mind', due_at: now + DAY, tags: ['agreed'], status: 'open', evidence: ['msg:x'], opened_at: now - DAY, last_progress_at: null, closed_at: null, closed_why: null }],
    days: [{ day: '2026-10-28', summary: 'A calm day of practice and one bug report.', decisions: ['Fix the metronome first'], stats: { messages: 12 }, importance: 4, written_by: 'cse_night', version: 1, written_at: now - DAY }],
    profile: '[f:00000002] Wants the second piece at 100 bpm (1.0, u, since 2026-10)\n[f:00000001] Likes calm music in the evening (0.9, u, since 2026-10)',
    ops: [],
    ...over,
  };
}

const err = (status, code, details) => [status, { error: { code, message: code, request_id: 'test', ...(details ? { details } : {}) } }];

/** Answers a memory route, or null when the path isn't one. */
export function memoryAnswer(m, method, p, url, body) {
  if (!p.startsWith('/v1/memory/')) return null;
  if (!m) return err(404, 'not_found');
  const k = `${method} ${p}`;
  if (k === 'GET /v1/memory/facts') return [200, { items: m.facts.filter((f) => f.superseded_at === null), next: null }];
  const one = /^\/v1\/memory\/facts\/([^/]+)$/.exec(p);
  if (method === 'GET' && one) {
    const f = m.facts.find((x) => x.id === one[1]);
    if (!f) return err(404, 'not_found');
    const history = m.facts.filter((x) => x.superseded_by === f.id);
    const evidence = f.evidence.map((ref) => ({ ref, kind: ref.split(':')[0], at: f.recorded_at, who: 'owner', text: ref.startsWith('msg:') ? `I said: ${f.text.toLowerCase()}.` : null }));
    return [200, { fact: f, history, evidence, why: f.kind === 'routine' ? 'you mentioned it twice last week' : null }];
  }
  if (k === 'GET /v1/memory/profile') return [200, { text: m.profile, fact_ids: [], rendered_at: Date.now() }];
  if (k === 'POST /v1/memory/ops') {
    const o = body.ops[0];
    // The Worker's never-stored check (API.md §11.13), here only for a card-shaped number.
    if (/\b\d{4} \d{4} \d{4} \d{4}\b/.test(o.text ?? o.new?.text ?? '')) return err(422, 'validation', [{ path: 'ops.0', issue: 'never_stored' }]);
    m.ops.push(...body.ops);
    const f = m.facts.find((x) => x.id === o.id);
    if (o.op === 'add') m.facts.push(fact(o.id, { kind: o.kind, text: o.text, evidence: ['ledger:l1'], recorded_at: Date.now() }));
    else if (!f) return err(422, 'validation', [{ path: 'ops.0', issue: 'unknown_ref' }]);
    else if (o.op === 'forget') m.facts = m.facts.filter((x) => x.id !== o.id);
    else if (o.op === 'pin') f.pinned = o.pinned;
    else if (o.op === 'may_raise') f.may_raise = o.value;
    else if (o.op === 'confirm') Object.assign(f, { source: 'user', tags: f.tags.filter((t) => t !== 'imported'), confidence_now: 0.95 });
    else if (o.op === 'supersede') {
      f.superseded_at = Date.now();
      f.superseded_by = o.new.id;
      m.facts.push({ ...f, id: o.new.id, text: o.new.text, superseded_at: null, superseded_by: null, source: 'user' });
    }
    return [200, { applied: [{ i: 0, fact_id: o.new?.id ?? o.id, ledger_id: 'l1' }], proposals: [], rejected: [] }];
  }
  if (method === 'GET' && p === '/v1/memory/open-threads') return [200, { items: m.threads.filter((t) => t.status === 'open') }];
  const thread = /^\/v1\/memory\/open-threads\/([^/]+)$/.exec(p);
  if (thread && method === 'PUT') {
    const t = { id: thread[1], ...body, due_at: body.due_at ?? null, tags: [], status: 'open', opened_at: Date.now(), last_progress_at: null, closed_at: null, closed_why: null };
    m.threads.push(t);
    return [200, t];
  }
  if (thread && method === 'PATCH') {
    const t = m.threads.find((x) => x.id === thread[1]);
    if (!t) return err(404, 'not_found');
    Object.assign(t, { status: body.status, closed_why: body.why ?? null, closed_at: Date.now() });
    return [200, t];
  }
  if (k === 'GET /v1/memory/day-notes') return [200, { items: m.days }];
  const day = /^\/v1\/memory\/day-notes\/([^/]+)$/.exec(p);
  if (day && method === 'PUT') {
    const d = m.days.find((x) => x.day === day[1]);
    Object.assign(d, { summary: body.summary, version: d.version + 1, written_by: 'owner' });
    return [200, d];
  }
  return err(404, 'not_found');
}
