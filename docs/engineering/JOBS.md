# Jobs

This page fixes where heavy work runs and how: audio analysis in GitHub Actions (by sha256 only), PDF text extraction in the mind's session, and row-heavy work as chunked Durable Object alarm jobs under a daily write cap.
It also gives the rules for public Actions logs, the job specs, and how results are checked before anything reaches private data.
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **One rule, four places.**
   - CPU-heavy work on audio bytes runs in **Actions**, addressed only by sha256.
   - Personal text (PDF extraction) runs in the **mind's cloud session**.
   - Row-heavy database work runs as **chunked DO alarm jobs**.
   - Reasoning runs only in **mind sessions**.
2. **Actions never touch private data.** Its keys can read `jarvis-music` and write `thunderhead-jobs`, nothing else (GitHub environment `jobs`). It never holds a Worker key other than the `ci` one.
3. **Public logs show counts and timings only.** No titles, names, hashes, keys, refs, URLs or content.
4. **Results are untrusted input.** The Worker validates every result file against a strict schema with no free text, then copies the valid ones into `thunderhead-private` and deletes the raw files.
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

Every workflow that touches data follows these rules. `tests/repo.test.mjs` greps workflow files for the forbidden patterns **[proposal]**.

1. Print only: job ids, counts, durations, byte totals, exit reasons from a fixed list, and commit SHAs.
2. Never print: sha256 keys, R2 keys, file names, titles, artists, any text from inside a file, presigned URLs, tokens, environment dumps.
3. No `set -x`. No `env` or `printenv`. No `--verbose` on tools that echo URLs or keys.
4. Secrets reach a step only through `env:` on that step. Derived values (a signed request) are masked with `::add-mask::` before any use.
5. No artifacts and no caches that hold job data. Temporary files live in `$RUNNER_TEMP` and are deleted at the end of each item.
6. A tool that fails prints its own error. The step wraps it so only `fail: <reason from list>` reaches the log, and the full text is dropped.
7. Workflows that touch R2 run only on `workflow_dispatch` from `main`, never on `pull_request`. `permissions: {}` at the top, `contents: read` on the job, and no `id-token`.

Acceptance: a test run of `jobs-audio.yml` on 3 synthetic tones (generated in the job, not real audio) shows a log with none of the 3 hashes and none of the R2 keys.

---

## 3. Actions jobs: audio analysis

### 3.1 What it measures (result schema v1)

```ts
type AudioAnalysisV1 = {
  v: 1;
  sha256: string;                 // 64 lowercase hex, equals the key's hash
  analyzer: { name: 'th-audio'; version: string /* semver of mind/tools or jobs/ */ };
  duration_ms: number;            // 1,000 – 14,400,000
  sample_rate: 8000 | 16000 | 24000 | 44100 | 48000;
  channels: 1 | 2;
  lufs_i: number;                 // integrated loudness, −70 … 0
  true_peak_db: number;           // −60 … +3
  lra: number;                    // loudness range, 0 … 40
  bpm: number | null;             // 30 … 300
  bpm_conf: number;               // 0 … 1
  key: KeyName | null;            // 24 values: 'C', 'Cm', 'C#', 'C#m' … 'B', 'Bm'
  key_conf: number;               // 0 … 1
  start_silence_ms: number;       // ≥ 0, ≤ duration_ms
  end_silence_ms: number;         // ≥ 0, ≤ duration_ms
};
```

There is no free-text field, by design: an Actions run (a public, injectable place) can never put words into the owner's data. Product use of these numbers (gapless trims, loudness matching, the DJ) is in [MUSIC.md](../product/apps/MUSIC.md).

### 3.2 Tools **[proposal]**

The licence rule is no GPL, AGPL or non-commercial dependencies, which rules out typical ffmpeg builds, aubio and Essentia. (The one named exception, libmedia, is for Astra's player only, by owner ruling; it does not extend to jobs.)

| Step | Tool | Licence |
|---|---|---|
| Decode Opus → PCM | `opusdec` (opus-tools) | BSD |
| Loudness, true peak, LRA | `pyloudnorm` + numpy | MIT, BSD |
| Tempo and key | `librosa` (beat tracker; chroma + key profiles) | ISC |
| Fetch from R2 | a small Node script using `aws4fetch` | MIT |

Versions are pinned with hashes in `jobs/audio/requirements.txt`. The analyzer version bumps whenever a tool or parameter changes, so old and new results can be told apart.

### 3.3 The spec

1. `mind-night` calls `GET /v1/jobs/next?kind=audio.analysis&max=500`. The `Music` DO picks tracks with no `analysis` row at the current analyzer version (oldest `added_at` first) and records a row in `Music.external_jobs` (`id, kind, v, spec_json, state, issued_at, expires_at = +72 h, collected_at, counts_json`).
2. The response: `{ job_id, kind: 'audio.analysis', v: 1, shas: [...] }` with ≤ 500 hashes.
3. `mind-night` dispatches `jobs-audio.yml` with the single input `job_id` **[proposal]**. Dispatch inputs are visible on a public run page, so the hashes never travel there. The workflow fetches the spec itself with `GET /v1/jobs/:id/spec` and `TH_CI_TOKEN`.
4. A spec not collected within 72 h becomes `expired`. Its tracks become eligible again.

### 3.4 The workflow (`.github/workflows/jobs-audio.yml`, P5)

1. Trigger: `workflow_dispatch` with input `job_id` (a UUIDv7, checked against `^[0-9a-f-]{36}$`). Job `if: github.ref == 'refs/heads/main'`. `timeout-minutes: 300`. Concurrency group `jobs-audio`, `cancel-in-progress: false`.
2. Fetch and validate the spec in a Node step (`GET /v1/jobs/:id/spec`, never printed): valid JSON, `kind` known, `v` known, 1–500 entries, each `^[0-9a-f]{64}$`, no duplicates. On failure: `fail: bad_spec`, exit 1.
3. For each hash, with at most 4 in parallel and a 10-minute limit per item:
   1. GET `jarvis-music/native/audio/<sha>.opus` with the read-only key into `$RUNNER_TEMP`.
   2. Check sha256(bytes) equals the hash. If not: record `failed: hash_mismatch`.
   3. Decode, analyse, write `<sha>.json` (schema §3.1), delete the audio file.
4. Upload every result to `thunderhead-jobs/results/audio.analysis/<job_id>/<sha>.json`.
5. Upload the manifest **last**, to `…/<job_id>/manifest.json`:
   ```ts
   { v: 1; job_id: string; kind: 'audio.analysis'; analyzer: {name, version};
     started_at: Ms; finished_at: Ms;
     files: { sha256: string; bytes: number; result_sha256: string }[];
     failed: { sha256: string; reason: 'download'|'hash_mismatch'|'decode'|'analyze'|'timeout' }[] }
   ```
6. Final log line: `done: <ok> ok, <failed> failed, <seconds> s`.
7. A last step calls `POST /v1/jobs/<job_id>/collect` with `TH_CI_TOKEN`. If that fails, `mind-night` calls it next night.

### 3.5 Validation on collect (in the Worker, then a `Music` job)

The job moves `issued → validating → applied`, or `→ rejected` if the manifest itself is bad.

| # | Check | On failure |
|---|---|---|
| 1 | The manifest exists, is ≤ 1 MB, parses, and matches its schema | `rejected`; nothing applied |
| 2 | `job_id` names an `issued` spec that hasn't expired, of the same `kind` and `v` | `rejected` |
| 3 | Every hash in `files` and `failed` is in the spec; no duplicates | `rejected` |
| 4 | Each result file is ≤ 8 KB; sha256 of its bytes equals `result_sha256` | That file is invalid |
| 5 | The file parses and passes the schema with `additionalProperties: false`, every range and enum, and `sha256` equal to its key | That file is invalid |
| 6 | Spec hashes missing from both lists | Counted as `missing`; they become eligible again |

Then:
1. Valid files are copied to `thunderhead-private/jobs/audio.analysis/<sha>.v1.json`.
2. A `Music` bulk-lane job upserts `Music.analysis` rows in steps of ≤ 2,000.
3. All raw objects under `thunderhead-jobs/results/audio.analysis/<job_id>/` are deleted. The bucket's 14-day lifecycle rule is the backstop.
4. `external_jobs.counts_json = {expected, valid, invalid, missing}`. If `invalid > 0`, a ledger note records the counts and reasons (never hashes in any user-visible text).

The schema check is a small JSON-Schema-subset validator in `backend/src/areas/work/validate.ts` (types, required, enum, min/max, maxLength, `additionalProperties: false`). It is shared with Muse work orders, so no extra dependency is needed.

Acceptance: vitest cases for each row of the table, using synthetic manifests and files in local R2: a bad manifest applies nothing; one bad file among 10 applies 9; a file whose `sha256` field differs from its key is rejected.

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
| `actions.apply` | Music | yes | after a collect | 2,000 results | §3.5 |
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
| J1 | Do the BSD/MIT/ISC tools (opusdec, pyloudnorm, librosa) give tempo and key good enough for the Music features? | Run on 20 synthetic and 20 owner-approved tracks inside a session (not in Actions), compare with the old player's numbers |
| J2 | Actions time per track (a 4-minute Opus file) on a standard runner | First run on synthetic tones, then a 50-track job; size `max` from it |
| J3 | Does the R2 lifecycle rule cost nothing on this account? | Owner checks the bucket settings |
| J4 | DO CPU per invocation on Free (X3), which fixes the step sizes | Preview bench |
| J5 | FTS5 rows written per 300-word page (D3) | Local workerd measurement |
| J6 | Earlier plans allowed sha256 keys in public logs; this page, PRIVACY.md §6 and ARCHITECTURE.md agree on the stricter rule (no hashes at all; the spec travels by `GET /v1/jobs/:id/spec`). | Settled: decisions.md 2026-10-28 |
