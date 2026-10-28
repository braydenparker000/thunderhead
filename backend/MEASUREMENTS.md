# P1 measurements (local workerd)

Measured 2026-10-28 on the P1 spike (§1, §3–§5) and again after the contract rework (§2, bundle), in **local workerd 2026-10-23** (wrangler 4.154.0,
`@cloudflare/vitest-plugin` 1.4.9, Node 22.22) on a 4-vCPU Intel Xeon @ 2.10 GHz. Nothing was
deployed. Every number here can be reproduced with `npm test -w backend` (cost, accounting) or
`npm run bench -w backend` (timing).

**Caveats that apply to everything below**
- Local CPU is not edge CPU. Cloudflare's machines may be faster or slower (perhaps ±30%).
- Local workerd does not enforce the free plan's CPU limits. Whether a SQLite Durable Object
  on Free gets 10 ms or 30 s of CPU per request is still unknown: **test X3 must run in
  production** (a preview Worker, `cpuTimeMs` read from Workers Logs) before sign-in ships.
- Row counts come from `cursor.rowsRead/rowsWritten` in local workerd. That production billing
  counts the same way is likely but unverified (report 2 §10 #11: compare with the dashboard).

## 1. Password hash inside the Auth object

Wall time measured by the test around an RPC into the Auth object (`tests/integration/kdf-timing.test.ts`),
5 runs each, two separate runs of the file. Medians:

| Work | Run 1 | Run 2 | Spread of single runs |
|---|---|---|---|
| Empty RPC into the object (overhead) | 2 ms | 2 ms | — |
| scrypt N=2^14, r=8, p=1 (16 MiB) — the X3 fallback | 41 ms | 43 ms | 39–58 ms |
| **scrypt N=2^15, r=8, p=3 (32 MiB) — decided** | **264 ms** | **257 ms** | 238–292 ms |
| `POST /v1/auth/signin` (now `/login`), end to end through the Worker | 256 ms | 272 ms | 244–284 ms |

From outside, `curl` against `npm run dev` (local `wrangler dev`): setup 302 ms; seven sign-ins
231–267 ms; `GET /v1/health` 4.5–6 ms.

What this says:
- It matches report 3's 235 ms for 2^15/8/3 in workerd. The request cost is the hash; the
  Worker, RPC, SQL and HMAC around it add a few ms.
- **Both settings are far over 10 ms.** If X3 finds that Free Durable Objects get 10 ms, the
  fallback in the review (2^14/8/1) does not fix it either: it is still ~4× over. See Finding 1.
- Clocks: in **local** workerd, `performance.now()` *does* advance during synchronous CPU work
  inside the object (it read 253–260 ms around the 2^15/8/3 hash). Production freezes it
  (Spectre mitigation), so in-code timing works only locally; the production number must come
  from Workers Logs `cpuTimeMs`. In vitest-plugin tests, `Date.now()` advances across awaits, so
  wall-clock timing from the test side works.

## 2. Rows read and written per endpoint

From the objects' own meters (`tests/cost/cost.test.ts`, against `tests/cost/budgets.json`, whose
maxima are these measured numbers; Auth object unless noted). Re-measured after the rework:
setup now also writes the recovery row and the used setup ticket, and sign-out marks rows
revoked (kept 30 days so an old token learns why) instead of deleting them.

| Call | Rows read | Rows written |
|---|---|---|
| `GET /v1/auth/state` | 1 | 0 |
| `POST /v1/auth/setup` | 8 | 4 |
| `POST /v1/auth/login` (ok, 1 other session, so 1 `new_device` notice) | 6 | 6 |
| `POST /v1/auth/login` (wrong) | 2 | 2 |
| `POST /v1/auth/login` (429, backing off) | 3 | 0 |
| `GET /v1/auth/sessions`, token not yet cached (3 sessions) | 7 | 0 |
| `GET /v1/auth/sessions`, token cached (3 sessions) | 6 | 0 |
| `GET /v1/auth/me` (device, cached; reads notices) | 8 | 0 |
| `POST /v1/auth/signout {this}`, not cached, hourly renewal due | 8 | 2 |
| `POST /v1/auth/signout {this}`, not cached | 8 | 1 |
| `POST /v1/auth/agents` (password check, key, notice) | 9 | 5 |
| `GET /v1/auth/me` (agent key, not cached; hourly `last_used_at`) | 2 | 1 |
| `DELETE /v1/auth/sessions/:id`, cached | 8 | 1 |
| `POST /v1/auth/signout {others}`, cached | 10 | 2 |
| `POST /v1/auth/recover` (wrong) | 5 | 2 |
| `POST /v1/auth/recover` (ok, 1 other session) | 24 | 9 |
| `GET /v1/health` | 0 | 0 (no object touched) |
| `GET /v1/ops/health/deep` (Core) | 1 | 0 |
| `POST /v1/ops/errors`, one item (Core; error row + change row) | 0 | 2 |
| `GET /v1/settings` (Core) | 1 | 0 |
| `PATCH /v1/settings`, one key (Core; setting + change row) | 0 | 2 |

- Authentication itself costs **1 row read** once per token per isolate-minute (2 for an agent
  key: the `UNIQUE` token-hash index), and **1 write at most once an hour** per session or key.
- Within PERFORMANCE.md §4.3: login 6 read / 6 written against 10 / 6; deep health 1 against 50.
- Revoking scans the sessions table (no index on `id`, by design): reads grow with the number of
  rows kept (active plus 30 days of revoked), a few dozen at most for one owner.
- Guessing is bounded: once the account floor engages (20 failures/day), at most one attempt
  per 30 s gets through (≈2,900/day × 2 writes ≈ 5.8k writes, 6% of the free 100k), and every
  refused attempt costs 0 writes.

### SQLite accounting facts (pinned in `tests/cost/accounting.test.ts`)

| Statement | Rows read / written |
|---|---|
| INSERT into a `TEXT PRIMARY KEY` rowid table | 0 / **2** (table + hidden PK index) |
| INSERT into a `WITHOUT ROWID` table | 0 / **1** |
| INSERT into an `INTEGER PRIMARY KEY` table | 1 / 1 |
| INSERT with one secondary index | 0 / 2 (every index entry is a write) |
| UPDATE of an indexed column by PK | 1 / 2 |
| UPSERT hitting the conflict, no index | 0 / 1 |
| DELETE or SELECT of a missing row | 0 / 0 |
| `SELECT count(*)` over 101 rows | **101** / 0 (a billed full scan) |
| `DROP TABLE` holding 101 rows | ~9–11 / **0** |

So: every Auth table is `WITHOUT ROWID` keyed by its hot lookup; device ids get no index (a
scan of a handful of rows beats a write on every sign-in); `count(*)` must not be used on
tables that grow (deep health's `open_errors` count will need a stored counter once the error
inbox is large); and report 2's "monthly event tables + DROP" prune is confirmed cheap.

## 3. Does `@cloudflare/vitest-plugin` run the classic migrations?

**Yes.** `@cloudflare/vitest-plugin@1.4.9` is the current name (`@cloudflare/vitest-pool-workers`
0.23.0 is deprecated, "renamed to @cloudflare/vitest-plugin"). Configured with
`cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })`, it reads the classic
`migrations: [{ tag: "v1", new_sqlite_classes: ["Core", "Auth"] }]`, and both objects get
`ctx.storage.sql` (SQLite) with `databaseSize > 0`. `runInDurableObject`, `evictDurableObject`,
`createScheduledController` and `exports.default.fetch` all work. Our own `_migrations` steps run
once and are not re-run after an eviction (`tests/integration/objects.test.ts`); the resulting
schema is pinned in `tests/migrations/*.schema.sql`.

Two behaviours to know:
- **Storage is isolated per test file, not per test** (the README says "per-test"). Tests in a
  file share one database, so each file is written as an ordered scenario.
- `ctx.storage.getCurrentBookmark()` works locally but returns an all-zero placeholder. Whether
  PITR bookmarks work on Free is still test X4 (production).

## 4. Decision X5: TypeScript `checkJs` importing `.ts` contract types

**Works with TypeScript 5.9.3**, with no build step and no `allowImportingTsExtensions` in the
root (frontend) config. (The backend config now sets it, only so `vitest.config.ts` can import
the synthetic fixtures by their `.ts` path.)
`frontend/th/api.js` (`// @ts-check`) imports its types with
`/** @typedef {import('../../shared/contract/api.ts').LoginRequest} LoginRequest */`, and the
root `tsconfig.json` (`allowJs`, `checkJs`, `strict`, `moduleResolution: bundler`) checks it.
The check is not vacuous: `tests/fixtures/contract-drift.js` (a misspelt field and a wrong
member type) is rejected with TS2561 and TS2551, and a wrong path with TS2307
(`tests/contract.test.mjs`). The backend checks its zod schemas and responses against the same
types with `satisfies`. The `.d.ts` fallback is not needed.

## 5. Other facts checked

- `nodejs_compat` really is on by default at compatibility date 2026-10-15: `node:crypto`
  scrypt works with the flag removed (fact-check C33). The flag stays listed for clarity.
- `npm ci --ignore-scripts` is enough: workerd and esbuild ship their binaries as optional
  platform packages, and their install scripts only verify them. All tests here ran on an
  install made with `--ignore-scripts`.
- Bundle: the spike bundled to 483 KB minified (108 KB gzipped), **zod 443 KB of it**. After the
  switch to `zod/mini` and with every P1 route, `wrangler deploy --dry-run` reports
  **192 KB (48 KB gzipped)** (Finding 4, done).

## Findings (things that should change a decision or a plan)

1. **The X3 fallback does not fit 10 ms either.** (Since settled in decisions 2026-10-28: the
   client-side KDF fallback of SECURITY.md §6.4, $0.) scrypt 2^14/8/1 took ~40–50 ms here; any
   memory-hard setting worth having is over a 10 ms budget. If X3 shows Free Durable Objects
   get 10 ms, the real choices are: (a) keep 2^15/8/3 and rely on the documented "flexibility
   for infrequent overruns" (sign-in happens a few times a month; watch for error 1102), or
   (b) Workers Paid ($5/month, an owner money question). Lowering the setting does not get
   under 10 ms. Recommend: run X3 first exactly as report 3 §1.1 describes; decide (a) or (b)
   from its p99.
2. **`secrets.required` in wrangler.jsonc changes how secrets behave** (now decided: every name
   listed, `none` = absent, bootstrap file in the deploy run; built), both ways:
   `wrangler dev` loads from `.dev.vars` only the secrets listed there (an unlisted optional
   secret is silently missing — local setup answered 503 until `AUTH_SETUP_SHA256` was listed),
   and `wrangler deploy` refuses to ship if a listed secret is missing, so a brand-new Worker
   must be deployed with `--secrets-file`. Consequences, now built in: both `AUTH_PEPPER` and
   `AUTH_SETUP_SHA256` are listed; the first deploy generates the pepper inside the workflow and
   hashes the owner's `AUTH_SETUP_CODE` into a temporary secrets file; and the setup hash stays
   after setup (harmless: setup is closed once a credential exists). Recommend recording this
   bootstrap as the decision (no Cloudflare credential in any Claude session; no
   `wrangler secret put` by anyone).
3. **The pepper can be overwritten by a mistaken "first deploy"**, which would lock the owner
   out (passwords and the recovery code are both keyed by it). The workflow therefore needs a
   second, explicit signal (`WORKER_BOOTSTRAP=true`) before it ever generates a pepper.
   Recommend keeping that guard and adding the pepper to `docs/SECURITY.md`'s inventory as
   "never rotated without a planned password reset".
4. **zod 4 classic is not tree-shakable** (done: `zod/mini`, 192 KB bundle): 443 KB of a 483 KB bundle; `zod/mini` compiled the
   same kind of schema to 14 KB. No limit is hit (no compressed-size limit; startup ≤1 s), but
   Cloudflare's own limits page warns about zod memory. Recommend switching the import to
   `zod/mini` (same package and version, decision unchanged) before P2 adds many schemas.
5. **Recovery's account-wide limit can lock the owner out of recovery for a day.** (Done:
   30 s × 2^(n−20) up to 5 min, per decisions 2026-10-28.) Report 3
   gives "20 per day account-wide" for recovery codes; it is built that way, but it breaks the
   "an attacker can only make the owner wait 30 s" principle for the one path used when the
   password is lost. Recommend a 30 s–5 min floor (like sign-in) instead of a 24 h block.
6. **`npm install` with npm 10.9 (Node 22) crashes** adding the workspace
   (`Cannot read properties of null (reading 'edgesOut')`); npm 11 (Node 24, what CI uses)
   works, and `npm ci` works on both. Recommend: make lockfile changes with npm ≥ 11
   (`npx npm@11 install …`), and say so in AGENTS.md.
7. **`count(*)` is billed per row** (101 reads for 101 rows). Deep health's open-error count is
   fine now but should become a stored counter before the inbox grows; add a cost test per
   hot query, as planned.

8. **Docs: places where the contract is contradictory or silent** (found while building it; the
   code does what is written after "Built"; `main` was not edited). Exact fixes:
   - **API.md §11.1** says `/v1/health` makes no DO call yet returns `min_client`, a Core
     setting. Built: the isolate's cached value (≤ 60 s old, 0 before the isolate first reads
     it); the write check itself always reads Core when its cache is stale. Fix: append to
     §11.1 "`min_client` is this isolate's cached copy of the Core setting (≤ 60 s old; 0 until
     first read). The same value is sent as `TH-Min-Client`."
   - **API.md §6** says 429's "body" has `retry_after` and `scope` without saying where. Built:
     inside the envelope, `{"error":{"code":"rate_limited",…,"retry_after":8,"scope":"source"}}`.
     Fix: in the §6 table row for 429, write "`error.retry_after` (s) and `error.scope`".
   - **API.md §11.2 / SIGN-IN.md §7.1**: `POST /v1/auth/recovery-code/confirm {last5}` must be
     checked by the server, but DATA.md §5's `recovery` row stores only the code's HMAC. Built:
     `recovery.last5_hash BLOB` = HMAC(pepper, "last5:" + last 5). Fix DATA.md §5 `recovery`:
     add `last5_hash BLOB` after `code_hash BLOB`.
   - **DATA.md §5 `agents.name TEXT UNIQUE`** would stop a rotated key from taking its old name
     back ("make a new key … revoke the old one", SIGN-IN.md §17). Built: unique among active
     keys, checked in code, no SQL `UNIQUE`. Fix: "`name TEXT` (≤ 32, unique among keys with
     `revoked_at IS NULL`)".
   - **DATA.md §5 `throttle`** lists kind `reset` without a rule. Built: `reset:acct` counts
     break-glass tickets (SIGN-IN.md §10.1, 3 in 30 days); reset codes typed at `/recover/`
     count under `recover` (one endpoint, and the code's kind is unknown before it is checked).
     Fix the `throttle` note: "`reset:acct` counts tickets requested through `POST
     /v1/auth/breakglass` (3 per 30 days); reset codes count as `recover`".
   - **API.md §11.2 `GET /v1/auth/state`**: "reset fields only when `reset_fp` matches a ticket"
     conflicts with the value `'none'` (and §10.3's "Not seen yet"). Built: with `reset_fp` and
     no matching ticket, `reset: 'none'`. Fix: "(reset fields only when `reset_fp` is given;
     `'none'` when no ticket has it)".
   - **SIGN-IN.md §4.1 step 3** hashes "`setup_code`", but a reset code may be typed by hand
     (§10.1 "write it down"). Built: the fingerprint is over the code's normalized form (25
     Crockford characters, upper case, no hyphens; §7.1 folding); the browser must hash the
     same form. Fix §1 "Fingerprint": "`thfp_` + base64url(SHA-256(code)), where code is the
     25 characters as made (upper case, no hyphens)".
   - **SECURITY.md §5.1** does not say what the CRC32 covers. Built: CRC32 of `<prefix>_<43
     random>`, so a prefix swap fails the checksum; 6 base62 digits, big-endian, zero-padded.
     Fix: add that sentence to the "Owner session" row.
   - **API.md §11.2 `POST /v1/auth/password` → `200 {token?}`**: nothing says when a token
     comes back. Built: never (sessions are not bound to the credential version), so `{}`.
     Fix: "`200 {}`" (or define the case).
   - **API.md §1 / §5** say every request sends `TH-Client` but not what happens without it.
     Built: only a site-format `<build>.<sha7>` header is checked against `min_client`; a
     missing header or `th/…`, `ci/…`, `muse/…` is not. Fix §5: "Writes whose `TH-Client` is a
     site build below `min_client` …".
   - **OPERATIONS.md §2** var row lacks `AUTH_HIBP` (`on`|`off`; the breach check, off in tests).
     Fix: add it to the `wrangler.jsonc` var row and to SECURITY.md §11's note on vars.

## Contract conformance (after the rework)

Built against `main` at `4b4bd2f` (API.md, DATA.md, SECURITY.md, SIGN-IN.md, TESTING.md,
OPERATIONS.md, decisions.md) and REVIEW-BUILD (b) C1–C16.

**Matches the docs**
- Routes, methods and principals of every P1 row of API.md §13, enforced by `allow(...)` guards
  and walked by `tests/integration/route-scopes.test.ts` (registered routes = the table; 401
  without a token, 403 `forbidden` for every unlisted principal, 404 for unknown routes before
  any token check; a bad checksum costs no object call; a mismatching `TH-Role` is 403).
- Error codes and statuses of API.md §6 (`shared/contract/errors.ts`, `src/http/codes.ts`):
  `validation` 422 with `[{path, issue}]`, `setup_code_wrong` 401, `setup_done` 410,
  `setup_fp_missing` 409, `setup_required` 409, `wrong_username_or_code`, the `password_*`
  codes, `username_invalid`, `session_revoked`/`session_expired` with `details.reason`,
  `forbidden`, `origin_not_allowed`, `client_outdated` 426 with `details.min_client`,
  `reset_not_ready` 425 with `details.usable_after`, `reset_*` 410, `agent_name_taken`,
  `agent_limit`, `current_password_wrong`; 429 with `retry_after` and `scope`.
- Tokens `th1_`/`thm_`/`ths_`/`thc_` + 43 base62 + 6 base62 CRC32, checked before any object
  call; `thw_` + 22 base62 helper for P2; `thfp_` fingerprints; SHA-256 at rest.
- Setup and reset by fingerprint: `AUTH_SETUP_FP`/`AUTH_RESET_FP`, unset/empty/`none` = absent,
  the documented check order, the used fingerprint recorded; `GET /v1/auth/state`;
  `auth-setup.yml` / `auth-reset.yml` (environment `worker`, `clear` writes `none`).
- Back-off of SIGN-IN.md §6.1, every acceptance case: per source 2^(n−5) s ≤ 15 min, account
  floor 30 s, codes 5/source/hour and 30 s × 2^(n−20) ≤ 5 min (never a day), the Settings
  password check per session, early attempts not counted, `scope` reported; source keys from
  `IP_HASH_KEY`.
- Sessions per DATA.md §5 (revoked rows kept 30 days with the reason, `model`, `standalone`,
  `region`, `last_country`, 50-session cap with `device_limit`); `GET/PATCH/DELETE
  /v1/auth/sessions`; `POST /v1/auth/signout {scope}` → 204; `/me` with notices and
  `recovery_confirmed`; `/password`, `/recovery-code`, `/recovery-code/confirm`.
- Notices: `new_device` (not for the first session or the new device), `password_changed`,
  `recovery_used`/`reset_used`, `reset_pending`, `reset_cancelled`, `agent_key_created`; "Not
  me" signs the session out, signs everyone out, or revokes the key.
- Agent keys (Settings → Agents): issue with the current password, shown once, role prefix,
  20 active at most, `last_used_at` and `last_country` hourly, revoke refused within 60 s.
- Break-glass from `mind:chat` only, 24 h wait, 72 h life, cancel from any device for good,
  3 per 30 days; the GitHub path opens a ticket when Auth first sees a new `AUTH_RESET_FP`.
- Have I Been Pwned range check (5-character SHA-1 prefix, `Add-Padding`, 2 s, accepted when it
  does not answer), never at sign-in, behind `AUTH_HIBP`; tests use a fake and never call it.
- Health `{ok, version:{id, tag}, min_client, at}`; deep health in §11.1's shape for D C N R I;
  `POST/GET /v1/ops/errors` (≤ 50 items, 32 KB, scrubbed, `last_build`), resolve, perf, meter;
  `GET/PATCH /v1/settings` with `owner.tz` and `min_client` kept only in Core (the repo holds
  only the `UTC` fallback, and the objects no longer carry a location hint).
- Headers: `TH-Request-Id`, `TH-Server`, `TH-Min-Client`, `Cross-Origin-Resource-Policy`; CORS
  allow/expose lists; a foreign `Origin` (preflight too) gets 403 with no CORS headers.
- `zod/mini`; `shared/contract/{api,errors,refs}.ts`; `frontend/th/api.js` sends `TH-Client`,
  times out at 15 s, maps non-JSON 5xx/429 to `unavailable`, exposes `retryAfter` and `scope`.
- Tests in `unit/ integration/ cost/ migrations/`, cost budgets in `tests/cost/budgets.json`,
  schema snapshots, the no-timers, env-inventory and no-secret-vars rules.
- One `deploy.yml` (`api` → `site`), environment `worker`, gated by `WORKER_DEPLOY_ENABLED`,
  SHA-pinned actions, bootstrap/`none` secrets file (`scripts/worker-secrets.mjs`), `--var
  SITE_ORIGINS`, `--tag <sha12>`, health-tag and deep-health smoke, `tests/live-api.test.mjs`,
  `wrangler rollback … --yes` on failure, `target: api-rollback`.

**Still different, on purpose**
- Ledger rows (`auth.recovery_used`, `auth.reset_*`) are not written: the ledger is a P2 table.
- Pushes (sign-out push, reset push) and push-subscription deletes: P8.
- "Rolling 24 h" windows are fixed 24 h windows from the first failure (one row per counter,
  no per-attempt history); the worst case for the owner is unchanged.
- The "couldn't check against breaches, check now" Settings line has no stored flag yet: a
  timed-out check is simply accepted.
- "That was me" on `reset_pending` is a no-op on the server (the doc hides it on that device
  only; the client keeps that).
- `GET /v1/ops/meter` returns today's in-memory counts per class; there is no `meter` table in
  P1 (DATA.md §3 flush is not built). The cost suite does not count `do_calls` yet.
- No per-request log line (only `onError` logs, by name); the 600 req/min per-token limit
  [proposal], the 10-minute post-deploy watch [proposal] and `scripts/api-guard.mjs`
  [proposal] are not built. Server errors are not yet written to the inbox as `worker`/`do`.
- Tainted sessions, `TH-Session` and the other P2+ routes: later phases.
- Production tests X1, X3, X4 still need a deploy (owner setup, SETUP.md §G).
