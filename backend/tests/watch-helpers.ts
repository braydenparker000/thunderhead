// Helpers for the watch suites (watches*.test.ts): set and cancel a watch as the chat mind (the
// `watch.set` and `watch.cancel` verbs), list them, and run Core's tick with mind-chat connected and
// a fake fire endpoint that records each fire. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import type { ErrorBody, Verb } from '../../shared/contract/api';
import type { WatchesResponse } from '../../shared/contract/watches.ts';
import { uuidv7 } from '../src/lib/ids';
import type { Core } from '../src/objects/core';
import { apiJson, core } from './helpers';

export type Call = { token: string; headers?: Record<string, string> };
export type SetOut = Verb &
  ErrorBody & { permit?: unknown; result: { watch_id: string; state: string; until: number } };

export const WHY = 'to set up the evening drive';

export function setWatch(call: Call, args: Record<string, unknown>, id = uuidv7()) {
  return apiJson<SetOut>('PUT', `/v1/verbs/${id}`, {
    ...call,
    body: { verb: 'watch.set', schema: 1, args: { why: WHY, ...args }, why: WHY },
  });
}

export function cancelWatch(call: Call, id: string) {
  return apiJson<SetOut>('PUT', `/v1/verbs/${uuidv7()}`, {
    ...call,
    body: { verb: 'watch.cancel', schema: 1, args: { id }, why: 'the owner changed the plan' },
  });
}

export const listWatches = (call: Call) => apiJson<WatchesResponse>('GET', '/v1/mind/watches', call);

const stub = () => core() as unknown as DurableObjectStub<Core>;

/** Each fire the fake mind-chat trigger heard. */
export const fires: { url: string; body: unknown }[] = [];
const fake = (async (url: string, init: RequestInit) => {
  fires.push({ url, body: init.body });
  return Response.json({ claude_code_session_id: `session_watch${fires.length}` });
}) as unknown as typeof fetch;

/** Runs `fn` inside Core with mind-chat connected (its trigger secrets set). */
function connected<T>(fn: (o: Core) => Promise<T>): Promise<T> {
  return runInDurableObject(stub(), async (o: Core) => {
    const self = o as unknown as { env: Env };
    const before = self.env;
    self.env = { ...before, ROUTINE_CHAT_URL: 'https://api.example.test/chat', ROUTINE_CHAT_TOKEN: 'tok' };
    try {
      return await fn(o);
    } finally {
      self.env = before;
    }
  });
}

/** Core's 15-minute tick at `now`, connected. */
export const tick = (now = Date.now()) => connected((o) => o.tick(now, fake));

/** The watches' own pass, connected, first thing (so the object's alarm, which an event's match moves
 * to now, never runs between the swap and the pass): what the tick and the alarm run. */
export const pulse = (now = Date.now()) =>
  connected((o) =>
    (o as unknown as { watchesTick: (n: number, f: typeof fetch) => Promise<string | null> }).watchesTick(now, fake),
  );

/** Core's tick as it is in tests, mind-chat not connected (a met watch stays queued). */
export const plainTick = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));

/** Ends the chat session that holds the lease, so a met watch needs a new wake. */
export const sleep = (call: Call) => apiJson('POST', '/v1/mind/status', { ...call, body: { state: 'stopping' } });
