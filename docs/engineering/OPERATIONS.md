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
| `CLOUDFLARE_ACCOUNT_ID`, `SITE_ORIGINS` (the real site origin, passed with `wrangler deploy --var`), `WORKER_BOOTSTRAP` (`true` for the first deploy only, then deleted) | variable | GitHub environment `worker` | P1 |
| `WORKER_URL` (the API address; the site's stage step writes it into `config.js` and the pages' CSP) | variable | GitHub repository (both deploy jobs read it) | P1 |
| `WORKER_DEPLOY_ENABLED` | variable | GitHub repo | P1 |
| `TH_SETUP_FINGERPRINT`, `TH_RESET_FINGERPRINT` | secret, temporary | GitHub repo; inputs to `auth-setup.yml` / `auth-reset.yml` | P1 |
| `R2_JOBS_ACCESS_KEY_ID`/`_SECRET` (Object Read only, `jarvis-music` only), `R2_ACCOUNT_ID`, `TH_CI_TOKEN` (the `jobs-audio` `ci` key) | secret | GitHub environment `jobs` (only `main`; SETUP.md N6). `jobs-audio.yml` also reads the repository variable `WORKER_URL` | P5, built 2026-11-01 |
| `SITE_ORIGINS` (a placeholder; the real value comes from the environment variable above), `OWNER_TZ` (fallback `UTC`; the real zone is the `Core` setting `owner.tz`), `R2_ACCOUNT_ID`, `CORE_INSTANCE` (default `owner`) **[proposal]**, `AUTH_HIBP` (`on`\|`off`, the breach check; off in tests), `VAPID_PUBLIC_KEY` (P8) | var | `backend/wrangler.jsonc` | P1+ |
| `AUTH_PEPPER`, `IP_HASH_KEY` | Worker secret | Cloudflare | P1 |
| `AUTH_SETUP_FP` (one-time), `AUTH_RESET_FP` (only during a reset) | Worker secret | Cloudflare, via `auth-setup.yml` / `auth-reset.yml` or the dashboard | P1 |
| `ROUTINE_CHAT_URL`, `ROUTINE_CHAT_TOKEN`, `ROUTINE_NIGHT_URL`, `ROUTINE_NIGHT_TOKEN` (+ `ROUTINE_REFLEX_URL`, `ROUTINE_REFLEX_TOKEN` in P4) | Worker secret | Cloudflare | P2–P4 |
| `R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET` (Object Read, `jarvis-music` + `thunderhead-private`) | Worker secret | Cloudflare | P5 |
| `VAPID_PRIVATE_JWK` | Worker secret | Cloudflare | P8 |
| `TH_TOKEN` (one per environment: `th-chat`, `th-night`, `th-reflex`), plus non-secret `TH_API`, `TH_ROLE` | Claude environment | claude.ai scheduled tasks | P2+ |

The authoritative list, with who can read each, is [SECURITY.md §11](SECURITY.md). If the two differ, SECURITY.md wins and this table is fixed.

**Setting Worker secrets without a session.** No Claude session holds a Cloudflare credential, so Worker secrets are set either by the owner in the Cloudflare dashboard or by a `workflow_dispatch` workflow in the `worker` environment that pipes values to `wrangler` on stdin and prints only names: `auth-setup.yml` ("Open setup"), `auth-reset.yml` ("Request reset") and the "Rotate secret" workflow `rotate-secret.yml` **[proposal, from SECURITY.md; not built: there is no such workflow, so until it exists the owner sets these in the Cloudflare dashboard]**. `rotate-secret.yml` takes:
- `copy`: names of environment secrets to copy into the Worker;
- `generate`: names to fill with 32 random bytes that are never printed (for `AUTH_PEPPER`, `IP_HASH_KEY`).

It uses `npx wrangler secret bulk` from stdin. Each run creates and deploys a new Worker version, so the next deep-health call records the version id in `thunderhead-private/ops/deploys/`.

Acceptance: a CI test parses `backend/src` for `env.<NAME>` and fails if a name is missing from this table (`env-inventory`).

---

## 3. Site deploy and rollback

### 3.1 Automatic deploy (every push to `main`)

What `deploy.yml` does today (`th/.github/workflows/deploy.yml`). First, job `test` runs every check once (`checks.yml`): six jobs at once, the site and mind suites in five parts dealt by measured time (`scripts/test-part.mjs`, `scripts/test-durations.json`) and the Worker's suite, each with Node 24, `npm ci --ignore-scripts` and, for the site parts, Playwright's Chromium headless shell, with `SITE_URL`, `WORKER_URL` and the Drive settings empty. They are exactly what `npm test` runs, in about two minutes instead of five, and no secret reaches them. Nothing deploys unless all six pass. Then job `site`:

1. Runs only on `main` with `AZURE_DEPLOY_ENABLED=true`, after `test` passed and `api` succeeded or was skipped. Checks out the commit (dispatch `ref` or the pushed SHA) and refuses one that is not an ancestor of `origin/main`.
2. Node 24, `npm ci --ignore-scripts`, Playwright Chromium headless shell (for the live check's browser test).
3. Records the live commit from `<site>/release.json`.
4. `node scripts/stage.mjs <sha>` copies `frontend/` to `.deploy/site/`, writes `release.json`, and fails on any budget ([PERFORMANCE.md §2](PERFORMANCE.md#2-site-budgets)).
5. `azure/login` with OIDC. If sign-in fails, the next step prints only the token's `sub` claim.
6. `scripts/deploy.sh <sha>` refuses any account not named `thunderhead*`. It uploads `ui/*`, then `apps/*`, then the rest, then `release.json` last. It reads `release.json` back until it names the commit (10 tries, 3 s apart), then removes stale blobs (at most 50; soft delete keeps them 7 days).
7. Live checks: `tests/live.test.mjs`, `tests/home-browser.test.mjs` and `tests/live-browser.test.mjs` (the real `config.js` and the service worker: a signed-out visit lands on `/signin/`, no CSP violation, the worker activates) against `SITE_URL`, retried once after 15 s, within 10 minutes.
8. On failure or cancel after publishing started, the previous commit is checked out in a worktree of its own (`$RUNNER_TEMP/previous-release`) and built entirely with its own tools: its packages (`npm ci`), fonts, `stage.mjs` and `deploy.sh`, since a newer `stage.mjs` can expect files it lacks. The step fails unless the live `release.json` then names that commit and that release's own live checks (step 7's files, those it has) pass, retried once after 15 s; all within 25 minutes. The job's 60 minutes hold publish (15), the live check (10) and the rollback (25) together. `tests/site-rollback.test.mjs` runs the step's script in a scratch repository and stages each of the last five releases on `main` from a worktree with its own `stage.mjs`.

Planned additions (P1): the stage step also writes the route stubs, `config.js`, `precache.json` and the `build` number ([ARCHITECTURE.md §5–6](ARCHITECTURE.md#5-consequences-of-hosting-on-an-azure-storage-static-website)). The live checks add a shell route → 200 with the shell. From P1b, `GET /music/`, `/guitar/`, `/podcasts/`, `/astra/`, `/media/` → 200 with that ported app's own page (§3.4).

Confirm: the run is green, and `<site>/release.json` shows the commit.

### 3.2 Site rollback

| Situation | Who | Steps | Confirm |
|---|---|---|---|
| Live check failed | automatic | Step 8 above | The run is red, `release.json` shows the previous commit, and the rollback step's own live check is green |
| A bad commit got past the checks | agent (or owner) | Actions → Deploy → Run workflow → branch `main` → `ref` = the last good commit → Run | `release.json` shows that commit; reload the phone twice (the SW applies the older build at the next safe moment) |
| Prefer history to show the fix | agent | `git revert <bad>` on `main` and push | A new deploy run goes green |
| First deploy ever failed | — | Nothing to go back to; fix forward | — |
| Rollback drill (P0 "done when", once) | agent, after at least two deploys | Actions → Deploy → Run workflow → `ref` = the commit before the live one, `rollback_drill` = true. The input sets `ROLLBACK_DRILL=1` for the live-check step, which adds one failing test to `tests/live.test.mjs`, so the check fails after publishing | The run is red at the live check; the rollback step ran; `release.json` shows the commit that was live before the drill; Home still loads on the phone |

A rolled-back site build is older than the API, which is fine because `/v1` is additive. If the rollback goes below `min_client`, its writes get `426`. In that case, lower `min_client` through `PATCH /v1/settings` (owner) or roll forward instead.

### 3.3 Emergency: a broken cached release

**First, on the phone (no commit, no GitHub).** Settings › About › Repair, or, when the app cannot start,
the boot guard's panel (`frontend/boot-guard.js`: home has not marked itself started within 12 s on screen
on two starts in a row; it shows "Thunderhead didn’t start." with Repair and Try again, and never reloads by
itself), or `/repair/` typed in the address bar. `/repair/` (`frontend/repair/`) is a static page with one
classic script and nothing else of the site, and `sw.js` never answers it. It first proves the site answers
(HEAD `/` and `/release.json`, past every cache; no service worker of ours answers a HEAD) and, if not, clears
nothing and says it needs a connection; About's row and the boot guard's button check `/repair/` the same way
before they go. Then it unregisters the shell's,
Music's and Podcasts' service workers, deletes only the caches that hold code (`th-<n>`, `th-lab-<n>`,
`th-vendor`, `claude-player-v<n>`, `claude-player-release`, `jarvis-podcast-shell-v<n>`), keeps everything else (offline songs and
heads, downloads, covers, art, the catalogue, Astra's and Photos' caches, IndexedDB and localStorage with
the session), then goes home, which loads from the network; home says what was done ("Repaired: …").
A file fixed by hand on the storage account reaches Music only with a new `release.json` (re-upload it with a
new `staged_at`): Music keeps its files for the release that file names, for at most 7 days (`th/music/release.js`).
Confirm: home opens signed in, and Settings › About › Copy report shows the expected `release.build`.

Settings › About › Copy report puts one JSON on the clipboard (`frontend/th/report/site.js`, under 60 KB,
numbers and states only): release and commit, the Worker's tag and deep health, each service worker's state,
the caches with their sizes, storage, push, network, look and theme, the last 20 client errors as code and
file:line, open watchdog trips, the data meter's totals, the mind's state and each app's last sync.

**The kill switch, only when Repair cannot reach the phone** (a broken service worker keeps serving a bad
shell to a phone nobody can tap through, and normal updates don't apply):

1. Agent: in a branch, copy `frontend/sw-kill.js` over `frontend/sw.js` and commit with the message `kill switch`. Merge to `main`.
2. The deploy publishes it. On the phone's next navigation, the browser fetches `/sw.js` (no-cache), installs the kill worker, which deletes every `th-*` cache, unregisters itself and reloads open pages once.
3. Agent: once the owner's phone reports the new build in `/v1/ops/perf` or `TH-Client`, restore the real `sw.js` with the fix and deploy again.

Confirm: the next request from the phone carries the fixed build in `TH-Client`.

### 3.4 Ported app pages (P1b)

The five existing apps are ported as they are (owner ruling; [ARCHITECTURE.md §11](ARCHITECTURE.md#11-the-as-is-port-p1b), [MIGRATION.md §5–6](../archive/MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)). Steps, in order:

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

Each app later switches to `thunderhead-api` when its data moves (Music P5, Guitar P6, Astra, Podcasts, My Media P8), as a normal site + API deploy ([MIGRATION.md §7](../archive/MIGRATION.md#7-caller-switch-over-order) step 5).

---

## 4. Restore from backup

**No restore exists in the site.** Nothing in the Worker or on the phone can put a real object back to an earlier time: no route, no RPC, no tick pass. The paths below are designs (proposals), not built. What is built is the proof that the platform could do it (§4.4), the weekly backups, the monthly drill and the retention switch. The storage design is in [DATA.md §11](DATA.md#11-backup-export-and-restore).

### 4.1 Point-in-time (whole object, last 30 days; not built)

Cloudflare keeps 30 days of each SQLite Durable Object's history ([the PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): `getBookmarkForTime`, `onNextSessionRestoreBookmark`, which returns the bookmark just before the restore, then a restart with `ctx.abort()`; not supported in local development; the docs do not say whether the Free plan has it).

**What the proof's outcome means** (deep health `backups.pitr`, per class): `ok` means that on this account, on this deploy, a scratch copy of that class was put back to a bookmark and a row written after it was gone. It says the platform can rewind that class; it does not make a restore safe, and nothing offers one. `unsupported` means the runtime refused the API (as local development does): a whole-object restore would have to use §4.3. `failed` with a code means the API answered but the check did not hold; look at the code before trusting any restore.

**Design note for later: what a restore must solve first.** A restore of Core built in this round was withdrawn after a second read found three defects; any future restore must fix them before it ships:

1. **The past would run again.** Rewinding Core brings back every reminder, scheduled verb or plan and wake that was due in the rewound days as still pending, and the alarm fires them with no age check (`areas/reminders` deliver, `verbs/due.ts`): pushes ring again, verbs run again with their side effects, answered messages wait again. A restore needs a fence: on the first start after a restore, everything due before the restore's moment is marked missed, never fired.
2. **An armed restore can't be undone by calling it failed.** Once `onNextSessionRestoreBookmark` has answered, the object will rewind at its next restart whatever the code records after. A record written `failed: nothing changed` after the arm (a failed write, a tick that died) is a lie: the data rewinds later, silently, with the undo point lost and the phones never told. The record needs a state written before the arm that can only end as `done` (with the undo point) or `unknown, check it`, never `nothing changed`.
3. **Settings and the meter rewind too.** A Core restore rewinds the owner's settings (a switch such as the backup retention can turn itself back on) and today's meter row (the Free plan's counts). Those must be kept across a rewind (read before, written back after), or live outside the restored object.

Also open: Music's phone copy (the player's IndexedDB, merged newest-wins by `th/music/sync.js`) has no signal to drop itself after a Music restore, so the phone would push the newer data back.

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

- **When:** the first Sunday of each month, started by the Worker's tick once that day's weekly backup is complete (built, `areas/backups/drill.ts`). The same tick runs the point-in-time check (below). `mind-night` or `ci` can start one any time with `POST /v1/ops/drill/run`, which drills the newest complete backup.
- **What:** the latest complete backup of each part (Core, Music, the senses, Study; never Auth) goes into that class's own instance `drill-<YYYYMM>` (whose drill methods refuse on any other instance, and on Auth), a part a step on the bulk lane, each part's sha256 checked before a row of it is used. Tables over 30,000 rows are restored as a deterministic sample, every k-th row ([DATA.md §11.4](DATA.md#114-proof-that-backups-work)). The drill compares counts and part sha256 values with the manifest, writes `drills/<YYYY-MM>/report.json` (counts and names only), empties the instance with `deleteAll()`, and writes one ledger note, passed or failed with its first problems.
- **Pass:** every table's count and every part's hash match. The briefing shows one line only on failure. Deep health's `backups.drill` shows the last drill, its state and the parts it covered.
- **Point-in-time check** (`areas/backups/proof.ts`): at the first cron tick on a new deploy (a version tag the last check didn't run on) and with every monthly drill, on each class's scratch copy `pitr-proof` only (never the owner's objects, never Auth; the methods refuse on any other instance, and nothing callable arms a restore on a real object): a row, a bookmark, a marker row, `onNextSessionRestoreBookmark`, the restart, then the marker must be gone and the row before it there. The outcome per class (`ok`, `failed` with a code, `unsupported`) goes to one ledger note, Core's setting `backups.pitr` and deep health's `backups.pitr`; what it means is in §4.1. This settles X4 live.
- **Fail:** a watchdog `drill.failed` (§8). The agent opens a fix within the day. Weekly backups continue.

---

## 5. Worker deploy and rollback

### 5.1 Pipeline (`deploy.yml`: `test` → `api` → `site`)

The `api` job runs when `backend/**`, `shared/**` or `package-lock.json` changed since the deployed tag, or on dispatch with `target: api|both`.

1. Gate: `test` passed (§3.1; only a dispatched `api-rollback` skips it, since it puts back a version that already passed), `vars.WORKER_DEPLOY_ENABLED == 'true'`, ref `main`, the commit is an ancestor of `main`. It then decides, before installing anything, whether the Worker changed since the live tag; a push that leaves it as it is ends here in seconds.
2. `npm ci --ignore-scripts` (measured in the P1 spike: workerd and esbuild ship as optional platform packages, so their install scripts aren't needed; settles Q4). The tests ran once, in `test`.
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
   2. Poll `GET /v1/ops/health/deep` with `TH_CI_TOKEN` until `ok` and every object's `schema` and `expected` equal the newest migration step in the repo (`node scripts/schema-version.mjs --ready`; every 15 s, 6 min max, because DOs may run old code for a few minutes). Skipped with a notice while `TH_CI_TOKEN` is not set (the deploys before first setup). After a rollback the old code reports `ok` too (`schema >= expected`; migrations are expand-only). Each object runs every step whose version its `_migrations` doesn't hold, in number order, so a step merged after a higher one still runs; an object that lacks a step this code has reports it in its health's `missing` and deep health says not `ok`.
   3. `node --test tests/live-api.test.mjs` (read-only: health shape, CORS preflight, 401 without a token, 403 from a foreign origin).
7. Watch 10 minutes **[proposal]**: every 60 s, `GET /v1/ops/errors?status=open` counts server errors (`source` in `worker`, `do`) with `last_at` after the deploy. Fail at ≥ 5 of them, or at any error whose code is `internal` on an auth route.
8. On failure after step 5, when no class change happened: `npx wrangler rollback "$PREV" --config backend/wrangler.jsonc --message "auto rollback from <sha>" --yes`. Then re-run step 6.1 expecting the previous tag. A bootstrap run has nothing to roll back to.
   - First, `node scripts/rollback-guard.mjs` reads `wrangler deployments status --json`. It rolls back only over this run's own deployment, found by the version id that step 5 printed or by its `deploy <sha>` message. If `$PREV` is still live, nothing is rolled back. If a newer deployment by someone else is live, the run fails without a rollback, because a forced rollback past it would bring back the old secret values. Setting a secret in the dashboard makes such a deployment (SETUP.md K4). Check it, then use §5.2 if it is broken. When the status can't be read, the rollback runs as before.
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
| `AUTH_PEPPER` | Only on suspicion of a leak | Proposal (`access`). Agent: `rotate-secret.yml` (not built) with `generate: AUTH_PEPPER_V2`, after a deploy that accepts both peppers and re-hashes lazily at sign-in ([SECURITY.md §14.6](SECURITY.md)) | Hashes move to the new pepper as the owner signs in | Sign-in works; `pepper_v` = 2 on the credential |
| `IP_HASH_KEY` | Yearly | `rotate-secret.yml` (not built) `generate: IP_HASH_KEY` | Throttle counters reset | — |
| `AUTH_SETUP_FP`, `TH_SETUP_FINGERPRINT` | Clear after setup | Owner: run Open setup with `clear: true` (sets the Worker secret to `none`; never delete it), then delete the GitHub secret | None (`/v1/auth/setup` already answers 410) | — |
| Mind fire URL/token (per task) | When the task is recreated or on suspicion | Owner: in the scheduled task's API trigger, regenerate → paste into the Cloudflare dashboard as `ROUTINE_CHAT_TOKEN` and `ROUTINE_CHAT_URL` (or the `_NIGHT_`, `_REFLEX_` pair) | Old fires fail with 401 from the platform | Agent: `POST /v1/mind/typing` from a device fires a wake; the wakes list shows `fired` |
| `CLOUDFLARE_API_TOKEN` | Yearly (reminder in the October briefing) **[proposal]**, or on suspicion | Owner: Cloudflare → API tokens → Roll → paste into the GitHub secret | Deploys use the new token | Next Deploy run is green |
| `R2_SIGN_ACCESS_KEY_ID` / `R2_SIGN_SECRET` | On suspicion (rolling revokes every signed URL at once) | Owner: R2 → Manage API tokens → create (Object Read; the two buckets) → paste both into the Cloudflare dashboard (or `rotate-secret.yml copy`, not built) → delete the old token | Old URLs 403 at once; clients re-sign | Media plays after one 403 retry |
| Actions R2 keys | Yearly or on suspicion | Owner: create new → GitHub secrets → delete old | — | Next jobs run is green |
| `VAPID_PRIVATE_JWK` | On suspicion | Proposal; `rotate-secret.yml` (not built) with a P-256 JWK step | Every push subscription is dead; devices re-subscribe on next open | A test push arrives |
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
| **Senses' daily cap** (6,000 events a UTC day, DATA.md §6.1) | `PUT /v1/senses/batches` answers 429 `budget_exhausted` | Nothing to do: the phone holds its batch and sends after 00:00 UTC. A day that hits it often: find the type from `day_summary` and the sender that floods it |
| **DO rows written cap hit** | `429 budget_exhausted` on writes (the platform's refusal mapped by `http/errors.ts`, logged as `evt: budget_exhausted`); reads work; the phone says once that messages send after 00:00 UTC | The lane, the heavy jobs and the phone's senses, marks and playlists pause on their own from 80% of the day's written budget (54,400, §8.2); find the object from `GET /v1/ops/meter` and the table from the cost tests; fix the job or query; writes resume at 00:00 UTC. The outbox and the CLI keep retrying after `Retry-After` |
| **DO rows read near or at the cap** | `quota.rows_read` tripped, the Briefing line, the push at 80%; at the cap every object request fails until 00:00 UTC | From 80% the heavy work already waits (§8.2). `th health` and `th get /v1/ops/meter days=2` show which object reads most. Find the scan (`EXPLAIN QUERY PLAN` tests must have missed it) or the count that reads every row (2026-10-31: the Music object counted its catalog per song); add the index under the expand rule |
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
| API | ≤ 10 server errors (5xx) per day **[proposal]** (counts, because the Worker can't afford to count every request). **Not built:** no rollback on 5xx after a deploy; what rolls the Worker back is the deploy's own smoke check (§5.1) | `Core.errors` |
| Chat | Warm reply p90 < 15 s; cold reply p90 < 90 s; an unclaimed wake after 240 s is shown honestly | `messages`, `wakes` ([RUNTIME.md](../mind/RUNTIME.md)) |
| Night shift | Done by 09:00 local on ≥ 6 nights of 7 | `wakes` (role night) + day note `written_at` |
| Budgets | No day's Free-plan budget above 60% (the limits less the old Worker's share: 4,800,000 rows read, 68,000 written) | `meter_days` (DATA.md §3) |
| Backups | Newest complete backup < 8 days old; monthly drill passes | manifests, drill reports |
| Phone | INP p75 ≤ 100 ms; no gesture LoAF > 50 ms ([PERFORMANCE.md](PERFORMANCE.md)) | `perf_days` |

**CPU on the Free plan (10 ms a request).** Live 13–20 Nov 2026: p90 10–16 ms, p99 21–37 ms; Muse's `POST /v1/work/claim` was 78% of sampled requests at 15 ms on average. A claim within 5 minutes of an empty answer is answered by the isolate without Core (`areas/work/poll.ts`); since 2026-11-21 a claim that reaches Core while nothing is open makes no database call once one has looked (`areas/work/store.ts` `idle`, cleared by any write to an order, at most an hour old): 0 calls and 0 rows instead of 3 calls and 1 row, the same `204` with no body. No other route runs on a timer to ask whether anything waits (the phone's timed calls, Music's report a minute and Podcasts' place while playing, carry data).

### 8.2 Watchdogs (`Core.tick`, every 15 min)

Up to P3, a tripped watchdog writes a ledger note and a line in the mind's briefing. From P4 it also wakes `mind-reflex` (≤ 4 wakes a day). Since 2026-11-21 every open trip is also a line on the owner's Briefing page, and the serious ones go in the day's one bundled push (§8.5).

| Name | Trips when | Action |
|---|---|---|
| `quota.rows_written` | Rows written today across the five objects ≥ 40,800 (60% of the 68,000 the Free plan's 100,000 leaves after the old Worker's 32,000) | S3; from 80% the heavy work waits (below) |
| `quota.rows_read` | Rows read today ≥ 2,880,000 (60% of the 4,800,000 the Free plan's 5,000,000 leaves after the old Worker's 200,000) | S3; from 80% the heavy work waits (below) |
| `quota.do_calls` (not built) | Object calls today ≥ 60,000 | S3 |
| `errors.spike` | ≥ 20 new server errors in 60 min, or ≥ 5 of one fingerprint in 15 min (the Worker's `onError` records each unexpected 500 in the error inbox as source `worker`, fingerprinted by route and error name, never the message, at most 5 an isolate in a minute: `http/report.ts`) | S2 if on auth or messages, else S3 |
| `client.errors` | ≥ 50 client error reports in 60 min | S3 |
| `backup.stale` | Newest complete backup > 8 days | S3 |
| `drill.failed`, `drill.overdue` | Last drill failed, or none for 35 days | S3 |
| `roll.stuck` | `day.current` is more than 30 h old | S2 |
| `night.late` | No day note for yesterday by 09:00 local | S3 |
| `reply.late` | An owner message unanswered for more than 30 min, outside quiet hours | S3 |
| `jobs.stuck` | A job `running` > 2 h, or `attempts` ≥ 5 | S3 |
| `db.size` | Any object > 700 MB | S3 |
| `events.export.late` (P5) | Day D not archived by D+1 09:00 | S3 |
| ~~`muse.silent`~~ (removed 2026-11-03) | Muse now polls for tasks ([MUSE-PROTOCOL.md](MUSE-PROTOCOL.md)); an order it leaves shows its age in the menu's Tasks, and the Briefing still says "Muse hasn't checked in since yesterday." after 26 h | — |

Acceptance: each watchdog has a vitest case that sets the condition with fixtures and a fake clock and asserts exactly one ledger note per trip (no repeat until it clears and trips again).

**Built 2026-10-31 (the rows-read guard):** `quota.rows_read` and `quota.rows_written`, in `areas/meter/checks.ts`, on the stored per-day meter (DATA.md §3): each object keeps its UTC day's rows in its own `meter_days`, and the tick gathers them into Core's before the checks. Both count against the day's budget, the Free plan's limits less `OLD_WORKER_RESERVE` (`shared/contract/meter.ts`: the old Worker's measured 180,000 rows read and 32,000 written a day, which the meter can't see; both drop to 0 when it retires, SETUP.md N5, M4). A trip's detail names the level it passed (60%, then 80%), so it writes once and once more at 80%, and it clears on the first tick of the next UTC day. From 60% the Briefing page and the mind's briefing (section 1) also say so in one line. From 80% the owner gets one push that UTC day (kind `quota`, id `quota-<day>`; a system alarm, so like a sign-in notice it is outside the 2-a-day budget, goes through "go quiet" and waits only for quiet hours, and is dropped at 00:00 UTC), and the heavy work waits for 00:00 UTC: the weekly backup's and the drill's jobs and every bulk-lane job (the import of the old data too) pause before their next step (so a drill stops between two parts; its writes into the scratch copy are added to the day's meter as class `scratch`, and a backup part's reads in Music, the Senses or the Library to that class's row, as each step ends), the senses archive skips its ticks, and the upload tools' operations answer `429` with `Retry-After` (their check brings Music's own day). The hold reads Core's own meter live. Not counted: the drill copy's reads, the eval sandbox. A meter that can't be read holds nothing and breaks nothing. The phone, the mind's chat and "download everything" are never held. `quota.do_calls` stays deferred: an RPC reaches its method directly, so an object has no one place to count its calls. **Built in P4 stage E:** `backup.stale` (from the first complete backup on), `drill.failed` and `drill.overdue` (35 days without a drill since the first backup), in `areas/backups/checks.ts`. **Built in P4 stage D** (the registry is `shared/contract/watchdogs.ts`; [CONTRACT.md](CONTRACT.md#watchdogs) lists each with what it waits for): `errors.spike`, `client.errors`, `roll.stuck`, `night.late` (once the night shift is connected), `jobs.stuck` and `db.size`. `backup.stale` and the two drill watchdogs waited for the backups (stage E) and `muse.silent` for Muse on work orders (stage G); `events.export.late` waits for P5. `GET /v1/ops/watchdogs` shows each one's state (`ok`, `tripped`, `later`), the SLO it guards and, while tripped, since when, what the check saw (counts and names only) and the reflex's report. A trip writes one ledger note and puts one line in every mind briefing (section 1, and Health); a watchdog whose state and counts didn't change writes nothing on a tick.

**mind-reflex** (RUNTIME.md §3; SETUP.md M2 connects it): a trip of a watchdog that wakes it fires the task after the tick's commit, at most one open wake and 4 wakes in any 24 hours. The session runs `th reflex`, which prints the procedure and each tripped watchdog's handling: look first, the one change it may make is a revert of the commit behind an errors spike, everything else is reported, never fixed. It reports each trip with `th handled <name> --outcome fixed|reported|nothing --note …` (a ledger note), and the Stop hook keeps it going until each one has its report. **A drill** checks that path on the live Worker: when the owner asks, the chat session runs `th drill <name>` (or the owner's device calls `POST /v1/ops/watchdogs/:name/drill`); the watchdog trips with the detail "a drill: tripped by hand, nothing is wrong", wakes the reflex the same way, and holds until the reflex has reported it, or for an hour.

### 8.3 What the phone reports

- **Errors** go to Core's `errors` inbox (`POST /v1/ops/errors`, API.md §11.16), one row per fingerprint, read with `th errors` and counted by `client.errors`. Signed in and top-level only, from every page: the five ported pages through `assets/error-report.js`, and the shell's own pages (home with its route copies, and Study) through `ui/errors.js`, built 2026-10-31 (NEXT-BATCH.md part 1). Both cut every address in a message to its host and say where in the site's code it came from instead of a stack; the shell's also cuts quoted text and `/patterns/` (browsers quote what was typed in their own errors), sends a thrown or rejected value that isn't an Error by its kind only, gives each distinct error its own fingerprint (its kind, words and place), so they don't fold into one row, counts a repeat in the same batch, and sends 2 s after the last error or when the page is hidden: at most 3 of one error and 20 in all a page load.
- **Playback** goes to Core's `reports` table (`POST /v1/ops/reports`), one row per batch, kept 30 days and read with `th reports`: Music's playback log, what the Worker hasn't taken yet, once a minute while music plays and once when the page is hidden, one batch at a time ([MUSIC.md §5.10](../product/apps/MUSIC.md)). Only the known fields of a batch (timings, counts and track ids), on the phone and again on the Worker; never readable by CI. A batch with no answer, 408, 429 or 5xx goes again after a growing wait (an event sent twice keeps its page and number, and `th reports` counts it once); after 401 or 403 nothing goes until the session changes. One batch is one row written and none read; a list reads the rows it returns, at most 512 KB a page; a device may send 6 in any 5 minutes (then 429 with Retry-After).
- **`perf_days`** (`POST /v1/ops/perf`) is built, but no page sends it yet: its daily summaries wait for the phone's performance senses (PERFORMANCE.md §5).

### 8.4 The listening pass (JOBS.md §3)

**Cut 2026-11-04** ([SETUP.md N6](../process/SETUP.md), which says which pieces to remove): no `Jobs · audio` workflow exists and nothing below runs; kept for the record.

- **Each night** `th music jobs` (night step 6) collects any job issued over 6 hours ago, asks for the next (≤ 500 songs, then the neighbours step) and starts **Actions → Jobs · audio** with the job's id. Its output says how many it collected by state, what it issued and whether GitHub took the dispatch.
- **Watching it:** the run page (counts and timings only: `spec:`, `analysed: N of M`, `done: N ok, N failed, N s`, `collect:`); `th get /v1/jobs open=1` or `th get /v1/jobs/<id>` (state and counts by reason, never a hash); the job's rows show in the meter as Music's day and on the bulk lane (`GET /v1/ops/meter`); Core's apply job in deep health's `jobs_backlog`, and `jobs.stuck` if it keeps failing.
- **Re-running:** a run that failed before collecting: nothing to do, the next night collects it or (no manifest) it expires 72 h after issue and its songs are offered again. To run one again at once: Actions → Jobs · audio → **Run workflow** (branch `main`) with the same job id while it is still `issued`; if the first run got as far as its manifest, collect instead (`POST /v1/jobs/<id>/collect`), since parts are refused once a manifest is there. A job whose apply failed for good is rejected by `music.listen.reject` (reason `apply_failed`), its files deleted; one still `validating` 6 hours after its collect is collected again by the night, which queues its apply again (idempotent). Files a failed delete left are swept when the next job is asked for. The night may issue at most three jobs of a kind in 24 hours. A job `rejected`: its songs stay due and go in a later job; look at the run's log for the `fail:` line.
- **Stopping it:** delete the `jobs` environment or the R2 token (SETUP.md N6); the Worker side stays idle with no runs.
- **Analysing everything again** (a new analyzer version): it happens by itself (every song is due when its stored version differs), at the same cost as the first pass (≈ 25,000 rows over ≈ 24 nights, then the neighbours).

### 8.5 What the owner is told (built 2026-11-21)

The owner uses only the site; nothing here waits for a person or a dashboard. The words live in `backend/src/areas/watchdogs/owner.ts` and `shared/contract/watch.ts`.

- **Every open trip on the Briefing.** Under one quiet heading, "Not working right", one plain line per tripped watchdog, saying what is wrong and whether anything is needed (`GET /v1/briefing` `alarms`); gone on the tick it clears. The quota trips keep their own line (§8.2); a drill is not a line. Lines: `errors.spike` "The server is failing more often than usual. Nothing needed from you."; `client.errors` "The site is hitting errors on your phone more than usual. …"; `roll.stuck` "Yesterday hasn't been closed off, so today's pages may be behind. …"; `night.late` "The night shift didn't finish last night. …"; `jobs.stuck` "A background task is stuck. …"; `db.size` "Storage is getting full. Nothing is lost, but something will need deleting soon."; `backup.stale` "The weekly backup hasn't run for over 8 days. Your data is still here. …"; `drill.failed` "The last backup check failed. Your data is still here. …"; `drill.overdue` "The monthly backup check is overdue. …"; `reply.late` "A message has waited over 30 minutes for a reply. It's kept. …".
- **The day's bundled push.** Serious conditions: `backup.stale`, `drill.failed`, `roll.stuck`, `errors.spike`, `db.size`, `jobs.stuck`, `night.late` three nights running (no day note and no finished run for each), and the mind unable to answer for 24 hours. On the owner's day one of them becomes serious, Core offers one push (kind `alarm`, id `alarm-<day>`): one condition says itself ("Storage is getting full. More on the Briefing."), more say "2 things aren't working right. More on the Briefing.". Like the quota push it is outside the nudge budget, goes through "go quiet", waits for quiet hours to end and is delivered then; a condition that lasts pushes once.
- **The Worker's heartbeat.** The cron runs each step on its own (sign-in tidy-up, Core's tick, calendars on the roll, approvals, pushes, the Drive photos pass) and ends by writing Core's setting `ops.cron` `{at, failed}` (one row a run, 96 a day). Deep health (`GET /v1/ops/health/deep`, `watch`) carries the last cron, the last day roll, schema steps any object is missing, the mind's state, whether a push can reach a phone (the VAPID key set and a signed-in phone subscribed) and the owner's lines. Home asks for it on opening (at most once a minute, `frontend/th/briefing/watch.js`) and the Briefing shows its lines even when no push came. A cron not seen for 45 minutes is a line ("The 15-minute background check hasn't run since 14:05, so reminders and pushes may be late. Nothing needed from you."), and so is a step that failed in its last run ("The last background check couldn't finish the Google Drive photos pass. It tries again every 15 minutes.").
- **The mind's state.** While its presence says it can't answer (`limited`, `unconfigured`, `failed`) since its first unclaimed wake after it last answered, for 2 hours: one line on the Briefing and at the end of the chat, gone when it answers: "The mind hasn't answered since 14:05: it reached the plan's limit until 18:00. Music, reminders and the rest still work, and your messages are kept." (or "its routine isn't set up", "it couldn't be started"). How the mind is woken is unchanged.
- **The outside watcher** (`live-watch.yml`, every 30 minutes). A failing check fails the run, so GitHub's own failed-run notification goes out; the issue names no person. The site and the Worker are checked apart: the site failing twice running while the Worker answers makes the `tell` job post `POST /v1/ops/site {state: down}` with the CI key (environment `worker`, secret `TH_CI_TOKEN`, no new secret; the route admits only the CI principal, everyone else 403), and the Worker pushes the owner once (kind `site`): "The site isn't loading. Your data is safe."; the first passing run after a failure posts `up`, and the Worker pushes "The site is loading again." once, only if it had said it was down. **When the Worker itself is down, only GitHub can tell**: the failed run and its notification, and the issue, are all there is; nothing reaches the phone.
- **Keeping the schedule alive.** GitHub disables a public repository's scheduled workflows "when no repository activity has occurred in 60 days" (docs: Disabling and enabling a workflow). On the 1st of each month the `keepalive` job calls the REST API's "Enable a workflow" (`PUT /repos/{owner}/{repo}/actions/workflows/live-watch.yml/enable`, job permission `actions: write`). GitHub's documentation does **not** say that enabling an enabled workflow resets the 60-day count (checked 2026-11-21: it says only that a disabled workflow can be re-enabled, and that a commit changing the cron reactivates one); community practice relies on it, unconfirmed. If the schedule is disabled anyway, the Briefing still shows every Worker-side line (the cron's heartbeat is the Worker's own), and the watcher's site check stops until someone runs the workflow or re-enables it (Actions → Live watch → Enable workflow). A better guard, not built: the Worker's cron reading the workflow's public `state` (`disabled_inactivity`) and adding a line.

### 8.6 The list for the builder (built 2026-11-22)

For the months nobody builds, what annoys the owner or breaks waits in a dated list ([API.md §11.30](API.md)): the owner says so in the chat and the mind files it (`th issue add`, citing the owner's message), or the owner adds one in Settings › For the builder. Each item keeps the owner's words, where it happened, how bad, the message it came from, the Worker's commit then and the newest matching error or report. A building session starts by reading the open items, newest first, in one of three ways:

- **From the owner:** Settings › For the builder › **Copy all** copies the open list as plain text, to paste into the session.
- **With a mind key** (a session whose `th` reaches the Worker): `th issue ls` (open), `th issue ls --state all`; `th get /v1/issues/<id>` for one with its notes.
- **With the ci key:** `GET /v1/issues` with `Authorization: Bearer thc_…` and `TH-Client: ci/<build>`. The list holds the owner's own words: read it into the session only, never into an Actions log, a commit or a pull request (this repository and its logs are public).

When the work lands, the owner marks the item done in Settings (or the session adds a note with `th issue note <id> "<text>"` saying which pull request should fix it). Nothing is ever deleted.

---

## 9. Routine checks

| When | What | Who |
|---|---|---|
| Every 15 min | Watchdogs; day roll; alarms re-armed | `Core.tick` |
| Daily | Meter vs caps; errors; wakes claimed/unclaimed; yesterday's `perf_days`; prune jobs | Worker; `mind-night` reads them into the briefing only when something is off |
| Each deploy | Site and API live checks | `deploy.yml` |
| Every 30 min | The read-only live checks (`tests/live.test.mjs`, `tests/live-api.test.mjs`, apart); two failed runs in a row open one issue, "The live site check is failing" (names and the run's link only), a pass closes it; a failing run is red; the site down while the Worker answers, and back, is told to the Worker, which pushes the owner (§8.5); monthly, the workflow re-enables itself | `live-watch.yml` (`scripts/live-watch.mjs`) |
| Weekly (Sunday) | Per-class backup at 02:30 local (built: the tick starts `export.weekly` for Core); profile snapshot; evals ([EVALS.md](../mind/EVALS.md)); a one-line ops summary in Monday's briefing | Worker, `mind-night` |
| Monthly | Restore drill (first Sunday, started by the tick after the backup; built); Dependabot PRs (grouped) merged when green; owner glances at the Cloudflare dashboard for R2 storage and Class A/B operations (about 1 min) | `mind-night`, agent, owner |
| Every 180 days | Agent token rotation reminder | briefing |
| Yearly (October) | `CLOUDFLARE_API_TOKEN` rotation; Node LTS move; review of action pins and the dependency list | owner + agent |

---

## 10. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| X1 | Worker-held WebSocket to a hibernating DO for `/v1/live/wait`: works, unbilled while waiting, and through the session proxy | Bench workflow, test `x1` (100 takes from Actions; with `keep`, DO duration in the dashboard); the session-proxy leg needs a `th-chat` session once `/v1/live/wait` exists (P2) |
| X3 | DO CPU limit on Free (10 ms vs 30 s); scrypt cost at the edge | Bench workflow, test `x3` ([SECURITY.md §6.3](SECURITY.md)) |
| X4 | PITR available on Free | Settled live by the point-in-time check (§4.4) at the first tick of each deploy: deep health `backups.pitr`. Local tests can't (the API is not supported in local development) |
| Q1 | Does a step guarded by `cancelled()` get time to finish after `timeout-minutes` cancels the job? | Force a cancel once in a test repo |
| Q2 | Does `wrangler deployments status --json` give the active version id directly? | Run it in the first `api` deploy; adjust step 4 |
| Q3 | Does `wrangler secret bulk` from stdin work in Actions without a TTY? | First `rotate-secret.yml` run with a dummy secret |
| Q4 | Is `npm ci --ignore-scripts` safe once wrangler, workerd and esbuild are installed? | Try it in CI; if `wrangler --version` works, use it everywhere |
| Q5 | (Settled 2026-11-01: no `thunderhead-jobs` bucket; the listening pass's uploads go through the Worker and it deletes them, JOBS.md §3.) | — |
| Q6 | Are R2 bucket locks free, so `native/audio/` could be locked against deletes? | Owner checks; if free, propose it (`access`) |
