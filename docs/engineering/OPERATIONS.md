# Operations

This page holds the runbooks that keep the Thunderhead live: deploying and rolling back the site and the Worker, restoring data, rotating secrets, handling incidents and quota exhaustion, and the checks that run every day.
Each runbook names who acts (the owner on the phone, or the agent), the exact steps, and how to confirm it worked. Commands are also summarised in the repo's `README.md`.
Inventions beyond [decisions.md](../process/decisions.md) are marked **[proposal]**.

## Rules at a glance

1. **Push to `main` deploys.** The Deploy workflow tests, deploys the API (when it changed), then the site, checks both live, and rolls back on its own if a check fails.
2. **A rollback is always one tap:** Actions → Deploy → Run workflow, with the commit (site) or version id (API) to put live.
3. **The Worker cannot roll back across a Durable Object class change.** A class change ships alone, and a failure after it is fixed forward.
4. **Agents never hold Cloudflare or Azure credentials.** Anything that needs one runs in GitHub Actions, or the owner taps it in a dashboard.
5. **Ask first** before deleting data, spending money, changing access, or reaching other people, and before any deploy of the old Worker or the old site. Restores and secret rotations that lock someone out are "access" or "delete" proposals. The owner approves with a device tap or in their own words (Worker-verified, decisions 2026-10-28).
6. **Quiet hours:** nothing that needs the owner before 06:30 local. The agent still acts (rolls back, pauses jobs) and tells the owner after 06:30.
7. **Public logs:** an Actions log may show commit SHAs, file names, counts and timings. Never content, titles, tokens, refs to personal items or URLs with signatures.
8. **Every incident leaves a ledger row and a one-line STATUS entry with no personal content.**

---

## 1. Who does what

| Task | Owner (phone) | Agent |
|---|---|---|
| Approve or reject proposals | Taps on the gold-lit card, or says so in the conversation | Creates them, explains them in plain words; records the owner's own words with `th decide --by-message` |
| Issue or revoke agent tokens | Settings → Agents; copies the token once | Says which role is needed and where to paste it |
| Paste a token into a Claude environment or a GitHub secret | Yes (≈ 1 min each) | Gives the exact field name |
| Cloudflare dashboard: R2 API tokens, bucket CORS, lifecycle rules, r2.dev public access, mind fire secrets | Yes | Writes the step list |
| First setup and a reset: copy the fingerprint into GitHub and run Open setup / Request reset ([SIGN-IN.md §4, §10](../product/SIGN-IN.md)) | Yes | Never sees the code |
| GitHub settings: secrets, variables, ruleset | Yes | Writes the step list |
| Run a workflow from the Actions tab (rollback, secrets) | Yes, when asked or in an emergency | Normally does it through the API |
| Cancel a break-glass ticket | Yes, from any signed-in device | Never |
| Everything else: code, tests, merges, deploys, rollbacks, restores after approval, watchdogs, reports | — | Yes |

---

## 2. Settings inventory (names only)

Values never appear in the repo or in logs. Rotation steps are in §6. The security view (who can read what) is in [SECURITY.md](SECURITY.md).

| Name | Kind | Where | Phase |
|---|---|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | secret | GitHub repo (no environment: an environment would change the OIDC subject) | P0 |
| `AZURE_STORAGE_ACCOUNT` (must match `^thunderhead[a-z0-9]{0,13}$`), `SITE_URL`, `AZURE_DEPLOY_ENABLED` | variable | GitHub repo | P0 |
| `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, one account, no expiry) | secret | GitHub environment `worker` (only `main`) | P1 |
| `TH_CI_TOKEN` (`thc_` key, role `ci`) | secret | GitHub environment `worker` | P1 |
| `CLOUDFLARE_ACCOUNT_ID`, `WORKER_URL`, `SITE_ORIGINS` (the real site origin, passed with `wrangler deploy --var`), `WORKER_BOOTSTRAP` (`true` for the first deploy only, then deleted) | variable | GitHub environment `worker` | P1 |
| `WORKER_DEPLOY_ENABLED` | variable | GitHub repo | P1 |
| `TH_SETUP_FINGERPRINT`, `TH_RESET_FINGERPRINT` | secret, temporary | GitHub repo; inputs to `auth-setup.yml` / `auth-reset.yml` | P1 |
| `R2_MUSIC_RO_ACCESS_KEY_ID`/`_SECRET` (Object Read, `jarvis-music`), `R2_JOBS_ACCESS_KEY_ID`/`_SECRET` (Object Read & Write, `thunderhead-jobs`) | secret | GitHub environment `jobs` | P5 |
| `SITE_ORIGINS` (a placeholder; the real value comes from the environment variable above), `OWNER_TZ` (fallback `UTC`; the real zone is the `Core` setting `owner.tz`), `R2_ACCOUNT_ID`, `CORE_INSTANCE` (default `owner`) **[proposal]**, `AUTH_HIBP` (`on`\|`off`, the breach check; off in tests), `VAPID_PUBLIC_KEY` (P8) | var | `backend/wrangler.jsonc` | P1+ |
| `AUTH_PEPPER`, `IP_HASH_KEY` | Worker secret | Cloudflare | P1 |
| `AUTH_SETUP_FP` (one-time), `AUTH_RESET_FP` (only during a reset) | Worker secret | Cloudflare, via `auth-setup.yml` / `auth-reset.yml` or the dashboard | P1 |
| `ROUTINE_CHAT_URL`, `ROUTINE_CHAT_TOKEN`, `ROUTINE_NIGHT_URL`, `ROUTINE_NIGHT_TOKEN` (+ `ROUTINE_REFLEX_URL`, `ROUTINE_REFLEX_TOKEN` in P4) | Worker secret | Cloudflare | P2–P4 |
| `R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET` (Object Read, `jarvis-music` + `thunderhead-private`) | Worker secret | Cloudflare | P5 |
| `VAPID_PRIVATE_JWK` | Worker secret | Cloudflare | P8 |
| `TH_TOKEN` (one per environment: `th-chat`, `th-night`, `th-reflex`), plus non-secret `TH_API`, `TH_ROLE` | Claude environment | claude.ai scheduled tasks | P2+ |

The authoritative list, with who can read each, is [SECURITY.md §11](SECURITY.md). If the two differ, SECURITY.md wins and this table is fixed.

**Setting Worker secrets without a session.** No Claude session holds a Cloudflare credential, so Worker secrets are set either by the owner in the Cloudflare dashboard or by a `workflow_dispatch` workflow in the `worker` environment that pipes values to `wrangler` on stdin and prints only names: `auth-setup.yml` ("Open setup"), `auth-reset.yml` ("Request reset") and the "Rotate secret" workflow `rotate-secret.yml` **[proposal, from SECURITY.md]**. `rotate-secret.yml` takes:
- `copy`: names of environment secrets to copy into the Worker;
- `generate`: names to fill with 32 random bytes that are never printed (for `AUTH_PEPPER`, `IP_HASH_KEY`).

It uses `npx wrangler secret bulk` from stdin. Each run creates and deploys a new Worker version, so the next deep-health call records the version id in `thunderhead-private/ops/deploys/`.

Acceptance: a CI test parses `backend/src` for `env.<NAME>` and fails if a name is missing from this table (`env-inventory`).

---

## 3. Site deploy and rollback

### 3.1 Automatic deploy (every push to `main`)

What `deploy.yml` job `site` does today (`th/.github/workflows/deploy.yml`):

1. Runs only on `main` with `AZURE_DEPLOY_ENABLED=true`. Checks out the commit (dispatch `ref` or the pushed SHA) and refuses one that is not an ancestor of `origin/main`.
2. Node 24, `npm ci --ignore-scripts`, Playwright Chromium headless shell, `npm test` with `SITE_URL` empty.
3. Records the live commit from `<site>/release.json`.
4. `node scripts/stage.mjs <sha>` copies `frontend/` to `.deploy/site/`, writes `release.json`, and fails on any budget ([PERFORMANCE.md §2](PERFORMANCE.md#2-site-budgets)).
5. `azure/login` with OIDC. If sign-in fails, the next step prints only the token's `sub` claim.
6. `scripts/deploy.sh <sha>` refuses any account not named `thunderhead*`. It uploads `ui/*`, then `apps/*`, then the rest, then `release.json` last. It reads `release.json` back until it names the commit (10 tries, 3 s apart), then removes stale blobs (at most 50; soft delete keeps them 7 days).
7. Live checks: `tests/live.test.mjs` and `tests/home-browser.test.mjs` against `SITE_URL`, retried once after 15 s.
8. On failure or cancel after publishing started, the previous commit is checked out into a clean `frontend/`, staged and published.

Planned additions (P1): the stage step also writes the route stubs, `config.js`, `precache.json` and the `build` number ([ARCHITECTURE.md §5–6](ARCHITECTURE.md#5-consequences-of-hosting-on-an-azure-storage-static-website)). The live checks add a shell route → 200 with the shell. From P1b, `GET /music/`, `/guitar/`, `/podcasts/`, `/astra/`, `/media/` → 200 with that ported app's own page (§3.4).

Confirm: the run is green, and `<site>/release.json` shows the commit.

### 3.2 Site rollback

| Situation | Who | Steps | Confirm |
|---|---|---|---|
| Live check failed | automatic | Step 8 above | The run is red, and `release.json` shows the previous commit |
| A bad commit got past the checks | agent (or owner) | Actions → Deploy → Run workflow → branch `main` → `ref` = the last good commit → Run | `release.json` shows that commit; reload the phone twice (the SW applies the older build at the next safe moment) |
| Prefer history to show the fix | agent | `git revert <bad>` on `main` and push | A new deploy run goes green |
| First deploy ever failed | — | Nothing to go back to; fix forward | — |
| Rollback drill (P0 "done when", once) | agent, after at least two deploys | Actions → Deploy → Run workflow → `ref` = the commit before the live one, `rollback_drill` = true. The input sets `ROLLBACK_DRILL=1` for the live-check step, which adds one failing test to `tests/live.test.mjs`, so the check fails after publishing | The run is red at the live check; the rollback step ran; `release.json` shows the commit that was live before the drill; Home still loads on the phone |

A rolled-back site build is older than the API, which is fine because `/v1` is additive. If the rollback goes below `min_client`, its writes get `426`. In that case, lower `min_client` through `PATCH /v1/settings` (owner) or roll forward instead.

### 3.3 Emergency: service worker kill switch

Use this when a broken service worker keeps serving a bad shell and normal updates don't apply.

1. Agent: in a branch, copy `frontend/sw-kill.js` over `frontend/sw.js` and commit with the message `kill switch`. Merge to `main`.
2. The deploy publishes it. On the phone's next navigation, the browser fetches `/sw.js` (no-cache), installs the kill worker, which deletes every `th-*` cache, unregisters itself and reloads open pages once.
3. Agent: once the owner's phone reports the new build in `/v1/ops/perf` or `TH-Client`, restore the real `sw.js` with the fix and deploy again.

Confirm: the next request from the phone carries the fixed build in `TH-Client`.

### 3.4 Ported app pages (P1b)

The five existing apps are ported as they are (owner ruling; [ARCHITECTURE.md §11](ARCHITECTURE.md#11-the-as-is-port-p1b), [MIGRATION.md §5–6](MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)). Steps, in order:

| # | Who | Step | Confirm |
|---|---|---|---|
| 1 | agent | Copy each old folder (and the `/assets/` files it loads) from the old repo at a recorded commit into `frontend/<folder>/`; make only the listed adjustments (root-absolute paths, the folder name, the API address where it is derived from the site, the CSP lines those need); record each in `ported.json` | The ported-diff test is green |
| 2 | agent | Normal site deploy (§3.1). Ported folders upload with the rest; they are outside the shell's precache | Live check: each `/<folder>/` → 200 with its own page |
| 3 | owner | Approve the proposal "Let the new site's apps use the old Worker until their data moves" | Approval in the ledger |
| 4 | agent | In the old repo: add the new site's exact origin to `FRONTEND_ORIGINS` (`backend/origins.js`), nothing else; record the old Worker's current version id in STATUS; run the old repo's Worker deploy workflow | From the new site: a song plays, a Songsterr tab loads, an episode plays, Astra and My Media open |
| 5 | owner | Approve the old-site `/export/` partial publish; on the phone, download the export, then open the new site's `/import/` page and pick the file | Counts on the import page equal the export page's, and each ported app shows the owner's data |

Rollback:
- A broken ported page: roll back the site (§3.2), or restore that folder's old bytes from the old repo; the old page keeps working meanwhile.
- A broken old Worker after step 4: `wrangler rollback <recorded version>` from the old repo's workflow (ask first only for a new deploy; a rollback to the recorded version is containment). The ported pages then fail CORS until step 4 is fixed and repeated; the old pages are unaffected.

Each app later switches to `thunderhead-api` when its data moves (Music P5, Guitar P6, Astra, Podcasts, My Media P8), as a normal site + API deploy ([MIGRATION.md §7](MIGRATION.md#7-caller-switch-over-order) step 5).

---

## 4. Restore from backup

All restores are proposals. The owner approves with a device tap or in their own words, which the Worker checks against the owner's own message; nothing restores on a fired prompt or any other text. The storage design is in [DATA.md §11](DATA.md#11-backup-export-and-restore).

### 4.1 Point-in-time (whole object, last 30 days)

1. Agent: find the last good time `t` (ledger, errors, the owner's report).
2. Agent: `POST /v1/ops/restore {kind:'pitr', class:'core', at:t}` → a proposal of class `access`, titled "Put Core back to <local time>". Its `why` lists what will be lost: every message, fact and ledger row after `t`. The agent also copies those rows to `thunderhead-private/ops/restores/<id>.json` before asking **[proposal]**.
3. Owner: approve.
4. Worker: records `getCurrentBookmark()` (the undo point) in the restore record outside the object, calls `onNextSessionRestoreBookmark(await getBookmarkForTime(t))`, then `ctx.abort()`.
5. Agent: `GET /v1/ops/health/deep` → `core.ok`. Post a system line: "Restored to <time>. N later messages are saved separately."

Undo: the same steps with the recorded pre-restore bookmark.

### 4.2 One table from a weekly export

1. `POST /v1/ops/restore {kind:'table', class, table, date, mode:'merge'|'replace'}`. `replace` is a `delete`-class proposal; `merge` (upsert by primary key, never delete) is `access`.
2. After approval, a bulk job runs under the lane cap. It reads `backups/<date>/<class>/<table>.*.jsonl.gz` in part order and checks each part's sha256 against the manifest first. A mismatch stops the job with `failed`, having written nothing.
3. Confirm: the job report shows `rows == manifest.rows` for that table.

### 4.3 Whole object, PITR unavailable

1. `POST /v1/ops/restore {kind:'object', class, date}` (`access`).
2. A bulk job restores every table into the instance `owner-r<YYYYMMDD>`. At 40,000 rows a day, a 300,000-row object takes about 8 days of the lane, plus index writes. The agent tells the owner the estimate.
3. When the counts match the manifest, the agent changes `CORE_INSTANCE` in `wrangler.jsonc` to the new name and deploys. This is a normal deploy, not a class change, so it can roll back.
4. The old instance is left untouched until the owner approves deleting it (a `delete` proposal, after 30 days).

### 4.4 Monthly restore drill

- **When:** the first Sunday of each month, run by `mind-night` (`POST /v1/ops/drill/run`), after the weekly backup.
- **What:** the latest `Core` backup goes into the instance `drill-<YYYYMM>`. Tables over 30,000 rows are restored as a deterministic sample ([DATA.md §11.4](DATA.md#114-proof-that-backups-work)). The drill compares counts and part sha256 values with the manifest, writes `drills/<YYYY-MM>/report.json`, then empties the instance.
- **Pass:** every table's count and every part's hash match. The briefing shows one line only on failure.
- **Fail:** a watchdog `drill.failed` (§8). The agent opens a fix within the day. Weekly backups continue.

---

## 5. Worker deploy and rollback

### 5.1 Pipeline (`deploy.yml`: `test` → `api` → `site`)

The `api` job runs when `backend/**`, `shared/**` or `package-lock.json` changed since the deployed tag, or on dispatch with `target: api|both`.

1. Gate: `vars.WORKER_DEPLOY_ENABLED == 'true'`, ref `main`, the commit is an ancestor of `main`.
2. `npm ci --ignore-scripts` (measured in the P1 spike: workerd and esbuild ship as optional platform packages, so their install scripts aren't needed; settles Q4), then `npm test`.
3. **Class-change check [proposal]:** `node scripts/api-guard.mjs <deployed-tag> HEAD` compares the `migrations` array.
   - Unchanged: a normal deploy with auto-rollback.
   - Changed: the commit range may touch only `backend/wrangler.jsonc`, the new `objects/<class>.ts`, its export in `src/index.ts`, and tests. Anything else fails the job before deploying. Auto-rollback is off for this run.
4. Record the current version: `PREV=$(npx wrangler deployments status --json --config backend/wrangler.jsonc)`, taking the active version id.
5. Secrets file, then deploy:
   - **Bootstrap** (step 4 found no live version): allowed only when the environment variable `WORKER_BOOTSTRAP` is `true`; otherwise the job fails with "No live version. Set WORKER_BOOTSTRAP only for the very first deploy." It writes a temporary file (`umask 077`, in `$RUNNER_TEMP`) with `AUTH_PEPPER` and `IP_HASH_KEY` = 32 random bytes, base64url, and `none` for every other name in `secrets.required`. No log line shows a value.
   - **Normal deploy:** `wrangler secret list --format json`; each name in `secrets.required` that the live Worker lacks goes into the file as `none` (a secret introduced by this commit). A missing `AUTH_PEPPER` or `IP_HASH_KEY` fails the job instead.
   - `npx wrangler deploy --config backend/wrangler.jsonc --var SITE_ORIGINS:<the environment variable> --tag <sha12> --message "deploy <sha>" [--secrets-file <file>]`; the file is deleted right after.
6. Smoke:
   1. Poll `GET /v1/health` until `version.tag == <sha12>` (every 5 s, 60 s max).
   2. Poll `GET /v1/ops/health/deep` with `TH_CI_TOKEN` until `ok` and every `schema` equals the expected `SCHEMA_VERSION` (every 15 s, 6 min max, because DOs may run old code for a few minutes). Skipped with a notice while `TH_CI_TOKEN` is not set (the deploys before first setup).
   3. `node --test tests/live-api.test.mjs` (read-only: health shape, CORS preflight, 401 without a token, 403 from a foreign origin).
7. Watch 10 minutes **[proposal]**: every 60 s, `GET /v1/ops/errors?status=open` counts server errors (`source` in `worker`, `do`) with `last_at` after the deploy. Fail at ≥ 5 of them, or at any error whose code is `internal` on an auth route.
8. On failure after step 5, when no class change happened: `npx wrangler rollback "$PREV" --config backend/wrangler.jsonc --message "auto rollback from <sha>" --yes`. Then re-run step 6.1 expecting the previous tag. A bootstrap run has nothing to roll back to.
9. On failure with a class change: no rollback (it would be refused). The run fails, a watchdog posts at 06:30, and the agent fixes forward.

The `site` job starts only after `api` succeeded or was skipped, so a new site never meets an old API.

### 5.2 Manual API rollback

| Who | Steps | Confirm |
|---|---|---|
| Agent or owner | Actions → Deploy → Run workflow → `target: api-rollback`, `version: <id from deployments list>` | `/v1/health` shows the old tag; deep health is green |
| Blocked by "class lifecycle change" | Fix forward. Revert the code change but keep the `migrations` entry (classes are never removed in a hurry) | A normal deploy goes green |

Notes:
- Rollback reaches only the last 100 versions. It fails if a bound R2 bucket no longer exists.
- Data is not rolled back. Expand-only migrations ([DATA.md §9](DATA.md#9-migrations)) are what make old code safe on the newer schema.
- Setting a secret creates a version. Roll back to a version id, never to "the previous one", when secrets changed in between.

---

## 6. Secret rotation

| Secret | When | Steps | Effect | Confirm |
|---|---|---|---|---|
| Device session | On suspicion; a lost phone | Owner: Settings → Devices → Sign out (that row), or "Sign out everywhere" | That device sees `401 session_revoked` within 60 s and wipes its private caches | The row is gone from the list |
| Agent token (`mind:*`, `muse`, `ci`) | Every 180 days **[proposal]**, or on suspicion | Owner: Settings → Agents → New (same role) → copy → paste into the Claude environment (`TH_TOKEN`) or the GitHub environment secret `TH_CI_TOKEN` → revoke the old row | The old token stops within 60 s | Agent: `GET /v1/auth/me` with the new token → 200; with the old → 401 |
| `AUTH_PEPPER` | Only on suspicion of a leak | Proposal (`access`). Agent: `rotate-secret.yml` with `generate: AUTH_PEPPER_V2`, after a deploy that accepts both peppers and re-hashes lazily at sign-in ([SECURITY.md §14.6](SECURITY.md)) | Hashes move to the new pepper as the owner signs in | Sign-in works; `pepper_v` = 2 on the credential |
| `IP_HASH_KEY` | Yearly | `rotate-secret.yml` `generate: IP_HASH_KEY` | Throttle counters reset | — |
| `AUTH_SETUP_FP`, `TH_SETUP_FINGERPRINT` | Clear after setup | Owner: run Open setup with `clear: true` (sets the Worker secret to `none`; never delete it), then delete the GitHub secret | None (`/v1/auth/setup` already answers 410) | — |
| Mind fire URL/token (per task) | When the task is recreated or on suspicion | Owner: in the scheduled task's API trigger, regenerate → paste into the Cloudflare dashboard as `ROUTINE_CHAT_TOKEN` and `ROUTINE_CHAT_URL` (or the `_NIGHT_`, `_REFLEX_` pair) | Old fires fail with 401 from the platform | Agent: `POST /v1/mind/typing` from a device fires a wake; the wakes list shows `fired` |
| `CLOUDFLARE_API_TOKEN` | Yearly (reminder in the October briefing) **[proposal]**, or on suspicion | Owner: Cloudflare → API tokens → Roll → paste into the GitHub secret | Deploys use the new token | Next Deploy run is green |
| `R2_SIGN_ACCESS_KEY_ID` / `R2_SIGN_SECRET` | On suspicion (rolling revokes every signed URL at once) | Owner: R2 → Manage API tokens → create (Object Read; the two buckets) → paste both into the Cloudflare dashboard (or `rotate-secret.yml copy`) → delete the old token | Old URLs 403 at once; clients re-sign | Media plays after one 403 retry |
| Actions R2 keys | Yearly or on suspicion | Owner: create new → GitHub secrets → delete old | — | Next jobs run is green |
| `VAPID_PRIVATE_JWK` | On suspicion | Proposal; `rotate-secret.yml` with a P-256 JWK step | Every push subscription is dead; devices re-subscribe on next open | A test push arrives |
| Azure OIDC | Not a stored secret | If the repo is renamed or recreated: Entra → app → Federated credentials → add the new exact subject; the failing run prints it | — | Deploy green |

---

## 7. Incidents

### 7.1 Severity

| Sev | Meaning | Examples | Owner told |
|---|---|---|---|
| S1 | Data lost or exposed | A table emptied; a private file in `$web`; a token in a log | At 06:30 (or at once if already awake and using the app): home line + push |
| S2 | A core function down | Can't sign in; messages don't send; the site won't load | Home line at once; push after 06:30 |
| S3 | Degraded | The mind slow to wake; one app broken; a job failing | Briefing line |
| S4 | Cosmetic | Layout glitch | Ledger only |

### 7.2 Steps (every incident)

1. **Detect:** a watchdog, a failed deploy check, a phone error report, or the owner.
2. **Contain** within 15 minutes of detection: roll back (§3.2, §5.2), pause bulk jobs (`bulk.lane = null`), or apply the kill switch (§3.3). Containing never needs approval unless it deletes.
3. **Exposure (S1 only):** remove the item (a `$web` blob, a log is out of reach: rotate whatever leaked), rotate the affected secret (§6), and record which data was exposed and for how long.
4. **Fix** forward in a branch with a test that fails before the fix.
5. **Record:** a ledger `note` row, and a STATUS line such as "2026-11-02 S2 sign-in 500s after deploy 412, rolled back in 6 min, fixed in 413". No personal content.
6. **Review (S1, S2):** add a watchdog or a test so the same thing is caught earlier next time.

### 7.3 Specific runbooks

| Problem | Signs | Do |
|---|---|---|
| **Worker request quota (100,000/day) exhausted** | Phone and CLI get non-JSON 429/1027 errors until 00:00 UTC | The phone queues writes in the outbox and shows the offline copy. The mind cannot be woken. After reset: check the meter and logs for the source. If it was a flood (next row), follow that. |
| **Request flood from a stranger** (`workers.dev` has no WAF) | Requests far above normal with 401s | Accept and watch (owner question pending). If it repeats, the only fix is a custom domain with a WAF rule, which costs money: proposal of class `money` |
| **DO rows written cap hit** | `503 budget_exhausted` on writes; reads work | Pause the lane (automatic at 60,000); find the table from `meter`; fix the job or query; writes resume at 00:00 UTC. The outbox and the CLI keep retrying after `Retry-After` |
| **DO rows read cap hit** | Reads fail | Find the scan (`EXPLAIN QUERY PLAN` tests must have missed it); add the index under the expand rule |
| **DO duration high** | Deep health shows `Core` awake for hours | Look for a timer, a pending fetch or a WebSocket without hibernation in `objects/`; the `no-timers-in-do` test should have failed |
| **Mind not waking** | Wakes `unclaimed` after 240 s; the honest line shows | Check usage limits (owner: claude.ai usage page) and the task's state; check fire responses in `wakes.http_status`. The instant tier keeps working. Nothing to do on the Worker if the platform rejected the fire |
| **Sign-in broken** | `/v1/auth/login` 5xx | Roll back the API (§5.2). Signed-in devices keep working: sessions are checked, not passwords |
| **Media 403 loops** (P5) | The player re-signs repeatedly | Check the signing key (§6) and the clock floor; the Worker logs `sign_failed` counts |
| **Old code after deploy** | Deep health `schema` lags | Wait up to 6 min (the smoke step already does); after that, treat it as a failed deploy |
| **Claude usage limit reached** | Sessions don't start | Nothing on the Worker side. The honest line stays; the night shift runs when usage returns. Usage credits stay off (decisions.md; owner confirmation pending). The plan is Max 5x now and may drop to Pro later (owner ruling 2026-10-27): everything keeps working on Pro, only leaner (fewer wakes, a shorter night shift; [RUNTIME.md §11](../mind/RUNTIME.md)); nothing on the Worker depends on the plan. |
| **R2 operations near the free tier** (1M Class A, 10M Class B a month) | Monthly owner check (§9) | Find the source (index rebuilds, re-signing loops). Going over costs money: stop the job and propose |
| **A ported app fails** (P1b–P8) | The app shows its old error lines; its error reporter posts to the old Worker | It still calls the old Worker: check the old Worker's version still carries the new origin (§3.4 step 4), and the shared request quota (both Workers count against one account's 100,000/day). Never fix it by changing the app beyond the listed adjustments; a real fix is a change the owner agrees to |

---

## 8. Watchdogs, SLOs and alert thresholds

### 8.1 SLOs

| Area | Objective | Measured by |
|---|---|---|
| Site | The live Chromium check passes after every deploy; otherwise auto-rollback | `deploy.yml` |
| API | ≤ 10 server errors (5xx) per day **[proposal]** (counts, because the Worker can't afford to count every request); ≥ 5 in the 10 minutes after a deploy triggers rollback | `Core.errors` |
| Chat | Warm reply p90 < 15 s; cold reply p90 < 90 s; an unclaimed wake after 240 s is shown honestly | `messages`, `wakes` ([RUNTIME.md](../mind/RUNTIME.md)) |
| Night shift | Done by 09:00 local on ≥ 6 nights of 7 | `wakes` (role night) + day note `written_at` |
| Budgets | No Free-plan quota above 70% before 18:00 UTC | `meter` |
| Backups | Newest complete backup < 8 days old; monthly drill passes | manifests, drill reports |
| Phone | INP p75 ≤ 100 ms; no gesture LoAF > 50 ms ([PERFORMANCE.md](PERFORMANCE.md)) | `perf_days` |

### 8.2 Watchdogs (`Core.tick`, every 15 min)

Up to P3, a tripped watchdog writes a ledger note and a briefing line. From P4 it also wakes `mind-reflex` (≤ 4 wakes a day).

| Name | Trips when | Action |
|---|---|---|
| `quota.rows_written` | Account total today ≥ 70,000 | Revoke the bulk lane; S3 |
| `quota.rows_read` | ≥ 3,500,000 today | S3 |
| `quota.do_calls` | Sum of `rpc_calls` ≥ 70,000 today | S3 |
| `errors.spike` | ≥ 20 new server errors in 60 min, or ≥ 5 of one fingerprint in 15 min | S2 if on auth or messages, else S3 |
| `client.errors` | ≥ 50 client error reports in 60 min | S3 |
| `backup.stale` | Newest complete backup > 8 days | S3 |
| `drill.failed`, `drill.overdue` | Last drill failed, or none for 35 days | S3 |
| `roll.stuck` | `day.current` is more than 30 h old | S2 |
| `night.late` | No day note for yesterday by 09:00 local | S3 |
| `jobs.stuck` | A job `running` > 2 h, or `attempts` ≥ 5 | S3 |
| `db.size` | Any object > 700 MB | S3 |
| `events.export.late` (P5) | Day D not archived by D+1 09:00 | S3 |
| `muse.silent` (P4) | No Muse API call in 26 h ([MUSE.md](../mind/MUSE.md) §9) | S4; Briefing line "Muse hasn't checked in since yesterday." |

Acceptance: each watchdog has a vitest case that sets the condition with fixtures and a fake clock and asserts exactly one ledger note per trip (no repeat until it clears and trips again).

---

## 9. Routine checks

| When | What | Who |
|---|---|---|
| Every 15 min | Watchdogs; day roll; alarms re-armed | `Core.tick` |
| Daily | Meter vs caps; errors; wakes claimed/unclaimed; yesterday's `perf_days`; prune jobs | Worker; `mind-night` reads them into the briefing only when something is off |
| Each deploy | Site and API live checks | `deploy.yml` |
| Weekly (Sunday) | Per-class backup at 02:30 local; profile snapshot; evals ([EVALS.md](../mind/EVALS.md)); a one-line ops summary in Monday's briefing | Worker, `mind-night` |
| Monthly | Restore drill (first Sunday); Dependabot PRs (grouped) merged when green; owner glances at the Cloudflare dashboard for R2 storage and Class A/B operations (about 1 min) | `mind-night`, agent, owner |
| Every 180 days | Agent token rotation reminder | briefing |
| Yearly (October) | `CLOUDFLARE_API_TOKEN` rotation; Node LTS move; review of action pins and the dependency list | owner + agent |

---

## 10. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| X1 | Worker-held WebSocket to a hibernating DO for `/v1/live/wait`: works, unbilled while waiting, and through the session proxy | Preview Worker, 100 takes from a Claude session, check DO duration |
| X3 | DO CPU limit on Free (10 ms vs 30 s); scrypt cost at the edge | Preview bench route; read `cpuTimeMs` in Workers Logs |
| X4 | PITR available on Free | Preview: bookmark, write, restore |
| Q1 | Does a step guarded by `cancelled()` get time to finish after `timeout-minutes` cancels the job? | Force a cancel once in a test repo |
| Q2 | Does `wrangler deployments status --json` give the active version id directly? | Run it in the first `api` deploy; adjust step 4 |
| Q3 | Does `wrangler secret bulk` from stdin work in Actions without a TTY? | First `rotate-secret.yml` run with a dummy secret |
| Q4 | Is `npm ci --ignore-scripts` safe once wrangler, workerd and esbuild are installed? | Try it in CI; if `wrangler --version` works, use it everywhere |
| Q5 | Can the R2 lifecycle rule (14-day delete on `thunderhead-jobs`) be set on the Free plan at $0? | Owner checks the bucket's settings page |
| Q6 | Are R2 bucket locks free, so `native/audio/` could be locked against deletes? | Owner checks; if free, propose it (`access`) |
