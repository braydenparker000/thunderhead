// The P2 action shapes: the ledger and undo (API.md §11.9), verbs (§11.11) and surfaces
// (§11.12). Types only; the verb and surface vocabularies with their schemas are runtime data in
// verbs.ts and surfaces.ts.
import type { Id, Json, JsonObject, Ms } from './api';

export type Actor = 'owner' | 'mind:chat' | 'mind:night' | 'mind:reflex' | 'muse' | 'ci' | 'worker';
export type LedgerKind = 'memory' | 'arrangement' | 'verb' | 'deploy' | 'proposal' | 'mistake' | 'undo' | 'note';

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

export type VerbStatus = 'pending' | 'claimed' | 'done' | 'failed' | 'expired';

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
  /** The ledger row of this action (the undo handle). */
  ledger_id: Id | null;
}

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
}

/** POST /v1/verbs/:id/result. A phone that lacks the verb answers ok:false, code unsupported_verb. */
export interface VerbResultRequest {
  ok: boolean;
  result?: Json;
  undo?: { verb: string; schema?: number; args: JsonObject };
  error?: { code: string; message?: string };
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
}

export interface SurfacesResponse {
  items: Surface[];
  seq: number;
}
