// What the owner does, as events (API.md §11.14, DATA.md §6.1, MUSIC.md §10.1): the phone's sealed
// batches, and the agents' fixed questions about them. Never SQL from outside.
import type { Id, Ms } from './api';
import type { Ref } from './refs';

export const SENSE_LIMITS = {
  batch_events: 500,
  batch_bytes: 256 * 1024,
  data_bytes: 2_048,
  /** An event's time: at most this far back, and this far ahead of the Worker's clock. */
  past_ms: 30 * 24 * 60 * 60 * 1000,
  future_ms: 5 * 60 * 1000,
  /** Events stay in SQLite this many days; the daily archive in the private bucket keeps them all. */
  hot_days: 90,
  /** Batch records (the dedupe) are kept this long. */
  batch_days: 30,
} as const;

/** `music.skip`, `home.open.v2`: an app, then one or more parts, optionally a version. */
export const SENSE_TYPE = /^[a-z]+(\.[a-z_]+)+(\.v\d+)?$/;

export interface SenseEvent {
  id: Id;
  at: Ms;
  type: string;
  ref?: Ref | null;
  data?: Record<string, unknown>;
  sensitivity?: 0 | 1;
}

export type SenseRejectReason = 'bad_type' | 'bad_time' | 'too_large' | 'bad_ref' | 'bad_id';

/** PUT /v1/senses/batches/:batch_id */
export interface SenseBatchRequest {
  events: SenseEvent[];
}
export interface SenseBatchResponse {
  accepted: number;
  rejected: { i: number; reason: SenseRejectReason }[];
}

/** POST /v1/senses/query: one of these, with its parameters. */
export const SENSE_QUERIES = {
  /** Events a day by type: `{ from: Day, to: Day, type?: string }` → `{ day, type, n, sum_ms }[]`. */
  counts_by_day: 'counts_by_day',
  /** The most frequent refs of a type over the last `days` (≤ 90): `{ type, days, limit? }` → `{ ref, n, sum_ms }[]`. */
  top_refs: 'top_refs',
  /** One day's events in order (≤ 500 a page): `{ day, after_seq?, type_prefix? }` → events. */
  sequence: 'sequence',
  /** The newest event of a type: `{ type }` → one event or none. */
  last_event: 'last_event',
  /** One day's counts by type, never content (the night's `th day`): `{ day }` → `{ type, n, sum_ms }[]`. */
  day_summary: 'day_summary',
} as const;
export type SenseQueryName = keyof typeof SENSE_QUERIES;

export interface SenseQueryResponse {
  rows: unknown[];
  rows_read: number;
}

/** One day's events in `th day` (RUNTIME.md §12 step 1): counts by type, never content. */
export interface EventsSummary {
  day: string;
  total: number;
  by_type: { type: string; n: number; sum_ms: number }[];
}
