// Muse's work orders for the mocked Worker (tests/fixtures/mock-api.mjs): the menu's Tasks read
// GET /v1/work/orders and an order's progress lines (GET /v1/work/thread?order=), and the owner
// cancels one; an "@muse" message (`mention: 'muse'`, mock-api.mjs) adds an order here. Synthetic
// data only, the Worker's shapes (shared/contract/work.ts).

/** An order as the Worker sends it; `over` sets any field. */
export function order(over = {}) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    kind: 'muse.request',
    assignee: 'muse',
    title: 'grab me three indie catalogs',
    spec: { v: 1, words: 'grab me three indie catalogs', app: 'music' },
    schema: {},
    status: 'queued',
    state: 'asked',
    attempts: 0,
    deadline_at: now + 7 * 86_400_000,
    created_by: 'owner',
    created_at: now - 60_000,
    claimed_at: null,
    heartbeat_at: null,
    heartbeat_note: null,
    result: null,
    result_valid: null,
    result_errors: null,
    finished_at: null,
    message_id: null,
    origin: 'muse',
    ...over,
  };
}

/** `o.orders`: the orders; `o.notes`: progress lines by order id. */
export function workState(o = {}) {
  return { orders: o.orders ?? [], notes: o.notes ?? {} };
}

const err = (status, code) => [status, { error: { code, message: code, request_id: 't' } }];

export function workAnswer(s, method, p, url, body, changed) {
  if (!s) return null;
  if (method === 'GET' && p === '/v1/work/orders') {
    const items = [...s.orders].sort((a, b) => b.created_at - a.created_at).slice(0, Number(url.searchParams.get('limit')) || 30);
    return [200, { items, next: null }];
  }
  if (method === 'GET' && p === '/v1/work/thread') {
    const id = url.searchParams.get('order');
    return [200, { items: id ? s.notes[id] ?? [] : [], next: null }];
  }
  const cancel = /^\/v1\/work\/orders\/([^/]+)\/cancel$/.exec(p);
  if (method === 'POST' && cancel) {
    const o = s.orders.find((x) => x.id === cancel[1]);
    if (!o) return err(404, 'not_found');
    if (!['queued', 'claimed'].includes(o.status) || !body?.why || body.why.length < 8) return err(409, 'conflict');
    Object.assign(o, { status: 'cancelled', state: 'cancelled', finished_at: Date.now() });
    changed('work');
    return [200, { status: 'cancelled' }];
  }
  return null;
}
