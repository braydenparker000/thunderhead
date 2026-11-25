// GET /v1/ops/diag (API.md §11.16): the live Worker's state for diagnosis from outside, read by the
// owner's device and the CI key. Counts, states, times, error codes and host names only: never a
// message, memory, song, album or artist name, file name or a job's payload.
import type { Version } from './api.ts';
import type { BulkLane, MeterItem, QuotaToday } from './meter.ts';

/** One row of Core's jobs table, without its payload or cursor. */
export interface DiagJob {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  due_at: number;
  attempts: number;
  /** A code and an error's name only (areas/jobs/runner.ts), or null. */
  last_error: string | null;
  rows_written: number;
  created_at: number;
  updated_at: number;
}

/** The music knowledge job (MUSIC.md §19), names left out. */
export interface DiagKnow {
  phase: 'matching' | 'facts' | 'picks' | 'idle';
  at: number | null;
  /** When the facts and the top artists were last refreshed, and the picks last built (0: never). */
  refreshed: number;
  top_at: number;
  picks_at: number;
  /** GET /v1/music/know's counts (`know.counts`, counted again at most every 10 minutes). */
  counts: {
    albums: { total: number; matched: number; unmatched: number; due: number };
    songs: { matched: number };
    artists: { total: number; done: number };
    filled: Record<string, number>;
    picks: Record<string, number>;
  };
  /** `know.hosts`, by host name: failures in a row, until when it is left alone, when it last answered
   * and refused. */
  hosts: Record<string, { fails: number; until: number; ok_at: number | null; refused_at: number | null }>;
  /** Which outside keys the Worker has (never their values). */
  keys: { lastfm: boolean; discogs: boolean; listenbrainz: boolean };
  /** `know_facts` rows by kind: with work left (`busy = 1`), without, and with sources still to ask. */
  facts: Record<string, { busy: number; idle: number; todo: number }>;
  /** Rows that still have each source to ask (their `todo` split on commas). */
  todo: Record<string, number>;
}

type Rows = { rows_read: number; rows_written: number };

export interface DiagResponse {
  version: Version;
  at: number;
  /** Core's jobs, newest change first (≤ 200; finished ones go 30 days after). */
  jobs: DiagJob[];
  lane: BulkLane & { open: boolean; resume_at: number };
  /** Today's use as the quota computes it, with the budget and the hold level in rows. */
  quota: QuotaToday & { budget: Rows; hold_at: Rows };
  /** Each class's rows today (UTC), as GET /v1/ops/meter has them. */
  meter: MeterItem[];
  /** Null when Music can't answer (a Music on the release before it, for a moment of a deploy). */
  know: DiagKnow | null;
}
