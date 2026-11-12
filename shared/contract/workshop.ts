// The workshop's files (API.md §11.27): a file of any kind the owner sends from the phone for the
// agent that builds Thunderhead with them (a RAW to test the editor on, another app's export to
// compare with). It goes up in pieces small enough to survive a weak line, each kept as its own
// object under `workshop/` in the private bucket and checked against its SHA-256; nothing reads
// them but the owner's phone (this list) and a session the owner gave the account's storage to
// (scripts/workshop.mjs). They stay until the owner removes them.
import type { Id, Ms } from './api';

export const WORKSHOP_LIMITS = {
  /** Each piece but the last is exactly this size. */
  part_bytes: 8 * 1024 * 1024,
  /** One file. */
  file_bytes: 512 * 1024 * 1024,
  /** Every file together: well inside the bucket's free 10 GB, so this never costs anything. */
  total_bytes: 4 * 1024 * 1024 * 1024,
} as const;

export interface WorkshopFile {
  id: Id;
  name: string;
  bytes: number;
  /** How many pieces it takes, and which are in. */
  parts: number;
  have: number[];
  /** When its first piece arrived. */
  at: Ms;
}

export interface WorkshopListResponse {
  items: WorkshopFile[];
  /** What is stored, of `limit`. */
  bytes: number;
  limit: number;
  part_bytes: number;
}

export interface WorkshopPartResponse {
  n: number;
  have: number[];
}
