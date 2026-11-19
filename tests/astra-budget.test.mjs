// The memory a playing film may take (budget.js), how it is shared out at a film's bitrate (hold.js), and the engine's
// `memory` log entries (player-memory.js). Pure, in Node: no browser, no network.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGETS, memoryBudget } from '../frontend/astra/src/engine/budget.js';
import { HOLD, holding, aheadSeconds, behindSeconds } from '../frontend/astra/src/engine/hold.js';
import { memoryMethods } from '../frontend/astra/src/engine/player-memory.js';

const MiB = 1 << 20, mbit = (n) => n * 125000;

test('the budget falls with the phone’s memory and under the data saver', () => {
  assert.equal(memoryBudget({ deviceMemory: 8 }).name, 'roomy');
  assert.equal(memoryBudget({ deviceMemory: 4 }).film, BUDGETS.roomy.film);
  assert.equal(memoryBudget({ deviceMemory: undefined }).name, 'roomy', 'a browser that does not say');
  assert.equal(memoryBudget({ deviceMemory: 2 }).name, 'small');
  assert.equal(memoryBudget({ deviceMemory: 1 }).name, 'tight');
  assert.equal(memoryBudget({ deviceMemory: 0.5 }).name, 'tight');
  const saver = memoryBudget({ deviceMemory: 4, saver: true });
  assert.equal(saver.name, 'roomy saver');
  assert.equal(saver.film, Math.round(BUDGETS.roomy.film * 0.75));
  assert.equal(saver.mb, BUDGETS.roomy.mb - 28, 'the target falls by the film bytes given up');
  assert.ok(BUDGETS.roomy.film > BUDGETS.small.film && BUDGETS.small.film > BUDGETS.tight.film);
});

test('a fast film’s bytes are shared within the budget: what reading needs, a skip back, the ahead kept twice; a slow film is held by time as before', () => {
  const film = BUDGETS.roomy.film, sum = (h) => h.ahead + h.behind + h.cache;
  // 25 Mbit/s: the reach held to its share and a second behind it, 12 s behind the playhead (a 10 s skip back and a
  // key frame), and what is ahead both in the browser's buffer and in the cache (a change of sound track reads it again).
  const fast = holding({ film, rate: mbit(25), reach: 24 * MiB });
  assert.equal(fast.reach, Math.floor(film * HOLD.reach));
  assert.ok(Math.abs(sum(fast) - film) < 1, 'all of the budget, no more');
  assert.equal(fast.behind, HOLD.skipBack * mbit(25));
  assert.ok(fast.ahead / mbit(25) > HOLD.minAhead + 3, `about 9.5 s ahead (${(fast.ahead / mbit(25)).toFixed(1)} s)`);
  assert.ok(Math.abs(fast.cache - (fast.reach + HOLD.trail * mbit(25) + fast.ahead)) < 1, 'the cache keeps what is ahead too');
  // 60 Mbit/s: six seconds ahead, what is left behind, and the cache only what reading needs.
  const uhd = holding({ film, rate: mbit(60), reach: 24 * MiB });
  assert.ok(Math.abs(sum(uhd) - film) < 1);
  assert.equal(uhd.ahead, HOLD.minAhead * mbit(60));
  assert.ok(uhd.behind > HOLD.minBehind * mbit(60) && uhd.behind < HOLD.skipBack * mbit(60), `${(uhd.behind / mbit(60)).toFixed(1)} s behind`);
  assert.equal(uhd.cache, uhd.reach + HOLD.trail * mbit(60));
  // A small phone's budget at 60 Mbit/s, or 100 Mbit/s on the roomy one: the floors, past the budget, never less.
  for (const h of [holding({ film: BUDGETS.small.film, rate: mbit(60), reach: 24 * MiB }), holding({ film, rate: mbit(100), reach: 24 * MiB })]) {
    const rate = h.ahead / HOLD.minAhead;
    assert.equal(h.behind, HOLD.minBehind * rate);
    assert.equal(h.cache, h.reach + HOLD.trail * rate, 'what reading needs, never less');
  }
  // 4 Mbit/s: its 40 s ahead and 20 behind fit, so the cache keeps its 80 s and the reach its 10.
  const slow = holding({ film, rate: mbit(4), reach: 5 * MiB });
  assert.equal(slow.reach, 5 * MiB);
  assert.equal(slow.ahead, 40 * mbit(4));
  assert.equal(slow.behind, 20 * mbit(4));
  assert.equal(slow.cache, 80 * mbit(4) + 5 * MiB);
  const source = { byteRate: mbit(4), held: slow };
  assert.equal(aheadSeconds(40, source), 40);
  assert.equal(behindSeconds(20, source), 20);
  assert.equal(aheadSeconds(40, { byteRate: mbit(25), held: fast }).toFixed(1), (fast.ahead / mbit(25)).toFixed(1));
  assert.equal(aheadSeconds(40, { byteRate: 0, held: null }), 40, 'the rate unknown: by time');
  assert.equal(holding({ film, rate: 0, reach: MiB }), null);
});

/** A stand-in player with an element whose events are sent by hand, and a clock that is moved by hand. */
function player() {
  const video = Object.assign(new EventTarget(), { paused: false, seeking: false, currentTime: 30, buffered: { length: 1, start: () => 18, end: () => 42 } });
  const log = [];
  const p = { video, log, budget: memoryBudget({ deviceMemory: 4 }), probed: { source: { byteRate: mbit(8), blocks: new Map([[0, new Uint8Array(MiB)]]) } }, record: (kind, detail) => log.push({ kind, detail }), ...memoryMethods };
  return p;
}

test('the log gets a memory entry at the first picture and one every 60 s of play, none while paused', (t) => {
  let now = 0;
  mock.method(performance, 'now', () => now);
  t.after(() => mock.restoreAll());
  const p = player(), v = p.video;
  p.watchMemory();
  p.watchMemory(); // once a player
  v.dispatchEvent(new Event('loadeddata'));
  assert.equal(p.log.length, 1);
  const first = p.log[0].detail;
  assert.deepEqual(first, { at: 'picture', heap: first.heap, ahead: 12, behind: 12, aheadMB: 11, behindMB: 11, cacheMB: 1, budget: 'roomy', budgetMB: 250, filmMB: 112 });
  const play = (seconds) => { for (let i = 0; i < seconds * 4; i++) { now += 250; v.dispatchEvent(new Event('timeupdate')); } };
  play(59);
  assert.equal(p.log.length, 1);
  play(2);
  assert.equal(p.log.length, 2);
  assert.equal(p.log[1].detail.at, 'play');
  v.paused = true;
  play(120);
  assert.equal(p.log.length, 2, 'a paused film adds nothing');
  v.paused = false;
  now += 600_000; // ten minutes asleep count a second at most
  v.dispatchEvent(new Event('timeupdate'));
  play(56); // with the second left over from the last minute and the one asleep: 58
  assert.equal(p.log.length, 2);
  play(2);
  assert.equal(p.log.length, 3);
  assert.ok(p.log.every((x) => Object.values(x.detail).every((d) => d === null || typeof d === 'number' || /^[a-z ]+$/.test(d))), 'numbers and fixed words only');
  p.stopMemory();
  play(120);
  assert.equal(p.log.length, 3, 'stopped with the player');
});
