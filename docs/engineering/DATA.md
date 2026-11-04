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
9. **`jarvis-music` is never deleted from.** `thunderhead-private` is Worker-only: Actions' results reach it only through the Worker's job routes (JOBS.md §3).
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
| Raw Actions results (until collected) | R2 | `thunderhead-private`, `jobs/incoming/` | the Worker, from `PUT /v1/jobs/:id/files/:name` (the `ci` key) | P5, built |
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
| `verse` | `verse:a/3/12-14` (invented) | a scripture reference (book code / chapter / verses) |
| `podcast` | `podcast:feed-9/ep-41` | a feed or episode |
| `astra` | `astra:movie:tt0000001` | an Astra title |
| `media` | `media:vid-88` | a My Media item |

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
| `meter_days` | `(day TEXT, class TEXT) PK, rows_read INTEGER, rows_written INTEGER, updated_at INTEGER` WITHOUT ROWID | The row meter: rows read and written per UTC day (the units the Free plan bills), from every query's `cursor.rowsRead/rowsWritten` (`backend/src/objects/meter.ts`) |

- **The row meter (built 2026-10-31, the rows-read guard).** Every query's rows add up in memory, and each object keeps its own class's row for the UTC day in its `meter_days` (Core step 24, Auth step 3, Music, Senses and Library step 2). The row is written when what isn't written yet reaches 10,000 rows read or 25 written, or 5 minutes after its last write while the object is used, and once more for a day that closed. The 5 minutes count from the stored row's own time, so a fresh instance (after an eviction, or Core after hibernating) writes at its first query when the last write is older. The check runs as each query's rows are added, so a last big scan before an eviction is still written; the write waits for the end of the current synchronous run (a microtask, not a timer), so a transaction's many queries cost one write. A write stores the day's whole totals and only raises them, so a write lost with a rolled-back transaction is made good by the next. What an eviction can lose is under 10,000 rows read and 25 written per object. The meter's own queries count toward the day but not toward the cost tests' numbers.
- **Core gathers it.** Each 15-minute tick (and `GET /v1/ops/meter`, at most once a minute) Core asks Auth, Music, Senses and Library (`meterFlush()`, an RPC): each answers today's totals and the day before's, and Core keeps them in its `meter_days` where they grew, beside its own row. So the day's use is a few rows of Core's, read by the quota watchdogs, the Briefing, the mind's briefing, the push at 80% and the hold (§8.1). Each read raises the stored rows to what is known live: Core's own meter as it stands, written or not; the rows a heavy step read in another object (a backup part of Music, the Senses or the Library, and the senses archive), added to that class's row as the step ends, ahead of the object's own answer at the next tick; and for the upload tools' check, Music's own day, asked with it. The meter counts the five objects, and what a drill writes into its scratch copy (the job runner adds the rows each step wrote, class `scratch`); not the drill copy's reads, the eval sandbox, nor the old Worker on the same account, whose share is kept back from the budget instead (§8.1). A meter that can't be read holds nothing and breaks nothing: the Briefing, the briefing, the tick and the alarm go on without it.
- **What it costs.** At rest about 8 rows written a tick (the row of each object the tick wakes, Core, Auth, Senses and Library, Core's copies of the three that grew, and the senses archive's reads), about 770 a day; then one more every 5 minutes for each object in use, and one for each burst. About 1,000 to 1,500 rows written on a usual day (1.5 to 2% of the 68,000 budget of §8.1) and about 2,000 rows read. A busy day for one object, a query every minute and 30 rows written every 10 minutes all day, costs it 288 writes (a test caps it at 300); all five that busy, with Core's copies, about 2,000 (3%). The most it can cost is one write per 25 rows written, when every write comes in its own small run (4% of what is written).
- **Object calls** (the third Free-plan count, 100,000 a day) are not metered: an RPC reaches its method directly, so an object has no one place to count them. `quota.do_calls` waits for that.
- **Alarm.** After any change to `jobs`, `setAlarm(min(due_at))` runs, but only when that time differs from the current alarm (each call is 1 row written).
- **Export hooks.** `exportTable(name, cursor, limit)` and `importRows(table, rows, mode)` are used by backups, restores and tests.
- **Deep health.** `health()` returns `{schema, expected, db_bytes: sql.databaseSize, rows_read, rows_written}`, the rows being the object's UTC day from its meter (stored, and not yet stored); deep health sums the five into `meter_today`.

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
| `reports` (step 23) | `(kind TEXT, at INTEGER, id TEXT) PK` (`kind` from `REPORT_KINDS` in `shared/contract/reports.ts`, today only `playback`; `at` when the Worker took it; `id` a UUIDv7 the Worker makes), `device_id TEXT` (the device session that sent it), `body_json TEXT` (the batch, ≤ 32 KB, only the known fields of its kind as `cleanReport` keeps them: each text with its addresses cut to their host, quoted text and tokens removed, ≤ 160 characters) WITHOUT ROWID | — (the key is the list's and the prune's index) | P8. One row per batch the phone sends ([API.md §11.16](API.md#1116-ops)); never a row per event |
| `podcast_progress` (step 25) | `key TEXT PK` (the ported app's own `<feed address>#<episode id>`, the id the feed reader's 16-hex hash of its guid; checked by `progressKeyProblem` in `shared/contract/podcasts.ts`), `position_s REAL, duration_s REAL` (0 … a week), `played INTEGER`, `updated_at INTEGER` (when the phone saved it, its clock: the newer wins), `synced_at INTEGER` (when the Worker took it) WITHOUT ROWID | `podcast_progress_synced (synced_at)` (a phone's `?since=` page; in a WITHOUT ROWID table it carries the key, the page cursor) | P8 (NEXT-BATCH.md part 7). Where each episode was left, so it resumes on any phone ([PODCASTS.md §5.4](../product/apps/PODCASTS.md)) |
| `podcast_follows` (step 25) | `feed_url TEXT PK`, `title TEXT, author TEXT, artwork TEXT` (the show as the app shows it), `followed INTEGER` (0: an unfollow, kept so the other phones learn it), `updated_at INTEGER` (the newer wins), `synced_at INTEGER`, `checked_at INTEGER, latest_at INTEGER, new_n INTEGER, fails INTEGER` (the night's last check of the show: when, the newest episode it saw, how many were new, and how many checks in a row its feed failed) WITHOUT ROWID | `podcast_follows_synced (synced_at)` | P8. The shows followed, so the night can look for new episodes ([RUNTIME.md §12.1](../mind/RUNTIME.md)) |
| `calendar_events` (step 31) | `(feed TEXT, uid TEXT, start INTEGER) PK` (`feed`: the first 16 hex characters of the SHA-256 of the link's address, never the address; `uid`: the event's UID; `start` ms), `end INTEGER` (ms; an all-day event from the owner's midnight of its first day to that of the day after its last), `all_day INTEGER`, `title TEXT` (≤ 80, one line), `location TEXT` (≤ 80 or null), `source TEXT` (`owner`\|`outside`, from the link's mark when fetched; a read follows the mark as it is now) WITHOUT ROWID | `calendar_events_start (start)` (today's and tomorrow's events, the read route's window) | P8 (2026-11-02). The next 14 days of each calendar link ([BRIEFING.md](../product/BRIEFING.md) "Today"), replaced whole when a fetch brings something different |
| `calendar_feeds` (step 31) | `feed TEXT PK`, `checked_at INTEGER` (the last try), `ok_at INTEGER` (the last good fetch), `failing_since INTEGER` (the first failure since it), `error TEXT` (`redirect`, `too_large`, `not_calendar`, `unreachable`, `unreadable`, `http_<status>`), `hash TEXT` (of the last good events), `n INTEGER` WITHOUT ROWID | — | P8 (2026-11-02). One row per calendar link |
| `live_tickets` | `hash TEXT PK, session_id TEXT, expires_at INTEGER, used_at INTEGER` WITHOUT ROWID | — | P2 |
| `wakes` | `id TEXT PK, at INTEGER, task TEXT ('chat'\|'night'\|'reflex'), reason TEXT ('prewarm'\|'message'\|'requeue'\|'roll'\|'schedule'\|'watchdog:<name>'\|'manual'), status TEXT ('fired'\|'claimed'\|'ended'\|'unclaimed'\|'failed'), fired_at INTEGER, fire_status INTEGER, fire_error TEXT, session_id TEXT, claimed_at INTEGER, claim_match TEXT ('exact'\|'loose'\|'manual'), retry_of TEXT, first_reply_at INTEGER, ended_at INTEGER, end_reason TEXT` | partial `(at) WHERE status IN ('fired','unclaimed')` | P2 |
| `watches` (step 34) | `id TEXT PK` (the `watch.set` verb's id), `kind TEXT ('at'\|'event'\|'change')`, `fire_at INTEGER` (at), `type TEXT` (a sense type or `reminder.fired`; a change kind), `ref TEXT`, `why TEXT, note TEXT` (the mind's own words), `outside INTEGER` (set after outside text), `state TEXT ('live'\|'queued'\|'fired'\|'over_budget'\|'cancelled'\|'expired')`, `created_at, until INTEGER` (when it lapses unmet), `session_id TEXT` (who set it), `met_at INTEGER, met_ref TEXT` (what met it), `settled_at INTEGER`, `by TEXT ('wake'\|'event')`, `wake_id TEXT, to_session TEXT` (the session that heard it) WITHOUT ROWID ([RUNTIME.md §3](../mind/RUNTIME.md)); step 34 also adds `wakes.reason_json` (`{watch, kind, note, quiet?}` on a wake a watch fired) and an index on `mind_sessions (claimed_at)` for the usage meter | partial `(kind, type, fire_at) WHERE state IN ('live','queued')`; partial `(settled_at) WHERE settled_at IS NOT NULL` | P9 |
| `leases` | `task TEXT PK, session_id TEXT, acquired_at INTEGER, renewed_at INTEGER` WITHOUT ROWID | — | P2 |
| `mind_sessions` | `session_id TEXT PK, role TEXT, wake_id TEXT, claimed_at INTEGER, th_version TEXT, constitution_sha256 TEXT, laws_pinned INTEGER, tainted_at INTEGER, taint_source TEXT, ended_at INTEGER`; *eng:* `day TEXT` (the logical day it was claimed on, for `day_closed`), `last_owner_at INTEGER` (for `idle_min`); step 26: `taint_event_at INTEGER` (its latest taint event), `songs_at INTEGER` (a night session read songs' tags); step 27: `off_record_at INTEGER` (the Worker first handed this chat session a message off the record: it writes no memory) | `mind_sessions_tainted (role, tainted_at) WHERE tainted_at IS NOT NULL` (P3 step 10: a claim finds its role's latest taint of the last 24 hours, and a write its role's latest taint since the session claimed); `mind_sessions_open (role) WHERE ended_at IS NULL` (P4 step 15) | P2 |
| `night_runs` | `day TEXT PK, started_at INTEGER, step INTEGER, steps_json TEXT, done_at INTEGER, session_id TEXT` (one row per closed day the night worked on; `step` is the last step done or skipped; `steps_json` holds each step's time and session, or why it was skipped (`later`, `not_sunday`, `hard_stop`), or the cursor of the step under way; the steps are `shared/contract/night.ts`'s, RUNTIME.md §12) | — (by its key) | P3 (step 11) |
| `night_reports` (step 36) | `day TEXT PK` (the closed day), `written_at INTEGER`, `session_id TEXT` (the night session that put it), `headline TEXT` (≤ 60), `lines_json TEXT` (≤ 6 `{kind, text, ref}`), `counts_json TEXT` (the Worker's counts of the run), `req_sha256 TEXT` (the body, for the same body again), `ledger_id TEXT` (this version's row; its undo is the version before), `message_id TEXT` (the open day's first message, when posted) WITHOUT ROWID | — (by its key) | 2026-11-04. The night's report ([BRIEFING.md](../product/BRIEFING.md) "The report card"): one row per closed day, replaced whole; a put writes the row, its ledger row and change-feed rows, and the first message when posted |
| `topics` | `topic_key TEXT PK, last_shown_at INTEGER, ignored_at INTEGER, shown_count INTEGER`, and from Core step 35 `quiet_from INTEGER, quiet_until INTEGER, said_at INTEGER, reopened_at INTEGER, lands_json TEXT` WITHOUT ROWID | — | P2 |
| `op_batches` | `key TEXT PK, route TEXT, req_sha256 TEXT, status INTEGER, result_json TEXT, at INTEGER` WITHOUT ROWID | — | P3 (first used by memory batches, key `memory.ops:<batch_id>`) |

- `changes.kind` ∈ `message | thread | ledger | proposal | verb | surface | notice | fact | day_note | open_thread | setting | mind_status | error | work | watch | prediction` (`watch`: a watch set, met or settled; `prediction`: one resolved).
- `settings` keys used by the engineering side: `owner.tz`, `min_client`, `bulk.lane` (which object holds the bulk lane, see §8.3), `day.current` (the open logical day), `roll.last_at`, `mind.status` (the presence light), `mind.backoff` (`{until, step}` after a failed or limited wake), `prune.day` (the logical day the prune pass last finished), `podcasts.night_reads` (`{day, n}`: the night's feed reads on that UTC day, at most 40); the owner's calendar links are the product setting `briefing.calendars` (their addresses only there). Product settings are listed in [MENU-AND-SETTINGS.md](../product/MENU-AND-SETTINGS.md).
- The wake and lease semantics are owned by [RUNTIME.md §4](../mind/RUNTIME.md). Storage rule **[proposal]**: every `th` call renews the chat lease for 90 s, but `renewed_at` is written only when the stored value is ≥ 30 s old. A listening hour then costs ≤ 120 writes instead of one per call.
- `mind_sessions` holds per-session state the Worker enforces: taint ([MEMORY.md §7](../mind/MEMORY.md): it labels the session's memory writes `outside`) and the constitution pin. A taint holds for 24 hours for its role, by `tainted_at` (not `day`, which stays the claim's): a claim copies it (`taint_source = inherited:<source>`, the original `tainted_at`) unless the Worker fired that session after the taint. Agent requests name their session with the header `TH-Session` ([API.md §1](API.md#1-request-basics)). `taint_source` keeps the tool name only, never the URL.
- `topics` backs the voice-ladder repeat rule (a dismissed `topic_key` stays quiet for 14 days, [BEHAVIOR.md §3](../mind/BEHAVIOR.md)) and, from step 35, what lands (BEHAVIOR.md §3.6): a topic passed over three times in a row rests from `quiet_from` to `quiet_until`, `said_at` is when the mind said so (once), `reopened_at` when the owner reopened it (its streak counts from then), and `lands_json` the last pass's counts, which the briefing reads.
- `errors.message` is scrubbed before storage: no URLs with query strings, no token-like strings, nothing longer than 300 characters.
- `podcast_progress` and `podcast_follows` write no change-feed row: nothing on home or in the mind's view changes when a phone syncs, and the phones ask by time when Podcasts opens. A position is one upsert that changes the row only when its `updated_at` is newer: 2 rows written (the row and its index entry) and none read, measured; an older or equal one writes nothing. A phone's read on open reads the rows it returns (1 when nothing changed, of 1,000 kept). The night's check of a show writes 1 row (no index column moves). Each feed the night reads (counts mode: numbers only) is admitted by Core: its follow row read (only a followed show's feed), and the day's count in the setting `podcasts.night_reads` (`{day, n}`, at most 40) read and written: at most 40 rows written a day; then one `podcast_progress` row looked up per new episode, to leave out what a phone started. The daily prune sorts `podcast_progress` by `updated_at` to keep the newest 1,000: about two reads per row kept (~2,200 rows read a day at that size), plus a row deleted per row past it.
- `calendar_events` and `calendar_feeds` write no change-feed row. A fetch that brings the same events as the last one (their hash) writes the link's `calendar_feeds` row only; a different one deletes the link's events and inserts the new ones (2 rows written each, the row and its index entry; at most 300 a link). A link is fetched on the day roll and when the Briefing opens with its last try over 30 minutes old, so a quiet calendar costs a few rows written a day. The Briefing reads the setting, the links' rows and today's and tomorrow's events (at most 150 rows, by the `start` index from 31 days back); the daily prune deletes events a day past their end and the rows of a link no longer set.
- `reports` costs one row written per batch and no row read: no change-feed row (nothing on a phone or in the mind's view changes when one arrives), no second index. A list reads the rows it returns on the key (kind, at, id), newest first, at most 512 KB of them a page; the prune reads only the rows it deletes, kind by kind. A device may send 6 batches in any 5 minutes (counted in the Core object's memory, so the count costs no row); Music sends one a minute while it plays and one when its page is hidden.

### 4.2 Conversation

The columns match [MEMORY.md §2](../mind/MEMORY.md), which owns their meaning. This page owns keys, indexes and the engineering-only columns marked *eng*.

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `threads` | `id TEXT PK, day TEXT, kind TEXT ('daily'\|'muse'\|'imported'\|'off_record'\|'restored'\|'deleted'), title TEXT, title_source TEXT ('auto'\|'mind'\|'owner'), summary TEXT (≤ 400 chars), status TEXT ('open'\|'filed'), continues TEXT, started_at INTEGER, filed_at INTEGER`; *eng:* `message_count INTEGER, updated_at INTEGER`; step 27: `purge_at INTEGER` (set exactly while the thread is held: off the record, its last message + 7 days; deleted, the delete + 30 days), `deleted_at INTEGER`, `kind_was TEXT` (a deleted thread's own kind, given back by Restore); step 37 (2026-11-04): `topic TEXT` (≤ 40, the menu's grouping, set by the mind's `thread.file`) | unique partial `(day) WHERE kind='daily'`; `(status, updated_at)`; partial `threads_purge (purge_at) WHERE purge_at IS NOT NULL` (step 27: what the prune pass purges, and the few ids every held-thread filter reads); partial `threads_deleted (deleted_at) WHERE deleted_at IS NOT NULL` (Recently deleted, newest first) | P2 |
| `messages` | `seq INTEGER PK, id TEXT UNIQUE, thread_id TEXT, created_at INTEGER, author TEXT ('owner'\|'mind'\|'system'\|'muse'), origin TEXT ('owner_device'\|'mind'\|'system'\|'muse'\|'import'), kind TEXT ('text'\|'voice'\|'progress'\|'card'\|'question'\|'error'), body TEXT (≤ 16,000 chars), reply_to TEXT, meta_json TEXT, attachments_json TEXT, device_id TEXT, session_id TEXT, delivered_at INTEGER, acked_at INTEGER, answered_at INTEGER`; *eng:* `req_sha256 TEXT` | `(thread_id, seq)` | P2 |
| `messages_fts` | FTS5 `(body)`, `content='messages'`, `content_rowid='seq'`, tokenizer `unicode61 remove_diacritics 2` | — | P2 |
| `files` (step 21) | `id TEXT PK` (the client's UUIDv7; the ref is `file:<id>`), `key TEXT` (`chat/files/<YYYY>/<MM>/<id>.<ext>` in `thunderhead-private`, §7.1; never sent to a client), `name TEXT` (≤ 120 chars, made safe), `type TEXT` (the media type's essence), `bytes INTEGER` (≤ 25 MiB), `sha256 TEXT` (hex; the ETag), `seconds REAL` (a voice memo's length, else NULL), `text TEXT` (a voice memo's words from Workers AI Whisper, ≤ 16,000 chars, else NULL), `uploaded_by TEXT ('owner'\|'mind')`, `created_at INTEGER`, `message_id TEXT` (NULL until a message takes the file, then never changed) WITHOUT ROWID | — (read by `id` only) | P2 (the + sheet) |

- `seq` is the rowid (`INTEGER PRIMARY KEY`) so that FTS5's external content can use it; `id` is the UUID the clients use. MEMORY.md shows the same two columns the other way round; the columns and their meaning are identical.
- `messages.attachments_json` holds the message's attachments as a JSON array of `Attachment` (`{ref, name, type, bytes, seconds?, text?}`, API.md §2), in the order the sender gave, copied from `files` when the message is written (NULL: none). The same commit sets each file's `message_id`; a file goes on one message only, and only on a message of the kind of author that uploaded it ([API.md §11.7](API.md) rule 9).
- A file's bytes go to the bucket before its row is written, so a row never names missing bytes; a file uploaded and never sent keeps its row and bytes (nothing prunes them yet).
- The owner never creates a daily thread. The Worker creates the `daily` thread for `day.current` on the first message of a logical day, and files it at the roll. The owner's device starts a conversation **off the record** (`kind='off_record'`, `PUT /v1/threads/:id/off-record`, the phone's id), which a message names by `thread_id`; it has no FTS entries (an FTS5 delete must name exactly what was inserted, so the purge knows by the kind).
- **Held threads** (step 27, `areas/conversation/held.ts`): one off the record, and one the owner deleted (`kind='deleted'`, its kind kept in `kind_was`, so the day's one `daily` slot frees and the next message starts a fresh today; Restore gives the kind back, or `restored` beside a fresh daily thread of its day). Once `purge_at` passes the thread is gone from every read and refuses writes; the cron's prune pass then purges it (§10). Held threads, their messages and their messages' files' rows are left out of backups and the export (`heldRows`).
- A message is handed to a waiting mind session by `/v1/live/wait` (`delivered_at`), acknowledged by `th status working` or any post in the thread (`acked_at`), and answered when a mind message names it in `reply_to` (`answered_at`; every earlier unanswered owner message is marked too, across the roll, [API.md §11.7](API.md) rule 3). A claimed briefing counts as a hand-out. Unacknowledged after 120 s → requeued ([RUNTIME.md §4.5](../mind/RUNTIME.md)).

### 4.3 Ledger, proposals, verbs, surfaces

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `ledger` | `seq INTEGER PK, id TEXT UNIQUE, at INTEGER, actor TEXT, session_id TEXT, kind TEXT ('memory'\|'arrangement'\|'verb'\|'plan'\|'deploy'\|'proposal'\|'mistake'\|'undo'\|'note'; `plan`: a plan's one row, its `what` the line on home, its undo the steps' rows), what TEXT (≤ 200), why TEXT (8–500), ref TEXT, topic_key TEXT, undo_json TEXT, undoable INTEGER, status TEXT ('done'\|'undone'\|'failed'), tainted INTEGER, proposal_id TEXT`; *eng:* `op_json TEXT, verb_id TEXT, undone_at INTEGER, permit TEXT` (the standing permission a mind's action ran under: `ask`\|`tell`\|`quiet`, NULL for anyone else's; step 28, [API.md §11.11](API.md#standing-permissions)) | — | P2 |
| `proposals` | `id TEXT PK, created_at INTEGER, created_by TEXT, class TEXT ('delete'\|'money'\|'access'\|'reach_people'\|'permit'\|'memory_big'), question TEXT (≤ 80), why TEXT (≤ 140), if_ignored TEXT, odds REAL, spec_json TEXT, spec_hash TEXT, status TEXT ('waiting'\|'approved'\|'rejected'\|'expired'\|'cancelled'\|'executed'), expires_at INTEGER, decided_by_device TEXT, decided_at INTEGER, executed_ledger_id TEXT, decided_via TEXT ('tap'\|'words'), decided_message_id TEXT`; *eng:* `session_id TEXT, options_json TEXT, safe TEXT ('reject'\|'snooze'), target TEXT (the Worker's line naming what a Yes changes; scrubbed with the card when its fact is forgotten), op TEXT, ref TEXT (what the op acts on, e.g. 'fact:<id>'), visible_from INTEGER, show_from INTEGER, snoozes INTEGER, result_json TEXT, req_sha256 TEXT` | partial `(created_at) WHERE status IN ('waiting','approved')`, `(ref) WHERE ref IS NOT NULL`, `(decided_at) WHERE decided_at IS NOT NULL`, `(decided_message_id) WHERE decided_message_id IS NOT NULL` (one message answers one card) | P4 stage A (Core step 14; `memory_big` still waits, see decisions.md) |
| `verbs` | `id TEXT PK, created_at INTEGER, actor TEXT, verb TEXT, schema INTEGER, ref TEXT, args_json TEXT, device_id TEXT (NULL = any), status TEXT ('pending'\|'claimed'\|'done'\|'failed'\|'expired'\|'scheduled'\|'cancelled'), proposal_id TEXT, ledger_id TEXT, expires_at INTEGER, claimed_at INTEGER, claimed_by TEXT, claims INTEGER, done_at INTEGER, result_json TEXT, undo_json TEXT, req_sha256 TEXT`; *eng:* `error_json TEXT` (a failed result's `{code, message?}`, e.g. `unsupported_verb`; a failed scheduled plan's `step` and `verb` too); step 33 ([API.md §11.11](API.md#scheduled-actions)): `fire_at INTEGER` (when a `scheduled` row runs, or ran), `plan_id TEXT` (the plan a step belongs to), `why TEXT, permit TEXT` (a scheduled row's why and the position it was queued under, for the ledger row it writes when it runs). A plan is a row of verb `plan.run` (its line and steps in `args_json`, its steps' verb and ledger ids in `result_json` once it ran) | partial `(created_at) WHERE status IN ('pending','claimed')`; partial `verbs_scheduled (fire_at) WHERE status = 'scheduled'` (step 33: at most 20 rows, the alarm's soonest, the due pass and the list) | P2 |
| `mixes` (step 29) | `id TEXT PK` (the `music.mix_save` verb's id), `name TEXT (≤ 60), refs_json TEXT` (`music:<id>` refs in order, ≤ 200), `tracks INTEGER, recipe TEXT` (the one line they were found by), `actor TEXT, created_at INTEGER` | `(created_at)` | P5 (2026-11-02) |
| `surfaces` | `(app TEXT, slot TEXT) PK, kind TEXT, schema INTEGER, payload_json TEXT, why TEXT, topic_key TEXT, ref TEXT, expires_at INTEGER, written_at INTEGER, actor TEXT, ledger_id TEXT`; *eng:* `seq INTEGER` (the feed seq of its last write, for `since_seq`) WITHOUT ROWID | — | P2 |
| `work_orders` | As built (step 19, and step 30 for `@muse`, [MUSE-PROTOCOL.md](MUSE-PROTOCOL.md)): `id TEXT PK, kind TEXT ('muse.request'\|'muse.upload_batch'; a Board-era kind reads as `legacy`), assignee TEXT, title TEXT, spec_json TEXT, personal INTEGER, approval_id TEXT, recurrence TEXT, day TEXT, deadline_at INTEGER, status TEXT ('queued'\|'claimed'\|'done'\|'rejected'\|'failed'\|'expired'\|'cancelled'), attempts INTEGER, created_by TEXT, created_at INTEGER, claimed_at INTEGER, heartbeat_at INTEGER, heartbeat_note TEXT, result_json TEXT, result_valid INTEGER, result_errors_json TEXT, finished_at INTEGER`; step 30: `message_id TEXT` (the owner's `@muse` message), `said TEXT` (the last state its conversation was told), `invalid INTEGER` (results that failed their checks in this claim); `muse_notes` gains `order_id TEXT` (a progress line's order) | `(status, created_at)`, `(kind, day)`, `(created_at)`; `muse_notes (order_id, seq)` | P4 |
| `predictions` (P9, step 20) | `id TEXT PK, made_at INTEGER, made_by TEXT, category TEXT` (a fixed resolver, [EVALS.md](../mind/EVALS.md) M-18: `chat.any`, `chat.count`, `chat.before`, `decision.answered`), `args_json TEXT, day TEXT` (the logical day it is about), `p REAL` (0.01–0.99), `why TEXT` (≤ 200), `outcome INTEGER` (1, 0 or NULL until its day is over), `base REAL` (the smoothed share of the 28 days before on which it came true), `resolved_at INTEGER, req_sha256 TEXT`. Made only by the night shift, at most 12 a day; resolved by Core's tick through the conversation's and the proposals' stores |
| `reminders` (P8, step 22) | `id TEXT PK, text TEXT` (≤ 200, trimmed, one line), `at INTEGER` (the time asked for), `fire_at INTEGER` (`at`, or the end of the quiet hours it falls in), `state TEXT ('set'\|'done'\|'cancelled'), origin TEXT ('owner_device'\|'mind'), source_message_id TEXT` (the chat mind's: the owner's message that asked), `created_at INTEGER, fired_at INTEGER, cancelled_at INTEGER, message_id TEXT` (the conversation line it became); *eng:* `push_until INTEGER` (until when its push is offered to the outbox; NULL when it pushes nothing), `req_sha256 TEXT` | partial `reminders_due (fire_at) WHERE state = 'set'` (the next due, the open count); partial `reminders_closed (coalesce(fired_at, cancelled_at)) WHERE state != 'set'` (the last day's, the pushes still owed); partial `reminders_source (source_message_id) WHERE source_message_id IS NOT NULL` (3 from one message) | P8. Set by the owner's phone or by the chat mind citing the owner's message; at most 50 set at once; delivered once by Core's alarm ([API.md §11.24](API.md)) |

- A ledger row stores its inverse in `undo_json` when it is written. `undoable = 0` marks exactly the ask-first classes, which go through `proposals`. The *eng* columns (`op_json`, `verb_id`, `undone_at`) are listed in the night's patch list for MEMORY.md, so both pages carry them.
- A proposal executes only after `POST /v1/proposals/:id/decide` whose body carries the same `spec_hash`: from a **device session** (`decided_via='tap'`, `decided_by_device` set), or from `mind:chat` citing the owner's own words (`decided_via='words'`, `decided_message_id` = an owner-device message the Worker has checked; [API.md §11.10](API.md#1110-proposals-decisions)). At most 3 are `waiting` at once (`409 decision_budget`); each expires 7 days after creation ([BEHAVIOR.md §3.5](../mind/BEHAVIOR.md)). The proposal status list adds `failed` **[proposal]** for an executor that errors after approval.
- A surface is replaced in place per `(app, slot)`. Its history is the ledger. Home lines are app `home`, slots `line.1`–`line.4`.

### 4.4 Memory

The columns match [MEMORY.md §2](../mind/MEMORY.md), which also owns the rules (sources, confidence, decay, taint). This section fixes keys, indexes and FTS.

| Table | Columns (PK first) | Indexes | Phase |
|---|---|---|---|
| `facts` | *eng:* `seq INTEGER PK` (the FTS rowid, as for messages); `id TEXT UNIQUE, kind TEXT ('preference'\|'routine'\|'fact'\|'goal'\|'state'\|'rule'), about TEXT ('owner'\|'world'\|'person'), subject TEXT, text TEXT (≤ 280), tags_json TEXT, source TEXT ('user'\|'observed'\|'inferred'), confidence REAL, evidence_json TEXT (1–20 ids), valid_from INTEGER, valid_to INTEGER, recorded_at INTEGER, superseded_at INTEGER, superseded_by TEXT, last_confirmed INTEGER, sensitivity INTEGER, pinned INTEGER, may_raise INTEGER, written_by TEXT`; *eng:* `ledger_id TEXT` (the row that wrote this version: its why), `lineage_id TEXT` (the first version's id, shared by every later one); `provenance TEXT` (step 32: `owner`\|`observed`\|`outside`, MEMORY.md §6 M11; NULL, from before it, reads by source) | partial `(kind) WHERE superseded_at IS NULL`; `(lineage_id)` (what `forget` deletes, even a version an undo unlinked) | P3 |
| `fact_tombstones` | `id TEXT PK, lineage_id TEXT, forgotten_at INTEGER` WITHOUT ROWID (no text) | — | P3 |
| `facts_fts` | FTS5 `(text, subject)`, `content='facts'`, `content_rowid='seq'`, tokenizer `unicode61 remove_diacritics 2` | — | P3 |
| `day_notes` | *eng:* `seq INTEGER PK` (the FTS rowid); `day TEXT UNIQUE, summary TEXT (≤ 150 words), decisions_json TEXT, stats_json TEXT, importance INTEGER (1–10), written_by TEXT, version INTEGER, written_at INTEGER`; `provenance TEXT` (step 32: `owner`\|`outside`; NULL reads `owner`) | — | P3 |
| `day_notes_fts` | FTS5 `(summary)`, `content='day_notes'`, `content_rowid='seq'`, same tokenizer | — | P3 |
| `open_threads` | `id TEXT PK, text TEXT (≤ 200), owner TEXT ('mind'\|'owner'), due_at INTEGER, tags_json TEXT, status TEXT ('open'\|'done'\|'dropped'), evidence_json TEXT, opened_at INTEGER, last_progress_at INTEGER, closed_at INTEGER, closed_why TEXT`; `provenance TEXT` (step 32: `owner`\|`outside`; NULL reads `owner`) | partial `(due_at) WHERE status='open'` | P3 |
| `session_notes` | `id TEXT PK, session_id TEXT, wake_id TEXT, role TEXT, thread_id TEXT, created_at INTEGER, body TEXT (≤ 120 words), open_items_json TEXT` | `session_notes_at (created_at)` (P3 step 11: the night reads a day's notes, the briefing the latest) | P2 |
| `import_items` | `id TEXT PK, run_id TEXT, dataset TEXT, key TEXT, body_json TEXT, converted_at INTEGER` | — | P3 |
| `imports` | `id TEXT PK, source TEXT ('old_worker'\|'phone'), dataset TEXT, r2_prefix TEXT, manifest_json TEXT, state TEXT ('queued'\|'running'\|'verifying'\|'done'\|'failed'), counts_json TEXT, report_json TEXT, started_at INTEGER, finished_at INTEGER`; *eng:* `run_id TEXT` (the export run), `job_id TEXT` (the job doing the work), `last_error TEXT` (a code) | `imports_run (run_id, dataset)` | P1b (`phone`), P3 (`old_worker`) |

- Facts are never edited in place. A change closes the old row (`superseded_at`, `superseded_by`) and inserts a new one. `forget` (owner only) hard-deletes every version and their FTS entries, runs an FTS `optimize` (a plain FTS5 delete leaves the words in the index segments until a merge; measured in workerd), scrubs the `why` and undo of the memory ledger rows that pointed at those versions, and writes a ledger tombstone without the content. Memory ledger rows never carry fact text.
- Migration step 8 (P3) adds facts, `fact_tombstones`, day notes, open threads and `op_batches`; step 9 adds `surfaces.facts_json` (the facts a surface cites, cleared when one is muted or forgotten); step 10 adds the partial index `mind_sessions_tainted`; step 11 adds `night_runs` and the index `session_notes_at`; step 12 (P3 stage D) adds `jobs`, and step 13 `imports` and `import_items`; step 14 (P4) adds `proposals`, step 15 the partial index `mind_sessions_open (role) WHERE ended_at IS NULL` (a chat claim ends the role's other open sessions), step 16 `eval_runs`, and step 17 (P4 stage D) `watchdogs`; step 32 (2026-11-02; 29 is the verbs branch's) adds `provenance` to facts, day notes and open threads (MEMORY.md §6 M11; columns only, no backfill: an older row reads by the rule it was written under). All expand-only. A surface put that cites facts lists them in its ledger row's `op_json` (`{op: 'surface.put', facts}`, never shown), so a forget can take the words of every such row.
- Decay is computed at read time and never written.
- `import_items` holds raw documents (the old notebook, for instance) until the mind converts them once. Converted rows are deleted 30 days after `converted_at`.
- MEMORY.md allows an `events` table in `Core` before `Senses` exists. Engineering keeps events out of `Core`: nothing on the phone emits events before P5, and phone performance goes to `perf_days` **[proposal]**. If an earlier need appears, the table goes into `Core` with the `Senses` columns (§6.1) and moves by a bulk job when `Senses` ships.

### 4.5 Later `Core` tables

`board(…)` was planned for the Board import and is not coming: the owner cut the Daily Board (2026-10-31). `lists` and `list_items` (playlists and watchlists, P5) are specified in [MUSIC.md](../product/apps/MUSIC.md). They follow this page's conventions.

---

## 5. `Auth` tables

Owned by [SIGN-IN.md](../product/SIGN-IN.md) and [SECURITY.md](SECURITY.md) for behaviour; storage is fixed here. **None of these tables is exported, backed up to R2 or included in "download everything".** PITR (inside Cloudflare) is the only copy.

| Table | Columns (PK first) | Notes |
|---|---|---|
| `credential` | `id INTEGER PK CHECK (id = 1), username TEXT, algo TEXT, n INTEGER, r INTEGER, p INTEGER, salt BLOB, hash BLOB, pepper_v INTEGER, version INTEGER, changed_at INTEGER` | Singleton. `hash = HMAC-SHA256(pepper, scrypt(NFKC(password), salt))` |
| `recovery` | `id INTEGER PK CHECK (id = 1), code_hash BLOB, last5_hash BLOB, created_at INTEGER, confirmed_at INTEGER, used_at INTEGER` | Singleton |
| `sessions` | `token_hash TEXT PK (hex SHA-256 of the token), id TEXT (UUIDv7, the public handle), pop_jwk TEXT (NULL in v1), label TEXT, platform TEXT, browser TEXT, model TEXT, standalone INTEGER, country TEXT, region TEXT, last_country TEXT, created_at INTEGER, last_seen_at INTEGER (hour), idle_expires_at INTEGER, revoked_at INTEGER, revoked_reason TEXT, credential_version INTEGER, stepup_at INTEGER` WITHOUT ROWID | Keyed by the hot lookup, so no index write per sign-in (measured, `backend/MEASUREMENTS.md` §2); device ids are found by scanning a handful of rows. 90-day idle expiry from `last_seen_at`, which is written at most once an hour. `revoked_reason` values in [SIGN-IN.md §3.2](../product/SIGN-IN.md) |
| `throttle` | `key TEXT PK, fails INTEGER, window_start INTEGER, last_at INTEGER, next_allowed_at INTEGER` WITHOUT ROWID | Key = `<kind>:<source>` or `<kind>:acct`; kind ∈ `signin`, `recover`, `reset`, `setup`, `pwcheck:<session id>`; `reset:acct` counts tickets requested through `POST /v1/auth/breakglass` (3 per 30 days); reset codes count as `recover`; source = first 32 hex of `HMAC-SHA256(IP_HASH_KEY, "src:" + UTC date + ":" + IPv4 or IPv6 /64)`. Rules in [SIGN-IN.md §6.1](../product/SIGN-IN.md). Rows that can no longer delay anything are deleted by the cron after 2 days |
| `notices` | `id TEXT PK, kind TEXT ('new_device'\|'password_changed'\|'recovery_used'\|'reset_pending'\|'reset_cancelled'\|'reset_used'\|'agent_key_created'), session_id TEXT (the session it is about; every other active session sees it), args_json TEXT, created_at INTEGER, acked_at INTEGER, answer TEXT, expires_at INTEGER` | Lifetimes per kind and copy owned by [SIGN-IN.md §11.4](../product/SIGN-IN.md); wire shape `Notice` in [API.md §11.2](API.md#112-auth) |
| `push_subscriptions` | `session_id TEXT PK, endpoint TEXT, p256dh TEXT, auth TEXT, created_at INTEGER` | One per session, deleted with it (P8, SECURITY.md §10); the endpoint is a capability URL |
| `pushes` | `id TEXT PK, kind TEXT ('nudge'\|'security'\|'test'\|'reminder'), title TEXT, body TEXT, url TEXT, topic_key TEXT, ref TEXT, why TEXT, hash TEXT, session_id TEXT (a test's phone), created_at INTEGER, deadline INTEGER, sent_at INTEGER, dropped_at INTEGER` | The outbox and each push's words (the payload is only a kind and an id); kept 30 days (P8). A reminder's push has the reminder's id, generic words and a deadline an hour after its delivery |
| `tickets` | `id TEXT PK, kind TEXT ('setup'\|'reset'), fingerprint TEXT, source TEXT ('mind'\|'github'\|'dashboard'), requested_at INTEGER, usable_after INTEGER, expires_at INTEGER, used_at INTEGER, cancelled_at INTEGER` | A used or cancelled fingerprint can never open another ticket |
| `agents` | `id TEXT PK, name TEXT (≤ 32, unique among keys with revoked_at IS NULL), role TEXT ('mind:chat'\|'mind:night'\|'mind:reflex'\|'ci'\|'muse'), token_hash BLOB UNIQUE, created_at INTEGER, created_on TEXT (device label), last_used_at INTEGER (hour), last_country TEXT, revoked_at INTEGER` | Issued from Settings → Agents; the key is shown once |
| `push_subs` | `id TEXT PK, session_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, created_at INTEGER, last_ok_at INTEGER` | Deleted in the same transaction as the session's revoke. P8 |

Never stored anywhere: raw IP addresses, the full user-agent, city, passwords, recovery codes, request bodies of `/v1/auth/*`.

---

## 6. Later classes

### 6.1 `Senses` (P5, its own deploy)

Built as specified (P5, `backend/src/objects/senses.ts`; the class shipped alone with migration tag `v3`), with its batches, queries, rollups, daily archive (`thunderhead-private/senses/<day>.jsonl.gz`) and pruning ([API.md §11.14](API.md#1114-senses-p5)).

| Table | Columns | Indexes | Retention |
|---|---|---|---|
| `batches` | `batch_id TEXT PK, device_id TEXT, received_at INTEGER, n INTEGER, sha256 TEXT` WITHOUT ROWID | — | 30 days |
| `events` | `seq INTEGER PK, id TEXT, at INTEGER, day TEXT, app TEXT, type TEXT, ref TEXT, data_json TEXT, device_id TEXT, origin TEXT, sensitivity INTEGER` | **one only:** `(day, type)` | 90 days hot, then the R2 archive only |
| `rollups` | `(day TEXT, type TEXT, ref TEXT) PK, n INTEGER, sum_ms INTEGER` WITHOUT ROWID | — | forever (~300 rows/day) |
| `exports` | `day TEXT PK, r2_key TEXT, n INTEGER, sha256 TEXT, at INTEGER` | — | forever |

- Dedupe is by sealed batch, not by event ID: one `batches` row per batch instead of a unique-index write per event.
- `app` is derived from the `type` prefix (`music.skip` → `music`). The server stamps `day`, `device_id` and `origin`.

### 6.2 `Music` (P5, its own deploy)

Built (P5 step 1, `backend/src/objects/music.ts`): `tracks(ord INTEGER PK, id TEXT UNIQUE, sha256 TEXT, size INTEGER, audio_key TEXT, cover_key TEXT, record_json TEXT, waveform TEXT, updated_at INTEGER)` with index `(sha256, size)`: the old catalog's `music_tracks` as it is (its order, ids, content keys and each track's record, where title, artist, album, year and duration live), so the ported player reads the same records; `catalog_log(seq INTEGER PK, at, op, track_id, before_json)` for undo, keeping the old log's sequence numbers; `music_state(key PK, value_json)` (the catalog's version, its ETag). Built (Music schema step 3, `listen`, 2026-11-01; SQL in `areas/music/listen-store.ts`): `external_jobs(id TEXT PK, kind, v, spec_json, state ('issued'|'validating'|'applied'|'rejected'|'expired'), issued_at, expires_at, collected_at, counts_json)` for the Actions specs (`spec_json`: an analysis job's hashes, ≤ 500; a neighbours job's count and epoch), and `analysis(sha256 TEXT PK, analyzer TEXT, v INTEGER, job_id TEXT, applied_at INTEGER, result_json TEXT, pack BLOB, failed TEXT, attempts INTEGER)`, one row per audio hash: the last good result re-written from its known fields (schema v2), its 56-byte `pack` (the phone's numbers and the int8 embedding), and the last attempt's analyzer version, failure and failures in a row ([JOBS.md §3](JOBS.md#3-actions-jobs-the-listening-pass)). All three are WITHOUT ROWID with no secondary index: they are read by key or whole, once a night, so each written row costs one row. `track_analysis(track_id TEXT PK, energy REAL, moods_json TEXT, neighbours_json TEXT)`, one row per track: the per-track view other areas read (Music step 4's `listeningRows`): energy, the moods by `MUSIC_MOODS`, and the nearest tracks' ids, nearest first; filled when results are applied and by the neighbours job, 2,000 tracks a step. The pass keeps three `music_state` rows (`listen.epoch`, `listen.neighbours`, `listen.pack`). The analysis rows were chosen over results kept in R2 with a slim index row: the rows written are the same (one per song either way), and the phone file and the neighbours spec would otherwise read 12,000 objects. Built (step 4, 2026-11-01, `backend/src/objects/music.ts`, `music-mind.ts`, `music-packs.ts`, SQL in `areas/music/store-notes.ts`; [MUSIC.md §10.5](../product/apps/MUSIC.md)): `track_notes(track_id TEXT PK, known INTEGER, note_json TEXT, by TEXT, v INTEGER, at INTEGER, pack INTEGER)` WITHOUT ROWID, no index: what the mind knows of each song, one row a track (its moods and occasions with a confidence each, themes, language, era, energy and a confidence for each, as `note_json` with keys in vocabulary order and values to two places; `known` 0 when the mind doesn't know the song; `by` the writer, `mind:night` or `mind:chat`, and a night note never replaces a chat one; `v` the note format's version; `pack` the find pack it is in). `track_ratings(track_id TEXT PK, rating INTEGER, at INTEGER)` WITHOUT ROWID with the partial index `track_ratings_out (track_id) WHERE rating = 1`: the owner's newest rating of each song, handed over by the senses route from each `music.rate` sense, kept for good (a later rating wins; an older one arriving late changes nothing). `find_packs(kind, pack, entries_json, at)` PK `(kind, pack)` WITHOUT ROWID: derived rows find reads, `notes` (500 notes to a row with the tags likeness weighs, rewritten with each batch that touches them), `audio` (the listening pass's moods and energy, packed again from its table when a day old) and `meta` (where the next note goes; when the audio was packed). `song_readers(session_id TEXT PK, at INTEGER)` WITHOUT ROWID: the night sessions the Worker served songs' tags to (session ids only, kept 7 days, each insert dropping the older), which `GET /v1/mind/pending` reads as `songs` for the PreToolUse hook that closes the night's web ([RUNTIME.md §6.4](../mind/RUNTIME.md)). The night's place in the catalog is `music_state['notes.cursor']` (`{v, ord}`: every song up to `ord` has a note current at `v`); a new track (its place may be one a deleted track held) and an import step it back before them. Triggers `track_notes_insert|update|delete` leave `music_state['notes.stale']` for any write to the notes that isn't a batch's own (a table restore, a hand edit; a batch clears it as it ends): then find's packs are built again from the notes and the night's place starts over; a rebuild that fails is logged (`music_packs_rebuild_failed`) and marked (`{"failed_at": ms}`), and tried again at most once an hour, find reading the packs as they are meanwhile. A note sent again unchanged writes nothing; a note for a track that leaves the catalog stays but is never shown, and comes back if the same audio returns under its id. Step 4 reads the listening pass's `track_analysis` (step 3, above) only through `listeningRows` (`areas/music/store-notes.ts`), and packs its moods and energy again when the pass's `listen.epoch` moves (a job applied songs) or the packs are a day old. Step 4's SQL is `areas/music/notes-sql.ts`. Planned with the player's later steps: `track_stats(track_id TEXT PK, plays, skips, last_played_at, rating)`, rebuilt nightly from `Senses.rollups`. Product fields are in [MUSIC.md](../product/apps/MUSIC.md).

### 6.3 `Library` (P7, its own deploy; shardable as `library:<shelf>`)

Built (P7 step 1, `backend/src/objects/library.ts`, schema in `library.migrations.ts`; the class shipped alone with migration tag `v4`; its routes, daily pass, backup and export with step 1b) with the fields of [STUDY.md §1.1](../product/apps/STUDY.md), which owns them: `pages` keys its rows by `seq` (the FTS rowid, as Core's `messages`) and names the page `pdf_page`; `verse_refs` is keyed by `(book_id, pdf_page, block, i)` so a page read again replaces its references, with the index `(book_code, chapter)`; `books` also holds the upload's R2 multipart id and parts while they arrive. Its routes come with the next deploy.

`books(id PK, title, author, kind, pages, r2_key, sha256, added_at, ingested_at)`. Books include the owner's own licensed copies of the canon scriptures (owner ruling 2026-10-27), stored like any book: privately, behind sign-in, never in the repo. Talks and other published source material are not stored; they are cited by paragraph with a link. `pages(rowid PK, book_id, page_index, page_label, text)` with UNIQUE `(book_id, page_index)`. `pages_fts` FTS5 with `content='pages'`. `verse_refs(book_code, chapter, v_start, v_end, book_id, page_index, weight, in_heading)` with index `(book_code, chapter)`. `highlights(id PK, book_id, page_index, ref, text, note, created_at, updated_at)`. `positions(book_id PK, page_index, at)` (one row per book, written at most once per page turn and at most every 10 s). Product fields are in [STUDY.md](../product/apps/STUDY.md).

The FTS cost per page is unknown (open question D3). Ingestion is a bulk job under the lane cap.

`embeddings` (step 3, 2026-11-04, recall by meaning, MEMORY.md §10.6): `ref TEXT PK` (`msg:<id>`, `fact:<id>`, `day:<day>`, `book:<id>#p<n>`), `source`, `vector BLOB` (384 Float32, unit length), `snippet` (≤ 200 chars, what the hit shows), `at`, `provenance` (as the row's FTS hit is labelled; none for a page), `indexed_at`; index `(at)`. Written by Core's `search.embed` lane job a batch at a time (`areas/library/vectors.ts`; 100 vectors write 300 rows), read whole by the recall (one row a vector), at most 10,000 rows (the oldest by `at` go at the end of each run's sweep). Derived: in no backup or export, rebuilt by the indexer.

---

## 7. R2 buckets and key layout

### 7.1 `thunderhead-private` (Worker binding `VAULT`; never public)

| Prefix | Key pattern | Contents | Written by | Kept |
|---|---|---|---|---|
| `backups/` | `backups/<YYYY-MM-DD>/<class>/<table>.<part:0000>.jsonl.gz`, `backups/<date>/manifest.json` | Weekly per-table export | `export.weekly` job | 8 weekly + 12 monthly |
| `events/` | `events/<YYYY>/<MM>/<DD>.jsonl.gz` | Daily events archive | `events.export` job (P5) | forever |
| `books/` | `books/<book_id>.pdf` ([STUDY.md](../product/apps/STUDY.md) §2.1) | Study PDFs, including the owner's licensed scripture copies (owner ruling) | upload route (P7) | until the owner deletes (proposal) |
| `study/` | `study/scripture.json`, `study/text/<code>.json` ([STUDY.md](../product/apps/STUDY.md) §7.1, §7.6) | The owner's scripture book table with its link template, and each book's verse text from the owner's licensed copies; never in the repo | `PUT /v1/library/scripture[/text/:code]` (the mind, SETUP.md O2) | until replaced |
| `chat/files/` | `chat/files/<YYYY>/<MM>/<uuidv7>.<ext>` (the month in UTC from the UUIDv7's own time; the extension from a fixed list of types, else `bin`; imported files keep their old keys under this prefix) | Chat attachments, photos, voice memos, stored once with their `Content-Type` and SHA-256 | `PUT /v1/files/:id`; import I6 | forever unless deleted (the `Core.files` row with them) |
| `muse/files/` | `muse/files/<id>` | Muse files (imported, then new) | import I4; work orders | forever unless deleted |
| `takes/` | `takes/<uuidv7>.<ext>` | Guitar recordings the owner sends | P6 | owner-controlled |
| `indexes/` | `indexes/<kind>/<build>.json.gz`, `indexes/<kind>/latest.json` | Phone-loaded indexes (music search, study) | jobs | latest 3 builds |
| `imports/` | `imports/old/<run_id>/<instance>/<table>/part-<nnnn>.jsonl.gz` + `imports/old/<run_id>/manifest.json`; `imports/phone/<import_id>.json.gz` | Raw imports | `POST /v1/ops/import/parts`; `/v1/import/phone` (P1b) | until the owner approves deleting them, after the last app's data move (P8) and the old Worker's retirement ([PRIVACY.md §2](PRIVACY.md)) |
| `jobs/` | `jobs/incoming/<job_id>/part-<nnn>.jsonl`, `…/neighbours.bin`, `…/manifest.json`; `jobs/specs/<job_id>.order`, `.emb` | An Actions run's raw uploads, unchecked until collected; a neighbours spec's hash order and int8 embeddings | `PUT /v1/jobs/:id/files/:name`; `GET /v1/jobs/next` (JOBS.md §3) | until the job is applied, rejected or expired (≤ 72 h unless collected) |
| `music/` | `music/pack.v1.bin`, `music/neighbours.v1.bin` | The phone's listening-pass file (MUSIC.md §9.1) and the last neighbours (derived; rebuilt from `Music.analysis` and the next neighbours job) | `music.listen.pack`, `music.listen.apply` | the current one, replaced |
| `profile/` | `profile/<YYYY-MM-DD>.json` | Weekly snapshot of the rendered profile | night shift | 104 weeks |
| `drills/` | `drills/<YYYY-MM>/report.json` | Restore drill reports | drill job | forever |
| `exports/` | `exports/<uuidv7>/manifest.json` | "Download everything" manifests (they point at backup keys) | P4 | 7 days |
| `ops/` | `ops/restores/<uuidv7>.json`, `ops/deploys/<YYYY-MM-DD>.jsonl` | Restore records kept outside the restored object; deploy records | Worker | forever |

### 7.2 `jarvis-music` (Worker binding `MEDIA`; shared with the old Worker)

`native/audio/<sha256>.opus`, `native/art/<sha256>.<ext>`, plus the existing catalog files. The new Worker reads by presigned GET and writes only through `backend/src/areas/music/upload.ts`. It never deletes (rule 9 at the top; the `no-music-delete` test). Uploads use `Cache-Control: private, max-age=31536000, immutable`.

### 7.3 `thunderhead-jobs` (not made)

Planned for raw Actions results; not needed since the listening pass sends its results through the Worker into `thunderhead-private` (`jobs/incoming/`, §7.1, JOBS.md §3): no bucket, no binding, no lifecycle rule, and no write key in Actions.

### 7.4 Media ref → key map (used by `POST /v1/media/sign`)

| Ref | Bucket | Key | Lookup |
|---|---|---|---|
| `music:<id>` | `jarvis-music` | `tracks.audio_key` | 1 row in `Music` |
| `music:<id>#art` | `jarvis-music` | `tracks.cover_key` | 1 row in `Music` |
| `book:<id>` | `thunderhead-private` | `books.r2_key` | 1 row in `Library` (read through `GET /v1/library/books/:id/file`, never signed) |
| `file:<id>` | `thunderhead-private` | `files.key` | never signed: read through `GET /v1/files/:id` (1 row in `Core`) |
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

**The rows-read guard** (built 2026-10-31, after the Music object read 4.42M of a day's 4.63M rows): the row meter (§3) counts each day's rows read and written by this Worker's five objects. The limits are the account's, and the old Worker (`jarvis-hub-api`, not in this repository) uses about 180,000 rows read and 32,000 written a day on the same account, which the meter can't see; so the guard counts against the day's budget, the limits less `OLD_WORKER_RESERVE` (200,000 read, 32,000 written, `shared/contract/meter.ts`; both drop to 0 once the old Worker retires, SETUP.md N5, M4): 4,800,000 rows read and 68,000 written. From 60% of either side (2,880,000 read, 40,800 written) the watchdogs `quota.rows_read` and `quota.rows_written` trip and the Briefing page and the mind's briefing say so in one line (the owner's words still say "of the free plan's daily limit"). From 80% (3,840,000 read, 54,400 written) the owner gets one push that day, and the heavy work waits for 00:00 UTC: the weekly backup and the monthly drill, and every bulk-lane job, pause before their next step (a drill stops between two parts; the rows it wrote into its scratch copy are added to the day's meter as they are written, class `scratch`), the senses daily archive skips its ticks, and the upload tools' operations (`POST /v1/music/uploads/:op`) and the listening pass's `GET /v1/jobs/next` (the night mind's one held call) answer `429` with `Retry-After`. The phone and the mind's chat are never held, nor "download everything" (the owner's own request). A job that waited runs when its pause ends at 00:00 UTC; the archive runs on the first tick after.

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
| Core.facts (+fts, ledger, feed, batch record) | 50 ops | 11 (measured) | 550 |
| Core.day_notes, open_threads (+ledger, feed), session_notes | ~30 | 7–8 (measured) | 240 |
| Core.night_runs (one row, rewritten per step) | ~12 | 1 (measured) | 12 |
| Core.errors | ≤ 200 upserts (capped) | 1 | 200 |
| Core.perf_days, settings | ~25 | 1 | 25 |
| meter_days + jobs + alarms (all classes) | — | — | ~2,000 (the meter 1,000–1,500, §3) |
| Auth (last_seen hourly, agents last_used hourly, notices) | — | — | ~200 |
| **Subtotal P1–P4** | | | **~9,750** |
| Senses.events (3,000 events × row + 1 index; same again pruned 90 days later) | — | 2 + 2 | 12,000 |
| Senses.batches (+prune), rollups | 150 batches; 300 rollups | ~2 | 900 |
| Music.track_stats nightly | ≤ 200 tracks | 2 | 400 |
| The listening pass (Music.analysis, external_jobs; Core's apply job; JOBS.md §3.5), until the library is done | one job of ≤ 500 songs a night | ~2.1 a song (105 per part of 50 in Music: `analysis` and `track_analysis`; ~10 a job in Core) | ~1,060 (≈ 25,000 for the whole library over ≈ 24 nights, then ≈ 12,000 once for the first neighbours on the lane; again only when the analyzer changes) |
| Music.track_notes + find_packs (the night's songs, until the library is covered; then only new ones) | ≤ 400 notes (2 batches) | 1 (measured: 203 for 200, the pack and the restore mark included; 0 for a note sent again unchanged) | ≤ 406 |
| Music.track_ratings (the phone's ratings) | ~5 | 1, 2 for a rating of 1 (measured) | ~10 |
| Library.positions, highlights | ~200 | 1–3 | 300 |
| Core.reports (one a minute while Music plays, one per page hide; pruned 30 days later) | ~600 (10 h of music) | 1 + 1 | 1,200 |
| Core.podcast_progress (one sync a minute while an episode plays, one on each pause and hide; a phone's sync is one row) and follows | ~200 (3 h of podcasts) | 2 | 400 |
| Core.podcast_follows checks and the night's count of feed reads (≤ 20 shows; ≤ 40 reads) | ≤ 60 | 1 | 60 |
| Held conversations: a message off the record (no FTS entry, the purge moved: 9 measured), a Delete (32 for a day of 20 waiting messages, settled), the purge (~5 a message with FTS entries and an optimize, ~1 off the record; at most 500 messages a tick) | rare | — | ~100 on a day with one purge; ≤ 2,600 a tick at most |
| **Total steady (P5+)** | | | **~26,000 (26%)** |

### 8.3 The bulk lane

- One bulk job runs at a time, account-wide. `Core.settings['bulk.lane']` names the holder `{class, job_id, day}`. A job asks for the lane through the `ensureAlarm` RPC that `Core.tick` already makes every 15 minutes. **[proposal]**
- The lane holder may write 40,000 rows per day (`meter.bulk_rows_written`). At the cap the job sets `state='paused'` with `due_at` = next 00:05 UTC.
- Built as the rows-read guard (§8.1, 2026-10-31): once the day's rows written by the five objects and the drill's scratch copy (Core's `meter_days`, gathered by `tick`) pass 80% of the day's budget (54,400 of 68,000), every lane job pauses before its next step until 00:00 UTC, even below the lane's own cap.
- Lane users: imports, FTS reindex, music catalog import (on its own day), library ingestion, table restores, the monthly drill, the listening pass's apply job (`music.listen.apply`: Music's rows counted in Core's step commit), the recall indexer (`search.embed`: the Library's rows counted the same way).

Acceptance: a vitest test with a fake meter at 39,990 runs one job step of 2,000 rows and sees the job pause at the step boundary, with `due_at` next 00:05 UTC.

### 8.4 Reads

- No request-path query may scan a growing table. Every hot query has an `EXPLAIN QUERY PLAN` test that rejects `SCAN <table>` without an index.
- Search queries are capped at 20,000 rows read each (checked in cost tests at fixture scale). The recall by meaning reads every row of the Library's `embeddings` for the asked sources (a scan, bounded by the table's 10,000-row cap: one row a vector, 204 for 200 in the cost suite) and checks its 30 candidates in Core by key (95 rows with the FTS lists); an index batch of 100 messages reads 205 in Core and writes 300 in the Library, 2 in Core.
- The Music object's mind-facing reads (2026-11-01, measured cold at full size: 12,000 tracks, 11,600 with a note, the object just started): every read is by key or a key range, so a call's rows follow its own size, not the catalog's. A batch of 200 notes replacing 200 reads 1,226 rows (each song's track and note by key, its pack, the triggers' check of the restore mark) and writes 203; the same batch again reads 800 and writes 0; notes by id read 4 rows an id (200 for 50); a page of 200 notes 601; the night's untagged page of 200, its place kept, 202. Find cold reads 134 with the listening pass's moods and energy for every song (the restore mark, the meta rows, the pass's epoch, the notes' 24 packs and the audio's, the ratings of 1, the winners' tags by key), 136 with `like` (the seed's row and its 50 neighbours by key), 81 warm (the epoch, the winners' tags); the packs built again after a restore, the audio's with them, read every note, track and measured song once (36,409 rows, 52 written: a one-off). In the Senses object find reads the early skips (113 rows for 40 skips among 200 events: one index seek a day of 33, then only the skips; 0 until a new skip arrives); in Core, the current rules (3), and for a mind session the taint below (8 read, 5 written in all). A batch of 100 ratings of 1 (the phone's one-time catch-up, 100 a page load) writes 200 rows in Music and 301 in Senses. Songs' tags served to a mind session cost every call 5 rows read and 5 written in Core (the claimed, live session checked, the dated taint event and, for a night session, its songs mark, with their index entries: a night of 60 pages writes about 300) and, for a night session, 6 read and 1 written in Music (the reader). The listening pass's packs are built from its table when its epoch moves (a job applied songs, at most once a night) or a day on (one row a measured song then, about 26 written). The word search `/v1/music/tracks?q=` still reads the tags once per object start (12,000 at 12,000 tracks, under the 20,000 cap), as it did before the notes.
- The weekly backup reads every row once (~0.5M rows at year 2).

---

## 9. Migrations

1. **Class declarations** use the classic `migrations` array in `backend/wrangler.jsonc`. An entry is never edited after it ships:
   ```jsonc
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["Core", "Auth"] },    // P1
     { "tag": "v2", "new_sqlite_classes": ["Music"] },           // P5, deploy alone
     { "tag": "v3", "new_sqlite_classes": ["Senses"] },          // P5, deploy alone
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
| Core.threads, messages | forever; a conversation off the record 7 days after its last message, a deleted one 30 days after the delete (purged with its files and evidence links by the prune pass, `areas/conversation/purge.ts`) | yes, but never a held thread or its messages | yes, but never a held thread or its messages |
| Core.messages_fts, facts_fts, day_notes_fts | derived | no (rebuilt) | no |
| Core.ledger | forever (forget leaves a tombstone) | yes | yes |
| Core.proposals | 1 year after decided ([PRIVACY.md §2](PRIVACY.md)) | yes | yes |
| Core.verbs | done/failed/expired/cancelled deleted 30 days after `done_at` or `expires_at`; a scheduled row stays until it runs or is cancelled | yes | yes |
| Core.mixes (step 29) | the newest 50 (an undo of `music.mix_save` deletes its mix at once) | yes | yes |
| Core.surfaces | expired rows deleted within 24 h of `expires_at` (the next daily pass) | yes | no |
| Core.work_orders | finished rows 180 days | yes | yes |
| Core.eval_runs | forever (one row per suite a week; numbers and ids only) | yes | no |
| Core.predictions | forever (at most 12 rows a day: the night shift's prediction, its resolver and arguments, the outcome and base rate; the meter reads them all) | yes | yes |
| Core.files | forever, as long as its bytes in `chat/files/` (one row per chat file: its name, type, size, SHA-256, a voice memo's seconds and words, who uploaded it and the message that took it; never the bytes); a held conversation's with it, bytes first | yes, but never a held conversation's | yes (the bytes stay in the bucket, read through `GET /v1/files/:id`), but never a held conversation's |
| Core.reminders | forever (the owner's own words, as the conversation line each becomes; at most 50 set at once) | yes | yes |
| Core.reports | 30 days after `at` (one row per batch from the phone: timings, counts and track ids, never titles or words) | no (diagnostics: a backup would read every row each week for nothing) | no |
| Core.podcast_progress | the newest 1,000 by `updated_at` (a position per episode: its feed address and episode id, where it was left, whether it was finished) | yes | yes |
| Core.podcast_follows | while followed; an unfollow 30 days; at most 300 rows (the show's address, title, author and artwork, and the night's last check) | yes | yes |
| Core.calendar_events | the next 14 days of each calendar link, replaced at each fetch that differs; a failing link's kept 48 hours from its last good fetch; events a day past their end and a removed link's deleted by the daily prune | no (fetched again on the next roll or open) | yes |
| Core.calendar_feeds | one row per calendar link while it is set (its last try, never its address); a removed link's deleted by the daily prune | no | no |
| Core.watchdogs | forever (one row per watchdog: its state, the last check's counts, the reflex's report) | yes | yes |
| Core.backups | forever (one row a week: its date, state, counts and the manifest's key) | yes | no |
| Core.drills | forever (one row a month: the backup it restored, passed or failed, the report's key) | yes | no |
| Core.exports | 1 day after it expires (the ZIP's parts leave the bucket when it does, an hour after it was ready) | no | no |
| Core.work_orders | 1 year after it finished (each with its validated result, outside text from Muse) | yes | yes |
| Core.muse_notes | newest 500 notes (Muse's own thread, never the owner's conversation) | yes | yes |
| Core.facts, day_notes | forever (facts until forgotten; a fact labelled `outside` that nobody kept, 90 days after it was written, by the daily pass: MEMORY.md §6 M11g) | yes | yes |
| Core.fact_tombstones | forever (forgotten ids only, no text: an id is never reused, and a restore re-applies the forget) | yes | no |
| Core.open_threads | open: until closed; closed: 1 year | yes | yes |
| Core.session_notes | 180 days | yes | yes |
| Core.import_items | 30 days after conversion | yes | no |
| Core.imports | forever | yes | no |
| Core.wakes | 30 days | yes | no |
| Core.watches | 30 days after it settles (fired, refused, cancelled or lapsed; a waiting one settles within 7 days and 12 hours) | yes | no |
| Core.leases | live only | no | no |
| Core.live_tickets | deleted 1 h after `expires_at` | no | no |
| Core.mind_sessions | 90 days after `ended_at` | yes | no |
| Core.night_runs | 400 days | yes | no |
| Core.night_reports | 30 days (the daily prune) | yes | yes |
| Core.jobs | done or failed jobs 30 days after their last step | no | no |
| Core.topics | forever (one row per topic key) | yes | no |
| Core.op_batches | 7 days (idempotency window for batch writes, [API.md §7](API.md#7-idempotency)) | no | no |
| Core.errors | 30 days after `last_at`; at most 1,000 fingerprints (oldest resolved go first) | yes | no |
| Core.perf_days | 400 days | yes | no |
| Core.changes | newest 10,000 rows | no | no |
| `jobs`, `_migrations` (all classes) | jobs done 30 days | manifest only (schema version) | no |
| Core.meter_days | 400 days (one row per UTC day and object class, Core's own and the others' from its tick; counts only) | no | no |
| `meter_days` (Auth, Music, Senses, Library: each its own class's row) | 400 days (pruned by the meter itself when a day begins) | no | no |
| Auth.* | sessions deleted 30 days after revoke or expiry; throttle 24 h; notices 14 days; pushes 30 days | **never** | **never** |
| Senses.events | 90 days | archive in R2 daily instead | yes (the archive) |
| Senses.batches | 30 days | no | no |
| Senses.rollups | forever | yes | yes |
| Senses.exports | forever (one row a day: the day's archive key, count and hash) | yes | no |
| Music.tracks, catalog_log, music_state | forever | yes | yes |
| Music.analysis | forever (one row per audio hash: numbers only, replaced by a newer analyzer's) | yes | yes |
| Music.track_analysis | forever (derived: one row per analysed track, its energy, moods and neighbours' ids; rebuilt by the next neighbours job) | yes | yes |
| Music.external_jobs | 90 days after issue once finished (pruned, 20 a call, when the next job is issued); the spec's hashes only, never a title | yes | yes |
| Music.track_notes | forever (one row a track: what the mind knows of the song; a removed track's row stays unread) | yes | yes |
| Music.track_ratings | forever (one row a rated track: its newest rating) | yes | yes |
| Music.find_packs | derived (built again from the notes; the listening pass's after a day) | no | no |
| Music.song_readers | 7 days (night session ids that read songs' tags; dropped as new ones arrive) | no | no |
| Library.books, pages, verse_refs, positions | forever (a book until the owner approves deleting it) | yes | yes (PDFs by signed URL) |
| Library.pages_fts | derived | no (rebuilt) | no |
| Library.embeddings | derived; ≤ 10,000 rows, the oldest dropped; a row gone from its source dropped by the next run's sweep | no (rebuilt) | no |
| Library.highlights | forever; a deleted one 30 days after `deleted_at` | yes | yes |
| Library.ingest_jobs | finished runs 90 days | yes | no |

Pruning runs once a logical day: Core's 15-minute tick runs every table's prune (`TableInfo.prune` in the area's `migrations.ts`), each in steps of ≤ 2,000 deletes, and marks the day done only when no prune was cut short. A test fails if a table kept for less than forever has no prune. Before them, every tick, the prune pass purges the held conversations that are due (`objects/core-held.ts`, one index read when none is): at most 500 messages a tick, never while the rows guard holds the heavy work (from 80%, until 00:00 UTC; the thread is already gone from every read), each step deleting the files' bytes from the bucket first, then in one commit the messages and their FTS entries, the files' rows, the evidence links, and once the thread is empty the thread, the session notes naming it, an FTS `optimize` and a content-free ledger row (MEMORY.md §6.1).

---

## 11. Backup, export and restore

### 11.1 Layers

| Layer | What | When | Restores |
|---|---|---|---|
| PITR | Cloudflare's 30-day point-in-time recovery for SQLite DOs | Always on. Bookmarks recorded before every migration, import and restore. Availability on Free is test X4. | A whole object to any time in the last 30 days |
| Weekly export | Per-table JSONL.gz in `thunderhead-private/backups/<date>/<class>/<table>.<nnnn>.jsonl.gz`, never holding a held conversation (off the record or deleted: its thread, messages and files' rows), so no backup keeps one off the record past its 7 days; one made before a delete keeps that conversation until the backup ages out | Sundays 02:30 local, a job per class (`export.weekly`), ≤ 5,000 rows per part file in key order (built for Core, P4 stage E: every table marked `backup` in §10; by RPC, each with its own manifest, the Music object's three tables from P5 and its `track_notes` and `track_ratings` from step 4 (not the derived `find_packs`), and from P7 the Senses' `rollups` and `exports` and the Library's tables but `pages_fts`; the drill and `backup.stale` read Core's) | One table, or a whole object into a fresh instance |
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

- **CI round trip** (every push): seed a fixture into `Core`, export every table, import into a fresh DO, then deep-equal every table. The same runs for each class once it exists. Built: `backend/tests/integration/backups.test.ts`, which also kills a backup step mid-way and checks each part's sha256 against the manifest.
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
   | I2 chat messages | `Core.messages`, `origin='import'` | Body byte-equal; each message's FTS entry written with it; a reply to a message not imported keeps no link |
   | I3 notebook | `Core.import_items` | The mind converts it once into facts citing `import:<id>` (P3) |
   | I4 Muse chat, work, files | a `muse` thread + closed `work_orders`; files to `muse/files/` | |
   | I5 Board editions and profile | not imported: the Board was cut (2026-10-31); they stay in the archive | |
   | I6 chat files | `chat/files/…` (R2 to R2 inside the Worker, size and ETag checked) | Originals stay in `jarvis-music` |
   | I7 music catalog | `Music.tracks`, `Music.catalog_log` | P5, on its own day (≈ 2 writes per track) |
   | sign-in tables | **not imported** | The owner signs in fresh |

4. **Proof** (`imports.report_json`, and the test in TESTING.md §8):
   - per dataset, `imported + skipped` = manifest rows, and every skip has a reason (`duplicate`, `empty`, `invalid_ref`, or `dropped` for rows the inventory leaves behind: the old lease and error inbox, roles other than the owner's and Claude's);
   - per thread, the message count and the first and last `created_at` are equal;
   - 20 random old IDs, chosen with a seed recorded in the report, deep-equal after the normalisation listed per dataset in MIGRATION.md;
   - a second run of the same import changes 0 rows (`rerun_delta` = 0; its job writes only its own bookkeeping, measured in the cost suite).
5. **Phone-local data** (P1b) is restored verbatim into the ported apps' own stores on the new origin by the `/import/` page, and the same file arrives through `POST /v1/import/phone` ([API.md §11.17](API.md#1117-import)). It is stored raw in `imports/phone/` with an `imports` row; each app's new tables seed from it once, at that app's data move (P5, P6, P8) ([MIGRATION.md §5](../archive/MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)).

Acceptance: the owner sees "Imported N conversations, M messages. 20 of 20 spot checks matched." in the briefing on the day of the import.

---

## 13. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| D1 | Is PITR available on Free? (X4) | Preview Worker: call `getCurrentBookmark()` and `getBookmarkForTime(now − 1 h)`; restore a scratch object |
| D2 | Does local workerd `rowsWritten` match production billing? | Compare the meter with the dashboard after one week |
| D3 | Rows written per FTS5 insert (per message, per 300-word page) | Measured for a page (local workerd, `tests/cost/library-calls.ts`): one 300-word page with two verse refs is 9 rows written in all (the row, its unique index, the FTS entry, two refs with their index, the run's cursor). Check against the dashboard after the first real book |
| D4 | Does `deleteAll()` count every row as a write? Is `DROP TABLE` cheap? | Local workerd measurement; if `DROP` is cheap, switch `Senses.events` to monthly tables |
| D5 | Is the 1 GB per-object limit enforced on Free as the FAQ says? | Watch `db_bytes` in deep health; alert at 700 MB |
| D6 | DO CPU per job step on Free (10 ms or 30 s), which sets the step size | Test X3; until then steps are ≤ 2,000 rows |
| D7 | `CompressionStream('gzip')` CPU cost inside a DO for a 5,000-row part | Measure in preview; lower the part size if it overruns |
