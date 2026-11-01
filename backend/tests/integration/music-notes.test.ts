// What the mind knows of each song (MUSIC.md §10.5, Music schema step 4): PUT /v1/music/notes checks
// every field against its vocabulary and refuses the whole batch for one bad note, a track twice or
// an id the catalog doesn't hold; a note the same as the one kept writes nothing; notes read back by
// id (with each track's tags) and a page at a time; the night's next page is the songs with no
// note of the current version; the batch waits past 80% of the day's database budget; the eval
// sandbox has no music. A synthetic catalog only.
import { runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { budgetAt } from '../../../shared/contract/meter.ts';
import type { MusicNotesResponse, MusicTracksResponse } from '../../../shared/contract/music.ts';
import { forgetHold } from '../../src/areas/meter/hold';
import { utcDay } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, NIGHT_SESSION, type Principals, principals } from '../memory-helpers';
import { music, note, putNotes, seedCatalog, songId } from '../music-helpers';

let P = {} as Principals;
const night = () => as(P.N, NIGHT_SESSION);
const chat = () => as(P.C, CHAT_SESSION);
let ids: string[] = [];
const notesSql = (q: string, ...b: unknown[]) =>
  runInDurableObject(music(), (_o, s) => s.storage.sql.exec(q, ...b).toArray());
const count = async () => ((await notesSql('SELECT count(*) AS n FROM track_notes'))[0] as { n: number }).n;
const issues = (r: { body: { error?: { details?: { path: string; issue: string }[] } } }) =>
  (r.body.error?.details ?? []).map((d) => d.path);

beforeAll(async () => {
  P = await principals();
  ids = await seedCatalog([
    { title: 'Slow Water', artist: 'The Example Trio', genre: 'Ambient', year: 1994 },
    { title: 'Bright Road', artist: 'Sample Band', genre: 'Rock', year: 2011 },
    { title: 'Choir Sample Piece', artist: 'Test Choir', genre: 'Choral', composer: 'A. Composer', year: 1890 },
  ]);
  // Filler, so a full batch of 200 has tracks to name.
  await seedCatalog(
    Array.from({ length: 220 }, (_, i) => ({ title: `Filler ${i}`, artist: 'Filler Artist', genre: 'Pop' })),
    100,
  );
});

describe('PUT /v1/music/notes checks every field', () => {
  const full = () =>
    note(ids[0], {
      moods: { calm: 0.9, dreamy: 0.6 },
      occasions: { 'wind-down': 0.8 },
      themes: ['night'],
      language: 'en',
      era: 1990,
      energy: 0.2,
      conf: { themes: 0.6, language: 0.9, era: 0.8, energy: 0.7 },
    });

  it.each([
    ['not an object', 'x', 'items.0'],
    ['an unknown field', { ...full(), colour: 'blue' }, 'items.0.colour'],
    ['a malformed id', { ...full(), id: 'song-1' }, 'items.0.id'],
    ['known missing', { ...full(), known: undefined }, 'items.0.known'],
    ['known not a boolean', { ...full(), known: 'yes' }, 'items.0.known'],
    ['moods not an object', { ...full(), moods: ['calm'] }, 'items.0.moods'],
    ['a mood not in the list', { ...full(), moods: { happy: 0.8 } }, 'items.0.moods.happy'],
    ['a mood confidence of 0', { ...full(), moods: { calm: 0 } }, 'items.0.moods.calm'],
    ['a mood confidence over 1', { ...full(), moods: { calm: 1.5 } }, 'items.0.moods.calm'],
    ['a mood confidence as text', { ...full(), moods: { calm: '0.8' } }, 'items.0.moods.calm'],
    [
      'six moods',
      { ...full(), moods: { calm: 0.5, sad: 0.5, dark: 0.5, tense: 0.5, dreamy: 0.5, focused: 0.5 } },
      'items.0.moods',
    ],
    ['an occasion not in the list', { ...full(), occasions: { gym: 0.8 } }, 'items.0.occasions.gym'],
    [
      'five occasions',
      { ...full(), occasions: { focus: 0.5, study: 0.5, drive: 0.5, sleep: 0.5, morning: 0.5 } },
      'items.0.occasions',
    ],
    ['themes not a list', { ...full(), themes: 'night' }, 'items.0.themes'],
    ['a theme not in the list', { ...full(), themes: ['war'] }, 'items.0.themes.0'],
    ['four themes', { ...full(), themes: ['love', 'home', 'night', 'loss'] }, 'items.0.themes'],
    ['a theme twice', { ...full(), themes: ['love', 'love'] }, 'items.0.themes'],
    ['a language by name', { ...full(), language: 'english' }, 'items.0.language'],
    ['a language not in ISO 639-1', { ...full(), language: 'xx' }, 'items.0.language'],
    ['a language in capitals', { ...full(), language: 'EN' }, 'items.0.language'],
    ['an era not a decade', { ...full(), era: 1995 }, 'items.0.era'],
    ['an era to come', { ...full(), era: 2090 }, 'items.0.era'],
    ['an era too old', { ...full(), era: 990 }, 'items.0.era'],
    ['an era as text', { ...full(), era: '1990' }, 'items.0.era'],
    ['an energy over 1', { ...full(), energy: 1.2 }, 'items.0.energy'],
    ['an energy under 0', { ...full(), energy: -0.1 }, 'items.0.energy'],
    [
      'no confidence for a language said',
      { ...full(), conf: { themes: 0.6, era: 0.8, energy: 0.7 } },
      'items.0.conf.language',
    ],
    ['a confidence for an empty field', { ...full(), themes: [], conf: { ...full().conf } }, 'items.0.conf.themes'],
    ['an unknown confidence', { ...full(), conf: { ...full().conf, mood: 0.5 } }, 'items.0.conf.mood'],
    ['a confidence too small', { ...full(), conf: { ...full().conf, era: 0.01 } }, 'items.0.conf.era'],
    ['a song not known, sure of a mood', { ...full(), known: false }, 'items.0.moods.calm'],
    [
      'a song not known, sure of its era',
      {
        ...full(),
        known: false,
        moods: { calm: 0.5 },
        occasions: {},
        conf: { ...full().conf, era: 0.4, language: 0.5, energy: 0.3, themes: 0.9 },
      },
      'items.0.conf.themes',
    ],
  ])('refuses %s, naming it, and writes nothing', async (_name, item, path) => {
    const r = await putNotes(P.N, [item]);
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe('validation');
    expect(issues(r)).toContain(path);
    expect(await count()).toBe(0);
  });

  it('refuses the whole batch for one bad note, an unknown id or a track twice', async () => {
    const unknown = await putNotes(P.N, [full(), note(songId(9_999))]);
    expect([unknown.status, issues(unknown)]).toEqual([422, ['items.1.id']]);
    expect(unknown.body.error?.details?.[0].issue).toBe('not in the catalog');
    const twice = await putNotes(P.N, [full(), full()]);
    expect([twice.status, issues(twice)]).toEqual([422, ['items.1.id']]);
    const mixed = await putNotes(P.N, [full(), { ...full(), id: ids[1], language: 'zz' }]);
    expect([mixed.status, issues(mixed)]).toEqual([422, ['items.1.language']]);
    expect(await count()).toBe(0);
  });

  it('takes 1 to 200 notes, items only, at most 256 KB', async () => {
    expect((await putNotes(P.N, [])).status).toBe(422);
    const filler = Array.from({ length: 201 }, (_, i) => note(songId(100 + i)));
    const over = await putNotes(P.N, filler);
    expect([over.status, issues(over)]).toEqual([422, ['items']]);
    const extra = await apiJson('PUT', '/v1/music/notes', { token: P.N, body: { items: [full()], batch: 1 } });
    expect(extra.status).toBe(422);
    const big = await apiJson('PUT', '/v1/music/notes', {
      token: P.N,
      body: { items: [full()], pad: 'x'.repeat(300_000) },
    });
    expect(big.status).toBe(413);
    // Without a Content-Length too: the body is cut off as it streams.
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode('x'.repeat(8_192)));
        c.close();
      },
    });
    const chunked = await exports.default.fetch(
      new Request('https://api.example.test/v1/music/notes', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${P.N}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(chunked.status).toBe(413);
    expect(await count()).toBe(0);
    const full200 = await putNotes(P.N, filler.slice(0, 200));
    expect([full200.status, full200.body]).toEqual([200, { written: 200, unchanged: 0, kept: 0 }]);
    // Packed for find 500 to a row: one pack row holds the 200.
    expect(await notesSql('SELECT kind, pack FROM find_packs ORDER BY kind, pack')).toEqual([
      { kind: 'meta', pack: 0 },
      { kind: 'notes', pack: 0 },
    ]);
  });
});

describe('notes kept and read back', () => {
  it('writes a changed note only, rounded and in vocabulary order, with its writer and version', async () => {
    const a = note(ids[0], {
      moods: { dreamy: 0.6, calm: 0.904 },
      occasions: { 'wind-down': 0.8 },
      language: 'en',
      conf: { language: 0.9 },
    });
    const b = note(ids[1], { known: false, moods: { energetic: 0.5 }, energy: 0.8, conf: { energy: 0.4 } });
    expect((await putNotes(P.N, [a, b])).body).toEqual({ written: 2, unchanged: 0, kept: 0 });
    expect((await putNotes(P.N, [a, b])).body).toEqual({ written: 0, unchanged: 2, kept: 0 });
    expect((await putNotes(P.C, [{ ...a, themes: ['night'], conf: { ...a.conf, themes: 0.5 } }])).body).toEqual({
      written: 1,
      unchanged: 0,
      kept: 0,
    });
    // The owner's correction through the chat stands: the night's note for that song is kept out.
    expect((await putNotes(P.N, [a])).body).toEqual({ written: 0, unchanged: 0, kept: 1 });
    // The owner confirming the night's note as it is, through the chat, makes it theirs.
    expect((await putNotes(P.C, [note(songId(100))])).body).toEqual({ written: 1, unchanged: 0, kept: 0 });
    expect((await putNotes(P.C, [note(songId(100))])).body).toEqual({ written: 0, unchanged: 1, kept: 0 });
    expect(await notesSql('SELECT by FROM track_notes WHERE track_id = ?', songId(100))).toEqual([{ by: 'mind:chat' }]);
    expect((await putNotes(P.N, [note(songId(100), { moods: { calm: 0.5 } })])).body).toMatchObject({ kept: 1 });
    const rows = await notesSql(
      'SELECT track_id, known, note_json, by, v FROM track_notes WHERE track_id IN (?, ?) ORDER BY track_id',
      ids[0],
      ids[1],
    );
    expect(rows).toEqual([
      {
        track_id: ids[0],
        known: 1,
        note_json:
          '{"moods":{"calm":0.9,"dreamy":0.6},"occasions":{"wind-down":0.8},"themes":["night"],"language":"en","era":null,"energy":null,"conf":{"themes":0.5,"language":0.9}}',
        by: 'mind:chat',
        v: 1,
      },
      {
        track_id: ids[1],
        known: 0,
        note_json:
          '{"moods":{"energetic":0.5},"occasions":{},"themes":[],"language":null,"era":null,"energy":0.8,"conf":{"energy":0.4}}',
        by: 'mind:night',
        v: 1,
      },
    ]);
  });

  it('reads notes by id with each track’s tags, the device too; ids not held are missing', async () => {
    const r = await apiJson<MusicNotesResponse>('GET', `/v1/music/notes?ids=${ids[0]},${ids[2]},${songId(9_999)}`, {
      token: P.D,
    });
    expect(r.status).toBe(200);
    expect(r.body.missing).toEqual([songId(9_999)]);
    expect(r.body.items.map((i) => [i.id, i.title, i.artist, i.year])).toEqual([
      [ids[0], 'Slow Water', 'The Example Trio', 1994],
      [ids[2], 'Choir Sample Piece', 'Test Choir', 1890],
    ]);
    expect(r.body.items[0].note).toMatchObject({ known: true, moods: { calm: 0.9 }, by: 'mind:chat', v: 1 });
    expect(r.body.items[1].note).toBeNull();
    for (const bad of ['', 'not-an-id', Array.from({ length: 201 }, (_, i) => songId(i)).join(',')])
      expect((await apiJson('GET', `/v1/music/notes?ids=${bad}`, chat())).status).toBe(422);
  });

  it('pages through every note in track id order', async () => {
    const one = await apiJson<MusicNotesResponse>('GET', '/v1/music/notes?limit=1', night());
    expect(one.body.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(one.body.next).toBe(ids[0]);
    const two = await apiJson<MusicNotesResponse>('GET', `/v1/music/notes?limit=1&cursor=${one.body.next}`, night());
    expect([two.body.items.map((i) => i.id), two.body.next]).toEqual([[ids[1]], ids[1]]);
    const last = await apiJson<MusicNotesResponse>('GET', `/v1/music/notes?limit=200&cursor=${ids[1]}`, night());
    expect([last.body.items.length, last.body.items[0].id, last.body.next]).toEqual([200, songId(100), null]);
    expect((await apiJson('GET', '/v1/music/notes?limit=201', night())).status).toBe(422);
    expect((await apiJson('GET', '/v1/music/notes?cursor=nope', night())).status).toBe(422);
  });

  it('the next untagged page leaves out songs with a current note, goes on from its place, and takes back an older version', async () => {
    const page = () => apiJson<MusicTracksResponse>('GET', '/v1/music/tracks?untagged=1&limit=2', night());
    const first = await page();
    expect(first.body).toMatchObject({ total: 2, more: true });
    expect(first.body.items.map((t) => t.id)).toEqual([ids[2], songId(300)]);
    // Its place moved to just before the first of them.
    expect(await notesSql("SELECT value_json FROM music_state WHERE key = 'notes.cursor'")).toEqual([
      { value_json: '{"v":1,"ord":2}' },
    ]);
    await putNotes(P.N, [note(ids[2], { moods: { reverent: 0.9 } })]);
    expect((await page()).body.items.map((t) => t.id)).toEqual([songId(300), songId(301)]);
    // A note of an older format is as good as none (the night writes it again), unless the owner
    // corrected it through the chat; a new format starts the night's place over.
    await notesSql('UPDATE track_notes SET v = 0 WHERE track_id IN (?, ?)', ids[0], ids[1]);
    await notesSql("DELETE FROM music_state WHERE key = 'notes.cursor'");
    expect((await page()).body.items.map((t) => t.id)).toEqual([ids[1], songId(300)]);
    // Without the flag, every song as before.
    const all = await apiJson<MusicTracksResponse>('GET', '/v1/music/tracks?limit=2', night());
    expect(all.body.total).toBe(223);
  });
});

describe('what holds the notes back', () => {
  it('a batch waits past 80% of the day’s budget, until 00:00 UTC', async () => {
    const day = utcDay(Date.now());
    await coreSql(
      "INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, 'senses', ?, 0, 0)",
      day,
      budgetAt(80, 'rows_read') + 1,
    );
    forgetHold();
    const held = await putNotes(P.N, [note(ids[2], { moods: { reverent: 0.8 } })]);
    expect([held.status, held.body.error?.code]).toEqual([429, 'rate_limited']);
    expect((await apiJson('GET', '/v1/music/find?moods=calm', night())).status).toBe(429);
    // Reading is never held.
    expect((await apiJson('GET', `/v1/music/notes?ids=${ids[2]}`, night())).status).toBe(200);
    await coreSql("DELETE FROM meter_days WHERE class = 'senses'");
    forgetHold();
    expect((await putNotes(P.N, [note(ids[2], { moods: { reverent: 0.8 } })])).status).toBe(200);
  });

  it('the eval sandbox has no music', async () => {
    const sandbox = { 'TH-Sandbox': 'eval', 'TH-Session': CHAT_SESSION };
    const r = await apiJson<{ error: { details: { path: string }[] } }>('GET', `/v1/music/notes?ids=${ids[0]}`, {
      token: P.C,
      headers: sandbox,
    });
    expect([r.status, r.body.error.details[0].path]).toEqual([422, 'TH-Sandbox']);
    expect((await putNotes(P.C, [note(ids[0])], sandbox)).status).toBe(422);
    expect((await apiJson('GET', '/v1/music/find?moods=calm', { token: P.C, headers: sandbox })).status).toBe(422);
    expect((await apiJson('GET', '/v1/music/tracks?untagged=1', { token: P.C, headers: sandbox })).status).toBe(422);
  });
});
