// Reports the phone sends about how the apps run (NEXT-BATCH.md part 1): Music's playback log
// first, in small batches. The Worker keeps each batch as one row for 30 days and gives them back
// to the owner's devices, the mind and CI. Timings and track ids only, never titles or words; the
// Worker cuts every address in a batch to its host again before it keeps it.
import type { Id, JsonObject, Ms } from './api.ts';

/** What a batch is about. `playback`: Music's playback log since the batch before. */
export const REPORT_KINDS = ['playback'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LIMITS = {
  /** A batch's `body` as JSON, in bytes. */
  body_bytes: 32 * 1024,
  /** How long a batch is kept, in days. */
  keep_days: 30,
  /** Batches one device may send in any 5 minutes (the phone sends one a minute while music
   * plays, and one when the page is hidden). */
  per_5_min: 6,
  /** Batches in one page of `GET /v1/ops/reports`. */
  page_max: 200,
} as const;

export interface ReportRequest {
  kind: ReportKind;
  body: JsonObject;
}

export interface ReportCreated {
  id: Id;
  at: Ms;
}

export interface Report {
  id: Id;
  kind: ReportKind;
  /** The device session that sent it. */
  device_id: string;
  /** When the Worker took it. */
  at: Ms;
  body: JsonObject;
}
