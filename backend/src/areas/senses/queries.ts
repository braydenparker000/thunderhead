// The agents' questions about the senses (API.md §11.14 `POST /v1/senses/query`): a fixed map of
// named queries, never SQL from outside. `check` runs in the route (its parameters checked, a 422
// naming the bad one); `run` runs in the Senses object with what `check` returned. A sensitive event
// (sensitivity 1) is named by its type and time only: its ref and data stay out of every answer.
import { SENSE_APPS, SENSE_LIMITS, SENSE_TYPE, SENSE_TYPES } from '../../../../shared/contract/senses.ts';
import { ApiError } from '../../http/errors';
import type { Db } from '../../objects/base';
import { logicalDay } from '../conversation/day';
import { routines, windowDays } from './routines';
import * as store from './store';
import { guitarWeek, studyWeek } from './week';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = /^[a-z]+(\.[a-z_]+)*$/;
type P = Record<string, unknown>;
const bad = (path: string, issue: string): never => {
  throw new ApiError('validation', [{ path: `params.${path}`, issue }]);
};
const day = (v: unknown, path: string) => (typeof v === 'string' && DAY.test(v) ? v : bad(path, 'a day, YYYY-MM-DD'));
const type = (v: unknown, path: string) =>
  typeof v === 'string' && SENSE_TYPE.test(v) ? v : bad(path, 'a sense type, like music.skip');
const int = (v: unknown, path: string, lo: number, hi: number, fallback?: number): number => {
  if (v === undefined && fallback !== undefined) return fallback;
  return Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
    ? (v as number)
    : bad(path, `${lo} to ${hi}`);
};

/** An event as an agent reads it. */
const shown = (e: store.EventRow) =>
  e.sensitivity
    ? { seq: e.seq, id: e.id, at: e.at, day: e.day, type: e.type, sensitivity: 1 }
    : {
        seq: e.seq,
        id: e.id,
        at: e.at,
        day: e.day,
        type: e.type,
        ref: e.ref,
        data: e.data_json ? JSON.parse(e.data_json) : null,
        sensitivity: 0,
      };

const QUERIES: Record<string, { check: (p: P, now: number) => P; run: (db: Db, a: P) => unknown[] }> = {
  counts_by_day: {
    check(p) {
      const from = day(p.from, 'from');
      const to = day(p.to, 'to');
      if (to < from) bad('to', 'on or after from');
      return { from, to, type: p.type === undefined ? null : type(p.type, 'type') };
    },
    run: (db, a) => store.countsByDay(db, a.from as string, a.to as string, a.type as string | null),
  },
  top_refs: {
    check(p, now) {
      const days = int(p.days, 'days', 1, SENSE_LIMITS.hot_days);
      return {
        type: type(p.type, 'type'),
        since: new Date(now - days * 86_400_000).toISOString().slice(0, 10),
        limit: int(p.limit, 'limit', 1, 100, 20),
      };
    },
    run: (db, a) => store.topRefs(db, a.type as string, a.since as string, a.limit as number),
  },
  sequence: {
    check(p) {
      const prefix = p.type_prefix ?? null;
      if (prefix !== null && (typeof prefix !== 'string' || !PREFIX.test(prefix)))
        bad('type_prefix', 'like music or music.skip');
      return { day: day(p.day, 'day'), after: int(p.after_seq, 'after_seq', 0, Number.MAX_SAFE_INTEGER, 0), prefix };
    },
    run: (db, a) => store.sequence(db, a.day as string, a.after as number, a.prefix as string | null, 500).map(shown),
  },
  last_event: {
    check: (p) => ({ type: type(p.type, 'type') }),
    run(db, a) {
      const e = store.lastEvent(db, a.type as string);
      return e ? [shown(e)] : [];
    },
  },
  /** One day's counts by type (the night's `th day`): never content. */
  day_summary: {
    check: (p) => ({ day: day(p.day, 'day') }),
    run: (db, a) => store.summary(db, a.day as string),
  },
  /** When the owner does things (routines.ts): of one type, one app's types, or every type, over the
   * 28 logical days that end on `to` (today's by default), in the owner's zone (`tz`, which the
   * route adds). Weekdays, hours and counts only, whatever an event's sensitivity. */
  routines: {
    check(p) {
      if (p.type !== undefined && p.app !== undefined) bad('app', 'a type or an app, not both');
      const app = p.app ?? null;
      if (app !== null && !(SENSE_APPS as readonly unknown[]).includes(app))
        bad('app', `one of ${SENSE_APPS.join(', ')}`);
      const types =
        p.type !== undefined
          ? [type(p.type, 'type')]
          : app !== null
            ? Object.entries(SENSE_TYPES)
                .filter(([, s]) => s.app === app)
                .map(([k]) => k)
            : null;
      return { types, to: p.to === undefined ? null : day(p.to, 'to') };
    },
    run(db, a) {
      const tz = typeof a.tz === 'string' && a.tz ? a.tz : 'UTC';
      const to = (a.to as string | null) ?? logicalDay(Date.now(), tz);
      return routines(store.quarterCounts(db, windowDays(to), a.types as string[] | null), to, tz);
    },
  },
  /** A week of Guitar and of Study (week.ts, growth.ts): the 7 logical days that end on `to`, as
   * counts, refs and bar ranges, never content; each answers one row. */
  guitar_week: {
    check: (p) => ({ to: day(p.to, 'to') }),
    run: (db, a) => [guitarWeek(db, a.to as string)],
  },
  study_week: {
    check: (p) => ({ to: day(p.to, 'to') }),
    run: (db, a) => [studyWeek(db, a.to as string)],
  },
};
export const QUERY_NAMES = Object.keys(QUERIES);

/** The query's parameters, checked (in the route). */
export function check(name: string, params: P, now = Date.now()): P {
  const q = Object.hasOwn(QUERIES, name) ? QUERIES[name] : undefined;
  if (!q) throw new ApiError('validation', [{ path: 'name', issue: `one of ${QUERY_NAMES.join(', ')}` }]);
  return q.check(params, now);
}

/** The query run on checked parameters (in the Senses object). */
export const run = (db: Db, name: string, args: P): unknown[] => QUERIES[name].run(db, args);
