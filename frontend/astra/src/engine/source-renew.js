// A film's address renewed when it dies while the film plays, for Astra's range reader (http-source.js). A
// TorBox link lives three hours; the page that opened the film can ask the owner's Worker again for the same
// film (AstraPlayer.load's `renew`). When a request to the film, after it had opened, is answered 401, 403,
// 404 or 410, or its connection is refused (a page cannot tell that from an error page without CORS), the
// reader asks once: one call for every read waiting at that moment, 15 s at most (TIMING.renew), and at most
// once a minute. With a fresh address both the address given and the one reads go to move to it; the blocks
// held and the film's memory belong to the file (its size and first bytes), not to an address, and stay.
// When there is no `renew`, it fails, or the fresh address dies too, the reader goes on as it always did.
// HLS, DASH and the browser's own player read their addresses themselves and are not renewed.

import {SourceError, TIMING} from './source-stream.js';

export const DEAD = new Set([401, 403, 404, 410]);
const EVERY = 60000; // the least time between two renewals

/** 'status' for an answer that says the address is dead, 'refused' for a request that failed outright, else ''. */
export function dead(error) {
  if (error instanceof SourceError) return ['status', 'gone'].includes(error.kind) && DEAD.has(error.detail) ? 'status' : '';
  return error instanceof TypeError ? 'refused' : '';
}

/**
 * Resolves true once the reader reads from a fresh address, false when it could not get one: no `renew`, the
 * film had not opened yet, the last renewal was less than a minute ago, or the page gave none in time.
 * Every caller while one is under way shares it.
 */
export function renewed(source) {
  if (source.renewing) return source.renewing;
  if (typeof source.renew !== 'function' || !source.size || source.closed || Date.now() - (source.renewedAt || 0) < EVERY) return Promise.resolve(false);
  source.renewedAt = Date.now();
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new SourceError('late', 'No fresh address came.')), TIMING.renew); });
  const asked = Promise.race([Promise.resolve().then(() => source.renew()), late]).then(url => {
    if (source.closed || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    source.given = source.url = url;
    source.renewals = (source.renewals || 0) + 1;
    return true;
  }, () => false).finally(() => { clearTimeout(timer); source.renewing = null; });
  source.renewing = asked;
  return asked;
}

/**
 * The player's `renew`, kept to its load: the fresh address becomes the film's own (a fallback that opens the
 * file again opens it there), and the log says a renewal happened, never the address. Null without one.
 */
export function playerRenew(player, renew) {
  if (typeof renew !== 'function') return null;
  const load = player.load_;
  return async () => {
    try {
      const url = await renew();
      if (player.load_ === load && typeof url === 'string') { player.url = url; player.record('renew', 'a fresh address'); }
      return url;
    } catch (error) {
      if (player.load_ === load) player.record('renew', 'failed');
      throw error;
    }
  };
}
