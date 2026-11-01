// The fake Worker's Podcasts routes (API.md §11.25), close enough to drive `th podcasts new`: the
// follows and positions the test put in (one page each), a feed per address (XML, or a status), and
// the night's checks, kept as the Worker would (latest_at never back; only followed shows). Like the
// Worker, the night never receives podcast text: its follows come as show ids (no address, title,
// author or artwork), a feed only in counts mode by show id (the Worker's own counter,
// backend/src/areas/podcasts/counts.ts, leaving out what a phone started), and neither marks it; the
// positions (feed addresses) mark the asking session tainted and refuse a request with no session
// (422). The checks are clamped as the Worker clamps them. The real rules (newer wins, the 40 reads a
// day, the prune) are the Worker's own tests.
import {countFeed} from '../../backend/src/areas/podcasts/counts.ts';
import {episodeID} from '../../frontend/th/podcasts/feed.js';
import {HttpError} from './fake-worker.mjs';

const AHEAD = 3_600_000;
const timeOf = (t, now) => (t !== null && Number.isFinite(t) && t > 0 && t <= now + AHEAD ? Math.floor(t) : null);
const countOf = n => Math.min(200, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));

/** @param {any} ctl the fake's control object */
export function podcastRoutes(ctl) {
  const s = ctl.state;
  s.podcasts = {follows: [], progress: [], feeds: new Map(), reads: [], checks: []};
  const p = s.podcasts;
  ctl.addFollow = (f) => { p.follows.push({title: 'A show', author: '', artwork: '', followed: true, updated_at: Date.now() - 30 * 86_400_000, checked_at: null, latest_at: null, new_n: 0, fails: 0, show_id: episodeID(f.feed_url), ...f}); };
  ctl.addPosition = (row) => p.progress.push({duration_s: 1800, played: false, updated_at: Date.now(), ...row});
  /** A feed's answer: XML, or `{status, code}` for a refusal. */
  ctl.setFeed = (url, answer) => p.feeds.set(url, answer);
  const page = items => ({items, next_since: Date.now(), next: null});
  /** The positions carry feed addresses: served only to a named session, which is marked first. */
  const mark = session => {
    if (!session) throw new HttpError(422, 'validation', 'TH-Session required');
    s.tainted.add(session);
  };
  const started = key => p.progress.some(r => r.key === key && (r.played || r.position_s > 0));
  return [
    ['GET', /^\/v1\/podcasts\/follows$/, ['night'], () => page(p.follows.map(f => ({show_id: f.show_id, followed: f.followed, updated_at: f.updated_at, checked_at: f.checked_at, latest_at: f.latest_at, new_n: f.new_n, fails: f.fails})))],
    ['GET', /^\/v1\/podcasts\/progress$/, ['night'], ({query, session}) => { mark(session); return page(p.progress.filter(r => r.updated_at >= Number(query.get('since') || 0))); }],
    ['GET', /^\/v1\/podcasts\/feed$/, ['night'], async ({query}) => {
      const show = query.get('show') ?? '';
      if (query.get('count') !== '1' || query.has('url') || !/^[0-9a-f]{16}$/.test(show))
        throw new HttpError(403, 'forbidden', 'counts only', {reason: 'counts_only'});
      const follow = p.follows.find(f => f.show_id === show && f.followed);
      if (!follow) throw new HttpError(403, 'forbidden', 'not followed', {reason: 'not_followed'});
      const url = follow.feed_url;
      const since = Number(query.get('since'));
      if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(422, 'validation');
      p.reads.push(url);
      const a = p.feeds.get(url);
      if (a === undefined) throw new HttpError(404, 'not_found', 'no such feed');
      if (typeof a === 'object') throw new HttpError(a.status, a.code);
      try {
        const counts = await countFeed(new Response(a).body, since, Date.now());
        return {new_n: countOf(counts.newer.filter(e => !started(`${url}#${e.id}`)).length), latest_at: timeOf(counts.latest_at, Date.now())};
      } catch (e) {
        throw new HttpError(502, 'upstream', 'not counted', {reason: e.reason ?? 'unreachable'});
      }
    }],
    ['POST', /^\/v1\/podcasts\/follows\/checked$/, ['night'], ({body}) => {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new HttpError(422, 'validation');
      p.checks.push(body.items);
      let updated = 0;
      for (const c of body.items) {
        if (!/^[0-9a-f]{16}$/.test(c.show_id ?? '')) throw new HttpError(422, 'validation');
        const f = p.follows.find(x => x.show_id === c.show_id && x.followed);
        if (!f) continue;
        const latest = timeOf(c.latest_at, Date.now());
        if (c.failed) Object.assign(f, {checked_at: Date.now(), new_n: 0, fails: (f.fails ?? 0) + 1});
        else Object.assign(f, {checked_at: Date.now(), new_n: countOf(c.new_n), fails: 0, latest_at: latest === null ? f.latest_at : Math.max(f.latest_at ?? 0, latest)});
        updated++;
      }
      return {updated, at: Date.now()};
    }],
  ];
}
