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

## 3. Actions jobs: the listening pass

**Built 2026-11-01** (owner: "build everything"): every song in the library analysed once, so the DJ, the mind and "ask by feeling" know how each one sounds. Two job kinds: `audio.analysis` (≤ 500 songs a job, one result each) and `audio.neighbours` (once every song is analysed: each song's 50 nearest). The contract is `shared/contract/listen.ts`; the Worker's half is `backend/src/areas/music/listen*.ts` and `objects/music-listen.ts`; the Actions half is `.github/workflows/jobs-audio.yml` and `jobs/audio/` (Python); the mind's half is `th music jobs` (night step 6, [RUNTIME.md §12](../mind/RUNTIME.md)).

**Where results go (decided here, replacing decisions.md 2026-10-28's `thunderhead-jobs` bucket for this pass):** through the Worker, into the private bucket it already binds (`VAULT`, under `jobs/incoming/<job_id>/`), by `PUT /v1/jobs/:id/files/:name` with the `ci` key. An R2 token can't be limited to a prefix, so a write key on `thunderhead-private` would also read every private object, and one on `jarvis-music` could overwrite songs; a new bucket would need a new binding (a deploy that fails until the owner makes the bucket) and a lifecycle rule. Going through the Worker, Actions holds **one** R2 key, Object Read on `jarvis-music` (which still lists and reads that whole bucket, the old catalog's titles included: the owner decides whether to make it, SETUP.md N6), and no write key anywhere; the Worker checks the job, the file's name and size before it stores a byte, and deletes the uploads once the job is applied, rejected or expired. `thunderhead-jobs` is not needed.

### 3.1 What it measures (result schema v2)

v1's fields are kept as they were; v2 adds energy and the CLAP fields (null when a run goes without the model). Every field is required; `additionalProperties: false` at every level.

```ts
type AudioAnalysisV2 = {
  v: 2;
  sha256: string;                 // 64 lowercase hex, equals the key's hash
  analyzer: { name: 'th-audio'; version: string /* semver, jobs/audio/__init__.py = ANALYZER */ };
  duration_ms: number;            // 1,000 – 14,400,000
  sample_rate: 8000 | 16000 | 24000 | 44100 | 48000;   // 48000 for Opus
  channels: 1 | 2;
  lufs_i: number;                 // integrated loudness, −70 … 0
  true_peak_db: number;           // −60 … +3
  lra: number;                    // loudness range, 0 … 40
  bpm: number | null;             // 30 … 300
  bpm_conf: number;               // 0 … 1
  key: KeyName | null;            // 24 values: 'C', 'C#' … 'B', 'Cm', 'C#m' … 'Bm' (sharps)
  key_conf: number;               // 0 … 1
  start_silence_ms: number;       // ≥ 0; start + end ≤ duration_ms
  end_silence_ms: number;
  energy: number;                 // 0 … 1
  valence: number | null;         // 0 … 1
  arousal: number | null;         // 0 … 1
  vocals: number | null;          // 0 … 1 (1: sung)
  moods: Record<Mood, number> | null;   // exactly the 16 moods below, each 0 … 1
  emb: number[] | null;           // 32 numbers, −1 … 1, a unit vector
  emb_v: 1 | null;                // which fixed projection made `emb`
};
```

There is no free-text field, by design: an Actions run (a public, injectable place) can never put words into the owner's data. The Camelot place is derived from `key` by the Worker (`camelotOf`), never sent. A result is ≤ 8 KB (about 1 KB in practice). Product use of these numbers is in [MUSIC.md §9](../product/apps/MUSIC.md).

**How each number is made** (`jobs/audio/dsp.py`, `clap.py`, `moods.py`; the docstrings hold the details):

| Field | Method |
|---|---|
| `lufs_i`, `lra` | ITU-R BS.1770-4 (K-weighting by libebur128's filter design, 400 ms blocks, gates at −70 LUFS and −10 LU) and EBU Tech 3342 (3 s windows, gates −70 LUFS and −20 LU, 95th − 10th percentile) |
| `true_peak_db` | each channel oversampled 4× (polyphase FIR), the largest value |
| silences | 10 ms frames of the mono mix under −60 dBFS at each end |
| `bpm`, `bpm_conf` | onset envelope (spectral flux of a 64-band log-mel spectrogram, 16 kHz, 8 ms hop), its autocorrelation weighted by a log-normal prior around 120 BPM, refined by a parabola; confidence = the normalised autocorrelation there; null for a steady tone or silence |
| `key`, `key_conf` | chromagram (55 Hz – 2 kHz folded to pitch classes) correlated with the Krumhansl–Kessler profiles in 24 keys; confidence = the winner's lead over the runner-up (0.15 or more = certain) × its correlation |
| `energy` | 0.6 loudness (−36 … −6 LUFS) + 0.2 onset strength + 0.2 brightness (spectral centroid 0.5 … 4 kHz), a stated heuristic |
| CLAP embedding | up to three exactly-10-second windows (25 %, 50 %, 75 %) through the audio tower, each normalised, averaged, normalised: 512-d |
| `moods` | 16 fixed moods, each `sigmoid(scale × (cos(audio, its prompt) − the song's mean cos over the 16))`, `scale` the model's own audio-text logit scale (≈ 18.7): 0.5 = this song's average, so the scores say which feelings stand out. A plain "a piece of music" baseline was measured and set aside (it beats every mood and pushed every score to 0) |
| `valence`, `arousal`, `vocals` | prompt pairs, the first against the second the same way; arousal is then averaged with `energy` |
| `emb` | the 512-d vector through a fixed 512 × 32 projection, normalised, rounded to 4 places |

**The moods and their prompts** (`jobs/audio/moods.py`; the keys are Music's own `MUSIC_MOODS` in `shared/contract/music.ts`, the same list what the mind knows of each song uses, Music step 4; a test keeps them equal): calm "calm, relaxed, gentle music" · peaceful "peaceful, serene, tranquil music" · melancholy "melancholic, wistful, bittersweet music" · sad "sad, sorrowful, mournful music" · hopeful "hopeful, uplifting, optimistic music" · joyful "joyful, happy, cheerful music" · romantic "romantic, tender, loving music" · nostalgic "nostalgic, sentimental music that recalls the past" · dark "dark, ominous, brooding music" · tense "tense, suspenseful, anxious music" · energetic "energetic, driving, high-energy music" · triumphant "triumphant, heroic, epic music" · playful "playful, whimsical, light-hearted music" · dreamy "dreamy, ethereal, atmospheric music" · reverent "reverent, sacred, worshipful music" · focused "steady, unobtrusive music for focus and concentration". Pairs: valence "happy, positive, bright, pleasant music" / "sad, negative, gloomy, unpleasant music"; arousal "energetic, intense, exciting, loud music" / "calm, quiet, soft, sleepy music"; vocals "music with a singing voice and vocals" / "instrumental music with no vocals". A changed prompt changes every score, so it comes with a new analyzer version.

**The fixed projection** (`jobs/audio/projection.py`, `emb_v` 1): a seeded random orthogonal projection, fitted to no audio at all (no owner song, no outside collection): ±1 entries from a splitmix64 stream (seed `thaudio1`), columns made orthonormal by modified Gram–Schmidt in float64 using only + − × ÷ and √ (correctly rounded in IEEE 754, so the same bits on every machine), kept as float32 and checked against a committed SHA-256 before use. A random projection keeps cosine roughly (about ±0.18 at 32 dimensions); PCA on public, non-owner music would keep more and would be `emb_v` 2, with every song analysed again.

### 3.2 Tools and licences

The licence rule is no GPL, AGPL or non-commercial dependencies, which rules out typical ffmpeg builds, aubio and Essentia. (The one named exception, libmedia, is for Astra's player only, by owner ruling; it does not extend to jobs.) librosa and pyloudnorm, named here before, are not used: librosa pulls in libsndfile and libsoxr (LGPL) and numba; the measures above are about 300 lines of numpy and scipy, checked against known answers.

| Step | Tool | Licence |
|---|---|---|
| Decode Opus → 16-bit PCM at 48 kHz | `opusdec` (opus-tools, from the runner's apt) | BSD |
| Loudness, true peak, LRA, tempo, key, silences, energy | numpy + scipy | BSD |
| CLAP | LAION `clap-htsat-unfused`, revision `8fa0f1c6…`, weights SHA-256 checked | **Apache-2.0** (model card, checked 2026-11-01) |
| Running CLAP | Hugging Face transformers 5.22.1 on PyTorch 2.15.0 (CPU build), and their dependencies | Apache-2.0; BSD-3; the rest MIT, BSD, ISC, PSF, MPL-2.0 (tqdm) |
| Fetch from R2, talk to the Worker | Python's standard library (S3 signature v4 by hand) | PSF |

LAION's music checkpoint `larger_clap_music` (also Apache-2.0) was tried first: under transformers 5.22.1 its text tower gives every prompt the same embedding (cosine 0.999 between "calm music" and "a dog barking"), so no mood can be told from another; `clap-htsat-unfused` gives distinct prompts (0.19–0.69) and a sane logit scale. Microsoft's CLAP is MS-PL (a reciprocal licence for source), not used. The model's training data (LAION-Audio-630K and others) carries mixed licences; the weights are released under Apache-2.0, which is what the rule asks of a dependency.

Every Python package is pinned to one version with the hash of the one wheel a CPython 3.12 manylinux x86_64 runner installs (`jobs/audio/requirements.txt`, `requirements-clap.txt`; installed with `pip install --require-hashes --no-deps --only-binary=:all:`, tested on 3.12.16 with `pip check` clean). The analyzer version (`2.0.0`) bumps whenever a tool, a prompt or a parameter changes, so old and new results can be told apart; a song analysed by another version is offered again.

**Runtime** (measured 2026-11-01 on a loaded 4-core machine, CPU time of one process, one thread): a 4-minute stereo song costs about 5.6 s of signal measures and 1.1 s of CLAP; with decoding and the download, about 8 s. Memory (measured the same day, the model loaded): a worker sits at 2.2 GB of address space and 0.9 GB resident; an hour-long WAV, the longest taken, peaks at 3.1 GB and 1.9 GB resident, under the 4 GiB limit each worker has. Four processes on a standard 4-vCPU runner: about 2 s a song, **a 500-song job in about 20 minutes** plus 2 minutes of setup (the hash-pinned install, the 615 MB model, the self-test). **12,000 songs: about 27 CPU-hours, 24 nightly jobs of about 20 minutes each** (or 12 at `max=1000` once J2 confirms it). The neighbours step for 12,000 songs takes seconds. Free: Actions minutes on a public repository cost nothing.

### 3.3 The spec

1. `mind-night` runs `th music jobs`, which calls `GET /v1/jobs/next?kind=audio.analysis&max=500`. The `Music` DO picks audio hashes due at the current analyzer version (no result, a result from another version, or a failure tried fewer than 3 times), native Opus only (`audio_key` = `native/audio/<sha256>.opus`), one per hash, oldest catalog place first, none already in an open spec, and records a row in `Music.external_jobs` (`id, kind, v, spec_json, state, issued_at, expires_at = +72 h, collected_at, counts_json`). At most two jobs of a kind are open at once (`409 open_jobs`).
2. The response: `{ job_id, kind: 'audio.analysis', v: 2, shas: [...], expires_at }`. `th` prints the count, never the hashes. Only the night mind may ask (the CI key may not issue a job); at most three jobs of a kind in 24 hours (`429 daily_jobs`, which also stops a mind that loops), and none from 80 % of the day's database budget until 00:00 UTC (`429 daily_quota`, the heavy-work hold of DATA.md §8.1).
3. `th` dispatches `jobs-audio.yml` with the single input `job_id`, through the GitHub CLI and the session's own GitHub access ([RUNTIME.md](../mind/RUNTIME.md) R-12). Dispatch inputs are visible on a public run page, so the hashes never travel there; the workflow fetches the spec itself with `GET /v1/jobs/:id/spec` and the `jobs-audio` key.
4. A spec not collected within 72 h becomes `expired` (when the next job is asked for or the jobs are listed), its uploads are deleted and its songs are due again.
5. **The neighbours step:** when nothing is due for analysis and no analysis job is open, and results changed since the last neighbours job (the `listen.epoch` counter), `?kind=audio.neighbours` issues one: the Worker writes the hashes in order and their int8 embeddings to `jobs/specs/<id>.order|.emb`, and the spec carries only `{n, k: 50, dim: 32, emb}` (base64), no hash. Up to 20,000 songs (indexes are uint16).

### 3.4 The workflow (`.github/workflows/jobs-audio.yml`)

1. Trigger: `workflow_dispatch` with input `job_id`, checked against the UUID pattern before anything else and passed to steps only through `env`. Job `if: github.ref == 'refs/heads/main'`, environment `jobs`, `timeout-minutes: 300`, concurrency group `jobs-audio` (`cancel-in-progress: false`), `permissions: {}` and `contents: read` on the job; checkout without persisted credentials; every action pinned by its commit.
2. Install `opus-tools` and the hash-pinned Python packages; run the self-test (`python -m jobs.audio --selftest --clap`: synthetic tones with known loudness, tempo, key and silences, and the model's output shape) before any real song is touched.
3. Take the secrets out of the process environment (nothing the job starts inherits them), then fetch and check the spec (`GET /v1/jobs/:id/spec`, never printed): the kind and `v` known, 1–500 hashes, each `^[0-9a-f]{64}$`, no duplicates, and its `analyzer` this job's own (else `fail: analyzer_version`: the Worker refuses another version's results). On failure: `fail: bad_spec`, exit 1. Redirects are refused on every request, so the bearer token or a signature never follows one.
4. For each hash, 4 at once: the job itself GETs `jarvis-music/native/audio/<sha>.opus` with the read-only key into `$RUNNER_TEMP`, hashing it on the way (≤ 64 MB; if sha256(bytes) differs: `failed: hash_mismatch`), then hands the file to a worker process, which holds no secret, has a 4 GiB address-space limit and 10 minutes a song: `opusdec` (a bare environment, its output file capped at an hour of 48 kHz stereo) decodes it; the WAV header is read first and a song over an hour fails as `too_long` before any audio is loaded; the song is then read 10 seconds at a time (only a 16 kHz mono copy, about 230 MB at the hour's limit, and CLAP's three windows are kept); the result is built and checked locally against the schema; both files are deleted. A worker that dies (out of memory, say) costs only the songs it held: the pool is made again and each of those songs is tried once more alone, then counted `analyze`. Whatever was analysed is uploaded, even if the pool fails.
5. Upload the results **through the Worker**, 50 to a part in the manifest's `files` order, one result a line (`PUT /v1/jobs/<id>/files/part-001.jsonl`, …), then the manifest **last** (`…/manifest.json`):
   ```ts
   { v: 1; job_id: string; kind: 'audio.analysis'; analyzer: {name, version};
     started_at: Ms; finished_at: Ms;
     files: { sha256: string; bytes: number; result_sha256: string }[];   // part p holds files[50(p−1) … 50p−1]
     failed: { sha256: string; reason: 'download'|'hash_mismatch'|'decode'|'too_long'|'analyze'|'timeout' }[] }
   ```
   A neighbours job uploads `neighbours.bin` (n × 50 little-endian uint16: row i is song i's nearest, nearest first, ties by index, never i, 0xFFFF after the last when fewer than 50 others exist) and `{ v: 1, job_id, kind: 'audio.neighbours', analyzer, started_at, finished_at, n, k: 50, bytes, sha256 }`.
6. Log lines: `spec: N songs`, `model: ready in N s`, `analysed: N of M, N s` every 50, `done: N ok, N failed, N s; uploaded N parts and the manifest`, `collect: validating`. Any failure prints `fail: <reason>` from a fixed list (`bad_job_id`, `bad_spec`, `analyzer_version`, `spec_fetch`, `model`, `pool`, `upload`, `collect`, `not_configured`, `selftest`, `internal`) and nothing a library or server said.
7. A last call `POST /v1/jobs/<job_id>/collect` with the `jobs-audio` key. If the run fails before it, `th music jobs` collects the next night (any job issued over 6 hours ago, or still validating 6 hours after its collect).

Local mode for testing on synthetic or the owner's own files, on the owner's own machine: `python -m jobs.audio --local <folder> [--clap]` prints one result a line for each `.wav` (16-bit) or `.opus` file.

### 3.5 Validation on collect (in the Worker, then Core's apply job)

The job moves `issued → validating → applied`, or `→ rejected` if the manifest itself is bad.

| # | Check | Where | On failure |
|---|---|---|---|
| 1 | The manifest exists, is ≤ 1 MB, parses, and matches its schema (`additionalProperties: false`, every range and enum) | collect | `rejected`; nothing applied; uploads deleted |
| 2 | `job_id` names an `issued` spec that hasn't expired, of the same `kind` and `v` (a neighbours manifest's `n` equals the spec's, `k` = 50, `bytes` = n × k × 2) | collect | `rejected` (`410` if expired) |
| 3 | Every hash in `files` and `failed` is in the spec; no duplicates within or across the two lists | collect | `rejected` |
| 4 | Each result line's byte count and sha256 equal its manifest entry, ≤ 8 KB (a neighbours file: its size and sha256) | apply job | That result is invalid (`size`, `hash`; a missing part: `part`) |
| 5 | The line is UTF-8 JSON and passes schema v2 with `additionalProperties: false`, every range and enum, start + end silence ≤ duration, and `sha256` equal to its manifest entry (a neighbours file: every row in range, never itself, no repeat, padding only at the end) | apply job | That result is invalid (`json`, `schema`, `key`); a bad neighbours file rejects that job |
| 6 | Spec hashes missing from both lists | collect | Counted as `missing`; they stay due |

Then (`music.listen.apply`, a Core job on the bulk lane, one part of 50 a step):
1. The valid results are re-written from their own fields at every level (the top level in the schema's order, `analyzer` as its name and version, `moods` by `MUSIC_MOODS`, `emb` as numbers) and upserted into `Music.analysis` with a 56-byte pack of the phone's numbers, and every track holding that audio gets its row of `Music.track_analysis` (`energy`, `moods_json` by `MUSIC_MOODS`; what Music step 4 reads); the job's counts move in the same Music transaction, which skips a part already taken (a step repeated after a crash writes nothing twice; the same result again writes 0 rows). Music's rows written count on the lane in the step's commit, so the lane's 40,000 a day and the 80 % quota hold apply.
2. A last step records the job's own failures (`attempts` +1 at this analyzer version), marks it `applied`, moves `listen.epoch` if anything was valid, deletes everything under `jobs/incoming/<job_id>/` (a failed delete is tried once more; asking for the next job sweeps what closed jobs left) and queues `music.listen.pack` if anything was valid. If the apply job fails for good (six tries), its `failed` hook queues `music.listen.reject`, which marks the Actions job `rejected` (reason `apply_failed`) and deletes its files.
3. A neighbours job's first step checks the file, stores `music/neighbours.v1.bin` (header, the order, the rows) in place of the last, records `listen.neighbours` (the job reads `applied` from here) and deletes its uploads and spec files; then each analysed track's row of `track_analysis` gets its `neighbours_json` (the near songs as track ids, each audio's first track in catalog order, nearest first, never itself), 2,000 tracks a step, an unchanged row writing nothing; then the pack is queued. A bad file rejects the job and leaves the last neighbours as they were.
4. `music.listen.pack` (reads only; waits like heavy work from 80 % of the day's budget) has the Music object build the phone's file `music/pack.v1.bin` ([MUSIC.md §9.1](../product/apps/MUSIC.md)).
5. `external_jobs.counts_json = {expected, valid, invalid, failed, missing, reasons}` (reasons by fixed name, never a hash).

The schema checks are the JSON-Schema-subset validator in `backend/src/areas/work/validate.ts` (shared with Muse's work orders, no extra dependency) on the schemas in `shared/contract/listen.ts`; it takes a schema's own fields only, so names an object's prototype answers to (`__proto__`, `constructor`, `toString`…) are refused like any other unknown field (fixed 2026-11-01 after the second reading; `backend/tests/unit/validate.test.ts`). The analyzer's version must be this build's (`ANALYZER`). The rest is `backend/src/areas/music/listen-check.ts`.

**Rows** (cost suite, local workerd): issuing a job reads about 2 rows per catalog track (about 24,000 at 12,000 songs) and writes 1; an upload or a status reads 1; collect writes 1 in Music and 2 in Core; applying 50 results writes 105 rows in Music (each result's `analysis` row and its track's `track_analysis` row, the counts, the end) and about 10 in Core (the job's row, its steps, the lane's count); building the phone file reads one row per track and per analysis (about 24,000) and writes 1; the neighbours job writes one `track_analysis` row per track whose neighbours changed (12,000 the first time, few after). **A 500-song job writes about 1,060 rows; the whole library of 12,000 about 25,000 rows over about 24 nights (about 2.1 per song, about 1.6 % of a day's 68,000 budget each night), then about 12,000 for the first neighbours (6 steps of 2,000, one night, under the lane's 40,000), and reads about 50,000 a night.** A new analyzer version costs the same again.

Acceptance (built, `backend/tests/integration/listen*.test.ts`): every row of the table with synthetic manifests and files in local R2: a bad manifest applies nothing; one bad file among many applies the rest; a result whose `sha256` differs from its key is refused; duplicates, unknown keys, another job, another kind, a bad reason, broken JSON and an oversized manifest each reject; expiry; the lane pausing at its cap; neighbours staying in their cluster and a self-neighbour refused.

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
