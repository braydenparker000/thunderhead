// Batch 2 of the verbs (shared/contract/verbs-apps.ts, verbs-shell.ts; API.md §11.11): the apps'
// arrangements (a shortlist in Astra and My Media, Study's next passage, Guitar's plan), each in
// its app's one slot with its why, as the verb's own `arrangement` ledger row the meter counts;
// Study's pace from the owner's words; a conversation filed under a topic; a standing reminder rule. Per verb: it works, its undo puts back what was there, it is
// refused under ask without a card, and law 8 keeps every verb off its topics. Everything is synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message, SurfacesResponse, Thread, Verb } from '../../../shared/contract/api';
import type { ReminderResponse } from '../../../shared/contract/reminders.ts';
import type { SenseBatchResponse } from '../../../shared/contract/senses.ts';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { ownerSays } from '../memory-helpers';
import { chat, P, setup } from '../proposal-helpers';
import { doneNow, ledgerRow, refusal, settings, settle, undo, verb } from '../verb-helpers';

beforeAll(setup);

const slot = async (app: string, name: string) =>
  (await apiJson<SurfacesResponse>('GET', '/v1/surfaces', { token: P.D })).body.items.find(
    (s) => s.app === app && s.slot === name,
  );
const two = [
  { ref: 'astra:movie:101', title: 'A Quiet Harbour' },
  { ref: 'astra:movie:102', title: 'The Long Field' },
];

describe('the arrangements: a shortlist, the next passage, the plan', () => {
  it('astra.shortlist places three for tonight with its why, as an arrangement row; its undo clears it', async () => {
    const r = await doneNow(await verb('astra.shortlist', { titles: two, filters: ['under two hours'] }));
    expect(r.result).toEqual({ placed: 'astra/tonight' });
    expect(r.permit).toEqual({ action: 'astra.shortlist', class: 'watch', position: 'tell' });
    const s = await slot('astra', 'tonight');
    expect(s).toMatchObject({ kind: 'shortlist', why: 'the owner asked for it just now', topic_key: 'astra.tonight' });
    expect(s?.payload).toMatchObject({ titles: two, filters: ['under two hours'] });
    expect(await ledgerRow(r.ledger_id)).toMatchObject({
      kind: 'arrangement',
      what: 'astra/tonight ← shortlist',
      undoable: true,
    });
    // Astra reports it seen and taken up, by its row, as the meter reads it (insight/meter.ts).
    const events = ['arrangement.seen', 'arrangement.tap'].map((type) => ({
      id: uuidv7(),
      at: Date.now(),
      type,
      ref: `ledger:${r.ledger_id}`,
    }));
    const batch = await apiJson<SenseBatchResponse>('PUT', `/v1/senses/batches/${uuidv7()}`, {
      token: P.D,
      body: { events },
    });
    expect(batch.body).toEqual({ accepted: 2, rejected: [] });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect(await slot('astra', 'tonight')).toBeUndefined();
  });

  it('a shortlist never picks: one title alone is refused; My Media has its own', async () => {
    expect((await verb('astra.shortlist', { titles: two.slice(0, 1) })).status).toBe(422);
    expect((await verb('astra.shortlist', {})).status).toBe(422);
    const r = await doneNow(await verb('media.shortlist', { filters: ['something short'] }));
    expect(await slot('media', 'tonight')).toMatchObject({
      kind: 'shortlist',
      payload: { filters: ['something short'] },
    });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
  });

  it('study.mark_next: where you left off and what next; a second one, undone, puts back the first', async () => {
    const first = { book: 'book:b1', left_off: 'Chapter 2, the long walk', next: 'Chapter 3', page: 41 };
    await doneNow(await verb('study.mark_next', first));
    const r = await doneNow(
      await verb('study.mark_next', { ...first, left_off: 'Chapter 3', next: 'Chapter 4', page: 58 }),
    );
    expect((await slot('study', 'next'))?.payload).toMatchObject({ next: 'Chapter 4' });
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await slot('study', 'next'))?.payload).toMatchObject({ left_off: 'Chapter 2, the long walk', page: 41 });
  });

  it('guitar.set_plan: sections and tempos; its undo puts back the plan before', async () => {
    const a = await doneNow(await verb('guitar.set_plan', { tab: 'tab:t1', sections: [{ key: '4-8', bpm: 88 }] }));
    expect(a.permit?.class).toBe('practice');
    const b = await doneNow(
      await verb('guitar.set_plan', {
        tab: 'tab:t1',
        sections: [
          { key: '4-8', bpm: 92 },
          { key: '9-12', bpm: 80 },
        ],
        label: 'Verse, then the bridge',
      }),
    );
    expect(await slot('guitar', 'today')).toMatchObject({ kind: 'section', ref: 'tab:t1' });
    expect((await undo(b.ledger_id)).body.status).toBe('undone');
    expect((await slot('guitar', 'today'))?.payload).toMatchObject({ sections: [{ key: '4-8', bpm: 88 }] });
    expect((await verb('guitar.set_plan', { tab: 'tab:t1', sections: [{ key: 'verse', bpm: 88 }] })).status).toBe(422);
  });

  it('guitar.start_practice waits for Guitar: queued as its intent, claimed and reported, a row with no undo', async () => {
    const put = await verb('guitar.start_practice', { tab: 'tab:t1', section: '4-8', bpm: 88 });
    expect([put.status, put.body.status, put.body.permit?.class]).toEqual([201, 'pending', 'practice']);
    const pending = async (app: string) =>
      (await apiJson<{ items: Verb[] }>('GET', `/v1/verbs/pending?app=${app}`, { token: P.D })).body.items;
    expect((await pending('music')).some((v) => v.id === put.body.id)).toBe(false);
    const v = (await pending('guitar')).find((x) => x.id === put.body.id);
    expect(v).toMatchObject({ verb: 'guitar.start_practice', args: { tab: 'tab:t1', section: '4-8', bpm: 88 } });
    expect((await apiJson('POST', `/v1/verbs/${put.body.id}/claim`, { token: P.D, body: {} })).status).toBe(200);
    const done = await apiJson<Verb>('POST', `/v1/verbs/${put.body.id}/result`, {
      token: P.D,
      body: { ok: true, result: { opened: 'tab:t1#4-8' } },
    });
    expect(done.body.status).toBe('done');
    expect(await ledgerRow(done.body.ledger_id)).toMatchObject({ kind: 'verb', undoable: false });
    expect((await verb('guitar.start_practice', { tab: 'tab:t1', section: 'bridge' })).status).toBe(422);
  });

  it('under ask: refused with its card, and nothing placed', async () => {
    await settle({ 'mind.permit.practice': 'ask' });
    const r = await verb('guitar.set_plan', { tab: 'tab:t2', sections: [{ key: '1-4', bpm: 70 }] });
    expect([r.status, refusal(r.body).action]).toEqual([403, 'guitar.set_plan']);
    expect((await slot('guitar', 'today'))?.ref).toBe('tab:t1');
    await settle({ 'mind.permit.practice': 'tell' });
  });
});

describe("study.pace_goal: the owner's words only", () => {
  const current = async () =>
    (await coreSql<{ id: string; text: string }>(
      "SELECT id, text FROM facts WHERE subject = 'study.pace' AND superseded_at IS NULL",
    )) ?? [];

  it('a pace from their message; a new one replaces it; its undo puts the previous back', async () => {
    const said = await ownerSays(P.D, 'Forty pages a week is about right');
    const a = await doneNow(await verb('study.pace_goal', { pages: 40, evidence: [`msg:${said}`] }));
    expect(a.result).toMatchObject({ previous: null });
    const again = await ownerSays(P.D, 'Make it sixty');
    const b = await doneNow(await verb('study.pace_goal', { pages: 60, evidence: [`msg:${again}`] }));
    expect(b.result).toMatchObject({ previous: (a.result as { fact_id: string }).fact_id });
    expect((await current()).map((f) => f.text)).toEqual(['Study pace: 60 pages a week.']);
    expect((await undo(b.ledger_id)).body.status).toBe('undone');
    expect((await current()).map((f) => f.text)).toEqual(['Study pace: 40 pages a week.']);
  });

  it("refused on the mind's own words, and never scheduled", async () => {
    const mine = await apiJson<{ id: string }>('PUT', `/v1/messages/${uuidv7()}`, {
      ...chat(),
      body: { body: 'Noted.' },
    });
    expect((await verb('study.pace_goal', { pages: 10, evidence: [`msg:${mine.body.id}`] })).status).toBe(422);
    const said = await ownerSays(P.D, 'Ten pages is fine');
    const later = new Date(Date.now() + DAY).toISOString();
    expect((await verb('study.pace_goal', { pages: 10, evidence: [`msg:${said}`] }, { fire_at: later })).status).toBe(
      422,
    );
  });
});

describe('thread.file and reminder.snooze_rule', () => {
  it('files a conversation under a topic the menu shows; its undo unfiles it', async () => {
    const said = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      token: P.D,
      body: { body: 'About the trip' },
    });
    const id = said.body.thread_id;
    const thread = async () => (await apiJson<Thread>('GET', `/v1/threads/${id}`, { token: P.D })).body;
    const r = await doneNow(await verb('thread.file', { thread_id: id, topic: 'Trip planning' }));
    expect([r.result, r.permit?.position]).toEqual([{ previous: null }, 'quiet']);
    expect((await thread()).topic).toBe('Trip planning');
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await thread()).topic).toBeNull();
    expect((await verb('thread.file', { thread_id: uuidv7(), topic: 'Trip planning' })).status).toBe(404);
  });

  it('a standing rule: a reminder set into its window rings at its end; its undo takes the rule away', async () => {
    const r = await doneNow(await verb('reminder.snooze_rule', { during: 'practice', from: '19:00', to: '19:45' }));
    expect(r.result).toEqual({ rules: 1 });
    expect((await settings())['reminders.snooze']).toEqual([{ during: 'practice', from: '19:00', to: '19:45' }]);
    const day = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    const at = Date.parse(`${day}T19:15:00Z`);
    const set = await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, {
      token: P.D,
      body: { text: 'Water the plants', at },
    });
    expect(set.body.reminder.fire_at).toBe(Date.parse(`${day}T19:45:00Z`));
    expect((await undo(r.ledger_id)).body.status).toBe('undone');
    expect((await settings())['reminders.snooze']).toBeUndefined();
    const after = await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, {
      token: P.D,
      body: { text: 'Call back', at },
    });
    expect(after.body.reminder.fire_at).toBe(at);
  });
});

describe('law 8: no verb reaches prayer, revelation, leaders, health or people', () => {
  it('refused by its why or what it is about, for a verb and a plan step alike; nothing placed', async () => {
    const cases: [string, object, string?][] = [
      ['study.mark_next', { book: 'book:b2', left_off: 'Chapter 1', next: 'The chapter on revelation' }],
      ['astra.shortlist', { titles: two }, 'you seemed worried about your health'],
      ['reminder.snooze_rule', { during: 'meals', from: '12:00', to: '12:30' }, 'so prayer is never interrupted'],
    ];
    for (const [name, args, why] of cases) {
      const r = await verb(name, args, why ? { why } : {});
      expect([r.status, r.body.error.code, (r.body.error.details as { reason: string }).reason], name).toEqual([
        422,
        'validation',
        'needs_owner_words',
      ]);
    }
    const said = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: P.D, body: { body: 'Hello' } });
    const filed = await verb('thread.file', { thread_id: said.body.thread_id, topic: 'Faith' });
    expect((filed.body.error.details as { topic: string }).topic).toBe('faith');
    const plan = await apiJson<Verb & { error: { details: { path: string } } }>('POST', '/v1/verbs/plan', {
      ...chat(),
      body: {
        id: uuidv7(),
        why: 'an evening for the family',
        what: 'Set up your evening.',
        steps: [
          { verb: 'astra.shortlist', schema: 1, args: { titles: two } },
          {
            verb: 'study.mark_next',
            schema: 1,
            args: { book: 'book:b2', left_off: 'One', next: 'Advice for your leaders' },
          },
        ],
      },
    });
    expect([plan.status, plan.body.error.details.path]).toEqual([422, 'steps.1.args']);
    expect((await slot('study', 'next'))?.payload).not.toMatchObject({ next: 'Advice for your leaders' });
  });
});
