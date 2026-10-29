// The one seam between the mind's `GET /v1/live/wait` and how the Worker learns that something
// changed (API.md §11.5). Test X1 decides the mode; until it is measured both exist and the var
// LIVE_WAIT picks one, so changing it is a var change, not a code change:
//   ws   — the Worker holds a hibernatable WebSocket to Core and returns at the first frame whose
//          seq is past `after` (Core sends `hello` with its seq at once, so nothing committed
//          between the first take and the connect is missed). Default.
//   poll — the Worker asks Core for its last seq every 3 s (the fallback if X1 fails).
// Runs in the Worker, never inside the object (no timers in Durable Objects).
import { coreObject } from '../../objects/core';

export type WaitMode = 'ws' | 'poll';
export type WaitResult = 'changed' | 'timeout';

const POLL_MS = 3_000;

export function waitMode(env: Env): WaitMode {
  return env.LIVE_WAIT === 'poll' ? 'poll' : 'ws';
}

export function waitForChange(env: Env, after: number, ms: number, mode = waitMode(env)): Promise<WaitResult> {
  return mode === 'poll' ? poll(env, after, ms) : socket(env, after, ms);
}

async function socket(env: Env, after: number, ms: number): Promise<WaitResult> {
  const res = await coreObject(env).fetch('https://core/wait', { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) return poll(env, after, ms);
  ws.accept();
  return new Promise<WaitResult>((resolve) => {
    let settled = false;
    const done = (r: WaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close(1000, 'done');
      } catch {
        // already closed
      }
      resolve(r);
    };
    const timer = setTimeout(() => done('timeout'), ms);
    ws.addEventListener('message', (e) => {
      try {
        const f = JSON.parse(String(e.data)) as { t?: string; seq?: number };
        if ((f.t === 'hello' || f.t === 'changed') && typeof f.seq === 'number' && f.seq > after) done('changed');
      } catch {
        // not a frame we know: ignore it
      }
    });
    ws.addEventListener('close', () => done('timeout'));
  });
}

async function poll(env: Env, after: number, ms: number): Promise<WaitResult> {
  const deadline = Date.now() + ms;
  const core = coreObject(env);
  while (Date.now() < deadline) {
    if ((await core.lastSeq()) > after) return 'changed';
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
  }
  return 'timeout';
}
