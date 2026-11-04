// A week of practice and reading as counts (shared/contract/growth.ts; the `guitar_week` and
// `study_week` queries, `th guitar week`, `th study week`, night step 13): Guitar's sessions, clean
// passes and new bests, Study's reading, each by the (day, type) index over the 7 logical days that
// end on `to` (Guitar's new bests over the 28 days before as well, for the tempo gained). Sensitive
// events stay out; nothing here is the owner's words, only refs, numbers and bar ranges.
import {
  GROWTH,
  type GuitarSection,
  type GuitarSong,
  type GuitarWeek,
  type StudyBook,
  type StudyWeek,
} from '../../../../shared/contract/growth.ts';
import type { Db } from '../../objects/base';

const DAY_MS = 86_400_000;
/** The `n` logical days that end `skip` days before `to`, oldest first. */
export const daysTo = (to: string, n: number, skip = 0): string[] =>
  Array.from({ length: n }, (_, k) =>
    new Date(Date.parse(`${to}T12:00:00Z`) - (skip + n - 1 - k) * DAY_MS).toISOString().slice(0, 10),
  );
const marks = (xs: unknown[]) => xs.map(() => '?').join(', ');
const data = (json: string | null): Record<string, unknown> =>
  json ? (JSON.parse(json) as Record<string, unknown>) : {};
const whole = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const byRef = (a: { ref: string }, b: { ref: string }) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
/** The map's value at `key`, made by `make` the first time. */
function at<K, V>(m: Map<K, V>, key: K, make: () => V): V {
  const had = m.get(key);
  if (had) return had;
  const v = make();
  m.set(key, v);
  return v;
}

/** `tab:<song>#b<first>-<last>` (the printed bars) → the song's ref, the ladder's key and the bars. */
function sectionOf(ref: string): { song: string; key: string; bars: string } | null {
  const m = /^(tab:[^#]+)#b(\d{1,4})-(\d{1,4})$/.exec(ref);
  if (!m || Number(m[2]) < 1 || Number(m[3]) < Number(m[2])) return null;
  return { song: m[1], key: `${Number(m[2]) - 1}-${Number(m[3]) - 1}`, bars: `${m[2]}-${m[3]}` };
}
/** A ladder key `<a>-<b>` (bar indexes) → its printed bars. */
const barsOf = (key: string) => {
  const m = /^(\d{1,4})-(\d{1,4})$/.exec(key);
  return m && Number(m[1]) <= Number(m[2]) ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : null;
};

export function guitarWeek(db: Db, to: string): GuitarWeek {
  const week = daysTo(to, GROWTH.days);
  const before = daysTo(to, GROWTH.before_days, GROWTH.days);
  const sessions = db.all<{ day: string; ref: string | null; data_json: string | null }>(
    `SELECT day, ref, data_json FROM events WHERE day IN (${marks(week)}) AND type = 'guitar.session' AND sensitivity = 0`,
    ...week,
  );
  const passes = db.all<{ ref: string; clean: number; best: number | null; cleared: number }>(
    `SELECT ref, count(*) AS clean, max(CAST(json_extract(data_json, '$.bpm') AS INTEGER)) AS best,
       max(coalesce(json_extract(data_json, '$.speed_pct'), 0) >= ?) AS cleared
     FROM events WHERE day IN (${marks(week)}) AND type = 'guitar.pass' AND sensitivity = 0 AND ref IS NOT NULL
       AND json_extract(data_json, '$.clean') = 1
     GROUP BY ref`,
    GROWTH.full_pct,
    ...week,
  );
  const bests = db.all<{ ref: string; now: number | null; was: number | null }>(
    `SELECT ref, max(CASE WHEN day >= ? THEN CAST(json_extract(data_json, '$.bpm') AS INTEGER) END) AS now,
       max(CASE WHEN day < ? THEN CAST(json_extract(data_json, '$.bpm') AS INTEGER) END) AS was
     FROM events WHERE day IN (${marks([...before, ...week])}) AND type = 'guitar.bpm' AND sensitivity = 0
       AND ref IS NOT NULL
     GROUP BY ref`,
    week[0],
    week[0],
    ...before,
    ...week,
  );
  const songs = new Map<string, { sessions: number; seconds: number; keys: Map<string, GuitarSection> }>();
  const song = (ref: string) => at(songs, ref, () => ({ sessions: 0, seconds: 0, keys: new Map() }));
  const section = (ref: string, key: string, bars: string) =>
    at(song(ref).keys, key, () => ({
      key,
      bars,
      best_bpm: null,
      before_bpm: null,
      gained: 0,
      cleared: false,
      clean: 0,
    }));
  const days = new Set<string>();
  let seconds = 0;
  for (const e of sessions) {
    if (!e.ref?.startsWith('tab:')) continue;
    const d = data(e.data_json);
    const s = song(e.ref.split('#')[0]);
    s.sessions++;
    s.seconds += whole(d.seconds);
    seconds += whole(d.seconds);
    days.add(e.day);
    for (const k of Array.isArray(d.sections) ? d.sections : []) {
      const bars = typeof k === 'string' ? barsOf(k) : null;
      if (bars) section(e.ref.split('#')[0], k as string, bars);
    }
  }
  for (const p of passes) {
    const at = sectionOf(p.ref);
    if (!at) continue;
    const x = section(at.song, at.key, at.bars);
    x.clean = p.clean;
    x.best_bpm = p.best;
    x.cleared = p.cleared === 1;
  }
  for (const b of bests) {
    const at = sectionOf(b.ref);
    if (!at || (b.now === null && !songs.get(at.song)?.keys.has(at.key))) continue;
    const x = section(at.song, at.key, at.bars);
    x.before_bpm = b.was;
    x.gained = b.now !== null && b.was !== null ? Math.max(0, b.now - b.was) : 0;
  }
  const list: GuitarSong[] = [...songs.entries()].map(([ref, s]) => ({
    ref,
    outside: !/^tab:s?\d+$/.test(ref),
    sessions: s.sessions,
    minutes: Math.round(s.seconds / 60),
    sections: [...s.keys.values()]
      .sort((a, b) => Number(a.key.split('-')[0]) - Number(b.key.split('-')[0]) || (a.key < b.key ? -1 : 1))
      .slice(0, GROWTH.sections),
  }));
  list.sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions || byRef(a, b));
  const all = list.flatMap((s) => s.sections);
  return {
    from: week[0],
    to,
    sessions: list.reduce((n, s) => n + s.sessions, 0),
    minutes: Math.round(seconds / 60),
    days: days.size,
    cleared: all.filter((x) => x.cleared).length,
    gained: all.filter((x) => x.gained > 0).length,
    songs: list.slice(0, GROWTH.items),
  };
}

export function studyWeek(db: Db, to: string): StudyWeek {
  const week = daysTo(to, GROWTH.days);
  const reads = db.all<{ day: string; ref: string; data_json: string | null }>(
    `SELECT day, ref, data_json FROM events WHERE day IN (${marks(week)}) AND type = 'study.read' AND sensitivity = 0
       AND ref IS NOT NULL`,
    ...week,
  );
  const books = new Map<string, StudyBook & { on: Set<string>; ms: number }>();
  const days = new Set<string>();
  let ms = 0;
  for (const e of reads) {
    if (!e.ref.startsWith('book:')) continue;
    const d = data(e.data_json);
    const b = at(books, e.ref, () => ({
      ref: e.ref,
      reads: 0,
      pages: 0,
      minutes: 0,
      days: 0,
      on: new Set<string>(),
      ms: 0,
    }));
    b.ms += whole(d.ms);
    ms += whole(d.ms);
    if (whole(d.pages) < 1) continue;
    b.reads++;
    b.pages += whole(d.pages);
    b.on.add(e.day);
    days.add(e.day);
  }
  const items = [...books.values()]
    .map(({ on, ms: m, ...b }) => ({ ...b, minutes: Math.round(m / 60_000), days: on.size }))
    .sort((a, b) => b.pages - a.pages || b.minutes - a.minutes || byRef(a, b));
  return {
    from: week[0],
    to,
    reads: items.reduce((n, b) => n + b.reads, 0),
    pages: items.reduce((n, b) => n + b.pages, 0),
    minutes: Math.round(ms / 60_000),
    days: days.size,
    books: items.filter((b) => b.pages > 0).length,
    items: items.slice(0, GROWTH.items),
  };
}
