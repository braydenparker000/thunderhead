// The thread list, past threads' messages and search of the mocked Worker (API.md §11.7), for the
// menu's conversations and search: filed daily threads of yesterday, three days ago, last
// Saturday (summarised, its reply in Markdown) and 40 days ago, an imported old chat this week
// (long, so it pages back) and one from last year, and 35 more in the summer so the full list
// pages 30 at a time. All synthetic; days are counted from the
// mock's today (2026-10-29), and every hour is UTC.

const DAY = 86_400_000;
export const TODAY = '2026-10-29';
const at = (day, hm = '21:40') => Date.parse(`${day}T${hm}:00Z`);
const id = (n) => `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`;

const thread = (n, day, fields = {}) => ({
  id: id(n), day, kind: 'daily', status: 'filed', title: null, title_source: 'auto', summary: null, continues: null,
  message_count: 0, started_at: at(day, '08:00'), updated_at: at(day), filed_at: at(day) + DAY, ...fields,
});

/** The fixture ids by name, for the tests. */
export const T = {
  yesterday: id(101), monday: id(102), imported: id(103), september: id(104), lastYear: id(105), markup: id(106), saturday: id(107),
};

/** Last Saturday's reply, in the Markdown the old Chats wrote (and a tag that must stay text). */
export const PLAN = [
  '## Practice plan for the weekend',
  '- **Scales** first, ten minutes',
  '- Bars 9 to 12 at `84 bpm`, then up',
  '',
  '| Day | Minutes |',
  '|---|---|',
  '| Mon | 30 |',
  '| Wed | 45 |',
  '',
  'Tags stay <img src=x onerror="document.title=1"> text. The metronome: https://example.com/metronome',
].join('\n');

const msg = (thread, seq, author, body, created) => ({
  seq, id: `${thread.slice(0, 24)}${String(seq).padStart(12, '0')}`, thread_id: thread, author,
  origin: author === 'owner' ? 'owner_device' : author, kind: 'text', body, meta: null, attachments: [], reply_to: null,
  created_at: created, delivered_at: null, acked_at: null, answered_at: null,
});

/** A fresh synthetic list and messages. */
export function threadsState() {
  const threads = [
    thread(101, '2026-10-28', { title: 'A calm playlist for the evening', updated_at: at('2026-10-28', '21:40') }),
    thread(102, '2026-10-26'),
    thread(103, '2026-10-27', { kind: 'imported', title: 'Bars 9 to 12, slow then up to tempo', updated_at: at('2026-10-27', '18:05') }),
    thread(104, '2026-09-19', { title: 'Planning the garden beds' }),
    thread(105, '2025-12-03', { kind: 'imported', title: 'Notes on a long walk' }),
    thread(106, '2026-09-02', { title: '<img src=x onerror="document.title=1">Tags stay text' }),
    thread(107, '2026-10-24', { title: 'Weekend practice plan', summary: 'Scales first, then bars 9 to 12 at 84.', updated_at: at('2026-10-24', '10:15') }),
  ];
  for (let i = 0; i < 35; i++) {
    const d = new Date(Date.UTC(2026, 7, 31) - i * DAY).toISOString().slice(0, 10);
    threads.push(thread(200 + i, d, { title: `Summer day ${i + 1}` }));
  }
  /** @type {Record<string, object[]>} */
  const messages = {};
  let seq = 1000;
  const add = (t, author, body) => {
    const th = threads.find((x) => x.id === t);
    const list = (messages[t] ??= []);
    const m = msg(t, ++seq, author, body, th.started_at + list.length * 60_000);
    list.push(m);
    th.message_count = list.length;
    return m;
  };
  add(T.yesterday, 'owner', 'Put on something calm for the evening');
  add(T.yesterday, 'mind', 'It is in Music, under Evening.');
  add(T.yesterday, 'system', 'Yesterday is filed in the menu.');
  add(T.monday, 'owner', 'What was the tempo for the second piece?');
  add(T.monday, 'mind', 'You were at 84. Try 88 next.');
  // The imported old chat is long: its first page is the newest 200, the song is further back.
  add(T.imported, 'owner', 'Can you find the canción from the evening walk?');
  add(T.imported, 'mind', 'It was the third one on the list.');
  for (let i = 0; i < 228; i++) add(T.imported, i % 2 ? 'mind' : 'owner', i % 2 ? `Reply number ${i}` : `Practice note number ${i}`);
  add(T.september, 'owner', 'Which beds get the most sun?');
  add(T.saturday, 'owner', 'Plan my practice for the weekend');
  add(T.saturday, 'mind', PLAN);
  return { threads, messages };
}

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** GET /v1/threads, /v1/threads/:id, /v1/threads/:id/messages and /v1/search; null for anything
 * else. `open` is today's thread from the chat mock (listed first while it exists). */
export function threadsAnswer(s, method, p, url, open, facts = []) {
  if (method !== 'GET') return null;
  if (p === '/v1/threads') {
    const all = [...(open ? [{ ...open, updated_at: Date.now() }] : []), ...s.threads].sort((a, b) => b.updated_at - a.updated_at);
    const from = Number(url.searchParams.get('cursor') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const items = all.slice(from, from + limit);
    return [200, { items, next: from + limit < all.length ? String(from + limit) : null }];
  }
  const one = /^\/v1\/threads\/([^/]+)$/.exec(p);
  if (one && one[1] !== 'today') {
    const t = s.threads.find((x) => x.id === one[1]);
    return t ? [200, t] : [404, { error: { code: 'not_found', message: 'not_found', request_id: 't' } }];
  }
  const msgs = /^\/v1\/threads\/([^/]+)\/messages$/.exec(p);
  if (msgs) {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const before = url.searchParams.get('before_seq');
    const list = (s.messages[msgs[1]] ?? []).filter((m) => !before || m.seq < Number(before)).sort((a, b) => b.seq - a.seq);
    const items = list.slice(0, limit);
    return [200, { items, next: items.length === limit ? String(items.at(-1).seq) : null }];
  }
  if (p === '/v1/search') {
    const q = fold(url.searchParams.get('q') ?? '');
    const mark = (text) => {
      const i = fold(text).indexOf(q);
      return `${text.slice(0, i)}«${text.slice(i, i + q.length)}»${text.slice(i + q.length)}`;
    };
    const items = [];
    for (const list of Object.values(s.messages))
      for (const m of list) if (fold(m.body).includes(q)) items.push({ source: 'messages', ref: `msg:${m.id}`, snippet: mark(m.body), at: m.created_at, thread_id: m.thread_id, score: 0.016 });
    for (const f of facts) if (fold(f.text).includes(q)) items.push({ source: 'facts', ref: `fact:${f.id}`, snippet: mark(f.text), at: f.recorded_at, score: 0.016 });
    return [200, { items: items.slice(0, Number(url.searchParams.get('limit') ?? 20)) }];
  }
  return null;
}
