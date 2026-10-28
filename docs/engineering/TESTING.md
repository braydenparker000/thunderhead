# Testing

This page fixes how the Thunderhead is tested: which layers exist, what each one proves, where it runs (laptop, CI push, deploy, live, mind session, the real phone), how to run it, and the rules for fixtures in a public repo.
A change is done when its tests pass in all the places this page lists for it. Behaviour specs in the other docs each end in an acceptance check; this page says where those checks live.
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **One command:** `npm test` at the repo root runs every offline layer. CI runs the same command. Nobody needs to remember a second one.
2. **Tests run on real runtimes:** the backend in real workerd with real SQLite Durable Objects (Vitest + `@cloudflare/vitest-plugin`), and the frontend in real Chromium (Playwright) against a local server that behaves like Azure. No hand-rolled fake storage.
3. **Phone size is the default size.** Browser tests run at the Galaxy A15's size, plus 390×844 and 360×740.
4. **Every endpoint has a cost test** that pins rows read, rows written and DO calls.
5. **Live checks are read-only.** They never send a message, write a row or sign in.
6. **Fixtures are synthetic.** No real names, places, messages, songs, notes, scripture text or dates tied to the owner. The repo is public.
7. **Evals with personal data run only inside mind sessions**, never in Actions.
8. **A flaky test is a bug.** It is fixed or deleted within a day, never retried into green (the one built-in exception is the live check's single retry, which covers network blips).
9. **A release that touches gestures, audio or the service worker isn't done** until the real-device checklist passes on the A15.

---

## 1. Layers

| # | Layer | Tool | Proves | Folder | Phase |
|---|---|---|---|---|---|
| 1 | Static | `node --test` | Links resolve by root-absolute paths; no outside hosts in new code; the CSP is first on every page and identical on shell and new pages; no inline script, style or handlers in new code; ported folders equal the old copies plus listed adjustments, with only their allowlisted hosts; no credentials in the repo; licences of vendored files | `tests/site.test.mjs`, `tests/repo.test.mjs`, `tests/ported.test.mjs` | P0 (exists); ported checks P1b |
| 2 | Lint + types | Biome 2.6, `tsc --noEmit` (TypeScript 5.9) | Style; types across `backend/`, `shared/`, `mind/` and the frontend's JSDoc | root | P1 |
| 3 | Frontend unit | `node --test` | Pure modules: outbox policy, router parsing, ref parser, token contrast, budgets, version compare, logical day | `tests/unit/` | P1 |
| 4 | Backend | Vitest 4.1 + `@cloudflare/vitest-plugin` (workerd) | Routes, scopes, stores, DO RPC, alarms, WebSockets, rules (taint, proposals) | `backend/tests/{unit,integration}/` | P1 |
| 5 | Cost | same | Rows read/written and DO calls per endpoint | `backend/tests/cost/` | P1 |
| 6 | Migration | same | Empty → current schema matches the snapshot; N-1 data survives; expand-only lint | `backend/tests/migrations/` | P1 |
| 7 | Import | same | Counts, spot checks, idempotent re-run | `backend/tests/import/` | P3 |
| 8 | Restore round trip | same | Export → import into a fresh DO → deep-equal | `backend/tests/restore/` | P1 |
| 9 | Mind CLI and hooks | `node --test` | `th` argument parsing, exit codes, the bounded Stop hook, the briefing size cap | `mind/tests/` | P2 |
| 10 | Browser | `@playwright/test` + Chromium | Gestures, overlays, sign-in UI, offline, SW update, mount/unmount hygiene, a11y (axe), no console or CSP errors | `tests/browser/` | P0 (bare `playwright` today) |
| 11 | End-to-end local | Playwright against `wrangler dev` + `scripts/serve.mjs` | The real site talking to a real local Worker, no API mocks | `tests/e2e/` | P2 |
| 12 | Live read-only | `node --test`, Playwright | The deployed site and API: release, CSP, 404, content types, health, CORS, 401s | `tests/live*.test.mjs` | P0 (site), P1 (API) |
| 13 | Evals | mind harness | Memory probes, injection fixtures, router accuracy | `mind/evals/` (harness + synthetic fixtures) | P3 |
| 14 | Real device | checklist on the Galaxy A15 | What labs can't: touch edges, audio with the screen locked, install, push | §12.2 | P1 |

---

## 2. What runs where

| Layer | Laptop / session (`npm test`) | CI on push to non-`main` (`ci.yml`) | Deploy, before publish | Deploy, after publish | Mind session | Owner's phone |
|---|---|---|---|---|---|---|
| 1 Static | ✓ | ✓ | ✓ | — | — | — |
| 2 Lint + types | ✓ | ✓ | ✓ | — | — | — |
| 3 Frontend unit | ✓ | ✓ | ✓ | — | — | — |
| 4–8 Backend, cost, migration, import, restore | ✓ | ✓ | ✓ | — | — | — |
| 9 Mind CLI/hooks | ✓ | ✓ | ✓ | — | — | — |
| 10 Browser | ✓ | ✓ | ✓ | ✓ (read-only subset against `SITE_URL`) | — | — |
| 11 E2E local | ✓ (`npm run test:e2e`) | ✓ | ✓ | — | — | — |
| 12 Live | — | — | — | ✓ | on demand | — |
| 13 Evals | — | synthetic, deterministic parts only | — | — | ✓ (Sundays, `mind-night`) | — |
| 14 Device | — | — | — | — | — | ✓ per §12.2 |

Time budget: `npm test` ≤ 3 min on a 4-vCPU runner **[proposal]**. A layer that grows past its share (browser ≤ 90 s, backend ≤ 60 s) gets split or trimmed. CI's job timeout is 10 minutes.

---

## 3. How to run

```sh
npm ci                                   # once
npx playwright install chromium          # once per machine
npm test                                 # every offline layer (today: node --test tests/*.test.mjs)
npm run test:site                        # layers 1, 3, 10: node --test tests/*.test.mjs
npm run test:backend                     # layers 2, 4–8: tsc, biome, wrangler types --check, vitest on workerd
npm run test:mind                        # layer 9: node --test mind/tests/   [proposal: script name]
npm run test:browser                     # layer 10 against scripts/serve.mjs
npm run test:e2e                         # layer 11: wrangler dev + serve.mjs + Playwright
SITE_URL=https://<site> node --test tests/live.test.mjs tests/home-browser.test.mjs   # layer 12, site
WORKER_URL=https://<api> node --test tests/live-api.test.mjs                          # layer 12, API
npx vitest run backend/tests/cost --reporter=verbose                                  # cost table
```

- `CHROMIUM_PATH` overrides the browser binary (used in sandboxes).
- Local `wrangler dev` is seeded from `backend/tests/fixtures/seed.jsonl`. The dev setup code and dev agent token come from `backend/.dev.vars`, which is git-ignored. **Never `wrangler dev --remote`.**

Today `npm test` is `node --test tests/*.test.mjs` (static plus the bare `playwright` browser suite at 390×844). The layers above arrive with P1 under npm workspaces (`"."`, `backend`, `mind`). From P1 it is `node --test tests/*.test.mjs && npm test -w backend` (then `&& npm run test:mind` from P2). Change dependencies only with npm 11 or newer (decisions 2026-10-28).

---

## 4. Static checks (layer 1)

Already in `tests/site.test.mjs`:

| Test | Acceptance |
|---|---|
| Every file a page loads exists, by a root-absolute path | Fails on `src="ui/x.js"` or a missing file |
| No outside hosts in new code | Fails on any `http(s)://` except the SVG namespace, outside the ported folders (they have their own check below) |
| Pages fit the CSP | Fails on inline `<script>`, `<style>` or `on*=` in the shell and new pages |
| CSP is the first tag after charset; on the shell and new pages it equals `ui/csp.txt` | Fails on any drift. Ported pages: first tag after charset, and equal to the CSP recorded for that folder in `ported.json` |
| Home basics | `<title>`, viewport, robots `noindex,nofollow`, referrer `no-referrer` |
| No credentials | Fails on private keys, AWS/GitHub/Slack/OpenAI-style keys, `AccountKey=`, `sig=`, and `th1_`/`thm_`/`ths_` tokens (P1 adds `thc_` and `thfp_` per [SECURITY.md §5.2](SECURITY.md)) |

To add (P1):

| Test | Acceptance |
|---|---|
| `routes.json` stubs | After `stage.mjs`, each shell route has `<route>/index.html` byte-equal to `index.html`; no route in `routes.json` is a ported folder |
| `precache.json` | Lists every staged file except `vendor/`, stubs, ported folders and `/assets/`; sizes match |
| Vendored files | Each `vendor/<lib>-<ver>/` has a LICENSE and its files match the sha256 recorded in `vendor/manifest.json` |
| Licence list | No dependency in `package-lock.json` has a GPL, AGPL or non-commercial licence. Named exception: libmedia under `/assets/libmedia/`, used only by `/astra/` (owner ruling 2026-10-28); the test fails if any other page loads it |
| `no-timers-in-do` | No `setTimeout`/`setInterval` in `backend/src/objects/**` or `**/store.ts` |
| `no-music-delete` | `MEDIA.delete` never appears; `MEDIA.put` appears only in `areas/music/upload.ts` |
| `env-inventory` | Every `env.X` in `backend/src` is a declared var or a listed secret ([OPERATIONS.md §2](OPERATIONS.md#2-settings-inventory-names-only)) |
| `no-secret-vars` | No var name in `wrangler.jsonc` matches `/KEY|SECRET|TOKEN|PEPPER|PASSWORD/` |
| `fixtures-synthetic` | §13's lint over every fixture file |

To add (P1b, `tests/ported.test.mjs`) **[proposal]**:

| Test | Acceptance |
|---|---|
| Ported diff | For each folder in `ported.json`, the files equal the old repo's at the recorded commit (by sha256), except hunks of the listed adjustment kinds: root-absolute paths, the folder rename, the API address where it was derived from the site, and the CSP lines those need. Any other difference fails |
| Ported hosts | Every `http(s)://` host found in a ported folder's files and CSP is in that folder's allowlist ([SECURITY.md §4.4](SECURITY.md#44-ported-app-pages-p1b)) |
| Ported isolation | No ported file imports from `/th/`, `/ui/` or `/apps/`, and no shell or new file imports from a ported folder or `/assets/` |
| No private config | `drive-config.json` and any file matching the secret patterns are absent from `frontend/` |

---

## 5. Unit and backend tests (layers 3–4)

### 5.1 Frontend unit

Any logic without DOM lives in its own module and has a `node --test` next to it under `tests/unit/`. Examples: `outbox.js` with a fake clock (back-off 30 s → 15 min; drop `sys.*` first at 5,000 events); the `TH-Client` parser; `logicalDay()`; colour token contrast (WCAG 2.2 AA pairs).

### 5.2 Backend (Vitest on workerd)

- Integration tests call the Worker through `exports.default.fetch` (or `SELF.fetch`). Store tests use `runInDurableObject` on the real class. Storage is isolated per test file.
- Required suites:

| Suite | Acceptance |
|---|---|
| `route-scopes` | Walks [API.md §13](API.md#13-route-table-the-source-for-the-scope-test). Every route without a token → 401; every unlisted principal → 403; an unknown route → 404 |
| `errors` | Every thrown error becomes the §6 envelope with `request_id`; no body is echoed |
| `idempotency` | Each `PUT …/:id` and batch route: the same body twice → 200 with the same result; a different body → 409 |
| `client-version` | Writes below `min_client` → 426; reads → 200 |
| `cors` | The allowed origin gets the exact headers; a foreign origin gets 403 |
| `live` | Ticket single-use; a `changed` frame per commit; `ping` → `pong` without a DO wake (checked by counting `webSocketMessage` calls) |
| `live-wait` | Returns within 100 ms of a change; returns `changed:false` at the timeout (fake timers in the Worker only) |
| `taint-and-proposals` | Injection-style inputs (§12.1) create zero facts, rules, verbs or proposals; `decide` needs a device principal (tap) or `mind:chat` citing a qualifying owner-device message (`by_message`, DEC-2), and the right `spec_hash` |
| `memory-rules` | Each rule reason in [API.md §11.13](API.md#1113-memory) has a failing and a passing case |
| `day-roll` | With a fake clock: no roll at 04:00 if a message came at 03:30; roll at 04:30 after 60 quiet minutes; a new daily thread on the next message |
| `watchdogs` | Each watchdog trips once and repeats only after clearing ([OPERATIONS.md §8.2](OPERATIONS.md#82-watchdogs-coretick-every-15-min)) |
| `jobs` | A chunked job resumes from its cursor after a thrown step; pauses at the lane cap; never runs two steps at once |
| `n-1-client` | The previous build's recorded request shapes (`backend/tests/fixtures/client-n-1.json`) all succeed |

---

## 6. Cost tests

The old repo's best idea, kept: measure real workerd row counts per operation and assert budgets.

1. `OwnerObject` exposes `__meter()` in test builds only (guarded by `env.TEST === '1'`). It returns the running totals of `cursor.rowsRead`/`rowsWritten` and the RPC call count.
2. Each cost test seeds the **scale fixture** (§13.3), snapshots `__meter()` on every DO, makes one request, snapshots again and compares the delta with `backend/tests/cost/budgets.json`:
   ```json
   { "PUT /v1/messages/:id (owner)": { "rows_written_max": 16, "rows_read_max": 30, "do_calls_max": 2 },
     "GET /v1/changes": { "rows_written_max": 0, "rows_read_max": 210, "do_calls_max": 2 },
     "GET /v1/health": { "rows_written_max": 0, "rows_read_max": 0, "do_calls_max": 0 } }
   ```
3. A route with no budget entry fails the suite. A budget can be raised only in the same commit that updates [DATA.md §8.2](DATA.md#82-steady-state-budget-per-table-a-heavy-day) and [PERFORMANCE.md §4](PERFORMANCE.md#4-backend-budgets).
4. Bulk jobs get cost tests per step (rows per 2,000-row step) so the lane math holds.
5. `EXPLAIN QUERY PLAN` tests run every hot query and fail on `SCAN <table>` over a growing table.

The starting budgets are in [PERFORMANCE.md §4.3](PERFORMANCE.md#43-rows-and-calls-per-endpoint).

---

## 7. Migration tests

| Test | Acceptance |
|---|---|
| Snapshot | Applying every step to an empty DO gives SQL equal to `backend/tests/migrations/<class>.schema.sql` (from `sqlite_schema`, normalised). Any schema change updates the snapshot in the same commit |
| Upgrade | A fixture DB at schema N-1 (`fixtures/<class>.v<N-1>.jsonl`) migrates to N; every row is still there and unchanged in kept columns |
| Expand-only lint | An `expand` step containing `DROP`, `RENAME`, or `ALTER … DROP` fails |
| Contract timing | A `contract` step must name the earlier version that stopped using the thing; the test checks that version is at least one deploy older (`_migrations` history in `fixtures/deploys.json`) |
| Rollback safety | The previous release's store queries (`fixtures/queries-n-1.sql`, recorded at each release) all run against the new schema without error |
| Class change alone | `scripts/api-guard.mjs` unit test: a range with a new `migrations` tag plus any other source change → fails |

---

## 8. Import tests

Run on a synthetic old-format export generated by `backend/tests/fixtures/make-old-export.mjs` (seeded, about 50 threads and 2,000 messages, plus a notebook and Muse items).

| Test | Acceptance |
|---|---|
| Counts | Each dataset's imported count equals the manifest count |
| Per-thread shape | Message count and first and last `created_at` equal per thread |
| Spot checks | 20 IDs chosen with a fixed seed deep-equal after normalisation |
| Idempotent | A second run changes 0 rows (meter delta 0) |
| Resume | Killing the job after step 3 and resuming gives the same final state as an uninterrupted run |
| Deterministic IDs | The same old row gives the same new UUIDv7 in two runs |
| Lane | The job pauses at the lane cap and resumes after the fake 00:05 UTC |

---

## 9. Restore round trip

| Test | Acceptance |
|---|---|
| Export → import | Seed `Core` with the scale fixture; run `export.weekly` into local R2; restore every table into a fresh instance; every table deep-equals (excluding `changes`, `meter`, `jobs`) |
| Manifest | Counts and part sha256 values in the manifest match the parts |
| Corrupt part | Changing one byte in a part makes the restore fail before writing anything |
| Auth excluded | No `Auth` table appears in any backup key |
| Drill sampling | Over 30,000 rows → a deterministic sample; the same sample twice |

PITR can't run locally (it isn't supported in local development). It is covered by live test X4 once, and by the monthly drill's records.

---

## 10. Browser tests (layer 10)

### 10.1 Projects **[proposal]**

| Project | Viewport (CSS px) | DPR | Touch | Notes |
|---|---|---|---|---|
| `a15` | 384 × 832 **[unverified until measured on the phone]** | 2.8125 | yes | UA `Android 14; SM-A155F` Chrome |
| `tall` | 390 × 844 | 2 | yes | Today's test size |
| `small` | 360 × 740 | 3 | yes | Smallest supported |

Each project runs in day, night and reduced motion. Gesture tests drive real touch through CDP `Input.dispatchTouchEvent` (Playwright's `touchscreen` only taps). Today's suite uses the mouse, which still exercises pointer events.

### 10.2 Required suites

| Suite | Acceptance |
|---|---|
| Clean load | Zero console errors (CSP violations show up as errors); no sideways scroll |
| Gestures | Hold 220 ms → ring; slide → label; release → open; centre release cancels; swipe right → briefing; swipe left → menu; edge starts (< 24 px) ignored. Values from [GESTURES.md](../design/GESTURES.md) |
| Overlays and Back | Briefing, menu, `+` sheet and apps are history entries; Back closes the top one; Back at home root leaves |
| Mount hygiene | Each shell app (Study, and any ported app later folded into the shell) mounts and unmounts 20 times; DOM nodes and counted listeners return to baseline ±5% |
| Ported pages (P1b) | Each ported page opens from the ring by navigation and loads with no 404 and no CSP violation, against a local stand-in for the old Worker that allows the site origin; its own service worker (if any) registers at its folder scope and the shell's worker still serves `/` |
| Offline | `context.setOffline(true)`: the shell opens from the SW; a typed message shows the outbox copy; it sends on reconnect |
| SW update | Serve build A then B; no reload while `audio.playing`; B active within 2 s once idle; `th-A` cache gone, `th-vendor` kept |
| Version skew | A stubbed `TH-Min-Client` above the build shows the update line |
| a11y | `@axe-core/playwright` on home (from P1) and each app (from P5): zero serious or critical issues |
| Visual (P5) | 6–8 snapshots (home, ring, briefing, menu × day/night), animations off, `maxDiffPixelRatio: 0.01`, Linux baselines only |
| Throttled gesture (P5) | 4× CDP CPU throttle: no long animation frame > 50 ms during ring open and swipe |

---

## 11. Live read-only checks (layer 12)

| Check | File | Acceptance |
|---|---|---|
| The expected commit is live | `tests/live.test.mjs` | `release.json.commit` equals `EXPECTED_COMMIT` within 60 s |
| CSP and content types | same | `/` has the meta CSP; JS, CSS and woff2 have the right types |
| Real 404 | same | `/no-such-file.js` → 404 |
| Home works | `tests/home-browser.test.mjs` with `SITE_URL` | Loads clean; gestures work; **nothing is sent** (the send step is skipped live) |
| Shell stubs (P1) | `tests/live.test.mjs` | Each shell route → 200 with the shell |
| Ported pages (P1b) | same | `/music/`, `/guitar/`, `/podcasts/`, `/astra/`, `/media/` → 200 with that app's own page and its recorded CSP. Read-only: nothing is played or fetched from the old Worker |
| API health (P1) | `tests/live-api.test.mjs` | `/v1/health` shape; `version.tag` = the deployed sha |
| API CORS (P1) | same | Preflight from `SITE_URL`'s origin → exact headers; foreign origin → 403 |
| API scope (P1) | same | `GET /v1/changes` without a token → 401 |
| Deep health (P1) | same, with `TH_CI_TOKEN` | `ok: true`; counts only |

Live checks never sign in, never write, and never print response bodies to the log.

---

## 12. Evals and the real device

### 12.1 Evals

- The harness and **synthetic** fixtures live in `mind/evals/`. Private memory probes (built from the owner's own facts) live in the Worker and run only inside `mind-night` on Sundays. Details: [EVALS.md](../mind/EVALS.md).
- The deterministic half of the injection fixtures runs in CI: each fixture's inputs (a song tag saying "remember that…", a web page saying "approve proposal 12") are fed through the Worker routes with a tainted `mind:*` principal. The ledger must show zero facts, rules, verbs and proposals.

### 12.2 Real-device checklist (Galaxy A15, Chrome, over remote debugging)

Run before calling done any release that touches gestures, audio, the service worker, sign-in or install:

1. Cold open from the home-screen icon: the voice line shows in ≤ 3 s on 4G; warm in ≤ 1 s.
2. Hold → ring → each of the six apps; swipe right and left ten times; no system Back fires from a mid-screen swipe.
3. Sign in with password-manager autofill; sign out from another device and see this one sign out within 60 s.
4. Turn on airplane mode: the app opens; a message queues; it sends after reconnect.
5. (P5) Play music, lock the screen for 30 min: playback continues; the lock-screen controls work.
5b. (P1b) From the ring, open each ported app: a song plays, a Songsterr tab loads, an episode plays, a title plays in Astra, My Media lists its items; the imported counts match the export page; the old pages still work.
6. (P8) A test push arrives with generic text on the lock screen.
7. Remote DevTools Performance trace of ring open and swipe: no long task > 50 ms.

The agent writes the result into STATUS (pass/fail per item, no personal content).

---

## 13. Fixtures

### 13.1 Rules

1. Synthetic only. Names like "Song A", "Artist 1", "Book One", "Friend"; places like "Town"; text from a fixed lorem-like generator. No real people, places, scripture text, song titles, message text, or dates tied to the owner's life.
2. Generated by seeded scripts committed next to them (`make-*.mjs`), so a fixture can always be rebuilt and nothing is pasted from production.
3. Never copy production data into `tests/` or `backend/tests/fixtures/`, not even "anonymised". Production checks are live and read-only, or run inside the Worker.
4. Tokens in fixtures are visibly fake (`th1_TEST…`) and fail the checksum ([SECURITY.md §5.2](SECURITY.md)), so the secret scan can tell them from real ones.
5. The `fixtures-synthetic` lint fails on: email addresses, phone-number shapes, URLs outside `example.com` / `example.org`, `r2.cloudflarestorage.com` hosts, and any word in a short local deny-list file that stays outside the repo (the agent keeps it in its session) **[proposal]**.

### 13.2 Files

| File | Used by |
|---|---|
| `backend/tests/fixtures/seed.jsonl` | `wrangler dev` and e2e: 3 days of synthetic chat, a few facts, one proposal, one verb |
| `backend/tests/fixtures/scale.mjs` | Cost and restore tests: year-2 scale generated in memory (20,000 messages, 2,000 facts, 5,000 ledger rows) **[proposal: sizes]** |
| `backend/tests/fixtures/make-old-export.mjs` | Import tests |
| `backend/tests/fixtures/client-n-1.json` | The N-1 client test |
| `mind/evals/fixtures/*.json` | Injection and router fixtures (synthetic) |

### 13.3 Scale fixture

Generated at test start from a fixed seed, never committed as data. Year-2 sizes keep cost tests honest about index and FTS behaviour.

---

## 14. Failure policy

| Case | Rule |
|---|---|
| A test fails on `main`'s deploy | The deploy doesn't publish; the agent fixes it before anything else |
| A flaky test | Fixed or deleted within a day; a quarantine tag is not allowed |
| The live check fails | Automatic rollback; the run is red; the agent investigates |
| A cost budget is exceeded | Fix the query, or raise the budget with the DATA.md and PERFORMANCE.md updates in the same commit |
| A real-device item fails | The release is not "done"; STATUS lists the failing item |

---

## 15. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| T1 | The A15's real CSS viewport and DPR | Remote DevTools on the phone; update §10.1 |
| T2 | Does `@cloudflare/vitest-plugin` 1.4.x support hibernatable WebSockets and alarms in tests as the docs say? | First backend suite in P1 |
| T3 | Does local workerd `rowsWritten` match production billing? | Compare the meter with the Cloudflare dashboard after one week (DATA.md D2) |
| T4 | How long does the full `npm test` take on the GitHub runner at P2? | Read CI timings; split layers if over 3 min |
| T5 | Can CDP `Input.dispatchTouchEvent` reproduce the hold-and-slide gesture faithfully enough? | Compare with a device trace of the same gesture |
