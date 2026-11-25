// What a registration keeps (2026-11-25, MUSE-SOP.md steps 4 and 6): a new song names its album and
// its track (from 1), else 422 naming the field, in a batch that item alone; a missing disc is 1; the
// extra tags (isrc, label, totals, compilation, original year, with their lower-case spellings) are
// kept, a bad one 422 naming it; any other key is not stored and the answer says so (`ignored`); a
// waveform without its kind is `rms`; and every song has its album id, set again when a patch changes
// its album. Every song is invented.
import { beforeAll, describe, expect, it } from 'vitest';
import { setupOwner } from '../helpers';
import { catalogGet, uploader, WAVE } from '../upload-helpers';

const RG = '6b1f0c2e-4a3d-4e5f-8a9b-0c1d2e3f4a5b';
let u: Awaited<ReturnType<typeof uploader>>;
let owner = '';
type Track = Record<string, unknown> & { id: string; metadata: Record<string, unknown> };
const trackOf = async (id: string) =>
  ((await catalogGet(u.E, owner)).body.tracks as Track[]).find((t) => t.id === id) as Track;

beforeAll(async () => {
  u = await uploader();
  owner = (await setupOwner()).token;
});

describe('a registration', () => {
  it('refuses a song without its album or track, naming the field', async () => {
    const noAlbum = await u.op('register', await u.song(1, { track: 1 }));
    expect([noAlbum.status, noAlbum.body.error?.details?.[0]?.path]).toEqual([422, 'metadata.album']);
    const blank = await u.op('register', await u.song(1, { album: '  ', track: 1 }));
    expect(blank.body.error?.details?.[0]?.path).toBe('metadata.album');
    for (const track of [undefined, 0]) {
      const r = await u.op('register', await u.song(1, { album: 'Rope Bridges', track }));
      expect([r.status, r.body.error?.details?.[0]?.path], String(track)).toEqual([422, 'metadata.track']);
    }
    expect((await u.op('register', await u.song(1, { album: 'Rope Bridges', track: 1.5 }))).status).toBe(422);
  });

  it('keeps the extra tags and their lower-case spellings, a missing disc as 1; says what it ignored', async () => {
    const meta = {
      album: 'Rope Bridges',
      track: 2,
      isrc: 'qzabc2600002',
      label: 'Invented Records',
      tracktotal: 9,
      discTotal: 1,
      compilation: false,
      originalyear: 1998,
      mood: 'calm',
      bpm: 96,
    };
    const r = await u.op('register', await u.song(2, meta, { waveform: WAVE }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ registered: true, duplicate: false, ignored: ['mood', 'bpm'] });
    const t = await trackOf(String(r.body.id));
    expect(t.metadata).toMatchObject({
      album: 'Rope Bridges',
      track: 2,
      disc: 1,
      isrc: 'QZABC2600002',
      label: 'Invented Records',
      trackTotal: 9,
      discTotal: 1,
      compilation: false,
      originalYear: 1998,
      albumId: 'al:paper-boats|rope-bridges',
    });
    expect(t.metadata).not.toHaveProperty('mood');
    expect(t.metadata).not.toHaveProperty('tracktotal');
    // A waveform sent without its kind is the tool's own, rms.
    expect(t.waveformKind).toBe('rms');
    // Nothing ignored: no `ignored` in the answer.
    const plain = await u.op('register', await u.song(3, { album: 'Rope Bridges', track: 3 }));
    expect(plain.body).not.toHaveProperty('ignored');
  });

  it('refuses a bad extra tag naming it', async () => {
    const r = await u.op('register', await u.song(4, { album: 'Rope Bridges', track: 4, isrc: 'QZ-ABC-26' }));
    expect([r.status, r.body.error?.details?.[0]?.path]).toEqual([422, 'metadata.isrc']);
    const total = await u.op('register', await u.song(4, { album: 'Rope Bridges', track: 4, disctotal: 0 }));
    expect(total.body.error?.details?.[0]?.path).toBe('metadata.discTotal');
  });

  it('in a batch, refuses the item alone, and gives each its own ignored keys', async () => {
    const tracks = [
      await u.song(5, { album: 'Lantern Hill', track: 1, mbReleaseGroup: RG }),
      await u.song(6, { track: 2 }),
      await u.song(7, { album: 'Lantern Hill', track: 3, tempo: 'slow' }),
    ];
    const r = await u.op('register-batch', { tracks });
    expect(r.status).toBe(200);
    const results = r.body.results as Record<string, unknown>[];
    expect(results[0]).toMatchObject({ registered: true });
    expect(results[0]).not.toHaveProperty('ignored');
    expect(results[1]).toMatchObject({ registered: false, status: 422 });
    expect(String(results[1].error)).toContain('metadata.album');
    expect(results[2]).toMatchObject({ registered: true, ignored: ['tempo'] });
    expect(r.body.registered).toBe(2);
    expect((await trackOf(String(results[0].id))).metadata.albumId).toBe(`rg:${RG}`);
  });
});

describe('a patch', () => {
  it('moves the album id with the album, keeps the extra tags, and never takes the album or track away', async () => {
    const reg = await u.op('register', await u.song(8, { album: 'Rope Bridges', track: 8 }));
    const id = String(reg.body.id);
    const p = await u.op('patch', { id, metadata: { album: 'Harbour Steps', disctotal: 2, colour: 'blue' } });
    expect(p.body).toMatchObject({ patched: true, ignored: ['colour'] });
    const t = await trackOf(id);
    expect(t.metadata).toMatchObject({ album: 'Harbour Steps', discTotal: 2, albumId: 'al:paper-boats|harbour-steps' });
    for (const change of [{ album: null }, { album: '' }, { track: null }, { track: 0 }]) {
      const r = await u.op('patch', { id, metadata: change });
      expect(r.status, JSON.stringify(change)).toBe(422);
    }
    const isrc = await u.op('patch', { id, metadata: { isrc: 'nope' } });
    expect(isrc.body.error?.details?.[0]?.path).toBe('metadata.isrc');
  });
});
