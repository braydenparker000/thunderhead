// The owner's reminders over HTTP (HOME.md §6.2, BEHAVIOR.md §3.4, API.md §11.24): set from the
// phone or by the chat mind naming the owner's recent message; the same request again is the same
// answer; the time checked and moved out of the owner's quiet hours; at most 50 set; listed soonest
// first with the last day's delivered and taken back; taken back once, not after delivery.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody } from '../../../shared/contract/api';
import type { Reminder, ReminderResponse, RemindersResponse } from '../../../shared/contract/reminders.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY, HOUR, MINUTE, ownerDay, zonedMinute } from '../../src/lib/time';
import { api, apiJson, core, coreSql, rowsDuring } from '../helpers';
import { as, CHAT_SESSION, freshSession, mindSays, ownerSays, principals } from '../memory-helpers';

type Out = ReminderResponse & ErrorBody;
const TZ = 'Pacific/Chatham';
let D = '';
let C = '';
let N = '';

const put = (body: object, token = D, id = uuidv7(), headers: Record<string, string> = {}) =>
  apiJson<Out>('PUT', `/v1/reminders/${id}`, { token, body, headers });
const chat = (session = CHAT_SESSION) => ({ 'TH-Session': session });
const issue = (r: { body: Out }) => {
  const d = r.body.error?.details;
  return Array.isArray(d) ? d[0] : undefined;
};
/** An instant `days` from today at a local wall time in the owner's zone. */
const local = (days: number, hh: number, mm = 0) =>
  zonedMinute(ownerDay(Date.now() + days * DAY, TZ), hh * 60 + mm, TZ);
const list = async (token = D) => (await apiJson<RemindersResponse>('GET', '/v1/reminders', { token })).body.items;

beforeAll(async () => {
  ({ D, C, N } = await principals());
  await api('PATCH', '/v1/settings', {
    token: D,
    body: { 'owner.tz': TZ, 'quiet.start': '22:00', 'quiet.end': '06:30' },
  });
});

describe('set from the phone', () => {
  it('is kept under its id; the same request again is the same answer, another body a conflict', async () => {
    const id = uuidv7();
    const at = local(2, 15);
    const first = await put({ text: '  Call the garage  ', at }, D, id);
    expect(first.status).toBe(201);
    expect(first.body.reminder).toMatchObject({
      id,
      text: 'Call the garage',
      at,
      fire_at: at,
      state: 'set',
      origin: 'owner_device',
      fired_at: null,
      message_id: null,
    } satisfies Partial<Reminder>);
    const again = await put({ text: '  Call the garage  ', at }, D, id);
    expect([again.status, again.body]).toEqual([200, first.body]);
    const other = await put({ text: 'Call the garage', at }, D, id);
    expect([other.status, other.body.error.code]).toEqual([409, 'conflict']);
  });

  it('refuses words that are empty, too long or not one plain line, and fields it does not know', async () => {
    const at = local(2, 15);
    for (const text of ['', '   ', 'x'.repeat(201), 'two\nlines', 'a\ttab', 'bell\u0007', 'pay \u202ebad', 'a\u2028b'])
      expect((await put({ text, at })).status, JSON.stringify(text)).toBe(422);
    expect((await put({ text: `  ${'x'.repeat(200)}  `, at })).status).toBe(201);
    expect((await put({ text: 'Water the plants', at, why: 'extra' })).status).toBe(422);
    expect((await put({ text: 'Water the plants', at: at + 0.5 })).status).toBe(422);
    expect((await put({ text: 'Water the plants' })).status).toBe(422);
  });

  it('a time more than a minute past or more than 400 days ahead is refused', async () => {
    const now = Date.now();
    const past = await put({ text: 'Too late', at: now - 2 * MINUTE });
    expect([past.status, issue(past)?.path]).toEqual([422, 'at']);
    expect((await put({ text: 'Just now', at: now - 30_000 })).status).toBe(201);
    const far = await put({ text: 'Far off', at: now + 401 * DAY });
    expect([far.status, issue(far)?.path]).toEqual([422, 'at']);
    expect((await put({ text: 'Far but fine', at: now + 399 * DAY })).status).toBe(201);
  });

  it('the phone names no source message', async () => {
    const msg = await ownerSays(D, 'remind me later');
    const r = await put({ text: 'Later', at: local(1, 15), source_message_id: msg });
    expect([r.status, issue(r)?.path]).toEqual([422, 'source_message_id']);
  });
});

describe('quiet hours (22:00–06:30 in the owner’s zone)', () => {
  const fire = async (at: number) => (await put({ text: 'Check the oven', at })).body.reminder.fire_at;

  it('just before, inside before and after midnight, at the end and after', async () => {
    expect(await fire(local(1, 21, 59))).toBe(local(1, 21, 59));
    expect(await fire(local(1, 22))).toBe(local(2, 6, 30));
    expect(await fire(local(1, 23, 30))).toBe(local(2, 6, 30));
    expect(await fire(local(2, 2))).toBe(local(2, 6, 30));
    expect(await fire(local(2, 6, 30))).toBe(local(2, 6, 30));
    expect(await fire(local(2, 9))).toBe(local(2, 9));
  });

  it('a later end moves it there; an end stored before 06:30 still moves it to 06:30', async () => {
    await api('PATCH', '/v1/settings', { token: D, body: { 'quiet.end': '07:45' } });
    expect(await fire(local(2, 7))).toBe(local(2, 7, 45));
    // An earlier build could not store it either; the rule holds even so.
    await coreSql(`UPDATE settings SET value_json = '"05:00"' WHERE key = 'quiet.end'`);
    expect(await fire(local(2, 4))).toBe(local(2, 6, 30));
    await api('PATCH', '/v1/settings', { token: D, body: { 'quiet.end': '06:30' } });
  });
});

describe('at most 50 set at once', () => {
  it('the 51st is refused with its reason; one delivered or taken back frees a place', async () => {
    const open = (await coreSql<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE state = 'set'"))[0].n;
    const filler: string[] = [];
    for (let i = open; i < 50; i++) {
      const id = uuidv7();
      filler.push(id);
      await coreSql(
        `INSERT INTO reminders (id, text, at, fire_at, state, origin, created_at, req_sha256)
         VALUES (?, 'Filler', ?, ?, 'set', 'owner_device', ?, 'x')`,
        id,
        local(3, 12),
        local(3, 12),
        Date.now(),
      );
    }
    const refused = await put({ text: 'One more', at: local(3, 13) });
    expect([refused.status, refused.body.error.code]).toEqual([422, 'validation']);
    expect(issue(refused)?.issue).toMatch(/at most 50/);
    expect((await apiJson('DELETE', `/v1/reminders/${filler[0]}`, { token: D })).status).toBe(200);
    expect((await put({ text: 'One more', at: local(3, 13) })).status).toBe(201);
    await coreSql(`UPDATE reminders SET state = 'cancelled', cancelled_at = ? WHERE text = 'Filler'`, Date.now());
  });
});

describe('set by the chat mind', () => {
  it("names a recent owner message: not the mind's, not a missing or old one, at most 3 from it", async () => {
    const asked = await ownerSays(D, 'remind me at 3 to call the bank');
    const at = local(1, 15);
    const none = await put({ text: 'Call the bank', at }, C, uuidv7(), chat());
    expect([none.status, issue(none)?.path]).toEqual([422, 'source_message_id']);
    const mine = await mindSays(C, 'Noted.');
    const wrong = await put({ text: 'Call the bank', at, source_message_id: mine }, C, uuidv7(), chat());
    expect([wrong.status, issue(wrong)?.path]).toEqual([422, 'source_message_id']);
    const missing = await put({ text: 'Call the bank', at, source_message_id: uuidv7() }, C, uuidv7(), chat());
    expect(missing.status).toBe(422);
    for (let i = 0; i < 3; i++) {
      const r = await put({ text: `Call the bank ${i}`, at, source_message_id: asked }, C, uuidv7(), chat());
      expect([r.status, r.body.reminder?.origin]).toEqual([201, 'mind']);
    }
    const fourth = await put({ text: 'Call the bank again', at, source_message_id: asked }, C, uuidv7(), chat());
    expect([fourth.status, issue(fourth)?.issue]).toEqual([422, 'at most 3 reminders from one message']);
    const old = await ownerSays(D, 'remind me tomorrow');
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', Date.now() - 49 * HOUR, old);
    const stale = await put({ text: 'Tomorrow', at, source_message_id: old }, C, uuidv7(), chat());
    expect([stale.status, issue(stale)?.issue]).toEqual([422, 'older than 48 hours']);
  });

  it('only from its claimed, clean session: a tainted one is refused as memory writes are', async () => {
    const asked = await ownerSays(D, 'remind me to stretch');
    const body = { text: 'Stretch', at: local(1, 16), source_message_id: asked };
    const bare = await put(body, C);
    expect([bare.status, bare.body.error.code]).toEqual([403, 'session_required']);
    const t = await apiJson('POST', '/v1/mind/taint', {
      ...as(C, CHAT_SESSION),
      body: { source: 'WebFetch', ref_kind: 'url' },
    });
    expect(t.status).toBe(200);
    const tainted = await put(body, C, uuidv7(), chat());
    expect([tainted.status, tainted.body.error.code]).toEqual([403, 'session_tainted']);
    // The rest of the file writes from a session fired since (the lease handed back first).
    await apiJson('POST', '/v1/mind/status', { ...as(C, CHAT_SESSION), body: { state: 'stopping' } });
    const clean = await freshSession(C, 'chat', 'cse_reminders_clean_2');
    expect((await put(body, C, uuidv7(), chat(clean))).status).toBe(201);
    // The night shift reads them, never sets one.
    expect((await put(body, N, uuidv7(), chat(clean))).status).toBe(403);
    expect((await apiJson('GET', '/v1/reminders', { token: N })).status).toBe(200);
  });

  it('its words pass the phrase lint, and it sets at most 5 in any 24 hours', async () => {
    const session = chat('cse_reminders_clean_2');
    const asked = await ownerSays(D, 'remind me about the car');
    const at = local(1, 17);
    const say = (text: string, source = asked) => put({ text, at, source_message_id: source }, C, uuidv7(), session);
    const banned = await say('Great question: the car');
    expect([banned.status, issue(banned)?.path]).toEqual([422, 'text']);
    expect((await say('The car \u{1F697}')).status).toBe(422);
    const set = Number((await coreSql("SELECT count(*) AS n FROM reminders WHERE origin = 'mind'"))[0]?.n);
    expect(set).toBe(4); // 3 for the bank and one stretch
    expect((await say('The car')).status).toBe(201);
    const sixth = await say('The car again', await ownerSays(D, 'and the tyres'));
    expect([sixth.status, issue(sixth)?.issue]).toEqual([422, 'at most 5 reminders from the mind in 24 hours']);
    await coreSql("UPDATE reminders SET created_at = ? WHERE origin = 'mind' AND text LIKE 'Call%'", Date.now() - DAY);
    expect((await say('The tyres', await ownerSays(D, 'and the tyres'))).status).toBe(201);
  });
});

describe('listed and taken back', () => {
  it('set soonest first, then the last day’s delivered and taken back, newest first', async () => {
    await coreSql('DELETE FROM reminders'); // test-only: a clean list
    const later = (await put({ text: 'Later one', at: local(2, 18) })).body.reminder;
    const sooner = (await put({ text: 'Sooner one', at: local(1, 18) })).body.reminder;
    const gone = (await put({ text: 'Taken back', at: local(1, 19) })).body.reminder;
    const done = (await put({ text: 'Delivered', at: local(1, 20) })).body.reminder;
    await apiJson('DELETE', `/v1/reminders/${gone.id}`, { token: D });
    await coreSql(
      `UPDATE reminders SET state = 'done', fired_at = ?, message_id = ? WHERE id = ?`,
      Date.now() + 1,
      uuidv7(),
      done.id,
    );
    expect((await list()).map((r) => r.text)).toEqual(['Sooner one', 'Later one', 'Delivered', 'Taken back']);
    await coreSql('UPDATE reminders SET fired_at = ? WHERE id = ?', Date.now() - DAY - MINUTE, done.id);
    expect((await list(C)).map((r) => r.id)).toEqual([sooner.id, later.id, gone.id]);
  });

  it('taking back: once, again the same answer, not after delivery, 404 for none', async () => {
    const r = (await put({ text: 'Feed the cat', at: local(1, 17) })).body.reminder;
    const del = await apiJson<Out>('DELETE', `/v1/reminders/${r.id}`, { token: D });
    expect([del.status, del.body.reminder.state]).toEqual([200, 'cancelled']);
    const again = await apiJson<Out>('DELETE', `/v1/reminders/${r.id}`, { token: D });
    expect([again.status, again.body]).toEqual([200, del.body]);
    expect(await coreSql('SELECT state FROM reminders WHERE id = ?', r.id)).toEqual([{ state: 'cancelled' }]);
    const sent = (await put({ text: 'Sent already', at: local(1, 17) })).body.reminder;
    await coreSql(`UPDATE reminders SET state = 'done', fired_at = ? WHERE id = ?`, Date.now(), sent.id);
    const late = await apiJson<Out>('DELETE', `/v1/reminders/${sent.id}`, { token: D });
    expect([late.status, late.body.error.code]).toEqual([410, 'expired']);
    const none = await apiJson<Out>('DELETE', `/v1/reminders/${uuidv7()}`, { token: D });
    expect([none.status, none.body.error.code]).toEqual([404, 'not_found']);
    expect((await api('DELETE', '/v1/reminders/not-an-id', { token: D })).status).toBe(422);
  });

  it('the chat mind takes one back only from a clean session', async () => {
    const r = (await put({ text: 'Book the table', at: local(1, 12) })).body.reminder;
    const session = 'cse_reminders_clean_2';
    await apiJson('POST', '/v1/mind/taint', { ...as(C, session), body: { source: 'WebFetch', ref_kind: 'url' } });
    const tainted = await apiJson<Out>('DELETE', `/v1/reminders/${r.id}`, { token: C, headers: chat(session) });
    expect([tainted.status, tainted.body.error.code]).toEqual([403, 'session_tainted']);
    await apiJson('POST', '/v1/mind/status', { ...as(C, session), body: { state: 'stopping' } });
    const clean = await freshSession(C, 'chat', 'cse_reminders_clean_3');
    const asked = await ownerSays(D, 'never mind the table');
    const del = await apiJson<Out>('DELETE', `/v1/reminders/${r.id}?source_message_id=${asked}`, {
      token: C,
      headers: chat(clean),
    });
    expect([del.status, del.body.reminder.state]).toEqual([200, 'cancelled']);
  });

  it("the mind takes back the owner's own only when the owner asked; its own freely", async () => {
    const session = chat('cse_reminders_clean_3');
    const owners = (await put({ text: 'Water the plants', at: local(1, 13) })).body.reminder;
    const take = (q = '') => apiJson<Out>('DELETE', `/v1/reminders/${owners.id}${q}`, { token: C, headers: session });
    const bare = await take();
    expect([bare.status, issue(bare)?.path]).toEqual([422, 'source_message_id']);
    const mine = await mindSays(C, 'I can take that back.');
    expect((await take(`?source_message_id=${mine}`)).status).toBe(422);
    expect((await take('?source_message_id=not-an-id')).status).toBe(422);
    const old = await ownerSays(D, 'forget the plants');
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', Date.now() - 49 * HOUR, old);
    expect((await take(`?source_message_id=${old}`)).status).toBe(422);
    expect(await coreSql('SELECT state FROM reminders WHERE id = ?', owners.id)).toEqual([{ state: 'set' }]);
    const asked = await ownerSays(D, 'forget the plants');
    const ok = await put({ text: 'Plants later', at: local(1, 14), source_message_id: asked }, C, uuidv7(), session);
    const own = await apiJson<Out>('DELETE', `/v1/reminders/${ok.body.reminder.id}`, { token: C, headers: session });
    expect([own.status, own.body.reminder.state]).toEqual([200, 'cancelled']);
  });

  it('reads do not grow with the table: old reminders cost the list nothing', async () => {
    const old = Date.now() - 3 * DAY;
    for (let i = 0; i < 300; i++)
      await coreSql(
        `INSERT INTO reminders (id, text, at, fire_at, state, origin, created_at, cancelled_at, req_sha256)
         VALUES (?, 'Old one', ?, ?, 'cancelled', 'owner_device', ?, ?, 'x')`,
        uuidv7(),
        old,
        old,
        old,
        old + i,
      );
    const rows = await rowsDuring(core(), () => api('GET', '/v1/reminders', { token: D }));
    expect(rows.read).toBeLessThan(40);
    const put = await rowsDuring(core(), () =>
      api('PUT', `/v1/reminders/${uuidv7()}`, { token: D, body: { text: 'New', at: local(1, 12) } }),
    );
    expect(put.read).toBeLessThan(80);
  });
});
