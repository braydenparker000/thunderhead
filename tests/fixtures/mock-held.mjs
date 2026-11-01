// Held conversations in the mocked Worker (backend conversation/held.ts): a conversation off the
// record started under the phone's id, its messages (the mind's answer lands in it when the chat
// mock has a reply), Delete (today's thread too, which empties today), Restore and Recently
// deleted. Synthetic data only; `changed(kind)` commits a change-feed row and its frame.

const DAY = 86_400_000;
const gone = [410, { error: { code: 'gone', message: 'gone', request_id: 't' } }];
let seq = 5000;

/** Answers the held routes, or null for anything else. `state` is mock-api's whole state. */
export function heldAnswer(state, method, p, body, changed) {
  const s = state.threads;
  const c = state.chat;
  s.deleted ??= [];
  const start = /^\/v1\/threads\/([^/]+)\/off-record$/.exec(p);
  if (method === 'PUT' && start) {
    const found = s.threads.find((t) => t.id === start[1]);
    if (found) return [200, found];
    const now = Date.now();
    const t = { id: start[1], day: '2026-10-29', kind: 'off_record', status: 'open', title: null, title_source: null, summary: null, continues: null, message_count: 0, started_at: now, updated_at: now, filed_at: null, purge_at: now + 7 * DAY };
    s.threads.push(t);
    s.messages[t.id] = [];
    changed('thread');
    return [201, t];
  }
  if (method === 'PUT' && p.startsWith('/v1/messages/') && body?.thread_id) {
    const t = s.threads.find((x) => x.id === body.thread_id && x.kind === 'off_record');
    if (!t) return gone;
    const id = p.split('/').pop();
    const list = s.messages[t.id];
    const had = list.find((m) => m.id === id);
    if (had) return [200, had];
    const add = (fields) => {
      const m = { seq: ++seq, thread_id: t.id, origin: fields.author === 'owner' ? 'owner_device' : 'mind', kind: 'text', meta: null, attachments: [], reply_to: null, created_at: Date.now(), delivered_at: null, acked_at: null, answered_at: null, ...fields };
      list.push(m);
      t.message_count = list.length;
      t.updated_at = m.created_at;
      t.purge_at = m.created_at + 7 * DAY;
      changed('message');
      return m;
    };
    const m = add({ id, author: 'owner', body: body.body });
    if (c.reply) setTimeout(() => { m.answered_at = Date.now(); add({ id: crypto.randomUUID(), author: 'mind', body: c.reply.text, reply_to: id }); }, c.reply.after);
    return [201, m];
  }
  if (method === 'GET' && p === '/v1/threads/deleted')
    return [200, { items: s.deleted.map(({ thread: t, deleted_at, purge_at }) => ({ id: t.id, day: t.day, kind: t.kind, title: t.title, summary: t.summary, message_count: t.message_count, deleted_at, purge_at })) }];
  const one = /^\/v1\/threads\/([^/]+)$/.exec(p);
  if (method === 'DELETE' && one) {
    const now = Date.now();
    const today = c.thread?.id === one[1];
    const t = today ? { ...c.thread, message_count: c.messages.length } : s.threads.find((x) => x.id === one[1]);
    if (!t) return gone;
    if (today) {
      s.deleted.unshift({ thread: t, messages: c.messages, deleted_at: now, purge_at: now + 30 * DAY });
      c.thread = null;
      c.messages = [];
    } else {
      s.threads = s.threads.filter((x) => x !== t);
      s.deleted.unshift({ thread: t, deleted_at: now, purge_at: now + 30 * DAY });
    }
    changed('thread');
    return [200, { id: t.id, purge_at: now + 30 * DAY }];
  }
  const back = /^\/v1\/threads\/([^/]+)\/restore$/.exec(p);
  if (method === 'POST' && back) {
    const d = s.deleted.find((x) => x.thread.id === back[1]);
    if (!d) return [404, { error: { code: 'not_found', message: 'no', request_id: 't' } }];
    s.deleted = s.deleted.filter((x) => x !== d);
    const kind = d.messages && c.thread ? 'restored' : d.thread.kind;
    s.threads.push({ ...d.thread, kind, status: 'filed' });
    if (d.messages) s.messages[d.thread.id] = d.messages;
    changed('thread');
    return [200, { id: d.thread.id, kind, beside: kind === 'restored' }];
  }
  return null;
}
