// A file's own address from TorBox (requestdl with `redirect=false`), made one the phone may have
// (owner rulings 2026-11-18, SECURITY.md §8.2). TorBox's file links may carry the account's token:
// such a link goes only to the owner's signed-in device, in the answer body, as every add-on already
// hands it over when it plays. What never leaves is the key as a bare secret: the Worker secret, the
// Authorization header, or an address on TorBox's API host (a requestdl permanent link is one). So
// an answer that is itself on api.torbox.app is asked once more inside the Worker (its redirect's
// Location, or its JSON's address), at most twice, and an api.torbox.app address is never handed
// over. The `link` step's note says, in fixed words, which kind of address it was.

import { type Answer, call, must, TorboxTrouble } from './torbox';
import { publicHttps, type Relay } from './upstream';
import { NOTE } from './words';

const API_HOST = 'api.torbox.app';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const EXCHANGES = 2;

/** TorBox's file servers have a "tb-cdn" label: nexus-123.latm.tb-cdn.cx, store-039.wnam.tb-cdn.io. */
export const isFileServer = (url: string) => new URL(url).hostname.split('.').includes('tb-cdn');
export const onTorboxApi = (url: string) => new URL(url).hostname === API_HOST;
/** Whether the address carries the account's key (as it is or URL-encoded). */
const carriesKey = (r: Relay, url: string) =>
  r.key !== null && (url.includes(r.key) || url.includes(encodeURIComponent(r.key)));

export interface FileAddress {
  url: string;
  /** The step's note: the server's kind, the exchanges it took, whether it carries the token. */
  note: string;
}

/** The address in a TorBox answer: its redirect's Location, else its JSON's `data`. */
function addressOf(a: Answer, base: string): unknown {
  if (!REDIRECTS.has(a.status)) return must(a).body.data;
  try {
    return a.location ? new URL(a.location, base).href : null;
  } catch {
    return null;
  }
}

/** One more exchange with an address on TorBox's API. */
async function exchange(r: Relay, url: string, until?: number): Promise<unknown> {
  const u = new URL(url);
  if (/\/requestdl$/.test(u.pathname) && r.userIp && !u.searchParams.has('user_ip'))
    u.searchParams.set('user_ip', r.userIp);
  return addressOf(await call(r, u.href, { until }), u.href);
}

/** requestdl's answer (or a permanent link's) as an address the phone may have, or trouble. */
async function handOver(r: Relay, first: unknown, until?: number): Promise<FileAddress> {
  let url = first;
  for (let exchanges = 0; ; exchanges++) {
    if (typeof url !== 'string' || !publicHttps(url)) throw new TorboxTrouble(NOTE.noLink);
    if (!onTorboxApi(url)) return { url, note: NOTE.linked(isFileServer(url), exchanges, carriesKey(r, url)) };
    if (exchanges >= EXCHANGES) throw new TorboxTrouble(NOTE.stillApi);
    url = await exchange(r, url, until);
  }
}

/** A file's download address, for the file server nearest the phone. */
export async function fileLink(r: Relay, key: string, torrent: number, file: number): Promise<FileAddress> {
  const q = new URLSearchParams({
    token: key,
    torrent_id: String(torrent),
    file_id: String(file),
    zip_link: 'false',
    redirect: 'false',
  });
  if (r.userIp) q.set('user_ip', r.userIp);
  const path = `/torrents/requestdl?${q}`;
  return handOver(r, addressOf(await call(r, path), `https://${API_HOST}/v1/api${path}`));
}

/** A TorBox permanent link (…/requestdl?token=…&redirect=true) met on an add-on's forward. */
export const isPermanentLink = (url: string) => onTorboxApi(url) && /\/requestdl$/.test(new URL(url).pathname);

/** Asks a permanent link for its JSON instead of its redirect; its own token is the key it needs. */
export async function permanentLink(r: Relay, url: string, until: number): Promise<string> {
  const u = new URL(url);
  u.searchParams.set('redirect', 'false');
  if (r.userIp) u.searchParams.set('user_ip', r.userIp);
  return (await handOver(r, addressOf(await call(r, u.href, { until }), u.href), until)).url;
}
