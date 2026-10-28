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
-- facts_fts: FTS5(text, subject)

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
| `confirm` | chat, night, owner | Set `last_confirmed = now`; `confidence = max(confidence, base(source of new evidence))`. If the new evidence is an owner message and the fact was not `user`, it becomes a supersede to `source=user` **[proposal]** | Restore previous values |
| `supersede` | chat, night, owner | Close the old row (`valid_to = valid_from of new` if world-time change, `superseded_at = now`, `superseded_by = new id`), INSERT the new row | Reopen the old row, close the new one |
| `forget` | **owner only** | DELETE the fact row and its FTS entry; ledger keeps a tombstone: `{fact_id, kind, forgotten_at}` and **no text** | None (that is the point). A 10 s "Undo" on the phone before the request is sent **[proposal]** |
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
| `rule` | none | "Answer in Spanish after 21:00" |

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
| M2 | Evidence ids must exist, be 1–20 per fact, and be messages, events or day notes | `422 validation` `bad_evidence` |
| M3 | `source=user` → every evidence id is owner-origin (`origin` in `owner_device`, `import` with `author=owner`), and at least one is a message | `422` `not_owner_evidence` |
| M4 | `kind=rule` → `source=user` | `422` `rule_needs_owner` |
| M5 | `source=observed` → ≥ 10 owner-device events (or one rollup ref with n ≥ 10) | `422` `too_little_evidence` |
| M6 | Evidence with `origin` `muse` or `external` (or any message `author=muse`) is never accepted | `422` `tainted_evidence` |
| M7 | Tags `faith` or `about=person` → `source=user` only; `faith` defaults to `may_raise=0` | `422` `needs_owner_words` |
| M8 | `source=inferred` → confidence ≤ 0.80; `sensitivity=1` inferred → becomes a `memory_big` proposal, not applied | Proposal |
| M9 | Superseding a `user` fact with a non-`user` source → `memory_big` proposal | Proposal |
| M10 | More than 10 supersessions in one night batch → the batch is applied up to 10; the rest become one `memory_big` proposal "Many changes tonight; review?" **[proposal]** | Proposal |
| M11 | A session marked tainted (`th taint`) may not `remember`, `supersede`, `confirm` or write `rule` (P4; logged-only before P4) | `403 forbidden` `session_tainted` |
| M12 | If the constitution pin is broken this session, `rule` writes are refused | `403` `laws_unpinned` |
| M13 | `text` ≤ 280 characters and one claim (no "and also") — length is enforced; one-claim is checked weekly in-session | `422` `too_long` |
| M14 | Health, sexuality, politics, religion and similar sensitive traits are never `inferred` **[proposal]** | `422` `no_inferred_sensitive` |

**Taint sources:** web pages, search results, song tags and tab files, PDFs and other files not written by the owner, emails, Board sources, PR or issue comments not by the owner, Muse output, the wake text. Outside content is stored, if at all, as `origin=external` (Board items, imported web text) and can only be cited in answers.

**Acceptance:** injection fixtures INJ-01…25 ([EVALS.md](EVALS.md)) create zero facts; a backend test per rule.

---

## 7. Sessions and taint, in practice

1. A session is clean when it starts.
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
5. Line format: `[f:<first 8 of id>] <text> (<c to 1 decimal>, <source letter u|o|i>, since <YYYY-MM>)`, plus ` · don't raise` when `may_raise=0` and ` · private` when `sensitivity=1`.
6. Stop at 6,000 characters; append `(+N more: th recall --kind facts)`.
7. A weekly snapshot goes to `thunderhead-private/memory/profile/<YYYY>-W<ww>.txt`; the Memory page shows the diff with last week ("What changed").

Example line: `[f:01936a2b] Prefers short answers on the phone (0.9, u, since 2026-11)`

**Acceptance:** same inputs → byte-identical output (snapshot test); 200 synthetic facts render ≤ 6,000 characters.

**What to learn first (owner ruling).** The first things the mind should know about the owner are what they believe in and the music and media they like. Beliefs are written only from the owner's own words (`source=user`, tag `faith`, `may_raise=0` by default, rule M7); music and media tastes come from the owner's words and, once imported, their listening and watching history (`observed`, rule M5).

---

## 9. The briefing

`th brief` returns sections in this order. The Worker builds and truncates; the model never trims. The SessionStart hook prints the **core** (sections 1–7). The **full** briefing (1–12) goes to `$TMPDIR/th/brief.md`.

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

1. **FTS5 first.** Tables `messages_fts`, `day_notes_fts`, `facts_fts` with `tokenize='unicode61 remove_diacritics 2'` (accent-folded; Spanish and English both work for exact words).
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
- **Fix** opens the text for editing. Saving writes an owner-device event `memory.edit` and supersedes the fact with `source=user`, evidence = that event. Applied at once.
- **Pin** sets `pinned=1` (top of the profile, no decay).
- **Don't bring this up** sets `may_raise=0`: the mind still knows it (so it won't ask again) but never mentions it unprompted. Muted facts never appear in home lines, margin notes or pushes. The Worker can't read meaning in free text, so every surface and push must list the fact ids it draws on (`facts` field), and the Worker refuses one that cites a muted fact **[proposal]**. Whether the mind cited honestly is checked by the weekly in-session review.
- **Forget** asks once ("Forget this? It can't be brought back."), shows a 10 s undo, then hard-deletes (§3). The next briefing no longer contains it.
- **Add** lets the owner type a fact or rule directly (`source=user`, evidence = the `memory.add` event).
- Every action is a ledger row with `actor=owner`.

**Acceptance (P3 done-when):** the owner deletes a fact and it is gone from the next briefing; a muted fact never appears in a surface (Worker test).

---

## 13. Never stored

| Never | Instead |
|---|---|
| Passwords, tokens, keys, recovery codes in memory or messages | The mind refuses to repeat them and replies "Don't send me secrets; I've hidden that message." The Worker masks token-shaped strings in message bodies on write **[proposal]** |
| Raw camera or microphone streams | Analysed on the phone while switched on; only the result the owner chooses to save (a voice memo they send, a practice score) is stored |
| Precise location history | Coarse weather location only, set by the owner |
| Inferred sensitive traits (health, sexuality, politics, religion, finances) | Only what the owner states, `source=user`, `sensitivity=1` |
| Other people's contact details or inferred traits | Names as the owner wrote them, in messages; facts `about=person` only from the owner's words |
| Payment card or bank numbers | Refused as secrets |
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
| 2 | Is `remove_diacritics 2` enough for Spanish/English recall before embeddings? | 10 cross-language probes ([EVALS.md](EVALS.md) MP set) at P3. |
| 3 | Half-lives right? | After 60 days, compare Memory-page "Still true" taps on fading facts per kind; adjust half-lives where > 50% are confirmed. |
| 4 | Is the token-masking regex safe for normal text? | Run over the imported message history in-session; count false positives (target 0 in 10k). |
| 5 | `about=person` facts: does the owner want any at all? | Owner decision at P3. |
