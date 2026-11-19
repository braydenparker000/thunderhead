// Astra's relay, how long a tap waits (owner's brief 2026-11-19): the stub TorBox answers each call
// after a realistic delay (createtorrent 1000 ms, mylist 350, requestdl 400, checkcached 300, as
// measured on the live Worker), and the tap's wall time is taken for a film not in the account
// after a press answered, the same with no press, and a film already in the account. What a press
// can learn without adding (checkcached and the account's list, together) is kept in memory, so the
// tap after it needs createtorrent, then requestdl beside the listing that confirms the file's id.
// Invented hosts, hashes, key and films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forget } from '../../src/areas/astra/kept';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import { FILE_SERVER, HASH, KEY, LINK, MB, relay, stubFetch, type Torrent, torbox, world } from '../astra-helpers';
import { setupOwner } from '../helpers';

let D = '';
const FILM: Torrent = {
  id: 77,
  hash: HASH,
  files: [
    { id: 0, name: 'Invented Film (2001)/Invented.Film.2001.mkv', size: 2100 * MB },
    { id: 1, name: 'Invented Film (2001)/Sample/sample.mkv', size: 20 * MB },
  ],
};
/** Each TorBox call's delay, in ms, by its path. */
const DELAY: Record<string, number> = {
  '/torrents/createtorrent': 1000,
  '/torrents/mylist': 350,
  '/torrents/requestdl': 400,
  '/torrents/checkcached': 300,
};
/** When each call began and ended, in ms from the request's start. */
let timeline: { path: string; from: number; to: number }[] = [];
let t0 = 0;

/** The stub TorBox, answering each call after its delay (an aborted call stops waiting). */
function slowTorbox(o: Parameters<typeof torbox>[0], change?: (path: string) => Response | null) {
  const inner = torbox(o);
  return async (req: Parameters<ReturnType<typeof torbox>>[0], signal?: AbortSignal) => {
    const path = new URL(req.url).pathname.replace('/v1/api', '');
    const from = Date.now() - t0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, DELAY[path] ?? 0);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('gone', 'AbortError'));
      });
    });
    timeline.push({ path, from, to: Date.now() - t0 });
    return change?.(path) ?? inner(req, signal);
  };
}

/** One request, timed from the outside. */
async function timedAsk(mode: 'play' | 'ahead') {
  timeline = [];
  t0 = Date.now();
  const res = await relay(D, { key: KEY, body: { link: LINK, hash: HASH, fileName: 'Invented.Film.2001.mkv', mode } });
  return { ms: Date.now() - t0, body: res.body, calls: timeline.map((c) => c.path.replace('/torrents/', '')) };
}

/** The longest chain of calls that each began after the one before had ended: what the request waited for. */
function inARow(): number {
  const ends = timeline.map(() => 0);
  const sorted = [...timeline].sort((a, b) => a.from - b.from);
  let longest = 0;
  sorted.forEach((c, i) => {
    const before = sorted.slice(0, i).filter((p) => p.to <= c.from + 5);
    ends[i] = 1 + Math.max(0, ...before.map((p) => ends[sorted.indexOf(p)]));
    longest = Math.max(longest, ends[i]);
  });
  return longest;
}

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  forgetMinute();
  forget();
  useTimes();
});
afterAll(() => {
  useFetch();
  useTimes();
});

describe('how long a tap waits, with realistic TorBox delays', () => {
  const url = (id: number) => `https://${FILE_SERVER}/dl/${id}/0`;
  const report: string[] = [];
  afterAll(() => console.log(`Astra tap timing (stub):\n${report.join('\n')}`));

  it('not in the account, the press answered: createtorrent, then requestdl beside the confirming list', async () => {
    world.hosts.set('api.torbox.app', slowTorbox({ cached: [FILM], owned: [], nextId: 501 }));
    const press = await timedAsk('ahead');
    expect([press.body.url, press.body.ready]).toEqual([null, true]);
    expect(inARow()).toBe(1);
    const tap = await timedAsk('play');
    expect(tap.body.url).toBe(url(501));
    expect([inARow(), tap.calls.includes('checkcached')]).toEqual([2, false]);
    expect(tap.ms).toBeLessThan(1400 + 300);
    report.push(`  not in the account, press answered: press ${press.ms} ms, tap ${tap.ms} ms (${tap.calls})`);
  });

  it('not in the account, no press: checkcached beside the add, then requestdl beside the list', async () => {
    world.hosts.set('api.torbox.app', slowTorbox({ cached: [FILM], owned: [], nextId: 502 }));
    const tap = await timedAsk('play');
    expect(tap.body.url).toBe(url(502));
    expect(inARow()).toBe(2);
    expect(tap.ms).toBeLessThan(1400 + 300);
    expect(tap.body.total_ms).toBeGreaterThanOrEqual(1400);
    expect(tap.body.total_ms).toBeLessThanOrEqual(tap.ms);
    report.push(`  not in the account, no press: tap ${tap.ms} ms (${tap.calls})`);
  });

  it('in the account: the press brings the address; without a press the tap is as above; after it, requestdl', async () => {
    world.hosts.set('api.torbox.app', slowTorbox({ cached: [FILM], owned: [structuredClone(FILM)] }));
    const press = await timedAsk('ahead');
    expect(press.body.url).toBe(url(77));
    expect(inARow()).toBe(2);
    expect(press.ms).toBeLessThan(750 + 300);
    const again = await timedAsk('play');
    expect([again.body.url, again.calls]).toEqual([url(77), ['requestdl']]);
    forget();
    const cold = await timedAsk('play');
    expect([cold.body.url, inARow()]).toEqual([url(77), 2]);
    report.push(
      `  in the account: press ${press.ms} ms (the tap takes its address), tap after it ${again.ms} ms, tap with no press ${cold.ms} ms (${cold.calls})`,
    );
  });

  it('the longest tap: the new id never listed, the film found by its hash under another id', async () => {
    const added = { success: true, detail: 'Invented.', data: { torrent_id: 600, hash: HASH } };
    world.hosts.set(
      'api.torbox.app',
      slowTorbox({ cached: [FILM], owned: [structuredClone(FILM)] }, (path) =>
        path === '/torrents/createtorrent' ? Response.json(added) : null,
      ),
    );
    const tap = await timedAsk('play');
    expect(tap.body.url).toBe(url(77));
    expect(tap.calls.length).toBe(7);
    // checkcached beside the add 1000, the listing 350, the wait 400, the listing 350, the list 350, requestdl 400.
    expect(tap.ms).toBeGreaterThanOrEqual(2850);
    expect(tap.ms).toBeLessThan(2850 + 400);
    report.push(`  the longest tap (never listed, found by hash under another id): ${tap.ms} ms (${tap.calls})`);
  });
});
