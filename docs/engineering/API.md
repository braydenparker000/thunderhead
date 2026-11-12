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
8. **Limits:** 64 KB JSON bodies by default; 4 KB on auth; 256 KB for event batches; a chat file up to 25 MiB (§9).
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
| `TH-Sandbox` | the injection suite only (P4, sent by `th` between `th eval begin` and `end`) | `eval`: the request goes, through the same route, to the scratch Core instance `core-eval` instead of the owner's ([EVALS.md §1.1](../mind/EVALS.md)). Chat and night keys only, never on a route that takes one named key; any other principal or value is `403 forbidden`. There nothing reaches Auth, the routines or the owner's Core, and each write the mind tries is recorded |
| `Content-Type` | bodies | `application/json` (files: the file's type) |
| `TH-File-Name`, `TH-Sha256`, `TH-Seconds` | `PUT /v1/files/:id` | the file's name (URL-encoded), the lowercase hex SHA-256 of the body, and a voice memo's length in seconds (§11.7) |

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

type Attachment = { ref: Ref /* file:<id> */; name: string; type: string; bytes: number;
  seconds?: number /* a voice memo's length */; text?: string /* a voice memo's words, when the Worker could transcribe them */ };
type Message = { seq: number; id: Id; thread_id: Id; author: 'owner'|'mind'|'muse'|'system';
  origin: 'owner_device'|'mind'|'system'|'muse'|'import';
  kind: 'text'|'voice'|'progress'|'card'|'question'|'error'; body: string; meta: Record<string, unknown>|null;
  attachments: Attachment[]; reply_to: Id|null; created_at: Ms; delivered_at: Ms|null; acked_at: Ms|null; answered_at: Ms|null };

type LedgerEntry = { seq: number; id: Id; at: Ms; actor: Actor;
  kind: 'memory'|'arrangement'|'verb'|'deploy'|'proposal'|'mistake'|'undo'|'note';
  what: string; why: string /* ≥ 8 chars */; ref: Ref|null; topic_key: string|null; undoable: boolean;
  status: 'done'|'undone'|'failed'; tainted: boolean; proposal_id: Id|null; undone_at: Ms|null };

type ProposalClass = 'delete'|'money'|'access'|'reach_people'|'memory_big';
type Proposal = { id: Id; created_at: Ms; created_by: Actor /* 'worker' for its own cards */; class: ProposalClass;
  question: string /* ≤ 80 */; why: string /* ≤ 140 */; if_ignored: string; odds: number|null;
  options: [action: string, safe: string]; safe: 'reject'|'snooze' /* what the second button does */;
  spec: ProposalSpec; spec_hash: string;
  status: 'waiting'|'approved'|'rejected'|'expired'|'cancelled'|'executed'|'failed';
  expires_at: Ms; show_from: Ms /* creation, the end of its quiet hours, or the morning after "Not yet" */;
  snoozes: number; decided_at: Ms|null; decided_via: 'tap'|'words'|null; decided_message_id: Id|null;
  result: Record<string, string|number|boolean|null>|null };
type ProposalSpec = { v: 1; op: string; args: Record<string, unknown> };   // op from PROPOSAL_OPS (shared/contract/proposals.ts)

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
| `mind:chat` | `thm_…` | Settings → Agents, role "Mind (chat)" | Read all; post messages; memory ops (provenance rules apply); ledger notes; verbs; surfaces; proposals; brief; wait |
| `mind:night` | `thm_…` | role "Mind (night)" | Read all; memory ops; day notes; titles; surfaces; jobs; backups; proposals. **No** chat messages (except `system` home lines through surfaces) |
| `mind:reflex` (P4) | `thm_…` | role "Mind (reflex)" | Read errors, health and ledger; one notice message per wake; resolve errors; ledger notes. **No** memory writes |
| `muse` (P4) | `ths_…` | role "Muse" | `/v1/work/*` and messages in its own `muse` thread |
| `ci` | `thc_…` | role "CI"; stored as `TH_CI_TOKEN` in the GitHub environment `worker` | Deep health, meter, backup and drill triggers, job specs and collect. Nothing personal: deep health returns counts only |

- The Worker hashes the bearer (SHA-256) and looks it up in the isolate cache (60 s TTL), then in `Auth`. Revocation takes effect within 60 s everywhere.
- **Tainted sessions:** once a session calls `POST /v1/mind/taint`, the Worker records it in `mind_sessions` for good. What requests carrying that `TH-Session` write to memory is labelled `provenance: 'outside'` (2026-11-02, MEMORY.md §6 M11: each memory write answers with its label; such a session may not write a `rule` or replace an `owner` or `observed` fact, `422 outside_rule` / `outside_supersede`, nor confirm one, `422 outside_confirm`; a clean session reads memory labelled `outside` kept back, and asking for it, `outside=1`, taints it, M11f), and they may not raise a card in any ask-first class (`delete`, `money`, `access`, `reach_people`; `403 session_tainted`; cards from P4). A card needs a claimed, live session of the key's role too (`403 session_required`). Rules: [MEMORY.md §6–7](../mind/MEMORY.md). **Memory writes need a claimed session** (P3): a mind's memory write (ops, loose ends, day notes) must carry the `TH-Session` of a session that claimed its briefing in the key's role and has not ended, else `403 session_required`, so a fresh or made-up session id can't shed a taint's label. Nor can a new claim: **a taint holds for 24 hours for its role**, counted from the taint, and a claim takes it over from the role's latest session tainted in that time unless it matches, exactly, a wake the Worker fired after the taint (MEMORY.md §7, RUNTIME.md §4.3). Nor can an older session id (P4): a session counts as tainted once another session of its role was tainted after it claimed, and only the chat session that holds the lease writes as `mind:chat` (a chat claim ends the older chat sessions, which may not take the lease back).
- The full scope matrix is [SECURITY.md §5.3](SECURITY.md); §13 below is the route-level form of it.
- **Approval is never inferred.** A proposal is decided only by `POST /v1/proposals/:id/decide`: from a `device` principal (a tap), or from `mind:chat` citing the owner's own words (`by_message`), which the Worker checks itself: the cited message is owner-authored from a signed-in device (`origin=owner_device`), sent after the card appeared, in the open day's thread, the owner's latest message there, and not the answer to another card (decisions 2026-10-28; [BEHAVIOR.md §4](../mind/BEHAVIOR.md)). Who records the words is checked too: only the claimed `mind:chat` session that holds the chat lease, and a tainted session may not record an approval (`403 session_tainted`; a no or a not-yet, which change nothing, still go through). The laws card takes a tap only. A fired prompt, Muse output or any other text never decides.

Acceptance: `backend/tests/integration/route-scopes.test.ts` walks §13. For every route and every principal not listed, it asserts 401 (no token) or 403 (wrong principal).

## 4. CORS

| Item | Value |
|---|---|
| Allowed origins | Exact strings from the var `SITE_ORIGINS`: the new storage website origin only. The old site's origin is never allowed (the phone export travels as a file, [MIGRATION.md §5](../archive/MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)) |
| Methods | `GET, POST, PUT, PATCH, DELETE` |
| Allowed headers | `Authorization, Content-Type, TH-Client, TH-File-Name, TH-Sha256, TH-Seconds, If-None-Match, Range, If-Range` (browsers never send `TH-Session`; `If-None-Match` revalidates the music catalog, P5; `Range` and `If-Range` ask for part of a podcast episode, P8) |
| Exposed headers | `TH-Request-Id, TH-Server, TH-Min-Client, Retry-After, ETag, Content-Range, Accept-Ranges` |
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
| 403 | `session_tainted` | A tainted mind session tried a gated write (an ask-first card, its approval, a reminder, a work order; memory is labelled `outside` instead, MEMORY.md §6 M11) | The mind reports it; no retry |
| 403 | `session_required` | A mind memory write without a claimed, live session of the key's role (P3) | Claim with `th brief --claim` first; no retry as is |
| 403 | `laws_unpinned` | `rule` write from a session whose constitution pin failed | — |
| 403 | `proposal_required` | An ask-first verb or op without an approved proposal; a write whose standing permission is Ask, or that has a floor, without an approved card for that call (`details.reason` `permit` names the card, §11.11) | Create a proposal, then send the call again naming it |
| 403 | `needs_approval` | A work order with `personal` and no approved `reach_people` proposal ([MUSE.md §6](../archive/MUSE.md)) | Create the proposal first |
| 403 | `off_record` | A loose end, session note, title or Continue this that names a conversation off the record, or cites one of its messages ([MEMORY.md §6.1](../mind/MEMORY.md)) | Nothing from it is kept; never retry |
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
| 410 | `gone` | A deleted conversation (or one whose purge is due) written to, answered, cited, deleted again, or restored after its 30 days | Leave it; the phone returns to today |
| 413 | `too_large` | The body exceeds its limit | Split |
| 415 | `unsupported_media_type` | Wrong `Content-Type` | — |
| 422 | `validation` | Schema or rule failure; `details` lists zod issues or rule reasons (memory: `bad_evidence`, `not_owner_evidence`, `rule_needs_owner`, `too_little_evidence`, `tainted_evidence`, `needs_owner_words`, `too_long`, `outside_rule`, `outside_supersede`, `outside_confirm`, `off_record_evidence`, `deleted_evidence`) | Fix; never retry as is (`th` exit 8) |
| 422 | `password_too_short`, `password_too_long`, `password_guessable`, `password_breached`, `password_same` | Password rules ([SIGN-IN.md §9.2](../product/SIGN-IN.md)) | Show the line |
| 422 | `invalid_result` | A Muse result fails its order's schema or hygiene checks; the order becomes `rejected` ([MUSE.md §5](../archive/MUSE.md)) | Muse fixes and the mind re-orders |
| 422 | `too_sensitive` | A Home surface or push whose `ref` points at sensitivity-1 data ([PRIVACY.md §4](PRIVACY.md#4-what-the-mind-may-raise-unprompted)) | Drop it |
| 422 | `username_invalid` | Setup username outside 3–32 letters, digits, `.`, `-`, `_` | Show the line |
| 422 | `topic_quiet` | A surface on a topic that rests: passed over three times in a row, it rests 30 days (BEHAVIOR.md §3.6); `details: {until, reopens}` | Drop it; say once that it stopped (`POST /v1/surfaces/topics/:key/said`) |
| 422 | `speech_budget` | The owner's speech setting holds an unasked line, tile, card or push back (BEHAVIOR.md §3.7); `details: {speech, spent: {lines, cards}}` | Drop it, or name the owner's words that asked (`asked_by`) |
| 409 | `already_said` | The mind already recorded that it said a topic went quiet | Nothing to do |
| 425 | `reset_not_ready` | A reset ticket used before `usable_after` | Show the countdown |
| 426 | `client_outdated` | A write from below `min_client` | Apply the update |
| 429 | `rate_limited` | Throttled; `error.retry_after` (s) and `error.scope` (`source`\|`account`), plus `Retry-After` | Wait that long (`th` exit 10) |
| 429 | `too_many_scheduled` | 20 scheduled verbs and plans already wait ([§11.11](#scheduled-actions)) | Cancel one or let one run first (`th` exit 10) |
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
| Memory ops, verb results, job collect | `batch_id` / the path id, kept in `Core.op_batches` for 7 days | 200 + the stored result | 409 |
| Import runs | the request `id`, kept as its `imports` row | 202 + the same `import_id` | 409 |
| Import parts and the manifest | the part's path / the run id, kept in `thunderhead-private` | 201 | 409 |
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
| `POST /v1/ops/reports` | the batch's `body` 32 KB as JSON once kept to its known fields (`REPORT_LIMITS.body_bytes`); the request 33 KB; 6 from one device in any 5 minutes | 413; 429 `rate_limited` with `retry_after` and `Retry-After` |
| `GET /v1/ops/reports` | 200 batches and 512 KB a page (`REPORT_LIMITS.page_max`, `page_bytes`): a page ends before the batch that would pass 512 KB, and `next` goes on from there | — |
| `POST /v1/import/phone` | 5 MB per chunk | 413 |
| `POST /v1/ops/import/parts` | 25 MiB per part (`IMPORT_PART_BYTES`) | 413 |
| Chat file (`PUT /v1/files/:id`) | 25 MiB (`FILE_LIMITS.bytes`, `shared/contract/files.ts`); the body is read whole, so a sender without `Content-Length` is cut off there too | 413 |
| A file's name (`TH-File-Name`) | 120 characters, once decoded and made safe | 422 |
| A voice memo (`TH-Seconds`) | more than 0 and at most 600 s; transcribed words kept up to 16,000 characters (cut, never refused) | 422 |
| Attachments on a message | owner 4, chat mind 10 (`FILE_LIMITS`); the request schema takes at most 10 refs | 422 |
| Message body | 16,000 characters; empty only on an owner message with attachments | 422 |
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
- `meter_today` is the five objects' rows read and written on the current UTC day, each from its own row meter ([DATA.md §3](DATA.md#3-shared-machinery-in-every-class): what it has stored, plus what it hasn't written yet), so it survives an object's restart.
- Fields whose feature hasn't shipped are present with `null` or `0` (P1: `last_backup` and `last_events_export` are `null`; `jobs_backlog` (counted from P3: the jobs not done or failed), `wakes_today` and `meter_today.bulk_rows_written` are `0`; `bulk_lane` is `null`). The backup age counts toward `ok` only once the first weekly backup exists (P4).

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
    events: { type: 'proposal.decided'|'work.done'|'verb.result'|'deploy.result'|'watch.fired'; ref: Ref; at: Ms;
              kind?, why?, note? }[];     // watch.fired: a watch met while this session holds the lease (no new wake); its words null when kept back
    signals: ('day_closed' | 'stop')[];
    off_record?: Id[] }                   // the conversations off the record among `messages`: answer, remember nothing
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
| `GET /v1/threads?status=open\|filed&limit&cursor` | device, agents | — | `200 Page<Thread>` newest `updated_at` first | Never a deleted thread; one off the record (with messages, not yet due) only for the device |
| `GET /v1/threads/today` | device, agents | — | `200 { thread: Thread\|null, messages: Message[] /* last 50 */, seq: number }` | `thread` is null before the day's first message |
| `GET /v1/threads/:id` | device, agents | — | `200 Thread` (`purge_at` set only off the record) | `404` for a deleted thread or one whose purge is due; for one off the record, to the night and the reflex |
| `GET /v1/threads/:id/messages?before_seq\|after_seq&limit` | device, agents | — | `200 Page<Message>` | `404` as `GET /v1/threads/:id` |
| `PUT /v1/threads/:id/off-record` | device | — (`:id` the phone's UUIDv7) | `201 Thread` (`kind:'off_record'`, `purge_at` 7 days on); `200` the same id again | A conversation off the record ([MEMORY.md §6.1](../mind/MEMORY.md)). `409` another thread's id; `410 gone` once deleted or due |
| `DELETE /v1/threads/:id` | device | — | `200 { id, purge_at }` | Hidden at once from every list, read and search; its waiting messages settled; Recently deleted for 30 days (one off the record keeps its sooner 7). Today's thread too: the next message starts a fresh today. `410 gone` when already deleted |
| `POST /v1/threads/:id/restore` | device | — | `200 { id, kind, beside }` | Back as it was; a daily thread whose day began a fresh one comes back beside it (`kind:'restored'`, `beside:true`, filed). `404` not deleted; `410 gone` past its 30 days |
| `GET /v1/threads/deleted` | device | — | `200 { items: DeletedThread[] }` (`{id, day, kind, title, summary, message_count, deleted_at, purge_at}`) newest first, ≤ 200 | Settings › Recently deleted |
| `PATCH /v1/threads/:id` | `mind:chat`, `mind:night` | `{ title?: string /* ≤ 80 */, summary?: string /* ≤ 400 */ }` | `200 Thread` | Sets `title_source:'mind'`; refused (`409 conflict`) when `title_source='owner'` |
| `POST /v1/threads/:id/continue` | device | — | `200 { today_thread_id }` | Links a filed thread to today (`continues`) |
| `PUT /v1/threads/:id/title` | device | `{ title }` (≤ 60, trimmed; empty clears) | `200 Thread` | The owner names a thread (`title_source` `owner`), which the mind's `PATCH` then refuses (409); empty gives naming back (2026-10-31) |
| `PUT /v1/messages/:id` | device, `mind:chat`, `muse` (own thread); `mind:night`/`mind:reflex` only `kind:'error'` to the system thread | `{ body: string /* '' only on an owner message with attachments */, kind?: Message['kind'] /* default 'text' */, meta?: object /* ≤ 8 KB */, attachments?: Ref[] /* file:<id>, owner ≤ 4, mind ≤ 10 */, reply_to?: Id, mention?: 'muse' /* the owner's "@muse …", rule 10 */ }` | `201 Message` (200 on a same-body retry) | See below |
| `PATCH /v1/messages/:id` | `mind:chat` (own posts) | `{ body?: string, meta?: object }` | `200 Message` | Keeps progress cards current (`th amend`) |
| `GET /v1/search?q=&sources=messages,facts,day_notes,library&since&until&thread&limit&outside` | device, `mind:chat`, `mind:night` | — | `200 { items: { source, ref, snippet /* ≤ 200 chars, match in «» */, at, thread_id?, score, provenance? }[] }` | Federated: each source (`shared/contract/feed.ts` `SEARCH_SOURCES`) answers with FTS5 bm25 and the Worker fuses them by reciprocal rank (k = 60), with one more list by meaning (MEMORY.md §10.6: the asked sources' nearest indexed rows that still stand, top 20, Study's pages among them as `library` hits `book:<id>#p<n>`; a ref in both keeps its FTS snippet; the model failing leaves FTS alone, never an error); default all built sources (P2: `messages`); an unknown source is 422; `kind=` is kept as an alias of `sources=`; `q` 1–200 chars. To a mind session a fact's or a day note's hit labelled `outside` comes kept back (snippet `(outside, kept back)`) unless `outside=1`, which first marks the session as having read outside text (MEMORY.md §6 M11f; 422 without `TH-Session`, 403 `session_required` for an unclaimed one; nothing outside found marks nothing) |
| `POST /v1/mind/typing` | device | `{}` | `204` | May fire a pre-warm wake ([RUNTIME.md](../mind/RUNTIME.md)) |
| `POST /v1/mind/stop` | device | `{}` | `204` | The owner taps Stop: setting `mind.stop`, the `stop` signal to a waiting chat mind (once), `TH-Stop: 1` on its say/status replies and `stop: true` in `GET /v1/mind/pending` until its next text reply or a new claim. Stop ends the work, not the session ([BEHAVIOR.md](../mind/BEHAVIOR.md)) |
| `PUT /v1/files/:id` | device, `mind:chat` | raw bytes (`:id` a client UUIDv7); headers `Content-Type` (default `application/octet-stream`), `TH-File-Name` (URL-encoded, required), `TH-Sha256` (hex, required), `TH-Seconds` (audio only, optional) | `201 Attachment` (`{ref: 'file:<id>', name, type, bytes, seconds?, text?}`); `200` the same `Attachment` when the id is sent again with the same SHA-256 | Rules below. `409 conflict`: the id holds other bytes. `413`: over 25 MiB. `415`: a form body (`multipart/*`, `application/x-www-form-urlencoded`). `422`: a bad name, digest, memo length or id, an empty body, or the eval sandbox. `503 not_configured`: no `VAULT` binding |
| `POST /v1/dictate` | device | raw audio (`Content-Type: audio/*`, ≤ 1 MiB, never empty): one piece of what the owner is saying (HOME.md §6.4) | `200 { text }`, the words heard, `''` for silence | Rule 8 below. `413`: over 1 MiB. `422`: not audio, or empty. `429 rate_limited`: over 60 pieces a minute on one isolate. `502 upstream`: Whisper failed or took over 10 s. `503 not_configured`: no `AI` binding |
| `GET /v1/files/:id` | device, `mind:chat`, `mind:night` | — (`If-None-Match` optional; `?meta=1` for the record) | `200` the bytes, or with `?meta=1` the `Attachment` as JSON; `304` when `If-None-Match` names its ETag | `404` unless the file's row exists. Headers: its `Content-Type` and `Content-Length`, `ETag: "<sha256>"`, `Cache-Control: private, no-store` (a private file never outlives a sign-out in the browser's cache), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition` (`inline` for `image/*`, `audio/*`, `video/*`, `application/pdf`, else `attachment`; `filename` in ASCII and `filename*` in UTF-8, RFC 5987). The bytes come only from here, never by a link ([SECURITY.md §9](SECURITY.md#9-presigned-media-urls)) |

`PUT /v1/messages/:id` rules:
1. The message goes into the open `daily` thread for `day.current`. The Worker creates that thread if needed. The client never names a thread, except `muse` in its own thread, and the device or `mind:chat` naming a live conversation off the record (`thread_id: <id>`; another thread's id is `422`, a deleted or due one `410 gone`). A message whose `reply_to` is in a conversation off the record goes there too, named or not, so an answer never lands in today's thread; one answering a message of a deleted thread is `410 gone`. A message off the record has no FTS entry and moves its thread's purge to 7 days after it.
2. `author` and `origin` come from the principal (`device` → `owner`/`owner_device`, `mind:chat` → `mind`/`mind`, `muse` → `muse`/`muse`), never from the body.
3. A `mind` message with `reply_to` sets `answered_at` on that owner message and on every earlier unanswered owner message (a conversation off the record is its own: a reply in it settles only its messages, and a reply elsewhere never settles one of it). `reply_to` names a message in the open thread, or an owner message still unanswered from an earlier day, so a reply after the roll still settles it (nothing the owner said is lost across the roll).
4. An owner message with no live chat lease and no unclaimed fire younger than 90 s queues a wake (conditions: [RUNTIME.md §3](../mind/RUNTIME.md)).
5. Owner messages use `text` or `voice`. Agents may use every kind; `system` messages (author `system`) are written only by the Worker.
6. Wording limits on mind messages (the phrase lint) are enforced as `422 validation` per [BEHAVIOR.md](../mind/BEHAVIOR.md).
7. A `mind:chat` text reply clears a standing Stop and, when no owner message is left unanswered, sets the presence (`mind.status`) to `listening`, so the edge stops pulsing while the session waits.
8. **Action chip (P2).** A `mind` message may carry one chip in `meta.chip = { label: string /* 1–28 chars */, app: 'music'|'guitar'|'podcasts'|'astra'|'media'|'study', path: string /* root-absolute, inside that app's folder */ }`. Until an app's agreed evolution adds deep links, `path` is the app's folder root (`/music/` …), and a tap navigates there. Any other `meta.chip` shape is `422 validation`.
9. **Attachments.** `attachments` lists refs only, `file:<id>` of files already uploaded with `PUT /v1/files/:id`. An owner message (device) takes at most 4, a `mind:chat` message at most 10; night, reflex and Muse posts take none. Each file must exist, have been uploaded by the same kind of author (a device's files go only on owner messages, `mind:chat`'s only on mind messages) and be listed once; otherwise `422 validation` with `details` naming each `attachments.<i>`. A file already on another message is `409 conflict` (same `details`). The message stores the full `Attachment` of each, in the order given, and each file is marked as that message's in the same write; a refused message changes no file. A retry of the same message with the same body (attachments included) answers the stored message as before. An owner message may have an empty `body` when it has at least one attachment; every other message needs words.
10. **Mentions (2026-11-03).** `mention: 'muse'` (the phone sends it for a message that starts `@muse ` or `@Muse,`, th/commands) asks Muse, not the mind. Only the owner's device may send it, never off the record and never with attachments, and the words after the mention are 1–500 characters (`422 validation`, `path: 'mention'` or `'body'`). In the message's own commit the Worker stores it with `meta.mention = 'muse'`, makes a `muse.request` work order with those words under the owner's authority (never gated by `mind.permit.muse`; `message_id` links it, §11.19), answers that one message (`answered_at`; earlier ones still wait) and posts a `system` line replying to it, `"Asked Muse. I'll tell you when it lands."` with `meta.work = { id, state: 'asked' }`. No wake is queued (rule 4 doesn't apply). Words holding what is never stored (MEMORY.md §13) make no order; the line says so instead. Each later state of the order posts one more line (§11.19).
11. **What the reply drew on (2026-11-04).** `meta.using` is the Worker's, never a body's: a message or an amend (`PATCH`) that names it is `422 validation` (`path: 'meta.using'`). When `mind:chat` replies (`text`, `question` or `card`) with `reply_to` an owner message, the Worker copies the chips the session gave while it was `working` at or after that message (the presence's `using`, `POST /v1/mind/status`, ≤ 6, `MIND_STATUS_LIMITS`) into the reply's `meta.using` and takes them, with their title, off the presence in the same commit, so the next message starts with none; a progress line or a post without `reply_to` takes nothing. An amend that replaces `meta` keeps `meta.using`. The reply's lint and size rules are unchanged. The phone folds them under the reply as "How I got this" (HOME.md §4.13).

`PUT /v1/files/:id` rules:
1. **Name.** `TH-File-Name` is URL-decoded, then made safe: `/` and `\` become `_`, control and format characters (bidi overrides included) are removed, and leading dots and spaces are dropped. Undecodable, empty after that, or over 120 characters is `422`.
2. **Type.** `Content-Type` is stored as its lower-case essence (`audio/webm;codecs=opus` → `audio/webm`); absent or malformed is `application/octet-stream`.
3. **Digest.** `TH-Sha256` must equal the SHA-256 of the body (`422` otherwise); R2 checks it again on the way in.
4. **Bytes first.** The object goes to `thunderhead-private` at `chat/files/<YYYY>/<MM>/<id>.<ext>` (the month in UTC from the UUIDv7's own time, so a retry names the same key; the extension from a fixed list of types, else `bin`), stored once with its type; then the row (`Core.files`, [DATA.md §4.2](DATA.md#42-conversation)). A row never names missing bytes. The uploader is `owner` for a device, `mind` for `mind:chat`.
5. **Voice memo words.** An `audio/*` upload with `TH-Seconds` (more than 0, at most 600) is sent to Workers AI Whisper (`@cf/openai/whisper-large-v3-turbo`, binding `AI`, as a stream with its type; once more as base64 if the stream form is refused) after it is stored, for at most 25 s, when it is at most 10 MiB (a 10-minute memo at the phone's 32 kbit/s is about 2.4 MB; a bigger one is kept without words); its words, trimmed and cut at 16,000 characters, are kept on the row and returned as `text`. No binding (`backend/wrangler.jsonc` declares `AI`; local runs and tests never reach it, `remoteBindings: false`), a failure, an empty answer or the deadline means no `text`; the upload still succeeds. `TH-Seconds` on another type is `422`.
6. **The site's preflight.** §4 allows `TH-File-Name`, `TH-Sha256` and `TH-Seconds`.
7. **Sandbox.** In the eval sandbox (`TH-Sandbox: eval`) the route answers `422`: the bucket is the owner's.
8. **Dictation** (`POST /v1/dictate`, built 2026-10-31). The piece goes to the same Whisper as a voice memo (as a stream with its type, once more as base64 if refused) for at most 10 s, and its words come back trimmed and cut at 16,000 characters. Nothing is kept: no object, no row, no log of a word. A failure is `502` rather than `''`, so the phone can tell "couldn't hear" from silence. Limits are `DICTATE_LIMITS` (`shared/contract/files.ts`): a piece ≤ 1 MiB (the phone sends ≤ 15 s of 32 kbit/s Opus, about 60 KB), a take ≤ 120 s (the phone stops there). Each isolate takes at most 60 pieces a minute, so a runaway loop can't spend the day's free Whisper.

### 11.8 Mind

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/mind/brief` | agents | `{ claim: boolean, session_id: string, role: 'chat'\|'night'\|'reflex', constitution_sha256: string, th_version: string }` (`role` must match the key's role) | `200 { wake: {id, reason, claim_match} \| null, day: Day /* the open day; for the night role the day before it, the one it works on */, seq: number, core: string /* ≤ 9,500 chars */, full: string /* ≤ 48,000 chars */, night_done: boolean /* night role: that day's run already finished (the claim then ends its wake, night_done) */, provenance: 'owner'\|'outside' /* what this session's memory writes are labelled: 'outside' after its own taint, or one its claim took over from a session of its role tainted in the last 24 hours (MEMORY.md §7) */, tainted: boolean /* provenance === 'outside', its old name, kept one release from 2026-11-02 */ }`; `409 already_live` if another chat session holds the lease |
| `POST /v1/mind/status` | agents | `{ state: 'working'\|'listening'\|'stopping'\|'limited', thread_id?, note? /* ≤ 140 */, title? /* ≤ 60 */, using? /* ≤ 6 of {kind: fact\|song\|page\|source\|app, id?, label ≤ 40} */, error? }` | `204` (feeds the presence light and the working card, HOME.md §4.13; `working` acknowledges handed-out messages; a `working` or `listening` report within 3 s of the session's last accepted one in the same state changes nothing the phone sees) |
| `POST /v1/mind/notes` | agents | `{ id: Id, thread_id?, body /* ≤ 120 words */, open_items: {text, ref?}[] /* ≤ 10 */ }` | `201 { id, provenance: 'owner'\|'outside' }` (`outside`: written after outside text; its words are left out of later readers, MEMORY.md §7) |
| `POST /v1/mind/taint` | agents | `{ source: string /* tool name */, ref_kind?: 'url'\|'file'\|'comment' }` | `200 { tainted: true }`; irreversible for the session. The URL itself is not sent. Source `th music` (songs' tags) is an ordinary taint; the Worker also records it itself as it serves songs' tags to a mind session (MEMORY.md §7) |
| `GET /v1/mind/pending` | agents | — | `200 { unanswered: Id[], stop: boolean, day_closed: boolean, limited: boolean, idle_min: number, idle_cutoff_min: number, songs: boolean }` (the Stop hook; `songs`: this night session read songs' tags, from the Music object's record, which the PreToolUse hook reads to close the night's web, MUSIC.md §10.5; always false for chat and reflex). `idle_min`: whole minutes since the session's last owner message, or since its claim. `idle_cutoff_min`: 10 for a pre-warm wake with no owner message yet, else the owner's `mind.idle` setting (120) plus 15 min for every owner message today after the first, at most double the setting and never past 240 ([RUNTIME.md §4.6](../mind/RUNTIME.md#46-ending)). The hook counts its own blocks ([RUNTIME.md §6.2](../mind/RUNTIME.md)) |
| `POST /v1/mind/night` | `mind:night`, from a claimed night session | `{ day: Day /* closed, ≤ 7 days back */, action: 'start'\|'step_done'\|'cursor'\|'done', step?: number, cursor?: string /* ≤ 200, with cursor */, partial?: boolean /* only with done */ }` (steps: `shared/contract/night.ts`; `partial`: the hard stop cut the run and the remaining steps are recorded as skipped) | `200 { resume_from: number /* the first step not done; 14 once done (past every step's number) */, done: boolean, cursor: string \| null /* saved for resume_from */, skipped: number[] }` (`night_runs`; a step reported again or a start that changes nothing writes nothing; `done: true` when that day's run already finished, and the session ends at once); `409 conflict` with `details.resume_from` for a step ahead of the run, or `done` with steps left and no `partial`; `409 already_live` while another live night session moved the run in the last 20 minutes (one session works a run at a time; a crashed one stops counting after that); 422 for a day that isn't a real calendar date, an unknown step, a cursor on a step that keeps none, an open or older day; `403 session_required` from a session that never claimed, a made-up one or another role's, also on a run already done (whose answer ends only the asking night session) |
| `PUT /v1/mind/growth/:day` | `mind:night`, from a claimed night session | `{}` (night step 13, weekly; `th growth`) | `200 GrowthResponse { day, from, guitar, study: { sessions, tile: ledger id \| null, plan: ledger id \| null, reason }, rows_read }` (`shared/contract/growth.ts`): the week's counts (§11.14 `guitar_week`, `study_week`) and, for each book that moved, its place in the Library, then in Core the Briefing's `practice` and `study` tiles (one sentence of counts each) and tomorrow's plan and next passage through `guitar.set_plan` and `study.mark_next` (their permit and ledger rows), each its own commit; under 3 sessions an app gets nothing (`reason: quiet`); a refusal is that part's `reason` (`nudge_repeat` after the owner dismissed the tile); the same week again writes nothing; 422 for a day not closed or without a night run, 403 `session_required` from a session that never claimed |
| `GET /v1/mind/day/:day?part=stats\|messages\|ledger\|notes&cursor&limit` | `mind:night` | — | `200` `stats`: `DayStats` `{ day, from, to /* when the day was open: the rolls that opened and closed it */, messages, owner, mind, system, muse, ledger, notes }`; other parts: `Page<Message \| LedgerEntry \| SessionNote>`, oldest first, ≤ 200 a page (`limit` 1–200), the day's thread for messages and `[from, to)` for the ledger and notes; 422 for a day not closed yet; 400 for a cursor of another day or part |
| `GET /v1/mind/wakes?limit` | agents, device | — | `200 Page<{id, at, role, reason, status, fired_at, claimed_at, fire_status, fire_error, first_reply_at}>` (`first_reply_at`: the session's first reply to an owner message, so `fired_at` → `claimed_at` → `first_reply_at` is a cold wake's latency; `fire_status`: the routine's HTTP answer, 0 when none; `fire_error`: `http_<status>`, `timeout` or `network`; `reason` `watch` for a wake a watch fired, whose `{watch, kind, note, quiet?}` the wake row keeps as `reason_json`) |
| `GET /v1/mind/watches` | agents, device | — | `200 WatchesResponse { items: Watch[] /* the waiting ones first, then the last 24 h's others, ≤ 50 */, live, budget, used /* watch wakes in the logical day */, refused /* over the budget today */ }`; a `Watch` is `{id, kind: 'at'\|'event'\|'change', at, type, ref, why, note, provenance: 'owner'\|'outside', state: 'live'\|'queued'\|'fired'\|'over_budget'\|'cancelled'\|'expired', created_at, until, met_at, settled_at, by: 'wake'\|'event'\|null, wake_id}` (`shared/contract/watches.ts`). An `outside` watch (set after outside text) comes with `why` and `note` null to a mind session that read no outside text, and to a call with no `TH-Session` |
| `GET /v1/mind/usage` | agents, device | — | `200 UsageResponse { today: UsageDay, days: UsageDay[] /* the 7 before, newest first */, budget, live }`, `UsageDay = {day, wakes: {owner, watch, roll, schedule, watchdog}, minutes: {chat, night, reflex}, night_min, watches: {fired, refused}, latency: {replies, claim_s, reply_s}}`: the meter on Settings › The mind, counts only, in the owner's logical days. Wakes by cause (a retry is the same wake; a night claimed by its 06:07 schedule shows as `schedule`); minutes from the sessions' claims and ends (one that never said it ended counts to its role's limit: the chat's idle cutoff of 120 min after the owner's last message, the night's hard stop of 60, the reflex's 10); `night_min` the night shift's run that day, started to done; `latency` the cold wakes answered that day (chat wakes a message fired, or a requeue, whose session replied; a retry counts as the wake that got the claim) and the median seconds from the fire to the claim and from the claim to the first reply, null with none |

- `claim: true` binds the session to the open wake of its task and sets it `claimed` (`claim_match` `exact`, `loose` or `manual`), and creates its `mind_sessions` row. Every later request from the session carries `TH-Session: <session_id>`.
- The briefing's sections, order and truncation are owned by [RUNTIME.md](../mind/RUNTIME.md). The Worker truncates; the model never does.
- **Watches** (the day pulse, [RUNTIME.md §3](../mind/RUNTIME.md#3-triggers)) are set and cancelled with the `watch.set` and `watch.cancel` verbs (§11.11) and listed here; a claimed chat briefing's section 1 says `wakes today: 4 of 12, 3 watches live` and names each watch that woke it.

### 11.9 Ledger and undo

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `GET /v1/ledger?before_seq&limit&actor&status&since&kind` | device, agents | — | `200 Page<LedgerEntry>` | `since` (ms) reads through the time index; `kind=plan&since=<the day's start>` is home's read of today's plan lines |
| `PUT /v1/ledger/:id` | agents | `{ kind: 'deploy'\|'mistake'\|'note', what /* ≤ 200 */, why /* 8–500 */, ref?, topic_key? }` | `201 LedgerEntry` | For actions outside the Worker (a merged PR, a deploy, an admitted mistake). `undoable` is false for these |
| `POST /v1/ledger/:id/undo` | device; `mind:chat` for its own actions | `{}` | `200 { undo_ledger_id, status: 'undone' \| 'queued' }` | 409 `already_undone`; 422 `validation` with reason `not_undoable`; 410 `expired` after 30 days **[proposal]** |

- A Core-internal action (memory, surface, setting) is undone in the same transaction as its new `undo` ledger row (`status: 'undone'`).
- A phone action is undone by queueing its stored inverse verb (`status: 'queued'`). The original row becomes `undone` when that verb reports success. Asking again while the inverse waits returns the same `{undo_ledger_id, status: 'queued'}`; only a failed or expired inverse lets a new one be queued.
- A surface action is undone only while it is the newest state of its slot: undoing a write needs the slot to still hold it, undoing a clear needs the slot to still be empty; otherwise `409 conflict` (reason "a newer surface is in this slot").
- Verb and surface replies carry `ledger_id`, the row to undo: for a surface, its last write; for a verb, its `queued` row until the phone reports, then the outcome row (actor: whoever queued it), which holds the inverse.

### 11.10 Proposals (decisions)

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/proposals/:id` | agents, from a claimed session of the key's role | `{ class: ProposalClass, question /* ≤ 80 */, why /* ≤ 140 */, if_ignored /* ≤ 140 */, odds?: number /* 0.05–0.95; required for class permit (422 path odds) */, asked_by?: Id /* the owner's message that asked: outside the speech setting */, options: [string, string] /* each ≤ 20 */, safe?: 'reject'\|'snooze' /* default reject */, spec: ProposalSpec }` | `201 Proposal` (`status:'waiting'`, `expires_at` = +7 days, `spec_hash` = SHA-256 of the canonical spec, `show_from` = now or the end of the quiet hours it was made in, `target` = the Worker's line naming what a Yes changes); the same id and body again is `200` | 409 `decision_budget` (3 raised by agents already waiting); 409 `conflict` (another body under this id, or a card for the same thing already waits); 422 if `spec.op` is not in the executor map, its class is not one the op is filed under, its args don't match, what it names doesn't exist (no such fact; no active agent key with this id), or a text or button trips the phrase lint; 403 `forbidden` for an op this role may not raise (`by` in the registry), and for the `import-once` key; 403 `session_required`; 403 `session_tainted` for any ask-first class from a tainted session |
| `GET /v1/proposals?status=waiting\|all&limit&cursor` | device, agents | — | `200 Page<Proposal>`, newest first (`cursor`: the last id of the page before; `limit` 1–200, default 50); to `mind:reflex`, which reads no memory, a card about a fact comes without its words, buttons or target line | |
| `POST /v1/proposals/:id/decide` | device (tap); `mind:chat` with `by_message` only (the owner's own words) | `{ decision: 'approve'\|'reject'\|'snooze', spec_hash, by_message?: Id }` (`by_message` is required from `mind:chat` and refused from a device; `snooze` is the card's "Not yet": back at the next end of quiet hours, at most 3 times, the 4th expires it) | `200 { status: 'executed'\|'approved'\|'rejected'\|'waiting'\|'expired'\|'failed', result?, ledger_id }` (`approved` while an op of the Auth object has not reported yet; the 15-minute cron runs it again after 2 minutes; `failed` with `result.code` when the executor refused, which changes nothing); stores `decided_via` `tap` or `words` and `decided_message_id` | 409 `spec_mismatch`, 409 `already_decided`, 410 `expired`, 403 `not_owner_words` (also for a card only a tap decides: the laws pin), 403 `session_required` (`mind:chat` without its claimed session that holds the chat lease), 403 `session_tainted` (an approval recorded by a tainted session; a reject or snooze still goes through), 403 `forbidden` (another role, or the `import-once` key), 422 `validation` (`by_message` from a device, or missing from `mind:chat`) |
| `POST /v1/proposals/:id/cancel` | the creating agent, device | `{ why /* 8–200 */ }` | `200 { status: 'cancelled' }` | 409 `already_decided`, 410 `expired`, 403 `forbidden` (another agent's card, or the `import-once` key) |

- The card's parts and limits are owned by [BEHAVIOR.md §4](../mind/BEHAVIOR.md). The Worker validates them (check DEC-1).
- `spec.op` comes from one registry, `PROPOSAL_OPS` in `shared/contract/proposals.ts` (its classes, who may raise it, its args and where it runs), executed by the fixed map in `backend/src/areas/proposals/executors.ts`; [CONTRACT.md](CONTRACT.md#proposals) lists them. Built in P4 stage A: `memory.forget`, `agents.revoke` and `laws.pin` (the constitution pin, raised by the Worker itself); later stages add theirs (e.g. `ops.restore`). Free-form code or SQL is never executed.
- **The owner's words (DEC-2):** the cited message must be authored by the owner from a signed-in device (`origin=owner_device`), in the open day's thread (a "yes" left in yesterday's thread is overtaken by whatever the owner wrote today), sent after the card could first be seen (`show_from` at creation, so words written during its quiet-hours hold don't count), still the owner's latest message in that thread, and not already the answer to another card (one message, one card; a snooze in words uses its message too). Who records the words matters as well: only the claimed `mind:chat` session that holds the chat lease, and a tainted session may not record an approval. The laws card is decided by a tap only, so the mind never moves its own laws.
- **The target line:** the Worker writes each card's `target` from what its op acts on, never from the agent's words: `key <name> (<role>)` for `agents.revoke` (the key looked up in Auth, active keys only), `<kind>: <text>` for `memory.forget` (scrubbed with the card's other words when the fact is forgotten), the file and hash for `laws.pin`. The card shows it, so the owner sees what a Yes changes even when the question is worded otherwise.
- **Quiet hours** (`quiet.start` default 22:00, `quiet.end` default 06:30 and never earlier, both settings): a card made inside them is held until they end; the phone shows a waiting card only from `show_from`.
- **The constitution pin:** each claim's `constitution_sha256` is compared with the pinned hash (setting `laws.pin`). The first version and any later one the owner has not approved raise one Worker card (`laws.pin`, class `access`) per version; a session whose file differs from the pin may not write rules (`laws_unpinned`). The briefing's laws line says `pinned`, `not pinned (<why>; sha256 …)` (a card waits, its card expired, the owner said not now, or no card yet) or `CHANGED, NOT APPROVED`, with the instruction to restore the approved file after a "Restore it".
- A card whose op names something (`ref`, e.g. `fact:<id>`) is the only waiting card for it, and when the owner forgets that fact every card that named it loses its words (question, why, if-ignored, buttons and target line, however many cards; a waiting one is cancelled).
- Deciding writes a ledger row with `proposal_id` (and the message ref when decided by words). A waiting proposal turns the bottom light gold ([HOME.md](../product/HOME.md)). An owner chat "yes" decides only when `mind:chat` records it with `by_message` and the Worker's message check passes; nothing else in a conversation decides (check DEC-2, [BEHAVIOR.md §4](../mind/BEHAVIOR.md)). `th decide` ([RUNTIME.md](../mind/RUNTIME.md)) is the CLI for this call.

### 11.11 Verbs

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/verbs/:id` | `mind:chat`, `mind:night` | `{ verb, schema, args, why /* 8–200 chars, required */, ref?, device_id?, expires_at? /* default +24 h (from fire_at when scheduled) */, proposal_id?, fire_at? /* ISO, owner-local or with offset, ≤ 7 days ahead */ }` | `201 Verb & { permit, shifted? }` (200 on a same-body retry, with the permit it ran under); a Worker-side verb answers `status: 'done'` with its `result`; with `fire_at`, `status: 'scheduled'`, its `fire_at` (ms) and `shifted` ([below](#scheduled-actions)) | 403 `proposal_required` (reason `permit`) while the verb's standing permission is Ask or it has a floor, without an approved card for this call (below); 422 for an unknown verb or version, a verb that is not queueable (owner taps only, e.g. `app.open`, or only an undo, e.g. `music.unqueue`), or args that fail its schema, a `fire_at` that is not an ISO time in the next 7 days or names a `now_only` verb; 429 `too_many_scheduled`; a Worker-side verb's own refusal (below) as its area answers it, with nothing written |
| `GET /v1/verbs/pending?app` | device | — | `200 { items: Verb[] }` (for this device or any): without `app`, every open verb but the intents (home's loop); with `app` (an `APPS` id), that app's pending intents | 422 for an `app` that is not one |
| `POST /v1/verbs/:id/claim` | device | `{}` | `200 Verb` (`claimed`; the claim lasts 120 s) | 409 `already_claimed` |
| `POST /v1/verbs/:id/result` | device | `{ ok: boolean, result?: unknown, undo?: {verb, schema, args}, error?: {code, message?} }` | `200 Verb` | 410 `expired`; 422 if `result` or `undo` fails the verb's schemas |
| `POST /v1/verbs/plan` | `mind:chat`, `mind:night` | `{ id /* UUIDv7 */, steps: [{verb, schema, args, device_id?}] /* 2–8 */, why /* 8–200 */, what /* ≤ 80: its line on home */, ref?, fire_at?, proposal_id? }` | `201 Plan & { permit, shifted? }` (`status: 'done'`, each step's `verb_id`, `status` and `ledger_id`, and the plan's `ledger_id`; `scheduled` with `fire_at`); 200 on a same-body retry | as `PUT /v1/verbs/:id`, each step's path under `steps.<i>`; a step's refusal as its area answers it, with `details.step` (1-based) and `details.verb`, and nothing written; 403 `proposal_required` for the whole plan ([below](#plans)); 409 `conflict` for another body under the id |
| `GET /v1/verbs/scheduled` | device, `mind:chat`, `mind:night` | — | `200 { items: Verb[] }`: every `scheduled` row, soonest first (a plan as verb `plan.run`, its `what` and steps in `args`) | |
| `POST /v1/verbs/:id/cancel` | device; `mind:chat`, `mind:night` for their own | `{}` | `200 Verb` (`cancelled`; the same again answers the same) | 404; 403 `forbidden` (another actor's, from the mind); 409 `already_decided` once it ran (then its ledger row's undo applies) |
| `GET /v1/routines` | device, `mind:chat`, `mind:night` | — | `200 { items: Routine[] }` (at most 12, oldest approval first): `{id, name, what, why, when /* the condition in words */, condition, steps /* verbs */, on, permit, proposal_id, approved_at, next_at, last_run_at, last_ledger_id, last_undone, last_error}` | |
| `POST /v1/routines/:id/switch` | device; `mind:chat`, `mind:night` off only | `{ on: boolean }` | `200 Routine` (the same again answers it as it is); `403 forbidden` when the mind asks for on; `404` | |
| `DELETE /v1/routines/:id` | device | — | `200 {id, removed: true}`; `409 conflict` (`switch it off first`) while it is on | |

- Verbs are data in `shared/contract/verbs.ts` (class, executor, queueable, undo, versioned schemas for args and result); [CONTRACT.md](CONTRACT.md) lists them and each app doc lists its own. Adding one: [EXTENDING.md](EXTENDING.md).
- A phone that lacks a verb, or its schema version, answers `{ ok: false, error: { code: 'unsupported_verb' } }`: the verb is `failed` and its ledger row says so. New verbs never break an older phone.
- A verb that reports `undo` gets an undoable ledger row; undoing it queues the inverse verb, and the original row becomes `undone` when that inverse succeeds.
- A claimed verb that reports nothing within 120 s goes back to `pending` (at most 3 claims, then `failed`).
- **Where a verb runs** (`side` in `verbs.ts`). A Worker-side verb runs inside the commit that queues it, after the permit gate, through its area's own op (`backend/src/areas/verbs/worker.ts`): the answer is the verb already `done` with its `result`, and its ledger row keeps the inverse as `{op, args}` (`undo: 'stored'`), which `POST /v1/ledger/:id/undo` runs in place (`verbs/undo.ts`); an executor that changes nothing (the value is already set, the episode already played) leaves a row with nothing to undo. Its refusal rolls the whole call back: no verb, no ledger row, the approving card not used. A phone verb waits for a phone as above (`undo: 'reported'`). `memory.note` and `music.never` write memory's own row (`remembered a …`, undo `memory.close`), which becomes the verb's row (it carries `verb_id` and the permit).

| Verb | Side | Class (default) | Undo | Notes |
|---|---|---|---|---|
| `music.queue` | phone, intent (Music) | music (quiet) | reported: `music.unqueue` | `{refs ≤ 200, at: next\|end}`; songs that phone's library lacks come back as `missing` |
| `music.play_mix` | phone, intent (Music) | music | reported: `music.play_mix` with the queue before (≤ 500 songs and the place) | exactly one of `mix_id`, `find` (the route runs it in the Music object before the commit; nothing matching is 422), `refs`; the phone gets `refs` either way; loaded paused (MUSIC.md §10.3) |
| `music.rate` | phone, intent (Music) | music | reported: `music.unrate` (only while it is still that rating) | only a song the owner hasn't rated (`owner_rated`) |
| `music.never` | worker | music | stored: `memory.close` | a `music.never` rule through memory's ops; `evidence` must be the owner's messages (M3, M4); from a session that read outside text 422 `outside_rule` (M11c) |
| `music.mix_save` | worker | music | stored: `mix.delete` | the mix's id is the verb's; `GET /v1/music/mixes` |
| `podcasts.follow` | phone, intent (Podcasts) | podcasts (quiet) | reported: `podcasts.unfollow` | a show already followed has no undo |
| `podcasts.unfollow` | phone, intent (Podcasts) | podcasts, never below tell | reported: `podcasts.follow` | by `show_id` |
| `podcasts.queue_episode` | phone, intent (Podcasts) | podcasts | reported: `podcasts.unqueue_episode` | a followed show's newest episode, or `episode_id`, from the feed the app saved (`feed_not_saved`) |
| `podcasts.mark_played` | worker | podcasts | stored: `podcast.progress` (only while the mark is still the one written) | the phones take it with their positions on open |
| `reminder.move` | worker | reminders (tell) | stored: `reminder.move` back (only while still set at the new time) | chat only, clean session; an owner-set reminder needs `source_message_id`; quiet hours move when it rings |
| `settings.set` | worker | settings (tell) | stored: `setting.restore` (only while it still holds the value set) | a catalogued Worker key; never `mind.permit.*`, `mind.ask_outside`, `privacy.*` (403) |
| `briefing.pin_tile`, `briefing.unpin_tile` | worker | tiles (quiet) | stored: `setting.restore` of `briefing.pins` | `due`, `holidays`, a night slot; ≤ 3 pins, after "Waiting on you" |
| `memory.note` | worker | none: the owner's words only, never gated | stored: `memory.close` | a fact, source `user`, evidence the owner's messages (M3); `result: { fact_id, provenance }`: `owner`, or `outside` from a session that read outside text (it waits for the owner's keep, out of the profile); its undo closes the fact (it stops being current, as a supersede closes the old version); deleting it for good stays the owner's `forget` |
| `watch.set` | worker | none: the mind's own bookkeeping, never gated; each wake it fires counts against the wake budget | stored: `watch.cancel` (only while it still waits; 409 once it fired) | `{kind: at\|event\|change, at? /* ms, ≤ 7 days ahead, with at */, type? /* a sense type or reminder.fired, with event; work\|verb\|proposal\|prediction, with change */, ref?, why /* 8–200 */, note? /* ≤ 140 */}`; the watch's id is the verb's; `result: {watch_id, state, until}`. From a claimed session of the key's role (403 `session_required`), never one handed a message off the record (403 `off_record`); at most 20 wait (422); the budget at Off refuses it (422); an event's ref must be a kind its type carries (none for a sensitive type), a change's its own kind's; set after outside text, its words are `outside` |
| `watch.cancel` | worker | none (as `watch.set`) | stored: `watch.revive` (while its time has not passed and fewer than 20 wait) | `{id}`; 404 none, 410 `expired` once it fired, lapsed or was cancelled |
| `reminder.snooze_rule` | worker | reminders (tell) | stored: `setting.restore` of `reminders.snooze` | `{during: practice\|study\|watching\|work\|meals, from, to /* HH:MM local */}`, ≤ 3 (one per `during`); a reminder set or moved into a window rings at its end, one due inside lands with no push |
| `thread.file` | worker | titles (quiet) | stored: `thread.topic` (only while it still holds this topic) | `{thread_id, topic /* ≤ 40 */}` → `{previous}`; the menu shows the topic (Core step 37, `threads.topic`); 404 for a conversation off the record or deleted |
| `thread.title` | worker | titles (quiet) | stored: `thread.retitle` (only while it still holds this title) | `{thread_id, title /* ≤ 80, one line */}` → `{previous}`; as `PATCH /v1/threads/:id`'s title: 409 for one the owner named, 404 off the record or deleted, 422 `needs_owner_words` on law 8's topics |
| `memory.outside_keep` | worker | outside: always asks, whatever its position | memory's own row: `memory.reopen` (while the kept version is current) | `{fact_id}` → `{fact_id, provenance: owner}`: the owner's Keep of a current `outside` fact, asked in the chat; the approved card is the tap (M11e). Only from a clean session (403 `session_tainted`); 422 `not_outside`; 404 none |
| `muse.order_personal` | worker | muse, ask first (floor `reach_people`) | stored: `work.cancel` (while the order is open) | `{title /* ≤ 60 */, words /* ≤ 500 */, app?}` → `{order_id}` (the verb's id): a `muse.request` marked `personal`, 7-day deadline; clean session only (403 `session_tainted`), never-stored words 422, law 8 reads `words` |
| `astra.shortlist`, `media.shortlist` | worker | watch (tell) | stored: `surface.delete` or `surface.restore` | `{titles? [{ref, title}] 2–3, filters? ≤ 3}`: one of them; never a pick. Places `astra/tonight` or `media/tonight` (kind `shortlist`) |
| `study.mark_next` | worker | practice (tell) | stored: as above | `{book, left_off, next /* ≤ 60 */, page?}` → `study/next` (kind `passage`) |
| `study.pace_goal` | worker | practice (tell) | stored: memory's own (`memory.close`, or `memory.reopen` of the pace before) | `{pages /* 1–1000 a week */, evidence}`: the owner's messages (M3); now only; a goal under subject `study.pace`, replacing the one before |
| `guitar.set_plan` | worker | practice (tell) | stored: as for a shortlist | `{tab, sections [{key: '<a>-<b>', bpm 20–300}] 1–4, label?}` → `guitar/today` (kind `section`) |
| `music.create_playlist`, `shell.appearance` | phone | music, settings | reported | unchanged |
| `app.open` | phone | tiles | none | owner taps only |

- **The apps' arrangements** (batch 2; [BEHAVIOR.md §3.1](../mind/BEHAVIOR.md#31-rung-0-silent-arrangement)): the shortlists, `study.mark_next` and `guitar.set_plan` each place their app's one slot (`ARRANGEMENT_SLOTS` in `surfaces.ts`: `music/tonight` kind `mix`, `guitar/today` `section`, `podcasts/next` `episode`, `study/next` `passage`, `astra/tonight` and `media/tonight` `shortlist`; Music's and Podcasts' are placed with `PUT /v1/surfaces`) under the slot's own topic (`astra.tonight`), as the verb's ledger row (kind `arrangement`), with the verb's why as the why chip. The topic's 14-day quiet and 30-day rest apply; the speech setting does not (rung 0 is silent). The app reports it `arrangement.seen`, `arrangement.tap` (kept) or `arrangement.dismiss` (ignored) by its row, and the meter counts it as it counts home's lines.
- **Law 8 at the gate.** A verb with a class (every one but `memory.note`) whose why, or whose `topic`, `filters`, `left_off`, `next`, `label` or `during`, names prayer and faith, revelation, the owner's leaders, health or people (`LAW8_TOPICS` in `verb-spec.ts`) is refused before anything runs: `422 validation`, `details: {reason: 'needs_owner_words', topic, path}` (a plan's step: `steps.<i>.args`), whatever the permit says.

#### Scheduled actions

A verb queued with `fire_at` (an ISO time: owner-local with no offset, read in the owner's zone, or with its offset or `Z`; from a minute ago to 7 days ahead) is stored as a `scheduled` row and run by the Worker at that time, with the app closed and no session alive (`backend/src/areas/verbs/schedule.ts`, `due.ts`; MIND-PLAN §3.5):

- **The permit is checked when it is queued**, in that commit: `tell` and `quiet` answer with the permit; `ask` (or a floor) needs its card then, for exactly this call and its time (`call` is the schema, args and `fire_at` in ms). It runs at its time under that permit, whatever the setting says by then.
- **Limits:** at most 20 scheduled verbs and plans at once (the 21st is 429 `too_many_scheduled`); a verb marked `now_only` in `verbs.ts` (it rests on the session that asks: `music.never`, `reminder.move`, `memory.note`) is never scheduled (422).
- **Quiet hours:** a verb of class music or podcasts (`QUIET_HELD`) never fires inside them: one asked for then fires at their end, and the answer says `shifted: true` with that `fire_at`; one that comes due inside quiet hours set since moves to their end when it comes due.
- **When it runs**, Core's alarm (it wakes for the soonest scheduled row, as for a reminder; the 15-minute tick runs any it missed, 20 a pass) runs it in its own commit through the same path as at once: a Worker-side verb through its area's op, done with its ledger row; a phone verb or intent becomes `pending` from that moment (its expiry counts from `fire_at`, 24 hours by default). That ledger row is written then, and its `why` ends with when it was queued (`(queued 2026-11-03 14:02)`, the owner's time). One whose run fails is `failed` with its code, with a failed ledger row.
- **Its undo** until it runs is `POST /v1/verbs/:id/cancel` (`th verb cancel <id>`); nothing ran, so no ledger row is written. After it runs, the verb's own undo applies (`POST /v1/ledger/:id/undo`).
- `GET /v1/verbs/scheduled` lists what waits; phones never see a scheduled row (`GET /v1/verbs/pending` lists only `pending` and `claimed`).

#### Plans

A plan is 2–8 verbs with one why, one undo and one line on home (`POST /v1/verbs/plan`, `th plan <file.json> --why …`; `backend/src/areas/verbs/plan.ts`; MIND-PLAN §3.4):

- **Every step is checked against its spec first** (known, queueable, its version, its args), before anything is gated or runs.
- **The permit is the strictest position among the steps** (a floor first, then `ask` over `tell` over `quiet`), filed under that step's class, as the action `plan.run`: an `ask` anywhere makes the whole plan ask, with one `permit.allow` card for `plan.run` whose `call` is the steps' hash (`{steps: [{verb, schema, args}], fire_at?}`), filed under the strictest step's floor, else `permit`; the card's target line is `plan.run, once (a plan: its steps, one undo)`, so its question names the steps. The answer's `permit` is `{action: 'plan.run', class, position}`.
- **The steps run in order inside one commit**, each through the path it would take alone: a Worker-side step done with its own ledger row (`ref: plan:<id>`), a phone step (an app's intent) pending in order (`plan_id` on each). If a step fails, the commit rolls back, so the steps before it are undone with it (their changes, their rows, the card), and the answer is that step's error with `details.step` and `details.verb`.
- **One ledger row of kind `plan`**: `what` is the plan's line (home shows it as a line card with its Undo: today's rows of kind `plan`, `GET /v1/ledger?kind=plan&since=`, and the `plan` change kind reloads them), its undo keeps the steps' verb and ledger ids. `POST /v1/ledger/:id/undo` on it reverses the steps last first, each through its own undo (a Worker-side step in place, a phone step by queueing its inverse, `queued`); a step no phone has taken yet is taken back (`cancelled`); one a phone is applying right now is 409 `conflict` (try again); a step's refusal rolls the whole undo back, naming the step.
- **The follow-through rule** counts a plan once, when it runs, keyed by its line (`follow.plan:<what>`: the same evening plan every day is asked about once a week), in the first followed class among its steps; its steps never count on their own.
- **Later:** a plan may carry `fire_at` like a verb (it waits as one scheduled row, verb `plan.run`; it waits out quiet hours if any step is music or podcasts; no `now_only` step). When its time comes its steps run as above; one whose step fails is `failed` with `error.step`, a failed ledger row of kind `plan` names the step, and nothing of it stands.

#### Routines

A routine is a plan plus a condition that runs without a session under one standing approval (MIND-PLAN §3.6; `shared/contract/routines.ts`, `backend/src/areas/verbs/routines.ts`, `th routine`):

- **Only ever a card.** The mind raises a decision card of class `routine` (label "Runs on its own", odds required) with op `routine.propose`, whose args are the routine whole: `{id, name (≤ 40), why, what /* its line on home */, steps /* 1–8, as a plan's */, condition}`. The condition is one of `{at: 'HH:MM', days?: ['mon'…]}` (the owner's clock; every day without `days`), `{after: '<sense type>'}` (the first such event in the owner's day, or `reminder.fired`) or `{fact: '<id>'}` (an observed fact citing a routine of the senses: the start of its band of hours on its weekdays, read at the yes). Before the card exists the Worker checks every step as a plan's (known, queueable, its args, law 8 at the gate: `needs_owner_words`, over the steps, the name and line, and a fact's text), and refuses a step that runs only as asked (`now_only`), one behind a floor (it asks every time) and a Music find (a routine plays a saved mix or given songs). It writes the card's target itself: "Every day at 12:00: settings.set, briefing.pin_tile. Runs on its own until you switch it off."
- **The yes stores it** (a tap, or `th decide --by-message`): checked again, then `on` with its permit decided once, the strictest step's position as it stands then; at most 12 kept. Nothing is stored before the yes, and the card is used once.
- **Its runs** come from Core's alarm and 15-minute tick (the soonest `next_at`, kept in memory and read through `routines_next` after a `routine` change) or, for `after`, from a senses batch with a fresh event of its type (within the hour), at most once a logical day. Each run is one plan through `plan.run` in its own commit, as the role that proposed it, with no session and no wake: one ledger row of kind `plan` (its `what` is the line on home, its `proposal_id` the routine's card, its `permit` the stored position) and one undo. Music and podcasts wait out quiet hours (a time moves to their end; an event in them runs nothing). A run that fails rolls back; the routine keeps a short `last_error` (with the step, as a plan names it), a failed ledger row (kind `verb`, not a line on home) is written, and it comes again at its next time.
- **Off and Remove.** `POST /v1/routines/:id/switch` (`th routine cancel` for the mind, which may only switch one off); a routine that is off never runs. `DELETE /v1/routines/:id` removes one that is off. Settings › The mind › Routines lists them with the switch, the last run and its Undo (`POST /v1/ledger/:id/undo` on `last_ledger_id`). The brief's section 1 names those due today in one line.

#### Pending intents

Some state lives in an app, not in the Worker or home: Music's play queue and its ratings (the player's own storage), Podcasts' shows and Up Next (`jarvis.podcasts.v1`). A verb that changes it is a phone verb marked `intent` in `verbs.ts`, and its row in `verbs` is the pending intent: queued while the app is closed, never handed to home's loop (`GET /v1/verbs/pending` leaves intents out), and asked for by the app as it opens (`?app=music`, `?app=podcasts`). The app claims each one, applies it through its own operations and reports the result with its inverse, exactly as a device verb does, which clears it (`done`, or `failed` with its code); the ledger row, its Undo (whose inverse is an intent for the same app) and the follow-up rule work as for any phone verb. Music applies its intents once its library has loaded, whenever it comes back into view and every minute while it is in view, so a song queued while Music plays as home's island joins within a minute (`frontend/th/music/intents.js`); Podcasts applies its own in the same write as the positions it takes on open, before the app reads its storage, and reports them only once that write is saved (`frontend/th/podcasts/intents.js`, `progress.js`). An intent keeps the verb's expiry (24 hours, or `expires_at` up to 7 days); one no app opened for by then expires and its ledger row says so.

#### Standing permissions

The owner decides, per class of action, how the mind may act on their things (Settings › The mind, `mind.permit.<class>`); the Worker enforces it at each write the mind makes, inside that write's commit and before it writes (`backend/src/areas/mind/permit.ts`). The classes, their defaults and the actions in each are data in `shared/contract/permits.ts` (a verb names its class in `verbs.ts`; [CONTRACT.md](CONTRACT.md#standing-permissions) lists them all).

| Position | The Worker | The mind |
|---|---|---|
| `quiet` | Does it | Mentions it only if asked |
| `tell` | Does it | Says in its reply what it did |
| `ask` | Refuses it without an approved card for exactly this call | Raises the card the refusal names, then sends the same call again with the card's id |

- **Gated writes** (from `mind:chat` and `mind:night`; the owner's own are never gated): `PUT /v1/verbs/:id` (the verb's class), `POST /v1/verbs/plan` (the strictest step's, as `plan.run`), `PUT /v1/surfaces/:app/:slot` (`tiles`), `PATCH /v1/threads/:id` (`titles`), `PUT` and `DELETE /v1/reminders/:id` (`reminders`), `PUT /v1/work/orders/:id` (`muse`). Clearing a surface and cancelling a Muse order only take back the mind's own act and are not gated; the mind's bookkeeping (notes, open threads, song notes, predictions, the night's run) is no class, and neither is `memory.note` (the owner's own words only, which memory's M3 checks), so it is never gated. A Worker-side verb runs after its gate, in the same commit. A verb marked `tell_min` (`podcasts.unfollow`: it takes away something the owner chose) is never below `tell`: under `quiet` it runs, and answers, as `tell`.
- **Floors** no setting lowers, marked by hand on the action (`floor`), never inferred from its name: `money`, `delete` (the owner's data), `access` (keys, access, sessions), `reach_people`. An action with a floor always asks, and its card is filed under that floor's class. Today they are `muse.order_personal` (a kind of order that carries the owner's data) and any `ask_first` verb; the proposal ops are cards already. `POST /v1/auth/breakglass` is left out on purpose: it is the way back in when the owner can reach no device to answer a card, and its own ask is the fingerprint in their words, the 24-hour wait and the notice on every device.
- **The answer** of a gated write carries `permit: {action, class, position}` beside its record (`Permitted<T>` in `actions.ts`), and the ledger row it writes (verbs, surfaces) carries `permit` (`LedgerEntry.permit`), so what the mind was to tell the owner can be found again. Reminders, titles and orders keep no ledger row; their position is in the answer only.
- **The refusal** is `403 proposal_required` with `details: { reason: 'permit', action, class, position: 'ask', floor, card: { class, spec: { v: 1, op: 'permit.allow', args: { action, call } } }, given? }`: `call` is the SHA-256 of the action and its canonical call (a verb's schema and args; a surface's slot, kind and payload; a reminder's words and time; an order's kind, title and spec; never an id or a why). `given` says why a named card didn't count: `not_found`, `waiting`, `not_approved`, `used`, `expired`, `other_call`.
- **The card:** `PUT /v1/proposals/:id` with `card.class` (the floor, else `permit`, "You said to ask") and `card.spec`; the Worker's target line is `<action>, once (<class label or floor>)`. Approving it records the yes (`executed`); the same call sent again within 7 days naming the card (`proposal_id` in a verb's body, the `TH-Proposal` header elsewhere; `th … --proposal <id>`) goes through once and uses the card up (`result.used_by`), in that write's own commit.

### 11.12 Surfaces

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/surfaces?since_seq=` | device, agents | — | `200 { items: Surface[], seq }` (non-expired, changed after `since_seq`) |
| `PUT /v1/surfaces/:app/:slot` | `mind:chat`, `mind:night` | `{ kind, schema, payload /* ≤ 16 KB */, why /* 8–200 chars, required */, topic_key /* slug */, ref?, expires_at?, facts?: Id[] /* ≤ 20; every fact it draws on (a `fact:` ref counts too); 422 `validation` reason `muted_fact` if one has may_raise = 0, `outside_fact` if one is labelled outside (MEMORY.md §6 M11b), `unknown_fact` if one does not exist, 422 `too_sensitive` if one is sensitivity 1 */ }` | `200 Surface` (+ a ledger row); `409 nudge_repeat` if the topic was ignored in the last 14 days; margin notes over 140 characters → 422 |
| `DELETE /v1/surfaces/:app/:slot` | device, `mind:chat`, `mind:night` | — | `204` (+ a ledger row) |
| `POST /v1/surfaces/topics/:key/reopen` | device (a tap), `mind:chat` (the owner's words) | `{}` from a device; `{ by_message: Id }` from the chat, checked as a card's words (the owner's message from a device, in the open day's thread, after the topic went quiet, their latest there; the chat session holding the lease, never tainted) | `200 { topic_key, ledger_id }`: the topic no longer rests and its streak starts again; 404 no such topic; 409 `conflict` (reason `not_resting`); 403 `not_owner_words`, `session_tainted`; 422 `by_message` missing from the chat or sent from a device |
| `POST /v1/surfaces/topics/:key/said` | `mind:chat`, `mind:night` | `{}` | `200 { topic_key, said_at }`: the mind said, once, that the topic went quiet (the briefing stops asking); 409 `already_said`; 404 when it does not rest |

What lands (built 2026-11-04, BEHAVIOR.md §3.6): `PUT` also answers 422 `topic_quiet` for a topic that rests and 422 `speech_budget` when the owner's speech setting (`mind.speech`: quiet, silent) holds a line or a tile back; `asked_by?: Id`, the owner's message from a device in the last 48 hours that asked for it, makes it a reply (never held, never counted; 422 `validation` when it is not such a message). The same `asked_by` and the same refusal hold `PUT /v1/proposals/:id` (quiet: 1 card a day) and `PUT /v1/pushes/:id` (quiet: only an asked one; silent: none).

`why` is required on every surface, so the owner can always see why something is there. `kind`, `schema`, the slot and the payload are validated against `shared/contract/surfaces.ts` (P2: kind `line` in `home/line.1`–`line.4`, ≤ 44 characters ending with a full stop, no exclamation marks or emoji; P8: kind `tile` in `briefing/practice`, `study`, `built`, `note.1`–`note.3`, BRIEFING.md §2's limits, an optional `app` + `path` inside that app; without `expires_at` it leaves the Briefing after a day). A phone without a renderer for a kind or version shows the generic card with the `why`. The `nudge_repeat` rule reads the `topics` row of `topic_key`.

### 11.13 Memory

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/memory/facts?kind&subject&include_superseded&limit&cursor&outside` | device, `mind:chat`, `mind:night` | — | `200 Page<Fact>` (newest first; current versions unless `include_superseded=true`; each with `confidence_now`, the decayed value at read time, and `ledger_id`, the row that wrote it). To a mind session a fact labelled `outside` comes kept back (`text` `(outside, kept back)`, no subject or tags) unless `outside=1`, which first marks the session as having read outside text (MEMORY.md §6 M11f; 422 without `TH-Session`, 403 `session_required` for an unclaimed one) |
| `GET /v1/memory/facts/:id` | device, `mind:chat`, `mind:night` | — | `200 { fact: Fact, history: Fact[] /* earlier versions, newest first */, evidence: {ref, kind, at, who, text}[] /* text: the start (≤ 280) of the message or day note cited */, why: string \| null /* the ledger row that wrote this version */ }`; 404 when it was never there or was forgotten. `?outside=1` as for the list: to a mind session that did not ask, its `outside` versions, a cited day note an outside session rewrote, and the `why` of an outside version are kept back |
| `POST /v1/memory/ops` | device, `mind:chat`, `mind:night` | `{ batch_id: Id, ops: MemoryOp[] /* ≤ 50 */ }` | `200 { applied: {i, fact_id, ledger_id, provenance}[], proposals: {i, proposal_id}[], rejected: {i, reason}[] }` (`provenance`: the label of the version written or confirmed, MEMORY.md §6 M11). Before the batch the route has the Senses object count each `rollup:` ref it cites again (`routineRef`, at most 20; MEMORY.md §6 M5) |
| `GET /v1/memory/profile` | device, `mind:chat`, `mind:night` | — | `200 { text: string /* ≤ 1,500 tokens */, fact_ids: Id[] /* each line's fact, in line order */, private_ids: Id[] /* the private lines' facts, which a screen blurs until tapped */, rendered_at: Ms }` |
| `GET /v1/memory/day-notes?from&to&outside` | device, `mind:chat`, `mind:night` | — | `200 { items: DayNote[] }` (to a mind session one labelled `outside` comes kept back, its summary `(outside, kept back)`, unless `outside=1`, as for search) |
| `PUT /v1/memory/day-notes/:day` | `mind:night`, device (the owner's edit, `written_by: 'owner'`) | `{ summary /* ≤ 150 words */, decisions: string[] /* ≤ 10 */, importance: 1-10 }` (`stats` is computed by the Worker) | `200 DayNote` (`provenance` `outside` when written after outside text: shown marked, never evidence; `version` + 1; the same body again keeps the version, so a rerun night step never writes version 2; once the owner edited a day, the night's write returns the owner's version unchanged with `kept_owner_edit: true`; a future day is 422; 403 from a tainted or unclaimed session) |
| `GET /v1/memory/open-threads?status=open\|all&outside` | device, `mind:chat`, `mind:night` | — | `200 { items: OpenThread[] }` (kept back to a mind session unless `outside=1`, as for day notes; the owner's Done or Drop keeps a loose end's `outside` label) |
| `PUT /v1/memory/open-threads/:id` | device, `mind:chat`, `mind:night` | `{ text, owner: 'mind'\|'owner', due_at?, evidence: Ref[] /* 1–20 existing refs; a device may send none */, tags?: string[], status?, why? /* ≤ 200; stored as closed_why; required when status is dropped */ }` | `200 OpenThread` (the same body again changes nothing; `provenance` `outside` when written after outside text) |
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

- Each op is validated on its own. The valid ops apply together in one transaction; invalid ops change nothing and are listed as `rejected: {i, reason}[]` in the `200` response. If every op is rejected, the response is `422 validation` with `details: [{path: 'ops.<i>', issue: <reason>}]` instead (`403 laws_unpinned` when that is the only reason), so a single-op call such as `th remember` fails loudly (`th` prints the details). From a device principal `evidence` may be empty: the Worker uses the op's own ledger row (`ledger:<id>`, `actor=owner`) as the evidence ([MEMORY.md §12](../mind/MEMORY.md)), and a device's `add` and `supersede` are always `source: 'user'`. A mind write needs `TH-Session`.
- Reasons are MEMORY.md §6's codes (`bad_evidence` for evidence that is missing, malformed or of a kind memory can't cite yet (events before P5); `import:<id>` cites a raw imported document (`import_items`), never as the owner's words, `not_owner_evidence`, `rule_needs_owner`, `too_little_evidence`, `tainted_evidence`, `needs_owner_words`, `too_long`, `outside_rule`, `outside_supersede`, `outside_confirm` (M11c, M11e: a session that read outside text writes labelled `outside`, never refused for it, but it can't make or replace a rule, replace what the owner said, or confirm), `laws_unpinned`, `never_stored`, `off_record_evidence`, `deleted_evidence`), plus the Worker's: `bad_op` (shape), `unknown_ref` (the fact the op names does not exist), `superseded` (it was replaced; work on its newest version), `duplicate_id`, `device_only` (pin, may_raise and forget) and `proposal_required`. `shared/contract/memory.ts` lists them ([CONTRACT.md](CONTRACT.md)).
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
- Response `200 { accepted: number, rejected: { i: number, reason: 'bad_type'|'bad_time'|'too_large'|'bad_ref'|'bad_id'|'bad_data'|'switched_off' }[] }`. Invalid events are dropped and reported; the batch still counts as stored, so the outbox deletes it.
- **The event list is the contract** (B1, 2026-11-02): `SENSE_TYPES` in `shared/contract/senses.ts`, generated as the table "Senses" in [CONTRACT.md](CONTRACT.md#senses). Each type names its app (whose privacy switch holds it), the ref kinds it may carry, its only `data` fields (ids, numbers, times; an enum is a list of words, never free text) and its sensitivity. A type not on the list is `bad_type`; a field not on its line, or a value of the wrong kind, `bad_data`; a ref of another kind, `bad_ref`. A type's sensitivity is a floor: the phone may raise it, never lower it.
- **Privacy switches** (`privacy.senses.<app>`: `music`, `podcasts`, `guitar`, `study`, `media` for Astra and My Media, `home` for what the mind says on home, `shell` for the ring, the island, app opens and settings; on by default): the phone sends nothing of an app switched off, and the Worker keeps nothing of it (`switched_off`, within a minute of the change), its `music.rate` ratings included.
- `type` matches `^[a-z]+(\.[a-z_]+)+(\.v\d+)?$`. `at` must be within [now − 30 days, now + 5 min]. `data` ≤ 2 KB per event.
- 409 if the same `batch_id` arrives with a different body.

| App | Types (fields in CONTRACT.md) |
|---|---|
| Music | `player.open`, `music.play`, `music.skip`, `music.finish`, `music.rate` |
| Podcasts | `podcasts.open`, `podcast.play`, `podcast.finish`, `podcast.skip`, `podcast.follow`, `podcast.unfollow` (`podcast:<show id>/<episode id>`; the show's id is the hash of its feed) |
| Guitar | `guitar.open`, `guitar.piece_opened`, `guitar.pass`, `guitar.bpm`, `guitar.session` (minutes as `seconds`, the sections marked, the tempo reached as `bpm`) |
| Study | `study.open`, `study.read` (`pages`, `ms`), `study.search` (`hits` only), `study.highlight` (sensitive; nothing sends it yet) |
| Photos | `photo.import` (`format`, `source` `phone`\|`drive`), `photo.delete`, `photo.rate` (`rating`, `favorite`, `flag`); ref `photo:<id>`, never a name or a pixel; `photo.paste` (`count` and a switch per panel), no ref; `photo.look` (`source`, `panels` a count), no ref |
| Astra, My Media (`media`) | `astra.open`, `mymedia.open`, `media.watch` (`ms`), `media.finish`, `media.drop` (`astra:…` or `media:<id>`; read from each app's own progress by `th/senses/watch.js`) |
| Shell | `app.open`, `app.close` (`ms` in front), `ring.choice`, `island.tap` (`to`), `briefing.open`, `settings.change` (`setting:<key>`, never the value) |
| Home | `briefing.tile`, `line.seen`, `line.dismiss` (nothing sends it yet), `card.decide` (sensitive; the class only), `reply.open_chip` |

**`POST /v1/senses/query`** · Who: agents
- Request `{ name: string, params: Record<string, unknown> }`. `name` comes from a fixed map (`counts_by_day`, `top_refs`, `sequence`, `last_event`, `day_summary`, `routines`, `guitar_week`, `study_week`) in `areas/senses/queries.ts`, each with checked parameters (422 names the bad one). Never SQL.
- Response `200 { rows: unknown[], rows_read: number }`. A sensitivity-1 event shows its type and time only, never its ref or data. The eval sandbox has no senses (422).
- **`routines`** `{ type? | app?, to?: Day }` (B1): when the owner does things, counted, never guessed (`areas/senses/routines.ts`, the rule as data in `ROUTINES`). Over the 28 logical days ending on `to` (today's by default), each event of the type (or of every type of the app, or of every type) falls in a cell: the weekday of its logical day (it turns at 04:00) and the hour of the owner's clock. For a band of 1 to 3 hours, a weekday takes part when its cells in the band hold events in 2 or more different weeks; the band is a routine when those days hold 10 or more events in 3 or more different weeks. The densest bands that don't overlap are kept (3 a type, 20 in all). Rows: `{ type, weekdays: ['mon',…], hour_from, hour_to /* exclusive */, n, weeks, ref }`, the `ref` being `rollup:routines/<type>/<weekdays>/<from>-<to>/<to day>`, which the Senses object counts again (`routineRef`) while the window's events are kept: the evidence an `observed` fact of kind `habit` cites (MEMORY.md §4, rule M5). `th day` asks it for the night (RUNTIME.md §12 step 1).
- **`guitar_week`**, **`study_week`** `{ to: Day }` (2026-11-04, `areas/senses/week.ts`, `shared/contract/growth.ts`): a week of practice and of reading, the 7 logical days ending on `to`, sensitive events left out, one row each. Guitar: sessions, minutes, days, and each song's sections (the ladder's key and the printed bars) with the best clean tempo of the week, the best of the 28 days before (`guitar.bpm`), the BPM a new best gained over it and whether a clean pass came at full tempo (`speed_pct` ≥ 100); a song whose id holds a title's words is `outside: true`. Study: stints that moved a page, pages, minutes, days and books moved, each book by its id. `th guitar week`, `th study week`; night step 13 reads both (`PUT /v1/mind/growth/:day`, §11.8).
- Built in P5 (`backend/src/objects/senses.ts`, `areas/senses/`; `SENSE_LIMITS` and the queries in `shared/contract/senses.ts`). A `music.rate` event (ref `music:<id>`, `data.rating` 0–5) that passes the same check (re-checked on each pass, so a replay answered from the batch's record lets nothing refused slip in) is also handed to the Music object, which keeps each song's newest rating for good, as of no later than now (MUSIC.md §10.5); a failure there answers 5xx and the phone's retry of the sealed batch hands it over again. Each accepted event lands on the owner's logical day with its rollup (`n`, and `sum_ms` from `listened_ms`, `duration_ms` or `ms` in its data). The same batch id with the same bytes answers `{ accepted, rejected: [] }` again and stores nothing; also rejected: `bad_id` (not a uuidv7). Core's 15-minute tick archives each finished day (the last 31) to `thunderhead-private/senses/<day>.jsonl.gz` with its SHA-256, writes it again when a late event arrives, and prunes events past 90 days once their day is archived (batch records after 30 days). The phone sends the types above (`frontend/th/senses/send.js`, signed in and top-level or in home's own frames, never for an app switched off as the phone last saw the settings, `th.p.settings`): `<app>.open` from the ported pages' shared reporter and from Study, the apps' own from their modules, and the shell's and home's from `th/senses/shell.js`, which hears what home already shows (the ring's chosen disc, the island's `th:app-ready` and `data-island`, the Briefing's `inert`, Settings' `th:setting`, a home line's card on screen, a chip's `data-app`). They wait in `localStorage` (at most 200) and go as one sealed batch, retried with the same bytes until taken, one tab at a time (Web Locks).

### 11.15 Media

**`POST /v1/media/sign`** · Who: device; agents for `book:` and `file:` refs · P5 (P2 for `file:`)
- Request `{ refs: Ref[] /* 1–50 */ }`.
- Response `200 { items: { ref, url, expires_at }[], errors: { ref, code: 'not_found'|'not_signable' }[] }`.
- Signing time (`X-Amz-Date`) is floored to the hour, and every URL expires 3 h after that, so it is valid for at least 2 h and identical within the hour (browser caching works). The client re-signs on a 403.
- Ref → key mapping is in [DATA.md §7.4](DATA.md#74-media-ref--key-map-used-by-post-v1mediasign). Bucket keys never appear in requests.
- Never put a signed URL in the address bar, history or logs.
- Built in P5 step 2 (`backend/src/areas/music/sign.ts`, SigV4 on WebCrypto, checked against AWS's own presigned-URL example): `music:<id>` (the track's audio) and `music:<id>#art` (its cover) for the device; from P7, `book:<id>` (the PDF in `thunderhead-private`, once its upload is whole) for the device and the mind; a mind's music ref, and every `file:` ref, is `not_signable` (chat files are never signed: they are read through `GET /v1/files/:id`, §11.7); an unknown track, or art for a track without a cover, is `not_found`. `503 not_configured` until the owner sets the read-only signing token (`R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET`, [SETUP.md N1](../process/SETUP.md)); the account's R2 host comes from the deploy's `CLOUDFLARE_ACCOUNT_ID` (`R2_ACCOUNT_ID`).

### 11.16 Ops

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/ops/errors` | device, agents | `{ items: { fingerprint?, source: 'client'\|'csp'\|'job', route?, code, message /* ≤ 300 */, build: number, at: Ms, count?: number }[] /* ≤ 50 */ }` | `204` |
| `GET /v1/ops/errors?status=open\|resolved&since&limit` | device, agents, `ci` | — | `200 Page<ErrorRow>` (`since`: only errors last seen at or after it, ms) |
| `POST /v1/ops/errors/:fingerprint/resolve` | device, `mind:chat`, `mind:reflex` | `{}` | `204` |
| `POST /v1/ops/perf` **[proposal]** | device | `{ day: Day, build: number, metrics: Record<'inp'\|'loaf_gesture'\|'start_warm'\|'start_cold'\|'api_ms'\|'heap_mb', {p50, p75, p95, n}> }` (one call per day) | `204` |
| `POST /v1/ops/reports` | device | `{ kind: 'playback', body: JsonObject /* ≤ 32 KB */ }` (`ReportRequest`, `shared/contract/reports.ts`) | `201 { id, at }`; `413 too_large`; `429 rate_limited` after 6 from this device in 5 minutes, with `retry_after` (s) and `Retry-After` |
| `GET /v1/ops/reports?kind&since&limit&cursor` | device, `mind:chat`, `mind:night`, `mind:reflex` (never `ci`: a batch is listening history by track id, and CI's logs are public) | — | `200 Page<{ id, kind, device_id, at, body }>`, newest first (`kind`: one kind, else all; `since`: taken at or after it, ms; `limit` 1–200, default 50) |
| `GET /v1/ops/meter?days=1-30` | device, agents, `ci` | — | `200 { items: { day, class, rows_written, rows_read, bulk_rows_written }[], today: { day, rows_read, rows_written, read_pct, written_pct, pct, hold_until } }` (`MeterResponse` in `shared/contract/meter.ts`). The stored per-day meter ([DATA.md §3](DATA.md#3-shared-machinery-in-every-class)): Core asks each object for its day (at most once a minute; otherwise it reads what is stored), then reads its `meter_days` (today's own row raised to Core's live count), a row per class (`core`, `auth`, `music`, `senses`, `library`, and `scratch` for what a drill wrote into its scratch copy) and UTC day, newest first, `days` of them (default 1). `today` is the day's use against its budget: the Free plan's 5,000,000 rows read and 100,000 written less the old Worker's share (200,000 and 32,000, `OLD_WORKER_RESERVE`), percentages rounded down, `pct` the higher; `hold_until` is the next 00:00 UTC from 80% on (the heavy work waits, [DATA.md §8.1](DATA.md#81-the-limits-that-bind)), else null. `bulk_rows_written` is 0 (the lane is counted in `settings`) |
| `POST /v1/ops/backups/run` | `mind:night`, `ci` | `{ class?: 'core' }` | `202 { job_ids: Id[] }` (built P4 stage E; the one running is answered again; the Worker's tick also starts one each Sunday at 02:30 local) |
| `GET /v1/ops/backups?limit` | device, agents, `ci` | — | `200 Page<{date, class, rows, bytes, complete, started_at, finished_at}>` (counts only; `BackupItem` in `shared/contract/backups.ts`) |
| `POST /v1/ops/restore` | device, agents | `{ kind: 'pitr'\|'table'\|'object', class, at?: Ms, date?: Day, table?: string, mode?: 'replace'\|'merge' }` | `202 { proposal_id }` (it executes only when decided `approve`) [not built yet: after the drill has passed live] |
| `POST /v1/ops/drill/run` | `mind:night`, `ci` | `{}` | `202 { job_id }` (built; the newest complete backup; 409 with none; the tick also starts one on the first Sunday of a month after that day's backup) |
| `GET /v1/ops/watchdogs` | device, agents but Muse, `ci` | — | `200 { items: { name, state: 'ok'\|'tripped'\|'later', severity, slo, trips, since, detail, handled: {at, outcome, note} \| null, waits }[] }` (P4; never in the eval sandbox) |
| `POST /v1/ops/watchdogs/:name/handled` | `mind:chat`, `mind:night`, `mind:reflex` | `{ outcome: 'fixed'\|'reported'\|'nothing', note /* 8-200 */ }` | `200` the watchdog; `409` when it isn't tripped (a ledger note) |
| `POST /v1/ops/watchdogs/:name/drill` | device, `mind:chat` | `{}` | `200 { item, wake_id, fired: 'fired'\|'failed'\|'limited'\|'not_connected' }`; `409` tripped already; `422` not built or wakes nobody (OPERATIONS.md §8.2) |
| `POST /v1/export` | device | `{ password }` (the password again; throttled like every check of it) | `202 { export_id }`; `401 current_password_wrong`; `409` while another device's export is building (built P4 stage F) |
| `GET /v1/export/:id` | the device that asked | — | `200 { status: 'building'\|'ready'\|'failed'\|'expired', progress /* 0-100 */, items: { label, url, bytes, expires_at }[], last_backup: {date, finished_at} \| null }`; `404` for any other session |
| `GET /v1/export/:id/zip` | the device that asked | — | `200 application/zip`, streamed from the bucket, for an hour after it was ready; `404` after |

`message` fields are scrubbed by the server too (URLs with query strings and token-shaped strings are removed).

**Reports** (NEXT-BATCH.md part 1). The phone sends a small batch about how an app ran, and each batch is one row in Core's `reports` table ([DATA.md §4.1](DATA.md#41-settings-ops-the-feed-and-the-minds-bookkeeping)), kept 30 days. Today's one kind is `playback`: Music's playback log since the batch before (`frontend/th/music/report.js`; the body is described in [MUSIC.md §5.10](../product/apps/MUSIC.md)), sent once a minute while music plays and once when the page is hidden, only by a signed-in top-level page. Timings, counts and track ids only, never titles, artists, file names or words. A batch may hold only the known fields of its kind (`PLAYBACK_BATCH`, `PLAYBACK_EVENTS` per event type, `PLAYBACK_STATE` in `shared/contract/reports.ts`): the phone sends only those, and the Worker keeps only those again (`cleanReport`), dropping any other field and any value of the wrong kind; an unknown event type is kept as `other` with no fields. Every text (a browser's or the engine's own message) keeps of an address only its host (any scheme, any case, a user and password dropped, the whole path dropped even with spaces in it, percent-encoded ones too), loses quoted text and `/patterns/` (`…`) and any session or key token, and is at most 160 characters (`REPORT_LIMITS.text_max`). Each event carries its number in the page load (`n`) and each batch the page's id (`page`), so an event sent twice (a batch the Worker kept whose answer was lost goes again) is told apart; `th reports` counts it once. The phone sends one batch at a time, and sends the same events again only after no answer (15 s), 408, 429 or 5xx, waiting a minute, then 2, 4 … 30 (or `Retry-After`); after 401 or 403 nothing goes until the session changes. A batch costs one row written and none read; a list reads the rows it returns and passes each batch's stored JSON on unparsed. Why a new route and not `POST /v1/ops/perf`: perf keeps one summary per metric per day (p50, p75, p95), which can't hold what happened when; a report keeps the events themselves, for a later look at one bad minute.

### 11.17 Import

| Route | Who | Request | Response |
|---|---|---|---|
| `POST /v1/ops/import/parts` | the `mind:chat` key named `import-once` only | raw gzip JSONL part, sent as the old export answered it; headers `TH-Import: <run_id>/<instance>/<table>/<nnnn>` (from `0001`), `TH-Sha256`, `TH-Rows` (≤ 2,000 rows, ≤ 25 MiB; the route holds the part in memory once and reads only its first row's names, from 64 KiB slices) | `201 { key }` (idempotent by the header path; 409 if the bytes differ; 422 on a wrong digest; 415 if not gzip JSONL; 403 for a never-exported table, by its name or a credential column in its first row, `IMPORT_NEVER_EXPORT` and `IMPORT_SECRET_COLUMN` in `shared/contract/imports.ts`) |
| `PUT /v1/ops/import/manifest/:run_id` | the `import-once` key only | the manifest JSON ([MIGRATION.md §3](MIGRATION.md); `ImportManifest` in `shared/contract/imports.ts`) | `201` (the same again is fine; another one 409). Written last: every part it names must be stored with its SHA-256 (422 naming the first that is not), one SHA-256 per part, and a never-exported table has counts only (403 with parts) |
| `POST /v1/import/runs` | device, or the `import-once` key | `{ id: Id, run_id: string, dataset: 'threads'\|'messages'\|'notebook'\|'muse'\|'board' (never built: the Board was cut)\|'chat_files'\|'music'\|'music_log' }` | `202 { import_id }` (422: a dataset not built yet, a run without a manifest or that table, messages before threads or the music log before the music are done; 409: the id names another run, or the dataset is already running) |
| `GET /v1/import/runs/:id` | device, agents | — | `200 ImportStatus { id, run_id, dataset, state, counts: { expected, imported, skipped, skip_reasons, files_waiting }, report: { spot_checks: {seed, checked, passed, failed}, thread_shapes: {checked, failed} \| null, rows_changed, rerun_delta } \| null, last_error, started_at, finished_at }` |
| `POST /v1/import/phone` | device, from the new site's `/import/` page only (P1b) | `{ id: Id, chunk: number, chunks: number, exported_at: Ms, data: Record<string, unknown> }` (`data` = the `th-phone-export/2` file), gzip, ≤ 5 MB per chunk ([MIGRATION.md §5.3](../archive/MIGRATION.md#53-the-two-pages)) | `201 { import_id, counts: Record<string, number> }` (after the last chunk) |

Data mechanics and proof rules: [DATA.md §12](DATA.md#12-importing-the-old-data). The plan: [MIGRATION.md](MIGRATION.md). Without the private bucket's binding (`VAULT`) the parts, the manifest and a new run answer `503 not_configured`; a run's status still reads.

### 11.18 Jobs: the listening pass (P5)

Built 2026-11-01 ([JOBS.md §3](JOBS.md#3-actions-jobs-the-listening-pass)). Kinds: `audio.analysis` (result schema v2, ≤ 500 songs a job) and `audio.neighbours` (once every song is analysed). Types and schemas: `shared/contract/listen.ts`.

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /v1/jobs/next?kind=audio.analysis&max=1-500` · `?kind=audio.neighbours` | `mind:night` | — | `200 { job_id, kind: 'audio.analysis', v: 2, shas: string[], expires_at }` or `{ job_id, kind: 'audio.neighbours', v: 1, n, expires_at }` (no hashes); `204` when nothing is due; `409 {reason: 'open_jobs'}` with two jobs of the kind open; `429 {reason: 'daily_jobs'}` after three of the kind in 24 hours; `429 {reason: 'daily_quota'}` (with `Retry-After`) from 80 % of the day's database budget until 00:00 UTC. Songs in catalog order, one per audio hash, native Opus only, never one already in an open spec; a song failed 3 times at this analyzer version is left out. Issuing prunes jobs finished over 90 days ago and expires specs past 72 h |
| `GET /v1/jobs/:id/spec` | the `ci` key named `jobs-audio` only | — | `200 { job_id, kind, v: 2, shas, analyzer }` or `{ job_id, kind, v: 1, n, k: 50, dim: 32, emb }` (`emb`: base64 of n × 32 int8, in the job's order); `410 expired`, `409 {reason: <state>}` once collected |
| `PUT /v1/jobs/:id/files/:name` | the `jobs-audio` key only | raw bytes, exact `Content-Length`: `part-NNN.jsonl` (results 50 a part in the manifest's `files` order, one a line, ≤ 8 KB each; `NNN` up to the job's last part), `neighbours.bin` (n × 50 uint16, ≤ 2 MB), `manifest.json` (≤ 1 MB, last) | `201 { name, bytes }`; `404` a name the job doesn't take; `413` over its size; `409 {reason: 'manifest_sent'}` for a part after the manifest; `410`/`409` once the job is no longer issued. Stored as sent in the private bucket under `jobs/incoming/<id>/`, read by nothing until collected |
| `POST /v1/jobs/:id/collect` | `mind:night`, the `jobs-audio` key | `{}` | `202 { state: 'validating' }` (checks 1–3 and 6 passed; Core's apply job queued); `200 { state }` when already applied (or validating: its apply job is queued again if it had failed); `422 invalid_result {reason: 'bad_manifest'}` (the job is rejected, nothing applied, its uploads deleted); `409 {reason: 'no_manifest'}` while issued with no manifest; `410 expired` |
| `GET /v1/jobs` | agents, `ci` | `?kind=&open=1` | `200 { items: JobStatus[] }` newest first, 20 at most |
| `GET /v1/jobs/:id` | agents, `ci` | — | `200 JobStatus { job_id, kind, v, state: 'issued'\|'validating'\|'applied'\|'rejected'\|'expired', issued_at, expires_at, collected_at, count, counts: {expected, valid, invalid, failed, missing, reasons?} \| null }` (never a hash) |
| `GET /v1/music/pack` | device | `If-None-Match` | `200` the phone's file (`application/octet-stream`, about 2.8 MB at 12,000 songs; its layout in `backend/src/areas/music/listen-pack.ts` and [MUSIC.md §9.1](../product/apps/MUSIC.md)) with R2's `ETag`; `304` unchanged; `404` before the first one |
| `GET /v1/music/analysis/:id` | `mind:chat`, `mind:night` | `?like=0-50` (10) | `200 TrackAnalysis { id, state: 'done'\|'due'\|'failed'\|'unsupported', analysis: {analyzer, duration_ms, lufs_i, true_peak_db, lra, bpm, bpm_conf, key, key_conf, camelot, start_silence_ms, end_silence_ms, energy, valence, arousal, vocals, moods, top_moods} \| null, like: [{id, title, artist, sim}], like_at }`; `404` no such track |

Without the private bucket's binding (`VAULT`) every route that reads or writes a file answers `503 not_configured`. The `jobs-audio` key is confined (`CONFINED_KEYS` in `shared/contract/routes.ts`): every other route answers it 403, and the deploy environment's `ci` key gets 403 on the job routes (`RouteSpec.keyRole`: only CI must be that key on collect; the night mind isn't keyed).

### 11.19 Work orders (P4)

Muse's tasks ([MUSE-PROTOCOL.md](MUSE-PROTOCOL.md) is the sequence Muse implements; history in [archive/MUSE.md](../archive/MUSE.md)). Two kinds (`WORK_KINDS`, `shared/contract/work.ts`, 2026-11-03): **`muse.request`**, placed by the owner's `@muse` (§11.7 rule 10) or the mind, with `spec: { v: 1, words /* ≤ 500 */, app? /* a hint where it belongs */ }`; and **`muse.upload_batch`**, the Worker's own record of the songs Muse registers through its signed route (`/v1/music/uploads/*`, §11.21 Music), one per sitting, closed as done 30 minutes after the last, never queued or claimed. The Board-era kinds are gone: a stored row of one reads `kind: 'legacy'` and is never handed out. Every order answers with `state` (`asked`, `picked_up`, `working`, `done`, `failed`, `cancelled`: what the menu's Tasks and the chat's lines show; `working` once Muse has posted a progress line or heartbeat on its claim; `rejected`, `failed` and `expired` show as `failed`) and `message_id` (the owner's `@muse` message, else null). The result schema is the same for both kinds, `MUSE_RESULT`: `{ added: { songs?, artists?, episodes?, files? } /* integers ≥ 0 */, ids: string[] /* ≤ 50 */, note: string /* ≤ 200 */, open?: { app, path /* inside that app's folder */ } }`, no other field. An order linked to a message tells today's conversation each state once, in order: `system` lines `"Muse picked it up."`, `"Muse is working on it."`, `"Cancelled. Muse won't do it."`, a failure as `"Muse couldn't do it: <reason>."` (or `"Muse didn't get to it in time."`, `"Muse stopped answering about it."`, `"Muse's answer didn't pass the checks, so I left it out."`), and done as Muse's own message (`author: 'muse'`, `origin: 'muse'`): `"Muse added 41 songs from 3 artists. <note>"` with `meta.chip` `Open in <App>` from `result.open`, else the spec's `app` at its root. Each line carries `meta.work = { id, state }` and `reply_to` the owner's message. Orders the mind placed post no lines. (The Daily Board's routes were removed on 2026-10-31.)

| Route | Who | Request | Response |
|---|---|---|---|
| `PUT /v1/work/orders/:id` | `mind:chat`, `mind:night` | `{ kind: 'muse.request', title /* ≤ 80 */, spec: { v: 1, words /* ≤ 500 */, app? }, deadline_at: Ms /* 5 min to 7 days ahead */ }` | `201` the order (`200` the same again); the standing permission `muse.order` (ask by default: `403 proposal_required` with the card, §11.11); a session that read outside content `403 session_tainted`; words never stored `422`. No kind is personal: one that is will need an approved `reach_people` card |
| `POST /v1/work/orders/:id/cancel` | `mind:chat`, `mind:night`, device | `{ why /* ≥ 8 */ }` | `200 { status: 'cancelled' }`; `409` once finished. The owner's is never gated; an `@muse` order's conversation hears it |
| `GET /v1/work/orders?status=…\|all&limit=`, `GET /v1/work/orders/:id` | device, `mind:chat`, `mind:night`, `mind:reflex` | — | `200 Page<WorkOrder>` newest first (`limit` ≤ 100, default 30; the menu reads 20) / `200 WorkOrder` (results marked `origin: 'muse'`) |
| `GET /v1/work/hello` | `muse` | — | `200 { agent: 'muse', scopes, server_time }` |
| `POST /v1/work/claim` | `muse` | `{}` | `200 { order }` (the one Muse holds, else the oldest queued `muse.request` whose deadline hasn't passed) or `204` |
| `POST /v1/work/orders/:id/heartbeat` | `muse` | `{ note? /* ≤ 120 */ }` | `200 { lease_until }` (30 min lease); `404` not a claimable kind, `409` not claimed |
| `PUT /v1/work/orders/:id/result` | `muse` | `{ result /* ≤ 256 KB */, files?: [] }` | `200 { status: 'done' }`, or `422 invalid_result` with each problem in `details` (`path`, `issue`): the order stays claimed for Muse to fix, and the third result that fails in one claim rejects it (`409` after) |
| `POST /v1/work/orders/:id/fail` | `muse` | `{ reason /* ≤ 280 */, retry?: boolean }` | `200 { status }`: `failed` (final), or `queued` with `retry` while it has claims left (3) |
| `POST /v1/work/orders/:id/files` | `muse` | raw bytes, header `TH-File-Name` (≤ 15 MB, ≤ 10 per order) | `201 { ref, sha256 }` [not built: no kind has files] |
| `GET /v1/work/thread?after=<seq>&order=<id>` | `muse`, device, `mind:chat`, `mind:night` | — | `200 Page<MuseNote>` (Muse's own thread, never the owner's conversation; newest 500 kept); with `order`, that order's progress lines only |
| `POST /v1/work/thread/messages` | `muse`, device, `mind:chat`, `mind:night` | `{ id: Id, body /* ≤ 2,000 */, order_id?: Id /* Muse only: the order it holds */ }` | `201 { id }` (the author is the caller's: muse, owner or mind). With `order_id` it is a progress line: it heartbeats the claim (`409` when not claimed) and makes the order `working` |
| `GET /v1/briefing` | device | — | `200 BriefingResponse` (`shared/contract/briefing.ts`): the title line, the date and the day's line from counts (`today`), the weather tile (P8; Open-Meteo asked again when the kept forecast is over 30 minutes old; tomorrow's high and low), "Waiting on you", "Due" (the owner's reminders today and tomorrow, with the list for its sheet), the night's report first (`ReportTile`, 2026-11-04: from the quiet hours' end of the open day; each line's `path` from an `app:` ref, `undo` `open`\|`undone` from a `ledger:` ref), the night shift's tiles, "Holidays" (the next within 14 days in `owner.country`), Muse's line, the night line while the night shift is connected and didn't arrange the page (`night`), the quota line. Due, Holidays and the day's line are the Worker's own, built 2026-11-02 (BRIEFING.md); the songs count asks the Music object, and an answer without it leaves songs out. "Today" (2026-11-02, `CalendarTile`): the owner's calendar events still on today and tomorrow's first; a calendar link never tried is fetched before the answer, one last tried over 30 minutes ago after it; the day's line counts "things on today" |
| `GET /v1/briefing/calendar` | device, `mind:chat`, `mind:night` | `?days=1–14` (7) | `200 CalendarResponse` (`shared/contract/briefing.ts`): `items`, the kept events from the owner's midnight today for `days` days (`{ uid, start, end, all_day, title, location, source }`, at most 200, a failing link's left out 48 hours after its last good fetch), and `feeds`, each link by its host only, with its mark (`source`), its last good fetch, the first failure since and its code. `source: outside` marks a shared link's words: outside text for the mind. `422` for `days` out of range; never in the eval sandbox. For `th get /v1/briefing/calendar days=7` | P8 · built 2026-11-02 |
| `PUT /v1/briefing/report/:day` | `mind:night`, from a claimed, live night session | `PutNightReportRequest { headline /* ≤ 60, one plain line */, lines: { kind: 'memory'\|'loose_ends'\|'built'\|'reading'\|'music'\|'health'\|'predictions'\|'note', text /* ≤ 100 */, ref?: 'app:<id>'\|'ledger:<id>' }[] /* ≤ 6; 800 characters in all */ }` (`shared/contract/night-report.ts`; no exclamation marks, Markdown or emoji; the phrase lint; a `ledger:` ref must be a row `mind:night` wrote) | `200 NightReport { day, written_at, headline, lines, counts, ledger_id, message_id }`: `counts` are the Worker's (facts added and confirmed, loose ends added and closed, predictions, the steps a hard stop cut, again when the run is done; songs, mixes and pages `null`); each version is a ledger row (`arrangement`) whose undo restores the version before, or removes the first; put first for the night before the open day, the open day's first message (author `mind`, origin `night`, `meta.report`) unless the owner has written that day: no push, no wake, never rewritten. The same body again answers the stored report and writes nothing; `409 conflict` from another session; `403 session_tainted`; `403 session_required`; `422` for an open day, a day with no night run, or the limits | P4 (2026-11-04) |
| `PUT /v1/briefing/place` | device | `{ name /* 2–80 */ }` | `200 { place }`: the town looked up with Open-Meteo's geocoder and kept (coordinates to 0.1°), its forecast fetched; the geocoder's country (ISO 3166-1 alpha-2) kept as the private setting `owner.country` for the Holidays tile, or removed when it gives none (2026-11-02; a place kept before is looked up once more by name on the next forecast refresh); `422` "No place by that name." | P8 |

### 11.20 Settings and push

| Route | Who | Request | Response | Phase |
|---|---|---|---|---|
| `GET /v1/settings` | device, agents | — | `200 Record<string, unknown>` (no secrets exist here); an agent gets `briefing.calendars` as `[{ host, mine }]`, never a link's address (a link is a key to its calendar) | P1 |
| `PATCH /v1/settings` | device | `{ [key]: value }` (keys from [MENU-AND-SETTINGS.md](../product/MENU-AND-SETTINGS.md); `quiet.until`, "go quiet"'s end in ms, 0 ends it, [BEHAVIOR.md §8](../mind/BEHAVIOR.md#8-go-quiet); `briefing.calendars`, 2026-11-02: `[{ url, mine }]`, at most 3, each address once, ≤ 512 characters, https, no user, password or port, a public host neither numeric nor local) | `200` the changed keys; a calendar link it refuses is `422 validation` with `details[0].path` `briefing.calendars.<n>.url` and the reason as `issue` ("Only https links …", "Only a public address, not a local or numeric one.") | P1 |
| `PUT /v1/push/subscription` | device | `{ endpoint, keys: { p256dh, auth } }` | `204`; `422` unless the endpoint is a known push service (FCM, Mozilla, Apple, Windows) and the keys are a P-256 point and 16 bytes | P8 · built |
| `DELETE /v1/push/subscription` | device | — | `204` | P8 · built |
| `POST /v1/push/test` | device | — | `200 { sent: 0\|1 }`: one test push to this phone now ("This is a test. Nothing needs you."), outside every budget | P8 · built |
| `GET /v1/push/key` | device | — | `200 { vapid_public_key }`; `503 not_configured` until the key exists (the deploy makes it) | P8 · built |
| `GET /v1/push/items/:id` | device (from the service worker) | — | `200 { title, body, url }` (the text a push only points at; a reminder's is always `"Thunderhead"`, `"Your reminder."`, `/`, [PRIVACY.md §8](PRIVACY.md)) | P8 · built |
| `PUT /v1/pushes/:id` | `mind:chat` | `{ title /* ≤ 40 */, body /* ≤ 100, no ! */, ref?, why /* ≥ 8 */, topic_key, deadline? /* default 3 h */, asked_by? /* the owner's message that asked: what "quiet" lets through */ }` | `202 { queued_until }` (the same id and body again: the same answer) | P8 · built; 409 `push_budget`, `push_gap`, `quiet_hours`, `nudge_repeat`, `conflict` (`quiet` once "go quiet" exists); 422 `speech_budget` (the speech setting, checked first). From the eval sandbox: `202` and nothing sent |

Push payloads carry only `{"k": kind, "id": id}`, encrypted: `nudge`, `security`, `test`, or `reminder` (§11.24; its id is the reminder's). Details: [SECURITY.md](SECURITY.md).

### 11.21 App routes (later phases)

The ported apps (P1b) call the old Worker, not this API. Each app's routes are added here, to §13 and to `shared/contract/` in the phase its data moves, with the shapes its app doc gives. Until then they are **[proposal]**, owned by the app docs:

| App (data move) | Routes named in its doc |
|---|---|
| Music (P5) | Built: `GET /v1/music/catalog` (device; the whole catalog in the ported player's own `r2-library` format without waveforms, `ETag` and `304` on `If-None-Match`, `409 conflict` before the I7 import; `MusicCatalog` in `shared/contract/music.ts`), `GET /v1/music/waveforms/:id` (device; `{ id, bars }`, base64 of one byte a bar; 404 when the track has none). `GET /v1/music/tracks?q=&limit=` (C N; served to a mind principal, which must name a claimed, live session of its role in `TH-Session` (422 `validation` without one, 403 `session_required` for any other; the device needs none), any route here that returns songs' tags (`tracks`, `GET notes`, `find`, and the listening pass's `analysis/:id`, which names the song's neighbours) first taints that session, source `th music`, and records a night session as one that read them (Music's `song_readers`, kept a week); tracks whose tags hold every word, `{ items: [{ id, title, artist, album, genre, composer, year, dur }], total }`, at most 1,000, songs rated 1 and songs a current `music.never` rule names left out: what the mind picks a playlist from, then `music.create_playlist` on a phone; with `untagged=1`, at most 200 songs with no current note (none, or one of an older format unless the owner corrected it through the chat), in catalog order from where the night's last page began, which moves the night's place to just before the first of them; `total` then counts the page only and `more` says whether more follow; never in the eval sandbox, 422). What the mind knows of each song (Music schema step 4; [MUSIC.md §10.5](../product/apps/MUSIC.md), `MusicNote*` and `MusicFind*` in `shared/contract/music.ts`; never in the eval sandbox, 422): `PUT /v1/music/notes` (C N; `{ items: MusicNote[] /* 1–200, ≤ 256 KB, cut off as it streams */ }` → `200 { written, unchanged, kept }` (`kept`: night notes for songs the owner corrected through the chat, which stand): every field checked against its fixed vocabulary, every confidence 0.05–1 and at most 0.5 when `known: false`, a confidence for each of themes, language, era and energy that is set and none for one left empty; one bad note, a track twice or an id the catalog doesn't hold refuses the whole batch with `422`, each problem named by its path (`items.3.moods.happy`), so nothing is half-written; a note the same as the one kept writes no row; the writer is the key's role; from 80% of the day's database budget `429 rate_limited` with `details.reason: daily_quota` and `Retry-After` until 00:00 UTC, as the upload tools), `GET /v1/music/notes` (D C N; `?ids=a,b` (1–200) → `{ items: [{ …tags, note \| null }], missing, next: null }`, or `?cursor=<track id>&limit=1–200` → every note in track id order, `next` the last id while more follow), `GET /v1/music/find` (C N; `?moods=calm,dreamy` (≤ 4) `&occasion=` (one) `&energy=low\|mid\|high\|0–1` `&like=<track id>` `&limit=1–100` (30), at least one of the first four → `{ items: [{ …tags, score, known, why: { moods?, occasion?, energy?, like?, skips? } }], total, analysis, left_out: { never, rated, skipped } }`; ranked by the notes (packed 500 to a row) and, where the listening pass has measured songs, its moods and energy (packed again once a job of it applies songs, or a day on) and the seed's neighbours (`analysis: true`); from 80% of the day's database budget `429` as for a batch; each skip before 30 s in the last 30 days (the Senses object's events by their (day, type) index, kept in its memory until a new skip arrives) costs 0.25, three leave the song out, and so do a newest rating of 1 (Music's `track_ratings`, kept for good) and a current rule fact with subject `music.never` naming `music:<id>` (Core's current rules only); `left_out` counts each kind; `404` when `like` names a song the catalog doesn't hold). `GET /v1/music/mixes` (D C N; `{ items: [{ id, name, tracks, recipe, created_at }] }`, newest first, at most 50: the mixes `music.mix_save` kept in Core, `id` the one `music.play_mix {mix_id}` takes; no tags, so it taints nothing). `GET /v1/music/mixes/:id` (D only; `{ id, name, refs }`, the mix's songs in order, one read by the key; 404 `not_found`): what the owner's tap on Music's "tonight" plays (`th/music/tonight.js`). `/v1/music/uploads/*` for the upload tools (P5 step 3, `backend/src/areas/music/upload.ts`; [MIGRATION.md §7](../archive/MIGRATION.md#7-caller-switch-over-order) step 4): no bearer token; every request carries the old tools' Ed25519 signature headers (`X-Music-Public-Key`, `-Signature`, `-Timestamp`, `-Size`, `-Sha256`) over `jarvis-r2-upload-v1`, method, origin, path, type, hash, size, time and key, within 5 minutes, by a key in the secret `MUSIC_UPLOAD_PUBLIC_KEYS` (503 `not_configured` until [SETUP.md N4](../process/SETUP.md)); a request with an `Origin` is 403. `PUT …/audio/<sha256>.opus` (Ogg Opus, ≤ 32 MiB) and `PUT …/art/<sha256>.jpg\|png` (≤ 2 MiB) store the checked bytes once under their content address in `jarvis-music` and answer `{ key, sha256, size, r2Identity }`. `POST …/<op>` runs the old writer's operations with their old bodies (from 80% of the day's database budget, until 00:00 UTC, each answers `429 rate_limited` with `details.reason: daily_quota`, `scope: account` and `Retry-After` in seconds until then; [DATA.md §8.1](DATA.md#81-the-limits-that-bind)) and answers: `register`, `register-batch` (≤ 100), `analysis`, `patch`, `replace-audio`, `waveforms` (≤ 200), `delete` (catalog rows only: `deletedObjects` is always empty, nothing leaves the bucket), `audit`, `export` (the catalog with waveforms) and `links` (signed audio links, ≤ 100 ids, for the waveform backfill). The old `publish` and `reimport` are gone: there is no catalog file. The songs `register` and `register-batch` add (not duplicates) also go to Muse's open upload batch, a task in the menu (§11.19), after the answer; that never fails an upload. Errors use this API's envelope |
| Guitar (P6) | Built (`backend/src/areas/guitar/`): the old `/guitar/*` routes as `GET /v1/guitar/search?q`, `/songs/:id`, `/songs/:id/score?revision&parts`, `/gprotab/search?q`, `/gprotab/file?path` (bytes), `/sounds/:instrument/:note.mp3` (audio/mpeg), device only. Each source's own words for a failure travel in `error.details.reason`; a redirect off the source's origin is refused; nothing is logged or stored ([GUITAR.md](../product/apps/GUITAR.md) §11) |
| Study (P7) | Built (`backend/src/areas/library/`, shapes in `shared/contract/library.ts`; [STUDY.md](../product/apps/STUDY.md) §3, §5, §6). The device: `POST /v1/library/books` (`{ id /* the client's UUIDv7 */, title, author?, kind?, language?, bytes /* ≤ 500 MiB */ }` → `201 { book, upload: { part_bytes, parts } }`; the same request again `200`, other fields under the id `409`), `PUT …/books/:id/parts/:n` (bytes, exactly 50 MiB but the last, streamed into the private bucket's multipart upload; any order, again to resume; `422` for a wrong length), `POST …/books/:id/complete` (`409` with `details.parts` until every part is in; then the book is `queued` for the mind), `GET /v1/library/books[/:id]` (with each book's place and how far it is read), `GET …/books/:id/file` (the device; the whole PDF once its upload is whole, which the phone keeps), `PATCH …/books/:id` (title, author, kind, language), `POST …/books/:id/retry` (a `failed` book only), `PUT /v1/library/positions/:book_id` (`{ pdf_page, scroll_frac, at }`; the newest `at` wins), `GET /v1/library/highlights?book_id` and `PUT /v1/library/highlights/:id` (the newest `updated_at` wins; `{ highlight, applied }`), `GET /v1/library/search?q&book_id&limit&cursor` (D C N; FTS5 over ready books, bm25, the owner's words always quoted for FTS, snippets as escaped HTML with `<mark>`; `not_ready` counts the books not searchable yet). The mind (C N, never in the eval sandbox): `POST /v1/library/ingest/claim` (the oldest waiting book, leased an hour and renewed by each call; `204` when none), `GET …/ingest/:job_id/file` (the PDF, the run's holder only: no signed link), `PUT /v1/library/books/:id/pages` (`{ job_id, pages /* 1–50 */ }`; a page replaces the one at its number with its FTS entry and verse refs; `429` with `Retry-After` when the day's bulk lane is used up), `PATCH …/ingest/:job_id` (`{ state: extracting\|ocr\|indexing\|paused\|ready\|failed, cursor?, pdf_pages?, sha256?, reason? }`; ready needs the file's SHA-256 and page count; a SHA-256 another book has makes it a `duplicate`). Scripture (P7 step 4, `areas/library/scripture.ts`; STUDY.md §7): `GET /v1/library/scripture` (D C N; the owner's private book table, `ETag` and `304`; 404 until stored), `PUT /v1/library/scripture` (C N; ≤ 1 MiB, checked by the parser), `GET /v1/library/scripture/text/:code/:chapter` (D C N; `{ code, chapter, verses }` from the owner's copy), `PUT /v1/library/scripture/text/:code` (C N; ≤ 8 MiB, `{ chapters }`, every verse checked against the table, ≤ 4,000 characters each), `GET /v1/library/books/:id/pages?from=&limit=` (C N, not in the sandbox; a book's stored page text, 50 pages a call, `next` the following page: the mind builds the verse text from it, SETUP.md O2), `GET /v1/library/cite?q=` (C N; the blocks a cited answer may use, at most 20: a named verse's blocks by weight, then the best pages' best blocks; a mind message with `[[book:…]]` markers must carry `meta.cite.q` and is checked against them before it is stored, STUDY.md §8.2), `GET /v1/library/verses/:code/:chapter?v=12[-14]&all=1` (D C N; `{ ref, cited /* 10, or 200 with all */, total, highlights }`: the blocks whose refs name the verse, a range around it or its whole chapter, by weight, then the books opened last, then page). A page's or a highlight's verse ref is `422` until the table is stored, then for any ref not in it |
| Podcasts (P8) | Built (`backend/src/areas/podcasts/`), the old `/podcasts/*` routes for the device only: `GET /v1/podcasts/directory?q=` or `?category=` (`&country=`; `{ shows }`: Apple's two search addresses, then gpodder), `GET /v1/podcasts/feed?url=` (the feed as its host sent it, at most 4 MB; the phone parses it), `GET /v1/podcasts/audio?feed=&id=` (the episode found in its feed by id, never a caller's address; `Range` passed on, `Content-Range` and `Accept-Ranges` exposed). Every address is public, checked again on each redirect (≤ 16, a loop is an error); a host's own words for a failure travel in `error.details.reason`; nothing is logged or stored ([PODCASTS.md](../product/apps/PODCASTS.md) §4.4). mind:night gets feeds as numbers only (`/feed?show=&since=&count=1`, counts mode, its only mode, the show named by its opaque `show_id`; a raw feed or any `url=` is `403` with `details.reason: counts_only`): `200 { new_n, latest_at }`, the episodes (RSS items, Atom entries with an enclosure) published after `since` that no phone has started (at most 200), and the newest publication time seen (null for one at or before 1970 or past the clock and an hour), read from at most 256 KB and 8 s in all of the feed, in time linear in the bytes (`backend/src/areas/podcasts/counts.ts`), or `502 upstream` with a fixed `details.reason` (`not_a_feed`, `too_slow`, `unreachable`), never the host's words; nothing it gets marks the session ([RUNTIME.md §12.1](../mind/RUNTIME.md)). Only a show the owner follows (one row of `podcast_follows` read by `show_id`; any other id is `403 forbidden` with `details.reason: not_followed` and nothing is fetched), at most 40 a UTC day, then `429 rate_limited` with `details.reason: night_feed_reads` and `Retry-After` until 00:00 UTC (counted in a stored row, the setting `podcasts.night_reads`: a restart or deploy doesn't reset it). Built 2026-11-01: the positions and follows, §11.25. Later, with the evolved app: `GET /v1/podcasts/file`, `POST /v1/podcasts/check` |
| Astra (P8) | `PUT /v1/astra/backup`, `GET /v1/astra/backup` (device only) ([ASTRA.md](../product/apps/ASTRA.md)) |
| My Media (P8) | `GET /v1/media/config`, `GET /v1/media/catalog`, `GET /v1/media/drive/:id`, `PUT /v1/media/progress/:id` ([MY-MEDIA.md](../product/apps/MY-MEDIA.md)); `GET /v1/media/config` may be needed earlier (MIGRATION open question 8) |

Every one of them follows this page's rules (scopes in §13, errors in §6, cost budgets in [TESTING.md §6](TESTING.md#6-cost-tests)).

### 11.22 Evals (P4)

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `POST /v1/evals/sandbox` | C N, with `TH-Sandbox: eval` only | `{ seed: SeedRow[] /* ≤ 200: owner and Muse lines, the owner's memory ops; synthetic */ }` | `200 { seeded, thread_id }`: every table of `core-eval` emptied, then the seed written through the normal paths | 422 outside the sandbox, or a seed row naming an earlier row that isn't there |
| `GET /v1/evals/sandbox` | C N, with `TH-Sandbox: eval` only | — | `200 SandboxReport`: since the reset, the mind's ledger rows by kind, its messages outside the eval thread, its last 20 replies (each cut to 2,000 characters) and every write it tried (route and status, refused ones too) | 422 outside the sandbox |
| `PUT /v1/evals/runs/:id` | C N, never in the sandbox | `{ id, suite: 'INJ', git_sha, n, passed, failures: string[], skipped?: string[], judged? }`: numbers and fixture ids only | `201 EvalRun` (`score` = passed / n), `200` for the same body again | 409 another body under this id; 422 in the sandbox, or `passed > n` |
| `GET /v1/evals/runs?suite&limit` | D C N | — | `200 { items: EvalRun[] }`, newest first | |

### 11.23 Predictions (P9)

The night shift's predictions about the owner's day ([EVALS.md](../mind/EVALS.md) M-18; types in `shared/contract/predictions.ts`). Each names a fixed resolver, which Core's tick runs once the predicted logical day is over: `chat.any` (the owner writes that day), `chat.count { n: 2–50 }` (at least n owner messages), `chat.before { time: 'HH:MM' 05:00–23:59 }` (their first message before then, local), `decision.answered { id }` (they answer that waiting card before the day ends), `app.open { app }` (music, guitar, podcasts, astra, media or study: the phone reported its opening that day; the Senses object's `typeDays`, so an app prediction resolves on the tick after the Senses object answers). The tick also stores the base rate: the share of the 28 days before (from the first daily thread) on which it came true, smoothed as (k + 1) / (n + 2).

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/predictions/:id` | N | `{ category, args, day, p /* 0.01–0.99, two decimals */, why /* ≤ 200 */ }`: `day` the open day or the next | `200 Prediction`, the same for the same body again | 409 another body under this id; 422 an unknown category or arguments, another day, a chat prediction about the open day after the owner's first message of it, an app prediction about the open day once that app was opened, a card not waiting, or the 13th in 24 hours |
| `GET /v1/predictions?open&limit` | D C N | — | `200 { items: Prediction[] }`, newest first; `open=1` only the unresolved | |
| `GET /v1/insight` | D C N | — | `200 InsightResponse`, the meter on the Memory page ([EVALS.md §9](../mind/EVALS.md)), counts only: M-8 by week (the owner's fixes and forgets of facts, and the facts the mind wrote), the newest 4 memory checks (MP), M-16 over the 28 days up to 48 hours ago (an arrangement undone within 48 h; kept when its tile was tapped or the app its `ref: app:<id>` names was opened on its day or the next; else ignored; newer ones waiting), and M-18 per category | |
| `GET /v1/predictions/skill` | D C N | — | `200 { categories: CategorySkill[] }`: per category the open and resolved counts, the Brier score, the base rate's Brier score, the skill (1 − the two's ratio, only from 30 resolved) and 5 reliability bins | |
| `GET /v1/predictions/calibration` | D C N | — | `200 CalibrationResponse { days: 28, items: { category, n, claimed, right, brier }[] }`: per category with anything settled in the last 28 days, the mean odds claimed and how often it came true; `cards`: the arrangement cards (class `permit`) the owner answered or let expire, a yes being right | |
| `GET /v1/insight/topics` | D C N | — | `200 TopicsResponse { window_days: 30, items: TopicLands[] }`, worst first: per topic its places, kept, undone, ignored, unseen, waiting, streak, and while it rests `quiet_until`, `reopens` and `said`. Reading it runs the pass (also run on each day roll), which may send a topic to rest (a ledger row by the Worker) | |

### 11.24 Reminders (P8)

The reminders the owner sets ([HOME.md §6.2](../product/HOME.md) "Remind me"; [BEHAVIOR.md §3.4](../mind/BEHAVIOR.md#34-rung-3-push) "Owner-set reminders"; types and `REMINDER_LIMITS` in `shared/contract/reminders.ts`): from the phone's `+` sheet, or by the chat mind when the owner asks in words. Each is delivered once at its time by Core's alarm: a line in today's conversation and a push.

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/reminders/:id` | D C | `{ text, at /* ms */, source_message_id? }`, nothing else; `source_message_id` is the chat mind's and required from it, never the phone's | `201 { reminder }`; the same id and body again `200` with the stored reminder | 409 another body under this id; 422 the words empty, over 200 characters once trimmed, or with a control character (a newline included), a bidirectional override or a line or paragraph separator; `at` more than a minute past or more than 400 days ahead; a 51st set at once (`details` says so); from the phone, a `source_message_id`; from the chat mind, none, or one that is not an owner-device message of the last 48 hours, or a 4th reminder from that message, or a 6th from the mind in any 24 hours, or words the phrase lint refuses ([BEHAVIOR.md §10](../mind/BEHAVIOR.md)). 403 `session_required` / `session_tainted` for a chat mind without its claimed session or with a tainted one (as memory writes) |
| `GET /v1/reminders` | D C N | — | `200 { items: Reminder[] }`: the set ones soonest first, then those delivered or taken back in the last 24 hours, newest first | |
| `DELETE /v1/reminders/:id` | D C | `?source_message_id=<owner message id>`: the chat mind's, required to take back one the owner set on the phone (the owner's message that asked, as on `PUT`, not counted); its own need none | `200 { reminder }`: a set one becomes `cancelled` (the row stays); one already cancelled answers the same | 404 none; 410 `expired` once delivered; 422 from the chat mind, an owner-set reminder without a `source_message_id`, or with one that is not an owner-device message of the last 48 hours; 403 for a chat mind as on `PUT` |

- `Reminder` is `{ id, text, at, fire_at, state: set|done|cancelled, origin: owner_device|mind, created_at, fired_at, message_id }`. The text is stored trimmed.
- `fire_at` is `at`, unless `at` falls inside the owner's quiet hours (the settings `quiet.start`/`quiet.end` in `owner.tz`, as the push rules read them; the end is never before 06:30): then the end of that window. `fire_at != at` is how the phone and `th remind` say "moved".
- At `fire_at` (Core's alarm; the 15-minute tick delivers one it missed) the reminder becomes `done` in the same commit as a system message in today's daily thread (made if needed): `author` and `origin` `system`, `kind` `text`, the reminder's words as `body`, `meta: { reminder: { id, at } }`, its id kept as `message_id`. The change feed carries it as `message`, so open phones hear about it.
- Then a push of kind `reminder` to every subscribed phone, payload `{"k":"reminder","id":<the line's id>}`, words `"Your reminder."`. It is not one of the mind's 2 a day, doesn't open or wait out the 2-hour gap, takes no topic, waits for no natural pause and goes through "go quiet"; it is never sent inside quiet hours, so one delivered there (a late alarm) posts its line and pushes nothing. Core offers the push to the outbox for an hour after delivery, under the id of the line it became (`message_id`, made by the Worker at delivery, so no nudge can already hold that id), so a hand-off that failed is made by the next delivery run and none is sent twice. `fire_at` is fixed when the reminder is set: a later change to the quiet hours doesn't move it, and if it then falls inside them, its line still comes at `fire_at` with no push. From the eval sandbox no reminder pushes.

### 11.25 Podcasts' positions and follows (P8)

NEXT-BATCH.md part 7 ([PODCASTS.md §5.4](../product/apps/PODCASTS.md); types and `PODCAST_LIMITS` in `shared/contract/podcasts.ts`; Core step 25, [DATA.md §4.1](DATA.md#41-settings-ops-the-feed-and-the-minds-bookkeeping)). The ported Podcasts app keeps both on the phone; `frontend/th/podcasts/progress.js` syncs them: where each episode was left, so it resumes on any phone, and the shows followed, so the night can look for new episodes.

| Route | Who | Request | Response | Errors |
|---|---|---|---|---|
| `PUT /v1/podcasts/progress` | D | `{ items: PodcastProgress[] /* 1–100 */ }`, each `{ key, position_s, duration_s, played, updated_at }`, nothing else. `key` is the app's own `<feed address>#<episode id>`: an http(s) address of at most 2,000 characters, no credentials, then after the last `#` 1–64 letters, digits, `_` or `-` | `200 { applied, stale, refused, at }`: each item is checked on its own. One the Worker can't take (a key not of that form, a position or length outside 0 … 604,800 s, an `updated_at` more than an hour ahead of the Worker's clock, another field) is in `refused` as `{ index, issue }` (its place in the request and the field and rule, never the value), and the rest are kept. A valid item is kept only when its `updated_at` is newer than what Core has (equal keeps what is there, so a batch sent twice changes nothing); `stale` counts those left. `at` is the Worker's clock: the phone keeps its own clock's offset from it and sends its times on the Worker's (PODCASTS.md §5.4) | 422 for the batch's own shape only: not `{ items }`, 0 or over 100 items; 413 over 64 KB |
| `GET /v1/podcasts/progress?since=&limit=&cursor=` | D N | `since`: ms (0 for everything); `limit` 1–500 (500); then `cursor` from `next` | `200 { items: PodcastProgress[], next_since, next }`: what Core took at or after `since` (by when it took it, not the phone's time), oldest first. While `next` is a cursor there is more; once it is null, `next_since` (the read's own time) is the next `since`. A row taken twice between reads comes once; a row at the boundary may come twice (harmless: the newer wins) | 400 another route's cursor; 422 a bad `since` or `limit` |
| `PUT /v1/podcasts/follows` | D | `{ items: PodcastFollow[] /* 1–100 */ }`, each `{ feed_url, title /* ≤ 300 */, author /* ≤ 200 */, artwork /* http(s) or '' */, followed, updated_at }`: `followed: false` is an unfollow | `200 { applied, stale, refused, at }`, item by item and the newer `updated_at` winning as above; the night's check of the show stays | as `PUT …/progress` |
| `GET /v1/podcasts/follows?since=&limit=&cursor=` | D N | as `GET …/progress` | `200 { items: PodcastFollowRow[], next_since, next }`: each follow with the night's last check, `checked_at`, `latest_at`, `new_n`, and `fails` (its feed's failed checks in a row); for mind:night each show by its opaque `show_id` only (no `feed_url`, `title`, `author` or `artwork`), every follow on one page, `next` null | as `GET …/progress` |
| `POST /v1/podcasts/follows/checked` | N | `{ items: [{ show_id /* 16 hex */, latest_at /* ms or null */, new_n, failed? }] /* 1–20 */ }`: the shows the night read, by id, and those whose feed failed (`failed: true`) | `200 { updated, at }`: a followed show's `checked_at` becomes now. Read: `new_n` is set, clamped to 0–200, `fails` goes back to 0 and `latest_at` only moves forward; a time at or before 1970 or past the Worker's clock and an hour counts as none (it keeps the old one): odd numbers from a feed are clamped, never refused. Failed: `new_n` 0, `latest_at` kept, `fails` + 1 (the night waits 20 h × 2^fails, up to 160 h, before the next try). An unfollowed or unknown one is left. `synced_at` stays, so the phones are not sent the row again | 422 a bad item, 0 or over 20 |

- Nothing here writes the change feed: nothing on home or in the mind's view changes when a phone syncs, and the phones ask by time when Podcasts opens.
- Rows (measured, [TESTING.md §6](TESTING.md#6-cost-tests)): a position kept 0 read and 2 written (the row and its `synced_at` index entry), a stale one 0 and 0, a first sync of 100 positions 200 written; a read on open 1 row read when nothing changed (of 1,000 kept), else the rows it returns; a follow 2 written; the night's check of 20 shows 20 read and 20 written; its feed read admitted 1–2 read and 1 written (the follow row, the count's row), refused 0–1 and 0. The daily prune keeps the newest 1,000 positions by `updated_at` (about 2,200 rows read a day at that size) and follows within 300 rows, an unfollow 30 days. Every query is counted by the row meter (DATA.md §3); like all the phone's and the mind's calls, these are never held by the quota hold (DATA.md §8.1): a heavy day of 3 hours of podcasts is about 400 rows written of the 100,000.
- Keys stay the app's own: they travel only in JSON bodies, never a path, a query or a log line, and a phone that never saw an episode can still resume it.
- **The night never receives podcast text.** `GET …/follows` for a mind gives each show by its opaque `show_id` only, leaving out `feed_url` (its publisher chose it), `title`, `author` and `artwork` (`PodcastNightFollowRow`), on one page with no cursor, and the feed comes only as numbers (counts mode, §11.21), so neither marks the session. `GET …/progress` still carries feed addresses of any show listened to: served to a mind principal it needs `TH-Session` naming a claimed, live session of its role (422 `validation` without one, so raw `curl` gets nothing; 403 `session_required` for one that isn't), which Core marks tainted (source `podcasts`) before the answer goes out (`backend/src/areas/podcasts/taint.ts`, `CorePodcasts.podcastsRead`); the night doesn't read it. The owner's device is never marked. The mark costs 4–6 rows read and 2 written the first time, 4 read after; counts mode's look-up of started episodes one row each.

---

### 11.26 Photos (P9)

[PHOTOS.md](../product/apps/PHOTOS.md); types and `PHOTO_LIMITS` in `shared/contract/photos.ts`;
Core step 41 and Auth step 4 ([DATA.md](DATA.md)). The owner's phone only (`D`); the callback is
public and checked by its one-use state.

- `GET /v1/photos/drive` → `{configured, connected, folder_name, revoked, connected_at, account, picker_key, picker_app}` (`picker_key`: the picker's public browser key, empty until set; `picker_app`: the Cloud project's number, the OAuth client id's first part)
  (`account`: the consenting Google address, stored sealed; the phone's alone).
- `POST /v1/photos/drive/connect` → `{url}`: Google's consent address (scope `drive.file`,
  offline access, a state good for 10 minutes, stored as its SHA-256 with the site origin to go back to).
- `GET /v1/photos/drive/callback?code=&state=` (public): trades the code, seals the refresh token in
  the Auth object, finds or makes the folder "Thunderhead Photos", then 302 to
  `<site>/photos/?drive=connected|declined|failed`. A used or late state is 400 with a plain line.
- `DELETE /v1/photos/drive` → 204: forgets the grant and asks Google to revoke it; the files stay.
- `POST /v1/photos/upload-token` → `{access_token, expires_at, folder_id}`: minted from the refresh
  token, kept in the Auth object's memory until 5 minutes before it expires. 409 `conflict`
  (`details: drive`) when Drive is not connected or Google took the access back; 503
  `not_configured` without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. The phone uploads the original
  to Drive itself (resumable upload); its bytes never pass through the Worker.
- `POST /v1/photos/from-drive` `{ids}` (1–20 Drive ids the owner picked in Google's picker; a pick
  is at most 100, sent 20 a request) → `{added: PhotoItem[], already: string[], refused: [{id, issue}]}`:
  one Drive call a file (name, size, times, SHA-256, EXIF time and dimensions); each file the shelf
  does not know is registered with no preview, as the daily pass does, with no ledger row; a known
  Drive id is `already`; a folder, a file in the trash, one Drive will not show and anything not RAF,
  DNG, JPEG or HEIC is refused. 409 while Drive is not connected.
- `PUT /v1/photos/:id` `{drive_id, name, format, bytes, sha256, camera?, film?, width?, height?, taken_at, info?}`
  → 201 `{photo}`, after one check with Drive: the file is in the app's folder, not in the trash,
  with that size and (when Drive gives one) that SHA-256, else 422 on `drive_id`; the same id again is 200, a Drive file already on the shelf is that photo (200),
  another Drive file on the same id 409. Its day is `taken_at`'s in the owner's zone.
  `drive_id: null` registers a **pending** photo (its upload runs in the background, PHOTOS.md §1)
  with no call to Drive; the same photo's PUT again with its Drive id (the same SHA-256) takes it.
  `info` is what the file says about itself (`shared/contract/photos-info.ts`): an allowlist of
  numbers (the EXIF's and Fujifilm's maker note's codes) and two names (`lens`, `software`, ≤ 80
  characters), ≤ 2 KB as sent (else 413); a key it does not know is dropped (no place key exists:
  GPS is never sent), a known key out of its range 422; kept canonical in `photos.info`.
- `PUT /v1/photos/:id/info` `{info, camera?, film?}` → `{photo, changed}`: the info for a photo
  registered without it (the editor reads it the first time the photo is opened), checked as above;
  `camera` and `film` only fill a photo that has none; the same again writes nothing (`changed: false`).
  404 for a photo the shelf does not have or that is deleted.
- `GET /v1/photos/pending` → `{items}`: photos on the shelf with no Drive id yet, newest first (≤ 200).
  A pending photo is on the shelf; a paste onto it is 409 `conflict` ("a photo is still uploading").
- `GET /v1/photos?before=<day>` → `{days: [{day, count, photos (≤ 4)}], next}`, 14 days a page,
  newest first; `?day=<day>` one day whole (≤ 200 photos). `?filter=` (with either) is a shelf chip:
  `all` (the default), `favorites`, `stars3`, `stars4`, `stars5` (that many stars or more), `raw`,
  `jpeg` (JPEG and HEIC), `edited`, `unedited`; another value is 422. Paging and the counts follow the
  filter. A stack (a RAW and a JPEG with the same base name taken within 2 s; `photo.pair_id` names the
  other half) is one photo, its RAW, on the shelf and in Recently deleted.
- `GET /v1/photos/:id/around?filter=` → `{newer, older}`: the ids beside this photo in the shelf's
  order under the filter (null at an end), for culling in the editor; 404 for a photo not on the shelf's rows.
- `GET /v1/photos/:id` → `{photo, recipe, info}` (`recipe` `{}` as shot; `photo.edited` says whether it has one; `info` null until the file is read, `{}` when it said nothing; the shelf's items never carry it); `PATCH` `{rating 0–5, favorite, flag 'pick'|'reject'|null, drive_id?}`
  (no ledger row; a stack's `rating`, `favorite` and `flag` go on both its photos; a `DELETE` or a restore takes both)
  (`drive_id`: a pending photo's, once its background upload ended; checked with Drive against the
  registered size and SHA-256, 422 when it differs; the same id again writes nothing; another id, or a
  file another photo has, 409; a deleted pending photo takes it too, so its original goes to Drive's trash);
  `DELETE` moves it to Recently deleted; `POST …/restore` brings it back; `GET /v1/photos/deleted`
  lists Recently deleted (newest first, ≤ 200). A deleted photo is purged 30 days on with its preview.
- `PUT /v1/photos/:id/preview` (`image/jpeg`, ≤ 400 KB) → `{photo}`; `GET` the bytes, private, with
  an ETag (304 on a match), `Cache-Control: private, no-store` and `Content-Security-Policy: sandbox`. A
  deleted photo takes no preview (404, no bytes written). Kept in `thunderhead-private` under `photos/previews/<id>.jpg`.
- `PUT /v1/photos/:id/recipe` `{recipe}` → `{photo, recipe, changed}`: the editor's recipe
  (`shared/contract/photos-recipe.ts`, Lightroom's crs names where they map: `Exposure2012` ±5,
  the tone, HSL, grading, effects and detail controls in their ranges, `WhiteBalance`
  `As Shot|Auto|Custom` with `Temperature` 2,000–50,000 and `Tint` ±150, four point curves of 2–16
  `[in, out]` points 0–255 with inputs rising, `ConvertToGrayscale`); unknown keys and out-of-range
  values are 422. Stored canonical (defaults dropped, keys sorted, ≤ 8 KB) with its SHA-256: the same
  recipe again is `changed: false` and writes nothing. A change writes a ledger row whose undo
  (`photo.recipe`) puts the recipe before back, 409 once the photo was edited again since. Deleted: 404.
  Core step 42. Since P1c the recipe also holds crop and geometry (`CropLeft/Top/Right/Bottom` 0–1 of
  the straightened frame, left before right and top before bottom or 422; `CropAngle` ±45;
  `PerspectiveVertical`, `PerspectiveHorizontal` ±100), optics (`LensManualDistortionAmount`,
  `VignetteAmount` ±100) and the switches `AutoLateralCA`, `LensProfileEnable`, `CropConstrainToWarp`,
  `FlipHorizontal`, `FlipVertical` (the last two ours).
- `GET /v1/photos/:id/versions` → `{items: PhotoVersion[]}` newest first (`{id, kind 'auto'|'named',
  name, recipe, created_at}`, `shared/contract/photos-versions.ts`); 404 for a photo the shelf never had.
  `POST` `{id (the phone's UUIDv7), kind, name? (≤ 60, named only), recipe}` → `201 {version, created}`:
  the recipe checked and stored canonical as above; an automatic version equal to the newest automatic
  one is `200 created: false` and writes nothing, the same `id` again is that version; past 20 automatic
  versions the oldest goes in the same commit; a 21st named one is `409 conflict` until one is deleted.
  `PATCH /versions/:vid` `{name}` → `{version}` (an automatic one named becomes named, within the cap);
  `DELETE /versions/:vid` → `{ok}`. Versions leave no ledger row: restoring one is the recipe `PUT`
  above, with its undo. A photo in Recently deleted takes no new version (404); its versions go with it
  when it is purged. Core step 43.
- `GET /v1/photos/looks` → `{items: PhotoLook[]}` newest first, at most 500 (`{id, name, source
  'mine'|'xmp'|'recipe'|'camera', recipe, panels, tag, film, credit, created_at, updated_at}`,
  `shared/contract/photos-looks.ts`). `PUT` `{items: 1–50 of {id (the phone's UUIDv7), name (≤ 60),
  source, recipe, panels (of light, color, effects, detail, optics, crop), tag? (≤ 40), film? (≤ 40),
  credit? (≤ 120)}}` → `201 {items, created}` (200 when every id was there already): each added or
  replaced by its id in one commit; its recipe checked as a recipe put is, every key in a panel named
  (else 422), stored canonical and at most 4 KB; past 500 looks in all `409 conflict`, the whole request
  refused. A look's white balance is relative (its Temperature read against 5,500 K, its Tint against
  0): the phone applies it as a shift of the photo's own. `PATCH /v1/photos/looks/:lid` `{name?,
  recipe?, panels?}` → `{look}` (a rename, or Update from current edit); `DELETE` → `{ok}`; an unknown
  look is 404. Looks leave no ledger row: applying one is the recipe `PUT` above, with its undo. Core
  step 45.
- `POST /v1/photos/paste` `{ids (1–20 photos), panels (of light, color, effects, detail, optics,
  crop), recipe (the copy's keys, each in a panel named, or 422)}` → `{items: [{id, changed, recipe,
  before}], ledger_id}` (`shared/contract/photos-paste.ts`): each photo's recipe with the named
  panels' keys replaced by the copy's (a key left out is its default), canonical and hashed as the
  recipe `PUT`; a photo whose edit is replaced gets an automatic version of it first (the caps above).
  All or nothing: a photo not on the shelf (or in Recently deleted) is 404 and nothing is written. One
  ledger row whose undo (`photo.paste`) puts each changed photo's recipe back, except one edited since
  (409 when that is all of them). The request's hash (photos, panels, copy) rides on the row: the same
  paste again changes nothing and answers that row's `ledger_id` (from the last hour), else `null`.
  No schema change.

### 11.27 The workshop's files (P9)

Files of any kind the owner sends from the phone for the agent that builds Thunderhead with them: a
RAW to test the editor on, another app's export to compare with (`shared/contract/workshop.ts`,
`backend/src/areas/workshop/`). The owner's device only. The private bucket is the only record: no
table and no rows.

- `PUT /v1/workshop/:id/parts/:n?bytes=<the whole file's size>` (raw bytes; `TH-File-Name`,
  URL-encoded; `TH-Sha256`, the piece's own) → `{n, have}`. `:id` is the client's UUIDv7 for the
  file. A file is sent in pieces of exactly 8 MiB but the last (`WORKSHOP_LIMITS.part_bytes`), in any
  order; each is streamed into the bucket as `workshop/<id>/<n:0001>` with the file's name and size
  as its metadata, and kept only when its bytes match the hash (`422` otherwise, as for a piece
  whose `Content-Length` is not its size). The same piece again replaces it. Another name or size
  under an id that has pieces is `409 conflict`. A file over 512 MiB is `413`; when every file
  together would pass 4 GiB the piece is `422` (`bytes`: the workshop is full), so the bucket's free
  allowance is never passed.
- `GET /v1/workshop` → `{items: [{id, name, bytes, parts, have, at}], bytes, limit, part_bytes}`:
  the files newest first, read from the bucket, each with the pieces that are in (a file half sent
  goes on from there), and the room taken of the room there is.
- `DELETE /v1/workshop/:id` → `{removed}`: every piece of the file; `404` when there is none.

Nothing else in the Worker reads these files and no agent key may call these routes. A session the
owner gave the account's storage to reads the pieces from the bucket and joins them
(`scripts/workshop.mjs`). They stay until the owner removes them.

One file there is the phone's own: `editor-timings.json`, which home sends a while after it opens
(`frontend/th/workshop/timings.js`; at most once in six hours, only when the editor has kept a new
timing, the one before it removed). It holds how long the editor took on this phone to open a photo
(with the decoder's start-up and decode), to have its full-size pixels, to show them and to export,
as numbers and a few fixed words (`timings-core.js` keeps known fields only), never a photo, a name
or a setting. Off with Settings › Privacy and data › Editor timings.

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

From P2 this table is data: `shared/contract/routes.ts` is the source the Worker's guards and the scope test read, and [CONTRACT.md](CONTRACT.md) lists every row with its status. A row with `key` takes, of its agent roles, only the one key of exactly that name (a device is the owner and needs none): the import's `import-once`, which the owner makes for that run only (SETUP.md L2), so no routine's key can write "old" owner messages that memory would take as the owner's words. Rows that wait on the private bucket (SETUP.md J2) are marked `deferred` there: `POST /v1/import/phone`, `POST /v1/media/sign`.

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
| `POST /v1/ops/reports` | D | P8 |
| `GET /v1/ops/reports` | D C N R | P8 |
| `POST /v1/live/ticket`, `GET /v1/live` | D | P2 |
| `GET /v1/live/wait` | C N R | P2 |
| `GET /v1/changes` | D C N R | P2 |
| `GET /v1/threads*`, `GET /v1/mind/wakes` | D C N R | P2 |
| `PUT /v1/threads/:id/off-record`, `DELETE /v1/threads/:id`, `POST /v1/threads/:id/restore`, `GET /v1/threads/deleted` | D | P2 |
| `PATCH /v1/threads/:id` | C N | P2 |
| `POST /v1/threads/:id/continue`, `PUT /v1/threads/:id/title`, `POST /v1/mind/typing` | D | P2 |
| `PUT /v1/messages/:id` | D C (N R: `error` kind to the system thread) | P2 |
| `PATCH /v1/messages/:id` | C | P2 |
| `PUT /v1/files/:id` | D C | P2 |
| `POST /v1/dictate` | D | P2 |
| `GET /v1/files/:id` | D C N | P2 |
| `GET /v1/search` | D C N | P2 |
| `POST /v1/mind/brief`, `/status`, `/notes`, `/taint`; `GET /v1/mind/pending` | C N R | P2 |
| `POST /v1/mind/night` | N | P3 |
| `GET /v1/mind/day/:day` | N | P3 |
| `GET /v1/ledger` | D C N R | P2 |
| `PUT /v1/ledger/:id` | C N R | P2 |
| `POST /v1/ledger/:id/undo` | D C | P2 |
| `PUT /v1/verbs/:id`, `POST /v1/verbs/plan` | C N | P2 |
| `GET /v1/verbs/pending`, `POST /v1/verbs/:id/claim`, `/result` | D | P2 |
| `GET /v1/verbs/scheduled`, `POST /v1/verbs/:id/cancel` | D C N | P2 |
| `GET /v1/routines`, `POST /v1/routines/:id/switch` | D C N | P2 |
| `DELETE /v1/routines/:id` | D | P2 |
| `GET /v1/surfaces` | D C N R | P2 |
| `PUT /v1/surfaces/:app/:slot` | C N | P2 |
| `DELETE /v1/surfaces/:app/:slot` | D C N | P2 |
| `POST /v1/surfaces/topics/:key/reopen` | D; C with `by_message` | P9 |
| `POST /v1/surfaces/topics/:key/said` | C N | P9 |
| `GET /v1/memory/*` | D C N (reflex reads no memory, RUNTIME.md §7.1) | P3 |
| `PATCH /v1/memory/open-threads/:id` | D C N | P3 |
| `POST /v1/memory/ops` | D C N | P3 |
| `PUT /v1/memory/day-notes/:day` | D N | P3 |
| `PUT /v1/memory/open-threads/:id` | D C N | P3 |
| `POST /v1/import/runs` | D C (agents: the key `import-once` only) | P3 |
| `POST /v1/ops/import/parts`, `PUT /v1/ops/import/manifest/:run_id` | C (the key `import-once` only) | P3 |
| `GET /v1/import/runs/:id` | D C N R | P3 |
| `PUT /v1/proposals/:id` | C N R | P4 (P3 for class `memory_big`, and class `delete` with op `memory.forget`) |
| `GET /v1/proposals` | D C N R | P4 (P3 for the classes above) |
| `POST /v1/proposals/:id/decide` | D; C with `by_message` | P4 (P3 for `memory_big` and `memory.forget`) |
| `POST /v1/proposals/:id/cancel` | D C N R | P4 |
| `POST /v1/ops/backups/run`, `POST /v1/ops/drill/run` | N I | P4 |
| `GET /v1/ops/backups` | D C N R I | P4 |
| `POST /v1/evals/sandbox`, `GET /v1/evals/sandbox` | C N (with `TH-Sandbox: eval` only) | P4 |
| `PUT /v1/evals/runs/:id` | C N | P4 |
| `GET /v1/evals/runs` | D C N | P4 |
| `PUT /v1/predictions/:id` | N | P9 |
| `GET /v1/predictions`, `GET /v1/predictions/skill`, `GET /v1/predictions/calibration`, `GET /v1/insight`, `GET /v1/insight/topics` | D C N | P9 |
| `GET /v1/mind/watches`, `GET /v1/mind/usage` | D C N R | P9 |
| `GET /v1/ops/watchdogs` | D C N R I | P4 |
| `POST /v1/ops/watchdogs/:name/handled` | C N R | P4 |
| `POST /v1/ops/watchdogs/:name/drill` | D C | P4 |
| `POST /v1/ops/restore` | D C N R | P4 |
| `POST /v1/export`, `GET /v1/export/:id`, `GET /v1/export/:id/zip` | D | P4 |
| `PUT /v1/work/orders/:id`, `POST /v1/work/orders/:id/cancel` | C N (cancel also D) | P4 |
| `GET /v1/work/orders` | D C N R | P4 |
| `GET /v1/work/hello`, `POST /v1/work/claim`, `/v1/work/orders/:id/{heartbeat,result,fail,files}` | M | P4 |
| `/v1/work/thread*` | M D C N | P4 |
| `GET /v1/briefing` | D | P4 |
| `PUT /v1/briefing/report/:day` | N | P4 |
| `PUT /v1/briefing/place` | D | P8 |
| `GET /v1/briefing/calendar` | D C N | P8 |
| `PUT /v1/senses/batches/:id` | D | P5 |
| `POST /v1/senses/query` | C N R | P5 |
| `POST /v1/media/sign` | D (C N for `file:`) | P5 (P2 for `file:` refs) · built: `music:` refs for D (`book:` refs are not signed: Study reads books through `GET /v1/library/books/:id/file`); `file:` refs answer `not_signable`: chat files are read through `GET /v1/files/:id` |
| `GET /v1/music/catalog`, `GET /v1/music/waveforms/:id` | D | P5 |
| `GET /v1/music/tracks`, `PUT /v1/music/notes`, `GET /v1/music/find` | C N | P5 |
| `PUT /v1/music/history` (D; raw bytes ≤ 32 MiB, `TH-File-Name`, `TH-Sha256` → `200 {sha256, source, state: done}` for a file counted before, `202 … queued` otherwise; 422 for a file that is no export), `GET /v1/music/history` (D C N; the files and the artists resolved, counts only), `GET /v1/music/taste?limit=1–50` (C N; `TasteResponse`), `GET /v1/music/similar/:mbid` (C N; ListenBrainz's similar artists, kept a week; 503 `unavailable` when it can't answer and nothing is kept), `GET /v1/music/taste/weights` (D; `TasteWeightsResponse`: the DJ shuffle's weights by song id, `{on: false, weights: {}}` while `music.history` is off); find takes `history=1` (and a `music.play_mix` find gets it while `music.history` is on) ([MUSIC.md §16](../product/apps/MUSIC.md), `shared/contract/taste.ts`) | D C N | P5 |
| `GET /v1/music/mixes` | D C N | P5 |
| `GET /v1/music/mixes/:id` | D | P5 |
| `GET /v1/music/notes` | D C N | P5 |
| `PUT /v1/music/uploads/audio/:file`, `PUT /v1/music/uploads/art/:file`, `POST /v1/music/uploads/:op` | P (no bearer token: each request signed by an upload tool key) | P5 |
| `GET /v1/guitar/search`, `/songs/:id`, `/songs/:id/score`, `/gprotab/search`, `/gprotab/file`, `/sounds/:instrument/:file` | D | P6 |
| `GET /v1/podcasts/directory`, `/audio` | D | P8 |
| `GET /v1/podcasts/feed` | D N (N: a followed show's only, at most 40 a UTC day) | P8 |
| `PUT /v1/podcasts/progress`, `PUT /v1/podcasts/follows` | D | P8 |
| `GET /v1/podcasts/progress`, `GET /v1/podcasts/follows` | D N | P8 |
| `POST /v1/podcasts/follows/checked` | N | P8 |
| `GET /v1/library/books`, `GET /v1/library/books/:id`, `GET /v1/library/search` | D C N | P7 |
| `POST /v1/library/books`, `PATCH /v1/library/books/:id`, `PUT /v1/library/books/:id/parts/:n`, `POST /v1/library/books/:id/{complete,retry}`, `PUT /v1/library/positions/:book_id`, `GET /v1/library/highlights`, `PUT /v1/library/highlights/:id` | D | P7 |
| `POST /v1/library/ingest/claim`, `GET /v1/library/ingest/:job_id/file`, `PATCH /v1/library/ingest/:job_id`, `PUT /v1/library/books/:id/pages` | C N | P7 |
| `POST /v1/import/phone` | D | P1b |
| `GET /v1/jobs/next` | N | P5 |
| `POST /v1/jobs/:id/collect` | N I (I: the `jobs-audio` key) | P5 |
| `GET /v1/jobs`, `GET /v1/jobs/:id` | C N R I | P5 |
| `GET /v1/jobs/:id/spec`, `PUT /v1/jobs/:id/files/:name` | I (the `jobs-audio` key) | P5 |
| `GET /v1/music/pack` | D | P5 |
| `GET /v1/music/analysis/:id` | C N | P5 |
| `/v1/push/*` | D | P8 |
| `PUT /v1/pushes/:id` | C | P8 |
| `PUT /v1/reminders/:id`, `DELETE /v1/reminders/:id` | D C | P8 |
| `GET /v1/reminders` | D C N | P8 |

---

## 14. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| A1 | SIGN-IN.md replaces the review's `POST /v1/auth/setup-ticket` with the fingerprint flow, which this page follows. | Settled: decisions.md 2026-10-28 (fingerprint setup, no setup-ticket endpoint); ROADMAP P1 follows it |
| A2 | Do Workers Logs record the `?ticket=` query string of `/v1/live`? | Preview: connect once, read the log entry. If yes, keep the 30 s single-use rule and note it in SECURITY.md |
| A3 | Is `--tag` length-limited, and does `VERSION.tag` carry it? | `wrangler deploy --tag <sha12>` in preview; read `/v1/health` |
| A4 | Does a non-JSON platform error (1027, 1102) arrive with CORS headers so the page can read the status? | Force 1102 in preview with a CPU-burn route; check in Chrome |
| A5 | Is 600 requests/min per token right for the phone during a library sync? | Count requests in a P5 sync on the A15 |
