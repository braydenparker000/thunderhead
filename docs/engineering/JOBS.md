# Jobs

This page fixes where heavy work runs and how: PDF text extraction in the mind's session, and row-heavy work as chunked Durable Object alarm jobs under a daily write cap.
It also gives the rules for public Actions logs, the job specs, and how results are checked before anything reaches private data.
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **One rule, four places.**
   - CPU-heavy work on audio bytes runs in **Actions**, addressed only by sha256.
   - Personal text (PDF extraction) runs in the **mind's cloud session**.
   - Row-heavy database work runs as **chunked DO alarm jobs**.
   - Reasoning runs only in **mind sessions**.
2. **Actions never touch private data.** Its one R2 key, made only if the owner chooses (SETUP.md N6), has Object Read on `jarvis-music`: it lists and reads everything there, the old catalog's titles included, and nothing else (GitHub environment `jobs`). It writes nowhere but through the Worker's job routes, with the `jobs-audio` `ci` key, which is confined to them.
3. **Public logs show counts and timings only.** No titles, names, hashes, keys, refs, URLs or content.
4. **Results are untrusted input.** They arrive through the Worker, which keeps them aside until collected, validates every result against a strict schema with no free text, applies the valid ones to the `Music` object and deletes the raw files.
5. **Every DO job is chunked, resumable and capped:** ≤ 2,000 rows per step, a cursor in the row, and one shared bulk lane of 40,000 rows written per day.
6. **No timers in DOs.** A job advances only through `alarm()`.
7. **A job never runs twice at once** and never loses its place. A crash mid-step repeats that step, and every step is idempotent.

---

## 1. Where each kind of work runs

| Work | Place | Why there | Limits that shape it |
|---|---|---|---|
| Audio analysis (loudness, tempo, key, silence) | GitHub Actions, `jobs-audio.yml` | Needs minutes of CPU per track; Actions minutes are free on a public repo | Logs are public; 6 h per job; secrets only through `env` |
| PDF text extraction (P7) | The mind's cloud session (`mind-night` or `mind-chat`) | The text is personal and must never appear in a public log | Session usage limits; 4 vCPU / 16 GB VM |
| Imports, FTS backfill, rollups, exports, restores, prunes | Chunked DO alarm jobs | Row-heavy; must respect 100,000 writes a day | Unknown DO CPU per invocation on Free (X3); 1 alarm per object |
| Reasoning (day notes, titles, facts, arranging) | Mind sessions only | Uses the subscription; never the Worker | [RUNTIME.md](../mind/RUNTIME.md) |
| Search ranking, signing, validation | Worker request path | Milliseconds of CPU | 10 ms CPU per request |

---

## 2. Public-log rules (Actions)

Every workflow that touches data follows these rules. `tests/jobs-audio.test.mjs` checks `jobs-audio.yml` against them (built), and the Python job's log calls too.

1. Print only: job ids, counts, durations, byte totals, exit reasons from a fixed list, and commit SHAs.
2. Never print: sha256 keys, R2 keys, file names, titles, artists, any text from inside a file, presigned URLs, tokens, environment dumps.
3. No `set -x`. No `env` or `printenv`. No `--verbose` on tools that echo URLs or keys.
4. Secrets reach a step only through `env:` on that step. Derived values (a signed request) are masked with `::add-mask::` before any use.
5. No artifacts and no caches that hold job data. Temporary files live in `$RUNNER_TEMP` and are deleted at the end of each item.
6. A tool that fails prints its own error. The step wraps it so only `fail: <reason from list>` reaches the log, and the full text is dropped.
7. Workflows that touch R2 run only on `workflow_dispatch` from `main`, never on `pull_request`. `permissions: {}` at the top, `contents: read` on the job, and no `id-token`.

Acceptance: every run of `jobs-audio.yml` starts with its self-test on synthetic tones (generated in the job, not real audio); the first real run's log shows counts only, none of its hashes and none of the R2 keys (checked by the lead on that run).

---

## 3. Actions jobs: none (the listening pass was cut)

**Cut 2026-11-04** (owner decisions 12 and 13, MIND-PLAN §8): the listening pass (songs analysed in Actions by their sha256, schema v2, `jobs-audio.yml`, `jobs/audio/`, the `/v1/jobs` routes, Core's apply jobs and `th music jobs`) is gone, with its nightly `fail: not_configured`. The owner's taste comes from their own listening history instead ([MUSIC.md §16](../product/apps/MUSIC.md)): the `music.history` and `music.mb` jobs in §4.4. Music schema step 3's tables stay, empty (steps only add); find still blends `track_analysis` where a row exists, and nothing writes one. A `jobs-audio` key minted for the pass stays confined and reaches no route. No workflow touches private data now; §2's rules stand for any that ever does.

---

## 4. Chunked Durable Object jobs

### 4.1 The contract

Each class has a `jobs` table ([DATA.md §3](DATA.md#3-shared-machinery-in-every-class)); the runner is `backend/src/areas/jobs/runner.ts` and each area keeps its handlers (the import's: `backend/src/areas/import/job.ts`):

```ts
type JobHandler = {
  kind: string;
  lane: boolean;                          // true = uses the bulk lane and its cap
  maxAttempts?: number;                   // failures in a row before the job fails (default 6)
  load(env, db, payload, cursor): Promise<unknown>;   // R2 reads, outside any transaction
  step(w: Writer, payload, cursor, input): { next: unknown } | { done: true };  // one commit
  failed?(w: Writer, payload, code): void; // what the area records when the job fails for good
};
```

1. `alarm()` picks due jobs (`state IN ('queued','paused','running') AND due_at <= now`), oldest `due_at` first.
2. A step is the handler's `load`, then its `step` inside one commit (the `Writer` of `commit()`), which also stores the new cursor, the job's state and its rows written. A crash before the commit leaves the stored cursor as it was and the job due, so the next alarm resumes it; the commit checks that the cursor it loaded for is still the job's.
3. A step is therefore all-or-nothing, and repeating it is safe.
4. Step size: ≤ 2,000 rows and ≤ 200 ms of CPU **[proposal]**. If test X3 shows a 10 ms CPU limit per invocation, the per-kind step sizes shrink to fit, and each alarm runs exactly one step.
5. After each step the job is due at once (`due_at = now`); the alarm is set to the earliest due time of any wake or job, only when it changes.
6. One alarm invocation runs at most 5 steps or 1 s of wall time, whichever comes first. Then it re-arms. **[proposal]**

### 4.2 Retries

| Attempt | Delay before the retry |
|---|---|
| 1 | 1 min |
| 2 | 5 min |
| 3 | 30 min |
| 4 | 2 h |
| 5 | 12 h |
| after 5 | `state='failed'`; watchdog `jobs.stuck` |

Import jobs stop after 3 failures in a row and show the Home line from [MIGRATION.md §4](MIGRATION.md); the old Worker still has the data, so the fix is a code change and a re-run.

`last_error` keeps a code from the job's fixed list (`missing_part`, `bad_part`, …) or `step_failed:<error name>`, never a message that could hold data.

### 4.3 The write cap (bulk lane)

- Only one lane job runs account-wide. `Core.settings['bulk.lane']` names it, and `Core.tick` grants and revokes the lane every 15 minutes ([DATA.md §8.3](DATA.md#83-the-bulk-lane)). **P3 builds the cap only:** the import is the one lane kind and runs in `Core`, so there is no holder to grant yet; the grant and the revoke at 60,000 come with the second lane kind (restores, P4).
- The holder may write 40,000 rows a day. P3 counts the lane's rows per UTC day in `Core.settings['bulk.day']` (`{day, rows}`, each step's measured rows) and checks before each step that the day's rows are below 40,000; past it the job is `paused` with `due_at` = next 00:05 UTC. A step can overrun the cap by its own size: one part of 2,000 old messages writes about 7,900 rows (each message, its indexes and its FTS entry; measured in local workerd), so the lane takes about five such parts, 10,000 messages, a day.
- When the account total reaches 60,000 writes in a day, `tick` revokes the lane at once. Non-lane jobs (prunes, exports, rollups) keep running, since they are part of the steady budget.
- Lane jobs queue in this order: restores, then imports, then backfills, then ingestion **[proposal]**.

### 4.4 The job kinds

| Kind | Class | Lane | Trigger | Step | Notes |
|---|---|---|---|---|---|
| `export.weekly` | each | no (reads only) | Sunday 02:30 local | 5,000 rows → one `.jsonl.gz` part | Manifest written last (built for Core, `areas/backups/job.ts`) |
| `backups.prune` | Core | no | after `export.weekly` | R2 deletes only | Keeps 8 weekly + 12 monthly [not built: every backup is kept until the owner agrees to the retention, since it deletes data] |
| `prune.<class>` | each | no | the first tick of each logical day (after 04:00 local) | 2,000 deletes | Retention per [DATA.md §10](DATA.md#10-retention-and-export-inclusion) |
| `music.history` | Core → Music | yes | a listening-history file the owner drops (PUT /v1/music/history), by its SHA-256 | the split (the file summed by artist, album and year, kept as parts of 2,000 rows beside it), then one part a step | Idempotent per file and per part (`listen_files.next`); measured: a 6,000-stream file (about 5,000 rows) writes about 8,900 rows in Music (`areas/music/history-job.ts`) |
| `music.mb` | Core → Music | yes | the end of a `music.history` | one MusicBrainz lookup, then the next step waits 1.1 s (the runner's `after`) | The most played artist due first (3 plays or more), 3 tries, until none is due; then the brief's taste line (`areas/music/history-mb.ts`) |
| `changes.prune` | Core | no | daily | 2,000 | Keeps the newest 10,000 |
| `profile.snapshot` | Core | no | weekly, after the night shift | 1 R2 put | |
| `import.<dataset>` | Core (Music for `music`) | yes | `POST /v1/import/runs` | 2,000 rows | Idempotent upserts with deterministic IDs |
| `fts.backfill` | Core, Library | yes | after a migration adds FTS | 2,000 rows | |
| `restore.table`, `restore.object` | any | yes | an approved proposal | 2,000 rows | Each part's hash checked first |
| `drill.monthly` | Core | yes | first Sunday | one part (≤ 5,000 rows) | Sampled above 30,000 rows per table; its rows are written in the scratch instance and counted on the lane (built, `areas/backups/drill.ts`) |
| `export.download` | Core | no (reads only) | `POST /v1/export` | 5,000 rows → one deflated ZIP file part | README and counts last; the parts leave the bucket an hour after it is ready (built, `areas/backups/export-job.ts`) |
| `events.export` | Senses | no | daily 06:00 local for day D−1 | one day | Re-runs if late events arrive |
| `rollups.daily` | Senses | no | after `events.export` | one day | |
| `music.stats` | Music | no | nightly | 2,000 tracks | From `Senses.rollups` over RPC |
| `music.listen.apply` | Core (writes in Music) | yes | after a collect | one part (≤ 50 results), then the job's end | §3.5; a neighbours job is one step (built) |
| `music.listen.pack` | Core (built in Music) | no (reads; waits from 80 %) | after an apply | the whole phone file | §3.5 (built) |
| `library.ingest` | Library | yes | after pages arrive (§5) | 200 pages (FTS cost unknown, D3) | |

Acceptance: each kind has a vitest test that runs it to completion across at least 3 steps, kills it mid-way once (throw inside a step), and checks the final state equals an uninterrupted run.

---

## 5. PDF extraction in the mind's session (P7)

The text of the owner's study PDFs is personal. That includes the owner's licensed copies of the canon scriptures, which are stored privately in `thunderhead-private` like any book (owner ruling 2026-10-27); talks are not stored, only cited with a link. It is extracted only inside a Claude cloud session, never in Actions. [STUDY.md](../product/apps/STUDY.md) §2–§3 owns the file key (`books/<book_id>.pdf`), the tools (pypdf, pdfplumber, Tesseract OCR) and the steps; where the list below differs, STUDY.md wins.

1. The owner adds a PDF in Study. The phone uploads it with `PUT /v1/files/:id` (or the Library upload route in [STUDY.md](../product/apps/STUDY.md)), and the Worker stores it as `thunderhead-private/books/<sha256>.pdf` with a `books` row (`ingested_at = NULL`).
2. `mind-night` finds books with `ingested_at IS NULL` in its briefing, gets a presigned URL from `POST /v1/media/sign {refs:['book:<id>']}`, and downloads the file into `$TMPDIR`.
3. It runs `node mind/tools/pdf-extract.mjs <file>` **[proposal]**, which uses `pdfjs-dist` (Apache-2.0) `getTextContent()` page by page. The output is JSON lines `{page_index, page_label, text}`. Text over 20,000 characters on one page is cut at a word boundary and flagged.
4. Pages with no text layer are flagged `needs_ocr`. v1 does no OCR **[proposal]**. The book shows "Some pages are scans; search skips them."
5. It sends pages in order with `PUT /v1/library/books/:id/pages` in batches of 50 pages ([STUDY.md](../product/apps/STUDY.md) step 9; ≤ 256 KB a request), with `{chunk_index, pages: [...], book_sha256}`. The route checks that the sha256 matches the stored book, that `page_index` values are contiguous, and the size limits. It stores the pages as a lane job (`library.ingest`) that writes `pages`, `pages_fts` and `verse_refs` (the verse parser is deterministic Worker code, shared with Study).
6. It deletes the local file and the extracted JSON before the session ends. Nothing extracted is written to the repo, a log or a commit.
7. The Worker sets `ingested_at` when the last chunk's job finishes, and the briefing reports "Book added: N pages searchable."

Acceptance: a mind test runs `pdf-extract.mjs` on a synthetic 3-page PDF generated in the test (one page image-only) and gets 2 text pages plus 1 `needs_ocr`. A Worker test rejects a chunk whose `book_sha256` differs, or whose pages skip an index.

---

## 6. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| J1 | Do the numpy/scipy measures and CLAP give tempo, key and moods good enough for the Music features? Synthetic tones pass (tempo within 0.3 %, key, loudness within 0.01 LU); real songs unchecked | `--local` on 20 owner-approved tracks on the owner's machine, compared with the old player's numbers; tune with a new analyzer version |
| J2 | Actions time per track on a standard runner (estimate: about 2 s with 4 processes, §3.2) | The first jobs' `done:` lines; raise `max` toward 1,000 if a 500-song job ends well under an hour |
| J3 | (Settled 2026-11-01: results come through the Worker into `thunderhead-private`, so no `thunderhead-jobs` bucket and no lifecycle rule are needed.) | — |
| J4 | DO CPU per invocation on Free (X3), which fixes the step sizes | Preview bench |
| J5 | FTS5 rows written per 300-word page (D3) | Local workerd measurement |
| J6 | Earlier plans allowed sha256 keys in public logs; this page, PRIVACY.md §6 and ARCHITECTURE.md agree on the stricter rule (no hashes at all; the spec travels by `GET /v1/jobs/:id/spec`). | Settled: decisions.md 2026-10-28 |
