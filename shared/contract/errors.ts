// The error envelope and every stable error code of API.md §6. Types only. Clients branch on
// `code`, never on `message`; COPY.md maps codes to the owner's words.
import type { PermitRefusal } from './permits.ts';

export type ErrorCode =
  // 400 / 401
  | 'bad_request'
  | 'unauthorized'
  | 'session_revoked'
  | 'session_expired'
  | 'wrong_username_or_password'
  | 'wrong_username_or_code'
  | 'setup_code_wrong'
  | 'current_password_wrong'
  // 403
  | 'forbidden'
  | 'origin_not_allowed'
  | 'not_owner_words'
  | 'session_tainted'
  | 'session_required'
  | 'laws_unpinned'
  | 'proposal_required'
  | 'needs_approval'
  | 'off_record'
  // 404 / 409
  | 'not_found'
  | 'conflict'
  | 'already_decided'
  | 'already_undone'
  | 'already_claimed'
  | 'already_live'
  | 'decision_budget'
  | 'nudge_repeat'
  | 'push_budget'
  | 'push_gap'
  | 'quiet_hours'
  | 'quiet'
  | 'spec_mismatch'
  | 'setup_required'
  | 'setup_fp_missing'
  | 'reset_already_pending'
  | 'agent_name_taken'
  | 'agent_limit'
  | 'already_said'
  // 410
  | 'setup_done'
  | 'expired'
  | 'reset_cancelled'
  | 'reset_expired'
  | 'reset_used'
  | 'resync_required'
  | 'gone'
  // 413 / 415 / 422
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_guessable'
  | 'password_breached'
  | 'password_same'
  | 'invalid_result'
  | 'too_sensitive'
  | 'username_invalid'
  | 'topic_quiet'
  | 'speech_budget'
  // 425 / 426 / 429
  | 'reset_not_ready'
  | 'client_outdated'
  | 'rate_limited'
  | 'too_many_scheduled'
  // 5xx
  | 'internal'
  | 'upstream'
  | 'budget_exhausted'
  | 'auth_unavailable'
  | 'unavailable'
  | 'not_configured';

/** One schema or rule problem: the field path and what is wrong with it (never the value). */
export interface Issue {
  path: string;
  issue: string;
}

/** `session_revoked` carries `reason`; `client_outdated` carries `min_client`; `reset_not_ready`
 * carries `usable_after`. */
export type RevokeReason =
  | 'signed_out_here'
  | 'signed_out_elsewhere'
  | 'password_changed'
  | 'recovery_used'
  | 'reset_used'
  | 'device_limit';

/** Field issues (422), a standing permission's refusal (403 `proposal_required`, reason `permit`:
 * the action, its class and the card to raise), or a small reason object. `reason` is a
 * RevokeReason on 401s and a short machine reason elsewhere (e.g. `not_undoable`). */
export type ErrorDetails =
  | Issue[]
  | PermitRefusal
  | {
      reason?: RevokeReason | (string & {});
      min_client?: number;
      usable_after?: number;
      /** A night step out of order (409): the step the run is at. */
      resume_from?: number;
      /** A book upload not yet whole (409): the parts received so far. */
      parts?: number[];
      /** A plan's step that was refused or failed (1-based), and its verb. */
      step?: number;
      verb?: string;
      /** A resting topic (422 `topic_quiet`): when it reopens, and that owner-local day. */
      until?: number;
      reopens?: string;
      /** The speech setting that refused (422 `speech_budget`) and what it has spent today. */
      speech?: string;
      spent?: { lines: number; cards: number };
    };

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
    request_id: string;
    /** Only with `rate_limited`: seconds to wait (also sent as `Retry-After`), and which counter. */
    retry_after?: number;
    scope?: 'source' | 'account';
  };
}
