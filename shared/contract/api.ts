// The /v1 request and response shapes, as types only: the P1 routes here (API.md §2,
// §11.1–11.4, §11.16, §11.20), P2's in conversation.ts and actions.ts, P3's in memory.ts. The
// backend checks its zod schemas and responses against these with `satisfies`; the frontend
// imports them through JSDoc. Wire format is snake_case. Runtime vocabularies are in index.ts.
export type * from './actions';
export type * from './conversation';
export type * from './memory';
export type { ErrorBody, ErrorCode, ErrorDetails, Issue, RevokeReason } from './errors';
export type { AppId, ChangeKind, FrameType, SearchSource } from './feed';
export type { Ref, RefKind } from './refs';

export type Id = string;
export type Ms = number;
/** Any JSON value: what `meta`, verb args and results, and surface payloads may hold. Interfaces
 * (not a recursive type alias) keep the Durable Object RPC types shallow. */
export type Json = string | number | boolean | null | JsonArray | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}
export interface JsonArray extends Array<Json> {}
export type Day = string;
export type Page<T> = { items: T[]; next: string | null };

export type AgentRole = 'mind:chat' | 'mind:night' | 'mind:reflex' | 'muse' | 'ci';

// --- health (§11.1) ----------------------------------------------------------------------------

export interface Version {
  id: string;
  /** The deployed commit's short sha (`wrangler deploy --tag`); null for an untagged upload. */
  tag: string | null;
}

export interface HealthResponse {
  ok: true;
  version: Version;
  min_client: number;
  at: Ms;
}

export interface ObjectHealth {
  /** `schema >= expected` (applied step vs the newest this code knows): expand-only migrations. */
  ok: boolean;
  schema: number;
  expected: number;
  db_bytes: number;
  jobs_backlog: number;
  last_alarm_at: Ms | null;
}

export interface DeepHealthResponse {
  ok: boolean;
  version: Version;
  schema: Record<string, number>;
  objects: Record<string, ObjectHealth>;
  meter_today: { rows_written: number; rows_read: number; bulk_rows_written: number; bulk_lane: string | null };
  last_backup: { date: Day; age_h: number } | null;
  last_events_export: Day | null;
  errors_open: number;
  wakes_today: number;
  min_client: number;
}

// --- auth (§11.2) ------------------------------------------------------------------------------

export interface DeviceHints {
  platform?: string;
  browser?: string;
  model?: string;
  standalone?: boolean;
}

export interface SignedIn {
  token: string;
  session_id: string;
  idle_days: 90;
}

export type SignedInWithCode = SignedIn & { recovery_code: string };

export type NoticeKind =
  | 'new_device'
  | 'password_changed'
  | 'recovery_used'
  | 'reset_used'
  | 'reset_pending'
  | 'reset_cancelled'
  | 'agent_key_created';

export interface Notice {
  id: Id;
  kind: NoticeKind;
  created_at: Ms;
  expires_at: Ms | null;
  about_session_id: string | null;
  args: {
    label?: string;
    region?: string;
    country?: string;
    at?: Ms;
    name?: string;
    role?: string;
    ticket_id?: Id;
    usable_after?: Ms;
  };
}

export interface AuthStateResponse {
  setup: 'open' | 'done';
  setup_fp?: 'ready' | 'missing' | 'mismatch';
  reset?: 'none' | 'pending' | 'ready' | 'cancelled' | 'expired' | 'used';
  usable_after?: Ms;
}

export interface SetupRequest {
  setup_code: string;
  username: string;
  password: string;
  device: DeviceHints;
}

export interface LoginRequest {
  username: string;
  password: string;
  device: DeviceHints;
}

export interface RecoverRequest {
  username: string;
  /** The recovery code, or the reset code once its ticket is ready. */
  code: string;
  new_password: string;
  device: DeviceHints;
}

export interface SignoutRequest {
  scope: 'this' | 'others' | 'all';
}

export interface DeviceMe {
  session_id: string;
  label: string;
  notices: Notice[];
  recovery_confirmed: boolean;
}

export interface AgentMe {
  agent_id: Id;
  role: AgentRole;
  name: string;
}

export type MeResponse = DeviceMe | AgentMe;

export interface PasswordRequest {
  current_password: string;
  new_password: string;
  sign_out_others: boolean;
}

export interface PasswordResponse {
  token?: string;
}

export interface RecoveryCodeRequest {
  current_password: string;
}

export interface RecoveryCodeResponse {
  recovery_code: string;
}

export interface RecoveryConfirmRequest {
  last5: string;
}

export interface BreakglassRequest {
  fingerprint: string;
}

export interface BreakglassResponse {
  ticket_id: Id;
  usable_after: Ms;
  expires_at: Ms;
}

export interface BreakglassCancelRequest {
  ticket_id: Id;
}

export interface NoticeAckRequest {
  answer: 'me' | 'not_me' | 'ok';
}

// --- sessions (§11.3) and agent keys (§11.4) ---------------------------------------------------

export interface SessionItem {
  id: string;
  label: string;
  platform: string | null;
  browser: string | null;
  standalone: boolean;
  region: string | null;
  country: string | null;
  last_country: string | null;
  signed_in_at: Ms;
  last_seen_at: Ms;
  this_device: boolean;
}

export interface SessionsResponse {
  items: SessionItem[];
}

export interface SessionLabelRequest {
  label: string;
}

export interface AgentItem {
  id: Id;
  name: string;
  role: AgentRole;
  created_at: Ms;
  created_on: string;
  last_used_at: Ms | null;
  last_country: string | null;
}

export interface AgentsResponse {
  items: AgentItem[];
}

export interface NewAgentRequest {
  name: string;
  role: AgentRole;
  current_password: string;
}

export interface NewAgentResponse {
  id: Id;
  /** Shown once; never retrievable again. */
  token: string;
}

// --- ops (§11.16) and settings (§11.20) --------------------------------------------------------

export type ErrorSource = 'client' | 'csp' | 'job';

export interface ErrorReport {
  fingerprint?: string;
  source: ErrorSource;
  route?: string;
  code: string;
  /** ≤ 300 characters; scrubbed again by the server. Never personal content. */
  message: string;
  build: number;
  at: Ms;
  count?: number;
}

export interface ErrorsRequest {
  items: ErrorReport[];
}

export interface ErrorRow {
  fingerprint: string;
  source: ErrorSource | 'worker' | 'do';
  route: string | null;
  code: string;
  message: string;
  count: number;
  first_at: Ms;
  last_at: Ms;
  last_build: number | null;
  resolved_at: Ms | null;
}

export interface PerfRequest {
  day: Day;
  build: number;
  metrics: Partial<
    Record<
      'inp' | 'loaf_gesture' | 'start_warm' | 'start_cold' | 'api_ms' | 'heap_mb',
      { p50: number; p75: number; p95: number; n: number }
    >
  >;
}

export interface MeterResponse {
  items: { day: Day; class: string; rows_written: number; rows_read: number; bulk_rows_written: number }[];
}

/** Settings known in P1. `owner.tz` is an IANA name set from the phone; it lives only in Core. */
export interface Settings {
  'owner.tz': string;
  min_client: number;
  [key: string]: unknown;
}

export type SettingsPatch = Partial<Pick<Settings, 'owner.tz' | 'min_client'>>;
