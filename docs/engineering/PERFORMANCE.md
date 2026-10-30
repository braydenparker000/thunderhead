# Performance

This page sets the performance budgets for the Thunderhead on the owner's phone (a Samsung Galaxy A15 in Chrome) and on the free Cloudflare backend, and says how each budget is measured and enforced.
A budget without a check is a wish, so every row names its check. Over-budget work fails the build, rolls back a deploy, or trips a watchdog.
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **The Galaxy A15 is the reference device.** Lab tests stand in for it at its size with a 4× CPU throttle. The real phone has the final word.
2. **Warm start ≤ 1.0 s** from tap to the voice line. Cold first visit on 4G ≤ 3.0 s.
3. **INP p75 ≤ 100 ms.** Gesture feedback lands within one frame (11.1 ms at 90 Hz). No long animation frame over 50 ms during a gesture.
4. **Shell bytes on the critical path:** JS ≤ 120 KB, CSS ≤ 60 KB, fonts ≤ 130 KB, icon sprite ≤ 30 KB (raw, uncompressed). `stage.mjs` fails the deploy above them.
5. **Animate only `transform` and `opacity`.** No animated `filter: blur()`. At most 2 `backdrop-filter` surfaces visible at once.
6. **Worker CPU p99 ≤ 5 ms per request** (Free allows 10 ms). DO CPU p99 ≤ 20 ms per RPC, except sign-in.
7. **Rows per endpoint are pinned by cost tests.** Daily totals stay inside the targets in [DATA.md §8](DATA.md#8-row-write-budget-free-plan).
8. **Nothing runs while hidden** except audio and its keep-alive.
9. **Ported apps (P1b) are measured, not reshaped.** They come over as they are (owner ruling), so the shell's byte, frame and memory budgets don't apply to them; their sizes are recorded at the port and may only change through an owner-agreed evolution.

---

## 1. The reference phone

| Fact | Value | Source |
|---|---|---|
| Model | Samsung Galaxy A15 4G, SM-A155F | decisions.md; old repo test fixtures |
| SoC | MediaTek Helio G99: 2× Cortex-A76 at 2.2 GHz + 6× Cortex-A55; Mali-G57 MC2 GPU | public spec |
| Display | 6.5″ 1080 × 2340, 90 Hz → **11.1 ms per frame** | public spec |
| RAM | 4, 6 or 8 GB **[variant unverified]** | ask the owner |
| CSS viewport, DPR | likely 384 × 832 at 2.8125 **[unverified]** | remote DevTools (TESTING.md T1) |
| Browser | Chrome on Android, tab or installed web app | decisions.md |
| Navigation | 3-button or gestures **[unknown]** | ask the owner |

Lab stand-in: Playwright Chromium at the `a15` project size ([TESTING.md §10.1](TESTING.md#101-projects-proposal)) with CDP `Emulation.setCPUThrottlingRate {rate: 4}` **[proposal: calibrate the rate once against a device trace]**.

---

## 2. Site budgets

Enforced by `scripts/stage.mjs` on every deploy (the deploy fails before publishing). Current values from the first build are shown for scale.

| Budget | Limit | Today | Check |
|---|---|---|---|
| Files in the release | ≤ 2,000 | 13 | `stage.mjs` (exists) |
| Total bytes | ≤ 25,000,000 today; ≤ 40,000,000 from P1b **[proposal]** (the ported apps add ~23 MB) | ~0.15 MB | `stage.mjs` (exists) |
| Ported folders (P1b) + `/assets/` | Recorded per folder in `ported.json` at the port (measured in the old repo 2026-10-28: Music ~3.4 MB/107 files, Guitar ~2.6 MB/24, Podcasts ~0.3 MB/14, Astra ~4.2 MB/66, My Media ~0.2 MB/11, shared `/assets/` files ~12.5 MB, almost all libmedia); fails if a folder grows without a recorded adjustment | — | `stage.mjs` + `tests/ported.test.mjs` |
| Home + `ui/` JS (critical path) | ≤ 120,000 | ~13.3 KB | `stage.mjs` (exists) |
| Home + `ui/` CSS | ≤ 60,000 | ~21.3 KB | `stage.mjs` (exists) |
| Fonts (`.woff2`) | ≤ 130,000 | ~103 KB | `stage.mjs` (exists) |
| Icon sprite `ui/icons.svg` | ≤ 30,000 | — | add with the sprite (P1) |
| `th/` JS loaded by the shell at boot (`th/*.js`) | ≤ 64,000, counted inside the 120 KB (60,000 until 2026-10-30: the contract's verb list grows with each app feature) | ~60 KB | `stage.mjs` (P2) |
| The conversation, loaded after the first paint (`th/chat/**`, `th/registry/**`) | ≤ 60,000 | ~41 KB | `stage.mjs` (P2) |
| The menu's conversations and search, loaded when the menu first opens (`th/convos/**`) | ≤ 50,000 | ~43 KB | `stage.mjs` (built) |
| Each app's own code on open (`apps/<id>/**`) | ≤ 300,000 | — | add in P5 |
| Precache total (everything except `vendor/`, stubs, ported folders and `/assets/`) | ≤ 3,000,000 **[proposal]** | — | add with the SW (P1) |
| Any single non-vendor file | ≤ 400 lines of JS (soft) / 200,000 bytes (hard) **[proposal]** | — | Biome rule + `stage.mjs` |

- Vendor engines (pdf.js, alphaTab, mediabunny) are loaded only by their app, on use, and are not counted in the shell's budget. In P1b the ported apps' own engines (Guitar's bundled engine and pdf.js, Astra's mediabunny and libmedia) live inside their folders as they are.
- The budget numbers move to `tests/budgets.json` (one source for `stage.mjs` and the tests) in P1.
- Compression: the static website serves files as uploaded. If the brotli upload proposal passes its live check ([ARCHITECTURE.md §5](ARCHITECTURE.md#5-consequences-of-hosting-on-an-azure-storage-static-website)), transfer sizes fall by about 70% for text. The budgets above stay on raw bytes either way.

---

## 3. Phone runtime budgets

These budgets apply to home, the shell and new apps. Ported pages (P1b) are traced once on the A15 at the port and recorded as their baseline; a later change to a ported app must not make its baseline worse **[proposal]**.

### 3.1 Startup

| Metric | Budget | Measured by |
|---|---|---|
| Warm start (SW cached): tap → voice line painted | ≤ 1.0 s | Field: `start_warm` from `performance.timeOrigin` to the voice line's first paint (an element-timing mark), sent daily via `POST /v1/ops/perf`. Lab: Playwright, throttled, second load |
| Warm start → the hold gesture works | ≤ 1.2 s | Lab: the hold test starts at 1.2 s and must pass |
| Cold first visit on 4G (no SW) | ≤ 3.0 s to the voice line | Lab: Playwright with network throttling (1.6 Mbps down, 150 ms RTT) **[proposal: profile]**, first load. Device checklist item 1 |
| Main-thread script evaluation at startup | ≤ 150 ms on the A15; ≤ 200 ms in the throttled lab | Lab: a Performance trace's scripting total before the voice line |
| Layout shift from font swap | 0 on warm starts (fonts precached); ≤ 0.05 CLS on a cold start | Lab: `layout-shift` entries |
| Theme flash | none: `ui/theme.js` sets `data-theme` before first paint | Lab: a screenshot at first paint in night mode has no white pixels |

### 3.2 Interaction

| Metric | Budget | Measured by |
|---|---|---|
| INP p75 (field) | ≤ 100 ms | `PerformanceObserver` (`event`, `durationThreshold: 16`), daily p75 in `perf_days.inp` |
| Each lab interaction (tap +, open menu, send) | ≤ 100 ms from input to next paint under the 4× throttle | Playwright + `PerformanceObserver` inside the page |
| Gesture first feedback | within 1 frame (≤ 11.1 ms) of the triggering pointer event or of the 220 ms hold timer | rAF timestamp minus event timestamp, sampled in lab |
| Long animation frames during a gesture | none > 50 ms | LoAF API (`long-animation-frame` entries) between `pointerdown` and the settle of the gesture; field `perf_days.loaf_gesture` = count per 100 gestures, must be 0 at p95 |
| Dropped frames during ring open and swipes | ≤ 5% of frames longer than 16.7 ms (1.5× the 90 Hz frame) **[proposal]** | rAF interval sampling in the lab and on the device |
| Ask bar under the keyboard | the bar stays visible above the keyboard with no jump > 1 frame | Device checklist |

### 3.3 Rendering rules (what keeps the frames)

1. Animate only `transform` and `opacity`. The drifting colour field moves pre-blurred `radial-gradient` layers by transform; it never animates `filter`.
2. At most 2 `backdrop-filter` surfaces visible at once (the ask bar and one sheet or the ring).
3. All pointer and touch listeners are `{passive: true}`. `touch-action` does the gesture work (`none` on the empty stage; `pan-y` on scrollers).
4. Lists over 200 rows are virtualised; at most 40 row nodes are alive (`ui/vlist.js`).
5. Only one app's DOM is alive at a time. `unmount()` removes everything.
6. Hidden page: every rAF loop and visual timer stops on `visibilitychange → hidden`. The only interval allowed while hidden is the audio keep-alive (20 s) while audio plays.
7. Heavy work (search indexing, PDF parsing, audio analysis on the phone) runs in a Worker thread, never on the main thread during a gesture.

### 3.4 Memory

| Metric | Budget | Measured by |
|---|---|---|
| JS heap, home only | ≤ 40 MB **[proposal]** | Lab: `performance.measureUserAgentSpecificMemory()` (cross-origin isolation isn't possible on this host, so fallback: CDP `Runtime.getHeapUsage`) |
| JS heap with Music open | ≤ 120 MB | same; field `perf_days.heap_mb` from `performance.memory` (Chrome) |
| DOM nodes, home | ≤ 1,500 | Lab: `document.getElementsByTagName('*').length` |
| Mount/unmount leak | baseline ±5% after 20 cycles | TESTING.md §10.2 |
| Offline storage | ≤ 512 MB of offline songs by default (LRU), shown in Settings | `navigator.storage.estimate()` |

### 3.5 Network from the phone

| Metric | Budget | Measured by |
|---|---|---|
| API read (`GET /v1/changes`, `/threads/today`) p75 | ≤ 400 ms **[proposal]** | Field: `api_ms` in `perf_days` (the client times its own fetches) |
| Message send → stored (201) p75 | ≤ 600 ms **[proposal]** | same |
| Live socket: commit → `changed` frame on the phone | ≤ 300 ms p75 **[proposal]** | Field: frame arrival minus the `at` of the change |
| Preflights | ≤ 1 per URL per 2 h (`Access-Control-Max-Age: 7200`) | Live CORS check |
| Requests per foreground minute (steady) | ≤ 10 | Lab: count requests in a 60 s idle home session |

The DO's location is fixed (`locationHint`), so round-trip time from the owner's region dominates. These budgets are set after the first week of field data and recorded in decisions.md.

---

## 4. Backend budgets

### 4.1 Worker

| Metric | Budget | Free limit | Measured by |
|---|---|---|---|
| CPU per request, p99 | ≤ 5 ms | 10 ms (with some flexibility for rare overruns) | Workers Logs `cpuTimeMs` (sampling 1); the structured log line |
| CPU for `POST /v1/media/sign` with 50 refs | ≤ 5 ms (~0.1 ms of HMAC per URL) | 10 ms | same |
| Memory | no buffering of uploads; files stream to R2 | 128 MB per isolate | code review; upload test with 50 MB |
| Subrequests per invocation | ≤ 10 | 50 external / 1,000 internal | code review |
| Startup | ≤ 200 ms; no top-level schema building in bulk | 1 s | `wrangler deploy` output; cold-request timing |
| Requests per day | ≤ 15,000 expected (~6,000 typical) | 100,000 | `meter` estimates; the Cloudflare dashboard monthly |

### 4.2 Durable Objects

| Metric | Budget | Free limit | Measured by |
|---|---|---|---|
| CPU per RPC, p99 | ≤ 20 ms | 10 ms or 30 s per invocation (unknown on Free; test X3) | Workers Logs for the DO; deep health samples |
| Sign-in (scrypt N=2^15, r=8, p=3) | ~235–265 ms of CPU, once per sign-in | as above | test X3 decides whether this stays in `Auth` |
| Bulk job step | ≤ 2,000 rows and ≤ 200 ms CPU **[proposal]**; if X3 shows 10 ms per invocation, steps shrink to fit (≈ 100–200 rows) | as above | job step cost tests |
| Duration (GB-s/day) | ≤ 2,600 (20%) | 13,000 | Cloudflare dashboard weekly; deep health "awake" estimate |
| Requests per day (RPC + alarms + WS messages ÷ 20) | ≤ 15,000 | 100,000 | `meter.rpc_calls` summed by `Core.tick` |
| Object size | ≤ 700 MB (alert) | 1 GB per object on Free | `sql.databaseSize` in deep health |
| No timers | 0 `setTimeout`/`setInterval` in objects | — | `no-timers-in-do` test |

One object kept awake for 24 h costs 10,800 GB-s, 83% of the daily allowance. That is why long polls and timers in DOs are banned, and why live sockets use the hibernation API.

### 4.3 Rows and calls per endpoint

Starting budgets for `backend/tests/cost/budgets.json`, at the year-2 scale fixture. They are maxima per request.

| Endpoint | DO calls | Rows read | Rows written |
|---|---|---|---|
| `GET /v1/health` | 0 | 0 | 0 |
| Auth check on a cache miss | 1 (`Auth`) | 2 | 0 (1 at most once an hour for `last_seen_at`) |
| `POST /v1/auth/login` | 1 | 10 | 6 |
| `POST /v1/live/ticket` | 1 (`Core`) | 0 | 1 (and 1 more when the upgrade marks it used) |
| `GET /v1/live/wait` (one take) | 1 | 5 | 1 at most every 5 min (lease) |
| `GET /v1/changes` (limit 200) | 1 | 210 | 0 |
| `GET /v1/threads/today` | 1 | 60 | 0 |
| `PUT /v1/messages/:id` | 1 | 30 | 16 (+8 if it queues a wake) |
| `GET /v1/search` | 1 | 20,000 | 0 |
| `POST /v1/mind/brief` | 1–2 | 3,000 | 3 |
| `PUT /v1/verbs/:id` / `POST …/result` | 1 | 5 | 6 / 8 |
| `PUT /v1/surfaces/:app/:slot` | 1 | 3 | 6 |
| `POST /v1/memory/ops` | 1 | 20 per op | 12 per op |
| `POST /v1/proposals/:id/decide` | 1–2 | 20 | 10 (+ the executor's own budget) |
| `PUT /v1/senses/batches/:id` (500 events) | 1 | 2 | 1,002 |
| `POST /v1/media/sign` (50 refs) | 1 | 50 | 0 |
| `POST /v1/ops/errors` (50 items) | 1 | 50 | 100 |
| `GET /v1/ops/health/deep` | 1 per class | 50 | 0 |
| `Core.tick` (cron) | ≤ 5 | 200 | 10 |

Wherever the measured number comes in lower, the budget is lowered to measured + 25%.

P2 measured in local workerd (a day of 20 messages; `budgets.json` holds every number, rows read / written): `PUT /v1/messages/:id` from the owner 10 / 8, a mind reply that settles 21 waiting messages 78 / 30 (it also sets the presence to listening); `GET /v1/threads/today` 24 / 0; `GET /v1/changes` with nothing new 2 / 0; `POST /v1/live/ticket` 0 / 1; `GET /v1/live/wait` with nothing new 29 / 0; `POST /v1/mind/brief` claiming with 20 waiting 120 / 49 (it arms the requeue alarm); `GET /v1/search` 57 / 0; `PUT /v1/verbs/:id` 1 / 7; `PUT /v1/surfaces/home/:slot` 1 / 7; `Core.tick` 8 / 0, and 48 / 1 on the daily prune pass. The wait and the brief grow with the unanswered owner messages, which the next reply clears; nothing grows with the age of the data.

P3 measured the same way, on that Core plus four facts, one loose end and one day note: `POST /v1/memory/ops` with one add 2 / 11 (the fact, its indexes and FTS rows, the ledger row, the feed and the batch record); `GET /v1/memory/facts` 4 / 0; `GET /v1/memory/facts/:id` (versions, evidence, why) 5 / 0; `GET /v1/memory/profile` 5 / 0; `PUT /v1/memory/open-threads/:id` 2 / 7; `GET /v1/memory/open-threads` 2 / 0; `PUT /v1/memory/day-notes/:day` 3 / 8; `GET /v1/memory/day-notes` 1 / 0; `GET /v1/search` over messages, facts and day notes 9 / 0. Memory raised three P2 numbers: the brief to 126 / 49 (rules, loose ends, the profile and day notes, and the session's taint: one row, plus the day's tainted sessions on their partial index, usually none), the messages-only search fixture to 59 / 0 (the two new sources answer from empty indexes), and the daily prune pass to 56 / 1 (closed loose ends and the 7-day batch window). The profile and the brief read at most 2,000 current facts (newest first, a backwards scan that stops at the limit) and 200 rules. The night shift (stage C): `POST /v1/mind/night` 3 / 1 to start, 4 / 1 per step, 4 / 0 for a step reported again; `GET /v1/mind/day/:day` 5 / 0 for the counts and 3–4 / 0 per page of messages, ledger or notes on an empty day (a page reads its own ≤ 200 rows more, each part on its index from the cursor on); the daily prune pass is 60 / 1 with `night_runs` and the notes' time index.

P3 stage D (the import) measured on the same Core: a part and the manifest cost Core nothing (they go to the private bucket); `POST /v1/import/runs` and its job for one part of 50 old threads, verified, up to 70 / 116 (each thread with its indexes, then the run, the job, the lane and one ledger row); `GET /v1/import/runs/:id` 1 / 0; the same part again 70 / 15, its own bookkeeping only, so a rerun changes no imported row. Every write that sets the alarm now also reads the earliest due job (one more row read, on the `jobs_due` index): the owner's message 11 / 8, the mind's reply 79 / 30, `POST /v1/mind/typing` 4 / 0, `GET /v1/live/wait` 30 / 0; the daily prune pass reads 68 (the jobs and imported documents it may prune). Stage D.5: the tick's quiet-hour check reads the open daily thread first (one more row, on `threads_daily_day`), so a tick with nothing due is 9 / 0 and the prune pass 69 / 1. One import step of 2,000 old messages writes 7,933 rows; one alarm that ran a 6,000-message import's three steps and its verification took 327 ms of wall time in local workerd (DATA.md D6, D7 stay open for production).

P4 stages E–F measured the same way: the tick reads 3 more rows for the backup watchdogs and the expired exports (33 / 0 with nothing due; the prune pass 93 / 10, the first run of each new watchdog writing its row once). A backup or export part costs Core only its reads (5,000 rows in key order) and one small row update; its bytes go to the private bucket. A drill part's rows are written in the scratch instance and counted on the bulk lane (12,000 ledger rows and their indexes are about 40,000, so a large first table can spread a drill over two days).

P4 stage A (decision cards) measured on the same Core: `PUT /v1/proposals/:id` with a forget card 12 / 8 (it reads the session, the waiting cards and the fact it names, for the Worker's target line; it writes the card, its indexes, the ledger row and the feed); `GET /v1/proposals` with 3 waiting 6 / 0; a tap that approves a forget card 50 / 21 (the forget runs in the same commit, with the scrub of every card that named the fact); the same approval in the owner's own words 59 / 22 (the message, the open day's thread, its latest owner message and whether the message answered a card before, on `proposals_message`); `POST /v1/proposals/:id/cancel` 5 / 7; the cron's look for approvals whose Auth step never reported 1 / 0 (on `proposals_open`). A claim reads the laws pin and the card for its hash, and a chat claim ends the older open chat sessions (on `mind_sessions_open`, one row each), so the brief is 130 / 50; a tick with nothing due also reads the cards about to expire, 12 / 0, and the daily prune pass 78 / 1. Every mind write now reads the chat lease and its role's latest taint (one row each; the second on the `mind_sessions_tainted` partial index): `POST /v1/memory/ops` with one add 4 / 11, `PUT /v1/memory/open-threads/:id` 4 / 7, `PUT /v1/memory/day-notes/:day` 4 / 8, `POST /v1/mind/night` 4 / 1 to start, 5 / 1 per step and 5 / 0 for a step reported again.

P4 stage D (the watchdogs) measured on the same Core: each tick runs the six built watchdogs, which read their own rows (one per watchdog), the server and client error counts, `day.current`, the jobs that could be stuck and the reflex wakes of the last 24 hours, so a tick with nothing due is 24 / 2: only the two error watchdogs write, their last hour of totals, and a watchdog whose state, detail and counts didn't change writes nothing. That is about 2,300 rows read and 190 written a day. The first tick writes each watchdog's row once, so the daily prune pass on that tick is 83 / 7. A trip adds one ledger note and, when it wakes mind-reflex, one wake; a claim reads the watchdogs for the briefing's line, so the brief is 131 / 50. `GET /v1/ops/watchdogs` reads at most 14 rows.

### 4.4 Daily totals

The Free-plan math (writes, reads, requests, duration, storage) and the bulk lane are in [DATA.md §8](DATA.md#8-row-write-budget-free-plan). Watchdog thresholds are in [OPERATIONS.md §8.2](OPERATIONS.md#82-watchdogs-coretick-every-15-min).

---

## 5. Field measurement on the phone (the "LoAF senses")

Before `Senses` exists (P1–P4), the phone keeps its own day summary and sends one `POST /v1/ops/perf` per day **[proposal]**. From P5, the same numbers also flow as `sys.perf` events.

| Metric key | What | Collected by |
|---|---|---|
| `inp` | Interaction latency (ms) per interaction | `PerformanceObserver({type:'event', durationThreshold:16})` |
| `loaf_gesture` | Long animation frames > 50 ms that overlap a gesture | `PerformanceObserver({type:'long-animation-frame'})` + gesture start/end marks |
| `start_warm`, `start_cold` | Tap → voice line (ms) | navigation timing + element timing |
| `api_ms` | Fetch duration per API call | `api.js` |
| `heap_mb` | `performance.memory.usedJSHeapSize` at 60 s after start | Chrome only |

- Samples are kept in IndexedDB. p50, p75 and p95 are computed on the phone and sent once a day. No individual events leave the phone in P1–P4.
- A day whose p75 breaks a budget gets a briefing line the next morning; three such days in a row become an S3 incident ([OPERATIONS.md §7](OPERATIONS.md#7-incidents)).

---

## 6. How each budget is enforced

| Budget family | Enforced by | When it fails |
|---|---|---|
| Site bytes and files | `stage.mjs` | The deploy stops before publishing |
| Lab startup, interaction, frames | Playwright (`a15` project, throttled) in `npm test` | CI red; nothing merges |
| Leaks | Mount/unmount test | CI red |
| Field INP, LoAF, startup | `perf_days` + the morning check | Briefing line; S3 after 3 days |
| Worker and DO CPU | Workers Logs (`cpuTimeMs`); post-deploy error watch | A spike of 1102 errors after a deploy → rollback |
| Rows and calls per endpoint | Cost tests | CI red |
| Daily rows, requests, duration | `meter` + watchdogs | Lane paused at 60,000 writes; S3 at 70% |
| No timers in DOs | Static test | CI red |

---

## 7. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| P1 | A15 CSS viewport, DPR, RAM variant, navigation mode | Remote DevTools; ask the owner |
| P2 | Which CDP throttle rate matches the A15? | Run the same ring-open trace on the device and in the lab at 2×, 4× and 6×; pick the closest |
| P3 | DO CPU limit on Free (X3) — sets the job step size and where scrypt runs | Preview bench |
| P4 | `backdrop-filter` cost on the Mali-G57 with two surfaces | Device trace of the `+` sheet over the ask bar |
| P5 | Real round-trip time from the owner's region to the DO's location | One week of `api_ms` field data |
| P6 | Does `performance.memory` report in an installed web app on Android? | Check once on the device |
