// The P2 action shapes: the ledger and undo (API.md §11.9), verbs (§11.11) and surfaces
// (§11.12). Types only; the verb and surface vocabularies with their schemas are runtime data in
// verbs.ts and surfaces.ts.
import type { Id, Json, JsonObject, Ms } from './api';
import type { Permit, PermitPosition } from './permits.ts';

export type Actor = 'owner' | 'mind:chat' | 'mind:night' | 'mind:reflex' | 'muse' | 'ci' | 'worker';
/** `plan`: a plan's one row (API.md §11.11): its line on home (`what`), its steps' rows in its undo. */
export type LedgerKind =
  | 'memory'
  | 'arrangement'
  | 'verb'
  | 'plan'
  | 'deploy'
  | 'proposal'
  | 'mistake'
  | 'undo'
  | 'note';

export interface LedgerEntry {
  seq: number;
  id: Id;
  at: Ms;
  actor: Actor;
  kind: LedgerKind;
  what: string;
  why: string;
  ref: string | null;
  topic_key: string | null;
  undoable: boolean;
  status: 'done' | 'undone' | 'failed';
  tainted: boolean;
  proposal_id: Id | null;
  /** The standing permission a mind's action ran under (permits.ts): `tell` rows are the ones the
   * owner was to hear about. Null for anyone else's rows, and the mind's own bookkeeping. */
  permit: PermitPosition | null;
  undone_at: Ms | null;
}

/** PUT /v1/ledger/:id: actions taken outside the Worker (a merged PR, a deploy, a mistake). */
export interface PutLedgerRequest {
  kind: 'deploy' | 'mistake' | 'note';
  what: string;
  why: string;
  ref?: string;
  topic_key?: string;
}

export interface UndoResponse {
  undo_ledger_id: Id;
  status: 'undone' | 'queued';
}

/** `scheduled`: waiting for its `fire_at` (no phone sees it yet); `cancelled`: taken back before it ran. */
export type VerbStatus = 'pending' | 'claimed' | 'done' | 'failed' | 'expired' | 'scheduled' | 'cancelled';

export interface Verb {
  id: Id;
  verb: string;
  schema: number;
  ref: string | null;
  args: JsonObject;
  device_id: string | null;
  status: VerbStatus;
  proposal_id: Id | null;
  created_at: Ms;
  expires_at: Ms;
  result: Json | null;
  error: { code: string; message?: string } | null;
  /** The ledger row of this action (the undo handle); none while it is scheduled. */
  ledger_id: Id | null;
  /** When a scheduled verb runs (or ran): its `fire_at`, moved to the end of quiet hours for music
   * and podcasts. Null for one that ran as it was queued. Optional for readers of older answers. */
  fire_at?: Ms | null;
  /** The plan it is a step of (`POST /v1/verbs/plan`), or null. */
  plan_id?: Id | null;
}

/** A write the standing permissions gate (permits.ts), as it answers the mind: its record plus the
 * permit it ran under, so the chat role knows to say what it did (`tell`). Absent for the owner. */
export type Permitted<T> = T & { permit?: Permit };

/** PUT /v1/verbs/:id. `why` is the ledger line the owner can read (8–200 characters). */
export interface PutVerbRequest {
  verb: string;
  schema: number;
  args: JsonObject;
  why: string;
  ref?: string;
  device_id?: string;
  expires_at?: Ms;
  proposal_id?: Id;
  /** Run it later: an ISO time within the next 7 days, owner-local (no offset) or with its offset. */
  fire_at?: string;
}

/** PUT /v1/verbs/:id's answer: the verb and its permit; `shifted` when a scheduled music or podcasts
 * verb's time fell in quiet hours and it fires at their end instead (its `fire_at`). */
export type VerbAnswer = Permitted<Verb> & { shifted?: boolean };

/** One step of a plan: a verb call as `PUT /v1/verbs/:id` takes it, without its own why. */
export interface PlanStep {
  verb: string;
  schema: number;
  args: JsonObject;
  device_id?: string;
}

/** POST /v1/verbs/plan: 2–8 steps, one why (8–200), one line for home (`what`, ≤ 80), optionally
 * later (`fire_at`, as a verb's). `id` (a UUIDv7) makes it idempotent. */
export interface PostPlanRequest {
  id: Id;
  steps: PlanStep[];
  why: string;
  what: string;
  ref?: string;
  fire_at?: string;
  proposal_id?: Id;
}

/** A plan: `done` once its steps ran (Worker-side ones done, phone ones pending as intents),
 * `scheduled` until its `fire_at`, `failed` (a scheduled one whose step failed when it ran:
 * `error.step`, 1-based, names it, and nothing of it stands) or `cancelled`. */
export interface Plan {
  id: Id;
  status: 'scheduled' | 'done' | 'failed' | 'cancelled';
  what: string;
  why: string;
  created_at: Ms;
  fire_at: Ms | null;
  steps: { verb: string; schema: number; verb_id: Id | null; status: VerbStatus | null; ledger_id: Id | null }[];
  /** The plan's one ledger row (kind `plan`): its line on home and its undo. Null while scheduled. */
  ledger_id: Id | null;
  error: { code: string; step?: number; verb?: string } | null;
}
export type PlanAnswer = Permitted<Plan> & { shifted?: boolean };

/** GET /v1/verbs/scheduled: what waits for its time, soonest first (a plan as verb `plan.run`). */
export interface ScheduledResponse {
  items: Verb[];
}

/** POST /v1/verbs/:id/result. A phone that lacks the verb answers ok:false, code unsupported_verb. */
export interface VerbResultRequest {
  ok: boolean;
  result?: Json;
  undo?: { verb: string; schema?: number; args: JsonObject };
  error?: { code: string; message?: string };
}

/** One mix `music.mix_save` kept (GET /v1/music/mixes): `id` is the verb's that saved it, the id
 * `music.play_mix {mix_id}` takes; `tracks`: how many songs. */
export interface MusicMix {
  id: Id;
  name: string;
  tracks: number;
  recipe: string | null;
  created_at: Ms;
}
export interface MusicMixesResponse {
  items: MusicMix[];
}

export interface Surface {
  app: string;
  slot: string;
  kind: string;
  schema: number;
  payload: JsonObject;
  why: string;
  topic_key: string;
  ref: string | null;
  expires_at: Ms | null;
  written_at: Ms;
  seq: number;
  /** The ledger row of the last write (the undo handle). */
  ledger_id: Id | null;
}

export interface PutSurfaceRequest {
  kind: string;
  schema: number;
  payload: JsonObject;
  why: string;
  topic_key: string;
  ref?: string;
  expires_at?: Ms;
  /** Every fact the surface draws on (MEMORY.md §12): one the owner muted is refused
   * (422 `muted_fact`), one labelled outside and not kept (422 `outside_fact`), a private one too
   * (422 `too_sensitive`). */
  facts?: Id[];
}

export interface SurfacesResponse {
  items: Surface[];
  seq: number;
}
