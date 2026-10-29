# API

This page is the complete `/v1` contract of the Worker `thunderhead-api`: who may call what, the exact request and response shapes, the errors, and the limits.
The types here are mirrored in `shared/contract/*.ts`, which the backend (zod `satisfies`), the frontend (JSDoc) and the `th` CLI all type-check against. When this page and `shared/contract/` disagree, fix one of them in the same change.
Storage behind each route is in [DATA.md](DATA.md). Behaviour seen by the owner is in the product docs. Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **Base URL:** `https://thunderhead-api.<account-subdomain>.workers.dev`. Every path starts with `/v1/`. JSON in, JSON out, UTF-8.
2. **Public routes:** `GET /v1/health`, `GET /v1/auth/state` and `POST /v1/auth/{setup,login,recover}`. Everything else needs `Authorization: Bearer <token>`. A route not listed in §13 returns `404 not_found`, and the default for any route is deny.
3. **Principals:** a device session (the owner), or an agent key with one role: `mind:chat`, `mind:night`, `mind:reflex`, `muse` or `ci`. Each route lists who may call it. Mind requests also name their session in `TH-Session`.
4. **Every request sends `TH-Client`.** Writes from a client below `min_client` get `426 client_outdated`.
5. **Errors:** HTTP status plus `{"error":{"code","message","details?","request_id"}}`, with stable snake_case codes (§6). The request body is never echoed.
6. **Idempotency by natural ID:** creates are `PUT …/:id` with a client UUIDv7. The same ID with the same body returns the stored result. The same ID with a different body returns `409 conflict`.
7. **Pagination:** `?limit=` (default 50, max 200) and an opaque `cursor`; responses are `{items, next}`.
8. **Limits:** 64 KB JSON bodies by default; 4 KB on auth; 256 KB for event batches; file uploads by stream up to 50 MB.
9. **No cookies, no credentials in CORS.** Only exact site origins are allowed.
10. **Ask-first actions are proposals** that only the owner decides: a tap on a signed-in device, or the owner's own words in the conversation, recorded by `mind:chat` and verified by the Worker (§11.10; decisions 2026-10-28).
11. **Ported apps (P1b) don't call this API yet.** They keep calling the old Worker until their data moves; their routes join this contract then (§11.21).

---

## 1. Request basics

| Header (request) | Required | Value |
|---|---|---|
| `Authorization` | all non-public routes | `Bearer th1_…` (device), `Bearer thm_…` (mind roles), `Bearer ths_…` (Muse), `Bearer thc_…` (CI). Formats: [SECURITY.md §5.1](SECURITY.md) |
| `TH-Client` | all | `<build>.<sha7>` (site), `th/<version>` (mind CLI), `ci/<build>` (Actions), `muse/<n>` |
| `TH-Session` | mind roles, after the claim | the Claude session id sent at `POST /v1/mind/brief`; the Worker keys taint and the constitution pin on it |
| `TH-Role` | mind roles (sent by `th`, [RUNTIME.md §5.1](../mind/RUNTIME.md)) | `chat` \| `night` \| `reflex`. Informational: the Worker trusts only the key's role and answers a mismatch with `403 forbidden` |
| `Content-Type` | bodies | `application/json` (files: the file's type) |

| Header (response) | Always | Value |
|---|---|---|
| `Cache-Control` | yes | `no-store` |
| `X-Content-Type-Options` | yes | `nosniff` |
| `Referrer-Policy` | yes | `no-referrer` |
| `X-Robots-Tag` | yes | `noindex, nofollow` |
| `TH-Request-Id` | yes | the `cf-ray` value; the same as `error.request_id` |
| `TH-Server` | yes | the Worker version id (`VERSION.id`) |
| `TH-Min-Client` | yes **[proposal]** | integer build |
| `Retry-After` | on 429 and 503 | seconds |
| `TH-Stop` | on `PUT /v1/messages/:id` and `POST /v1/mind/status` replies to `mind:chat` while the owner's Stop stands | `1`. `th` prints `th: STOP` ([RUNTIME.md §5.1](../mind/RUNTIME.md)); the chat mind's next text reply clears the Stop |

Times in bodies are integer ms UTC (`*_at`). Days are `YYYY-MM-DD` logical days ([DATA.md §2.2](DATA.md#22-time)).

## 2. Shared types

```ts
type Id = string;            // UUIDv7, lowercase
type Ms = number;            // ms since epoch, UTC
type Day = string;           // 'YYYY-MM-DD', logical day
type Ref = string;           // DATA.md §2.3 grammar
type Page<T> = { items: T[]; next: string | null };
type Actor = 'owner' | 'mind:chat' | 'mind:night' | 'mind:reflex' | 'muse' | 'ci' | 'worker';

type Thread = { id: Id; day: Day; kind: 'daily'|'muse'|'imported'; status: 'open'|'filed';
  title: string|null; title_source: 'auto'|'mind'|'owner'|null; summary: string|null;
  continues: Id|null; message_count: number; started_at: Ms; updated_at: Ms; filed_at: Ms|null };

type Attachment = { ref: Ref; name: string; type: string; bytes: number };
type Message = { seq: number; id: Id; thread_id: Id; author: 'owner'|'mind'|'muse'|'system';
  origin: 'owner_device'|'mind'|'system'|'muse'|'import';
  kind: 'text'|'voice'|'progress'|'card'|'question'|'error'; body: string; meta: Record<string, unknown>|null;
  attachments: Attachment[]; reply_to: Id|null; created_at: Ms; delivered_at: Ms|null; acked_at: Ms|null; answered_at: Ms|null };

type LedgerEntry = { seq: number; id: Id; at: Ms; actor: Actor;
  kind: 'memory'|'arrangement'|'verb'|'deploy'|'proposal'|'mistake'|'undo'|'note';
  what: string; why: string /* ≥ 8 chars */; ref: Ref|null; topic_key: string|null; undoable: boolean;
  status: 'done'|'undone'|'failed'; tainted: boolean; proposal_id: Id|null; undone_at: Ms|null };

type ProposalClass = 'delete'|'money'|'access'|'reach_people'|'memory_big';
type Proposal = { id: Id; created_at: Ms; created_by: Actor; class: ProposalClass;
  question: string /* ≤ 80 */; why: string /* ≤ 140 */; if_ignored: string; odds: number|null;
  options: [action: string, safe: string]; spec: ProposalSpec; spec_hash: string;
  status: 'waiting'|'approved'|'rejected'|'expired'|'cancelled'|'executed'|'failed';
  expires_at: Ms; decided_at: Ms|null; decided_via: 'tap'|'words'|null; decided_message_id: Id|null; result: unknown|null };
type ProposalSpec = { v: 1; op: string; args: Record<string, unknown> };   // op from a fixed executor map

type Verb = { id: Id; verb: string /* '<app>.<action>' */; schema: number; ref: Ref|null; args: Record<string, unknown>;
  device_id: string|null; status: 'pending'|'claimed'|'done'|'failed'|'expired'; proposal_id: Id|null;
  created_at: Ms; expires_at: Ms; result: unknown|null };

type Surface = { app: string; slot: string; kind: string; schema: number; payload: Record<string, unknown>;
  why: string /* ≥ 8 chars */; topic_key: string; ref: Ref|null; expires_at: Ms|null; written_at: Ms };

type Fact = { id: Id; kind: 'preference'|'routine'|'fact'|'goal'|'state'|'rule'; subject: string; text: string;
  source: 'user'|'observed'|'inferred'; confidence: number /* decayed, at read time */; evidence: Ref[];
  valid_from: Ms; valid_to: Ms|null; recorded_at: Ms; superseded_at: Ms|null; superseded_by: Id|null;
  last_confirmed: Ms; sensitivity: 0|1; pinned: boolean; may_raise: boolean };

type SenseEvent = { id: Id; at: Ms; type: string /* 'music.skip' */; ref?: Ref; data?: Record<string, unknown>; sensitivity?: 0|1 };
type Change = { seq: number; kind: string; ref: Ref|null; at: Ms };
```

---

## 3. Principals and scopes

| Principal | Token | How it is made | Can |
|---|---|---|---|
| `device` | `th1_…` | Sign-in on a device ([SIGN-IN.md](../product/SIGN-IN.md)) | Everything the owner can do. The only principal that can decide proposals by tap (the owner's own words go through `mind:chat` with `by_message`, below), manage devices and agents, forget facts, undo any action and change settings |
| `mind:chat` | `thm_…` | Settings → Agents, role "Mind (chat)" | Read all; post messages; memory ops (taint rules apply); ledger notes; verbs; surfaces; proposals; brief; wait |
| `mind:night` | `thm_…` | role "Mind (night)" | Read all; memory ops; day notes; titles; surfaces; jobs; backups; proposals. **No** chat messages (except `system` home lines through surfaces) |
| `mind:reflex` (P4) | `thm_…` | role "Mind (reflex)" | Read errors, health and ledger; one notice message per wake; resolve errors; ledger notes. **No** memory writes |
| `muse` (P4) | `ths_…` | role "Muse" | `/v1/work/*` and messages in its own `muse` thread |
| `ci` | `thc_…` | role "CI"; stored as `TH_CI_TOKEN` in the GitHub environment `worker` | Deep health, meter, backup and drill triggers, job specs and collect. Nothing personal: deep health returns counts only |

- The Worker hashes the bearer (SHA-256) and looks it up in the isolate cache (60 s TTL), then in `Auth`. Revocation takes effect within 60 s everywhere.
- **Tainted sessions:** once a session calls `POST /v1/mind/taint`, the Worker records it in `mind_sessions` for good. Requests carrying that `TH-Session` may not `remember`, `supersede`, `confirm`, write `rule` facts or day notes, or take `reach_people` actions (`403 session_tainted`; memory from P3, the rest from P4). Rules: [MEMORY.md §6–7](../mind/MEMORY.md). **Memory writes need a claimed session** (P3): a mind's memory write (ops, loose ends, day notes) must carry the `TH-Session` of a session that claimed its briefing in the key's role and has not ended, else `403 session_required`, so a fresh or made-up session id can't step around a taint. Nor can a new claim: **a taint holds for 24 hours for its role**, counted from the taint, and a claim takes it over from the role's latest session tainted in that time unless it matches, exactly, a wake the Worker fired after the taint (MEMORY.md §7, RUNTIME.md §4.3).
- The full scope matrix is [SECURITY.md §5.3](SECURITY.md); §13 below is the route-level form of it.
- **Approval is never inferred.** A proposal is decided only by `POST /v1/proposals/:id/decide`: from a `device` principal (a tap), or from `mind:chat` citing the owner's own words (`by_message`), which the Worker checks itself: the cited message is owner-authored from a signed-in device (`origin=owner_device`), sent after the card appeared, and is the owner's latest message in that thread (decisions 2026-10-28; [BEHAVIOR.md §4](../mind/BEHAVIOR.md)). The session's taint state does not matter, because the Worker checks the message, not the session. A fired prompt, Muse output or any other text never decides.

Acceptance: `backend/tests/integration/route-scopes.test.ts` walks §13. For every route and every principal not listed, it asserts 401 (no token) or 403 (wrong principal).

## 4. CORS

| Item | Value |
|---|---|
| Allowed origins | Exact strings from the var `SITE_ORIGINS`: the new storage website origin only. The old site's origin is never allowed (the phone export travels as a file, [MIGRATION.md §5](MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)) |
| Methods | `GET, POST, PUT, PATCH, DELETE` |
| Allowed headers | `Authorization, Content-Type, TH-Client, TH-File-Name, TH-Sha256` (browsers never send `TH-Session`) |
| Exposed headers | `TH-Request-Id, TH-Server, TH-Min-Client, Retry-After` |
| `Access-Control-Max-Age` | `7200` (Chrome's cap) |
| Credentials | never (`Access-Control-Allow-Credentials` is not sent) |
| `Vary` | `Origin` |

- A preflight from an origin that is not allowed gets `403` with no CORS headers.
- A request with an `Origin` header that is not allowed gets `403 origin_not_allowed` before any DO call **[proposal]**. Requests with no `Origin` (the CLI, Actions) are allowed and rely on the token.

Acceptance: a live read-only check sends `OPTIONS /v1/changes` with the site origin and expects 204 with the values above; with `Origin: https://example.com` it expects 403.

## 5. Versions and client skew

- `/v1` changes are additive. A breaking change adds `/v2/<area>` for that one area.
- `min_client` is a `Core` setting (an integer build). It is raised only when an older client would corrupt data.
- Writes whose `TH-Client` is a site build below `min_client` (every `PUT`, `POST`, `PATCH` and `DELETE`) return `426 client_outdated` with `details: {min_client}`. `GET` keeps working.
- The full rule is in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-version-skew-between-the-phone-and-the-api).
- **Worker and object skew during a deploy.** For a moment the new Worker can reach an object that still runs the previous release. A route that calls an object method added in this release wraps the call in `fresh` (`backend/src/objects/rpc.ts`): a missing method answers `503 unavailable`, which clients retry, never a 500. Object methods keep accepting what the previous Worker sends (new fields optional, arrays read defensively).

## 6. Errors

```json
{ "error": { "code": "validation", "message": "body.text is too long", "details": [{"path":"text","issue":"max 500"}], "request_id": "8d1c…-EZE" } }
```

| Status | Code | When | Client does |
|---|---|---|---|
| 400 | `bad_request` | Unparseable JSON, a wrong method shape, a foreign cursor | Fix the request; never retry as is |
| 401 | `unauthorized` | No token, unknown token, bad token checksum | Show sign-in (device) / stop and report (agent, `th` exit 2) |
| 401 | `session_revoked` | The session was signed out; `details.reason` ∈ `signed_out_here`, `signed_out_elsewhere`, `password_changed`, `recovery_used`, `reset_used`, `device_limit` | Wipe the token, key and private caches; show sign-in with the reason line |
| 401 | `session_expired` | 90 days idle | Same as revoked |
| 401 | `wrong_username_or_password` | Sign-in failed | The one line from [SIGN-IN.md §5.3](../product/SIGN-IN.md) |
| 401 | `wrong_username_or_code` | Recovery or reset code wrong | Same treatment |
| 401 | `setup_code_wrong` | Setup code doesn't match the installed fingerprint | — |
| 401 | `current_password_wrong` | Password change or recovery-code regeneration | — |
| 403 | `forbidden` | The principal lacks the scope | Never retry (`th` exit 6) |
| 403 | `origin_not_allowed` | `Origin` is not allowed | — |
| 403 | `not_owner_words` | A `by_message` decision cites a message that isn't the owner's latest owner-device message after the card | The mind asks the owner again; the card stays |
| 403 | `session_tainted` | A tainted mind session tried a gated write | The mind reports it; no retry |
| 403 | `session_required` | A mind memory write without a claimed, live session of the key's role (P3) | Claim with `th brief --claim` first; no retry as is |
| 403 | `laws_unpinned` | `rule` write from a session whose constitution pin failed | — |
| 403 | `proposal_required` | An ask-first verb or op without an approved proposal | Create a proposal |
| 403 | `needs_approval` | A work order with `personal` and no approved `reach_people` proposal ([MUSE.md §6](../mind/MUSE.md)) | Create the proposal first |
| 404 | `not_found` | No such route or record | — |
| 409 | `conflict` | Same ID, different body | Never retry with the same ID |
| 409 | `already_decided`, `already_undone`, `already_claimed` | State has moved on | Refresh |
| 409 | `already_live` | Another chat session holds the lease | The new session ends (`th` exit 11) |
| 409 | `decision_budget` | A 4th waiting proposal | Keep it in the mind's own queue |
| 409 | `nudge_repeat` | A surface or push whose `topic_key` was ignored in the last 14 days | Drop it |
| 409 | `push_budget`, `push_gap`, `quiet_hours`, `quiet` | Push rules in [BEHAVIOR.md §3.4](../mind/BEHAVIOR.md) (P8) | Drop or wait |
| 409 | `spec_mismatch` | The decide body's `spec_hash` differs from the stored one | Show the card again |
| 409 | `setup_required` | Any auth call while UNCLAIMED | Go to `/setup/` |
| 409 | `setup_fp_missing` | Setup before the fingerprint is installed | Keep waiting ([SIGN-IN.md §4](../product/SIGN-IN.md)) |
| 409 | `reset_already_pending` | A second reset ticket | — |
| 409 | `agent_name_taken`, `agent_limit` | A new agent key with a name in use, or a 21st active key ([SIGN-IN.md §17](../product/SIGN-IN.md)) | Show the line |
| 410 | `setup_done` | Setup after a credential exists | — |
| 410 | `expired` | A proposal, ticket or verb past its time | Refresh |
| 410 | `reset_cancelled`, `reset_expired`, `reset_used` | A reset code whose ticket is void | [SIGN-IN.md §10.3](../product/SIGN-IN.md) |
| 410 | `resync_required` | `/v1/changes?after=` is older than the feed keeps | Reload full state (§11.6) |
| 413 | `too_large` | The body exceeds its limit | Split |
| 415 | `unsupported_media_type` | Wrong `Content-Type` | — |
| 422 | `validation` | Schema or rule failure; `details` lists zod issues or rule reasons (memory: `bad_evidence`, `not_owner_evidence`, `rule_needs_owner`, `too_little_evidence`, `tainted_evidence`, `needs_owner_words`, `too_long`, `no_inferred_sensitive`) | Fix; never retry as is (`th` exit 8) |
| 422 | `password_too_short`, `password_too_long`, `password_guessable`, `password_breached`, `password_same` | Password rules ([SIGN-IN.md §9.2](../product/SIGN-IN.md)) | Show the line |
| 422 | `invalid_result` | A Muse result fails its order's schema or hygiene checks; the order becomes `rejected` ([MUSE.md §5](../mind/MUSE.md)) | Muse fixes and the mind re-orders |
| 422 | `too_sensitive` | A Home surface or push whose `ref` points at sensitivity-1 data ([PRIVACY.md §4](PRIVACY.md#4-what-the-mind-may-raise-unprompted)) | Drop it |
| 422 | `username_invalid` | Setup username outside 3–32 letters, digits, `.`, `-`, `_` | Show the line |
| 425 | `reset_not_ready` | A reset ticket used before `usable_after` | Show the countdown |
| 426 | `client_outdated` | A write from below `min_client` | Apply the update |
| 429 | `rate_limited` | Throttled; `error.retry_after` (s) and `error.scope` (`source`\|`account`), plus `Retry-After` | Wait that long (`th` exit 10) |
| 500 | `internal` | A bug | Retry once after 2 s for idempotent requests |
| 502 | `upstream` | R2, a push service or a fire URL failed | Retry with back-off |
| 503 | `budget_exhausted` | A daily Free-plan cap was reached; `Retry-After` = seconds to 00:00 UTC | Queue writes; keep reading (`th` exit 10) |
| 503 | `auth_unavailable` | `Auth` can't be reached | "Sign-in is having trouble" line |
| 503 | `unavailable` | A DO is overloaded or restarting, or (for a moment during a deploy) still runs the previous release and lacks a method this one calls (`objects/rpc.ts` `fresh`) | Retry after 1 s, 2 s, 4 s (max 3 tries) |

- `message` is plain English for logs and agents. The owner never sees raw codes; [COPY.md](../design/COPY.md) maps codes to words.
- The Workers platform's own errors (1027 when the daily request limit is hit, 1102 on CPU overrun) arrive as non-JSON. `api.js` maps a non-JSON 5xx or 429 to `unavailable`.

## 7. Idempotency

| Write | Key | Same key, same body | Same key, other body |
|---|---|---|---|
| Creates (`PUT /…/:id`) | the path id | 200 + the stored record | 409 `conflict` |
| Event batches | `batch_id` | 200 + the stored `{accepted, rejected}` | 409 |
| Memory ops, verb results, job collect, import runs | `batch_id` / the path id, kept in `Core.op_batches` for 7 days | 200 + the stored result | 409 |
| Approve / reject / undo | the record's state | 200 if already in the target state from the same request id; else 409 `already_*` | — |

- "Same body" means the same SHA-256 of the canonical JSON (keys sorted, no whitespace).
- No generic `Idempotency-Key` header exists.

## 8. Pagination

- Query: `limit` (1–200, default 50) and `cursor` (opaque base64url from a previous `next`).
- Response: `{ "items": [...], "next": "eyJzIjo0MTJ9" }` or `"next": null` at the end.
- Lists are ordered newest first unless the route says otherwise. The cursor encodes the last sort key; it never expires, but a cursor from another route is `400 bad_request`.

## 9. Limits

| Limit | Value | Over it |
|---|---|---|
| JSON body (default) | 64 KB | 413 |
| `/v1/auth/*` body | 4 KB | 413 |
| Event batch | 500 events and 256 KB | 413 |
| `POST /v1/ops/errors` | 50 items, 32 KB | 413 |
| `POST /v1/import/phone` | 5 MB per chunk | 413 |
| `POST /v1/ops/import/parts` | 5 MB per part | 413 |
| File upload (`PUT /v1/files/:id`) | 50 MB, streamed **[proposal]** | 413 |
| Message body | 16,000 characters | 422 |
| `media/sign` refs | 50 per call | 422 |
| Memory ops | 50 per batch | 422 |
| Per-principal rate | 600 requests/min per token, counted per isolate (approximate) **[proposal]** | 429 |
| Sign-in throttle | [SIGN-IN.md](../product/SIGN-IN.md) back-off table | 429 |
| `GET /v1/live/wait` | `timeout` ≤ 25 s | clamped |

---

## 10. Auth middleware order

`requestId → cors → clientVersion → bodyLimit → auth → scope → (taint) → route → onError`. `onError` turns every thrown error into §6's envelope and logs one line ([ARCHITECTURE.md §9](ARCHITECTURE.md#9-key-conventions)).

---

## 11. Endpoints

Format of each entry: **Who** (principals) · **Phase** · request · response · errors beyond §6's general ones · notes. "Agents" means `mind:chat`, `mind:night` and `mind:reflex`.

### 11.1 Health

**`GET /v1/health`** · Who: public · P1
- Response `200`: `{ ok: true, version: { id: string, tag: string|null }, min_client: number, at: Ms }`. `tag` is the deployed commit's short sha (`wrangler deploy --tag`).
- No DO call. A `503` from here means the Worker itself is down.
- `min_client` is this isolate's cached copy of the Core setting (≤ 60 s old; 0 until first read). The same value is sent as `TH-Min-Client`.

**`GET /v1/ops/health/deep`** · Who: device, agents, `ci` · P1
- Response `200`:
  ```ts
  { ok: boolean; version: {id; tag}; schema: Record<'core'|'auth'|string, number>;
    objects: Record<string, { ok: boolean; schema: number; expected: number; db_bytes: number; jobs_backlog: number; last_alarm_at: Ms|null }>;
    meter_today: { rows_written: number; rows_read: number; bulk_rows_written: number; bulk_lane: string|null };
    last_backup: { date: Day; age_h: number }|null; last_events_export: Day|null;
    errors_open: number; wakes_today: number; min_client: number }
  ```
- Per object, `schema` is the applied migration step and `expected` the newest step this code knows. An object is `ok` when `schema >= expected`: migrations are expand-only, so older code (after a rollback) runs safely on a newer schema. The deploy's smoke check waits for more: every object's `schema` and `expected` equal the newest step in the repo (`scripts/schema-version.mjs`), so an object still running the old code can't pass it.
- `ok` is false if any object fails, or the backup is older than 8 days (from P4). Counts only, never content.
- Fields whose feature hasn't shipped are present with `null` or `0` (P1: `last_backup` and `last_events_export` are `null`; `jobs_backlog`, `wakes_today` and `meter_today.bulk_rows_written` are `0`; `bulk_lane` is `null`; `meter_today` holds the objects' in-memory counts until the `meter` table exists). The backup age counts toward `ok` only once the first weekly backup exists (P4).

### 11.2 Auth

Behaviour, copy and throttle numbers are owned by [SIGN-IN.md](../product/SIGN-IN.md) and [SECURITY.md](SECURITY.md). This is the wire shape.

```ts
type DeviceHints = { platform?: string; browser?: string; model?: string; standalone?: boolean };
type SignedIn = { token: string; session_id: string; idle_days: 90 };
type Notice = { id: Id; kind: 'new_device'|'password_changed'|'recovery_used'|'reset_used'|'reset_pending'|'reset_cancelled'|'agent_key_created';
  created_at: Ms; expires_at: Ms|null; about_session_id: string|null;   // the session "Not me" revokes
  args: { label?: string; region?: string; country?: string; at?: Ms; name?: string; role?: string; ticket_id?: Id; usable_after?: Ms } };
// GET /v1/auth/me lists the unacknowledged, unexpired notices for this session, newest first. Before the
// live feed exists (P2) the shell calls it at start and on every visibilitychange to 'visible'; from P2 a
// `notice` change triggers the same call. Copy per kind: SIGN-IN.md §11.4.
```

| Route | Who | Request | Response | Specific errors |
|---|---|---|---|---|
| `GET /v1/auth/state?fp=&reset_fp=` | public | — | `200 { setup: 'open'\|'done', setup_fp?: 'ready'\|'missing'\|'mismatch', reset?: 'none'\|'pending'\|'ready'\|'cancelled'\|'expired'\|'used', usable_after?: Ms }` (reset fields only when `reset_fp` is given; `'none'` when no ticket has it) | — |
| `POST /v1/auth/setup` | public, only while UNCLAIMED | `{ setup_code, username, password, device: DeviceHints }` | `201 SignedIn & { recovery_code }` | 410 `setup_done`, 409 `setup_fp_missing`, 401 `setup_code_wrong`, 422 `password_*`, 429 |
| `POST /v1/auth/login` | public | `{ username, password, device: DeviceHints }` | `200 SignedIn` | 401 `wrong_username_or_password`, 409 `setup_required`, 429, 503 `auth_unavailable` |
| `POST /v1/auth/recover` | public | `{ username, code, new_password, device }` (`code` = the recovery code, or the reset code once its ticket is ready) | `200 SignedIn & { recovery_code }`; every other session is revoked | 401 `wrong_username_or_code`, 425 `reset_not_ready`, 422 `password_*`, 429 |
| `POST /v1/auth/signout` | device | `{ scope: 'this'\|'others'\|'all' }` | `204`; the sessions are revoked and their push subscriptions deleted | — |
| `GET /v1/auth/me` | device | — | `200 { session_id, label, notices: Notice[], recovery_confirmed: boolean }` | — |
| `GET /v1/auth/me` | agent keys | — | `200 { agent_id, role, name }` | — |
| `POST /v1/auth/password` | device | `{ current_password, new_password, sign_out_others: boolean }` | `200 {}` | 401 `current_password_wrong`, 422 `password_*` |
| `POST /v1/auth/recovery-code` | device | `{ current_password }` | `200 { recovery_code }` (the old one stops working at once) | 401 `current_password_wrong` |
| `POST /v1/auth/recovery-code/confirm` | device | `{ last5 }` | `204` | 422 |
| `POST /v1/auth/breakglass` | `mind:chat` only | `{ fingerprint }` (`thfp_…`, given by the owner in their own Claude Code session) | `201 { ticket_id, usable_after /* +24 h */, expires_at /* +96 h */ }`; red notice + push to every device | 409 `reset_already_pending`, 409 `setup_required`, 429 |
| `POST /v1/auth/breakglass/cancel` | device | `{ ticket_id }` | `204`; the ticket and its fingerprint are void for good | 404, 410 |
| `POST /v1/auth/notices/:id/ack` | device | `{ answer: 'me'\|'not_me'\|'ok' }` (`not_me` revokes the session the notice is about) | `204` | 404 |

- The flows, state machines, back-off numbers and copy are owned by [SIGN-IN.md](../product/SIGN-IN.md). This table must match its §4–§10.
- Setup and reset prove control through a **fingerprint** (`thfp_…` = SHA-256 of a code made in the owner's browser) that the owner installs as the Worker secret `AUTH_SETUP_FP` / `AUTH_RESET_FP`, through a GitHub workflow or the Cloudflare dashboard. This replaces the review's unauthenticated `POST /v1/auth/setup-ticket` ([SIGN-IN.md §4](../product/SIGN-IN.md)).
- Auth handlers log only the outcome code. Bodies are never logged.

### 11.3 Sessions (devices)

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/auth/sessions` | device | — | `200 { items: { id, label, platform, browser, standalone, region, country, last_country, signed_in_at, last_seen_at, this_device }[] }` |
| `PATCH /v1/auth/sessions/:id` | device | `{ label: string /* 1–40 chars */ }` | `200` the row |
| `DELETE /v1/auth/sessions/:id` | device | — | `204` (also when already gone); revoked within 60 s everywhere |

None of these needs the password again. "Sign out everywhere else / everywhere" is `POST /v1/auth/signout` (§11.2).

### 11.4 Agent keys

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/auth/agents` | device | — | `200 { items: { id, name, role, created_at, created_on, last_used_at, last_country }[] }` |
| `POST /v1/auth/agents` | device | `{ name /* ≤ 32, unique */, role: 'mind:chat'\|'mind:night'\|'mind:reflex'\|'muse'\|'ci', current_password }` | `201 { id, token }`. **The key is shown once** and never retrievable again |
| `DELETE /v1/auth/agents/:id` | device | — | `204`; refused within 60 s everywhere |

Acceptance: an integration test issues a key, calls `/v1/auth/me` with it, revokes it, moves the fake clock past the 60 s cache, and gets 401.

### 11.5 Live

**`POST /v1/live/ticket`** · Who: device · P2
- Response `200 { ticket: string, expires_at: Ms }`. The ticket is `thw_` + 22 base62 characters ([SECURITY.md §5.1](SECURITY.md)), valid 30 s and single-use. `Core.live_tickets` stores only its SHA-256 (2 rows written per connect).

**`GET /v1/live?ticket=…`** (WebSocket upgrade) · Who: a holder of a valid ticket · P2
- Before the upgrade: `401 unauthorized` for a bad or used ticket, or one whose session has since been signed out; `400 bad_request` without `Upgrade: websocket`. The session is checked again right after the upgrade, so a sign-out that lands in between still closes the socket.
- Every way a session ends closes its sockets with 4401: sign-out (this, others, all), a device removed in Settings, a password change that signs others out, recovery or a reset (all sessions), and the device limit evicting the idlest session at a new sign-in.
- After it: the frames in §12.

**`GET /v1/live/wait?after=<seq>&timeout=<1–25>`** · Who: agents · P2
- The Worker holds the request for up to `timeout` seconds (default 25) on a WebSocket to `Core`, and returns at the first change after `seq`.
- Response `200`:
  ```ts
  { seq: number; changed: boolean; kinds: string[];
    messages: Message[];                  // owner messages not yet handed out (or handed out > 120 s ago and never acknowledged), ≤ 20; sets delivered_at; chat lease holder only
    events: { type: 'proposal.decided'|'work.done'|'verb.result'|'deploy.result'; ref: Ref; at: Ms }[];
    signals: ('day_closed' | 'stop')[] }
  ```
  `stop` = the owner tapped stop. `day_closed` = the roll happened. The CLI turns these into `th wait`'s output and exit codes ([RUNTIME.md §5](../mind/RUNTIME.md)).
- A handed-out message (including one shown in a claimed briefing) must be acknowledged within 120 s (`POST /v1/mind/status` with `working`, or any post by the chat mind), or it is requeued.
- A take returns `changed: true` for any committed change after `seq`, including the mind's own posts; `th wait` waits again when a take carries nothing for it.
- Each take renews the role's lease ([DATA.md §4.1](DATA.md#41-settings-ops-the-feed-and-the-minds-bookkeeping)).
- X1 passed in production (decisions.md 2026-10-29): the Worker-held wait is the design. The Worker var `LIVE_WAIT=poll` switches the hold to a 3 s check of Core's last seq, as a var change (`backend/src/areas/feed/wait.ts`).

### 11.6 Changes

**`GET /v1/changes?after=<seq>&limit=<1–500>`** · Who: device, agents · P2
- Response `200 { items: Change[], next_after: number, more: boolean }`, oldest first.
- `410 resync_required` if `after` is older than the oldest kept row, or newer than the newest (the store was restored to an earlier point). The client then reloads: `GET /v1/threads/today`, `GET /v1/surfaces`, `GET /v1/proposals?status=waiting`, `GET /v1/verbs/pending`, and sets `after` to the returned `seq`.

### 11.7 Conversation

| Route | Who | Request | Response | Notes |
|---|---|---|---|---|
| `GET /v1/threads?status=open\|filed&limit&cursor` | device, agents | — | `200 Page<Thread>` newest `updated_at` first | |
| `GET /v1/threads/today` | device, agents | — | `200 { thread: Thread\|null, messages: Message[] /* last 50 */, seq: number }` | `thread` is null before the day's first message |
| `GET /v1/threads/:id` | device, agents | — | `200 Thread` | |
| `GET /v1/threads/:id/messages?before_seq\|after_seq&limit` | device, agents | — | `200 Page<Message>` | |
| `PATCH /v1/threads/:id` | `mind:chat`, `mind:night` | `{ title?: string /* ≤ 80 */, summary?: string /* ≤ 400 */ }` | `200 Thread` | Sets `title_source:'mind'`; refused (`409 conflict`) when `title_source='owner'` |
| `POST /v1/threads/:id/continue` | device | — | `200 { today_thread_id }` | Links a filed thread to today (`continues`) |
| `PUT /v1/messages/:id` | device, `mind:chat`, `muse` (own thread); `mind:night`/`mind:reflex` only `kind:'error'` to the system thread | `{ body: string, kind?: Message['kind'] /* default 'text' */, meta?: object /* ≤ 8 KB */, attachments?: Ref[] /* file:…, ≤ 10 */, reply_to?: Id }` | `201 Message` (200 on a same-body retry) | See below |
| `PATCH /v1/messages/:id` | `mind:chat` (own posts) | `{ body?: string, meta?: object }` | `200 Message` | Keeps progress cards current (`th amend`) |
| `GET /v1/search?q=&sources=messages,facts,day_notes,library&since&until&thread&limit` | device, `mind:chat`, `mind:night` | — | `200 { items: { source, ref, snippet /* ≤ 200 chars, match in «» */, at, thread_id?, score }[] }` | Federated: each source (`shared/contract/feed.ts` `SEARCH_SOURCES`) answers with FTS5 bm25 and the Worker fuses them by reciprocal rank (k = 60); default all built sources (P2: `messages`); an unknown source is 422; `kind=` is kept as an alias of `sources=`; `q` 1–200 chars |
| `POST /v1/mind/typing` | device | `{}` | `204` | May fire a pre-warm wake ([RUNTIME.md](../mind/RUNTIME.md)) |
| `POST /v1/mind/stop` | device | `{}` | `204` | The owner taps Stop: setting `mind.stop`, the `stop` signal to a waiting chat mind (once), `TH-Stop: 1` on its say/status replies and `stop: true` in `GET /v1/mind/pending` until its next text reply or a new claim. Stop ends the work, not the session ([BEHAVIOR.md](../mind/BEHAVIOR.md)) |
| `PUT /v1/files/:id` | device, `mind:chat` | raw bytes; headers `Content-Type`, `TH-File-Name` (URL-encoded, ≤ 120), `TH-Sha256` | `201 { ref: 'file:<id>', bytes, type }` | Streams to `thunderhead-private/chat/files/…`; 422 if the sha256 differs **[proposal]** |

`PUT /v1/messages/:id` rules:
1. The message goes into the open `daily` thread for `day.current`. The Worker creates that thread if needed. The client never names a thread, except `muse` in its own thread.
2. `author` and `origin` come from the principal (`device` → `owner`/`owner_device`, `mind:chat` → `mind`/`mind`, `muse` → `muse`/`muse`), never from the body.
3. A `mind` message with `reply_to` sets `answered_at` on that owner message and on every earlier unanswered owner message. `reply_to` names a message in the open thread, or an owner message still unanswered from an earlier day, so a reply after the roll still settles it (nothing the owner said is lost across the roll).
4. An owner message with no live chat lease and no unclaimed fire younger than 90 s queues a wake (conditions: [RUNTIME.md §3](../mind/RUNTIME.md)).
5. Owner messages use `text` or `voice`. Agents may use every kind; `system` messages (author `system`) are written only by the Worker.
6. Wording limits on mind messages (the phrase lint) are enforced as `422 validation` per [BEHAVIOR.md](../mind/BEHAVIOR.md).
7. A `mind:chat` text reply clears a standing Stop and, when no owner message is left unanswered, sets the presence (`mind.status`) to `listening`, so the edge stops pulsing while the session waits.
8. **Action chip (P2).** A `mind` message may carry one chip in `meta.chip = { label: string /* 1–28 chars */, app: 'music'|'guitar'|'podcasts'|'astra'|'media'|'study', path: string /* root-absolute, inside that app's folder */ }`. Until an app's agreed evolution adds deep links, `path` is the app's folder root (`/music/` …), and a tap navigates there. Any other `meta.chip` shape is `422 validation`.

### 11.8 Mind

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/mind/brief` | agents | `{ claim: boolean, session_id: string, role: 'chat'\|'night'\|'reflex', constitution_sha256: string, th_version: string }` (`role` must match the key's role) | `200 { wake: {id, reason, claim_match} \| null, day: Day /* the open day; for the night role the day before it, the one it works on */, seq: number, core: string /* ≤ 9,500 chars */, full: string /* ≤ 48,000 chars */, night_done: boolean /* night role: that day's run already finished (the claim then ends its wake, night_done) */, tainted: boolean /* this session's own taint, or one its claim took over from a session of its role tainted in the last 24 hours (MEMORY.md §7) */ }`; `409 already_live` if another chat session holds the lease |
| `POST /v1/mind/status` | agents | `{ state: 'working'\|'listening'\|'stopping'\|'limited', thread_id?, note? /* ≤ 140 */, error? }` | `204` (feeds the presence light; `working` acknowledges handed-out messages) |
| `POST /v1/mind/notes` | agents | `{ id: Id, thread_id?, body /* ≤ 120 words */, open_items: {text, ref?}[] /* ≤ 10 */ }` | `201` |
| `POST /v1/mind/taint` | agents | `{ source: string /* tool name */, ref_kind?: 'url'\|'file'\|'comment' }` | `200 { tainted: true }`; irreversible for the session. The URL itself is not sent |
| `GET /v1/mind/pending` | agents | — | `200 { unanswered: Id[], stop: boolean, day_closed: boolean, limited: boolean, idle_min: number, idle_cutoff_min: number }` (the Stop hook). `idle_min`: whole minutes since the session's last owner message, or since its claim. `idle_cutoff_min`: 10 for a pre-warm wake with no owner message yet, else 120 (30 in the lean profile, [RUNTIME.md §11](../mind/RUNTIME.md)). The hook counts its own blocks ([RUNTIME.md §6.2](../mind/RUNTIME.md)) |
| `POST /v1/mind/night` | `mind:night`, from a claimed night session | `{ day: Day /* closed, ≤ 7 days back */, action: 'start'\|'step_done'\|'cursor'\|'done', step?: number, cursor?: string /* ≤ 200, with cursor */, partial?: boolean /* only with done */ }` (steps: `shared/contract/night.ts`; `partial`: the hard stop cut the run and the remaining steps are recorded as skipped) | `200 { resume_from: number /* the first step not done; 11 once done */, done: boolean, cursor: string \| null /* saved for resume_from */, skipped: number[] }` (`night_runs`; a step reported again or a start that changes nothing writes nothing; `done: true` when that day's run already finished, and the session ends at once); `409 conflict` with `details.resume_from` for a step ahead of the run, or `done` with steps left and no `partial`; 422 for an unknown step, a cursor on a step that keeps none, an open or older day; `403 session_required` from a session that never claimed, a made-up one or another role's, also on a run already done (whose answer ends only the asking night session) |
| `GET /v1/mind/day/:day?part=stats\|messages\|ledger\|notes&cursor&limit` | `mind:night` | — | `200` `stats`: `DayStats` `{ day, from, to /* when the day was open: the rolls that opened and closed it */, messages, owner, mind, system, muse, ledger, notes }`; other parts: `Page<Message \| LedgerEntry \| SessionNote>`, oldest first, ≤ 200 a page (`limit` 1–200), the day's thread for messages and `[from, to)` for the ledger and notes; 422 for a day not closed yet; 400 for a cursor of another day or part |
| `GET /v1/mind/wakes?limit` | agents, device | — | `200 Page<{id, at, role, reason, status, fired_at, claimed_at, fire_status, fire_error}>` (`fire_status`: the routine's HTTP answer, 0 when none; `fire_error`: `http_<status>`, `timeout` or `network`) |

- `claim: true` binds the session to the open wake of its task and sets it `claimed` (`claim_match` `exact`, `loose` or `manual`), and creates its `mind_sessions` row. Every later request from the session carries `TH-Session: <session_id>`.
- The briefing's sections, order and truncation are owned by [RUNTIME.md](../mind/RUNTIME.md). The Worker truncates; the model never does.

### 11.9 Ledger and undo

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `GET /v1/ledger?before_seq&limit&actor&status&since&kind` | device, agents | — | `200 Page<LedgerEntry>` | `since` (ms) reads through the time index |
| `PUT /v1/ledger/:id` | agents | `{ kind: 'deploy'\|'mistake'\|'note', what /* ≤ 200 */, why /* 8–500 */, ref?, topic_key? }` | `201 LedgerEntry` | For actions outside the Worker (a merged PR, a deploy, an admitted mistake). `undoable` is false for these |
| `POST /v1/ledger/:id/undo` | device; `mind:chat` for its own actions | `{}` | `200 { undo_ledger_id, status: 'undone' \| 'queued' }` | 409 `already_undone`; 422 `validation` with reason `not_undoable`; 410 `expired` after 30 days **[proposal]** |

- A Core-internal action (memory, surface, setting) is undone in the same transaction as its new `undo` ledger row (`status: 'undone'`).
- A phone action is undone by queueing its stored inverse verb (`status: 'queued'`). The original row becomes `undone` when that verb reports success. Asking again while the inverse waits returns the same `{undo_ledger_id, status: 'queued'}`; only a failed or expired inverse lets a new one be queued.
- A surface action is undone only while it is the newest state of its slot: undoing a write needs the slot to still hold it, undoing a clear needs the slot to still be empty; otherwise `409 conflict` (reason "a newer surface is in this slot").
- Verb and surface replies carry `ledger_id`, the row to undo: for a surface, its last write; for a verb, its `queued` row until the phone reports, then the outcome row (actor: whoever queued it), which holds the inverse.

### 11.10 Proposals (decisions)

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/proposals/:id` | agents | `{ class: ProposalClass, question /* ≤ 80 */, why /* ≤ 140 */, if_ignored /* ≤ 140 */, odds?: number /* 0–1 */, options: [string, string] /* each ≤ 20 */, spec: ProposalSpec }` | `201 Proposal` (`status:'waiting'`, `expires_at` = +7 days, `spec_hash` = SHA-256 of the canonical spec) | 409 `decision_budget` (3 already waiting); 422 if `spec.op` is not in the executor map; 403 `session_tainted` for `delete`/`access`/`reach_people` from a tainted session |
| `GET /v1/proposals?status=waiting\|all&limit&cursor` | device, agents | — | `200 Page<Proposal>` | |
| `POST /v1/proposals/:id/decide` | device (tap); `mind:chat` with `by_message` only (the owner's own words) | `{ decision: 'approve'\|'reject', spec_hash, by_message?: Id }` (`by_message` is required from `mind:chat` and refused from a device) | `200 { status: 'executed'\|'approved'\|'rejected', result?: unknown }` (`approved` when execution is a queued verb); stores `decided_via` `tap` or `words` and `decided_message_id` | 409 `spec_mismatch`, 409 `already_decided`, 410 `expired`, 403 `not_owner_words` |
| `POST /v1/proposals/:id/cancel` | the creating agent, device | `{ why /* ≥ 8 */ }` | `200 { status: 'cancelled' }` | 409 `already_decided` |

- The card's parts and limits are owned by [BEHAVIOR.md §4](../mind/BEHAVIOR.md). The Worker validates them (check DEC-1).
- `spec.op` comes from a fixed map in `backend/src/areas/proposals/executors.ts`, e.g. `verb`, `memory.forget`, `memory.apply_batch`, `agents.revoke`, `files.delete`, `ops.restore`, `music.delete_from_catalog`. Free-form code or SQL is never executed.
- Deciding writes a ledger row with `proposal_id` (and the message ref when decided by words). A waiting proposal turns the bottom light gold ([HOME.md](../product/HOME.md)). An owner chat "yes" decides only when `mind:chat` records it with `by_message` and the Worker's message check passes; nothing else in a conversation decides (check DEC-2, [BEHAVIOR.md §4](../mind/BEHAVIOR.md)). `th decide` ([RUNTIME.md](../mind/RUNTIME.md)) is the CLI for this call.

### 11.11 Verbs

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/verbs/:id` | `mind:chat`, `mind:night` | `{ verb, schema, args, why /* 8–200 chars, required */, ref?, device_id?, expires_at? /* default +24 h */, proposal_id? }` | `201 Verb` (200 on a same-body retry) | 403 `proposal_required` for an ask-first verb without an approved proposal; 422 for an unknown verb or version, a verb that is not queueable (owner taps only, e.g. `app.open`), or args that fail its schema |
| `GET /v1/verbs/pending` | device | — | `200 { items: Verb[] }` (for this device or any) | |
| `POST /v1/verbs/:id/claim` | device | `{}` | `200 Verb` (`claimed`; the claim lasts 120 s) | 409 `already_claimed` |
| `POST /v1/verbs/:id/result` | device | `{ ok: boolean, result?: unknown, undo?: {verb, schema, args}, error?: {code, message?} }` | `200 Verb` | 410 `expired`; 422 if `result` or `undo` fails the verb's schemas |

- Verbs are data in `shared/contract/verbs.ts` (class, executor, queueable, undo, versioned schemas for args and result); [CONTRACT.md](CONTRACT.md) lists them and each app doc lists its own. Adding one: [EXTENDING.md](EXTENDING.md).
- A phone that lacks a verb, or its schema version, answers `{ ok: false, error: { code: 'unsupported_verb' } }`: the verb is `failed` and its ledger row says so. New verbs never break an older phone.
- A verb that reports `undo` gets an undoable ledger row; undoing it queues the inverse verb, and the original row becomes `undone` when that inverse succeeds.
- A claimed verb that reports nothing within 120 s goes back to `pending` (at most 3 claims, then `failed`).

### 11.12 Surfaces

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/surfaces?since_seq=` | device, agents | — | `200 { items: Surface[], seq }` (non-expired, changed after `since_seq`) |
| `PUT /v1/surfaces/:app/:slot` | `mind:chat`, `mind:night` | `{ kind, schema, payload /* ≤ 16 KB */, why /* 8–200 chars, required */, topic_key /* slug */, ref?, expires_at?, facts?: Id[] /* ≤ 20; every fact it draws on (a `fact:` ref counts too); 422 `validation` reason `muted_fact` if one has may_raise = 0, `unknown_fact` if one does not exist, 422 `too_sensitive` if one is sensitivity 1 */ }` | `200 Surface` (+ a ledger row); `409 nudge_repeat` if the topic was ignored in the last 14 days; margin notes over 140 characters → 422 |
| `DELETE /v1/surfaces/:app/:slot` | device, `mind:chat`, `mind:night` | — | `204` (+ a ledger row) |

`why` is required on every surface, so the owner can always see why something is there. `kind`, `schema`, the slot and the payload are validated against `shared/contract/surfaces.ts` (P2: kind `line` in `home/line.1`–`line.4`, ≤ 44 characters ending with a full stop, no exclamation marks or emoji). A phone without a renderer for a kind or version shows the generic card with the `why`. The `nudge_repeat` rule reads the `topics` row of `topic_key`.

### 11.13 Memory

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/memory/facts?kind&subject&include_superseded&limit&cursor` | device, `mind:chat`, `mind:night` | — | `200 Page<Fact>` (newest first; current versions unless `include_superseded=true`; each with `confidence_now`, the decayed value at read time, and `ledger_id`, the row that wrote it) |
| `GET /v1/memory/facts/:id` | device, `mind:chat`, `mind:night` | — | `200 { fact: Fact, history: Fact[] /* earlier versions, newest first */, evidence: {ref, kind, at, who, text}[] /* text: the start (≤ 280) of the message or day note cited */, why: string \| null /* the ledger row that wrote this version */ }`; 404 when it was never there or was forgotten |
| `POST /v1/memory/ops` | device, `mind:chat`, `mind:night` | `{ batch_id: Id, ops: MemoryOp[] /* ≤ 50 */ }` | `200 { applied: {i, fact_id, ledger_id}[], proposals: {i, proposal_id}[], rejected: {i, reason}[] }` |
| `GET /v1/memory/profile` | device, `mind:chat`, `mind:night` | — | `200 { text: string /* ≤ 1,500 tokens */, fact_ids: Id[] /* each line's fact, in line order */, private_ids: Id[] /* the private lines' facts, which a screen blurs until tapped */, rendered_at: Ms }` |
| `GET /v1/memory/day-notes?from&to` | device, `mind:chat`, `mind:night` | — | `200 { items: DayNote[] }` |
| `PUT /v1/memory/day-notes/:day` | `mind:night`, device (the owner's edit, `written_by: 'owner'`) | `{ summary /* ≤ 150 words */, decisions: string[] /* ≤ 10 */, importance: 1-10 }` (`stats` is computed by the Worker) | `200 DayNote` (`version` + 1; the same body again keeps the version, so a rerun night step never writes version 2; once the owner edited a day, the night's write returns the owner's version unchanged with `kept_owner_edit: true`; a future day is 422; 403 from a tainted or unclaimed session) |
| `GET /v1/memory/open-threads?status=open\|all` | device, `mind:chat`, `mind:night` | — | `200 { items: OpenThread[] }` |
| `PUT /v1/memory/open-threads/:id` | device, `mind:chat`, `mind:night` | `{ text, owner: 'mind'\|'owner', due_at?, evidence: Ref[] /* 1–20 existing refs; a device may send none */, tags?: string[], status?, why? /* ≤ 200; stored as closed_why; required when status is dropped */ }` | `200 OpenThread` (the same body again changes nothing) |
| `PATCH /v1/memory/open-threads/:id` | device, `mind:chat`, `mind:night` | `{ status: 'done'\|'dropped', why? /* required for dropped */ }` | `200 OpenThread` |

```ts
type MemoryOp =
  | { op: 'add'; id: Id; kind: Fact['kind']; subject?: string; text: string; source: Fact['source'];
      evidence: Ref[]; about?: 'owner'|'world'|'person'; tags?: string[] /* ≤ 8 */; valid_from?: Ms;
      sensitivity?: 0|1; may_raise?: boolean }
  | { op: 'confirm'; id: Id; evidence?: Ref[] }
  | { op: 'supersede'; id: Id; reason?: string /* ≤ 140 */;
      new: { id: Id; text: string; evidence: Ref[] } & Partial<Omit<Extract<MemoryOp, {op:'add'}>, 'op'|'id'|'text'|'evidence'>> }   // omitted fields are copied from the old fact
  | { op: 'pin'; id: Id; pinned: boolean }            // device only
  | { op: 'may_raise'; id: Id; value: boolean }       // device only
  | { op: 'forget'; id: Id };                         // device only: hard delete + tombstone
```

- Each op is validated on its own. The valid ops apply together in one transaction; invalid ops change nothing and are listed as `rejected: {i, reason}[]` in the `200` response. If every op is rejected, the response is `422 validation` with `details: [{path: 'ops.<i>', issue: <reason>}]` instead (`403 session_tainted` or `403 laws_unpinned` when that is the only reason), so a single-op call such as `th remember` fails loudly (`th` prints the details). From a device principal `evidence` may be empty: the Worker uses the op's own ledger row (`ledger:<id>`, `actor=owner`) as the evidence ([MEMORY.md §12](../mind/MEMORY.md)), and a device's `add` and `supersede` are always `source: 'user'`. A mind write needs `TH-Session`.
- Reasons are MEMORY.md §6's codes (`bad_evidence` for evidence that is missing, malformed or of a kind memory can't cite yet (events before P5, imports before the import), `not_owner_evidence`, `rule_needs_owner`, `too_little_evidence`, `tainted_evidence`, `needs_owner_words`, `too_long`, `no_inferred_sensitive`, `session_tainted`, `laws_unpinned`), plus the Worker's: `bad_op` (shape), `unknown_ref` (the fact the op names does not exist), `superseded` (it was replaced; work on its newest version), `duplicate_id`, `device_only` (pin, may_raise and forget) and `proposal_required`. `shared/contract/memory.ts` lists them ([CONTRACT.md](CONTRACT.md)).
- Ops the memory rules route to the owner (a non-user source superseding a `user` fact; a new `inferred` fact with sensitivity 1; the 11th supersession of a night batch) become `memory_big` proposals listed in `proposals` once proposals exist (P4). Until then they are rejected with `proposal_required` and `proposals` is always empty; the mind asks the owner in the conversation instead, and the owner's own words make the change a `user` one.
- A `confirm` whose evidence is all the owner's own words turns a non-`user` fact into a `user` version (a supersede the Worker writes; `applied[].fact_id` is the new version): from a device always (tag `imported` dropped), from the mind only when one cited owner message is newer than the fact.
- The mind can only make a fact more protected (PRIVACY.md §4): its add and supersede never lower `sensitivity` (a sensitive tag or `about: 'person'` makes it 1), never set `may_raise` to true on their own (faith is never raised), and never drop a protecting tag (sensitive, `faith`, `imported`). The owner's word is final.
- Text MEMORY.md §13 never stores (keys and tokens, passwords, card and bank numbers) is refused: reason `never_stored` (a loose end's or day note's text: 422 with issue `never_stored`).
- A forgotten fact's ids are never used again (`duplicate_id`); forget reaches every version of the lineage, even one an undo unlinked.
- M10 caps every batch from the mind (chat or night) at 10 supersessions.
- The ledger rows of memory carry no fact text (`what` names the kind, `ref` the fact), so `forget` can scrub every row that pointed at the forgotten versions (their `why` and undo) and leave one tombstone, `op_json = {op:'memory.forget', fact_id, kind, forgotten_at, versions}`.
- The rules themselves are in [MEMORY.md](../mind/MEMORY.md).

### 11.14 Senses (P5)

**`PUT /v1/senses/batches/:batch_id`** · Who: device
- Request `{ events: SenseEvent[] /* 1–500, ≤ 256 KB */ }`. The batch is sealed: the client retries exactly these bytes until it gets a 2xx.
- Response `200 { accepted: number, rejected: { i: number, reason: 'bad_type'|'bad_time'|'too_large'|'bad_ref' }[] }`. Invalid events are dropped and reported; the batch still counts as stored, so the outbox deletes it.
- `type` matches `^[a-z]+(\.[a-z_]+)+(\.v\d+)?$`. `at` must be within [now − 30 days, now + 5 min]. `data` ≤ 2 KB per event.
- 409 if the same `batch_id` arrives with a different body.

**`POST /v1/senses/query`** · Who: agents
- Request `{ name: string, params: Record<string, unknown> }`. `name` comes from a fixed map (`counts_by_day`, `top_refs`, `sequence`, `last_event`, …) in `areas/senses/queries.ts`. Never SQL.
- Response `200 { rows: unknown[], rows_read: number }`.

### 11.15 Media

**`POST /v1/media/sign`** · Who: device; agents for `book:` and `file:` refs · P5 (P2 for `file:`)
- Request `{ refs: Ref[] /* 1–50 */ }`.
- Response `200 { items: { ref, url, expires_at }[], errors: { ref, code: 'not_found'|'not_signable' }[] }`.
- Signing time (`X-Amz-Date`) is floored to the hour, and every URL expires 3 h after that, so it is valid for at least 2 h and identical within the hour (browser caching works). The client re-signs on a 403.
- Ref → key mapping is in [DATA.md §7.4](DATA.md#74-media-ref--key-map-used-by-post-v1mediasign). Bucket keys never appear in requests.
- Never put a signed URL in the address bar, history or logs.

### 11.16 Ops

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/ops/errors` | device, agents | `{ items: { fingerprint?, source: 'client'\|'csp'\|'job', route?, code, message /* ≤ 300 */, build: number, at: Ms, count?: number }[] /* ≤ 50 */ }` | `204` |
| `GET /v1/ops/errors?status=open\|resolved&since&limit` | device, agents, `ci` | — | `200 Page<ErrorRow>` (`since`: only errors last seen at or after it, ms) |
| `POST /v1/ops/errors/:fingerprint/resolve` | device, `mind:chat`, `mind:reflex` | `{}` | `204` |
| `POST /v1/ops/perf` **[proposal]** | device | `{ day: Day, build: number, metrics: Record<'inp'\|'loaf_gesture'\|'start_warm'\|'start_cold'\|'api_ms'\|'heap_mb', {p50, p75, p95, n}> }` (one call per day) | `204` |
| `GET /v1/ops/meter?days=1-30` | device, agents, `ci` | — | `200 { items: { day, class, rows_written, rows_read, bulk_rows_written }[] }` |
| `POST /v1/ops/backups/run` | `mind:night`, `ci` | `{ class?: string }` | `202 { job_ids: Id[] }` |
| `GET /v1/ops/backups?limit` | device, agents, `ci` | — | `200 Page<{date, class, rows, bytes, complete}>` |
| `POST /v1/ops/restore` | device, agents | `{ kind: 'pitr'\|'table'\|'object', class, at?: Ms, date?: Day, table?: string, mode?: 'replace'\|'merge' }` | `202 { proposal_id }` (it executes only when decided `approve`) |
| `POST /v1/ops/drill/run` | `mind:night`, `ci` | `{}` | `202 { job_id }` |
| `POST /v1/export` | device | `{}` | `202 { export_id }` (P4) |
| `GET /v1/export/:id` | device | — | `200 { status: 'building'\|'ready'\|'failed', items: { label, url, bytes, expires_at }[] }` |

`message` fields are scrubbed by the server too (URLs with query strings and token-shaped strings are removed).

### 11.17 Import

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/ops/import/parts` | `ci`, `mind:chat` | raw gzip JSONL part; headers `TH-Import: <run_id>/<instance>/<table>/<nnnn>`, `TH-Sha256`, `TH-Rows` (≤ 2,000 rows, ≤ 5 MB) | `201 { key }` (idempotent by the header path; 409 if the bytes differ) |
| `PUT /v1/ops/import/manifest/:run_id` | `ci`, `mind:chat` | the manifest JSON ([MIGRATION.md §3](MIGRATION.md)) | `201` |
| `POST /v1/import/runs` | device, `mind:chat` | `{ id: Id, run_id: string, dataset: 'threads'\|'messages'\|'notebook'\|'muse'\|'board'\|'chat_files'\|'music' }` | `202 { import_id }` |
| `GET /v1/import/runs/:id` | device, agents | — | `200 { state, counts: { expected, imported, skipped, skip_reasons }, report: { spot_checks: {seed, passed, failed}, rerun_delta } \| null }` |
| `POST /v1/import/phone` | device, from the new site's `/import/` page only (P1b) | `{ id: Id, chunk: number, chunks: number, exported_at: Ms, data: Record<string, unknown> }` (`data` = the `th-phone-export/2` file), gzip, ≤ 5 MB per chunk ([MIGRATION.md §5.3](MIGRATION.md#53-the-two-pages)) | `201 { import_id, counts: Record<string, number> }` (after the last chunk) |

Data mechanics and proof rules: [DATA.md §12](DATA.md#12-importing-the-old-data). The plan: [MIGRATION.md](MIGRATION.md).

### 11.18 Jobs (P5)

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/jobs/next?kind=audio.analysis&max=1-1000` | `mind:night`, `ci` | — | `200 { job_id, kind, v, shas: string[] }` or `204` when nothing is due |
| `GET /v1/jobs/:id/spec` | `ci` | — | `200 { job_id, kind, v, shas: string[] }` (for the Actions run, which receives only `job_id`) |
| `POST /v1/jobs/:id/collect` | `mind:night`, `ci` | `{}` | `202 { state: 'validating' }` |
| `GET /v1/jobs/:id` | agents, `ci` | — | `200 { state: 'issued'\|'validating'\|'applied'\|'rejected'\|'expired', counts: {expected, valid, invalid, missing} }` |

Validation rules: [JOBS.md §3](JOBS.md#3-actions-jobs-audio-analysis).

### 11.19 Work orders (P4)

Order states, leases, validation and the Board approval are owned by [MUSE.md §3–§6](../mind/MUSE.md); these are the routes.

| Route | Who | Request | Response |
|---|---|---|---|
| `PUT /v1/work/orders/:id` | `mind:chat`, `mind:night` | `{ kind, assignee: 'muse', title /* ≤ 80 */, spec /* ≤ 16 KB */, schema /* JSON-Schema subset, ≤ 8 KB */, personal: boolean, approval_id?: Id, deadline_at: Ms }` | `201`; `403 needs_approval` when `personal` without an approved `reach_people` proposal |
| `POST /v1/work/orders/:id/cancel` | `mind:chat`, `mind:night`, device | `{ why /* ≥ 8 */ }` | `200 { status: 'cancelled' }` |
| `GET /v1/work/orders?status=queued\|claimed\|all` | device, agents | — | `200 Page<WorkOrder>` |
| `GET /v1/work/hello` | `muse` | — | `200 { agent: 'muse', scopes, server_time, board_brief_allowed }` |
| `POST /v1/work/claim` | `muse` | `{}` | `200 { order }` (oldest `queued` order whose deadline hasn't passed) or `204` |
| `POST /v1/work/orders/:id/heartbeat` | `muse` | `{ note? /* ≤ 120 */ }` | `200 { lease_until }` (30 min lease) |
| `PUT /v1/work/orders/:id/result` | `muse` | `{ result /* ≤ 256 KB */, files?: Ref[] }` | `200 { status: 'done' }` or `422 invalid_result` with `details` (the order becomes `rejected`) |
| `POST /v1/work/orders/:id/fail` | `muse` | `{ reason /* ≤ 280 */ }` | `200 { status }` |
| `POST /v1/work/orders/:id/files` | `muse` | raw bytes, header `TH-File-Name` (≤ 15 MB, ≤ 10 per order) | `201 { ref, sha256 }` |
| `GET /v1/work/board/brief` | `muse` | — | `200 { version, brief }`, or `403` without the standing Board approval |
| `GET /v1/work/thread?after=<seq>` | `muse` | — | `200 Page<Message>` (its own `muse` thread) |
| `POST /v1/work/thread/messages` | `muse` | `{ id: Id, body /* ≤ 2,000 */ }` | `201 { id }` |

### 11.20 Settings and push

| Route | Who | Request | Response | Phase |
|---|---|---|---|---|
| `GET /v1/settings` | device, agents | — | `200 Record<string, unknown>` (no secrets exist here) | P1 |
| `PATCH /v1/settings` | device | `{ [key]: value }` (keys from [MENU-AND-SETTINGS.md](../product/MENU-AND-SETTINGS.md)) | `200` the changed keys | P1 |
| `PUT /v1/push/subscription` | device | `{ endpoint, keys: { p256dh, auth } }` | `204` | P8 |
| `DELETE /v1/push/subscription` | device | — | `204` | P8 |
| `GET /v1/push/key` | device | — | `200 { vapid_public_key }` | P8 |
| `GET /v1/push/items/:id` | device (from the service worker) | — | `200 { title, body, url }` (the text a push only points at) | P8 |
| `PUT /v1/pushes/:id` | `mind:chat` | `{ title, body, ref, why /* ≥ 8 */, topic_key, deadline? }` | `202 { queued_until }` | P8; 409 `push_budget`, `push_gap`, `quiet_hours`, `quiet`, `nudge_repeat` |

Push payloads carry only `{"k": kind, "id": id}`, encrypted. Details: [SECURITY.md](SECURITY.md).

### 11.21 App routes (later phases)

The ported apps (P1b) call the old Worker, not this API. Each app's routes are added here, to §13 and to `shared/contract/` in the phase its data moves, with the shapes its app doc gives. Until then they are **[proposal]**, owned by the app docs:

| App (data move) | Routes named in its doc |
|---|---|
| Music (P5) | `GET /v1/music/catalog`; `/v1/music/uploads/*` for the upload tools ([MUSIC.md](../product/apps/MUSIC.md), [MIGRATION.md §7](MIGRATION.md#7-caller-switch-over-order)) |
| Guitar (P6) | The Songsterr and tab-source passthrough the old `/guitar/*` routes provide ([GUITAR.md](../product/apps/GUITAR.md) §11) |
| Study (P7) | `POST /v1/library/books`, `PUT /v1/library/books/:id/parts/:n`, `POST /v1/library/books/:id/complete`, `PUT /v1/library/books/:id/pages`, `PUT /v1/library/highlights/:id`, `PUT /v1/library/positions/:book_id` ([STUDY.md](../product/apps/STUDY.md)) |
| Podcasts (P8) | `GET /v1/podcasts/directory`, `GET /v1/podcasts/feed`, `GET /v1/podcasts/audio`, `GET /v1/podcasts/file`, `POST /v1/podcasts/check`, `PUT /v1/podcasts/progress` ([PODCASTS.md](../product/apps/PODCASTS.md)) |
| Astra (P8) | `PUT /v1/astra/backup`, `GET /v1/astra/backup` (device only) ([ASTRA.md](../product/apps/ASTRA.md)) |
| My Media (P8) | `GET /v1/media/config`, `GET /v1/media/catalog`, `GET /v1/media/drive/:id`, `PUT /v1/media/progress/:id` ([MY-MEDIA.md](../product/apps/MY-MEDIA.md)); `GET /v1/media/config` may be needed earlier (MIGRATION open question 8) |

Every one of them follows this page's rules (scopes in §13, errors in §6, cost budgets in [TESTING.md §6](TESTING.md#6-cost-tests)).

---

## 12. WebSocket protocol (`/v1/live`)

| Direction | Frame | Meaning |
|---|---|---|
| server → client | `{"t":"hello","v":1,"seq":N,"min_client":M}` | Sent once on connect; `v` is the protocol version (`LIVE_PROTOCOL`). The client fetches `/v1/changes?after=<its last seq>` |
| server → client | `{"t":"changed","seq":N,"kinds":["message"]}` | Something committed. The client pulls `/v1/changes` |
| server → client | `{"t":"typing","who":"mind","until":Ms}` | The mind is writing (presence pulse) |
| server → client | `{"t":"bye","code":"session_revoked"}` | Then a close with code 4401 |
| client → server | `ping` (text) | Auto-answered `pong` by `setWebSocketAutoResponse`; does not wake `Core` |

- Close codes: `4401` revoked or expired, `4426` client outdated, `1012` the object restarted (reconnect).
- The client never sends data over the socket. All writes go through HTTP, so they are idempotent and scoped.

Acceptance: an integration test connects, posts a message over HTTP and receives exactly one `changed` frame with `kinds: ["message"]`.

---

## 13. Route table (the source for the scope test)

`D` device · `C` mind:chat · `N` mind:night · `R` mind:reflex · `M` muse · `I` ci · `P` public.

From P2 this table is data: `shared/contract/routes.ts` is the source the Worker's guards and the scope test read, and [CONTRACT.md](CONTRACT.md) lists every row with its status. Rows that wait on the private bucket (SETUP.md J2) are marked `deferred` there: `POST /v1/import/phone`, `PUT /v1/files/:id`, `POST /v1/media/sign`.

| Route | Who | Phase |
|---|---|---|
| `GET /v1/health`, `GET /v1/auth/state` | P | P1 |
| `GET /v1/ops/health/deep` | D C N R I | P1 |
| `POST /v1/auth/setup`, `/login`, `/recover` | P | P1 |
| `POST /v1/auth/signout`, `/password`, `/recovery-code`, `/recovery-code/confirm`, `/breakglass/cancel`, `/notices/:id/ack`; `/v1/auth/sessions*`; `/v1/auth/agents*` | D | P1 |
| `GET /v1/auth/me` | D C N R M I | P1 |
| `POST /v1/auth/breakglass` | C | P1 |
| `GET/PATCH /v1/settings` | GET D C N R; PATCH D | P1 |
| `POST /v1/ops/errors` | D C N R | P1 |
| `GET /v1/ops/errors`, `GET /v1/ops/meter` | D C N R I | P1 |
| `POST /v1/ops/errors/:fp/resolve` | D C R | P1 |
| `POST /v1/ops/perf` | D | P1 |
| `POST /v1/live/ticket`, `GET /v1/live` | D | P2 |
| `GET /v1/live/wait` | C N R | P2 |
| `GET /v1/changes` | D C N R | P2 |
| `GET /v1/threads*`, `GET /v1/mind/wakes` | D C N R | P2 |
| `PATCH /v1/threads/:id` | C N | P2 |
| `POST /v1/threads/:id/continue`, `POST /v1/mind/typing` | D | P2 |
| `PUT /v1/messages/:id` | D C (N R: `error` kind to the system thread) | P2 |
| `PATCH /v1/messages/:id` | C | P2 |
| `PUT /v1/files/:id` | D C | P2 |
| `GET /v1/search` | D C N | P2 |
| `POST /v1/mind/brief`, `/status`, `/notes`, `/taint`; `GET /v1/mind/pending` | C N R | P2 |
| `POST /v1/mind/night` | N | P3 |
| `GET /v1/mind/day/:day` | N | P3 |
| `GET /v1/ledger` | D C N R | P2 |
| `PUT /v1/ledger/:id` | C N R | P2 |
| `POST /v1/ledger/:id/undo` | D C | P2 |
| `PUT /v1/verbs/:id` | C N | P2 |
| `GET /v1/verbs/pending`, `POST /v1/verbs/:id/claim`, `/result` | D | P2 |
| `GET /v1/surfaces` | D C N R | P2 |
| `PUT /v1/surfaces/:app/:slot` | C N | P2 |
| `DELETE /v1/surfaces/:app/:slot` | D C N | P2 |
| `GET /v1/memory/*` | D C N (reflex reads no memory, RUNTIME.md §7.1) | P3 |
| `PATCH /v1/memory/open-threads/:id` | D C N | P3 |
| `POST /v1/memory/ops` | D C N | P3 |
| `PUT /v1/memory/day-notes/:day` | D N | P3 |
| `PUT /v1/memory/open-threads/:id` | D C N | P3 |
| `POST /v1/import/runs` | D C | P3 |
| `POST /v1/ops/import/parts`, `PUT /v1/ops/import/manifest/:run_id` | C I | P3 |
| `GET /v1/import/runs/:id` | D C N R | P3 |
| `PUT /v1/proposals/:id` | C N R | P4 (P3 for class `memory_big`, and class `delete` with op `memory.forget`) |
| `GET /v1/proposals` | D C N R | P4 (P3 for the classes above) |
| `POST /v1/proposals/:id/decide` | D; C with `by_message` | P4 (P3 for `memory_big` and `memory.forget`) |
| `POST /v1/proposals/:id/cancel` | D C N R | P4 |
| `POST /v1/ops/backups/run`, `POST /v1/ops/drill/run` | N I | P4 |
| `GET /v1/ops/backups` | D C N R I | P4 |
| `POST /v1/ops/restore` | D C N R | P4 |
| `POST /v1/export`, `GET /v1/export/:id` | D | P4 |
| `PUT /v1/work/orders/:id`, `POST /v1/work/orders/:id/cancel` | C N (cancel also D) | P4 |
| `GET /v1/work/orders` | D C N R | P4 |
| `GET /v1/work/hello`, `POST /v1/work/claim`, `/v1/work/orders/:id/{heartbeat,result,fail,files}`, `GET /v1/work/board/brief`, `/v1/work/thread*` | M | P4 |
| `PUT /v1/senses/batches/:id` | D | P5 |
| `POST /v1/senses/query` | C N R | P5 |
| `POST /v1/media/sign` | D (C N for `book:`/`file:`) | P5 (P2 for `file:` refs) |
| `POST /v1/import/phone` | D | P1b |
| `GET /v1/jobs/next`, `POST /v1/jobs/:id/collect` | N I | P5 |
| `GET /v1/jobs/:id` | C N R I | P5 |
| `GET /v1/jobs/:id/spec` | I | P5 |
| `/v1/push/*` | D | P8 |
| `PUT /v1/pushes/:id` | C | P8 |

---

## 14. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| A1 | SIGN-IN.md replaces the review's `POST /v1/auth/setup-ticket` with the fingerprint flow, which this page follows. | Settled: decisions.md 2026-10-28 (fingerprint setup, no setup-ticket endpoint); ROADMAP P1 follows it |
| A2 | Do Workers Logs record the `?ticket=` query string of `/v1/live`? | Preview: connect once, read the log entry. If yes, keep the 30 s single-use rule and note it in SECURITY.md |
| A3 | Is `--tag` length-limited, and does `VERSION.tag` carry it? | `wrangler deploy --tag <sha12>` in preview; read `/v1/health` |
| A4 | Does a non-JSON platform error (1027, 1102) arrive with CORS headers so the page can read the status? | Force 1102 in preview with a CPU-burn route; check in Chrome |
| A5 | Is 600 requests/min per token right for the phone during a library sync? | Count requests in a P5 sync on the A15 |
