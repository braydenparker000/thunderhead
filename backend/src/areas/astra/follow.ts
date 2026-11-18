// The follow path (mode "play" only; SECURITY.md §8.2): the add-on's link answers with a forward
// towards TorBox, which a page cannot read hop by hop. The Worker walks it by hand: GET with
// `Range: bytes=0-0`, `Origin: <the site>`, no cookies and no referrer, the body never read; each
// Location checked again (public https, no user, password or port); at most 6 hops in 20 s. A
// TorBox permanent link on the way is asked for its JSON instead (its own token is the key it
// needs). The first 200 or 206 ends it: its address, its size and type, and whether a page may
// read it. A short video on the add-on's own host is its "not ready yet" placeholder, not a film.
// Only those fields leave: never a body or a header, and never an address on TorBox's API host
// (`handable`). Off unless the Worker variable ASTRA_FOLLOW is "on" (routes.ts): an add-on may tie
// a link to the connection that asked for the stream list, so the Worker opening it can spoil it.

import { ASTRA_LIMITS as L } from '../../../../shared/contract/astra.ts';
import type { ErrorCode } from '../../../../shared/contract/errors';
import { isVideo, mediaType, typeOfName } from './files';
import { isPermanentLink, permanentLink } from './links';
import { TorboxTrouble } from './torbox';
import { ask, handable, mark, publicHttps, type Relay, TimedOut, timed, timesNow } from './upstream';
import { NOTE, REASON } from './words';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const UA = 'Thunderhead-Astra/1.0 (personal app; 1 viewer)';

export type Followed =
  | { ok: true; url: string; size: number | null; type: string | null; readable: boolean }
  | { ok: false; code: ErrorCode; reason: string };

/** The file's whole size: from `Content-Range` on a 206, from `Content-Length` on a 200. */
function sizeOf(res: Response): number | null {
  if (res.status === 206) {
    const m = /^bytes \d+-\d+\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
    return m ? Number(m[1]) : null;
  }
  const n = Number(res.headers.get('Content-Length') ?? '');
  return res.headers.has('Content-Length') && Number.isSafeInteger(n) ? n : null;
}

export async function follow(r: Relay, link: string): Promise<Followed> {
  const since = Date.now();
  const until = Math.min(since + timesNow().follow_ms, r.deadline);
  const fail = (code: ErrorCode, reason: string, note: string): Followed => {
    mark(r, 'follow', false, since, note);
    return { ok: false, code, reason };
  };
  if (!publicHttps(link)) return fail('bad_request', REASON.linkNotPublic, NOTE.notPublic);
  const home = new URL(link).hostname;
  let url = link;
  for (let hop = 1; hop <= L.hops; hop++) {
    if (!publicHttps(url)) return fail('upstream', REASON.leftHttps, NOTE.notPublic);
    if (isPermanentLink(url)) {
      try {
        url = await permanentLink(r, url, until);
      } catch (e) {
        return fail('upstream', REASON.torboxLink, e instanceof TorboxTrouble ? e.note : NOTE.unreadable);
      }
      continue;
    }
    let res: Response;
    try {
      res = await timed(until - Date.now(), async (signal) => {
        const headers: Record<string, string> = { Range: 'bytes=0-0', Accept: '*/*', 'User-Agent': UA };
        if (r.site) headers.Origin = r.site;
        const answer = await ask(url, { method: 'GET', redirect: 'manual', headers, signal });
        // Only the status and a few headers are read; the body is let go unread.
        await answer.body?.cancel().catch(() => {});
        return answer;
      });
    } catch (e) {
      return e instanceof TimedOut
        ? fail('upstream', REASON.slow, NOTE.followSlow)
        : fail('upstream', REASON.unreachable, NOTE.addonUnreachable);
    }
    if (REDIRECTS.has(res.status)) {
      const location = res.headers.get('Location');
      if (!location) return fail('upstream', REASON.broken, NOTE.noLocation);
      try {
        url = new URL(location, url).href;
      } catch {
        return fail('upstream', REASON.broken, NOTE.noLocation);
      }
      continue;
    }
    if (res.status !== 200 && res.status !== 206) return fail('upstream', REASON.endedInError, NOTE.ended(res.status));
    const size = sizeOf(res);
    const path = new URL(url).pathname;
    const type = mediaType(res.headers.get('Content-Type')) ?? typeOfName(path);
    if (new URL(url).hostname === home && isVideo(path, type) && size !== null && size < L.placeholder_bytes)
      return fail('unavailable', REASON.notReady, NOTE.placeholder);
    if (!handable(url)) return fail('upstream', REASON.notHanded, NOTE.notHanded);
    const allow = res.headers.get('Access-Control-Allow-Origin');
    mark(r, 'follow', true, since, NOTE.reached(hop));
    return { ok: true, url, size, type, readable: allow === '*' || (r.site !== '' && allow === r.site) };
  }
  return fail('upstream', REASON.tooLong, NOTE.tooMany);
}
