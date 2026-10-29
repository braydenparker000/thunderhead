// The conversation's logic without a browser (HOME.md §2, §4, §7): merging the outbox with the
// server, the reply slot over time, the voice line, the edge light, meta lines, a reply's lines
// and links, the pre-warm rule, and the live client's frames, back-off and close codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../frontend/th/chat/model.js';
import { BACKOFF_S, createLive } from '../frontend/th/chat/live.js';

const msg = (o) => ({ seq: 1, id: 'a', thread_id: 't', author: 'owner', origin: 'owner_device', kind: 'text', body: 'hi', meta: null, attachments: [], reply_to: null, created_at: 0, delivered_at: null, acked_at: null, answered_at: null, ...o });
const presence = (state) => ({ state, note: null, since: 0 });

test('merge keeps server order and adds outbox messages the server lacks, once', () => {
  const server = [msg({ seq: 2, id: 'b' }), msg({ seq: 1, id: 'a' })];
  const local = [{ id: 'b', body: 'dup', created_at: 5, state: 'sending', tries: 0 }, { id: 'c', body: 'new', created_at: 6, state: 'queued', tries: 0 }];
  assert.deepEqual(m.merge(server, local).map((x) => x.id), ['a', 'b', 'c']);
});

test('waiting: the newest owner message with no reply after it; progress and system lines do not answer', () => {
  const owner = msg({ id: 'q', seq: 1 });
  assert.equal(m.waitingFor([owner])?.id, 'q');
  assert.equal(m.waitingFor([owner, msg({ id: 'p', seq: 2, author: 'mind', kind: 'progress' })])?.id, 'q');
  assert.equal(m.waitingFor([owner, msg({ id: 's', seq: 2, author: 'system' })])?.id, 'q');
  assert.equal(m.waitingFor([owner, msg({ id: 'r', seq: 2, author: 'mind' })]), null);
  assert.equal(m.waitingFor([msg({ answered_at: 5 })]), null);
});

test('the reply slot: nothing, then …, Waking up… at 8 s, Still waking at 60 s; live sessions show …', () => {
  const at = (t, p = presence('asleep'), progress = false) => m.slot({ sentAt: 0, now: t, presence: p, progress });
  assert.equal(at(1000), 'none');
  assert.equal(at(1300), 'dots');
  assert.equal(at(8000), 'waking');
  assert.equal(at(60_000), 'waking_long');
  assert.equal(at(60_000, presence('working')), 'dots');
  assert.equal(at(100, presence('asleep'), true), 'dots');
  assert.equal(at(5000, presence('unconfigured')), 'unconnected');
  assert.equal(at(5000, presence('failed')), 'none');
});

test('the voice line: first run, the mind not waking, a home line, the default', () => {
  assert.deepEqual(m.voiceLine({ presence: null, firstRun: true, homeLine: null }), ["I'm here.", 'Ask me anything, any time.']);
  assert.deepEqual(m.voiceLine({ presence: presence('failed'), firstRun: true, homeLine: 'x' }), ["I can't wake just now.", "I'll answer when I'm back."]);
  assert.deepEqual(m.voiceLine({ presence: presence('asleep'), firstRun: false, homeLine: 'Your playlist is in Music.' }), ['Nothing needs you.', 'Your playlist is in Music.']);
  assert.deepEqual(m.voiceLine({ presence: null, firstRun: false, homeLine: null }), ['Nothing needs you.', null]);
  for (const [l1, l2] of [["I'm here.", 'Ask me anything, any time.'], ["I can't wake just now.", "I'll answer when I'm back."], ['Nothing needs you.', '']])
    assert.ok(l1.length <= 22 && l2.length <= 44 && !/!/.test(l1 + l2), 'HOME.md §2.2 limits');
});

test('the edge: thinking while waiting or working, error when the mind cannot wake, offline, calm', () => {
  const e = (o) => m.edge({ presence: null, waiting: false, typingUntil: 0, offline: false, now: 100, ...o });
  assert.equal(e({}), 'calm');
  assert.equal(e({ waiting: true }), 'think');
  assert.equal(e({ waiting: true, presence: presence('unconfigured') }), 'calm');
  assert.equal(e({ presence: { state: 'working', note: null, since: 0 } }), 'think');
  assert.equal(e({ presence: { state: 'working', note: null, since: 0 }, now: 31 * 60_000 }), 'calm', 'at most 30 min');
  assert.equal(e({ presence: presence('failed') }), 'error');
  assert.equal(e({ offline: true }), 'offline');
  assert.equal(e({ typingUntil: 200 }), 'think');
});

test('meta lines under unsent messages', () => {
  const local = (state, created_at = 0) => ({ id: 'x', body: 'b', created_at, state, tries: 0, author: 'owner', kind: 'text', local: true });
  assert.equal(m.meta(local('sending'), 1000), null);
  assert.equal(m.meta(local('sending'), 2000), 'Sending…');
  assert.equal(m.meta(local('queued'), 0), "Sends when you're back online");
  assert.equal(m.meta(local('failed'), 0), "Didn't send");
  assert.equal(m.meta(local('toolong'), 0), 'Too long to send');
  assert.equal(m.meta(msg({}), 99_999), null);
});

test("a reply's lines: breaks kept, hanging list lines, only https links, long links shortened", () => {
  const out = m.lines('Here:\n– one\n– two https://example.com/a\nhttp://not.a.link and https://example.com/a/very/long/path/that/keeps/going/on.');
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((l) => l.list), [false, true, true, false]);
  assert.deepEqual(out[2].parts[1], { href: 'https://example.com/a', label: 'example.com/a' });
  assert.equal(out[3].parts.filter((p) => 'href' in p).length, 1);
  assert.equal(out[3].parts[1].label, 'example.com…');
  assert.equal(out[3].parts[2].text, '.', 'trailing punctuation stays out of the link');
  assert.equal(m.revealMs('x'.repeat(80)), 500);
  assert.equal(m.revealMs('x'.repeat(5000)), 1200);
});

test('pre-warm: the first keystroke after 90 s quiet, then at most once a minute', () => {
  assert.equal(m.shouldPrewarm({ now: 100_000, lastKey: 0, lastSent: 0 }), true);
  assert.equal(m.shouldPrewarm({ now: 100_000, lastKey: 99_000, lastSent: 90_000 }), false);
  assert.equal(m.shouldPrewarm({ now: 160_000, lastKey: 159_000, lastSent: 100_000 }), true);
});

test('uuidv7: version 7, variant 10, time first', () => {
  const a = m.uuidv7(1_700_000_000_000);
  const b = m.uuidv7(1_700_000_000_001);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
});

/** A fake socket the test drives. */
function fakeSocket() {
  const s = { sent: [], closed: null, onmessage: null, onclose: null, onerror: null, send(d) { s.sent.push(d); }, close(code) { s.closed = code; } };
  return s;
}

test('live: hello opens; unknown frames are ignored; a drop backs off 1, 2, 5, 10, 30 s; 4401 stops', async () => {
  const timers = [];
  const schedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const sockets = [];
  const frames = [];
  const states = [];
  const live = createLive({
    connect: async () => { const s = fakeSocket(); sockets.push(s); return s; },
    onFrame: (f) => frames.push(f.t),
    onState: (s) => states.push(s),
    schedule,
    cancel: () => {},
    random: () => 0.5,
  });
  live.start();
  await new Promise((r) => setImmediate(r));
  sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', v: 1, seq: 3, min_client: 0 }) });
  sockets[0].onmessage({ data: JSON.stringify({ t: 'future_frame', x: 1 }) });
  sockets[0].onmessage({ data: 'not json' });
  sockets[0].onmessage({ data: JSON.stringify({ t: 'changed', seq: 4, kinds: ['message'] }) });
  assert.deepEqual(frames, ['hello', 'changed']);
  assert.equal(live.state, 'open');
  const backoff = [];
  for (let i = 0; i < 6; i++) {
    sockets.at(-1).onclose({ code: 1006 });
    const t = timers.at(-1);
    backoff.push(t.ms / 1000);
    t.fn();
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(backoff, [...BACKOFF_S, 30]);
  sockets.at(-1).onmessage({ data: JSON.stringify({ t: 'hello', v: 1, seq: 4, min_client: 0 }) });
  sockets.at(-1).onclose({ code: 4401 });
  assert.equal(live.state, 'signed_out');
  const n = sockets.length;
  live.wake();
  await new Promise((r) => setImmediate(r));
  assert.equal(sockets.length, n, 'signed out: no reconnect');
  assert.ok(states.includes('waiting'));
});

test('live: a refused ticket means signed out; 4426 means this build is too old', async () => {
  const refused = createLive({ connect: async () => { throw Object.assign(new Error('401'), { status: 401 }); }, onFrame: () => {}, schedule: () => 0, cancel: () => {} });
  refused.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(refused.state, 'signed_out');
  let sock;
  const old = createLive({ connect: async () => (sock = fakeSocket()), onFrame: () => {}, schedule: () => 0, cancel: () => {} });
  old.start();
  await new Promise((r) => setImmediate(r));
  sock.onclose({ code: 4426 });
  assert.equal(old.state, 'outdated');
});
