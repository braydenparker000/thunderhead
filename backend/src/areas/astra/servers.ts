// GET /v1/astra/torbox/servers (owner's brief 2026-11-19; SECURITY.md §8.2): TorBox's speed-test
// list, for the lab to time TorBox's file servers from the phone. TorBox publishes it (GET
// /speedtest: its server groups and a test file on each), but a web page may not read it (CORS), so
// the Worker asks it with the owner's key and the phone's address (`user_ip`, as requestdl) and hands
// back, for each group, its label, its region's name and the test file's address. These are
// TorBox's public test files, not the owner's films; one whose address carries the key or any token,
// or is not public https, is left out. TorBox's description of the answer is empty, so it is read
// defensively: a list, or an object keyed by group or region, of objects naming an address. Labels
// are kept only when they are short plain words. Device only, nothing stored or logged; its own
// count of 6 a minute per isolate, then 429, so the lab never takes a tap's turn.
import type { Context } from 'hono';
import { type AstraServer, type AstraServersResponse, ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import type { AppEnv } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { call, record, TorboxTrouble, trouble } from './torbox';
import { publicHttps, type Relay, relayFor } from './upstream';
import { NOTE, REASON } from './words';

let minute = { start: 0, n: 0 };
/** For tests: a fresh minute. */
export function forgetServersMinute(): void {
  minute = { start: 0, n: 0 };
}
function cap(now = Date.now()): void {
  if (now - minute.start >= 60_000) minute = { start: now, n: 0 };
  if (++minute.n <= L.servers_per_minute) return;
  const retry_after = Math.max(1, Math.ceil((minute.start + 60_000 - now) / 1000));
  throw new ApiError('rate_limited', { reason: REASON.tooManyChecks }, { retry_after, scope: 'account' });
}

const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,39}$/;
/** A label TorBox gave, when it is short plain words; else null. */
const label = (v: unknown): string | null => (typeof v === 'string' && LABEL.test(v.trim()) ? v.trim() : null);
/** A query name that may carry an account's token. */
const SECRET = /^(token|key|apikey|api_key|auth|access_token|password|secret)$/i;
const FIELDS = ['url', 'path', 'link', 'file', 'test_file', 'download', 'href'] as const;

/** Whether an address carries the key (as it is or encoded) or a query that may hold a token. */
function carriesToken(url: string, key: string | null): boolean {
  if (key && (url.includes(key) || url.includes(encodeURIComponent(key)))) return true;
  return [...new URL(url).searchParams.keys()].some((k) => SECRET.test(k));
}

/** The test file's address an entry names: a whole https address, or a host and a path. */
function addressOf(o: Record<string, unknown>): string | null {
  for (const f of FIELDS) if (typeof o[f] === 'string' && /^https:\/\//i.test(o[f] as string)) return o[f] as string;
  const host = typeof o.domain === 'string' ? o.domain : typeof o.host === 'string' ? o.host : null;
  const path = typeof o.path === 'string' ? o.path : typeof o.file === 'string' ? o.file : null;
  if (!host || !path || !/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** TorBox's file-server group in a host: the label before "tb-cdn" (nexus-1.latm.tb-cdn.io → latm). */
function hostGroup(url: string): string | null {
  const labels = new URL(url).hostname.toLowerCase().split('.');
  const at = labels.indexOf('tb-cdn');
  return at > 0 ? label(labels[at - 1]) : null;
}

/** The entries of TorBox's answer, each with the key it sat under (a group's or a region's name). */
function entries(data: unknown): [string | null, unknown][] {
  if (Array.isArray(data)) return data.map((e) => [null, e]);
  return Object.entries(record(data)).flatMap(([k, v]): [string | null, unknown][] =>
    Array.isArray(v) ? v.map((e) => [k, e]) : [[k, v]],
  );
}

/** The groups and their test files, and how many were left out for carrying a token. */
export function readServers(data: unknown, key: string | null): { servers: AstraServer[]; dropped: number } {
  const servers: AstraServer[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const [under, e] of entries(data)) {
    const o = record(e);
    const url = addressOf(o);
    if (!url || !publicHttps(url) || seen.has(url)) continue;
    if (carriesToken(url, key)) {
      dropped++;
      continue;
    }
    const named = label(o.group) ?? label(o.name) ?? label(o.label) ?? label(o.server);
    const group = named ?? hostGroup(url) ?? label(under);
    if (!group) continue;
    const place = label(o.region_name) ?? label(o.region) ?? label(o.location) ?? label(o.country) ?? label(o.city);
    seen.add(url);
    servers.push({ group, region: place ?? (under && label(under) !== group ? label(under) : null), url });
    if (servers.length >= L.servers_max) break;
  }
  return { servers, dropped };
}

/** Asks TorBox for its list: every group, the short test. */
async function ask(r: Relay, key: string): Promise<AstraServersResponse> {
  const q = new URLSearchParams({ region: 'all', test_length: 'short' });
  if (r.userIp) q.set('user_ip', r.userIp);
  try {
    const a = await call(r, `/speedtest?${q}`, { key, maxBytes: L.servers_bytes });
    // A list sent bare, without TorBox's usual envelope, is read as it is.
    const bare = a.status >= 200 && a.status < 300 && a.body.success === undefined;
    const why = bare ? null : trouble(a);
    if (why) return { servers: [], note: why };
    const { servers, dropped } = readServers(bare ? a.json : a.body.data, key);
    const note = dropped ? NOTE.tokened(dropped) : servers.length ? undefined : NOTE.noServers;
    return { servers, ...(note ? { note } : {}) };
  } catch (e) {
    return { servers: [], note: e instanceof TorboxTrouble ? e.note : NOTE.unreachable };
  }
}

/** The route's answer. */
export async function serverList(c: Context<AppEnv>): Promise<AstraServersResponse> {
  cap();
  const r = relayFor(c);
  return r.key ? ask(r, r.key) : { servers: [], note: NOTE.noKey };
}
