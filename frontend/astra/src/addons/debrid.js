// TorBox links from add-ons, resolved to the file's direct address once, so
// range reads do not bounce through a redirect each time. Only reads the
// account's own list; never adds, removes or changes a torrent.

const API = 'https://api.torbox.app/v1/api/';
const isInt = v => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v));
const fileName = v => String(v || '').split(/[\\/]/).pop();

/** Recognises a TorBox download link or a Torrentio TorBox resolve link. */
export function identifyTorbox(value) {
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.hostname === 'api.torbox.app' && /^\/v1\/api\/(torrents|usenet|webdl)\/requestdl$/.test(u.pathname)) {
    if (!u.searchParams.get('token') || u.searchParams.get('zip_link') === 'true') return null;
    const type = u.pathname.split('/')[3], idKey = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id'}[type];
    if (!isInt(u.searchParams.get(idKey)) || !isInt(u.searchParams.get('file_id') || 0)) return null;
    return {direct: u.href};
  }
  if (u.hostname !== 'torrentio.strem.fun') return null;
  const p = u.pathname.split('/');
  if (p[1] !== 'resolve' || p[2] !== 'torbox' || !p[3] || !/^[a-f0-9]{40}$/i.test(p[4] || '') || !p[5]) return null;
  try { return {token: decodeURIComponent(p[3]), hash: p[4].toLowerCase(), filename: fileName(decodeURIComponent(p[5]))}; } catch { return null; }
}

// The account's torrent list, kept in memory only (never written anywhere, gone with the page) for ten minutes
// per token, so a second pick does not page through the whole list again. Keyed by the token itself, in memory.
const LIST_TTL = 10 * 60e3;
const lists = new Map(); // token -> {at, items}

function keptList(token, now = Date.now()) {
  const kept = lists.get(token);
  if (kept && now - kept.at < LIST_TTL) return kept.items;
  lists.delete(token);
  return null;
}

/** Pages through the account's list (up to five requests of 100) until `found` finds it there; null when TorBox answers oddly. */
async function accountList(json, token, found) {
  const all = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const items = await json(`${API}torrents/mylist?limit=100&offset=${offset}`, {Authorization: 'Bearer ' + token});
    if (!Array.isArray(items)) return null;
    all.push(...items);
    if (items.length < 100 || found(items)) break;
  }
  lists.set(token, {at: Date.now(), items: all});
  return all;
}

/** Forgets every kept list (tests; a page that goes away forgets them anyway). */
export function forgetLists() { lists.clear(); }

/** Resolves to the direct file address; returns the original link when it cannot. */
export async function resolveDebrid(url, {signal, fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
  const source = identifyTorbox(url);
  if (!source) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  signal?.addEventListener('abort', () => controller.abort(), {once: true});
  const json = async (target, headers = {}) => {
    const r = await fetchFn(target, {signal: controller.signal, headers, credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'});
    if (!r.ok) throw Error('TorBox lookup failed');
    const body = await r.json();
    if (body.success !== true) throw Error('TorBox lookup unavailable');
    return body.data;
  };
  try {
    let download = source.direct;
    if (!download) {
      if (/[\r\n]/.test(source.token)) return url;
      const find = list => list?.find(i => String(i.hash || '').toLowerCase() === source.hash) || null;
      const pick = list => {
        const torrent = find(list), files = (torrent?.files || []).filter(f => fileName(f.short_name || f.name) === source.filename);
        return torrent && isInt(torrent.id) && files.length === 1 && isInt(files[0].id) ? {torrent, file: files[0]} : null;
      };
      // The list asked earlier (ten minutes, this token) first; asked afresh once when the torrent (or its file) is not in it.
      let found = pick(keptList(source.token));
      if (!found) {
        const items = await accountList(json, source.token, find);
        if (!items) return url;
        found = pick(items);
      }
      if (!found) return url;
      const {torrent, file} = found;
      download = `${API}torrents/requestdl?` + new URLSearchParams({token: source.token, torrent_id: String(torrent.id), file_id: String(file.id)});
    }
    const target = new URL(download);
    target.searchParams.set('redirect', 'false');
    const final = new URL(String(await json(target.href)));
    return final.protocol === 'https:' && !final.username && !final.password ? final.href : url;
  } catch (error) {
    if (signal?.aborted) throw error;
    return url;
  } finally { clearTimeout(timer); }
}
