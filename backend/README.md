# backend: the Worker `thunderhead-api`

A Cloudflare Worker on the free plan, in TypeScript: Hono for HTTP, `zod/mini` for input, and
two SQLite Durable Objects, `Core` (the owner's data) and `Auth` (password, recovery code,
sessions, notices, reset tickets, agent keys). The contract it implements is
[docs/engineering/API.md](../docs/engineering/API.md) with [SIGN-IN.md](../docs/product/SIGN-IN.md),
[SECURITY.md](../docs/engineering/SECURITY.md) and [DATA.md](../docs/engineering/DATA.md).
Measurements, what matches the contract and the open findings are in
[MEASUREMENTS.md](MEASUREMENTS.md).

## Layout

| Path | What it is |
|---|---|
| `src/index.ts` | Entry: `fetch` (the Hono app), `scheduled` (the 15-minute cron), the object classes. |
| `src/app.ts` | API.md §10 order: request id + response headers → CORS → client version → body limits → per-route guard → route → onError. |
| `src/http/` | `errors` + `codes` (API.md §6 envelope and statuses), `cors` (exact origins, 403 otherwise), `client-version` (`TH-Client`, 426), `auth` (token check, 60 s cache, `allow(...)` guards), `validate` (zod/mini, 422). |
| `src/lib/` | `ids` (UUIDv7), `time`, `secrets` (`none` = absent), `cursor` (opaque page cursors). |
| `src/objects/` | `base` (migrations, row meter, health), `auth`, `core` (thin RPC facades), `<class>.migrations.ts` (expand-only steps). |
| `src/areas/auth/` | `routes`, `schema`, `flows` (setup, login, recover), `common`, `account` (token checks, `/me`, notices, sessions, password), `agents`, `reset` (state, break-glass, tickets, cron), `tokens`, `crypto`, `passwords` (rules + HIBP), `throttle`, `store` + `store-keys` (all SQL). |
| `src/areas/ops/`, `src/areas/settings/` | Health, deep health, error inbox, perf, meter; Core settings (`owner.tz`, `min_client`). |
| `tests/unit/` | Pure rules: tokens and checksums, codes, back-off numbers, password rules, the HIBP client against a fake, source rules (no timers, env inventory, expand-only, ≤ 300 lines). |
| `tests/integration/` | Through the real fetch handler on workerd: `route-scopes` (API.md §13 walk), setup, login and sessions, back-off, recovery, reset tickets, account and agent keys, the HTTP edge, ops, objects, scrypt timing. |
| `tests/cost/` | Rows per endpoint against `budgets.json`; workerd's row-accounting facts. |
| `tests/migrations/` | Empty → current schema equals `auth.schema.sql` / `core.schema.sql`. |
| `../shared/contract/` | `api.ts`, `errors.ts`, `refs.ts`: types only, checked from the backend (`satisfies`) and the frontend (JSDoc). |

## Run it locally

```sh
npm ci                              # at the repo root (workspaces); --ignore-scripts also works
cp backend/.dev.vars.example backend/.dev.vars   # then fill in local values (git ignores it)
npm run dev                         # wrangler dev, local workerd only: http://127.0.0.1:8787
curl http://127.0.0.1:8787/v1/health
```

`.dev.vars` holds a throwaway pepper and IP key, the fingerprint of a local setup code (or
`none`), `AUTH_HIBP=off` and `SITE_ORIGINS=http://127.0.0.1:8080` (the site from
`npm run serve`). Local data lives in `backend/.wrangler/` (git-ignored); delete it to start over.
Fire the cron with `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled`. Never `wrangler dev --remote`.

## Test

```sh
npm test                    # repo root: site tests, contract check, secrets-file script, then the backend
npm test -w backend         # tsc, biome, `wrangler types --check`, vitest on workerd (about 35 s)
npm run bench -w backend    # the scrypt timing test with its numbers
npm run types -w backend    # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

Storage is isolated per test file, so each file is an ordered scenario. Time-based rules are
tested by ageing stored rows, or with fake `Date` for the 60 s caches. Tests never call Have I
Been Pwned (`AUTH_HIBP=off`; the client is tested against a fake). Change dependencies with
npm 11 or later.

## API (P1, all under `/v1`; API.md §11.1–11.4, §11.16, §11.20)

| Route | Who | What |
|---|---|---|
| `GET /health` | public | `{ok, version:{id, tag}, min_client, at}`; touches no object |
| `GET /auth/state?fp=&reset_fp=` | public | `{setup, setup_fp?, reset?, usable_after?}` |
| `POST /auth/setup` | public, once | `{setup_code, username, password, device}` → `201 {token, session_id, idle_days, recovery_code}` |
| `POST /auth/login` | public | `{username, password, device}` → `{token, session_id, idle_days: 90}` |
| `POST /auth/recover` | public | `{username, code, new_password, device}` (recovery code or ready reset code) |
| `GET /auth/me` | every principal | device: `{session_id, label, notices, recovery_confirmed}`; agent: `{agent_id, role, name}` |
| `POST /auth/signout` | device | `{scope: this\|others\|all}` → 204 |
| `POST /auth/password`, `/recovery-code`, `/recovery-code/confirm` | device | change password, new recovery code, confirm its last 5 |
| `POST /auth/notices/:id/ack` | device | `{answer: me\|not_me\|ok}`; "not me" undoes what the notice is about |
| `GET /auth/sessions`, `PATCH`/`DELETE /auth/sessions/:id` | device | the device list, rename, sign out (204 even when gone) |
| `GET`/`POST /auth/agents`, `DELETE /auth/agents/:id` | device | agent keys: issue (shown once, needs the password), list, revoke |
| `POST /auth/breakglass` | `mind:chat` | `{fingerprint}` → reset ticket usable after 24 h |
| `POST /auth/breakglass/cancel` | device | void a reset ticket for good |
| `GET /ops/health/deep` | device, agents, ci | schema, per-object ok, counts only |
| `POST /ops/errors`, `GET /ops/errors`, `POST /ops/errors/:fp/resolve` | see API.md §13 | error inbox (≤ 50 items, 32 KB, scrubbed) |
| `POST /ops/perf`, `GET /ops/meter` | device; device, agents, ci | daily perf summary; today's row counts |
| `GET`/`PATCH /settings` | read: device + agents; write: device | `owner.tz` (private, set from the phone), `min_client` |

Tokens: `th1_` (device), `thm_` (mind roles), `ths_` (Muse), `thc_` (CI), each followed by 43
base62 random characters and a 6-character base62 CRC32; checked before any object call and
stored only as SHA-256. Errors: `{error:{code, message, details?, request_id}}` with the codes
and statuses of API.md §6 (429 adds `retry_after` and `scope`).

## Secrets and variables (names only; values never in files)

| Name | Where | Set by |
|---|---|---|
| `AUTH_PEPPER`, `IP_HASH_KEY` | Worker secrets | made inside the bootstrap deploy run; nobody ever sees them |
| `AUTH_SETUP_FP`, `AUTH_RESET_FP` | Worker secrets (`none` when unused) | `auth-setup.yml` ("Open setup") / `auth-reset.yml` ("Request reset") from `TH_SETUP_FINGERPRINT` / `TH_RESET_FINGERPRINT`, or the dashboard |
| `CLOUDFLARE_API_TOKEN`, `TH_CI_TOKEN` | GitHub environment `worker` | the owner (SETUP.md §G, §I) |
| `CLOUDFLARE_ACCOUNT_ID`, `WORKER_URL`, `SITE_ORIGINS`, `WORKER_BOOTSTRAP` | `worker` variables | the owner; `WORKER_BOOTSTRAP` only for the first deploy |
| `WORKER_DEPLOY_ENABLED` | repository variable | the owner, when the Worker is ready |
| `SITE_ORIGINS`, `OWNER_TZ` (`UTC` fallback), `AUTH_HIBP` | `wrangler.jsonc` vars | the repo (placeholders only) |

## Deploy (not yet run)

Job `api` in `.github/workflows/deploy.yml` (OPERATIONS.md §5.1), environment `worker`, gated
by `WORKER_DEPLOY_ENABLED=true`: on a push that changed `backend/`, `shared/` or the lockfile
since the live tag (or a dispatch with `target: api|both`) it runs `npm test`, records the live
version, writes the secrets file with `scripts/worker-secrets.mjs` (bootstrap: two random keys
and `none` for the rest; otherwise `none` for listed names the live Worker lacks), runs
`wrangler deploy --var SITE_ORIGINS:… --tag <sha12>`, waits for `/v1/health` to report the tag,
checks deep health with `TH_CI_TOKEN` (skipped until it exists) and `tests/live-api.test.mjs`,
and on failure runs `wrangler rollback <previous> --yes`. `target: api-rollback` with a version
id rolls back by hand. Job `site` runs after it, unchanged.
