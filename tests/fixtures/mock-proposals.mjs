// The proposals routes of the mocked Worker (API.md §11.10), for home's decision card: the waiting
// cards and the decide route (approve, reject, snooze), with a way to fail the next decisions and
// to add a card while the page is open (it reaches the page as a `proposal` change). Synthetic.

const DAY = 86_400_000;
let n = 0;

/** One synthetic card with every field of the wire shape. */
export function proposal(fields = {}, now = Date.now()) {
  n++;
  return {
    id: `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`,
    created_at: now - 60_000,
    created_by: 'mind:night',
    class: 'delete',
    question: 'Delete the 3 empty playlists?',
    why: 'They have had no songs since import.',
    if_ignored: 'Nothing happens; they stay.',
    odds: null,
    options: ['Delete', 'Keep them'],
    safe: 'reject',
    target: null,
    spec: { v: 1, op: 'memory.forget', args: { id: 'x' } },
    spec_hash: 'a'.repeat(64),
    status: 'waiting',
    expires_at: now + 7 * DAY,
    show_from: now - 60_000,
    snoozes: 0,
    decided_at: null,
    decided_via: null,
    decided_message_id: null,
    result: null,
    ...fields,
  };
}

export const proposalsState = (items = []) => ({ items, decided: [], failDecide: 0 });

const err = (status, code) => [status, { error: { code, message: code, request_id: 'test' } }];

/** @param {{ items: any[], decided: any[], failDecide: number }} s */
export function proposalsAnswer(s, method, p, url, body, changed) {
  if (!p.startsWith('/v1/proposals')) return null;
  if (method === 'GET' && p === '/v1/proposals') {
    const items = s.items.filter((x) => url.searchParams.get('status') === 'all' || x.status === 'waiting');
    return [200, { items, next: null }];
  }
  const m = /^\/v1\/proposals\/([^/]+)\/decide$/.exec(p);
  if (method === 'POST' && m) {
    s.decided.push({ id: m[1], ...body });
    if (s.failDecide > 0) {
      s.failDecide--;
      return err(503, 'unavailable');
    }
    const x = s.items.find((i) => i.id === m[1]);
    if (!x) return err(404, 'not_found');
    if (x.status !== 'waiting') return err(409, 'already_decided');
    if (body.spec_hash !== x.spec_hash) return err(409, 'spec_mismatch');
    if (body.decision === 'snooze') {
      x.snoozes++;
      x.show_from = Date.now() + DAY;
    } else x.status = body.decision === 'approve' ? 'executed' : 'rejected';
    changed('proposal');
    return [200, { status: x.status, ledger_id: '0192f0c4-0000-7000-8000-0000000000ff' }];
  }
  return null;
}
