# Memory

What the mind remembers, how it is written, who may write what, how it fades, and how the owner sees and fixes it.
All memory lives in the `Core` Durable Object (SQLite), so a memory write, its ledger row and any proposal commit in one transaction. Large files live in the private R2 bucket. Nothing personal is ever in the repository.

## Rules at a glance

1. **Raw first, derived second.** Messages and events are kept as they happened and never summarised away. Day notes, facts, open threads and session notes are derived, and each points back to its evidence.
2. **Writes are small operations, not documents:** `remember`, `confirm`, `supersede`, `forget`. No whole-notebook rewrites.
3. **Facts are never edited in place.** A change closes the old row (`valid_to`, `superseded_at`) and inserts a new one. Only the owner's `forget` deletes, and it leaves a contentless tombstone.
4. **Provenance is enforced by the Worker, not the model.** `source=user` needs owner-device evidence; `kind=rule` needs `source=user`; outside text can never be evidence.
5. **Confidence decays at read time** by kind (state 3 d … fact 5 y; rules never). Below 0.25 a fact leaves the profile but is not deleted.
6. **The profile is a deterministic render** of current facts (≤ 6,000 characters), not text an LLM writes.
7. **The briefing is built by the Worker** in a fixed order with fixed budgets: a core of ≤ 9,500 characters plus a full file.
8. **The day rolls at 04:00 local after 60 quiet minutes.** Open threads, the day note and a fallback tail make the split lossless.
9. **Search is SQLite FTS5 first.** Embeddings come later (P8) and only after their eval passes.
10. **The owner can see, fix, pin, forget, and mute ("don't bring this up") every fact** on the Memory page.
11. **Some things are never stored** (§13): secrets, raw camera or microphone streams, inferred sensitive traits.

Sibling docs: [RUNTIME.md](RUNTIME.md) (the `th` commands that read and write memory), [BEHAVIOR.md](BEHAVIOR.md), [CONSTITUTION.md](CONSTITUTION.md), [EVALS.md](EVALS.md) (memory probes). Engineering: [DATA.md](../engineering/DATA.md) (canonical table list, retention, exports), [PRIVACY.md](../engineering/PRIVACY.md), [MIGRATION.md](../engineering/MIGRATION.md) (the import).

---

## 1. The stores

| Layer | Store | Written by | Read by | Kept |
|---|---|---|---|---|
| L0 raw | `messages`, `threads` | Worker (owner device, mind, system, Muse posts) | Everyone with scope | Forever |
| L0 raw | `events` (senses) | Worker from phone batches | Night shift, `th day`, stats | 90 days in SQLite; daily JSONL in R2 forever |
| Session | `session_notes` | Mind at session end | Briefing ("Today so far") | Forever |
| L1 episodic | `day_notes` | Night shift; owner edits | Briefing ("Yesterday", last 7) | Forever |
| Continuity | `open_threads` | Chat, night; owner | Briefing (always) | Forever |
| L2 semantic | `facts` | Chat, night (validated); owner | Profile, `recall` | Forever (closed rows kept) |
| Audit | `ledger`, `proposals` | Worker for every change | Owner (Ledger), mind | Forever |
| Later (P9) | `predictions` | Night | Meter | Forever |

Conventions (from the architecture review): ids are UUIDv7 text; times are `*_at` integers in ms UTC; `day` is the owner-local `YYYY-MM-DD`; JSON columns end in `_json` and carry `"v": n`; names are snake_case on the wire and in storage.

---

## 2. Schemas

Exact columns. [DATA.md](../engineering/DATA.md) owns indexes and migrations; it must match these columns or update this page in the same commit.

```sql
-- Conversation (L0)
threads(
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL,          -- 'daily' | 'muse' | 'imported'
  title TEXT, title_source TEXT,                                       -- 'auto' | 'mind' | 'owner'
  summary TEXT,                                                        -- ≤ 400 chars, night shift
  status TEXT NOT NULL,                                                -- 'open' | 'filed'
  continues TEXT,                                                      -- thread id or NULL
  started_at INTEGER NOT NULL, filed_at INTEGER)

messages(
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE,                    -- seq feeds /v1/live/wait
  thread_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  author TEXT NOT NULL,                                                -- 'owner' | 'mind' | 'system' | 'muse'
  origin TEXT NOT NULL,                                                -- 'owner_device' | 'mind' | 'system' | 'muse' | 'import'
  kind TEXT NOT NULL,                                                  -- 'text' | 'voice' | 'progress' | 'card' | 'question' | 'error'
  body TEXT NOT NULL, reply_to TEXT, meta_json TEXT, attachments_json TEXT,
  device_id TEXT, session_id TEXT,
  delivered_at INTEGER, acked_at INTEGER, answered_at INTEGER)
-- messages_fts: FTS5(body, content='messages', content_rowid='seq', tokenize='unicode61 remove_diacritics 2')

-- Senses (L0). In Core until the Senses class arrives (P5). Shape fixed in decisions.md.
events(
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL,   -- 'music.skip'
  ref TEXT, data_json TEXT, sensitivity INTEGER NOT NULL,              -- 0 | 1
  device_id TEXT NOT NULL, origin TEXT NOT NULL, batch_id TEXT NOT NULL)

-- Session continuity
session_notes(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, wake_id TEXT, role TEXT NOT NULL,
  thread_id TEXT, created_at INTEGER NOT NULL,
  body TEXT NOT NULL,                                                  -- ≤ 120 words
  open_items_json TEXT)                                                -- [{text, ref}] ≤ 10

-- Episodic (L1)
day_notes(
  day TEXT PRIMARY KEY, summary TEXT NOT NULL,                         -- ≤ 150 words
  decisions_json TEXT,                                                 -- [{text, evidence:[ids]}] ≤ 10
  stats_json TEXT,                                                     -- deterministic rollups from the Worker
  importance INTEGER NOT NULL,                                         -- 1..10
  written_by TEXT NOT NULL,                                            -- session id or 'owner'
  version INTEGER NOT NULL, written_at INTEGER NOT NULL)
-- day_notes_fts: FTS5(summary)

-- Commitments and loose ends
open_threads(
  id TEXT PRIMARY KEY, text TEXT NOT NULL,                             -- ≤ 200 chars
  owner TEXT NOT NULL,                                                 -- 'mind' | 'owner'
  due_at INTEGER, tags_json TEXT,                                      -- e.g. ["agreed"], ["code"]
  status TEXT NOT NULL,                                                -- 'open' | 'done' | 'dropped'
  evidence_json TEXT NOT NULL, opened_at INTEGER NOT NULL,
  last_progress_at INTEGER, closed_at INTEGER, closed_why TEXT)

-- Semantic (L2): bi-temporal, provenance-linked, never edited in place
facts(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                                                  -- 'preference'|'routine'|'fact'|'goal'|'state'|'rule'
  about TEXT NOT NULL,                                                 -- 'owner' | 'world' | 'person'   [proposal]
  subject TEXT,                                                        -- short key, e.g. 'music.evening'
  text TEXT NOT NULL,                                                  -- ≤ 280 chars, one claim
  tags_json TEXT,                                                      -- e.g. ["faith"], ["health"]
  source TEXT NOT NULL,                                                -- 'user' | 'observed' | 'inferred'
  confidence REAL NOT NULL,                                            -- c0 at last confirm
  evidence_json TEXT NOT NULL,                                         -- [ids of messages/events/day_notes], 1..20
  valid_from INTEGER, valid_to INTEGER,                                -- world time
  recorded_at INTEGER NOT NULL, superseded_at INTEGER, superseded_by TEXT,   -- system time
  last_confirmed INTEGER NOT NULL,
  sensitivity INTEGER NOT NULL,                                        -- 0 | 1
  pinned INTEGER NOT NULL DEFAULT 0,
  may_raise INTEGER NOT NULL DEFAULT 1,                                -- 0 = don't bring this up
  written_by TEXT NOT NULL)                                            -- session id or 'owner'
-- facts_fts: FTS5(text, subject). Engineering adds `seq` (the FTS rowid, as for messages) and
-- `ledger_id` (the row that wrote the version); day_notes gets `seq` too (DATA.md §4.4).

-- Audit and undo for every memory or world change
ledger(
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, at INTEGER NOT NULL,
  actor TEXT NOT NULL,                                                 -- 'mind:chat'|'mind:night'|'mind:reflex'|'owner'|'worker'|'muse'
  session_id TEXT,
  kind TEXT NOT NULL,                                                  -- 'memory'|'arrangement'|'verb'|'deploy'|'proposal'|'mistake'|'undo'|'note'
  what TEXT NOT NULL, why TEXT NOT NULL,                               -- why ≥ 8 chars
  ref TEXT, topic_key TEXT,
  undo_json TEXT, undoable INTEGER NOT NULL,
  status TEXT NOT NULL,                                                -- 'done' | 'undone' | 'failed'
  tainted INTEGER NOT NULL DEFAULT 0, proposal_id TEXT,
  op_json TEXT, verb_id TEXT, undone_at INTEGER)                      -- engineering columns (DATA.md §4.3)

proposals(
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  class TEXT NOT NULL,                                                 -- 'delete'|'money'|'access'|'reach_people'|'memory_big'
  question TEXT NOT NULL, why TEXT NOT NULL, if_ignored TEXT NOT NULL, odds REAL,
  spec_json TEXT NOT NULL, spec_hash TEXT NOT NULL,                    -- sha256 of canonical spec_json
  status TEXT NOT NULL,                                                -- 'waiting'|'approved'|'rejected'|'expired'|'cancelled'|'executed'|'failed'
  expires_at INTEGER NOT NULL,                                         -- created_at + 7 d
  decided_by_device TEXT, decided_at INTEGER, executed_ledger_id TEXT,
  decided_via TEXT,                                                    -- 'tap'|'words' (owner ruling: a device tap or the owner's own words)
  decided_message_id TEXT)                                             -- the owner-device message, when decided_via = 'words'
```

`memory_big` **[proposal]** is a fifth class used only for memory changes the Worker won't apply alone (§6, rules M9–M10). It is approved by a tap or by the owner's own words (on the Memory page or in the conversation); it is not one of the four ask-first classes.

**Acceptance:** a schema test compares the live `PRAGMA table_info` of each table with this page's column list (generated fixture), and fails on drift.

---

## 3. Write operations

All writes go through `th` → the Worker. The Worker validates, writes the row, writes a ledger row (with undo) and, if needed, a proposal, **in one transaction**.

| Op | Who | Effect | Undo stored |
|---|---|---|---|
| `remember` | chat, night, owner | INSERT a new fact | Close it (`superseded_at`, no successor) |
| `confirm` | chat, night, owner | Set `last_confirmed = now`; `confidence = max(confidence, base(source of new evidence))`, within the fact's own cap. If the new evidence is all the owner's own words and the fact was not `user`, it becomes a supersede to `source=user` (tag `imported` dropped: "Yes, that's right") | Restore previous values |
| `supersede` | chat, night, owner | Close the old row (`valid_to = valid_from of new` if world-time change, `superseded_at = now`, `superseded_by = new id`), INSERT the new row | Reopen the old row, close the new one |
| `forget` | **owner only** | DELETE every version of the fact and their FTS entries (then an FTS `optimize`, so the words leave the index segments too); the memory ledger rows that pointed at them lose their `why` and their undo, and so does every surface row that drew on them (its `why` may quote the fact; puts list their facts for this); one tombstone row remains: `{fact_id, kind, forgotten_at, versions}` and **no text** (memory rows never carry fact text) | None (that is the point). A 10 s "Undo" on the phone before the request is sent (built, P3) |
| `batch` | night | Up to 50 ops applied atomically; each op validated; rejected ops are listed, valid ones applied | Per op |
| `mute` / `unmute` | owner | Set `may_raise` 0/1 | Toggle back |
| `pin` / `unpin` | owner | Set `pinned` 1/0 | Toggle back |

Consolidation (night step 4) chooses exactly one of ADD / CONFIRM / SUPERSEDE / NOOP per candidate, after `th recall --kind facts` for similar facts. It never deletes.

**Acceptance:** Worker tests for every op, including that `forget` leaves no text in `ledger`, `facts`, `facts_fts` or the weekly snapshot after the next export.

---

## 4. Confidence by source

| Source | Meaning | Starting confidence | Cap | Evidence required |
|---|---|---|---|---|
| `user` | The owner said it | 0.95 | 0.95 (pinned: 1.0) | ≥ 1 owner message (`author=owner`, `origin=owner_device` or imported owner message); all evidence owner-origin |
| `observed` | Seen in the owner's own events | 0.70 | 0.85 | ≥ 10 owner-device events, or a stats rollup covering ≥ 10 |
| `inferred` | The mind's reading of patterns | 0.50 | 0.80 until the owner confirms | Owner messages, owner events or day notes; never outside text |

---

## 5. Decay

Computed at read time, never written (protects the daily write budget):

```
c(now) = c0 · 0.5 ^ ((now − last_confirmed) / half_life(kind))
```

| Kind | Half-life | Example |
|---|---|---|
| `state` | 3 days | "Is tired this week" |
| `preference` | 180 days | "Likes calm music in the evening" |
| `routine` | 60 days | "Practises guitar after lunch" |
| `goal` | 90 days | "Wants to play the piece at 100 bpm" |
| `fact` | 5 years | "Owns a classical guitar" |
| `rule` | none | "Answer in the second language after 21:00" |

- **Pinned facts don't decay** **[proposal]**.
- Below **0.25** a fact drops out of the profile. Below **0.10** it is listed under "Fading" on the Memory page. Nothing is deleted by decay.
- A fact with decayed confidence below 0.5 is mentioned with "last I knew" and its date ([BEHAVIOR.md §6.1](BEHAVIOR.md#61-odds)).

**Acceptance:** unit test for the formula at t = 0, one half-life and two half-lives per kind; profile test that a `state` fact confirmed 7 days ago (0.95 → 0.19) is absent.

---

## 6. Provenance and taint rules (Worker-enforced)

Every rule is code in `backend/src/areas/memory/validate.ts` with its own test. Error responses use the standard error shape.

| # | Rule | On violation |
|---|---|---|
| M1 | Every message, event and ledger row has an `origin`; the Worker sets it from the authenticated principal, never from the request body | (not client-settable) |
| M2 | Evidence ids must exist, be 1–20 per fact, and be messages, events, day notes or (notebook conversion only, P3) `import_items` rows, or (an op from a **device** session only) `ledger:` rows with `actor=owner` (the Memory page's own Fix and Add, §12); an `import:` ref never supports `source=user` (it is not owner-origin, M3). Events (no table before P5) and imports (none before the import runs) can't be checked yet, so they are refused for now. An `inferred` fact never rests on the mind's or the system's own messages (§4) | `422 validation` `bad_evidence` (and `unknown_ref` when the fact an op names does not exist) |
| M3 | `source=user` → every evidence id is owner-origin (`origin` in `owner_device`, `import` with `author=owner`, or an owner `ledger:` row from a device op), and at least one is a message (or, from a device, that owner ledger row) | `422` `not_owner_evidence` |
| M4 | `kind=rule` → `source=user` | `422` `rule_needs_owner` |
| M5 | `source=observed` → ≥ 10 owner-device events (or one rollup ref with n ≥ 10) | `422` `too_little_evidence` |
| M6 | Evidence with `origin` `muse` or `external` (or any message `author=muse`) is never accepted | `422` `tainted_evidence` |
| M7 | Tags `faith` or `about=person` → `source=user` only; `faith` defaults to `may_raise=0` | `422` `needs_owner_words` |
| M8 | `source=inferred` → confidence ≤ 0.80; `sensitivity=1` inferred → becomes a `memory_big` proposal, not applied | Proposal |
| M9 | Superseding a `user` fact with a non-`user` source → `memory_big` proposal | Proposal |
| M10 | More than 10 supersessions in one batch from the mind (night or chat) → the batch is applied up to 10; the rest become one `memory_big` proposal "Many changes tonight; review?" **[proposal]** | Proposal (`proposal_required` until P4) |
| M11 | A session marked tainted (`th taint`) may not `remember`, `supersede`, `confirm`, write `rule` or write a day note (enforced from P3, when memory writes arrive; other gated writes from P4). Every mind memory write needs a claimed, live session of its role, so a new session id can't step around a taint; a day note written while its session was tainted is never evidence | `403` `session_tainted`; `403` `session_required` |
| M12 | If the constitution pin is broken this session, `rule` writes are refused, and so is superseding a rule into anything else. Until the pin arrives (P4) the check is the hash the session claimed with: a session that sent `none` (its file was missing) writes no rules | `403` `laws_unpinned` |
| M13 | `text` ≤ 280 characters and one claim (no "and also") — length is enforced; one-claim is checked weekly in-session | `422` `too_long` |
| M14 | Health, sexuality, politics, religion and similar sensitive traits are never `inferred` **[proposal]** | `422` `no_inferred_sensitive` |
| M15 | The mind only makes a fact more protected: it never lowers `sensitivity` (a sensitive tag or `about=person` makes it 1), never sets `may_raise=1` on its own (faith never), never drops a sensitive, `faith` or `imported` tag ([PRIVACY.md §4](../engineering/PRIVACY.md)); only the owner can | (applied as the protected value) |
| M16 | §13's never-stored text (keys and tokens, passwords, card and bank numbers) is refused in facts, loose ends and day notes | `422` `never_stored` |

**Taint sources:** web pages, search results, song tags and tab files, PDFs and other files not written by the owner, emails, Board sources, PR or issue comments not by the owner, Muse output, the wake text. Outside content is stored, if at all, as `origin=external` (Board items, imported web text) and can only be cited in answers.

**Acceptance:** injection fixtures INJ-01…25 ([EVALS.md](EVALS.md)) create zero facts; a backend test per rule.

---

## 7. Sessions and taint, in practice

1. A session is clean when it starts, unless a session of its role was tainted in the last 24 hours: a taint carries over for 24 hours, counted from the taint itself (not from the day a session was claimed on, so a session that runs across the day roll can't shed it). The Worker can't tell a session id the mind made up from a new cloud session, so a claim takes over the taint of its role's latest session tainted in those 24 hours (`taint_source = inherited:<source>`, keeping the taint's own time, so a chain of claims never stretches it). The one way out is the session the Worker itself fired after the taint: a claim that matches a still-open wake's fire exactly (`claim_match = exact`, [RUNTIME.md §4.3](RUNTIME.md#43-claim-binding)) starts clean. A loose or manual claim inherits. `POST /v1/mind/brief` answers `tainted`, and section 1 of the briefing says so.
2. The PostToolUse hook calls `th taint` the first time the session fetches outside text ([RUNTIME.md §6.5](RUNTIME.md#65-posttooluse)).
3. A tainted session can still answer, read memory, arrange things and ship code. It cannot write memory or reach people.
4. If a tainted session learns something the owner said that should be remembered, it adds an open thread "remember: <text> (evidence msg …)" and the next clean session (or the night shift, which never fetches outside text before step 4) writes the fact. **[proposal]**
5. Long outside reading goes to the quarantined reader subagent (P4), which has no write tools and returns schema-checked JSON.

---

## 8. The profile (deterministic render)

Rendered by the Worker at brief time. No LLM writes it, so it can't drift.

1. Take facts with `superseded_at IS NULL`, `valid_to IS NULL OR valid_to > now`, `kind != 'rule'` (rules have their own briefing section).
2. Compute decayed confidence `c`. Drop `c < 0.25` unless pinned.
3. Order: pinned first; then by kind in this order: `state`, `goal`, `preference`, `routine`, `fact`; within a kind by `c` descending, then `recorded_at` descending.
4. Per-kind caps **[proposal]**: state 10, goal 10, preference 25, routine 15, fact 30.
5. Line format: `[f:<last 8 hex digits of id>] <text> (<c to 1 decimal>, <source letter u|o|i>, since <YYYY-MM>)`, plus ` · don't raise` when `may_raise=0` and ` · private` when `sensitivity=1`. (The last 8, not the first: a UUIDv7 starts with its timestamp, so every fact of one batch would share its first 8.) Text is always one line, so no fact can fake a `## <n>.` section marker.
6. Stop at 6,000 characters; append `(+N more: th recall --kind facts)`.
7. A weekly snapshot goes to `thunderhead-private/memory/profile/<YYYY>-W<ww>.txt`; the Memory page shows the diff with last week ("What changed").

Example line: `[f:7c41e9a2] Prefers short answers on the phone (0.9, u, since 2026-11)`

**Acceptance:** same inputs → byte-identical output (snapshot test); 200 synthetic facts render ≤ 6,000 characters.

**What to learn first (owner ruling).** The first things the mind should know about the owner are what they believe in and the music and media they like. Beliefs are written only from the owner's own words (`source=user`, tag `faith`, `may_raise=0` by default, rule M7); music and media tastes come from the owner's words and, once imported, their listening and watching history (`observed`, rule M5).

---

## 9. The briefing

`th brief` returns sections in this order. Each section starts at a line `## <n>. <Name>` (for example `## 2. Waiting`); the SessionStart hook's cap and `th brief --section` cut only on that marker. The Worker builds and truncates; the model never trims. The SessionStart hook prints the **core** (sections 1–7). The **full** briefing (1–12) goes to `$TMPDIR/th/brief.md`.

| # | Section | Content | Budget (chars) | In core |
|---|---|---|---|---|
| 1 | Now | Local time and weekday; role; wake reason; wakes today; pre-warms left; quiet state; `laws: pinned`; usage backoff; open decisions count | 500 | yes |
| 2 | Waiting | Owner message(s) not yet answered, verbatim, with ids, oldest first | 2,800 | yes |
| 3 | Standing rules | `kind=rule` facts, all of them, pinned first | 1,400 | yes |
| 4 | Open threads | Mind-owned first, then owner-owned; due soonest first | 1,600 | yes |
| 5 | Today so far | Latest session note + the last 12 messages verbatim | 2,200 | yes (trimmed oldest first) |
| 6 | Yesterday | Day note, or the fallback (last 20 messages of yesterday) if the night shift hasn't run | 800 | yes |
| 7 | Pointer | `Full briefing: $TMPDIR/th/brief.md · Search: th recall "<q>"` | 200 | yes |
| 8 | Profile | §8 render | 6,000 | file |
| 9 | Last 7 days | One line per day note | 1,400 | file |
| 10 | Pending | Waiting proposals, work orders, ledger of the last 24 h | 2,000 | file |
| 11 | Health | Error counts, deploy state, night-run state | 1,200 | file |
| 12 | Today earlier | Today's messages before the last 12 (ids + first 120 chars each) | 8,000 | file |

- Core total ≤ **9,500** characters (the hook cap; see [RUNTIME.md §6.1](RUNTIME.md#61-sessionstart)). Full total ≤ **48,000** characters (about 12k tokens).
- **Fill order when over budget:** sections 1, 2, 3 and 7 are never dropped (2 is cut oldest-first with `(+N more waiting: th history <thread>)`); then 4, 6, 5 get what is left in that order.
- Every truncated section ends with `(+N more: th brief --section <n>)`.
- **Night role:** sections 2 and 5 are replaced by "Yesterday's thread: <id>, N messages; run th day <date>".
- Not in the briefing: the laws (loaded by `CLAUDE.md` from `mind/CONSTITUTION.md`), skills (loaded on demand), raw events.

**Acceptance:** briefing snapshot tests for: an empty first day; 30 waiting messages; 60 rules (cut marker appears, core ≤ 9,500); night role.

---

## 10. Search

1. **FTS5 first.** Tables `messages_fts`, `day_notes_fts`, `facts_fts` with `tokenize='unicode61 remove_diacritics 2'` (accent-folded; English and the second language both work for exact words).
2. **Ranking:** `bm25()` with column weights 1.0; ties by recency. Results carry `ref`, `at`, `snippet` (≤ 160 chars with the match), `score`.
3. **Query hygiene:** the Worker quotes every user term (`"term"`) and joins with spaces, so FTS operators in the input are inert. Max 12 terms, 200 characters.
4. **Facets:** `kind`, `since`, `until`, `thread`. The owner's search box in the menu and `th recall` use the same endpoint (`GET /v1/search` **[proposal; API.md is canonical]**).
5. **Speed:** p90 < 300 ms Worker time over 100k messages (test in DATA.md's cost suite).
6. **Phase 8:** multilingual embeddings (`bge-m3`) stored in DO SQLite, merged with FTS by reciprocal-rank fusion (k = 60), only after the cross-language probes pass ([EVALS.md](EVALS.md)).
7. The mind cites results by ref ("you said this on 2026-11-03 [m:…]").

---

## 11. The daily split and continuity

1. **One thread per day.** The first message after the roll creates today's `daily` thread. The owner never starts or names a conversation (decisions.md).
2. **The roll:** at 04:00 owner-local, if no message in the last 60 min. Otherwise the Worker checks every 15 min (one cron, internal dispatch) until 60 quiet minutes have passed.
3. **On roll, in one transaction:** set yesterday's thread `status=filed`, `filed_at`; set a provisional title (`title_source=auto`): the first owner message trimmed to 40 characters at a word boundary **[proposal; Workers AI titles may replace this later]**; mark the live chat lease `day_closed` (the session's `th wait` exits 5); then fire `mind-night` (reason `roll`).
4. **The night shift** writes the day note, rewrites the title and summary (`title_source=mind`, unless the owner renamed it), updates open threads and facts.
5. **Next day's first briefing** carries: yesterday's day note (or the fallback tail), every open thread, the profile, the last 7 day-note lines.
6. **"Continue this"** (long-press a filed conversation in the menu): sets today's `threads.continues`; the briefing then adds that thread's summary plus its last 15 messages in section 5.
7. **Never lost:** messages sent while the roll runs land in whichever thread is open at their `created_at`; the transaction makes that unambiguous.

**Acceptance (P2/P3 done-when):** a day rolled with no lost message; a fact stated on day N appears in day N+1's briefing with its evidence; with the night shift disabled, day N+1's briefing shows the fallback tail.

---

## 12. The Memory page

Reached from Menu → Settings → Memory (layout in [MENU-AND-SETTINGS.md](../product/MENU-AND-SETTINGS.md)). Labels here are the behaviour; final copy is in [COPY.md](../design/COPY.md).

| Section | Shows | Owner actions |
|---|---|---|
| What I know | Current facts grouped by kind, pinned first; each with text, a source label ("You said" / "Seen" / "My guess"), a confidence bar, "since" date, and an evidence link per id | **Fix**, **Pin**, **Don't bring this up**, **Forget** |
| Standing rules | `kind=rule` facts | Fix, Forget, Add |
| Loose ends | Open threads | Done, Drop, Add |
| Days | Day notes, newest first | Edit (writes a new version, `written_by=owner`) |
| What changed | Diff of this week's profile snapshot against last week's | — |
| Fading | Facts with confidence < 0.10 | Confirm ("Still true"), Forget |
| Imported, to review | Facts from the old notebook (§14) | "Yes, that's right" (→ `user`), Fix, Forget |
| Laws | The approved constitution text and its pin state | Edit (owner-only; [CONSTITUTION.md](CONSTITUTION.md#amendment-rule)) **[proposal]** |

Behaviours:
- **Fix** opens the text for editing. Saving supersedes the fact with `source=user` in one transaction with its ledger row (`actor=owner`, `kind=memory`), and that row is the evidence (`ledger:<id>`). Events have no table in `Core` before `Senses` (P5, [DATA.md §4.4](../engineering/DATA.md)), so the page never writes one. Applied at once.
- **Pin** sets `pinned=1` (top of the profile, no decay).
- **Don't bring this up** sets `may_raise=0`: the mind still knows it (so it won't ask again) but never mentions it unprompted. Muted facts never appear in home lines, margin notes or pushes. The Worker can't read meaning in free text, so every surface and push must list the fact ids it draws on (`facts` field), and the Worker refuses one that cites a muted fact **[proposal]**. Whether the mind cited honestly is checked by the weekly in-session review.
- **Forget** asks once ("Forget this? It can't be brought back."), shows a 10 s undo, then hard-deletes (§3); leaving the page inside the 10 s sends it at once. It must arrive however the page ends: the fact's id (never its text) waits in the phone's storage (`th.p.forget`) until the Worker has it; leaving, reloading or hiding the page sends it with a keepalive request started in that event; a send the network or the server refuses is tried again with back-off ("Not forgotten yet. I'll keep trying."); and the next open of this page or Home sends what is left. The fact stays off the page until its Forget went through. The next briefing no longer contains it, and surfaces citing it leave their slots. The system's point-in-time recovery (Cloudflare, 30 days) still holds the old pages for up to 30 days; the sheet says so ([PRIVACY.md §10](../engineering/PRIVACY.md)).
- **Don't bring this up** also clears, at once, any surface that cites the fact.
- **Add** lets the owner type a fact or rule directly (`source=user`, evidence = its own ledger row, as for Fix).
- Every action is a ledger row with `actor=owner`.

Built in P3 (`frontend/apps/settings/memory*.js`, `/settings/memory/`): What I know (grouped as MENU-AND-SETTINGS.md §4.4 says), Standing rules, Loose ends, Days, Fading and Imported, to review, with the filter (over every fact: the page reads all pages of `GET /v1/memory/facts`, and a section draws its first 100 rows until "Show all") and every action above; the profile's private lines are blurred until tapped, like their rows (the Worker names them, `private_ids`); a fact's detail comes from `GET /v1/memory/facts/:id`, and its evidence shows in place (the quoted words and their date; there is no History page to link to yet). The page reloads when the change feed reports `fact`, `open_thread` or `day_note`; a row that didn't change keeps whatever detail or form the owner has open. Waiting: **What changed** needs the weekly profile snapshots in the private bucket (SETUP.md J2, P4), and **Laws** needs the constitution pin (P4).

**Acceptance (P3 done-when):** the owner deletes a fact and it is gone from the next briefing; a muted fact never appears in a surface (Worker test).

---

## 13. Never stored

| Never | Instead |
|---|---|
| Passwords, tokens, keys, recovery codes in memory or messages | The mind refuses to repeat them and replies "Don't send me secrets; I've hidden that message." The Worker refuses them in facts, loose ends and day notes (`never_stored`, P3, `shared/contract/never-stored.ts`): this system's token shapes, common provider keys, JWTs, private keys, recovery codes; "password", "passcode" or "passphrase", maybe with what it is for ("for the gate", up to 4 words), then "is", "was", ":" or "=" and one word ("my password is Summer"); a passphrase with any value; "password", "passcode", "recovery code", "PIN" (in capitals) or "PIN code" followed by a value that looks like a secret (quoted, or one word of 4+ characters with a digit or a symbol); a lower-case "pin" only before 4–8 digits, and a security code before 3–4. Everyday words stay: "my bus pass is in the drawer", "the bridge pin is loose", a "PIN-protected" or "password-protected" thing (a hyphen makes an adjective), "my password is in the blue drawer". Masking token-shaped strings in message bodies on write is still **[proposal]** |
| Raw camera or microphone streams | Analysed on the phone while switched on; only the result the owner chooses to save (a voice memo they send, a practice score) is stored |
| Precise location history | Coarse weather location only, set by the owner |
| Inferred sensitive traits (health, sexuality, politics, religion, finances) | Only what the owner states, `source=user`, `sensitivity=1` |
| Other people's contact details or inferred traits | Names as the owner wrote them, in messages; facts `about=person` only from the owner's words |
| Payment card or bank numbers | Refused as secrets: a card number passes the Luhn check and is either written like a card (groups of four, or 4-6-5) or starts like one (the major networks' leading digits and lengths), since Luhn alone passes one number in ten (ISBNs, timestamps, order numbers); bank accounts as IBANs (mod 97) |
| Outside text as facts | Cited only; `origin=external` rows |
| Anything personal in the repo, Actions logs or artifacts | Private Worker and R2 only |

**Acceptance:** fixture: a message containing a token-shaped string is stored masked; a fact containing one is refused.

---

## 14. Importing the old notebook (P3)

The old system kept one Markdown notebook (sections: about the owner, about the system, open work). It is imported once, carefully.

1. The old Worker's export lands in `thunderhead-private/imports/old/<run_id>/` (see [MIGRATION.md](../engineering/MIGRATION.md)). The notebook is stored raw in `import_items` (one row per run, DATA.md §4.4) and never becomes a live table.
2. Old chat messages are imported first as `messages` with `origin=import` and their original `author`. Imported owner messages count as owner evidence (M3).
3. A chat session converts the notebook section by section:
   - **About the owner:** each line becomes a candidate fact. If an imported owner message supports it, `source=user` with that evidence. Otherwise `source=inferred`, confidence 0.6, tag `imported`, listed under "Imported, to review".
   - **About the system:** goes to repository docs only if it is non-personal and still true; otherwise dropped. It never becomes memory.
   - **Open work:** each still-relevant item becomes an `open_thread` (`owner=mind`); finished or stale items are dropped and listed in the session's report.
4. The conversion is one batch with a ledger row per fact, and its report is a card: "Imported: 41 facts (12 confirmed by your old messages, 29 to review), 6 loose ends. Dropped: 9 system notes."
5. Imported facts tagged `imported` and not reviewed within 60 days decay normally; they are never raised unprompted while unreviewed **[proposal]**.

**Acceptance:** import test on a synthetic notebook fixture: counts match, each fact has evidence or the `imported` tag, a re-run creates nothing new (idempotent by a hash of the source line).

---

## Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| 1 | Do FTS5 shadow writes fit the 100k rows/day free write budget at the owner's volume? | DATA.md cost test: 500 messages/day + night batch; count `rowsWritten`. |
| 2 | Is `remove_diacritics 2` enough for second-language/English recall before embeddings? | 10 cross-language probes ([EVALS.md](EVALS.md) MP set) at P3. |
| 3 | Half-lives right? | After 60 days, compare Memory-page "Still true" taps on fading facts per kind; adjust half-lives where > 50% are confirmed. |
| 4 | Is the token-masking regex safe for normal text? | Run over the imported message history in-session; count false positives (target 0 in 10k). |
| 5 | `about=person` facts: does the owner want any at all? | Owner decision at P3. |
