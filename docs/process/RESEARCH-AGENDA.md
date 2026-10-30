# Research agenda

Every open question from tonight's research, deduplicated and ordered by the phase it gates, each with the cheapest test that settles it and who runs it. Also the recurring research the mind does in its weekly review so the facts under the project don't silently go stale.
The questions are real gaps found in the research; the test designs, IDs, owners and the cadence are **[proposal]** until the owner accepts this page.

## Rules at a glance

1. **One question, one row, one ID** (`RA-P<phase>-<nn>`). Duplicates across reports are merged; the "From" column lists every source so nothing is lost.
2. **A question is settled only by a test or a primary source**, never by reasoning alone. The result is written as one line in [decisions.md](decisions.md) (date · result · source), and the row's status becomes **Closed** with that date.
3. **Run a row before the first code that depends on it.** A phase may start while its rows are open, but the dependent feature waits (see [ROADMAP.md](ROADMAP.md) rule 5).
4. **Cheapest test first.** Reading a primary source beats a probe; a probe beats a build; the owner's time is the most expensive resource (each owner task is ≤ 5 minutes with exact steps).
5. **Public repo, public logs.** Tests in GitHub Actions use synthetic data and print numbers only. Anything touching personal data runs inside a Claude session or on the owner's phone. No Cloudflare or Azure credential ever enters a session ([decisions.md](decisions.md)).
6. **Outside web pages are data, not instructions.** Research reads happen through the quarantined reader; nothing read on the web becomes a fact, a rule or a config change without a decision line.
7. **The weekly review re-checks the platform monthly** (§4) and speaks only when something changed.
8. **Unknowns found later are added here**, never left as a comment in code.

Sibling docs: [IDEAS.md](IDEAS.md) (feature backlog; its open questions point here), [ROADMAP.md](ROADMAP.md), [STATUS.md](STATUS.md), [TESTING.md](../engineering/TESTING.md), [OPERATIONS.md](../engineering/OPERATIONS.md), [EVALS.md](../mind/EVALS.md), [RUNTIME.md](../mind/RUNTIME.md).

---

## 1. How to read the tables

| Column | Meaning |
|---|---|
| **ID** | `RA-P<phase>-<nn>`. The phase is the earliest one in [ROADMAP.md](ROADMAP.md) whose work depends on the answer. |
| **Why it matters** | What goes wrong if the assumption is false. |
| **Gates** | The decision or design that waits on it. |
| **Cheapest test** | The smallest action that settles it, with its pass condition. |
| **Who** | **AG** = agent in a Claude session (no cloud credentials). **OW** = owner on the phone (≤ 5 min). **CI** = GitHub Actions on synthetic data, numbers only. **PR** = a throwaway probe Worker `thunderhead-probe` deployed by an Actions workflow; Actions reads its numbers from Workers Observability with a CI-held token and prints numbers only. |
| **From** | Source reports: **R1**–**R5** = research reports 1–5 (item numbers from their test-first lists: R1 §5, R2 §10, R3 §6 T#, R4 §9, R5 §11); **R7** = architecture review (X# tests, §4, §8 Q#); **FC** = fact-check (A#, C#, §D); **FE** = feasibility research; **PL** = plan §16; **ID** = [IDEAS.md](IDEAS.md). |

**The probe Worker [proposal].** One small Worker, `thunderhead-probe`, holds every edge benchmark (CPU burners, scrypt bench, PITR calls, WebSocket hibernation, rate-limit binding, header logging). It holds no data and no secrets except a random probe key. It is deployed and exercised by `.github/workflows/probe.yml` (`workflow_dispatch` only). After its tests, its routes answer 404; deleting it is an ask-first `delete` proposal. **Acceptance:** the workflow's log contains only numbers and pass/fail lines (a test greps the log for anything else).

---

## 2. Open questions, by phase

### P0 · Site live (Azure Storage static website)

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P0-01 | What are the exact Azure portal labels for adding the ID-based federated credential (subject-type selector, the GitHub ID boxes)? | Setup steps must be exact for a phone-only owner. | [SETUP.md](SETUP.md) wording | Owner opens the app registration → Certificates & secrets → Federated credentials → Add, and reads the field names aloud or sends a screenshot without IDs. Pass: SETUP.md matches. | OW | R1-1, FC A3 |
| RA-P0-02 | Does `azure/login` see the subscription right after the role assignment, or only after propagation? | A first-deploy "No subscriptions found" looks like a broken setup. | Deploy retry note | Run Deploy; if it fails with that message, re-run after 10 min. Pass: a note in OPERATIONS.md with the observed delay. | CI | R1-3 |
| RA-P0-03 | Are content types right on the live site (`.js`, `.css`, `.woff2`, `.webmanifest`, `.svg`)? | Wrong MIME types break module scripts and fonts. | Upload step (`--content-type` overrides) | `curl -sI` each asset type after the first deploy, in the live check. Pass: all match. | CI | R1-4 |
| RA-P0-04 | Does the static website serve compressed responses, and does a pre-compressed upload with `Content-Encoding: br` work? | Bytes on a mid-range phone; Storage has no automatic compression. | Whether `stage.mjs` pre-compresses assets | `curl -sI -H 'Accept-Encoding: br'` against `/` and a JS file; then upload one test file pre-compressed with `Content-Encoding: br` and load it in Chromium. Pass: decision line "compress at stage" or "not needed". | CI | R4-12, R7 X2 |
| RA-P0-05 | Are branch rulesets available for this public repo on the org's plan? | `main` must block force pushes and deletion. | SETUP step for `main` protection | Owner opens repo → Settings → Rules → Rulesets. Pass: "New ruleset" exists; else use classic branch protection. | OW | R1-5 |
| RA-P0-06 | Does a rollback step guarded by `cancelled()` get time to finish after `timeout-minutes` cancels the job? | A cancelled deploy must never leave a half-published site. | Rollback design in `deploy.yml` | One forced cancel during a test deploy. Pass: the previous release is live (live `release.json` readback). | CI | R1-6 |
| RA-P0-07 | Does the agent's push of history including `.github/workflows/` pass the session proxy and trigger `deploy.yml`? | The first deploy depends on it. | First push procedure | Push the prepared history once the repo is attached. Pass: a Deploy run starts. | AG | R1-7 |
| RA-P0-08 | Is Microsoft Defender for Storage off at subscription level, and is the 100 GB/month free egress still true? | A per-account Defender charge would break the $0 rule. | Cost line in decisions.md | Owner opens Microsoft Defender for Cloud → Environment settings → the subscription → Storage plan. Pass: Off. Agent reads the bandwidth pricing page. | OW + AG | R1-8 |
| RA-P0-09 | Does `az storage blob list --num-results '*'` return every blob? | The prune step deletes stale files based on this list. | Prune step safety | Run on the live account in a read-only step and compare the count with the staged file count. Pass: equal. | CI | R1-10 |
| RA-P0-10 | What does the `<meta>` CSP cover on the live site, and what can't it (no `frame-ancestors`, no reporting)? | Storage hosting sends no headers; the meta tag is the only policy. | [SECURITY.md](../engineering/SECURITY.md) front-end section | Playwright on the live site with a `securitypolicyviolation` listener: inject an inline script and a third-party image. Pass: both blocked; the accepted gaps are listed in SECURITY.md. | CI | R3 §1.3, decisions (Storage consequences) |
| RA-P0-11 | Owner's phone details: navigation mode (3-button or gestures), CSS viewport, `devicePixelRatio`, refresh rate. | The Briefing swipe and edge zones depend on the navigation mode. | [GESTURES.md](../design/GESTURES.md) edge zones; test viewport | Owner: Settings → Display → Navigation bar, reports the mode. A `/diag/` page (no data) shows `innerWidth`, `innerHeight`, `devicePixelRatio`. Pass: values in decisions.md. | OW | R4-1, R3 T13, FC C52/C53, decisions |
| RA-P0-12 | How wide must the edge zones be so right-swipes don't trigger system back or exit? | Accidental exits on the main gesture. | GESTURES.md edge widths (24/32 px guesses) | A gesture test page logs touch start x and outcome; owner swipes 20 times. Pass: zero accidental exits at the chosen width. | OW | R4-2 |
| RA-P0-13 | What do `backdrop-filter` blur layers and the ring cost on the phone's GPU? | Jank on the home screen is the first impression. | Blur radius and layer count in [DESIGN-SYSTEM.md](../design/DESIGN-SYSTEM.md) | DevTools performance trace over USB (or a frame-time overlay on the `/diag/` page) while opening the ring 10 times. Pass: p95 frame ≤ 16.7 ms, or reduce blur. | OW + AG | R4-3, FC C64 |

### P1 · Worker + sign-in

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P1-01 | What is the CPU limit per request for a SQLite Durable Object on the Free plan (10 ms or 30 s), and what does scrypt N=2^15, r=8, p=3 cost at the edge? | If 10 ms, the planned hash overruns about 25× and may fail. | Password-hash parameters and placement; bulk-job chunk sizes | Probe: a DO method burning ~50 ms and `/bench/scrypt` × 20; read `cpuTimeMs` p50/p99 and any error 1102. Pass: decision line with numbers. Fallback: the client-side KDF of [SECURITY.md](../engineering/SECURITY.md) §6.4 (decisions 2026-10-28), never a weaker hash. | PR | R2-1, R2-2, R3 T1, R7 X3, FC A2/C27/C40 |
| RA-P1-02 | Does native scrypt memory count against the 128 MB isolate limit (N=2^16, p=2 ≈ 64 MiB)? | Decides whether parameters can grow later. | Future hash upgrade | Same probe with 2^16/8/2; watch for memory errors or resets. | PR | R3 T2 |
| RA-P1-03 | Are point-in-time-recovery bookmarks available on Free? | The backup design assumes either PITR or weekly exports only. | [OPERATIONS.md](../engineering/OPERATIONS.md) backup and restore | Probe calls `getCurrentBookmark()` and `getBookmarkForTime(now − 1 h)`. Pass: both return bookmarks. | PR | R2-3, R7 X4, FC C28 |
| RA-P1-04 | Can a Worker hold a WebSocket to a hibernating DO and wait ≤ 25 s per request, unbilled on Free, reachable from a Claude cloud session through its proxy? | The mind's listening loop (`/v1/live/wait`) depends on it. | Live-update design vs the 15 s short-poll fallback | Probe: the Worker waits on a DO socket; the DO's GB-s usage is read after 1 h of waits; a session runs `curl` against the wait route 10 times. Pass: DO hibernates between frames and the session sees 25 s responses. | PR + AG | R7 X1, R2-8, FC C29 |
| RA-P1-05 | Does TypeScript 5.9 `checkJs` type-check the frontend's JSDoc that imports types from `shared/contract/*.ts`? | One contract file checked on all sides. | `shared/` format (`.ts` vs `.d.ts`) | A tiny fixture in CI: one JSDoc import with a deliberate type error. Pass: `tsc` fails on it. | CI | R7 X5 |
| RA-P1-06 | Do Workers Logs invocation records include the `Authorization` request header? | Bearer tokens must never sit in logs. | Header redaction rule | Probe sends a dummy token; Actions queries the logs for its first 6 characters. Pass: not found (else redact or turn off invocation logs). | PR | R3 T5 |
| RA-P1-07 | Is `request.cf.country`/`region` present on `workers.dev` on Free? | The device list shows a coarse location for new sign-ins. | Device-list copy in [SIGN-IN.md](../product/SIGN-IN.md) | Probe logs presence (true/false) only. | PR | R3 T11 |
| RA-P1-08 | Is the Rate Limiting binding usable on Free? | Optional pre-filter for sign-in; not relied on. | Sign-in back-off layering | Probe deploy with one `ratelimits` binding. Pass: deploy succeeds and the binding limits. | PR | R2-12, R3 T4, FC §D |
| RA-P1-09 | Does a Cloudflare token with only Workers Scripts: Edit create the Worker and apply DO migrations on the first deploy? | A missing permission fails the first deploy. | Token scope in SETUP.md | First Worker deploy. Pass: success; else add Account Settings: Read and record it. | CI | R1-2 |
| RA-P1-10 | Exact `wrangler` flags: `wrangler rollback --message --yes`, `wrangler types --check`, the `version_metadata` binding name. | Deploy and rollback scripts. | `deploy.yml` Worker job | Read `npx wrangler <cmd> --help` from the pinned version locally. | AG | R1-9, R2-12 |
| RA-P1-11 | Is `npm ci --ignore-scripts` safe once wrangler, workerd and esbuild are dependencies? | Supply-chain hardening vs broken binaries. | CI install flags | CI job with and without the flag. Pass: tests pass with it, or the flag is dropped for the Worker job only. | CI | R1-9 |
| RA-P1-12 | Does Chrome suggest the owner's saved password on other sites under the shared `zNN.web.core.windows.net`? | A stranger's site on the same zone could phish via autofill. | Sign-in copy and the autofill advice in SECURITY.md | Owner saves a dummy credential on the new site, then opens the old site (also a `web.core.windows.net` site) and taps a password field. Pass: record whether it is offered. | OW | R3 T6, FC C44 |
| RA-P1-13 | Does the static website serve `/.well-known/change-password`? | Password managers link to it. | Nice to have in SIGN-IN.md | Upload the file; `curl` it. | CI | R3 T7 |
| RA-P1-14 | Can a read-only token held in Actions query Workers Observability telemetry? | Probes and watchdog numbers need log queries without any credential in a session. | Probe workflow; P4 watchdogs | One query from the probe workflow with a token scoped as narrowly as the API allows. Pass: the query returns; record the scope used. | CI | FE 1c, decisions (no credential in sessions) |
| RA-P1-15 | Does locally measured `rowsWritten` match production billing? | Cost tests guard the 100k rows/day budget. | Trust in cost tests | After a week of traffic, owner reads DO rows written in the dashboard; agent compares with the Worker's own meter. Pass: within 10 %. | OW + AG | R2-11 |
| RA-P1-16 | Do Chrome Android `CloseWatcher`, predictive back and `hasUAVisualTransition` work in the installed app? | Back must close the Briefing, menu and sheets, not exit. | Back handling in GESTURES.md | Feature-detect page plus one back press per overlay on the phone. | OW | R4-8, R4-9, FC §D |
| RA-P1-17 | `launch_handler` and WebAPK name/icon update behaviour. | Re-installs and stale icons after a rename. | Manifest fields | Check `about://webapks` after a manifest change. | OW | R4-11 |
| RA-P1-18 | Status of `<meta name="text-scale">` in stable Chrome. | Big-type support (IDEAS AX4). | Text scaling approach | Agent reads chromestatus.com. | AG | R4-16 |

### P1b · Apps ported as they are

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P1b-01 | Which paths and addresses in each ported app break on the storage website (no SPA fallback; `/dir` serves `index.html` without a redirect, so relative paths resolve wrongly)? | The port may change only what is strictly necessary. | The P1b adjustment list | Stage the five apps to a test prefix; a Playwright smoke per app records every 404 and failed request. Pass: the adjustment list, and zero 404s after it. | CI | decisions (owner: as-is port; Storage consequences) |
| RA-P1b-02 | After the old Worker's one-line allowed-origins change (ask first), do the five apps' calls succeed from the new address, and does the existing export/import carry their phone-local data? | The ported apps use the old Worker until their data moves. | P1b "done when" | Owner opens each app from the ring after importing; the agent compares export and import counts. Pass: no CORS errors; counts match. | OW + AG | decisions (owner: as-is port) |
| RA-P1b-03 | Which entry points (URL parameters, import formats) do the ported apps already accept, so the chat can open a title in Astra or hand a playlist to the Music player without changing the apps? | The owner's examples of chat requests ([BEHAVIOR.md §2.3](../mind/BEHAVIOR.md#23-requests-that-reach-into-the-apps-owner-rulings)) before each app's evolution. | What the mind can do in the apps before P5/P8 | Agent reads each app's source in the old repo and lists them. Pass: a list per app; gaps become evolution items for the owner to agree to. | AG | decisions (owner: chat opens apps) |

### P2 · The daily conversation

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P2-01 | How long from fire to first reply on a cold wake (estimate 20–60 s)? | Sets the pre-warm design and honest copy. | Pre-warm budget; "thinking" copy; SLO cold p90 < 90 s | 10 fires at different hours; log fire → claim → first post. Pass: p50/p90 in decisions.md. | AG + OW | R5-1 |
| RA-P2-02 | How long can a listening session live (4 h observed)? | Ceiling for the idle cutoff. | Idle cutoff | Hold one session 8–12 h with 50-min waits. | AG | R5-2, FE 7c, PL |
| RA-P2-03 | How does plan usage meter cache reads (the cost of an idle turn vs a cold wake)? | Decides the 2 h idle cutoff. | Idle cutoff | Owner reads `/usage` % before and after (a) 10 idle 50-min turns, (b) 3 cold wakes. | OW + AG | R5-3 |
| RA-P2-04 | How many cloud sessions can run at once on an individual Max plan? | Chat must not fail while the night shift runs. | Night/chat overlap rules | Fire chat while night runs; then fire both tasks plus one more. | AG | R5-4 |
| RA-P2-05 | Can Projects "continue a thread" for API-fired runs? | Could replace part of the wake loop. | Wake-loop design | One project task with an API trigger, fired twice. | AG | R5-5 |
| RA-P2-06 | Do `SessionStart` and `Stop` hooks from the repo's `.claude/settings.json` run in scheduled runs, and can `Stop` block? | The briefing and "finish what you start" rely on them. | [RUNTIME.md](../mind/RUNTIME.md) hooks | A minimal hook test task. Pass: both fire; a block is honoured and bounded. | AG | R5-6 |
| RA-P2-07 | Is there a supported way for a session to read its own 5-hour and weekly usage? | Lets the mind throttle itself (IDEAS SY3). | Usage-aware night shift | Check the statusline `rate_limits` fields in a cloud session. | AG | R5-13, ID SY3 |
| RA-P2-08 | Does idle compaction fire on long listening sessions, and does the SessionStart re-brief cover it? | Continuity within a long day. | Session discipline | Observe during RA-P2-02. | AG | R5-12 |
| RA-P2-09 | Does the phone's WebSocket to `workers.dev` survive backgrounding and resume cleanly on the phone? | Chat must feel instant after switching apps. | Reconnect policy in [API.md](../engineering/API.md) | Device test: background 5 min, return, send. Pass: reconnect < 2 s and no lost message. | OW | R2-8 |
| RA-P2-10 | Does `interactive-widget=resizes-content` keep the ask bar above the keyboard, and does a dynamic `theme-color` apply in the installed app? | The ask bar is the main control. | Viewport meta; theme switching | Device test in both themes. | OW | R4-10 |
| RA-P2-11 | How many rows does an FTS5 insert write (shadow tables, per message)? | FTS can eat the 100k rows/day budget. | Indexing strategy (per message vs batched) | Local workerd cost test inserting 100 messages. Pass: rows per message recorded; budget check added. | CI | R2-5, R5-9, FC C24 |
| RA-P2-12 | Quality and neuron cost of Workers AI provisional thread titles. | Titles show in the menu every day. | Title model choice | 20 synthetic threads through the title route; compare with hand titles; read neurons. Pass: ≥ 16/20 acceptable, ≤ 5 neurons each. | AG | R5 §4 |

### P3 · Import + memory v1

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P3-01 | Does the day roll's API fire start the night task reliably, and does the 06:07 fallback exit at once when the work is done? | Ordering bug fix between roll and night shift. | Night scheduling | Fire night from a test roll; let the fallback run the same day. Pass: one day note, one clean exit. | AG | R7 X6 |
| RA-P3-02 | Which old datasets matter enough to import (owner list), and do counts plus 20 spot checks match? | Import scope and proof. | Import plan in [MIGRATION.md](../engineering/MIGRATION.md) | The import test itself; the scope is an owner decision (STATUS owner questions). | AG + OW | PL §17, R7 §6 P3 |
| RA-P3-03 | Do the night shift's fact candidates pass the provenance rule on real days (no `source=user` without owner-origin evidence)? | Taint is the main memory safety rule. | Turning on automatic fact writes | Run 3 nights in "propose only" mode; the Worker logs refusals. Pass: 0 provenance violations accepted. | AG | R5 §5.2 |
| RA-P3-04 | Is the memory probe set (≥ 85 % target) reachable with briefing plus FTS only, before embeddings? | Decides how urgent embeddings are. | P8 embeddings priority | Run the 40 probes weekly from P3. | AG | R5 §6 |
| RA-P3-05 | Is there a licence-clean frequency list for the second language (lemmas, ≥ 5,000) for gloss bands? | Second-language mode's gloss bands need it; GPL/NC data is banned. | IDEAS SL1 | Agent searches for lists under CC BY / CC0 / MIT and checks the licence text. Pass: one list named with licence, or bands computed from a public-domain corpus. | AG | ID SL1 |
| RA-P3-06 | Does the owner's phone have an offline second-language `speechSynthesis` voice? | "Hear it" works offline only if so. | IDEAS SL3 | A `/diag/` button lists `speechSynthesis.getVoices()` for the second language's code (a private setting) and speaks one word in airplane mode. | OW | ID SL3 |
| RA-P3-07 | Does Workers AI MeloTTS support the second language, and at what quality? | Fallback voice for SL3. | SL3 fallback | Agent reads the model page; one call through the Worker in a dev route. | AG | ID SL3 |

### P4 · Safety, ops, switch-over

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P4-01 | Are R2 bucket locks (retention rules) available at no cost on this account, so `native/audio/` in the music bucket can be locked? | The music has one copy; a bug could delete it. | Music-bucket protection in OPERATIONS.md | Agent reads R2 bucket-lock docs and pricing; owner checks the bucket's Settings for "Bucket lock rules". Locking is an `access` change: ask first. | AG + OW | R7 §4.5 |
| RA-P4-02 | Does the bounded Stop hook always let a session end at day close or a usage limit? | A blocking hook can loop and burn usage. | Turning the Stop hook on in production | `node --test` cases for N blocks, day-closed and usage-limited states. | CI | R7 §4.10 |
| RA-P4-03 | Does a restore from the weekly per-table export into a scratch `Core` reproduce counts? | Backups that were never restored aren't backups. | Restore drill in OPERATIONS.md | CI round trip on fixtures; monthly drill in production comparing counts only. | CI + AG | R7 §4.4 |

### P5 · Evolve Music

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P5-01 | Do presigned R2 GETs with `Range` work from the site origin on the phone for `<audio>` seeking and Web Audio (`crossOrigin="anonymous"`), with hour-floored signing still valid? | Media design depends on it. | [MUSIC.md](../product/apps/MUSIC.md) playback; bucket CORS (ask first) | After CORS is set on a test prefix: play and seek a test file on the phone. Pass: seek works, no CORS errors, link valid ≥ 2 h. | AG + OW | R2-6, R3 T16 |
| RA-P5-02 | Is public access to the music bucket off (no `r2.dev` link, the old Worker's public-read flag)? | Music privacy. | Owner question on music privacy | Owner opens the bucket's Settings → Public access. **Answered 2026-10-30:** the `r2.dev` link is off (read through the read-only token: managed domain `enabled: false`); the old Worker's public-read flag goes with the old Worker. | OW | R2-7, R3 T14, FC C48, R7 Q4 |
| RA-P5-03 | Does audio through the Web Audio graph keep playing with the screen locked in the installed app for 30+ minutes? | The player's core promise. | The as-is player on the new site (P1b) and any engine change in P5 | Soak test: lock the phone, 30 min of playback. | OW | R4-4 |
| RA-P5-04 | Do OPFS `File` blob URLs play through `MediaElementAudioSourceNode`? | Offline audio (and IDEAS OF1). | Offline playback design | Spike page with a test file. | AG + OW | R4-5, FC C61 |
| RA-P5-05 | Real size and track count of the music bucket (about 35–45 GB, about 7.5k + 1.3k tracks?). | Cost estimate and analysis job count. | Analysis shards; cost line | Owner reads the bucket's size and object count in the dashboard. | OW | FC A4, FC §D |
| RA-P5-06 | Per-track CPU time of feature analysis on a runner. | Sets the shard count for the first full analysis. | `jobs-audio.yml` matrix | Benchmark 50 tracks addressed by `sha256` only. | CI | FE risks |
| RA-P5-07 | Are offline audio tags (mood, genre, instrument, in English and the second language) good enough across the genres in the library, including solo acoustic guitar? | "Similar vibe" results and search aliases. | Tier-2 search; DJ features | The mind shows the owner 20 tagged tracks privately; the owner marks each tag set right or wrong. Pass: ≥ 15/20 right. | AG + OW | FE risks, PL §16.5 |
| RA-P5-08 | Is `persist()` granted automatically to the installed app, and what is the real storage quota? | Offline caches and packs (IDEAS OF1). | Cache caps | `/diag/` shows `navigator.storage.persisted()` and `estimate()`. | OW | R4-6 |
| RA-P5-09 | Can the sung language of each track be identified cheaply (for IDEAS MU8)? | Second-language hour needs a language tag. | MU8 | Run an open-source (MIT) Whisper language-ID on a 30 s clip of 50 tracks in Actions by `sha256`; compare with owner-known languages for 20. Pass: ≥ 18/20. | CI + OW | ID MU8 |
| RA-P5-11 | Can R2 API tokens be limited to a prefix, or only to a bucket? | Actions writes only to the jobs bucket. | The three-bucket split (decided); token scope wording | Owner opens R2 → Manage API tokens → Create and reads the scope options. | OW | R3 T15 |

### P6 · Evolve Guitar

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P6-01 | What are the phone's microphone input latency and jitter (round-trip loopback)? | Timing feedback needs ±10 ms resolution. | Calibration screen; feedback thresholds | Loopback calibration: the phone speaker clicks into its own mic 20 times. Pass: latency mean and SD recorded. | OW | PL §16.7, FE risks |
| RA-P6-02 | Are `echoCancellation`, `noiseSuppression` and `autoGainControl` actually turned off when requested? | Forced processing smears onsets. | Ears pipeline | Read `track.getSettings()` after requesting all three false. | OW | FE risks |
| RA-P6-03 | How accurate is onset detection on nylon strings (false onsets on rasgueado and golpe; octave errors)? | Bad ears teach wrong lessons. | Ears thresholds; which feedback is shown | Owner records 5 takes with ears on and taps the beat; the mind compares privately. Pass: onset error p90 ≤ 20 ms. | OW + AG | FE risks |
| RA-P6-04 | Can the after-take polyphonic report (Basic Pitch) run on the phone without `SharedArrayBuffer` (no COOP/COEP headers on a Storage static website)? | The hosting ruling removes threads. | Report on phone vs in the mind's session | Benchmark a 30 s synthetic take single-threaded on the phone. Pass: ≤ 20 s, else run it in the session. | OW + AG | R4 (D correction 9), R7 §2.1, decisions (Storage) |
| RA-P6-05 | Licence of alphaTab's SoundFont. | Licence rule. | Bundling playback sounds | Read the SoundFont's licence file. | AG | R4-14 |
| RA-P6-06 | Does `ts-fsrs` 5.x load as a vendored ES module with no build step? | The review engine (IDEAS LN1) must fit the no-build frontend. | LN1 | Vendor the package's ESM build into a test page and run its scheduler in Chromium. | CI | ID LN1 |
| RA-P6-07 | Do Bluetooth page-turner pedals send standard key events to Chrome on Android? | Hands-free practice controls (IDEAS GT4). | GT4 | Owner pairs a pedal (only if they already own one) and presses it on a `/diag/` key logger. | OW | ID GT4 |
| RA-P6-08 | The current piece's tempo unit (is the target in eighths or quarters?) and key, from the owner's own tab. | The ladder's target is meaningless if the unit is wrong. | Target tempo per section | Owner checks the tab header once. | OW | FE (guitar unverified) |
| RA-P6-09 | Do the practice-loop heuristics (70–80 % band, +4/−4 steps) produce a steady climb for the owner? | They are heuristics, not published guitar norms. | Tuning in GUITAR.md | Weekly review of ceiling curves for 4 weeks; if flat for 14 days, try one change (or an n-of-1, IDEAS RE6). | AG | FE §4, ID GT1 |

### P7 · Study

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P7-01 | Which deep-link formats of the official site and app work on the phone beyond the three confirmed? | Scripture text comes from the owner's private copies (decisions.md); talks and other material are cited by paragraph and linked out, so the links must open at the right place. | Reference links in [STUDY.md](../product/apps/STUDY.md) | A private test page with 10 candidate links; owner taps each. Pass: ≥ 9/10 open at the target paragraph or verse. | OW | FE study |
| RA-P7-02 | OCR time and accuracy on the owner's scanned pages. | Ingestion plan for scanned books. | Ingestion in the mind's session | Run OCR on 20 pages of one book in a session. Pass: time per page and character accuracy on 2 hand-checked pages. | AG | FE study |
| RA-P7-03 | Licences of pypdf, pdfplumber, poppler and ocrmypdf for in-session use. | Session-only tools may be copyleft only if never shipped. | Tool choice | Read each licence. | AG | FE study |
| RA-P7-04 | Memory and bandwidth of pdf.js on a 1,000-page PDF on the phone. | Big books must open without a crash. | Reader paging and OPFS caching | Open a public-domain 1,000-page PDF over presigned URLs; record memory and bytes. | OW + AG | FE study |
| RA-P7-05 | Do Trusted Types work with pdf.js and our components? | XSS hardening once pdf.js arrives. | Enabling Trusted Types | A test page with a `securitypolicyviolation` listener (meta CSP can't report-only). | CI | R3 T8, R7 §3 |
| RA-P7-06 | Precision and recall of the reference parser on real pages (names that are also book names). | Wrong references mislead study. | Parser release | Run on 50 real pages in a session against hand labels. Pass: precision ≥ 99 %, recall ≥ 95 %. | AG | FE study, PL §16.9 |

### P8 · Briefing data; evolve Astra, Podcasts, My Media; reach

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P8-01 | Are pushes delivered under Samsung battery optimisation after hours idle? | A decision push that arrives late is worse than none. | Push reliability claims; budget | Owner leaves the phone idle 4 h; agent sends 3 test pushes; owner reports arrival times. | OW + AG | R4-7, FE 2d |
| RA-P8-02 | What CPU does push encryption plus VAPID signing cost per message in the Worker? | Fits the 10 ms CPU budget or not. | Push fan-out size | Probe sends 5 pushes; read `cpuTimeMs`. | PR | FE 2b, PL §16 |
| RA-P8-03 | Accuracy and latency of the Workers AI router (`qwen3-30b-a3b-fp8`, JSON) on 100 labelled utterances (EN/ES), and `bge-m3` ES↔EN recall on 10 probes. | The instant tier must be ≥ 95 % before it routes. | Turning on the router and embeddings | A Worker eval route runs the synthetic set; the session reads the scores. | AG | R5-8 |
| RA-P8-04 | Does Web Share Target work in the installed app on the phone (text, link, image)? | IDEAS HM3; review "share target". | Share target | Add `share_target` to the manifest; share from 3 apps. | OW | ID HM3, R7 §3 |
| RA-P8-05 | Does Background Fetch continue a pack download after the app closes on Chrome Android? | IDEAS OF1 packs. | Pack resumability | A test pack of 100 MB; close the app; check completion. | OW | ID OF1 |
| RA-P8-06 | Brute-force cosine over ≤ 10k vectors (256–1,024 dims) inside a DO on Free CPU. | Memory recall without Vectorize. | Embedding dimensions | Probe with synthetic vectors; read `cpuTimeMs`. | PR | R5-9 |
| RA-P8-07 | Whisper quality and real neuron cost on second-language speech (podcasts, voice memos). | IDEAS SL4/SL5 and voice notes. | Transcripts on demand | Transcribe 5 public-domain second-language clips through a dev route; read neurons. | AG | ID SL4, R5 §4 |

### P9 · The meter + self-improvement

| ID | Question | Why it matters | Gates | Cheapest test | Who | From |
|---|---|---|---|---|---|---|
| RA-P9-01 | Is Brier skill against a 28-day base rate stable enough at 30 resolved predictions per category? | No published work uses Brier for personal user models; the meter could mislead. | Showing the meter | Simulate on 60 days of synthetic events; measure the spread of the skill score at n = 30. | CI | Research notes §2.4, R5 §6 |
| RA-P9-02 | Can the weekly self-improvement PR game its own evals (objective hacking)? | The evaluator must sit outside the agent's write path. | Weekly PRs | Red-team fixture: a PR that edits an eval and a feature together; the eval-diff report must flag the eval change. **Answered (P9):** `tests/eval-diff.test.mjs` flags it, and CI checks the PR's numbers against the Worker's record rather than trusting its text; the record itself is still written by the mind's sessions (`PUT /v1/evals/runs`), so a session that lies to the record is the remaining gap, watched by the owner's spot-checks. | CI | Research notes §4.3 |
| RA-P9-03 | Does a ruleset with an empty bypass list block owner-identity merges from a session, and can a `pull_request_target` check serve as a required status check? | The deferred `guard` gate. | Building `guard` (deferred) | A test repository with a dummy protected file. | AG | R5-7, FC A6, FC §D |
| RA-P9-04 | For n-of-1 experiments at 7 per arm, is the 80 % bootstrap rule right, or a permutation test? | IDEAS RE6 verdicts. | RE6 verdict rule | CI simulation comparing both rules' false-positive and detection rates. | CI | ID RE6 |

### Later, only if something changes

| ID | Question | Only if | From |
|---|---|---|---|
| RA-L-01 | Does a non-extractable `CryptoKey` survive in IndexedDB across reboot in the installed app? | Device-bound request proofs come back (deferred). | R3 T9 |
| RA-L-02 | Safari's 7-day storage cap for non-installed sites; iOS back-gesture and storage policy. | The owner ever uses an Apple device. | R3 T10, R4-15 |
| RA-L-03 | The $100/month API credit's account state and a Console org that hard-stops at zero; model IDs and first-token latency from a Worker. | The owner asks for the fast lane (currently not used). | R5-10, R5-11, FC C1 |
| RA-L-04 | Request-quota exhaustion on `workers.dev` by a stranger. | It happens (watched in §4); a custom domain with a WAF rule would cost money (ask first). | R2-13, R7 Q8 |

### Closed by decisions (kept for the record)

| Question | Closed by |
|---|---|
| Static Web Apps headers, fallback and compression (R7 X2, R3 T12, FC A7) and how SWA deploys authenticate (FC §D) | Owner ruling 2026-10-28: Azure Storage static website; SWA ruled out. |
| Azure federated subject format (FC A3, R1/R3 contradiction) | decisions.md: ID-based subject with `ref:refs/heads/main`, no environment. |
| `deploy.sh` fallback account name (FC A5) | decisions.md: the deploy script refuses any account not named `thunderhead*`. |
| Required checks vs direct pushes (FC A6) | decisions.md: direct fast-forward to `main` after CI; `guard` deferred (RA-P9-03 before it is built). |
| TypeScript 7.0 compatibility (R2-9) | decisions.md: pin TypeScript 5.9.x. |
| The `exports` DO declaration (R2-4) | decisions.md: classic `migrations` array. |
| Per-object storage on Free, 1 GB vs 10 GB (FE 3b, R2-10) | Confirmed 1 GB on Free (FC C25); watched in §4 (alert at 700 MB). |
| Production PBKDF2 cap (R3 T3) | Not needed: PBKDF2 was rejected. |
| Fraunces and Inter Reserved Font Names (R4-13) | FC C56: neither declares one. |
| Chrome's preflight cache cap of 7,200 s (R4-17) | FC C62: confirmed. |
| Turnstile plan details (FC §D) | Cut for v1 (decisions deferred list). |
| libmedia's FFmpeg licence (R4-14, first half) | decisions.md 2026-10-28 (owner): libmedia stays in Astra (owner has permission); it is built with `--enable-gpl`, recorded as a named exception. AutoEq data is MIT (FC C55). |
| Songsterr's terms as Guitar's tab source | decisions.md 2026-10-28 (owner): written permission for this project; not re-raised. |
| Port the existing apps as they are, or rebuild them first | decisions.md 2026-10-28 (owner): ported as they are (ROADMAP P1b); later changes only with the owner's agreement. |
| Where scripture text comes from | decisions.md 2026-10-27 (owner): the owner's own licensed copies, stored privately in `thunderhead-private`; talks cited by paragraph and linked (RA-P7-01 covers only the links). |
| Old feasibility "read-only observability token in a session" (FE 1c) | decisions.md: no Cloudflare credential in sessions; replaced by RA-P1-14 (token in Actions). |

**Acceptance (for §2).** Every item in the source lists (R1 §5 items 1–10, R2 §10 items 1–13, R3 T1–T16, R4 §9 items 1–17 (R4-14 is split between RA-P6-05 and the closed libmedia row), R5 §11 items 1–13, R7 X1–X6, FC §D) appears in a "From" cell or in "Closed by decisions". A reviewer can tick them off in one pass.

---

## 3. The owner's checklist, by phase [proposal]

The owner tasks above, grouped so they can be done in one sitting each. Each is ≤ 5 minutes; the agent sends exact steps in the conversation when the phase starts.

| Phase | Owner tasks |
|---|---|
| P0 | RA-P0-01 portal labels · RA-P0-05 rulesets · RA-P0-08 Defender off · RA-P0-11 navigation mode + `/diag/` · RA-P0-12 20 swipes · RA-P0-13 ring trace |
| P1 | RA-P1-12 password suggestion check · RA-P1-15 rows written (after a week) · RA-P1-16 back presses · RA-P1-17 `about://webapks` |
| P1b | RA-P1b-02 open each ported app after the import |
| P2 | RA-P2-01 / RA-P2-03 `/usage` readings · RA-P2-09 background and return · RA-P2-10 keyboard and theme |
| P3 | RA-P3-02 import scope · RA-P3-06 second-language voice |
| P4 | RA-P4-01 bucket lock settings |
| P5 | RA-P5-01 seek test · RA-P5-02 public access · RA-P5-03 30-min lock soak · RA-P5-04 offline playback spike · RA-P5-05 bucket size · RA-P5-07 rate 20 tag sets · RA-P5-08 storage `/diag/` · RA-P5-09 confirm 20 song languages · RA-P5-11 token scope options |
| P6 | RA-P6-01 loopback · RA-P6-02 mic settings · RA-P6-03 5 takes · RA-P6-04 benchmark · RA-P6-07 pedal (if owned) · RA-P6-08 tab header |
| P7 | RA-P7-01 10 links · RA-P7-04 big PDF |
| P8 | RA-P8-01 idle pushes · RA-P8-04 share from 3 apps · RA-P8-05 background pack |

**Acceptance.** Every OW row in §2 appears here exactly once per phase.

---

## 4. Recurring research cadence [proposal]

The facts under the project (free-tier limits, prices, deprecations, licences) change. The mind re-checks them on a fixed rhythm inside its Sunday night review and stays silent unless something changed.

### 4.1 Rules

1. **Weekly** checks use only the Worker's own numbers (no web reads).
2. **Monthly** checks run in the first Sunday night review of each month, through the **quarantined reader** (outside pages are untrusted). Budget: ≤ 20 page reads and ≤ 15 minutes.
3. Each check writes a `platform_watch` row: `{item, url, page_date, values_json, changed, note, checked_at}`. Values are numbers and short strings only.
4. **If nothing changed:** nothing is said.
5. **If something changed:** the mind opens a mind-owned open thread, opens a PR adding a proposed decisions.md line (date · change · source), and posts **one Briefing-page line** only if the change affects cost, privacy, or a feature in use. Config never changes from web text alone (taint rule); a change ships only through the normal build-and-test path.
6. A check that fails to read its page twice in a row is reported as "couldn't verify" on the Health page (IDEAS SY2), never as "unchanged".

**Acceptance.** A fixture page with a changed number produces exactly one open thread, one PR and (for a cost item) one Briefing line; an unchanged fixture produces nothing; two failed reads produce "couldn't verify".

### 4.2 Weekly (every Sunday night, numbers from the Worker)

| Check | Threshold that speaks |
|---|---|
| Peak daily Worker requests, DO rows written, DO GB-s, Workers AI neurons | Any above 70 % of the free daily limit on any day |
| Largest DO `databaseSize` | ≥ 700 MB (Free limit 1 GB per object) |
| Newest backup age; last restore drill | Backup ≥ 8 days old; drill ≥ 35 days old |
| SLOs: 5xx rate, warm/cold reply p90, unclaimed wakes, night shift done by 09:00 | Any SLO missed in the week |
| Mind usage share (owner reads `/usage` until RA-P2-07 gives a readout) | Mind share ≥ 50 % of the weekly limit |
| Kept / undone / ignored arrangements (from P5) | Undo rate ≥ 20 % in any domain |

### 4.3 Monthly (first Sunday): the platform watch list

Values as read on 2026-10-28. A "changed" result compares against the last recorded row.

| # | Item | Source | Values to compare |
|---|---|---|---|
| 1 | Workers Free limits | https://developers.cloudflare.com/workers/platform/limits/ | 100k requests/day; 10 ms CPU; 128 MB; 50 subrequests; 5 cron triggers |
| 2 | Durable Objects Free | https://developers.cloudflare.com/durable-objects/platform/pricing/ and /limits/ | 100k requests, 13,000 GB-s, 5M rows read, 100k rows written per day; 5 GB total; 1 GB per object; the CPU-limit wording (RA-P1-01) |
| 3 | R2 | https://developers.cloudflare.com/r2/pricing/ | 10 GB-month, 1M Class A, 10M Class B free; $0.015/GB-month; free egress; presigned 1 s–7 days |
| 4 | Workers AI | https://developers.cloudflare.com/workers-ai/platform/pricing/ and the models list | 10,000 neurons/day; rates for the models in use (qwen3-30b 4,625/30,475 per M; granite micro 1,542/10,158; bge-m3 1,075; Whisper turbo 46.63/min; MeloTTS 18.63/min); deprecation notices for those models |
| 5 | Workers Logs / Observability | https://developers.cloudflare.com/observability/pricing/ | From 2026-12-01: 0.5 GB/day, 7-day retention on Free |
| 6 | Claude Code scheduled tasks | https://code.claude.com/docs/en/routines | Hourly minimum; 30 fires/h per task; 100/h per account; beta header `experimental-cc-routine-2026-04-01`; "research preview" status; fired prompt never approval |
| 7 | Claude Code hooks, cloud sessions, caching | https://code.claude.com/docs/en/hooks, /cloud-environments, /tools-reference, /prompt-caching | SessionStart 10,000-character cap; background 30 min / 2 h; Monitor 30 min; VM 4 vCPU / 16 GB / 30 GB; 1 h cache TTL on the plan |
| 8 | Plan usage rules | https://support.claude.com/en/articles/11145838 | 5-hour plus weekly limits; scheduled-task threads stop at the limit. **Owner task, monthly:** confirm usage credits are still OFF (claude.ai/settings/usage). |
| 9 | GitHub Actions for public repos | GitHub billing and limits docs; changelog | Free standard runners; 6 h per job; the Node runtime for JavaScript actions; OIDC subject format; workflow lockfiles status |
| 10 | Pinned actions | `git ls-remote` of each pinned action | Each pinned SHA still matches its tag; no security advisory |
| 11 | Azure Storage static website and egress | Azure Storage static website docs; bandwidth pricing | No new header support (if it appears, revisit decisions); 100 GB/month free egress |
| 12 | Entra flexible federated credentials | https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-flexible-federated-identity-credentials | Preview vs GA; any change to GitHub claim matching |
| 13 | Chrome on Android | Chrome release notes; chromestatus.com | Stable version; status of features in use (Navigation API, View Transitions, OPFS, Web Push, Share Target, Background Fetch, CloseWatcher, `text-scale`) |
| 14 | Public Suffix List | https://publicsuffix.org/list/public_suffix_list.dat | `workers.dev`, `web.core.windows.net`, `r2.dev` still listed |
| 15 | Licences of dependencies | npm registry metadata; vendored `LICENSE` files and recorded sha256 | No dependency moved to GPL, AGPL or non-commercial terms, apart from the named exception libmedia in Astra (owner ruling) (pdf.js Apache-2.0, alphaTab MPL-2.0, uFuzzy MIT, ts-fsrs MIT, Phosphor MIT, Fraunces/Inter OFL, axe-core MPL-2.0, hono MIT, zod MIT) |
| 16 | Tool versions | npm registry | wrangler, `@cloudflare/vitest-plugin`, TypeScript 5.9.x line, Playwright; Node LTS schedule |
| 17 | Terms of the official site for talks and other material | The site's terms of use | Cite and link out; no scraping (unchanged) |

### 4.4 Quarterly

| Check | Who | Output |
|---|---|---|
| Licence audit of the whole tree (`npm ls` licences, every vendored file's licence and sha256) | AG | Pass, or a PR removing the offender |
| Literature scan, 1 hour: agent memory, sycophancy, proactive and calm AI, learning science | AG | ≤ 5 lines added to IDEAS.md sources or a decisions line if a design assumption changed |
| IDEAS.md rescore: update value and risk from kept/undone data and owner feedback | AG | Updated tables; the top 10 re-ranked |
| Device check: Chrome version on the phone, installed-app status, storage quota | OW | Values in decisions.md if changed |

### 4.5 Yearly and dated

| When | What |
|---|---|
| Yearly | Rotation note for the Cloudflare deploy token (no expiry; rotate on suspicion or yearly per OPERATIONS.md); full restore drill; privacy audit of the repo history (secret scanning, search for personal terms); confirm the phone of record. |
| 2026-12-01 | Workers Logs on Free move to Observability pricing (0.5 GB/day, 7 days). Check that ingestion stays under the cap. |
| 2027-04-30 | Node 22 end of life. CI must be on Node 24 or 26 before this date. |
| 2028-04-30 | Node 24 end of life. |
| When GA | Claude Code scheduled tasks leave research preview: re-read the whole page (caps, headers, billing). |

**Acceptance (for §4).** A fake-clock test of the weekly and monthly scheduler runs each tier at the right time; the dated items appear as open threads 30 days before their date.

---

## 5. Open questions about this agenda

| Question | How to settle |
|---|---|
| Does the owner accept a throwaway probe Worker for the edge benchmarks? | Owner yes/no; without it, P1 measurements go into the real `thunderhead-api` behind a disabled-by-default route. |
| Is a CI-held observability token acceptable (RA-P1-14), given the rule that no credential enters a session? | Owner yes/no; it stays in Actions only, like the deploy token. |
| Should the monthly watch read pages directly or through a cached copy in R2 to diff exact wording? | Try direct reads for two months; switch to stored copies if diffs are noisy. |

## Sources

- Research reports 1–7 in the scratchpad (`research/1-setup-and-pipeline.md` §5, `2-backend.md` §10, `3-auth-security.md` §6, `4-frontend-pwa.md` §9, `5-mind.md` §11, `6-factcheck.md` §A/§D, `7-architecture-review.md` §4/§7/§8), the feasibility research, and the plan §16–§17. These are not in the repository; their items are carried here in full.
- [decisions.md](decisions.md) and [ROADMAP.md](ROADMAP.md) for phases and closed questions.
- Workers AI pricing (read 2026-10-28) for the MeloTTS and Whisper rates.
