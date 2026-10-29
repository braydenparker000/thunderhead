// Memory's runtime vocabulary (MEMORY.md §2–§8): fact kinds with their half-lives and profile
// caps, sources with their starting confidence and caps, the decay formula, and the reasons a
// memory op can be refused. The Worker enforces them, the phone renders by them (a kind or source
// it does not know shows generically), and `th` validates with them. Plain data and one pure
// function, importable by Node without a build.

/** Fact kinds in profile order (MEMORY.md §8.3). `half_life_days: null` never decays; `cap` is
 * the profile's per-kind limit (rules have their own briefing section, never the profile). */
export const FACT_KINDS = {
  state: { half_life_days: 3, cap: 10 },
  goal: { half_life_days: 90, cap: 10 },
  preference: { half_life_days: 180, cap: 25 },
  routine: { half_life_days: 60, cap: 15 },
  fact: { half_life_days: 5 * 365, cap: 30 },
  rule: { half_life_days: null, cap: null },
} as const;
export type FactKind = keyof typeof FACT_KINDS;
export const FACT_KIND_NAMES = Object.keys(FACT_KINDS) as FactKind[];

/** Sources (MEMORY.md §4): starting confidence, cap, and the profile's one-letter tag. */
export const FACT_SOURCES = {
  user: { base: 0.95, cap: 0.95, letter: 'u' },
  observed: { base: 0.7, cap: 0.85, letter: 'o' },
  inferred: { base: 0.5, cap: 0.8, letter: 'i' },
} as const;
export type FactSource = keyof typeof FACT_SOURCES;

export const FACT_ABOUT = ['owner', 'world', 'person'] as const;
export type FactAbout = (typeof FACT_ABOUT)[number];

/** Thresholds on the decayed confidence (MEMORY.md §5): out of the profile below `profile`,
 * listed under "Fading" below `fading`, said with "last I knew" below `hedge`. */
export const CONFIDENCE = { profile: 0.25, fading: 0.1, hedge: 0.5, pinned_user: 1, imported: 0.6 } as const;

/** Tags that need the owner's own words (rule M7) and that are never inferred (M14). `faith`
 * also defaults to `may_raise = 0`. */
export const OWNER_ONLY_TAGS = ['faith'] as const;
export const SENSITIVE_TAGS = ['health', 'sexuality', 'politics', 'religion', 'faith', 'finances'] as const;
/** The tag the notebook import gives facts the owner has yet to review (MEMORY.md §14). */
export const IMPORTED_TAG = 'imported';

export const MEMORY_LIMITS = {
  ops_per_batch: 50,
  fact_text: 280,
  evidence_max: 20,
  tags_max: 8,
  thread_text: 200,
  day_note_words: 150,
  decisions_max: 10,
  profile_chars: 6_000,
  /** M10: supersessions one night batch may apply before the rest wait for the owner. */
  night_supersedes: 10,
} as const;

/** Why one memory op was not applied (API.md §11.13): MEMORY.md §6's codes plus the Worker's. */
export const MEMORY_REASONS = {
  bad_op: 'The op does not match its shape.',
  bad_evidence: 'Evidence must be 1–20 existing messages, day notes, imports or owner ledger rows.',
  unknown_ref: 'The fact this op names does not exist.',
  not_owner_evidence: "A 'user' fact needs evidence that is all the owner's own words.",
  rule_needs_owner: "A rule needs source 'user'.",
  too_little_evidence: "An 'observed' fact needs at least 10 owner-device events.",
  tainted_evidence: 'Muse or outside text is never evidence.',
  needs_owner_words: "Faith and facts about people come only from the owner's words.",
  too_long: 'One claim, at most 280 characters.',
  no_inferred_sensitive: 'Sensitive traits are never inferred.',
  session_tainted: 'This session read outside text, so it may not write memory.',
  laws_unpinned: "This session's constitution is missing, so it may not write rules.",
  device_only: 'Only the owner can do this, from the Memory page.',
  duplicate_id: 'A fact with this id already exists.',
  superseded: 'This fact was already replaced; work on its newest version.',
  proposal_required: 'This change needs the owner first (decision cards arrive in P4).',
} as const;
export type MemoryReason = keyof typeof MEMORY_REASONS;

const DAY_MS = 86_400_000;

/** The confidence now (MEMORY.md §5): `c0 · 0.5^((now − last_confirmed) / half_life(kind))`.
 * Computed at read time, never written. Rules and pinned facts do not decay; a pinned `user`
 * fact reads 1.0. A kind this build does not know decays like `fact`. */
export function decayed(
  f: { kind: string; source: string; confidence: number; last_confirmed: number; pinned: boolean | number },
  now: number,
): number {
  if (f.pinned) return f.source === 'user' ? CONFIDENCE.pinned_user : f.confidence;
  const known = Object.hasOwn(FACT_KINDS, f.kind) ? FACT_KINDS[f.kind as FactKind] : FACT_KINDS.fact;
  if (known.half_life_days === null) return f.confidence;
  const age = Math.max(0, now - f.last_confirmed) / DAY_MS;
  return f.confidence * 0.5 ** (age / known.half_life_days);
}

// --- the wire shapes (API.md §11.13) ------------------------------------------------------------

type Id = string;
type Ms = number;

/** A fact as the API returns it. `confidence` is c0 at the last confirm; `confidence_now` is the
 * decayed value at the time of the read. `ledger_id` is the row that wrote this version (its
 * `why` is the reason the mind gives for knowing it). */
export interface Fact {
  id: Id;
  kind: FactKind;
  about: FactAbout;
  subject: string | null;
  text: string;
  tags: string[];
  source: FactSource;
  confidence: number;
  confidence_now: number;
  evidence: string[];
  valid_from: Ms | null;
  valid_to: Ms | null;
  recorded_at: Ms;
  superseded_at: Ms | null;
  superseded_by: Id | null;
  last_confirmed: Ms;
  sensitivity: 0 | 1;
  pinned: boolean;
  may_raise: boolean;
  written_by: string;
  ledger_id: Id | null;
}

export interface AddOp {
  op: 'add';
  id: Id;
  kind: FactKind;
  subject?: string;
  text: string;
  source: FactSource;
  evidence: string[];
  about?: FactAbout;
  tags?: string[];
  valid_from?: Ms;
  sensitivity?: 0 | 1;
  may_raise?: boolean;
}

/** A memory op (API.md §11.13). `supersede.new` fields left out are copied from the old fact. */
export type MemoryOp =
  | AddOp
  | { op: 'confirm'; id: Id; evidence?: string[] }
  | {
      op: 'supersede';
      id: Id;
      reason?: string;
      new: { id: Id; text: string; evidence: string[] } & Partial<Omit<AddOp, 'op' | 'id' | 'text' | 'evidence'>>;
    }
  | { op: 'pin'; id: Id; pinned: boolean }
  | { op: 'may_raise'; id: Id; value: boolean }
  | { op: 'forget'; id: Id };

export interface MemoryOpsRequest {
  batch_id: Id;
  ops: MemoryOp[];
}

export interface MemoryOpsResponse {
  applied: { i: number; fact_id: Id; ledger_id: Id }[];
  /** Ops routed to the owner as `memory_big` proposals (empty until proposals arrive, P4). */
  proposals: { i: number; proposal_id: Id }[];
  rejected: { i: number; reason: MemoryReason }[];
}

export interface ProfileResponse {
  text: string;
  fact_ids: Id[];
  rendered_at: Ms;
}

export interface DayNote {
  day: string;
  summary: string;
  decisions: string[];
  stats: Record<string, number>;
  importance: number;
  written_by: string;
  version: number;
  written_at: Ms;
}

export interface PutDayNoteRequest {
  summary: string;
  decisions: string[];
  importance: number;
}

export type OpenThreadStatus = 'open' | 'done' | 'dropped';

export interface OpenThread {
  id: Id;
  text: string;
  owner: 'mind' | 'owner';
  due_at: Ms | null;
  tags: string[];
  status: OpenThreadStatus;
  evidence: string[];
  opened_at: Ms;
  last_progress_at: Ms | null;
  closed_at: Ms | null;
  closed_why: string | null;
}

export interface PutOpenThreadRequest {
  text: string;
  owner: 'mind' | 'owner';
  due_at?: Ms;
  evidence: string[];
  tags?: string[];
  status?: OpenThreadStatus;
  why?: string;
}

export interface PatchOpenThreadRequest {
  status: 'done' | 'dropped';
  why?: string;
}
