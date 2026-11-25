// The bulk lane's day (DATA.md §8.3): lane jobs and writers in other objects share 40,000 rows a UTC
// day, counted in Core's `settings['bulk.day']` (today's count only: a past day's is not kept). Read by
// the runner, the import, GET /v1/ops/meter, deep health and GET /v1/ops/diag.
import { DAY, utcDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import * as settings from '../settings/store';

export const LANE_ROWS_PER_DAY = 40_000;

export interface Lane {
  day: string;
  rows: number;
}

/** Today's lane (UTC): the stored count, or none yet. */
export const lane = (db: Db, now: number): Lane => {
  const l = settings.getSetting(db, 'bulk.day') as Lane | undefined;
  return l && l.day === utcDay(now) ? l : { day: utcDay(now), rows: 0 };
};

/** 00:05 UTC of the next day, when the lane opens again. */
export const nextLaneDay = (now: number) => Date.parse(`${utcDay(now + DAY)}T00:05:00Z`);

/** Rows the bulk lane has written today (UTC), for writers in other objects (library ingestion). */
export const laneRows = (db: Db, now: number): number => lane(db, now).rows;

/** Today's lane as the diagnostics show it: its rows, the cap, whether it is open, when it opens again. */
export function laneToday(db: Db, now: number) {
  const l = lane(db, now);
  const cap = LANE_ROWS_PER_DAY;
  return { day: l.day, rows: l.rows, cap, open: l.rows < cap, resume_at: nextLaneDay(now) };
}
