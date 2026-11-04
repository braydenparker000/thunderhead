// The fake Worker's report list (API.md §11.16), close enough to drive `th reports`: the batches
// the test put in, newest first, by kind, since and limit, with a cursor of the last row's place.
// And the night's report (`th report`, PUT /v1/briefing/report/:day): kept by its day, the same
// body again answering the stored one.
// The real rules (one row per batch, the cleaning, the 5-minute count, the prune) are the Worker's own tests.
import {HttpError} from './fake-worker.mjs';

/** @param {any} ctl the fake's control object */
export function reportRoutes(ctl) {
  const s = ctl.state;
  s.reports = [];
  /** A batch as the phone would send it, kept as the Worker would. */
  ctl.addReport = (body, {at = ctl.now(), kind = 'playback', device_id = 'dev-session-1'} = {}) => {
    const r = {id: `rep-${String(s.reports.length + 1).padStart(4, '0')}`, kind, device_id, at, body};
    s.reports.push(r);
    return r;
  };
  s.nightReports = new Map();
  return [
    ['PUT', /^\/v1\/briefing\/report\/(\d{4}-\d{2}-\d{2})$/, ['night'], ({params, body}) => {
      const [day] = params;
      const had = s.nightReports.get(day);
      if (had && JSON.stringify(had.sent) === JSON.stringify(body)) return had.report;
      const report = {day, written_at: ctl.now(), headline: body.headline, lines: body.lines, ledger_id: `led-${day}-${s.nightReports.size + 1}`,
        message_id: had ? had.report.message_id : `msg-${day}`, counts: {facts_added: 0, facts_confirmed: 0, loose_ends_closed: 0,
          loose_ends_added: 0, pages_read: null, songs_noted: null, mixes: null, predictions: 0, steps_cut: []}};
      s.nightReports.set(day, {sent: body, report});
      return report;
    }],
    ['GET', /^\/v1\/ops\/reports$/, ['chat', 'night', 'reflex'], ({query}) => {
      const kind = query.get('kind');
      if (kind && kind !== 'playback') throw new HttpError(422, 'validation');
      const limit = Number(query.get('limit') || 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(422, 'validation');
      const since = Number(query.get('since') || 0);
      const after = query.get('cursor') ? Number(query.get('cursor')) : Infinity;
      const rows = s.reports.filter(r => (!kind || r.kind === kind) && r.at >= since)
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
      const from = Number.isFinite(after) ? after : 0;
      const items = rows.slice(from, from + limit);
      return {items, next: items.length === limit ? String(from + limit) : null};
    }],
  ];
}
