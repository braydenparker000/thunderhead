// The fake Worker's music routes (API.md §11.21, MUSIC.md §10.5), close enough to drive `th music`:
// a synthetic catalog the test puts in, the notes th sends (kept by track id; an unknown id refuses
// the batch), the untagged page, notes by id, and find answering by the notes' moods in catalog
// order. The senses' fixed questions th music asks (last_event, top_refs, counts_by_day) answer from
// the events the test adds. The real rules (every vocabulary, the ranking, the rows) are the
// Worker's own tests.
import {HttpError} from './fake-worker.mjs';

const CN = ['chat', 'night'];

/** @param {any} ctl the fake's control object */
export function musicRoutes(ctl) {
  const s = ctl.state;
  s.tracks = [];
  s.trackNotes = new Map();
  s.senseEvents = [];
  /** Songs as the catalog would hold them: `{id, title, artist, …}`. */
  ctl.addTracks = rows => { s.tracks.push(...rows.map(r => ({album: '', genre: '', composer: '', year: 0, dur: 200, artist: '', ...r}))); };
  /** A sense the phone sent: `{type, id, at}`. */
  ctl.addSense = ({type, id, at = ctl.now()}) => { s.senseEvents.push({seq: s.senseEvents.length + 1, type, ref: `music:${id}`, at, data: null}); };
  ctl.senseQuery = ({name, params}) => {
    const ev = s.senseEvents;
    if (name === 'last_event') {
      const e = ev.filter(x => x.type === params.type).at(-1);
      return {rows: e ? [e] : [], rows_read: 1};
    }
    if (name === 'top_refs') {
      const since = ctl.now() - params.days * 86_400_000;
      const by = {};
      for (const e of ev) if (e.type === params.type && e.at >= since) by[e.ref] = (by[e.ref] ?? 0) + 1;
      const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, params.limit ?? 20).map(([ref, n]) => ({ref, n, sum_ms: 0}));
      return {rows, rows_read: rows.length};
    }
    if (name === 'counts_by_day') {
      const by = {};
      for (const e of ev) by[e.type] = (by[e.type] ?? 0) + 1;
      return {rows: Object.entries(by).map(([type, n]) => ({day: params.to, type, n, sum_ms: 0})), rows_read: 1};
    }
    return null;
  };
  const tags = t => t;
  return [
    ['GET', /^\/v1\/music\/tracks$/, CN, ({query}) => {
      const limit = Number(query.get('limit') || 200);
      const untagged = query.get('untagged') === '1';
      const q = (query.get('q') || '').toLowerCase();
      const rows = s.tracks.filter(t => (!untagged || !s.trackNotes.has(t.id)) && (!q || t.title.toLowerCase().includes(q)));
      return {items: rows.slice(0, limit).map(tags), total: rows.length};
    }],
    ['PUT', /^\/v1\/music\/notes$/, CN, ({body, role}) => {
      const items = body.items;
      if (!Array.isArray(items) || !items.length || items.length > 200) throw new HttpError(422, 'validation', 'items');
      const unknown = items.findIndex(n => !s.tracks.some(t => t.id === n.id));
      if (unknown >= 0) throw new HttpError(422, 'validation', 'not in the catalog', [{path: `items.${unknown}.id`, issue: 'not in the catalog'}]);
      let written = 0;
      for (const n of items) {
        const before = JSON.stringify(s.trackNotes.get(n.id)?.note);
        if (before !== JSON.stringify(n)) written++;
        s.trackNotes.set(n.id, {note: n, by: `mind:${role}`});
      }
      return {written, unchanged: items.length - written};
    }],
    ['GET', /^\/v1\/music\/notes$/, CN, ({query}) => {
      const ids = (query.get('ids') || '').split(',').filter(Boolean);
      if (!ids.length || ids.length > 200) throw new HttpError(422, 'validation', 'ids');
      const items = [];
      const missing = [];
      for (const id of ids) {
        const t = s.tracks.find(x => x.id === id);
        if (!t) missing.push(id);
        else {
          const kept = s.trackNotes.get(id);
          items.push({...tags(t), note: kept ? {...kept.note, by: kept.by, v: 1, at: 1} : null});
        }
      }
      return {items, missing, next: null};
    }],
    ['GET', /^\/v1\/music\/find$/, CN, ({query}) => {
      const moods = (query.get('moods') || '').split(',').filter(Boolean);
      const like = query.get('like');
      const limit = Number(query.get('limit') || 30);
      if (like && !s.tracks.some(t => t.id === like)) throw new HttpError(404, 'not_found');
      const items = s.tracks
        .filter(t => t.id !== like && (like || moods.some(m => s.trackNotes.get(t.id)?.note.moods?.[m])))
        .map(t => ({...tags(t), score: 1, known: s.trackNotes.get(t.id)?.note.known ?? null, why: {}}));
      return {items: items.slice(0, limit), total: items.length, analysis: false, left_out: {never: 0, skipped: 0}};
    }],
  ];
}
