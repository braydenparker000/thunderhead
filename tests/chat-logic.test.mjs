// The conversation's logic without a browser (HOME.md §2, §4, §7): merging the outbox with the
// server, the reply slot over time, the voice line, the edge light, meta lines, a reply's lines
// and links, the pre-warm rule, and the live client's frames, back-off and close codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../frontend/th/chat/model.js';
import { BACKOFF_S, HEALTHY_MS, createLive } from '../frontend/th/chat/live.js';

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
  // A message still in the outbox waits for a reply only while it is sending.
  const local = (id, state) => ({ id, body: 'b', created_at: 0, state, tries: 0, author: 'owner', kind: 'text', local: true });
  assert.equal(m.waitingFor([local('l', 'sending')])?.id, 'l');
  assert.equal(m.waitingFor([local('f', 'failed')]), null);
  assert.equal(m.waitingFor([local('o', 'queued')]), null);
  assert.equal(m.waitingFor([owner, local('f', 'failed')])?.id, 'q', 'an unanswered one before it still waits');
});

test("the Worker's not-waking line, once in the thread, stands in for the voice line's row 3", () => {
  const line = msg({ id: 's', seq: 2, author: 'system', meta: { line: 'not_waking' } });
  assert.equal(m.noWakeShown([msg({}), line]), true);
  assert.equal(m.noWakeShown([msg({}), line, msg({ id: 'r', seq: 3, author: 'mind' })]), false);
  assert.equal(m.noWakeShown([msg({}), msg({ id: 's2', seq: 2, author: 'system', meta: { line: 'other' } })]), false);
  assert.deepEqual(m.voiceLine({ presence: presence('failed'), firstRun: false, homeLine: null, noWake: true }), ['Nothing needs you.', null]);
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
  assert.equal(e({ failedAt: 50 }), 'error', 'a message that did not send, for 60 s');
  assert.equal(e({ failedAt: 50, now: 60_100 }), 'calm');
  assert.equal(e({ failedAt: 50, offline: true, now: 60_100 }), 'offline');
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
  // A "– " straight after a full stop, question mark or colon starts a list line; a dash in prose doesn't.
  assert.deepEqual(m.lines('It is in Music, under Evening. – first track\n– then the rest').map((l) => l.list), [false, true, true]);
  assert.deepEqual(m.lines('Two options: – one – two').map((l) => [l.list, l.parts[0].text]), [[false, 'Two options:'], [true, 'one – two']]);
  assert.equal(m.lines('Wait – what? Fine.').length, 1);
  // A cited block is a numbered tap into Study; the same block keeps its number; a broken marker is text.
  const cited = m.lines('Patience [[book:0190c8a2-7d1e-7abc-8def-0123456789ab#p12.b3]]. Later [[book:0190c8a2-7d1e-7abc-8def-0123456789ab#p40.b1]][[book:0190c8a2-7d1e-7abc-8def-0123456789ab#p12.b3]]. [[book:nope]]');
  assert.deepEqual(cited[0].parts.filter((p) => p.cite).map((p) => [p.label, p.href]), [
    ['1', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=12&b=3'], ['2', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=40&b=1'], ['1', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=12&b=3'],
  ]);
  assert.equal(cited[0].parts[0].text, 'Patience');
  assert.equal(cited[0].parts.at(-1).text, '. [[book:nope]]');
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

test('live: one socket at a time, even while the ticket is on its way; accepted then dropped keeps backing off', async () => {
  const timers = [];
  const schedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const sockets = [];
  let calls = 0;
  let release = () => {};
  const live = createLive({
    connect: () => { calls++; return new Promise((r) => { release = () => { const s = fakeSocket(); sockets.push(s); r(s); }; }); },
    onFrame: () => {},
    schedule,
    cancel: () => {},
    random: () => 0.5,
  });
  live.start();
  live.wake();
  live.wake();
  assert.equal(calls, 1, 'no second ticket while the first is on its way');
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(sockets.length, 1);
  const hello = JSON.stringify({ t: 'hello', v: 1, seq: 1, min_client: 0 });
  const delays = [];
  for (let i = 0; i < 3; i++) {
    sockets.at(-1).onmessage({ data: hello });
    sockets.at(-1).onclose({ code: 1006 });
    const t = timers.at(-1);
    delays.push(t.ms / 1000);
    t.fn();
    release();
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(delays, [1, 2, 5], 'a hello alone does not reset the back-off');
  sockets.at(-1).onmessage({ data: hello });
  timers.at(-1).fn(); // up for HEALTHY_MS
  assert.equal(timers.at(-1).ms, HEALTHY_MS);
  sockets.at(-1).onclose({ code: 1006 });
  assert.equal(timers.at(-1).ms / 1000, 1, 'healthy for 30 s: the back-off starts over');
  assert.equal(calls, 4);
});

test('live: pings pause while the page is hidden and start again on wake', async () => {
  const timers = [];
  let hidden = false;
  let sock;
  const live = createLive({ connect: async () => (sock = fakeSocket()), onFrame: () => {}, schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancel: () => {}, hidden: () => hidden });
  live.start();
  await new Promise((r) => setImmediate(r));
  sock.onmessage({ data: JSON.stringify({ t: 'hello', v: 1, seq: 1, min_client: 0 }) });
  const ping = timers.find((t) => t.ms === 30_000);
  hidden = true;
  const n = timers.length;
  ping.fn();
  assert.deepEqual(sock.sent, [], 'no ping while hidden');
  assert.equal(timers.length, n, 'and none scheduled');
  hidden = false;
  live.wake();
  timers.at(-1).fn();
  assert.deepEqual(sock.sent, ['ping']);
});
