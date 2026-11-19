// Astra's relay, a torrent just added that TorBox does not list yet (the owner's phone, 2026-11-19:
// createtorrent gave an id and the listing by that id answered 404 at once). The listing is asked
// once more after a short wait, then the account's list is searched by the hash, whose id is used
// (and remembered) when it differs; else no address, the steps saying what was tried. createtorrent
// answering with only a hash or a queued id goes straight to the search. Invented hosts, hashes,
// key and films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ASTRA_LIMITS as L } from '../../../shared/contract/astra.ts';
import { forget } from '../../src/areas/astra/kept';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import { NOTE } from '../../src/areas/astra/words';
import {
  FILE_SERVER,
  HASH,
  KEY,
  LINK,
  MB,
  pathsAsked,
  relay,
  stubFetch,
  type Torrent,
  torbox,
  torboxCalls,
  world,
} from '../astra-helpers';
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
const tap = () =>
  relay(D, { key: KEY, body: { link: LINK, hash: HASH, mode: 'play', fileName: 'Invented.Film.2001.mkv' } });
const notFound = () => Response.json({ success: false, error: 'ITEM_NOT_FOUND', detail: 'Invented.' }, { status: 404 });
/** The stub TorBox, with the listing by id answering 404 its first `misses` times, and createtorrent
 * answering `add`'s data when given. */
function stub(o: { owned: Torrent[]; misses?: number; add?: Record<string, unknown> }) {
  const inner = torbox({ cached: [FILM], owned: o.owned, nextId: 500 });
  let misses = o.misses ?? 0;
  world.hosts.set('api.torbox.app', (req, signal) => {
    const u = new URL(req.url);
    const path = u.pathname.replace('/v1/api', '');
    if (path === '/torrents/mylist' && u.searchParams.get('id') && misses > 0) {
      misses--;
      return notFound();
    }
    if (path === '/torrents/createtorrent' && o.add)
      return Response.json({ success: true, detail: 'Invented.', data: o.add });
    return inner(req, signal);
  });
}
const asked = (path: string) =>
  torboxCalls()
    .filter((a) => a.url.includes(path))
    .map((a) => new URL(a.url).searchParams);
const notes = (b: { steps: { note?: string }[] }) => b.steps.map((s) => s.note ?? '').join(' ');

beforeAll(async () => {
  useFetch(stubFetch);
  D = (await setupOwner()).token;
});
beforeEach(() => {
  world.asked = [];
  world.hosts.clear();
  forgetMinute();
  forget();
  useTimes({ again_ms: 50 });
});
afterAll(() => {
  useFetch();
  useTimes();
});

describe('a listing that answers 404 right after an add', () => {
  it('once: asked again after a short wait, and the speculative requestdl it confirms is used', async () => {
    stub({ owned: [], misses: 1 });
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/500/0`);
    const files = body.steps.filter((s) => s.step === 'file');
    expect(files.map((s) => s.ok)).toEqual([false, true]);
    expect(files[0].note).toBe(NOTE.status(404));
    expect(files[1].note).toBe(NOTE.listedAgain);
    expect(body.steps.filter((s) => s.step === 'link').map((s) => s.ok)).toEqual([true]);
    expect(pathsAsked().filter((p) => p.endsWith('/requestdl'))).toHaveLength(1);
  });

  it('twice: found by the hash under the same id, in the account’s list asked fresh', async () => {
    stub({ owned: [], misses: 2 });
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/500/0`);
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'owned', ok: true, note: NOTE.foundByHash }));
    const lists = asked('/mylist').filter((q) => !q.get('id'));
    expect(lists.map((q) => q.get('bypass_cache'))).toEqual(['true']);
    // The listing by id twice, the list once; the speculative requestdl confirmed by the list.
    expect(asked('/mylist').filter((q) => q.get('id') === '500')).toHaveLength(2);
    expect(asked('/requestdl')).toHaveLength(1);
  });

  it('found by the hash under another id: requestdl by that id, the first guess set aside, and remembered', async () => {
    stub({ owned: [structuredClone(FILM)], add: { torrent_id: 600, hash: HASH, auth_id: 'invented' } });
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'owned', ok: true, note: NOTE.foundOtherId }));
    const links = body.steps.filter((s) => s.step === 'link');
    expect(links.map((s) => [s.ok, s.ok ? '' : s.note])).toEqual([
      [false, NOTE.setAside],
      [true, ''],
    ]);
    expect(asked('/requestdl').map((q) => q.get('torrent_id'))).toEqual(['600', '77']);
    world.asked = [];
    expect((await tap()).body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(asked('/requestdl').map((q) => q.get('torrent_id'))).toEqual(['77']);
    expect(pathsAsked()).toEqual(['/torrents/requestdl']);
  });

  it('never found: no address, the steps say what was tried, and nothing names an id or the hash', async () => {
    stub({ owned: [], add: { torrent_id: 600, hash: HASH } });
    const { status, body, text } = await tap();
    expect([status, body.url]).toEqual([200, null]);
    const tried = body.steps.filter((s) => s.step !== 'follow').map((s) => `${s.step}:${s.ok}`);
    expect(tried.slice(-4).sort()).toEqual(['file:false', 'file:false', 'link:false', 'owned:false']);
    expect(body.steps.filter((s) => s.step === 'file')[1].note).toBe(`${NOTE.listedAgain} ${NOTE.status(404)}`);
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'owned', note: NOTE.notFoundByHash }));
    for (const secret of [HASH, KEY, '600', 'Invented.Film']) expect(notes(body)).not.toContain(secret);
    expect(text).not.toContain(HASH);
    // The longest tap: checkcached, createtorrent, requestdl, the listing twice, the list.
    expect(torboxCalls().length).toBe(6);
    expect(torboxCalls().length).toBeLessThanOrEqual(L.torbox_calls_max);
  });
});

describe('what createtorrent’s answer names', () => {
  it('only a hash: straight to the search by the hash, no listing by id', async () => {
    stub({ owned: [structuredClone(FILM)], add: { hash: HASH } });
    const { body } = await tap();
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/77/0`);
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'add', ok: true, note: NOTE.addNoId }));
    expect(asked('/mylist').some((q) => q.get('id'))).toBe(false);
  });

  it('a queued id (and an id beside it) is never taken for a torrent id', async () => {
    stub({ owned: [], add: { queued_id: 501, id: 501, hash: HASH, auth_id: 'invented' } });
    const { body } = await tap();
    expect(body.url).toBeNull();
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'add', ok: true, note: NOTE.addQueued }));
    expect(body.steps).toContainEqual(expect.objectContaining({ step: 'owned', ok: false, note: NOTE.notFoundByHash }));
    expect(asked('/mylist').some((q) => q.get('id'))).toBe(false);
    expect(asked('/requestdl')).toHaveLength(0);
  });
});
