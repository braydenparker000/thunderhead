// The mind's briefing and what comes with each owner message (API.md §11.8, MEMORY.md §9). Types and
// the limits both the Worker and `th` hold. A SessionStart hook's plain stdout is capped at 10,000
// characters per hook command, so the briefing comes in up to three parts, one per hook command.
import type { Day, Id } from './api';
import type { MindRole } from './conversation';

/** Parts at most, each part's characters at most, and a waiting message's recall lines in part 1. */
export const BRIEF_PARTS = { max: 3, chars: 9_400, waiting_recall: 3 } as const;

/** Memories handed out with an owner message: at most `items`, each `text` at most `text`
 * characters; none for a message under `min_chars`; the whole search gets `ms` before the handout. */
export const RECALL_LIMITS = { items: 5, text: 200, min_chars: 12, ms: 400 } as const;

/** One memory that matches an owner message (the same search `th recall` runs): its ref
 * (`fact:…`, `day:…`, `msg:…`), its kind (the search source) and its words. */
export interface RecallItem {
  ref: string;
  kind: string;
  text: string;
}

export interface BriefRequest {
  claim: boolean;
  session_id: string;
  role: MindRole;
  constitution_sha256: string;
  th_version: string;
}

export interface BriefResponse {
  wake: { id: Id; reason: string; claim_match: 'exact' | 'loose' | 'manual' } | null;
  day: Day;
  seq: number;
  core: string;
  full: string;
  /** The briefing in 1–3 parts of whole sections, each ≤ BRIEF_PARTS.chars (one per hook command). */
  parts: string[];
  /** The `## <name>` section of mind/ROLES.md this session reads, when not its role's own. */
  role_section?: string;
  /** The voice page (shared/contract/voice.ts): the session's start prints it beside its role. */
  voice?: string;
  night_done: boolean;
  provenance: 'owner' | 'outside'; // what its memory writes are labelled (MEMORY.md §7, M11)
  tainted: boolean; // `provenance === 'outside'` by its old name, kept one release (from 2026-11-02)
}
