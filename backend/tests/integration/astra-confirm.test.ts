// Astra's relay, the edges of the faster layout (independent read, 2026-11-19): a speculative
// requestdl for a file's place in checkcached's list that turns out to be another file is set aside
// at once, not waited for; a listing that answers about another torrent is trouble, never trusted
// nor remembered; a press answers "ready" from memory only when its own hints name a file there (a
// season pack shares one hash); a tap whose checkcached said for certain "not cached" answers 503
// even when the add failed or was refused, never the add-on's link; and an answer larger than the
// Worker reads is trouble, not parsed. Invented hosts, hashes, key and films.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forget } from '../../src/areas/astra/kept';
import { forgetMinute } from '../../src/areas/astra/routes';
import { useFetch, useTimes } from '../../src/areas/astra/upstream';
import {
  FILE_SERVER,
  HASH,
  KEY,
  LINK,
  MB,
  OTHER,
  pathsAsked,
  relay,
  stubFetch,
  type Torrent,
  torbox,
  world,
} from '../astra-helpers';
import { setupOwner } from '../helpers';

let D = '';
const PACK: Torrent = {
  id: 78,
  hash: OTHER,
  files: [
    { id: 4, name: 'Invented Show S01/Invented.Show.S01E01.mkv', size: 900 * MB },
    { id: 5, name: 'Invented Show S01/Invented.Show.S01E02.mkv', size: 910 * MB },
  ],
};
const FILM: Torrent = {
  id: 77,
  hash: HASH,
  files: [
    { id: 11, name: 'Invented Film (2001)/Invented.Film.2001.mkv', size: 2100 * MB },
    { id: 12, name: 'Invented Film (2001)/Sample/sample.mkv', size: 20 * MB },
  ],
};
const ask = (body: Record<string, unknown>) => relay(D, { key: KEY, body: { link: LINK, mode: 'play', ...body } });
/** A TorBox stub whose answers `change` may replace, path by path. */
const stubbed = (
  o: Parameters<typeof torbox>[0],
  change: (path: string, u: URL) => Response | Promise<Response> | null,
) => {
  const inner = torbox(o);
  world.hosts.set('api.torbox.app', (req, signal) => {
    const u = new URL(req.url);
    return change(u.pathname.replace('/v1/api', ''), u) ?? inner(req, signal);
  });
};
const hang = (signal?: AbortSignal) =>
  new Promise<Response>((_, reject) =>
    signal?.addEventListener('abort', () => reject(new DOMException('gone', 'AbortError'))),
  );

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

describe('a file whose place is not its id', () => {
  it('is asked for by its real id at once; the speculative ask is set aside, not waited for', async () => {
    // checkcached lists the film second (place 1); TorBox's ids are 11 and 12, and file 1 never answers.
    const cachedFiles = [FILM.files[1], FILM.files[0]].map(({ name, size }) => ({ name, size }));
    world.hosts.set('api.torbox.app', (req, signal) => {
      const u = new URL(req.url);
      const path = u.pathname.replace('/v1/api', '');
      if (path === '/torrents/checkcached')
        return Response.json({ success: true, data: { [HASH]: { hash: HASH, files: cachedFiles } } });
      if (path === '/torrents/requestdl' && u.searchParams.get('file_id') === '1') return hang(signal);
      return torbox({ cached: [FILM], owned: [structuredClone(FILM)] })(req, undefined);
    });
    useTimes({ torbox_ms: 1500 });
    const t0 = Date.now();
    const { body } = await ask({ hash: HASH, fileName: 'Invented.Film.2001.mkv', fileSize: 2100 * MB });
    expect(body.url).toBe(`https://${FILE_SERVER}/dl/77/11`);
    expect(Date.now() - t0).toBeLessThan(1000);
    const links = body.steps.filter((s) => s.step === 'link');
    expect(links[0]).toMatchObject({ ok: false, note: expect.stringMatching(/set aside/) });
    expect(links[1]).toMatchObject({ ok: true });
  });

  it('a listing about another torrent is trouble: no address, and nothing is remembered', async () => {
    stubbed({ cached: [FILM], owned: [structuredClone(FILM)] }, (path, u) =>
      path === '/torrents/mylist' && u.searchParams.get('id')
        ? Response.json({ success: true, data: { id: 99, hash: 'f'.repeat(40), files: FILM.files } })
        : null,
    );
    const first = await ask({ hash: HASH, fileName: 'Invented.Film.2001.mkv' });
    expect(first.body.url).toBeNull();
    expect(first.body.steps).toContainEqual(expect.objectContaining({ step: 'file', ok: false }));
    world.asked = [];
    await ask({ hash: HASH, fileName: 'Invented.Film.2001.mkv' });
    expect(pathsAsked()).toContain('/torrents/createtorrent');
    // The same id with another hash is not trusted either.
    forget();
    stubbed({ cached: [FILM], owned: [structuredClone(FILM)] }, (path, u) =>
      path === '/torrents/mylist' && u.searchParams.get('id')
        ? Response.json({ success: true, data: { id: 77, hash: 'e'.repeat(40), files: FILM.files } })
        : null,
    );
    expect((await ask({ hash: HASH, fileName: 'Invented.Film.2001.mkv' })).body.url).toBeNull();
  });
});

describe('what a press remembers', () => {
  it('answers ready from memory only when its own hints name a file there', async () => {
    world.hosts.set('api.torbox.app', torbox({ cached: [PACK], owned: [] }));
    const named = await ask({ hash: OTHER, mode: 'ahead', fileName: 'Invented.Show.S01E02.mkv' });
    expect(named.body.ready).toBe(true);
    world.asked = [];
    // The same pack pressed with nothing that tells its episodes apart: asked again, and not ready.
    const vague = await ask({ hash: OTHER, mode: 'ahead' });
    expect([vague.body.ready, vague.body.url]).toEqual([false, null]);
    expect(pathsAsked()).toContain('/torrents/checkcached');
    world.asked = [];
    expect((await ask({ hash: OTHER, mode: 'ahead', fileName: 'Invented.Show.S01E01.mkv' })).body.ready).toBe(true);
    expect(pathsAsked()).toEqual([]);
  });
});

describe('a tap that checkcached says is not cached', () => {
  it('is 503 even when the add failed or was refused otherwise, never the add-on’s link', async () => {
    for (const add of [
      () => new Response('', { status: 503 }),
      () => Response.json({ success: false, error: 'INVENTED' }, { status: 400 }),
    ]) {
      forget();
      world.asked = [];
      stubbed({ cached: [], owned: [] }, (path) => (path === '/torrents/createtorrent' ? add() : null));
      useTimes({ retry_ms: 5 });
      const { status, body } = await relay(D, {
        key: KEY,
        follow: 'on',
        body: { link: LINK, hash: HASH, mode: 'play' },
      });
      expect([status, body.error?.code]).toEqual([503, 'unavailable']);
      expect(pathsAsked()).not.toContain('/torrents/mylist');
      expect(world.asked.some((a) => a.url.startsWith('https://addon.example'))).toBe(false);
    }
  });
});

describe('what is read of an answer', () => {
  it('a checkcached answer larger than the Worker reads is trouble, not parsed', async () => {
    const files = Array.from({ length: 10_000 }, (_, i) => ({
      name: `Invented Show/Invented.Show.E${i}.mkv`,
      size: 900 * MB,
    }));
    stubbed({ cached: [PACK], owned: [] }, (path) =>
      path === '/torrents/checkcached'
        ? Response.json({ success: true, data: { [OTHER]: { hash: OTHER, files } } })
        : null,
    );
    const { body } = await ask({ hash: OTHER, mode: 'ahead', fileName: 'Invented.Show.E7.mkv' });
    expect([body.url, body.ready]).toEqual([null, false]);
    expect(body.steps).toContainEqual(
      expect.objectContaining({ step: 'cached', ok: false, note: expect.stringMatching(/larger than/) }),
    );
  });
});
