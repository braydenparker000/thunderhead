// What every part of Astra's relay shares: the fetch (tests swap it), the time limits (tests shorten
// them), the request's own state (its deadline, its steps, its TorBox calls) and the address rule.
// Only public https addresses with no user, password or port are ever asked (`linkProblem`, the
// calendar links' rule: no numeric, local or test host). Nothing here logs or keeps anything.
import type { Context } from 'hono';
import { type AstraStep, type AstraStepName, ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import { linkProblem } from '../../../../shared/contract/settings.ts';
import type { AppEnv } from '../../http/auth';
import { allowedOrigins } from '../../http/cors';
import { present } from '../../lib/secrets';

let fetcher: typeof fetch = (...a) => fetch(...a);
/** For tests: the fetch TorBox and the add-ons are asked with. */
export function useFetch(f?: typeof fetch): void {
  fetcher = f ?? ((...a) => fetch(...a));
}
export const ask: typeof fetch = (...a) => fetcher(...a);

type Times = { torbox_ms: number; request_ms: number; follow_ms: number; retry_ms: number; again_ms: number };
/** `again_ms`: the wait before a just-added torrent's listing is asked again (TorBox catching up). */
const TIMES: Times = {
  torbox_ms: L.torbox_ms,
  request_ms: L.request_ms,
  follow_ms: L.follow_ms,
  retry_ms: L.retry_ms,
  again_ms: 400,
};
let times = { ...TIMES };
/** For tests: shorter limits (none given: the real ones). */
export function useTimes(t: Partial<Times> = {}): void {
  times = { ...TIMES, ...t };
}
export const timesNow = () => times;

/** One request's state: when it must be done, what it tried, how often it asked TorBox. */
export interface Relay {
  /** When the request began, for its total time. */
  started: number;
  deadline: number;
  steps: AstraStep[];
  calls: number;
  /** The phone's address, so TorBox picks the file server nearest it (`user_ip`). */
  userIp: string | null;
  /** The site's origin, sent as `Origin` on each hop so a server that echoes it answers as it
   * would the page; '' when the Worker knows none. */
  site: string;
  /** The owner's TorBox key (TORBOX_KEY), or null when it is not set. Never leaves the Worker as
   * itself; only TorBox's own file links, which may carry it as their token, go to the phone. */
  key: string | null;
}

const IP = /^[0-9A-Fa-f:.]{2,45}$/;
export function relayFor(c: Context<AppEnv>): Relay {
  const origins = allowedOrigins(c.env.SITE_ORIGINS);
  const origin = c.req.header('Origin');
  const ip = c.req.header('CF-Connecting-IP') ?? '';
  const now = Date.now();
  return {
    started: now,
    deadline: now + times.request_ms,
    steps: [],
    calls: 0,
    userIp: IP.test(ip) ? ip : null,
    site: origin && origins.has(origin) ? origin : ([...origins][0] ?? ''),
    key: present(c.env.TORBOX_KEY),
  };
}

/** Records a step that began at `since`. */
export function mark(r: Relay, step: AstraStepName, ok: boolean, since: number, note?: string): void {
  r.steps.push({ step, ok, ms: Math.max(0, Date.now() - since), ...(note ? { note } : {}) });
}

export class TimedOut extends Error {
  constructor() {
    super('timed out');
    this.name = 'TimedOut';
  }
}

/** Runs `work` with a signal that aborts after `ms`; a run cut short throws TimedOut. */
export async function timed<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (ms <= 0) throw new TimedOut();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new TimedOut();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether an address may be handed to the phone: never one on TorBox's API host (a requestdl
 * permanent link is the key in another form). A TorBox file link carrying the account's token may
 * go to the owner's own device (links.ts). Checked on every address that leaves the Worker. */
export function handable(url: string): boolean {
  try {
    return new URL(url).hostname !== 'api.torbox.app';
  } catch {
    return false;
  }
}

/** Whether the relay may ask this address: https, public, no user, password or port. */
export function publicHttps(url: string): boolean {
  return linkProblem(url, L.link_chars) === null;
}
