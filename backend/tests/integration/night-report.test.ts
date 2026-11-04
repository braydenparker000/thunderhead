// Night step 12, the report (BRIEFING.md "The report card"; PUT /v1/briefing/report/:day): the
// night key only, from a claimed, live, untainted session, for a closed day with a night run;
// the limits and the lint; a ledger ref only to a row the night wrote. The same body again
// writes nothing; a new body from the same session replaces it (a ledger row whose undo brings
// the one before back); another session's is 409. Put first, it is the open day's first message
// (author mind, origin night) while the owner hasn't written, else a tile only; the tile is the
// Briefing's first, its lines' Undo the rows they name. The counts are the Worker's, again at the
// run's end. The owner's zone is set to one where it is about noon, past the quiet hours' end.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, Surface, TodayResponse } from '../../../shared/contract/api';
import type { BriefingResponse, ReportTile } from '../../../shared/contract/briefing.ts';
import type { NightReport } from '../../../shared/contract/night-report.ts';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, CHAT_SESSION, freshSession, ops, ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
let today = '';
let yday = '';
let S1 = '';
let tileLedger = '';
const put = (session: string, body: object, day = yday, token = p.N) =>
  apiJson<NightReport & ErrorBody>('PUT', `/v1/briefing/report/${day}`, { ...as(token, session), body });
const report = (headline: string, ref: string | null = `ledger:${tileLedger}`) => ({
  headline,
  lines: [
    { kind: 'built', text: 'Put a reading tile on the Briefing for chapter 3', ref },
    { kind: 'note', text: 'Nothing else needed doing' },
  ],
});
const tiles = async () => (await apiJson<BriefingResponse>('GET', '/v1/briefing', { token: p.D })).body.tiles;
const messages = async () => (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.messages;
const ledgerRows = async () => (await coreSql<{ n: number }>('SELECT count(*) AS n FROM ledger'))[0].n;

beforeAll(async () => {
  p = await principals();
  // About noon in the owner's zone, whatever the hour the suite runs.
  const off = (((12 - new Date().getUTCHours()) % 24) + 24) % 24;
  const k = off > 12 ? off - 24 : off;
  await coreSql(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.tz', ?, 0, 'owner')
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    JSON.stringify(k === 0 ? 'Etc/GMT' : `Etc/GMT${k > 0 ? '-' : '+'}${Math.abs(k)}`),
  );
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
  yday = dayBefore(today);
  S1 = await freshSession(p.N, 'night', 'cse_report_night_1');
});

describe('the night’s report', () => {
  it('is the night key’s only, from a claimed session, for a closed day with a run, within the limits', async () => {
    expect((await put(S1, report('A quiet night', null), yday, p.D)).status).toBe(403);
    expect((await put(CHAT_SESSION, report('A quiet night', null), yday, p.C)).status).toBe(403);
    expect((await put('cse_never_claimed', report('A quiet night', null))).body.error?.code).toBe('session_required');
    expect((await put(S1, report('A quiet night', null))).status).toBe(422); // no run yet
    const start = await apiJson('POST', '/v1/mind/night', { ...as(p.N, S1), body: { day: yday, action: 'start' } });
    expect(start.status).toBe(200);
    expect((await put(S1, report('A quiet night', null), today)).status).toBe(422);
    const tile = await apiJson<Surface>('PUT', '/v1/surfaces/briefing/study', {
      ...as(p.N, S1),
      body: {
        kind: 'tile',
        schema: 1,
        payload: { label: 'Study', value: 'Book A, chapter 3', app: 'study', path: '/study/?book=b1' },
        why: 'From the reading plan you agreed.',
        topic_key: 'study.today',
      },
    });
    expect(tile.status).toBe(200);
    tileLedger = tile.body.ledger_id as string;
    const owner = await coreSql<{ id: string }>("SELECT id FROM ledger WHERE actor = 'owner' LIMIT 1");
    for (const bad of [
      report('A great night!'),
      report('x'.repeat(61)),
      { headline: 'Fine', lines: Array.from({ length: 7 }, () => ({ kind: 'note', text: 'One more thing' })) },
      { headline: 'Fine', lines: [{ kind: 'note', text: '**Bold** words' }] },
      { headline: 'Fine', lines: [{ kind: 'gossip', text: 'Plain words' }] },
      { headline: 'Fine', lines: [{ kind: 'note', text: 'Plain words', ref: 'song:abc' }] },
      ...(owner[0] ? [report('Fine', `ledger:${owner[0].id}`)] : []),
      report('Fine', 'ledger:0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee'),
    ])
      expect((await put(S1, bad)).status, JSON.stringify(bad)).toBe(422);
  });

  it('put first, it is the open day’s first message and the Briefing’s first tile; again, nothing changes', async () => {
    const before = await ledgerRows();
    const r = await put(S1, report('A quiet night, one tile placed'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ day: yday, headline: 'A quiet night, one tile placed' });
    expect(r.body.counts).toMatchObject({ facts_added: 0, predictions: 0, steps_cut: [], songs_noted: null });
    const [m] = await messages();
    expect(m).toMatchObject({
      id: r.body.message_id,
      author: 'mind',
      origin: 'night',
      kind: 'text',
      meta: { report: yday },
    });
    expect(m.body).toBe(
      'A quiet night, one tile placed\n\n- Put a reading tile on the Briefing for chapter 3\n- Nothing else needed doing',
    );
    expect(await ledgerRows()).toBe(before + 1);
    const again = await put(S1, report('A quiet night, one tile placed'));
    expect(again.body.ledger_id).toBe(r.body.ledger_id);
    expect(await ledgerRows()).toBe(before + 1);
    expect(await messages()).toHaveLength(1);
    const [first] = (await tiles()) as ReportTile[];
    expect(first).toMatchObject({
      kind: 'report',
      label: 'Overnight',
      value: 'A quiet night, one tile placed',
      day: yday,
    });
    expect(first.lines[0]).toMatchObject({ ledger_id: tileLedger, undo: 'open', path: null });
    expect(first.lines[1]).toMatchObject({ ledger_id: null, undo: null });
  });

  it('a line’s Undo is its row’s: undone, the line says so', async () => {
    expect((await apiJson('POST', `/v1/ledger/${tileLedger}/undo`, { token: p.D })).status).toBe(200);
    const [first] = (await tiles()) as ReportTile[];
    expect(first.lines[0]).toMatchObject({ ledger_id: tileLedger, undo: 'undone' });
    expect((await tiles()).some((t) => t.kind === 'night')).toBe(false);
  });

  it('a new one from the same session replaces it, with an undo; another session’s is 409; a tainted one 403', async () => {
    const was = (await put(S1, report('A quiet night, one tile placed'))).body.ledger_id;
    const r = await put(S1, report('A quiet night, the tile taken back'));
    expect(r.status).toBe(200);
    expect(r.body.ledger_id).not.toBe(was);
    expect(((await tiles())[0] as ReportTile).value).toBe('A quiet night, the tile taken back');
    expect(await messages()).toHaveLength(1); // the chat is never rewritten
    expect((await apiJson('POST', `/v1/ledger/${r.body.ledger_id}/undo`, { token: p.D })).status).toBe(200);
    expect(((await tiles())[0] as ReportTile).value).toBe('A quiet night, one tile placed');
    const S2 = await freshSession(p.N, 'night', 'cse_report_night_2');
    expect((await put(S2, report('Another session’s night'))).status).toBe(409);
    await apiJson('POST', '/v1/mind/taint', { ...as(p.N, S1), body: { source: 'Read', ref_kind: 'file' } });
    expect((await put(S1, report('A quiet night, one tile placed'))).status).toBe(200);
    expect((await put(S1, report('After reading outside text'))).body.error?.code).toBe('session_tainted');
  });

  it('counts the night’s own rows, again at the run’s end; once the owner has written, it is a tile only', async () => {
    const S3 = await freshSession(p.N, 'night', 'cse_report_night_3');
    const said = await ownerSays(p.D, 'I like calm music in the evening');
    const added = await ops(as(p.N, S3), [addOp([`msg:${said}`])]);
    expect(added.body.applied, JSON.stringify(added.body)).toHaveLength(1);
    await coreSql('DELETE FROM night_reports');
    const r = await put(S3, {
      headline: 'One thing kept',
      lines: [
        { kind: 'memory', text: 'Kept that you like calm music', ref: `ledger:${added.body.applied[0].ledger_id}` },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.message_id).toBeNull();
    expect(r.body.counts.facts_added).toBe(1);
    expect((await messages()).filter((m) => m.origin === 'night')).toHaveLength(1);
    const done = await apiJson('POST', '/v1/mind/night', {
      ...as(p.N, S1),
      body: { day: yday, action: 'done', partial: true },
    });
    expect(done.status).toBe(200);
    const [first] = (await tiles()) as ReportTile[];
    expect(first.cut.length).toBeGreaterThan(0);
    expect(first.detail).toBe('1 fact');
  });
});
