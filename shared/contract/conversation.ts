// The P2 shapes: the conversation (API.md §2, §11.7), the change feed and live channel (§11.5,
// §11.6, §12), search and the mind's own routes (§11.8). Types only, like api.ts; wire format is
// snake_case. The vocabularies these name (change kinds, frames, apps, sources) are runtime data
// in feed.ts.
import type { Day, Id, JsonObject, Ms, Page } from './api';
import type { AppId, ChangeKind, SearchSource } from './feed';

export type ThreadKind = 'daily' | 'muse' | 'imported';
export type ThreadStatus = 'open' | 'filed';

export interface Thread {
  id: Id;
  day: Day;
  kind: ThreadKind;
  status: ThreadStatus;
  title: string | null;
  title_source: 'auto' | 'mind' | 'owner' | null;
  summary: string | null;
  continues: Id | null;
  message_count: number;
  started_at: Ms;
  updated_at: Ms;
  filed_at: Ms | null;
}

export type MessageAuthor = 'owner' | 'mind' | 'muse' | 'system';
export type MessageOrigin = 'owner_device' | 'mind' | 'system' | 'muse' | 'import';
export type MessageKind = 'text' | 'voice' | 'progress' | 'card' | 'question' | 'error';

/** The one action chip a mind reply may carry in `meta.chip` (API.md §11.7 rule 7). Tapping it
 * runs the device verb `app.open` with `{app, path}`. */
export interface Chip {
  label: string;
  app: AppId;
  path: string;
}

export interface Attachment {
  ref: string;
  name: string;
  type: string;
  bytes: number;
}

export interface Message {
  seq: number;
  id: Id;
  thread_id: Id;
  author: MessageAuthor;
  origin: MessageOrigin;
  kind: MessageKind;
  body: string;
  meta: JsonObject | null;
  attachments: Attachment[];
  reply_to: Id | null;
  created_at: Ms;
  delivered_at: Ms | null;
  acked_at: Ms | null;
  answered_at: Ms | null;
}

/** PUT /v1/messages/:id. `thread_id: 'system'` only for night/reflex error posts (mind Finding 1). */
export interface PutMessageRequest {
  body: string;
  kind?: MessageKind;
  meta?: JsonObject;
  reply_to?: Id;
  thread_id?: 'system';
}

export interface PatchMessageRequest {
  body?: string;
  meta?: JsonObject;
}

export interface PatchThreadRequest {
  title?: string;
  summary?: string;
}

export interface TodayResponse {
  thread: Thread | null;
  messages: Message[];
  seq: number;
  day: Day;
}

export type ThreadsPage = Page<Thread>;
export type MessagesPage = Page<Message>;

/** One hit from any search source. `score` is comparable across sources (rank fusion). */
export interface SearchHit {
  source: SearchSource;
  ref: string;
  snippet: string;
  at: Ms;
  score: number;
  thread_id?: Id;
}

export interface SearchResponse {
  items: SearchHit[];
}

// --- the change feed and the live channel ------------------------------------------------------

export interface Change {
  seq: number;
  kind: ChangeKind;
  ref: string | null;
  at: Ms;
}

export interface ChangesResponse {
  items: Change[];
  next_after: number;
  more: boolean;
}

export interface LiveTicket {
  ticket: string;
  expires_at: Ms;
}

/** server → client frames. `v` is the protocol version (feed.ts LIVE_PROTOCOL). */
export type LiveFrame =
  | { t: 'hello'; v: number; seq: number; min_client: number }
  | { t: 'changed'; seq: number; kinds: ChangeKind[] }
  | { t: 'typing'; who: 'mind'; until: Ms }
  | { t: 'bye'; code: 'session_revoked' };

export type LiveSignal = 'day_closed' | 'stop';

export interface LiveEvent {
  type: 'proposal.decided' | 'work.done' | 'verb.result' | 'deploy.result';
  ref: string;
  at: Ms;
}

export interface LiveWaitResponse {
  seq: number;
  changed: boolean;
  kinds: ChangeKind[];
  messages: Message[];
  events: LiveEvent[];
  signals: LiveSignal[];
}

// --- the mind ----------------------------------------------------------------------------------

export type MindRole = 'chat' | 'night' | 'reflex';
export type MindState = 'working' | 'listening' | 'stopping' | 'limited';

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
  night_done: boolean;
  /** The session is tainted: its own mark, or one its claim took over from a session of its role
   * tainted in the last 24 hours (MEMORY.md §7). Its memory writes are refused. */
  tainted: boolean;
}

export interface MindStatusRequest {
  state: MindState;
  thread_id?: Id;
  note?: string;
  error?: string;
}

export interface MindNoteRequest {
  id: Id;
  thread_id?: Id;
  body: string;
  open_items: { text: string; ref?: string }[];
}

export interface TaintRequest {
  source: string;
  ref_kind?: 'url' | 'file' | 'comment';
}

/** POST /v1/mind/night (RUNTIME.md §12): the run's progress for a closed `day`. `cursor` saves
 * where a step with a cursor got to (shared/contract/night.ts); `partial` (with `done`) records
 * the steps the hard stop cut as skipped. */
export interface MindNightRequest {
  day: Day;
  action: 'start' | 'step_done' | 'cursor' | 'done';
  step?: number;
  cursor?: string;
  partial?: boolean;
}

export interface MindNightResponse {
  /** The first step not finished yet (the last step + 1 once the run is done). Steps of a later
   * phase, and the Sunday step on another day, are skipped on the way. */
  resume_from: number;
  done: boolean;
  /** The cursor saved for `resume_from`, if that step keeps one. */
  cursor: string | null;
  /** Steps recorded as skipped so far (not built yet, not Sunday, or cut by the hard stop). */
  skipped: number[];
}

/** One session note, as `GET /v1/mind/day/:day?part=notes` lists them. */
export interface SessionNote {
  id: Id;
  session_id: string | null;
  role: MindRole;
  thread_id: Id | null;
  created_at: Ms;
  body: string;
  open_items: { text: string; ref?: string }[];
}

/** `GET /v1/mind/day/:day?part=stats`: deterministic counts for the night's input. */
export interface DayStats {
  day: Day;
  /** When the day was open: from the roll that opened it to the one that closed it. */
  from: Ms;
  to: Ms;
  messages: number;
  owner: number;
  mind: number;
  system: number;
  muse: number;
  ledger: number;
  notes: number;
}

export interface PendingResponse {
  unanswered: Id[];
  stop: boolean;
  day_closed: boolean;
  limited: boolean;
  idle_min: number;
  idle_cutoff_min: number;
}

/** What the phone shows about the mind (setting `mind.status` + the open wake). `unconfigured`
 * = the mind-chat task is not connected yet (ROUTINE_CHAT_URL is `none`). */
export interface MindPresence {
  state: MindState | 'asleep' | 'waking' | 'failed' | 'unconfigured';
  note: string | null;
  since: Ms | null;
}

export interface WakeItem {
  id: Id;
  at: Ms;
  role: MindRole;
  reason: string;
  status: 'fired' | 'claimed' | 'ended' | 'unclaimed' | 'failed';
  fired_at: Ms | null;
  claimed_at: Ms | null;
  /** The routine's HTTP status for the fire (0: no answer), and a short reason when it failed
   * (`http_401`, `timeout`, `network`): what SETUP.md K's check reads. */
  fire_status: number | null;
  fire_error: string | null;
}
