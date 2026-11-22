// While the mind works on a reply no th command is running, so nothing renews the chat lease
// (90 s) and the Worker would take the session for dead and start another one. So when th hands
// the session an owner message it reports `working` itself: that acknowledges the hand-out (a
// handout acknowledges nothing by itself), renews the lease and lets the PostToolUse hook's live
// notes go on. And it leaves one small detached process that repeats the report every 25 s until
// the next th listen, reply or wait starts, the session closes or is limited, or 10 minutes pass.
// The process dies with the container, so a session that is really gone still lapses and is owned
// up to. `th keepalive` is th's own: the mind never runs it.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {request} from './http.mjs';
import {getState, setState} from './state.mjs';

const TH = fileURLToPath(new URL('../th.mjs', import.meta.url));
const everyMs = () => Number(process.env.TH_KEEPALIVE_MS) || 25_000;
const maxMs = () => Number(process.env.TH_KEEPALIVE_MAX_MS) || 10 * 60_000;

async function working() {
  await request('POST', '/v1/mind/status', {body: {state: 'working'}, retry: false});
  setState('status', {state: 'working', at: Date.now()});
}

/** th has just been handed owner messages for the session: acknowledge them, and keep the lease
 * while the mind works. Never fails the command it is part of. */
export async function handedOver() {
  if (process.env.TH_ROLE !== 'chat') return;
  try { await working(); } catch { /* the keep-alive tries again */ }
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setState('keepalive', nonce);
  if (process.env.TH_KEEPALIVE === 'off') return;
  try {
    spawn(process.execPath, [TH, 'keepalive', nonce], {detached: true, stdio: 'ignore', env: process.env}).unref();
  } catch { /* best effort: the hook's live notes renew the lease too */ }
}

/** A listener starts: its own takes renew the lease from here, so the keep-alive ends. */
export function listening() {
  if (getState('keepalive')) setState('keepalive', null);
}

/** `th keepalive <nonce>`: the detached process itself. */
export async function keepalive(nonce) {
  const until = Date.now() + maxMs();
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, everyMs()));
    if (getState('keepalive') !== nonce || getState('closed') === true || getState('status')?.state !== 'working') return 0;
    try { await working(); } catch { /* next round */ }
  }
  return 0;
}
