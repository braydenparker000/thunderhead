// The speech setting (BEHAVIOR.md §3.7) on the mind's three unprompted writes, against the real
// Worker: "as needed" (the default) holds nothing back; "quiet" takes 1 home line change and 1 card a
// day and a push only for what the owner asked for; "silent" takes no line, tile, card or push. A write
// naming the owner's own message that asked for it is a reply: never held back, never counted. The
// briefing's section 1 says the position and, while quiet, what is spent; the mind cannot change it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, ErrorBody } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson } from '../helpers';
import { as, CHAT_SESSION, ownerSays, type Principals, principals, SHA } from '../memory-helpers';

let p = {} as Principals;
const chat = () => as(p.C, CHAT_SESSION);
type Out = ErrorBody & { ledger_id?: string };
const setSpeech = async (v: string) =>
  expect((await api('PATCH', '/v1/settings', { token: p.D, body: { 'mind.speech': v } })).status).toBe(200);

let n = 0;
const line = (over: object = {}) =>
  apiJson<Out>('PUT', `/v1/surfaces/home/line.${(n++ % 4) + 1}`, {
    ...chat(),
    body: {
      kind: 'line',
      schema: 1,
      payload: { text: 'Rain at three.' },
      why: 'You walk at three.',
      topic_key: `walk.${n}`,
      ...over,
    },
  });
const tile = (over: object = {}) =>
  apiJson<Out>('PUT', '/v1/surfaces/briefing/note.1', {
    ...chat(),
    body: {
      kind: 'tile',
      schema: 1,
      payload: { label: 'Note', value: 'Rain at three' },
      why: 'You walk at three.',
      topic_key: `note.${n++}`,
      ...over,
    },
  });
const card = (over: object = {}) =>
  apiJson<Out>('PUT', `/v1/proposals/${uuidv7()}`, {
    ...chat(),
    body: {
      class: 'permit',
      question: 'May I switch to the night look?',
      why: 'Your standing permission says to ask first.',
      if_ignored: 'Nothing happens.',
      odds: 0.6,
      options: ['Do it', 'Not now'],
      spec: {
        v: 1,
        op: 'permit.allow',
        args: { action: 'shell.appearance', call: uuidv7().replace(/-/g, '').padEnd(64, '0').slice(0, 64) },
      },
      ...over,
    },
  });
const push = (over: object = {}) =>
  apiJson<Out>('PUT', `/v1/pushes/nudge-${uuidv7()}`, {
    ...chat(),
    body: {
      title: 'The build is done',
      body: 'All green.',
      why: 'the owner asked to hear',
      topic_key: `build.${n++}`,
      ...over,
    },
  });
const code = (r: { status: number; body: Out }) => (r.status >= 400 ? `${r.status} ${r.body.error.code}` : r.status);
const section1 = async () =>
  (
    await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...chat(),
      body: { claim: false, session_id: CHAT_SESSION, role: 'chat', constitution_sha256: SHA, th_version: '0.1.0' },
    })
  ).body.core.split('\n## 2.')[0];

beforeAll(async () => {
  p = await principals();
  await apiJson('PATCH', '/v1/settings', {
    token: p.D,
    body: { 'owner.tz': 'UTC', 'quiet.start': '06:30', 'quiet.end': '06:30' },
  });
});

describe('the speech setting', () => {
  it('as needed (the default): no cap beyond what already holds', async () => {
    expect(await section1()).toContain('speech: as needed · no daily caps');
    expect([code(await line()), code(await line()), code(await tile())]).toEqual([200, 200, 200]);
    expect([code(await card()), code(await card())]).toEqual([201, 201]);
    // One push of the day's 2 (the push budget, its gap and quiet hours still hold it).
    expect(code(await push())).toBe(202);
  });

  it('quiet: one home line change and one card a day; a push only for what the owner asked', async () => {
    await setSpeech('quiet');
    // The as-needed day already spent its line and card: quiet counts the whole day.
    const over = await line();
    expect(code(over)).toBe('422 speech_budget');
    expect(over.body.error.details).toEqual({ speech: 'quiet', spent: { lines: 2, cards: 2 } });
    expect(code(await card())).toBe('422 speech_budget');
    expect(code(await tile())).toBe(200);
    expect(code(await push())).toBe('422 speech_budget');
    // What the owner asked for goes through, and is not counted.
    const asked = await ownerSays(p.D, 'Put the rain on home and tell me when the build is done.');
    expect(code(await line({ asked_by: asked }))).toBe(200);
    expect(code(await card({ asked_by: asked }))).toBe(201);
    expect(code(await push({ asked_by: asked }))).toBe(202);
    expect((await line()).body.error.details).toEqual({ speech: 'quiet', spent: { lines: 2, cards: 2 } });
    expect(await section1()).toContain('speech: quiet (the owner chose it) · today 2 of 1 home line, 2 of 1 card');
    // A message that is not the owner's is refused as such.
    expect(code(await line({ asked_by: uuidv7() }))).toBe('422 validation');
  });

  it('silent: no line, tile, card or push unasked; the owner’s words still go through', async () => {
    await setSpeech('silent');
    expect([code(await line()), code(await tile()), code(await card()), code(await push())]).toEqual([
      '422 speech_budget',
      '422 speech_budget',
      '422 speech_budget',
      '422 speech_budget',
    ]);
    const asked = await ownerSays(p.D, 'Put a note on the Briefing.');
    expect(code(await tile({ asked_by: asked }))).toBe(200);
    expect(await section1()).toMatch(/speech: silent \(the owner chose it\) .*reminders still ring/);
    // Clearing what the mind placed is never held back.
    expect((await api('DELETE', '/v1/surfaces/briefing/note.1', chat())).status).toBe(204);
  });

  it('is the owner’s alone: the mind cannot change it with settings.set', async () => {
    const r = await apiJson<ErrorBody>('PUT', `/v1/verbs/${uuidv7()}`, {
      ...chat(),
      body: {
        verb: 'settings.set',
        schema: 1,
        args: { key: 'mind.speech', value: 'as_needed' },
        why: 'trying to speak more',
      },
    });
    expect(r.body.error.code).toBe('forbidden');
    await setSpeech('as_needed');
    expect(code(await line())).toBe(200);
  });
});
