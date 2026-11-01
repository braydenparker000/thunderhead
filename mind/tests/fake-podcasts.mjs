// The fake Worker's Podcasts routes (API.md §11.25), close enough to drive `th podcasts new`: the
// follows and positions the test put in (one page each), a feed per address (XML, or a status), and
// the night's checks, kept as the Worker would (latest_at never back; only followed shows). Like the
// Worker, the three reads mark the asking session tainted, and refuse a request with no session (422).
// The real rules (newer wins, the 40 reads a day, the prune) are the Worker's own tests.
import {HttpError} from './fake-worker.mjs';

/** @param {any} ctl the fake's control object */
export function podcastRoutes(ctl) {
  const s = ctl.state;
  s.podcasts = {follows: [], progress: [], feeds: new Map(), reads: [], checks: []};
  const p = s.podcasts;
  ctl.addFollow = (f) => { p.follows.push({title: 'A show', author: '', artwork: '', followed: true, updated_at: Date.now() - 30 * 86_400_000, checked_at: null, latest_at: null, new_n: 0, fails: 0, ...f}); };
  ctl.addPosition = (row) => p.progress.push({duration_s: 1800, played: false, updated_at: Date.now(), ...row});
  /** A feed's answer: XML, or `{status, code}` for a refusal. */
  ctl.setFeed = (url, answer) => p.feeds.set(url, answer);
  const page = items => ({items, next_since: Date.now(), next: null});
  /** What publishers wrote is served only to a named session, which is marked tainted first. */
  const mark = session => {
    if (!session) throw new HttpError(422, 'validation', 'TH-Session required');
    s.tainted.add(session);
  };
  return [
    ['GET', /^\/v1\/podcasts\/follows$/, ['night'], ({session}) => { mark(session); return page(p.follows); }],
    ['GET', /^\/v1\/podcasts\/progress$/, ['night'], ({query, session}) => { mark(session); return page(p.progress.filter(r => r.updated_at >= Number(query.get('since') || 0))); }],
    ['GET', /^\/v1\/podcasts\/feed$/, ['night'], ({query, session}) => {
      mark(session);
      const url = query.get('url');
      p.reads.push(url);
      const a = p.feeds.get(url);
      if (a === undefined) throw new HttpError(404, 'not_found', 'no such feed');
      if (typeof a === 'object') throw new HttpError(a.status, a.code);
      return {raw: a, headers: {'Content-Type': 'application/xml'}};
    }],
    ['POST', /^\/v1\/podcasts\/follows\/checked$/, ['night'], ({body}) => {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new HttpError(422, 'validation');
      p.checks.push(body.items);
      let updated = 0;
      for (const c of body.items) {
        const f = p.follows.find(x => x.feed_url === c.feed_url && x.followed);
        if (!f) continue;
        if (c.failed) Object.assign(f, {checked_at: Date.now(), new_n: 0, fails: (f.fails ?? 0) + 1});
        else Object.assign(f, {checked_at: Date.now(), new_n: c.new_n, fails: 0, latest_at: c.latest_at === null ? f.latest_at : Math.max(f.latest_at ?? 0, c.latest_at)});
        updated++;
      }
      return {updated, at: Date.now()};
    }],
  ];
}
