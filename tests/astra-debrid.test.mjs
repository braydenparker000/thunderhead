// TorBox links resolved once (frontend/astra/src/addons/debrid.js): the account's list is asked once and kept in
// memory ten minutes per token, asked again once when a pick is not in it. TorBox here is a stand-in fetch.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDebrid, forgetLists } from '../frontend/astra/src/addons/debrid.js';

const HASH = (n) => n.toString(16).padStart(40, '0');
const link = (token, n, name) => `https://torrentio.strem.fun/resolve/torbox/${token}/${HASH(n)}/${encodeURIComponent(name)}/0/${encodeURIComponent(name)}`;
const torrent = (n) => ({ id: n, hash: HASH(n), files: [{ id: 7, short_name: `Film ${n}.mkv` }] });

/** A TorBox with `count` torrents (n = 1..count): counts list requests per token. */
function torbox(count) {
  const calls = { list: 0, tokens: [] }, all = Array.from({ length: count }, (_, i) => torrent(i + 1));
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const answer = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
    if (u.pathname.endsWith('/torrents/mylist')) {
      calls.list++; calls.tokens.push(init.headers.Authorization);
      const offset = +u.searchParams.get('offset');
      return answer(all.slice(offset, offset + 100));
    }
    if (u.pathname.endsWith('/torrents/requestdl')) return answer(`https://cdn.example/${u.searchParams.get('torrent_id')}/${u.searchParams.get('file_id')}`);
    throw Error('unexpected ' + u.pathname);
  };
  return { fetchFn, calls, all };
}

beforeEach(() => forgetLists());

test('a second pick from the same account is found in the list asked the first time', async () => {
  const tb = torbox(250);
  assert.equal(await resolveDebrid(link('tok-a', 240, 'Film 240.mkv'), { fetchFn: tb.fetchFn }), 'https://cdn.example/240/7');
  assert.equal(tb.calls.list, 3, 'three pages to reach it');
  assert.equal(await resolveDebrid(link('tok-a', 5, 'Film 5.mkv'), { fetchFn: tb.fetchFn }), 'https://cdn.example/5/7');
  assert.equal(tb.calls.list, 3, 'no list request the second time');
});

test('a torrent not in the kept list is asked for afresh once; a missing one gives the link back', async () => {
  const tb = torbox(3);
  await resolveDebrid(link('tok-a', 1, 'Film 1.mkv'), { fetchFn: tb.fetchFn });
  tb.all.push(torrent(4)); // added to the account since
  assert.equal(await resolveDebrid(link('tok-a', 4, 'Film 4.mkv'), { fetchFn: tb.fetchFn }), 'https://cdn.example/4/7');
  assert.equal(tb.calls.list, 2);
  const missing = link('tok-a', 99, 'Film 99.mkv');
  assert.equal(await resolveDebrid(missing, { fetchFn: tb.fetchFn }), missing);
  assert.equal(tb.calls.list, 3, 'refreshed once, not more');
});

test('each token has its own list, and a list older than ten minutes is asked again', async (t) => {
  const tb = torbox(2);
  await resolveDebrid(link('tok-a', 1, 'Film 1.mkv'), { fetchFn: tb.fetchFn });
  await resolveDebrid(link('tok-b', 1, 'Film 1.mkv'), { fetchFn: tb.fetchFn });
  assert.deepEqual(tb.calls.tokens, ['Bearer tok-a', 'Bearer tok-b']);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 11 * 60e3);
  assert.equal(await resolveDebrid(link('tok-a', 2, 'Film 2.mkv'), { fetchFn: tb.fetchFn }), 'https://cdn.example/2/7');
  assert.equal(tb.calls.list, 3);
});
