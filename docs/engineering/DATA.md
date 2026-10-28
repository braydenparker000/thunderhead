# Data

This page lists every place the Thunderhead stores data: each Durable Object table, each R2 key, the shared conventions, how schemas change, the daily row budget, and how data is backed up, restored and imported.
Read it before you write SQL, add a table, or touch a bucket. The wire shapes are in [API.md](API.md); the memory rules (what may become a fact, and so on) are in [MEMORY.md](../mind/MEMORY.md).
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **Structured data lives in Durable Object SQLite; files live in R2.** No D1, KV or Queues.
2. **Classes:** `Core` and `Auth` in v1. `Senses` and `Music` arrive in P5, `Library` in P7, each in its own deploy. Each class has one instance, named `owner`.
3. **IDs are UUIDv7 strings; times are integer ms UTC (`*_at`); `day` is the owner's logical day; pointers are `ref` strings.** Names are snake_case everywhere.
4. **Migrations are expand-only within a deploy.** A drop happens in a later deploy, after the code stopped using it. A new class ships alone.
5. **All SQL lives in the area's `store.ts`.** Every hot query has an `EXPLAIN QUERY PLAN` test: no full scan of a table that grows.
6. **Every index costs one extra row written per insert, update or delete.** Add one only when a query needs it, and record the reason in the schema comment.
7. **Steady writes stay ≤ 25,000 rows/day (25% of Free).** Bulk jobs take one shared lane capped at 40,000 rows/day. A watchdog fires at 70,000.
8. **Auth tables never leave `Auth`:** not in exports, not in backups, not in "download everything".
9. **`jarvis-music` is never deleted from.** `thunderhead-private` is Worker-only. `thunderhead-jobs` is written only by Actions.
10. **A backup counts only once it has been restored.** CI round-trips fixtures on every push. A monthly drill restores a real backup.
11. **Imports are idempotent.** A re-run changes 0 rows. Each import proves itself with counts plus 20 spot checks.

---

## 1. Storage map

| Data | Store | Class or bucket | Written by | Phase |
|---|---|---|---|---|
| Conversation (threads, messages) | DO SQLite | `Core` | owner, mind, Muse, Worker (system lines) | P2 |
| Ledger, proposals, verbs, surfaces | DO SQLite | `Core` | mind, owner (approve/undo), Worker | P2–P4 |
| Memory (facts, day notes, open threads, session notes) | DO SQLite | `Core` | mind (validated), owner | P3 |
| Wakes, leases, errors, settings, perf | DO SQLite | `Core` | Worker, phone (errors, perf) | P1–P2 |
| Password, sessions, agents, push subscriptions | DO SQLite | `Auth` | owner (sign-in, Settings) | P1 |
| Events (90 days), rollups | DO SQLite | `Senses` | phones (sealed batches) | P5 |
| Music catalog and stats | DO SQLite | `Music` | upload tool, nightly rollup, validated job results | P5 |
| Books, pages, verse refs, highlights | DO SQLite | `Library` | ingestion jobs, owner | P7 |
| Backups, events archive, books, files, imports, indexes, job results | R2 | `thunderhead-private` | Worker only | P1+ |
| Audio and art | R2 | `jarvis-music` | the reviewed upload path only | exists |
| Raw Actions results | R2 | `thunderhead-jobs` | Actions only | P5 |
| Offline songs, PDFs, podcast downloads | OPFS on the phone | — | the phone | P5+ |
| Auth token, outbox, surfaces cache | IndexedDB on the phone | `th-auth`, `th-data` | the phone | P1+ |
| The ported apps' own data (plays, ratings, playlists, prefs, songs, follows, progress, add-ons) | localStorage and IndexedDB on the phone, new origin, under the apps' old names (`claude-player`, `jarvis.guitar.v2`, `jarvis.podcasts.v1`, `jarvis-podcasts`, `mymedia.*`, `astra.v2.*`) | — | the ported apps, unchanged; seeded once by the `/import/` page | P1b, until each app's data move |

The instance is created with `env.<CLASS>.getByName('owner', { locationHint: 'enam' })`. The hint is a constant in `backend/src/lib/objects.ts`, so placement never depends on who calls first (a CI runner, say).

---

## 2. Conventions

### 2.1 IDs

| Kind | Format | Made by |
|---|---|---|
| Records the client creates (messages, events, verbs the phone queues, proposals the mind opens) | UUIDv7, lowercase, 36 chars | The creator. `backend/src/lib/ids.ts` and `frontend/th/ids.js` (`randomUUIDv7` doesn't exist in Workers) |
| Records the server creates (ledger rows, wakes, jobs) | UUIDv7 | Worker or DO |
| Session IDs (the public handle in the device list) | UUIDv7 (the token hash, not this id, is the secret) | `Auth` |
| Tokens | `th1_` (device), `thm_` (mind roles), `ths_` (Muse), `thc_` (CI), `thw_` (30 s live ticket); format and checksum in [SECURITY.md §5.1](SECURITY.md). Stored only as SHA-256. | `Auth` (tickets: `Core`) |
| Ordered feeds | `seq INTEGER PRIMARY KEY` (rowid) next to the UUID | SQLite |
| Content-addressed files | lowercase hex sha256 of the bytes | uploader |
| Imported rows | Deterministic UUIDv7: the 48-bit time field = the old row's created time; the random bits = the first 74 bits of `sha256("<dataset>:<old_id>")`, with version and variant bits set **[proposal]**. Re-runs produce the same ID with no mapping table. | importer |

Acceptance: a unit test generates 10,000 IDs in one ms and checks they are unique and sort in creation order. An import test checks the same old row maps to the same new ID twice.

### 2.2 Time

- `*_at` columns are integer ms since the epoch, UTC.
- `day` is `YYYY-MM-DD` in the owner's **logical day**, which ends at 04:00 local time. Local time comes from the setting `owner.tz` (an IANA name, set from the phone with `Intl.DateTimeFormat().resolvedOptions().timeZone`). It is kept in `Core.settings`, not in the public `wrangler.jsonc` **[proposal]**.
  - Messages take the `day` of the thread they belong to. The day rolls at 04:00, but only after 60 quiet minutes, so a late conversation stays on the earlier day.
  - Events and other rows take `day = local_date(at − 4 h)`. So an event at 04:30 belongs to the new day even if the roll waited for a late chat. That gap is accepted.
  - A change to `owner.tz` applies from the next roll.
- Durations are integer ms (`*_ms`). Hour-precision columns (`last_seen_at`) are floored to the hour to save writes.

Acceptance: unit tests for `logicalDay(at, tz)` across a DST change, at 03:59 and 04:00, and over New Year.

### 2.3 Refs

A `ref` points at one thing anywhere in the system. The grammar lives in `shared/contract/refs.ts`:

```
ref      = kind ":" id [ "#" fragment ]
kind     = [a-z][a-z0-9]{1,15}
id       = [A-Za-z0-9._:/-]{1,160}
fragment = [A-Za-z0-9._:-]{1,64}
```

| Kind | Example | Points at |
|---|---|---|
| `msg` | `msg:0192f0c4-…` | a message |
| `thread` | `thread:0192f0c4-…` | a conversation thread |
| `day` | `day:2026-10-28` | a day note / a logical day |
| `fact` | `fact:0192f0c4-…` | a memory fact |
| `open` | `open:0192f0c4-…` | an open thread (commitment) |
| `ledger`, `proposal`, `verb`, `event`, `file` | `ledger:0192…` | those records |
| `import` | `import:0192…` | a raw imported document (`import_items`), used as evidence for facts converted from the old notebook |
| `app` | `app:music` | an app |
| `setting` | `setting:owner.tz` | a setting |
| `music` | `music:1234`, `music:1234#art` | a track (and its cover) |
| `tab` | `tab:song-77#b12-16` | bars of a tab |
| `book` | `book:0192…#p212` | a book page |
| `verse` | `verse:gen/1/1-3` | a scripture reference (book code / chapter / verses) |
| `podcast` | `podcast:feed-9/ep-41` | a feed or episode |
| `astra` | `astra:movie:tt0000001` | an Astra title |
| `media` | `media:vid-88` | a My Media item |
| `board` | `board:2026-10-28#s3` | a Board story |

- A new kind is added in `refs.ts` with an app doc that defines it. An unknown kind is rejected with `422 validation`.
- Refs are opaque to the client except for `kind`. The Worker maps media refs to R2 keys, so the bucket layout never leaks into the client.

### 2.4 Columns

- `TEXT` for strings and UUIDs; `INTEGER` for times, counts and booleans (0/1); `REAL` only for confidence and probabilities; `BLOB` only for hashes and salts in `Auth`.
- JSON columns end in `_json`. Each holds an object with `"v": <int>` at the top.
- `sensitivity INTEGER` is 0 (normal) or 1 (private). Rules for 1 are in [PRIVACY.md](PRIVACY.md).
- `origin TEXT` is one of `owner_device | mind | muse | worker | system | import | external`. The Worker sets it from the principal, never from the body.
- `actor TEXT` is one of `owner | mind:chat | mind:night | mind:reflex | muse | ci | worker`.
- Requests with a client ID also store `req_sha256` (SHA-256 of the canonical JSON body) so that a retry can be compared cheaply ([API.md §7](API.md#7-idempotency)).

---

## 3. Shared machinery in every class

`backend/src/objects/base.ts` (`OwnerObject extends DurableObject`) gives each class these tables and behaviours.

| Table | Columns | Purpose |
|---|---|---|
| `_migrations` | `version INTEGER PK, name TEXT, kind TEXT ('expand'\|'contract'), applied_at INTEGER, bookmark TEXT` | Schema version, plus the PITR bookmark taken just before each step |
| `jobs` | `id TEXT PK, kind TEXT, state TEXT ('queued'\|'running'\|'paused'\|'done'\|'failed'), due_at INTEGER, payload_json TEXT, cursor_json TEXT, attempts INTEGER, last_error TEXT, rows_written INTEGER, created_at INTEGER, updated_at INTEGER` · index partial `(due_at) WHERE state IN ('queued','paused','running')` | Chunked alarm jobs ([JOBS.md §4](JOBS.md#4-chunked-durable-object-jobs)) |
| `meter` | `day TEXT PK, rows_written INTEGER, rows_read INTEGER, bulk_rows_written INTEGER, rpc_calls INTEGER, updated_at INTEGER` | Row accounting from `cursor.rowsWritten/rowsRead` |

- **Meter flush.** Counts build up in memory and are written at most once per 60 s, inside a write transaction that is happening anyway. A count lost when the object is evicted is accepted (the meter is a guide, not billing).
- **Alarm.** After any change to `jobs`, `setAlarm(min(due_at))` runs, but only when that time differs from the current alarm (each call is 1 row written).
- **Export hooks.** `exportTable(name, cursor, limit)` and `importRows(table, rows, mode)` are used by backups, restores and tests.
- **Deep health.** `health()` returns `{schema_version, db_bytes: sql.databaseSize, jobs_backlog, last_alarm_at, meter_today}`.

---

## 4. `Core` tables

All of these live in instance `Core/owner`. "Phase" is when the table first appears.

### 4.1 Settings, ops, the feed and the mind's bookkeeping

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `settings` | `key TEXT PK, value_json TEXT, updated_at INTEGER, actor TEXT` | — | P1 |
| `changes` | `seq INTEGER PK, kind TEXT, ref TEXT, at INTEGER` | — | P1 |
| `errors` | `fingerprint TEXT PK, source TEXT ('client'\|'worker'\|'do'\|'job'\|'csp'), route TEXT, code TEXT, message TEXT (≤ 300 chars, scrubbed), count INTEGER, first_at INTEGER, last_at INTEGER, last_build INTEGER, resolved_at INTEGER` | — | P1 |
| `perf_days` **[proposal]** | `(day TEXT, metric TEXT) PK, p50 REAL, p75 REAL, p95 REAL, n INTEGER` WITHOUT ROWID | — | P1 |
| `live_tickets` | `hash TEXT PK, session_id TEXT, expires_at INTEGER, used_at INTEGER` WITHOUT ROWID | — | P2 |
| `wakes` | `id TEXT PK, at INTEGER, task TEXT ('chat'\|'night'\|'reflex'), reason TEXT ('prewarm'\|'message'\|'requeue'\|'roll'\|'schedule'\|'watchdog:<name>'\|'manual'), status TEXT ('fired'\|'claimed'\|'ended'\|'unclaimed'\|'failed'), fired_at INTEGER, fire_status INTEGER, fire_error TEXT, session_id TEXT, claimed_at INTEGER, claim_match TEXT ('exact'\|'loose'\|'manual'), retry_of TEXT, first_reply_at INTEGER, ended_at INTEGER, end_reason TEXT` | partial `(at) WHERE status IN ('fired','unclaimed')` | P2 |
| `leases` | `task TEXT PK, session_id TEXT, acquired_at INTEGER, renewed_at INTEGER` WITHOUT ROWID | — | P2 |
| `mind_sessions` **[proposal]** | `session_id TEXT PK, role TEXT, wake_id TEXT, claimed_at INTEGER, th_version TEXT, constitution_sha256 TEXT, laws_pinned INTEGER, tainted_at INTEGER, taint_source TEXT, ended_at INTEGER` | — | P2 |
| `night_runs` | `day TEXT PK, started_at INTEGER, step INTEGER, steps_json TEXT, done_at INTEGER, session_id TEXT` | — | P3 |
| `topics` **[proposal]** | `topic_key TEXT PK, last_shown_at INTEGER, ignored_at INTEGER, shown_count INTEGER` WITHOUT ROWID | — | P2 |
| `op_batches` | `key TEXT PK, route TEXT, req_sha256 TEXT, status INTEGER, result_json TEXT, at INTEGER` WITHOUT ROWID | — | P2 |

- `changes.kind` ∈ `message | thread | ledger | proposal | verb | surface | notice | fact | day_note | open_thread | setting | mind_status | error`.
- `settings` keys used by the engineering side: `owner.tz`, `min_client`, `bulk.lane` (which object holds the bulk lane, see §8.3), `day.current` (the open logical day), `roll.last_at`, `mind.status`. Product settings are listed in [MENU-AND-SETTINGS.md](../product/MENU-AND-SETTINGS.md).
- The wake and lease semantics are owned by [RUNTIME.md §4](../mind/RUNTIME.md). Storage rule **[proposal]**: every `th` call renews the chat lease for 90 s, but `renewed_at` is written only when the stored value is ≥ 30 s old. A listening hour then costs ≤ 120 writes instead of one per call.
- `mind_sessions` holds per-session state the Worker enforces: taint ([MEMORY.md §7](../mind/MEMORY.md)) and the constitution pin. Agent requests name their session with the header `TH-Session` ([API.md §1](API.md#1-request-basics)). `taint_source` keeps the tool name only, never the URL.
- `topics` backs the voice-ladder repeat rule (a dismissed `topic_key` stays quiet for 14 days, [BEHAVIOR.md §3](../mind/BEHAVIOR.md)).
- `errors.message` is scrubbed before storage: no URLs with query strings, no token-like strings, nothing longer than 300 characters.

### 4.2 Conversation

The columns match [MEMORY.md §2](../mind/MEMORY.md), which owns their meaning. This page owns keys, indexes and the engineering-only columns marked *eng*.

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `threads` | `id TEXT PK, day TEXT, kind TEXT ('daily'\|'muse'\|'imported'), title TEXT, title_source TEXT ('auto'\|'mind'\|'owner'), summary TEXT (≤ 400 chars), status TEXT ('open'\|'filed'), continues TEXT, started_at INTEGER, filed_at INTEGER`; *eng:* `message_count INTEGER, updated_at INTEGER` | unique partial `(day) WHERE kind='daily'`; `(status, updated_at)` | P2 |
| `messages` | `seq INTEGER PK, id TEXT UNIQUE, thread_id TEXT, created_at INTEGER, author TEXT ('owner'\|'mind'\|'system'\|'muse'), origin TEXT ('owner_device'\|'mind'\|'system'\|'muse'\|'import'), kind TEXT ('text'\|'voice'\|'progress'\|'card'\|'question'\|'error'), body TEXT (≤ 16,000 chars), reply_to TEXT, meta_json TEXT, attachments_json TEXT, device_id TEXT, session_id TEXT, delivered_at INTEGER, acked_at INTEGER, answered_at INTEGER`; *eng:* `req_sha256 TEXT` | `(thread_id, seq)` | P2 |
| `messages_fts` | FTS5 `(body)`, `content='messages'`, `content_rowid='seq'`, tokenizer `unicode61 remove_diacritics 2` | — | P2 |

- `seq` is the rowid (`INTEGER PRIMARY KEY`) so that FTS5's external content can use it; `id` is the UUID the clients use. MEMORY.md shows the same two columns the other way round; the columns and their meaning are identical.
- The owner never creates a thread. The Worker creates the `daily` thread for `day.current` on the first message of a logical day, and files it at the roll.
- A message is handed to a waiting mind session by `/v1/live/wait` (`delivered_at`), acknowledged by `th status working` or any post in the thread (`acked_at`), and answered when a mind message names it in `reply_to` (`answered_at`; earlier unanswered owner messages in the same thread are marked too **[proposal]**). Unacknowledged after 120 s → requeued ([RUNTIME.md §4.5](../mind/RUNTIME.md)).

### 4.3 Ledger, proposals, verbs, surfaces

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `ledger` | `seq INTEGER PK, id TEXT UNIQUE, at INTEGER, actor TEXT, session_id TEXT, kind TEXT ('memory'\|'arrangement'\|'verb'\|'deploy'\|'proposal'\|'mistake'\|'undo'\|'note'), what TEXT (≤ 200), why TEXT (8–500), ref TEXT, topic_key TEXT, undo_json TEXT, undoable INTEGER, status TEXT ('done'\|'undone'\|'failed'), tainted INTEGER, proposal_id TEXT`; *eng:* `op_json TEXT, verb_id TEXT, undone_at INTEGER` | — | P2 |
| `proposals` | `id TEXT PK, created_at INTEGER, created_by TEXT, class TEXT ('delete'\|'money'\|'access'\|'reach_people'\|'memory_big'), question TEXT (≤ 80), why TEXT (≤ 140), if_ignored TEXT, odds REAL, spec_json TEXT, spec_hash TEXT, status TEXT ('waiting'\|'approved'\|'rejected'\|'expired'\|'cancelled'\|'executed'), expires_at INTEGER, decided_by_device TEXT, decided_at INTEGER, executed_ledger_id TEXT, decided_via TEXT ('tap'\|'words'), decided_message_id TEXT`; *eng:* `options_json TEXT, result_json TEXT, req_sha256 TEXT` | partial `(created_at) WHERE status='waiting'` | P4 (`memory_big` in P3) |
| `verbs` | `id TEXT PK, created_at INTEGER, actor TEXT, verb TEXT, schema INTEGER, ref TEXT, args_json TEXT, device_id TEXT (NULL = any), status TEXT ('pending'\|'claimed'\|'done'\|'failed'\|'expired'), proposal_id TEXT, ledger_id TEXT, expires_at INTEGER, claimed_at INTEGER, claimed_by TEXT, claims INTEGER, done_at INTEGER, result_json TEXT, undo_json TEXT, req_sha256 TEXT` | partial `(created_at) WHERE status IN ('pending','claimed')` | P2 |
| `surfaces` | `(app TEXT, slot TEXT) PK, kind TEXT, schema INTEGER, payload_json TEXT, why TEXT, topic_key TEXT, ref TEXT, expires_at INTEGER, written_at INTEGER, actor TEXT, ledger_id TEXT` WITHOUT ROWID | — | P2 |
| `work_orders` | Columns as in [MUSE.md §3.1](../mind/MUSE.md), which owns them: `id TEXT PK, kind TEXT, assignee TEXT, title TEXT, spec_json TEXT, schema_json TEXT, personal INTEGER, approval_id TEXT, recurrence TEXT, deadline_at INTEGER, status TEXT ('queued'\|'claimed'\|'done'\|'rejected'\|'failed'\|'expired'\|'cancelled'), attempts INTEGER, created_by TEXT, created_at INTEGER, claimed_at INTEGER, heartbeat_at INTEGER, heartbeat_note TEXT, result_json TEXT, result_files_json TEXT, result_valid INTEGER, result_errors_json TEXT, finished_at INTEGER` | partial `(deadline_at) WHERE status IN ('queued','claimed')` | P4 |

- A ledger row stores its inverse in `undo_json` when it is written. `undoable = 0` marks exactly the ask-first classes, which go through `proposals`. The *eng* columns (`op_json`, `verb_id`, `undone_at`) are listed in the night's patch list for MEMORY.md, so both pages carry them.
- A proposal executes only after `POST /v1/proposals/:id/decide` whose body carries the same `spec_hash`: from a **device session** (`decided_via='tap'`, `decided_by_device` set), or from `mind:chat` citing the owner's own words (`decided_via='words'`, `decided_message_id` = an owner-device message the Worker has checked; [API.md §11.10](API.md#1110-proposals-decisions)). At most 3 are `waiting` at once (`409 decision_budget`); each expires 7 days after creation ([BEHAVIOR.md §3.5](../mind/BEHAVIOR.md)). The proposal status list adds `failed` **[proposal]** for an executor that errors after approval.
- A surface is replaced in place per `(app, slot)`. Its history is the ledger. Home lines are app `home`, slots `line.1`–`line.4`.

### 4.4 Memory

The columns match [MEMORY.md §2](../mind/MEMORY.md), which also owns the rules (sources, confidence, decay, taint). This section fixes keys, indexes and FTS.

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `facts` | `id TEXT PK, kind TEXT ('preference'\|'routine'\|'fact'\|'goal'\|'state'\|'rule'), about TEXT ('owner'\|'world'\|'person'), subject TEXT, text TEXT (≤ 280), tags_json TEXT, source TEXT ('user'\|'observed'\|'inferred'), confidence REAL, evidence_json TEXT (1–20 ids), valid_from INTEGER, valid_to INTEGER, recorded_at INTEGER, superseded_at INTEGER, superseded_by TEXT, last_confirmed INTEGER, sensitivity INTEGER, pinned INTEGER, may_raise INTEGER, written_by TEXT` | partial `(kind) WHERE superseded_at IS NULL` | P3 |
| `facts_fts` | FTS5 `(text, subject)`, `content='facts'` | — | P3 |
| `day_notes` | `day TEXT PK, summary TEXT (≤ 150 words), decisions_json TEXT, stats_json TEXT, importance INTEGER (1–10), written_by TEXT, version INTEGER, written_at INTEGER` | — | P3 |
| `day_notes_fts` | FTS5 `(summary)`, `content='day_notes'` | — | P3 |
| `open_threads` | `id TEXT PK, text TEXT (≤ 200), owner TEXT ('mind'\|'owner'), due_at INTEGER, tags_json TEXT, status TEXT ('open'\|'done'\|'dropped'), evidence_json TEXT, opened_at INTEGER, last_progress_at INTEGER, closed_at INTEGER, closed_why TEXT` | partial `(due_at) WHERE status='open'` | P3 |
| `session_notes` | `id TEXT PK, session_id TEXT, wake_id TEXT, role TEXT, thread_id TEXT, created_at INTEGER, body TEXT (≤ 120 words), open_items_json TEXT` | — | P2 |
| `import_items` | `id TEXT PK, run_id TEXT, dataset TEXT, key TEXT, body_json TEXT, converted_at INTEGER` | — | P3 |
| `imports` | `id TEXT PK, source TEXT ('old_worker'\|'phone'), dataset TEXT, r2_prefix TEXT, manifest_json TEXT, state TEXT ('queued'\|'running'\|'verifying'\|'done'\|'failed'), counts_json TEXT, report_json TEXT, started_at INTEGER, finished_at INTEGER` | — | P1b (`phone`), P3 (`old_worker`) |

- Facts are never edited in place. A change closes the old row (`superseded_at`, `superseded_by`) and inserts a new one. `forget` (owner only) hard-deletes the row and its FTS entry, and writes a ledger tombstone without the content.
- Decay is computed at read time and never written.
- `import_items` holds raw documents (the old notebook, for instance) until the mind converts them once. Converted rows are deleted 30 days after `converted_at`.
- MEMORY.md allows an `events` table in `Core` before `Senses` exists. Engineering keeps events out of `Core`: nothing on the phone emits events before P5, and phone performance goes to `perf_days` **[proposal]**. If an earlier need appears, the table goes into `Core` with the `Senses` columns (§6.1) and moves by a bulk job when `Senses` ships.

### 4.5 Later `Core` tables

`board(date TEXT PK, r2_key TEXT, top_line TEXT, read_at INTEGER)` arrives with the Board import in P3 ([MIGRATION.md §4](MIGRATION.md), [BRIEFING.md](../product/BRIEFING.md)). `lists` and `list_items` (playlists and watchlists, P5) are specified in [MUSIC.md](../product/apps/MUSIC.md). They follow this page's conventions.

---

## 5. `Auth` tables

Owned by [SIGN-IN.md](../product/SIGN-IN.md) and [SECURITY.md](SECURITY.md) for behaviour; storage is fixed here. **None of these tables is exported, backed up to R2 or included in "download everything".** PITR (inside Cloudflare) is the only copy.

| Table | Columns (PK first) | Notes |
|---|---|---|
| `credential` | `id INTEGER PK CHECK (id = 1), username TEXT, algo TEXT, n INTEGER, r INTEGER, p INTEGER, salt BLOB, hash BLOB, pepper_v INTEGER, version INTEGER, changed_at INTEGER` | Singleton. `hash = HMAC-SHA256(pepper, scrypt(NFKC(password), salt))` |
| `recovery` | `id INTEGER PK CHECK (id = 1), code_hash BLOB, created_at INTEGER, confirmed_at INTEGER, used_at INTEGER` | Singleton |
| `sessions` | `token_hash TEXT PK (hex SHA-256 of the token), id TEXT (UUIDv7, the public handle), pop_jwk TEXT (NULL in v1), label TEXT, platform TEXT, browser TEXT, model TEXT, standalone INTEGER, country TEXT, region TEXT, last_country TEXT, created_at INTEGER, last_seen_at INTEGER (hour), idle_expires_at INTEGER, revoked_at INTEGER, revoked_reason TEXT, credential_version INTEGER, stepup_at INTEGER` WITHOUT ROWID | Keyed by the hot lookup, so no index write per sign-in (measured, `backend/MEASUREMENTS.md` §2); device ids are found by scanning a handful of rows. 90-day idle expiry from `last_seen_at`, which is written at most once an hour. `revoked_reason` values in [SIGN-IN.md §3.2](../product/SIGN-IN.md) |
| `throttle` | `key TEXT PK, fails INTEGER, window_start INTEGER, last_at INTEGER, next_allowed_at INTEGER` WITHOUT ROWID | Key = `<kind>:<source>` or `<kind>:acct`; kind ∈ `signin`, `recover`, `reset`, `setup`, `pwcheck:<session id>`; source = first 32 hex of `HMAC-SHA256(IP_HASH_KEY, "src:" + UTC date + ":" + IPv4 or IPv6 /64)`. Rules in [SIGN-IN.md §6.1](../product/SIGN-IN.md). Rows that can no longer delay anything are deleted by the cron after 2 days |
| `notices` | `id TEXT PK, kind TEXT ('new_device'\|'password_changed'\|'recovery_used'\|'reset_pending'\|'reset_cancelled'\|'reset_used'\|'agent_key_created'), session_id TEXT (the session it is about; every other active session sees it), args_json TEXT, created_at INTEGER, acked_at INTEGER, answer TEXT, expires_at INTEGER` | Lifetimes per kind and copy owned by [SIGN-IN.md §11.4](../product/SIGN-IN.md); wire shape `Notice` in [API.md §11.2](API.md#112-auth) |
| `tickets` | `id TEXT PK, kind TEXT ('setup'\|'reset'), fingerprint TEXT, source TEXT ('mind'\|'github'\|'dashboard'), requested_at INTEGER, usable_after INTEGER, expires_at INTEGER, used_at INTEGER, cancelled_at INTEGER` | A used or cancelled fingerprint can never open another ticket |
| `agents` | `id TEXT PK, name TEXT UNIQUE (≤ 32), role TEXT ('mind:chat'\|'mind:night'\|'mind:reflex'\|'ci'\|'muse'), token_hash BLOB UNIQUE, created_at INTEGER, created_on TEXT (device label), last_used_at INTEGER (hour), last_country TEXT, revoked_at INTEGER` | Issued from Settings → Agents; the key is shown once |
| `push_subs` | `id TEXT PK, session_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, created_at INTEGER, last_ok_at INTEGER` | Deleted in the same transaction as the session's revoke. P8 |

Never stored anywhere: raw IP addresses, the full user-agent, city, passwords, recovery codes, request bodies of `/v1/auth/*`.

---

## 6. Later classes

### 6.1 `Senses` (P5, its own deploy)

| Table | Columns | Indexes | Retention |
|---|---|---|---|
| `batches` | `batch_id TEXT PK, device_id TEXT, received_at INTEGER, n INTEGER, sha256 TEXT` WITHOUT ROWID | — | 30 days |
| `events` | `seq INTEGER PK, id TEXT, at INTEGER, day TEXT, app TEXT, type TEXT, ref TEXT, data_json TEXT, device_id TEXT, origin TEXT, sensitivity INTEGER` | **one only:** `(day, type)` | 90 days hot, then the R2 archive only |
| `rollups` | `(day TEXT, type TEXT, ref TEXT) PK, n INTEGER, sum_ms INTEGER` WITHOUT ROWID | — | forever (~300 rows/day) |
| `exports` | `day TEXT PK, r2_key TEXT, n INTEGER, sha256 TEXT, at INTEGER` | — | forever |

- Dedupe is by sealed batch, not by event ID: one `batches` row per batch instead of a unique-index write per event.
- `app` is derived from the `type` prefix (`music.skip` → `music`). The server stamps `day`, `device_id` and `origin`.

### 6.2 `Music` (P5, its own deploy)

`tracks(id TEXT PK, sha256 TEXT, size INTEGER, audio_key TEXT, cover_key TEXT, title, artist, album, year INTEGER, duration_ms INTEGER, record_json TEXT, added_at, updated_at)` with index `(sha256)`. `track_stats(track_id TEXT PK, plays, skips, last_played_at, rating)`, rebuilt nightly from `Senses.rollups`. `catalog_log(seq PK, at, op, track_id, before_json)` for undo. `analysis(sha256 TEXT PK, v INTEGER, result_json TEXT, applied_at)` from validated jobs, and `external_jobs(id TEXT PK, kind, v, spec_json, state ('issued'|'validating'|'applied'|'rejected'|'expired'), issued_at, expires_at, collected_at, counts_json)` for the Actions specs ([JOBS.md §3](JOBS.md#3-actions-jobs-audio-analysis)). Product fields are in [MUSIC.md](../product/apps/MUSIC.md).

### 6.3 `Library` (P7, its own deploy; shardable as `library:<shelf>`)

`books(id PK, title, author, kind, pages, r2_key, sha256, added_at, ingested_at)`. Books include the owner's own licensed copies of the canon scriptures (owner ruling 2026-10-27), stored like any book: privately, behind sign-in, never in the repo. Talks and other Church material are not stored; they are cited by paragraph with a link. `pages(rowid PK, book_id, page_index, page_label, text)` with UNIQUE `(book_id, page_index)`. `pages_fts` FTS5 with `content='pages'`. `verse_refs(book_code, chapter, v_start, v_end, book_id, page_index, weight, in_heading)` with index `(book_code, chapter)`. `highlights(id PK, book_id, page_index, ref, text, note, created_at, updated_at)`. `positions(book_id PK, page_index, at)` (one row per book, written at most once per page turn and at most every 10 s). Product fields are in [STUDY.md](../product/apps/STUDY.md).

The FTS cost per page is unknown (open question D3). Ingestion is a bulk job under the lane cap.

---

## 7. R2 buckets and key layout

### 7.1 `thunderhead-private` (Worker binding `VAULT`; never public)

| Prefix | Key pattern | Contents | Written by | Kept |
|---|---|---|---|---|
| `backups/` | `backups/<YYYY-MM-DD>/<class>/<table>.<part:0000>.jsonl.gz`, `backups/<date>/manifest.json` | Weekly per-table export | `export.weekly` job | 8 weekly + 12 monthly |
| `events/` | `events/<YYYY>/<MM>/<DD>.jsonl.gz` | Daily events archive | `events.export` job (P5) | forever |
| `books/` | `books/<book_id>.pdf` ([STUDY.md](../product/apps/STUDY.md) §2.1) | Study PDFs, including the owner's licensed scripture copies (owner ruling) | upload route (P7) | until the owner deletes (proposal) |
| `chat/files/` | `chat/files/<YYYY>/<MM>/<uuidv7>.<ext>` (imported files keep their old keys under this prefix) | Chat attachments, photos, voice memos | upload route; import I6 | forever unless deleted |
| `muse/files/` | `muse/files/<id>` | Muse files (imported, then new) | import I4; work orders | forever unless deleted |
| `takes/` | `takes/<uuidv7>.<ext>` | Guitar recordings the owner sends | P6 | owner-controlled |
| `indexes/` | `indexes/<kind>/<build>.json.gz`, `indexes/<kind>/latest.json` | Phone-loaded indexes (music search, study) | jobs | latest 3 builds |
| `imports/` | `imports/old/<run_id>/<instance>/<table>/part-<nnnn>.jsonl.gz` + `imports/old/<run_id>/manifest.json`; `imports/phone/<import_id>.json.gz` | Raw imports | `POST /v1/ops/import/parts`; `/v1/import/phone` (P1b) | until the owner approves deleting them, after the last app's data move (P8) and the old Worker's retirement ([PRIVACY.md §2](PRIVACY.md)) |
| `jobs/` | `jobs/<kind>/<sha256>.v<n>.json` | Validated Actions results | `/v1/jobs/:id/collect` | forever (small) |
| `profile/` | `profile/<YYYY-MM-DD>.json` | Weekly snapshot of the rendered profile | night shift | 104 weeks |
| `drills/` | `drills/<YYYY-MM>/report.json` | Restore drill reports | drill job | forever |
| `exports/` | `exports/<uuidv7>/manifest.json` | "Download everything" manifests (they point at backup keys) | P4 | 7 days |
| `ops/` | `ops/restores/<uuidv7>.json`, `ops/deploys/<YYYY-MM-DD>.jsonl` | Restore records kept outside the restored object; deploy records | Worker | forever |

### 7.2 `jarvis-music` (Worker binding `MEDIA`; shared with the old Worker)

`native/audio/<sha256>.opus`, `native/art/<sha256>.<ext>`, plus the existing catalog files. The new Worker reads by presigned GET and writes only through `backend/src/areas/music/upload.ts`. It never deletes (rule 9 at the top; the `no-music-delete` test). Uploads use `Cache-Control: private, max-age=31536000, immutable`.

### 7.3 `thunderhead-jobs` (Worker binding `JOBS`, read + delete; Actions has write)

`results/<kind>/<job_id>/<sha256>.json` and `results/<kind>/<job_id>/manifest.json`. An R2 lifecycle rule deletes objects 14 days after upload **[proposal]**. Keys and bodies hold no titles or names, only hashes and numbers.

### 7.4 Media ref → key map (used by `POST /v1/media/sign`)

| Ref | Bucket | Key | Lookup |
|---|---|---|---|
| `music:<id>` | `jarvis-music` | `tracks.audio_key` | 1 row in `Music` |
| `music:<id>#art` | `jarvis-music` | `tracks.cover_key` | 1 row in `Music` |
| `book:<id>` | `thunderhead-private` | `books.r2_key` | 1 row in `Library` |
| `file:<id>` | `thunderhead-private` | `chat/files/…` from the message attachment | 1 row in `Core` |
| `index:<kind>` | `thunderhead-private` | `indexes/<kind>/latest.json` → named build | none |
| `backup:<date>` | `thunderhead-private` | `backups/<date>/…` | device session only (P4) |

Anything else returns `422 validation` with `details: [{ref, reason:'not_signable'}]`.

---

## 8. Row-write budget (Free plan)

### 8.1 The limits that bind

| Limit (per account, per day, resets 00:00 UTC) | Free | Our target |
|---|---|---|
| DO rows written | 100,000 | steady ≤ 25,000; bulk lane ≤ 40,000; ≥ 35,000 headroom |
| DO rows read | 5,000,000 | ≤ 1,500,000 |
| DO requests | 100,000 | ≤ 15,000 |
| DO duration | 13,000 GB-s | ≤ 2,600 (one object awake 24 h = 10,800) |
| Storage | 5 GB total, 1 GB per object | watch at 700 MB per object |

Rules from the platform that drive the numbers: every index entry touched is one more row written; deletes count; `setAlarm()` is 1 write; FTS5 virtual-table writes count.

### 8.2 Steady-state budget per table (a heavy day)

"Per op" is an estimate. The cost tests ([TESTING.md §6](TESTING.md#6-cost-tests)) pin the real number per endpoint, and this table is updated from them.

| Class.table | Ops per heavy day | Rows written per op (row + indexes + FTS + feed) | Daily writes |
|---|---|---|---|
| Core.messages (+fts, thread update, changes) | 300 messages | ~12 | 3,600 |
| Core.changes prune | 1 per change | 1 | ~1,000 |
| Core.ledger | 100 | ~4 | 400 |
| Core.verbs | 30 | ~10 (create, claim, done) | 300 |
| Core.surfaces | 20 | ~3 | 60 |
| Core.proposals | 5 | ~8 | 40 |
| Core.wakes | 40 | ~8 | 320 |
| Core.leases (written at most every 30 s while a session lives) | ≤ 120/h, ~6 h | 1 | ~720 |
| Core.facts (+fts, ledger) | 50 ops | ~10 | 500 |
| Core.day_notes, open_threads, session_notes | ~30 | ~4 | 120 |
| Core.errors | ≤ 200 upserts (capped) | 1 | 200 |
| Core.perf_days, settings | ~25 | 1 | 25 |
| meter + jobs + alarms (all classes) | — | — | ~1,000 |
| Auth (last_seen hourly, agents last_used hourly, notices) | — | — | ~200 |
| **Subtotal P1–P4** | | | **~8,600** |
| Senses.events (3,000 events × row + 1 index; same again pruned 90 days later) | — | 2 + 2 | 12,000 |
| Senses.batches (+prune), rollups | 150 batches; 300 rollups | ~2 | 900 |
| Music.track_stats nightly | ≤ 200 tracks | 2 | 400 |
| Library.positions, highlights | ~200 | 1–3 | 300 |
| **Total steady (P5+)** | | | **~22,200 (22%)** |

### 8.3 The bulk lane

- One bulk job runs at a time, account-wide. `Core.settings['bulk.lane']` names the holder `{class, job_id, day}`. A job asks for the lane through the `ensureAlarm` RPC that `Core.tick` already makes every 15 minutes. **[proposal]**
- The lane holder may write 40,000 rows per day (`meter.bulk_rows_written`). At the cap the job sets `state='paused'` with `due_at` = next 00:05 UTC.
- If the account-wide total (the sum of every object's `meter.rows_written` today, gathered by `tick`) reaches 60,000, `tick` revokes the lane at once, even below the job's own cap.
- Lane users: imports, FTS reindex, music catalog import (on its own day), library ingestion, table restores, the monthly drill.

Acceptance: a vitest test with a fake meter at 39,990 runs one job step of 2,000 rows and sees the job pause at the step boundary, with `due_at` next 00:05 UTC.

### 8.4 Reads

- No request-path query may scan a growing table. Every hot query has an `EXPLAIN QUERY PLAN` test that rejects `SCAN <table>` without an index.
- Search queries are capped at 20,000 rows read each (checked in cost tests at fixture scale).
- The weekly backup reads every row once (~0.5M rows at year 2).

---

## 9. Migrations

1. **Class declarations** use the classic `migrations` array in `backend/wrangler.jsonc`. An entry is never edited after it ships:
   ```jsonc
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["Core", "Auth"] },    // P1
     { "tag": "v2", "new_sqlite_classes": ["Senses"] },          // P5, deploy alone
     { "tag": "v3", "new_sqlite_classes": ["Music"] },           // P5, deploy alone
     { "tag": "v4", "new_sqlite_classes": ["Library"] }          // P7, deploy alone
   ]
   ```
   A deploy that adds a tag contains **no other change**, because `wrangler rollback` cannot cross a class lifecycle change. Renaming or deleting a class is an ask-first change (a delete destroys data).
2. **SQL migrations** live per class in `backend/src/objects/<class>.migrations.ts` as `{version, name, kind: 'expand'|'contract', sql: string[]}`. The constructor applies the pending ones inside `ctx.blockConcurrencyWhile`, one `transactionSync` per step. Before each step it records `getCurrentBookmark()` in `_migrations.bookmark`.
3. **Expand** may: create a table, add a nullable column or one with a default, create an index, create an FTS table and backfill it as a bulk job.
4. **Contract** (drop a column, table or index; rename) is allowed only when the code stopped reading and writing the thing in an earlier deploy that has been live for ≥ 7 days **[proposal]**. That keeps a rollback to the previous version data-safe.
5. **Never:** `CREATE TABLE IF NOT EXISTS` on each request, `PRAGMA table_info` patching, or a rename of a column in use.
6. **JSON shapes** evolve by bumping `"v"` inside the JSON. Readers accept `v` and `v-1`.
7. **Backfills** (filling a new column for old rows) run as bulk jobs, never in the constructor.

Acceptance (TESTING.md §7): from an empty database, all steps produce exactly the committed `backend/tests/migrations/<class>.schema.sql`. A fixture at version N-1 migrates with every row intact. A lint test fails any `DROP`, `RENAME` or `ALTER … DROP` in an `expand` step.

---

## 10. Retention and export inclusion

Retention of personal data is owned by [PRIVACY.md §2](PRIVACY.md); this table must match it, and a test fails if a table exists without a row here.

| Class.table | Retention | In weekly backup | In "download everything" |
|---|---|---|---|
| Core.settings | forever | yes | yes |
| Core.threads, messages | forever | yes | yes |
| Core.messages_fts, facts_fts, day_notes_fts | derived | no (rebuilt) | no |
| Core.ledger | forever (forget leaves a tombstone) | yes | yes |
| Core.proposals | 1 year after decided ([PRIVACY.md §2](PRIVACY.md)) | yes | yes |
| Core.verbs | done/failed/expired deleted 30 days after `done_at` or `expires_at` | yes | yes |
| Core.surfaces | expired rows deleted within 24 h of `expires_at` | yes | no |
| Core.work_orders | finished rows 180 days | yes | yes |
| Core.facts, day_notes | forever (facts until forgotten) | yes | yes |
| Core.open_threads | open: until closed; closed: 1 year | yes | yes |
| Core.session_notes | 180 days | yes | yes |
| Core.import_items | 30 days after conversion | yes | no |
| Core.imports | forever | yes | no |
| Core.wakes | 30 days | yes | no |
| Core.leases | live only | no | no |
| Core.live_tickets | deleted 1 h after `expires_at` | no | no |
| Core.mind_sessions | 90 days after `ended_at` | yes | no |
| Core.night_runs | 400 days | yes | no |
| Core.topics | forever (one row per topic key) | yes | no |
| Core.op_batches | 7 days (idempotency window for batch writes, [API.md §7](API.md#7-idempotency)) | no | no |
| Core.errors | 30 days after `last_at`; at most 1,000 fingerprints (oldest resolved go first) | yes | no |
| Core.perf_days | 400 days | yes | no |
| Core.changes | newest 10,000 rows | no | no |
| `jobs`, `_migrations` (all classes) | jobs done 30 days | manifest only (schema version) | no |
| `meter` (all classes) | 400 days | yes | yes |
| Auth.* | sessions deleted 30 days after revoke or expiry; throttle 24 h; notices 14 days | **never** | **never** |
| Senses.events | 90 days | archive in R2 daily instead | yes (the archive) |
| Senses.batches | 30 days | no | no |
| Senses.rollups | forever | yes | yes |
| Music.* | forever | yes | yes |
| Library.* except `pages_fts` | forever | yes | yes (PDFs by signed URL) |

Pruning runs in daily jobs (`prune.core`, `prune.senses`, …), each in steps of ≤ 2,000 deletes.

---

## 11. Backup, export and restore

### 11.1 Layers

| Layer | What | When | Restores |
|---|---|---|---|
| PITR | Cloudflare's 30-day point-in-time recovery for SQLite DOs | Always on. Bookmarks recorded before every migration, import and restore. Availability on Free is test X4. | A whole object to any time in the last 30 days |
| Weekly export | Per-table JSONL.gz in `thunderhead-private/backups/` | Sundays 02:30 local **[proposal]**, a job per class (`export.weekly`), ≤ 5,000 rows per part file | One table, or a whole object into a fresh instance |
| Events archive | Daily JSONL.gz | Day D exported at D+1 06:00 local; re-exported if late events arrive | Events beyond 90 days |
| Old Worker | The `jarvis-hub-api` (its data untouched; only its origin list gains the new site in P1b) | Until it retires after P8 | Pre-import history |

### 11.2 The manifest

```ts
type BackupManifest = {
  v: 1; date: string; class: 'core'|'senses'|'music'|'library';
  schema_version: number; bookmark: string | null; started_at: number; finished_at: number;
  tables: { name: string; rows: number; parts: { key: string; rows: number; bytes: number; sha256: string }[] }[];
};
```

A backup is complete only when `manifest.json` is written, and it is written last. A backup without a manifest is ignored and deleted by the next prune.

### 11.3 Restore paths

| Situation | Path | Who approves | Note |
|---|---|---|---|
| Bad data in the last 30 days, whole object | PITR: `onNextSessionRestoreBookmark(getBookmarkForTime(t))`, then `ctx.abort()` | `access`-class proposal, approved by device tap or the owner's own words | Recent ledger rows go back too, so the restore is also recorded **outside** the object, in `thunderhead-private/ops/restores/<uuidv7>.json` **[proposal]** |
| One table damaged | Bulk job reads `backups/<date>/<class>/<table>.*`, `mode: replace` or `merge` | `delete`-class proposal for `replace` | Under the bulk lane cap |
| Object lost, PITR unavailable | Restore every table into a fresh instance `owner-r<YYYYMMDD>`, check counts, then point the class at it with the Worker var `<CLASS>_INSTANCE` and deploy **[proposal]** | `access` proposal | Takes days for large objects because of the write cap |

The runbooks are in [OPERATIONS.md §4](OPERATIONS.md#4-restore-from-backup).

### 11.4 Proof that backups work

- **CI round trip** (every push): seed a fixture into `Core`, export every table, import into a fresh DO, then deep-equal every table. The same runs for each class once it exists.
- **Monthly restore drill** in production: the latest weekly backup of `Core` goes into a scratch instance `drill-<YYYYMM>`. Counts and per-part sha256 are compared with the manifest. The report goes to `drills/<YYYY-MM>/report.json`, a line in the briefing, and STATUS. To stay inside the write cap, any table over 30,000 rows is restored as a deterministic sample (every k-th `seq`, so that ≤ 30,000 rows are written), with its full row count still checked from the export **[proposal]**. The scratch instance is then emptied with `deleteAll()`.

---

## 12. Importing the old data

The full plan, with the order of datasets and the switch-over, is in [MIGRATION.md](MIGRATION.md). The data mechanics are fixed here.

1. **Source.** A one-time, read-only export route on the old Worker (deploying it is ask-first). A driver in the mind's session pulls parts and posts each one unchanged to `POST /v1/ops/import/parts`, which checks its SHA-256 and stores it at `imports/old/<run_id>/<instance>/<table>/part-<nnnn>.jsonl.gz`. The manifest `imports/old/<run_id>/manifest.json` is written last, with row counts per table ([MIGRATION.md §3](MIGRATION.md)).
2. **Run.** `POST /v1/import/runs {id, run_id, dataset}` creates an `imports` row and a bulk-lane job on the target class. The job reads parts in order and upserts in steps of ≤ 2,000 rows.
3. **Mapping** (datasets I1–I7 in [MIGRATION.md §4](MIGRATION.md), which owns the details):

   | Old dataset | New home | Notes |
   |---|---|---|
   | I1 chat threads | `Core.threads`, `kind='imported'` | Deterministic IDs (§2.1); `day` from the first message in `owner.tz`; original title kept |
   | I2 chat messages | `Core.messages`, `origin='import'` | Body byte-equal; FTS backfilled after (`fts.backfill`) |
   | I3 notebook | `Core.import_items` | The mind converts it once into facts citing `import:<id>` (P3) |
   | I4 Muse chat, work, files | a `muse` thread + closed `work_orders`; files to `muse/files/` | |
   | I5 Board editions and profile | `board/<date>.json` + `Core.board` + `settings` | |
   | I6 chat files | `chat/files/…` (R2 to R2 inside the Worker, size and ETag checked) | Originals stay in `jarvis-music` |
   | I7 music catalog | `Music.tracks`, `Music.catalog_log` | P5, on its own day (≈ 2 writes per track) |
   | sign-in tables | **not imported** | The owner signs in fresh |

4. **Proof** (`imports.report_json`, and the test in TESTING.md §8):
   - per dataset, `imported + skipped` = manifest rows, and every skip has a reason (`duplicate`, `empty`, `invalid_ref`);
   - per thread, the message count and the first and last `created_at` are equal;
   - 20 random old IDs, chosen with a seed recorded in the report, deep-equal after the normalisation listed per dataset in MIGRATION.md;
   - a second run of the same import changes 0 rows (`meter` delta = 0 for that job).
5. **Phone-local data** (P1b) is restored verbatim into the ported apps' own stores on the new origin by the `/import/` page, and the same file arrives through `POST /v1/import/phone` ([API.md §11.17](API.md#1117-import)). It is stored raw in `imports/phone/` with an `imports` row; each app's new tables seed from it once, at that app's data move (P5, P6, P8) ([MIGRATION.md §5](MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)).

Acceptance: the owner sees "Imported N conversations, M messages. 20 of 20 spot checks matched." in the briefing on the day of the import.

---

## 13. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| D1 | Is PITR available on Free? (X4) | Preview Worker: call `getCurrentBookmark()` and `getBookmarkForTime(now − 1 h)`; restore a scratch object |
| D2 | Does local workerd `rowsWritten` match production billing? | Compare the meter with the dashboard after one week |
| D3 | Rows written per FTS5 insert (per message, per 300-word page) | Cost test in local workerd; update §8.2 |
| D4 | Does `deleteAll()` count every row as a write? Is `DROP TABLE` cheap? | Local workerd measurement; if `DROP` is cheap, switch `Senses.events` to monthly tables |
| D5 | Is the 1 GB per-object limit enforced on Free as the FAQ says? | Watch `db_bytes` in deep health; alert at 700 MB |
| D6 | DO CPU per job step on Free (10 ms or 30 s), which sets the step size | Test X3; until then steps are ≤ 2,000 rows |
| D7 | `CompressionStream('gzip')` CPU cost inside a DO for a 5,000-row part | Measure in preview; lower the part size if it overruns |
