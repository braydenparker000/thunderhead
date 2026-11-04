// What lands (BEHAVIOR.md §3.6, API.md §11.12) against the real Worker, in UTC: three home lines on a
// topic, each seen and passed over, send it to rest for 30 days when What lands is counted (GET
// /v1/insight/topics); a surface on it is then 422 topic_quiet with the day it reopens; the briefing
// lists it with the sentence to say once, which the mind records once; the owner reopens it by a tap
// or in their own words (checked as a card's), and its streak starts again. A kept between holds the
// rule back. Odds on cards: required on an arrangement's, within 0.05–0.95; the calibration of the
// last 28 days, by category and for the cards, in its route and the briefing. Synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, ErrorBody, LedgerEntry } from '../../../shared/contract/api';
import type { TopicsResponse } from '../../../shared/contract/lands.ts';
import type { CalibrationResponse } from '../../../shared/contract/predictions.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import { api, apiJson, coreSql } from '../helpers';
import { as, CHAT_SESSION, mindSays, ownerSays, type Principals, principals, SHA } from '../memory-helpers';

let p = {} as Principals;
const chat = () => as(p.C, CHAT_SESSION);
const line = (slot: string, topic: string, over: object = {}) =>
  apiJson<{ ledger_id: string } & ErrorBody>('PUT', `/v1/surfaces/${slot}`, {
    ...chat(),
    body: {
      kind: slot.startsWith('briefing') ? 'tile' : 'line',
      schema: 1,
      payload: slot.startsWith('briefing')
        ? { label: 'Practice', value: 'Bars 9 to 12' }
        : { text: 'Two new episodes are in.' },
      why: 'New episodes came in overnight.',
      topic_key: topic,
      ...over,
    },
  });
const topics = async () => (await apiJson<TopicsResponse>('GET', '/v1/insight/topics', { token: p.D })).body.items;
const readBrief = async () =>
  (
    await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...chat(),
      body: { claim: false, session_id: CHAT_SESSION, role: 'chat', constitution_sha256: SHA, th_version: '0.1.0' },
    })
  ).body.core;
/** The ledger row placed `daysAgo` days back, and how the owner met it (`seen`, `tapped`, or nothing). */
async function backdate(id: string, daysAgo: number, met: 'seen' | 'tapped' | null) {
  const at = Date.now() - daysAgo * DAY;
  await coreSql('UPDATE ledger SET at = ? WHERE id = ?', at, id);
  if (!met) return;
  const type = met === 'seen' ? 'line.seen' : 'briefing.tile';
  const r = await api('PUT', `/v1/senses/batches/${uuidv7()}`, {
    token: p.D,
    body: { events: [{ id: uuidv7(at + 60_000), at: at + 60_000, type, ref: `ledger:${id}` }] },
  });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  p = await principals();
  await apiJson('PATCH', '/v1/settings', {
    token: p.D,
    body: { 'owner.tz': 'UTC', 'quiet.start': '06:30', 'quiet.end': '06:30' },
  });
});

describe('the quiet rule', () => {
  it('three passed over in a row: the topic rests 30 days, said once, reopened by a tap', async () => {
    for (const [slot, ago] of [
      ['home/line.1', 9],
      ['home/line.2', 6],
      ['home/line.3', 3],
    ] as const) {
      const r = await line(slot, 'episodes.new');
      expect(r.status).toBe(200);
      await backdate(r.body.ledger_id, ago, 'seen');
    }
    const before = Date.now();
    const [ep] = await topics();
    expect(ep).toMatchObject({
      topic_key: 'episodes.new',
      places: ['home'],
      kept: 0,
      ignored: 3,
      unseen: 0,
      streak: 3,
      said: false,
    });
    expect(ep.quiet_until).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(ep.reopens).toBe(new Date(ep.quiet_until as number).toISOString().slice(0, 10));
    // The Worker's own ledger row says so.
    const rows = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=20', { token: p.D })).body.items;
    expect(rows.find((l) => l.actor === 'worker' && l.topic_key === 'episodes.new')?.what).toBe(
      `topic episodes.new rests until ${ep.reopens}`,
    );
    // A surface on it is refused with the day it reopens; another topic is not.
    const refused = await line('home/line.4', 'episodes.new');
    expect([refused.status, refused.body.error.code]).toEqual([422, 'topic_quiet']);
    expect(refused.body.error.details).toEqual({ until: ep.quiet_until, reopens: ep.reopens });
    expect((await line('home/line.4', 'weather.walk')).status).toBe(200);
    // The briefing lists it, worst first, with the sentence to say once until it is recorded.
    let core = await readBrief();
    expect(core).toContain(`episodes.new (home) 0/0/3/0 · 3 in a row · rests until ${ep.reopens}, not said yet`);
    expect(core).toContain('th surface said <topic> (episodes.new)');
    const said = await apiJson<{ said_at: number }>('POST', '/v1/surfaces/topics/episodes.new/said', {
      ...chat(),
      body: {},
    });
    expect(said.status).toBe(200);
    const again = await apiJson<ErrorBody>('POST', '/v1/surfaces/topics/episodes.new/said', { ...chat(), body: {} });
    expect([again.status, again.body.error.code]).toEqual([409, 'already_said']);
    core = await readBrief();
    expect(core).toContain(`episodes.new (home) 0/0/3/0 · 3 in a row · rests until ${ep.reopens}\n`);
    expect(core).not.toContain('Say once');
    // The owner reopens it with a tap: its streak starts again, and the mind may place it.
    const open = await apiJson<{ topic_key: string; ledger_id: string }>(
      'POST',
      '/v1/surfaces/topics/episodes.new/reopen',
      {
        token: p.D,
        body: {},
      },
    );
    expect([open.status, open.body.topic_key]).toEqual([200, 'episodes.new']);
    const twice = await apiJson<ErrorBody>('POST', '/v1/surfaces/topics/episodes.new/reopen', { token: p.D, body: {} });
    expect([twice.status, twice.body.error.code]).toEqual([409, 'conflict']);
    expect((await line('home/line.4', 'episodes.new')).status).toBe(200);
    expect((await topics()).find((t) => t.topic_key === 'episodes.new')).toMatchObject({
      streak: 0,
      quiet_until: null,
    });
    // Only the owner and the chat reopen; only the mind records what it said.
    expect((await api('POST', '/v1/surfaces/topics/episodes.new/reopen', { token: p.N, body: {} })).status).toBe(403);
    expect((await api('POST', '/v1/surfaces/topics/episodes.new/said', { token: p.D, body: {} })).status).toBe(403);
  });

  it('a kept between holds the rule back: ignored, ignored, kept, ignored is one in a row', async () => {
    const met = [
      ['briefing/practice', 8, null],
      ['briefing/practice', 7, null],
      ['briefing/practice', 5, 'tapped'],
      ['home/line.2', 3, 'seen'],
    ] as const;
    for (const [slot, ago, how] of met) {
      const r = await line(slot, 'practice.bars');
      expect(r.status).toBe(200);
      await backdate(r.body.ledger_id, ago, how);
    }
    const bars = (await topics()).find((t) => t.topic_key === 'practice.bars');
    expect(bars).toMatchObject({ places: ['home', 'briefing'], kept: 1, ignored: 3, streak: 1, quiet_until: null });
  });

  it('reopened in the owner’s own words, checked as a card’s', async () => {
    const old = await ownerSays(p.D, 'Those calm playlists are fine.');
    const now = Date.now();
    await coreSql(
      'INSERT INTO topics (topic_key, shown_count, quiet_from, quiet_until) VALUES (?, 0, ?, ?)',
      'music.calm',
      now,
      now + 30 * DAY,
    );
    await new Promise((r) => setTimeout(r, 5));
    const mine = await mindSays(p.C, 'I stopped suggesting calm playlists.');
    const words = await ownerSays(p.D, 'Bring the calm playlists back.');
    const reopen = (body: object, call: object = chat()) =>
      apiJson<ErrorBody>('POST', '/v1/surfaces/topics/music.calm/reopen', { ...call, body });
    expect((await reopen({})).body.error.code).toBe('validation');
    expect((await reopen({ by_message: mine })).body.error.code).toBe('not_owner_words');
    expect((await reopen({ by_message: old })).body.error.code).toBe('not_owner_words');
    expect((await reopen({ by_message: words }, { token: p.D })).body.error.code).toBe('validation');
    const ok = await reopen({ by_message: words });
    expect(ok.status).toBe(200);
    const row = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?limit=5', { token: p.D })).body.items[0];
    expect([row.actor, row.what, row.ref]).toEqual(['owner', 'topic music.calm reopened', `msg:${words}`]);
    expect((await api('POST', '/v1/surfaces/topics/no.such/reopen', { token: p.D, body: {} })).status).toBe(404);
  });
});

describe('odds on cards', () => {
  const card = (over: object = {}) => ({
    class: 'permit',
    question: 'May I switch to the night look?',
    why: 'Your standing permission says to ask first.',
    if_ignored: 'Nothing happens.',
    options: ['Do it', 'Not now'],
    spec: { v: 1, op: 'permit.allow', args: { action: 'shell.appearance', call: 'b'.repeat(64) } },
    ...over,
  });
  const raise = (body: object) =>
    apiJson<{ id: string; spec_hash: string } & ErrorBody>('PUT', `/v1/proposals/${uuidv7()}`, { ...chat(), body });

  it('an arrangement’s card needs odds within 0.05–0.95; a floor’s may leave them out', async () => {
    const none = await raise(card());
    expect([none.status, none.body.error.details]).toEqual([
      422,
      [{ path: 'odds', issue: expect.stringContaining('required') }],
    ]);
    expect((await raise(card({ odds: 0.99 }))).status).toBe(422);
    expect((await raise(card({ odds: 0.01 }))).status).toBe(422);
    const ok = await raise(card({ odds: 0.8 }));
    expect(ok.status).toBe(201);
    await apiJson('POST', `/v1/proposals/${ok.body.id}/decide`, {
      token: p.D,
      body: { decision: 'approve', spec_hash: ok.body.spec_hash },
    });
    const no = await raise(
      card({
        odds: 0.6,
        spec: { v: 1, op: 'permit.allow', args: { action: 'shell.appearance', call: 'c'.repeat(64) } },
      }),
    );
    expect(no.status).toBe(201);
    await apiJson('POST', `/v1/proposals/${no.body.id}/decide`, {
      token: p.D,
      body: { decision: 'reject', spec_hash: no.body.spec_hash },
    });
  });

  it('the calibration: odds claimed against what happened, by category and for the cards', async () => {
    const at = Date.now() - DAY;
    for (const outcome of [1, 0])
      await coreSql(
        `INSERT INTO predictions (id, made_at, made_by, category, args_json, day, p, why, outcome, base, resolved_at, req_sha256)
         VALUES (?, ?, 'mind:night', 'chat.any', '{}', '2026-11-01', 0.7, 'synthetic', ?, 0.5, ?, 'x')`,
        uuidv7(),
        at,
        outcome,
        at,
      );
    const r = await apiJson<CalibrationResponse>('GET', '/v1/predictions/calibration', { token: p.N });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      days: 28,
      items: [
        { category: 'chat.any', n: 2, claimed: 0.7, right: 0.5, brier: 0.29 },
        { category: 'cards', n: 2, claimed: 0.7, right: 0.5, brier: 0.2 },
      ],
    });
    expect(await readBrief()).toContain(
      'Your odds last 28 days: chat.any 50 % right of 70 % claimed (2) · cards 50 % right of 70 % claimed (2)',
    );
  });
});
