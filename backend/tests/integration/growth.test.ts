// Night step 13, the week's growth (shared/contract/growth.ts; PUT /v1/mind/growth/:day): the two
// week questions over invented senses (sessions, clean passes, new bests against the 28 days before,
// reading stints; a sensitive event left out), silence under 3 sessions, then the Briefing's
// practice and study tiles from the counts and tomorrow's plan and next passage through
// guitar.set_plan and study.mark_next; the same again writes nothing; a tile the owner dismissed
// stays away (law 4: remind once, let go). Everything is synthetic.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, SurfacesResponse, TodayResponse } from '../../../shared/contract/api';
import type { BriefingResponse, NightTile } from '../../../shared/contract/briefing.ts';
import type { GrowthResponse, GuitarWeek, StudyWeek } from '../../../shared/contract/growth.ts';
import type { SenseQueryResponse } from '../../../shared/contract/senses.ts';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, zonedInstant } from '../../src/lib/time';
import { libraryObject } from '../../src/objects/library';
import { apiJson, coreSql } from '../helpers';
import { as, freshSession, type Principals, principals } from '../memory-helpers';

let p: Principals;
let yday = '';
let S = '';
const BOOK = uuidv7();
const at = (daysBack: number) =>
  zonedInstant(dayBefore(yday, daysBack), 12, 'Etc/GMT') + Math.floor(Math.random() * 1000);
const send = async (events: { type: string; ref: string; data?: object; back: number; sensitivity?: 0 | 1 }[]) => {
  const body = {
    events: events.map((e) => ({
      id: uuidv7(),
      at: at(e.back),
      type: e.type,
      ref: e.ref,
      data: e.data,
      sensitivity: e.sensitivity,
    })),
  };
  const r = await apiJson<{ accepted: number }>('PUT', `/v1/senses/batches/${uuidv7()}`, { token: p.D, body });
  expect(r.body.accepted).toBe(events.length);
};
const session = (back: number, sensitivity: 0 | 1 = 0) => ({
  type: 'guitar.session',
  ref: 'tab:s101',
  data: { seconds: 1200, played_seconds: 900, sections: ['8-11', '12-15'], bpm: 100 },
  back,
  sensitivity,
});
const read = (back: number) => ({ type: 'study.read', ref: `book:${BOOK}`, data: { pages: 10, ms: 600_000 }, back });
const growth = () => apiJson<GrowthResponse & ErrorBody>('PUT', `/v1/mind/growth/${yday}`, { ...as(p.N, S), body: {} });
const query = <T>(name: string) =>
  apiJson<SenseQueryResponse>('POST', '/v1/senses/query', { token: p.N, body: { name, params: { to: yday } } }).then(
    (r) => r.body.rows[0] as T,
  );
const slot = async (app: string, name: string) =>
  (await apiJson<SurfacesResponse>('GET', '/v1/surfaces', { token: p.D })).body.items.find(
    (s) => s.app === app && s.slot === name,
  );
const ledgerRows = async () => (await coreSql<{ n: number }>('SELECT count(*) AS n FROM ledger'))[0].n;

beforeAll(async () => {
  p = await principals();
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.tz', ?, 0, 'owner')
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    JSON.stringify('Etc/GMT'),
  );
  yday = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day);
  S = await freshSession(p.N, 'night', 'cse_growth_night_1');
  // A book the owner left off in at PDF page 40 (printed 32), its labels, one highlight this week.
  await runInDurableObject(libraryObject(env), (_o, st) => {
    const sql = st.storage.sql;
    const now = Date.now();
    sql.exec(
      `INSERT INTO books (id, title, kind, language, bytes, pdf_pages, r2_key, state, added_at, updated_at)
       VALUES (?, 'An invented book', 'book', 'en', 1000, 300, ?, 'ready', ?, ?)`,
      BOOK,
      `books/${BOOK}.pdf`,
      now,
      now,
    );
    sql.exec(
      "INSERT INTO positions (book_id, pdf_page, scroll_frac, at, device) VALUES (?, 40, 0, ?, 'd1')",
      BOOK,
      now,
    );
    for (let n = 40; n <= 52; n++)
      sql.exec(
        "INSERT INTO pages (book_id, pdf_page, page_label, text, blocks_json, chars) VALUES (?, ?, ?, 'x', '[]', 1)",
        BOOK,
        n,
        String(n - 8),
      );
    sql.exec(
      `INSERT INTO highlights (id, book_id, pdf_page, quote, prefix, suffix, color, created_at, updated_at)
       VALUES (?, ?, 38, 'q', '', '', 'yellow', ?, ?)`,
      uuidv7(),
      BOOK,
      now,
      now,
    );
  });
});

describe('the week’s growth', () => {
  it('is the night key’s, from a claimed session, for a closed day with a night run', async () => {
    expect((await apiJson('PUT', `/v1/mind/growth/${yday}`, { ...as(p.D, S), body: {} })).status).toBe(403);
    expect((await apiJson('PUT', `/v1/mind/growth/${yday}`, { ...as(p.N, 'cse_never'), body: {} })).status).toBe(403);
    expect((await growth()).status).toBe(422); // no run yet
    const start = await apiJson('POST', '/v1/mind/night', { ...as(p.N, S), body: { day: yday, action: 'start' } });
    expect(start.status).toBe(200);
    expect((await apiJson('PUT', '/v1/mind/growth/2026-02-30', { ...as(p.N, S), body: {} })).status).toBe(422);
  });

  it('under 3 sessions it says and plans nothing', async () => {
    await send([session(0), session(1), session(2, 1), read(0), read(1)]);
    const g = await query<GuitarWeek>('guitar_week');
    expect(g).toMatchObject({ sessions: 2, minutes: 40, days: 2 }); // the sensitive one stays out
    const r = await growth();
    expect(r.status).toBe(200);
    expect(r.body.guitar).toEqual({ sessions: 2, tile: null, plan: null, reason: 'quiet' });
    expect(r.body.study).toEqual({ sessions: 2, tile: null, plan: null, reason: 'quiet' });
    expect(await slot('briefing', 'practice')).toBeUndefined();
    expect(await slot('guitar', 'today')).toBeUndefined();
  });

  it('the week questions: sessions, best clean tempo per section, the BPM gained, pages and books', async () => {
    await send([
      session(3),
      read(3),
      { type: 'guitar.bpm', ref: 'tab:s101#b9-12', data: { bpm: 84 }, back: 10 },
      { type: 'guitar.bpm', ref: 'tab:s101#b9-12', data: { bpm: 92 }, back: 0 },
      {
        type: 'guitar.pass',
        ref: 'tab:s101#b9-12',
        data: { bpm: 92, speed_pct: 92, clean: true, by: 'owner' },
        back: 0,
      },
      {
        type: 'guitar.pass',
        ref: 'tab:s101#b9-12',
        data: { bpm: 96, speed_pct: 96, clean: false, by: 'owner' },
        back: 0,
      },
      {
        type: 'guitar.pass',
        ref: 'tab:s101#b13-16',
        data: { bpm: 100, speed_pct: 100, clean: true, by: 'owner' },
        back: 1,
      },
      { type: 'guitar.session', ref: 'tab:s202', data: { seconds: 300 }, back: 9 }, // before the week
    ]);
    const g = await query<GuitarWeek>('guitar_week');
    expect(g).toMatchObject({
      from: dayBefore(yday, 6),
      to: yday,
      sessions: 3,
      minutes: 60,
      days: 3,
      cleared: 1,
      gained: 1,
    });
    expect(g.songs).toEqual([
      {
        ref: 'tab:s101',
        outside: false,
        sessions: 3,
        minutes: 60,
        sections: [
          { key: '8-11', bars: '9-12', best_bpm: 92, before_bpm: 84, gained: 8, cleared: false, clean: 1 },
          { key: '12-15', bars: '13-16', best_bpm: 100, before_bpm: null, gained: 0, cleared: true, clean: 1 },
        ],
      },
    ]);
    const s = await query<StudyWeek>('study_week');
    expect(s).toMatchObject({ reads: 3, pages: 30, minutes: 30, days: 3, books: 1 });
    expect(s.items).toEqual([{ ref: `book:${BOOK}`, reads: 3, pages: 30, minutes: 30, days: 3 }]);
  });

  it('from 3 sessions: the two tiles from the counts, tomorrow’s plan and the next passage', async () => {
    const r = await growth();
    expect(r.status).toBe(200);
    expect(r.body.guitar).toMatchObject({ sessions: 3, reason: null });
    expect(r.body.study).toMatchObject({ sessions: 3, reason: null });
    expect(r.body.rows_read).toBeGreaterThan(0);
    const plan = await slot('guitar', 'today');
    expect(plan?.payload).toMatchObject({
      tab: 'tab:s101',
      sections: [
        { key: '8-11', bpm: 92 },
        { key: '12-15', bpm: 100 },
      ],
    });
    expect(plan?.ledger_id).toBe(r.body.guitar.plan);
    const next = await slot('study', 'next');
    expect(next?.payload).toMatchObject({ book: `book:${BOOK}`, left_off: 'p. 32', next: 'pp. 33–42', page: 41 });
    const tiles = (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D })).body.tiles.filter(
      (t): t is NightTile => t.kind === 'night',
    );
    expect(tiles.map((t) => [t.slot, t.value, t.detail, t.app, t.path])).toEqual([
      [
        'practice',
        'Next: bars 9–12 at 92',
        '3 sessions this week, 1 h, bars 9–12 up 8 bpm.',
        'guitar',
        '/guitar/#play=s101&bars=8-11&bpm=92',
      ],
      ['study', 'Next: pp. 33–42', '30 pages on 3 days, 30 min, 1 highlight.', 'study', `/study/?book=${BOOK}&p=41`],
    ]);
    expect(tiles[0].ledger_id).toBe(r.body.guitar.tile);
  });

  it('the same week again writes nothing', async () => {
    const before = await ledgerRows();
    const first = (await growth()).body;
    const again = (await growth()).body;
    expect(again).toEqual(first);
    expect(await ledgerRows()).toBe(before);
  });

  it('a tile the owner dismissed stays away: the plan keeps its place, the tile is not put back', async () => {
    expect((await apiJson('DELETE', '/v1/surfaces/briefing/practice', { token: p.D })).status).toBeLessThan(300);
    const r = await growth();
    expect(r.body.guitar).toMatchObject({ tile: null, reason: 'nudge_repeat' });
    expect(r.body.guitar.plan).not.toBeNull();
    expect(await slot('briefing', 'practice')).toBeUndefined();
    expect(r.body.study.tile).not.toBeNull();
  });
});
