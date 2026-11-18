// A link slower than the film (frontend/astra/src/engine/rebuffer.js). The browser plays on as soon as anything is
// buffered, so such a link stalled every few seconds (a 27.8 Mbit/s film at 20 Mbit/s: 7 to 9 times a minute, about
// 2 s each; scripts/astra/real.mjs, 2026-11-18). After a stall the engine now holds the picture back until enough of
// the film is read to play a good while. The rule's numbers here, and a session's stall played through with a stand-in
// element and buffer: the picture's fragments wait while the film is held and all go to the buffer when it is ready.
// (The test films are too small to stall: describing one reads all of it. The big films are measured by
// scripts/astra/real.mjs; frontend/astra/README.md, How smoothly.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyTarget, LinkRate, Rebuffer, REBUFFER } from '../frontend/astra/src/engine/rebuffer.js';
import { AppendQueue } from '../frontend/astra/src/engine/mse.js';

test('seconds of film ready before playing on: none on a link as fast as the film, more the further it falls short, capped', () => {
  const film = 3.47e6; // 27.8 Mbit/s
  assert.equal(readyTarget(film, film), 0, 'as fast as the film: plays on as before');
  assert.equal(readyTarget(film, 4e6), 0);
  assert.equal(readyTarget(film, 0), 0, 'the link not measured yet: as before');
  const at20 = readyTarget(film, 2.5e6, 0, 14.5), again = readyTarget(film, 2.5e6, 1, 14.5);
  assert.ok(at20 >= REBUFFER.least && at20 < 7, `20 Mbit/s, first stall: about ${at20} s`);
  assert.ok(again > at20 && again * film / 2.5e6 <= REBUFFER.wait + 0.1, `stalls again soon: more (${again} s), a wait of at most ${REBUFFER.wait} s`);
  assert.ok(readyTarget(film, 1e6, 3, 14.5) * film / 1e6 <= REBUFFER.wait + 0.1, '8 Mbit/s: the wait is capped');
  assert.ok(readyTarget(film, 2.5e6, 3, 6) <= 4, 'never more than the pipelines read ahead');
  assert.equal(readyTarget(film, 0.1e6, 0, 14.5), 0, 'a link so slow that the cap leaves under a second: as before');
});

test("the link's speed counts only while a download runs", () => {
  const link = new LinkRate(), source = { streams: new Set([{ paused: false }]), bytesFetched: 0 };
  for (let t = 0; t <= 3000; t += 250) { source.bytesFetched = t * 1000; link.sample(source, t); } // 1 MB a second
  assert.equal(Math.round(link.rate()), 1e6);
  [...source.streams][0].paused = true;
  for (let t = 3250; t <= 6000; t += 250) link.sample(source, t); // paused: nothing arrives, and it does not count
  assert.equal(Math.round(link.rate()), 1e6);
});

/** A stand-in SourceBuffer: what is appended is counted, and each operation ends at once. */
class Buffer extends EventTarget {
  constructor() { super(); this.appended = 0; this.updating = false; this.buffered = { length: 0 }; }
  appendBuffer(bytes) { this.appended += bytes.byteLength; queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); }
  remove() { queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); }
  abort() {}
}

test('a stall on a slow link holds the picture until enough is read, then lets all of it go; a fast link is never held', async () => {
  const run = (linkRate) => {
    const video = Object.assign(new EventTarget(), { currentTime: 30, paused: false, seeking: false });
    const sound = Object.assign(new Buffer(), { buffered: { length: 1, start: () => 0, end: () => 60 } }); // the sound is well ahead
    const session = { video, destroyed: false, offset: 0, advance: 0, ended: { video: false, audio: false }, readAt: { video: 30.5, audio: 33 }, events: [], emit(type, detail) { this.events.push(detail); },
      source: { byteRate: 3.47e6, bytesFetched: 0, streams: new Set() }, queues: { video: new AppendQueue(new Buffer(), video), audio: new AppendQueue(sound, video) } };
    const r = new Rebuffer(session, () => 14.5);
    clearInterval(r.timer); // ticked by hand
    r.link.spans = [[4000, linkRate * 4]]; // measured over 4 s of download
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('waiting'));
    return { r, session, queue: session.queues.video };
  };
  const fast = run(4e6);
  assert.equal(fast.r.holding, null, 'faster than the film: plays on as before');
  fast.r.stop();

  const { r, session, queue } = run(2.5e6); // 20 Mbit/s against 27.8
  assert.ok(r.holding && queue.held && session.queues.audio.held, 'picture and sound held');
  assert.ok(r.holding.need >= REBUFFER.least && r.holding.left > 2, JSON.stringify(r.holding));
  const need = r.holding.need;
  for (let i = 0; i < 6; i++) queue.append(new Uint8Array(1000), queue.generation, 30 + i * (need - 0.5) / 5); // fragments go on arriving
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(queue.buffer.appended, 0, 'none reach the buffer while held');
  r.tick();
  assert.ok(queue.held, 'not yet: the last fragment begins half a second short of the need');
  queue.append(new Uint8Array(1000), queue.generation, 30 + need);
  r.tick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(!r.holding && !queue.held, 'let go once the need is read');
  assert.equal(queue.buffer.appended, 7000, 'all that was held went to the buffer');
  assert.deepEqual(session.events.map((e) => e.holding), [true, false]);
  r.stop();
  const again = run(2.5e6);
  again.session.video.dispatchEvent(new Event('seeking'));
  assert.ok(!again.r.holding && !again.queue.held, 'a seek lets go at once');
  again.r.stop();
});
