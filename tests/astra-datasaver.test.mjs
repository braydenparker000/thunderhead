// The data saver (frontend/astra/src/engine/player-data.js): when it is on, and what it changes. With it on, the
// range reader reads about 5 s of the film past what playback reads instead of 10 (before the bitrate is known,
// 8 MiB instead of 24), and the pipelines keep 20 s ahead instead of 40; switching it moves a download that is
// already running, and a player's film teaches the reader its bitrate. Against an invented host, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK, HttpSource } from '../frontend/astra/src/engine/http-source.js';
import { saverOn, saverTuning, dataMethods } from '../frontend/astra/src/engine/player-data.js';

test("on when asked, or by itself when the phone saves data or is on a mobile network", () => {
  assert.equal(saverOn(true, { type: 'wifi' }), true);
  assert.equal(saverOn(false, { type: 'cellular', saveData: true }), false);
  assert.equal(saverOn('auto', { type: 'cellular' }), true);
  assert.equal(saverOn('auto', { type: 'wifi', saveData: true }), true);
  assert.equal(saverOn('auto', { type: 'wifi' }), false);
  assert.equal(saverOn('auto', undefined), false, 'a browser that does not say: off');
  // The reader's reach: 5 s of the film (10 without), at most 8 MiB (24); the cache keeps a 30 s back-seek and the reach.
  assert.deepEqual(saverTuning(true), { readAhead: 8 * BLOCK, ahead: 20, seconds: 5, keep: 55 });
  assert.deepEqual(saverTuning(false), { readAhead: 24 * BLOCK, ahead: null, seconds: 10, keep: 80 });
});

const SIZE = 64 * BLOCK;
/** A host that sends as fast as it is read; `sent()` is what has left it. */
function host() {
  let sent = 0;
  const fetchFn = async (url, { headers, signal }) => {
    let at = Number(/bytes=(\d+)-/.exec(headers.Range)[1]);
    const body = new ReadableStream({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 0));
        if (signal.aborted) return controller.error(new DOMException('Aborted', 'AbortError'));
        if (at >= SIZE) return controller.close();
        const piece = new Uint8Array(Math.min(256 << 10, SIZE - at));
        at += piece.length; sent += piece.length;
        controller.enqueue(piece);
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${at}-${SIZE - 1}/${SIZE}` } });
  };
  return { fetchFn, sent: () => sent };
}
const settle = async (source) => { let last = -1; while (source.bytesFetched !== last) { last = source.bytesFetched; await new Promise((r) => setTimeout(r, 30)); } return last; };

test('the reader pauses 8 MiB ahead with the saver on, 24 MiB with it off, and a switch moves a running download', async () => {
  const { fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn });
  await source.open();
  await source.read(0, 16);
  // A player's own call, as the engine makes it for the film loaded now.
  const player = { probed: { source }, saverSetting: true, mode: 'remux', session: { onProgress() { this.woken = true; } } };
  dataMethods.applyDataSaver.call(player);
  assert.equal(player.session.ahead, 20);
  assert.ok(player.session.woken, 'the pipelines look again at once');
  const saving = await settle(source);
  assert.ok(saving <= 10 * BLOCK && saving >= 8 * BLOCK, `about 8 MiB read ahead with the saver (${(saving / BLOCK).toFixed(1)} MiB)`);
  player.saverSetting = false;
  dataMethods.applyDataSaver.call(player);
  assert.equal(player.session.ahead, null, 'the pipelines go back to their own reach');
  const full = await settle(source);
  assert.ok(full >= 24 * BLOCK && full <= 26 * BLOCK, `about 24 MiB read ahead without it (${(full / BLOCK).toFixed(1)} MiB)`);
  assert.equal(dataMethods.dataUsed.call(player), full, 'dataUsed is the reader’s own count');
  source.close();
});

test('the player hands its film’s duration to the reader: the reach becomes seconds of the film', async () => {
  const { fetchFn } = host();
  const source = new HttpSource('https://files.example/film.mkv', { fetchFn, memory: null, connection: null });
  await source.open();
  const player = { probed: { source }, info: { duration: SIZE / BLOCK }, saverSetting: false }; // 1 MiB a second
  dataMethods.applyDataSaver.call(player);
  assert.equal(source.reach(), 10 * BLOCK);
  player.saverSetting = true;
  dataMethods.applyDataSaver.call(player);
  assert.equal(source.reach(), 5 * BLOCK);
  source.close();
});
