# Architecture

This page shows the whole Thunderhead on one page: its parts, where each part stops, how requests move between them, and the rules every change must keep.
Read it before you touch more than one folder. Exact data shapes are in [DATA.md](DATA.md); the wire contract is in [API.md](API.md).
Fixed decisions come from [decisions.md](../process/decisions.md). Where this page goes further than a decision, the text is marked **[proposal]**.

## Rules at a glance

1. **Five places run code:** the phone (a static site on an Azure Storage static website), the Worker `thunderhead-api`, its Durable Objects, GitHub Actions, and the mind (Claude Code scheduled tasks). Nothing else runs code.
2. **The site is static files only.** No server code, no response headers, no rewrites. Security policy lives in a `<meta>` tag. Every app route is a real file. Every asset path starts with `/`.
3. **All private data lives behind the Worker.** It is stored in Durable Object SQLite or in the R2 bucket `thunderhead-private`. It never lives in `$web`, the repo, Actions logs or Actions artifacts.
4. **Everything on the API is under `/v1/`.** Only `GET /v1/health` and the sign-in routes answer without a token.
5. **Bearer tokens, never cookies.** Device tokens stay in IndexedDB on the phone. The server stores only their SHA-256.
6. **Two Durable Object classes in v1: `Core` and `Auth`.** `Senses`, `Music` and `Library` each arrive in their own phase, each in its own deploy.
7. **No timers or long polls inside a Durable Object.** Live updates use hibernatable WebSockets. The mind waits through `GET /v1/live/wait`, which the Worker holds for at most 25 s.
8. **Media bytes never pass through the Worker.** The phone gets presigned R2 URLs from `POST /v1/media/sign`.
9. **API changes inside `/v1` are additive.** Every client request carries `TH-Client`. `/v1/health` publishes `min_client`.
10. **One shell document.** Home is the shell, and apps are lazily imported modules, so audio keeps playing across screens. Astra is its own page at `/astra/` at first.
11. **One hand-written service worker** precaches each release as a whole and never applies an update mid-song.
12. **Heavy work goes to its proper place** (see [JOBS.md](JOBS.md)): audio CPU work runs in Actions, addressed by sha256 only. Personal text runs in the mind's session. Row-heavy work runs as chunked DO alarm jobs. Reasoning runs only in mind sessions.
13. **No Cloudflare or Azure credential is ever inside a Claude session.** Deploy credentials live only in GitHub Actions secrets.
14. **$0 extra.** Every design must fit the free tiers in [PERFORMANCE.md](PERFORMANCE.md). Anything that would cost money is asked first.

---

## 1. The system on one page

```
                         ┌─────────────────────────── the owner's phone (Galaxy A15, Chrome) ───────────────────────────┐
                         │  shell: /index.html  ─ home (chat, ring, briefing, menu, + sheet)                            │
                         │          apps/<id>/app.js (lazy)   lib/audio (lives across screens)   sw.js (one SW)          │
                         │  IndexedDB: th-auth (token), th (outbox, surfaces cache)     OPFS: offline songs, PDFs        │
                         └──────┬───────────────────────────┬────────────────────────────────┬───────────────────────────┘
                 static files   │ HTTPS GET                 │ HTTPS + Bearer, WSS (ticket)   │ HTTPS GET (presigned, Range)
                                ▼                           ▼                                ▼
   ┌───────────────────────────────────┐   ┌────────────────────────────────────────┐   ┌──────────────────────────────┐
   │ Azure Storage static website      │   │ Cloudflare Worker  thunderhead-api      │   │ R2 (S3 endpoint)             │
   │ <acct>.zNN.web.core.windows.net   │   │ Hono app: cors → auth → scope → route   │   │  jarvis-music   (audio, art)  │
   │ $web: frontend/ + stubs +         │   │ cron */15 → Core.tick()                 │   │  thunderhead-private          │
   │ release.json   (public, no hdrs)  │   │ fires mind tasks (text "wake")          │   │  thunderhead-jobs             │
   └───────────────▲───────────────────┘   └──────┬──────────────┬───────────────┬───┘   └──────▲───────────▲───────────┘
                   │ az storage blob (OIDC)       │ Workers RPC  │ RPC           │ R2 bindings  │           │
                   │                              ▼              ▼               └──────────────┘           │ S3 API (scoped
   ┌───────────────┴──────────────────┐   ┌──────────────┐ ┌──────────────┐                                 │ tokens: read
   │ GitHub Actions (public repo)     │   │ DO Core       │ │ DO Auth      │   later: DO Senses (P5),       │ music, write
   │ ci.yml  deploy.yml (site + api)  │   │ "owner"       │ │ "owner"      │          DO Music  (P5),       │ jobs)
   │ jobs-audio.yml (P5, sha256 only) ├───┤ chat, ledger, │ │ password,    │          DO Library (P7)       │
   │ wrangler deploy / rollback       │   │ proposals,    │ │ sessions,    │                                 │
   └───────────────▲──────────────────┘   │ verbs, memory │ │ agents, push │                                 │
                   │ git push (proxy)     └──────▲────────┘ └──────────────┘                                 │
   ┌───────────────┴──────────────────────────────┴──────────────────────────────────────────────────────────┴──┐
   │ The mind: Claude Code scheduled tasks on the owner's subscription                                             │
   │  mind-chat (fired by the Worker)   mind-night (fired by the day roll, 06:07 fallback)   mind-reflex (P4)      │
   │  th CLI → HTTPS + agent token → /v1/mind/brief, /v1/live/wait, /v1/messages …     PDFs extracted here (P7)    │
   └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Acceptance: an agent can name, for any box above, which folder holds its code (§3) and which credentials it holds (§2.2).

## 2. Components and boundaries

### 2.1 Components

| Component | Runs where | Code | Holds | Talks to | Phase |
|---|---|---|---|---|---|
| Site | Azure Storage static website, `$web` container of a `thunderhead*` account | `frontend/` | Public code only, plus `release.json` | Worker (HTTPS, WSS), R2 (presigned GET) | P0 |
| Service worker | The phone's browser, scope `/` | `frontend/sw.js` | Release caches `th-<build>`, `th-vendor` | Site only; never the API | P1 [proposal: ship with sign-in] |
| Worker `thunderhead-api` | Cloudflare `workers.dev`, Free plan | `backend/src/` | No state. Isolate caches only (session lookups ≤ 60 s) | DOs (RPC), R2 bindings, mind fire URLs, push services | P1 |
| DO `Core` | Cloudflare, one instance named `owner` | `backend/src/objects/core.ts` + `areas/*/store.ts` | Conversation, ledger, proposals, verbs, surfaces, memory, wakes, errors, settings, changes feed | Worker (RPC, WS) | P1 |
| DO `Auth` | Same, instance `owner` | `backend/src/objects/auth.ts` | Credential, recovery, sessions, throttle, notices, tickets, agents, push subscriptions | Worker (RPC). `Core` reads push subscriptions over RPC | P1 |
| DO `Senses` | Same | `objects/senses.ts` | Events (90 days hot), batches, rollups | Worker | P5 |
| DO `Music` | Same | `objects/music.ts` | Catalog, track stats, catalog log | Worker | P5 |
| DO `Library` | Same (shardable by name) | `objects/library.ts` | Books, pages + FTS5, verse refs, highlights | Worker | P7 |
| R2 `jarvis-music` | Cloudflare | — | Existing audio and art. **Never deleted from.** | Read by presigned GET, Actions (read-only token) | exists |
| R2 `thunderhead-private` | Cloudflare | — | Backups, events archive, books, files, imports, indexes, validated job results | Worker binding only; phone by presigned GET | P1 |
| R2 `thunderhead-jobs` | Cloudflare | — | Raw results from Actions jobs (14-day life) | Actions writes; Worker reads, validates, copies, deletes | P5 |
| GitHub Actions | GitHub-hosted runners (public logs) | `.github/workflows/` | Deploy secrets only | Azure (OIDC), Cloudflare (API token), R2 jobs | P0 |
| Mind | Claude Code cloud sessions | `mind/` | One agent token per task environment | Worker (HTTPS), GitHub (git proxy) | P2 |
| Muse | The existing external helper | — | A `muse`-scoped agent token | `/v1/work/*` only | P4 |

### 2.2 Who holds which credential

| Credential | Lives in | Can do | Never in |
|---|---|---|---|
| Device session token `th1_…` | Phone IndexedDB `th-auth`; server keeps only its SHA-256 in `Auth` | Everything the owner can do | Logs, URLs, localStorage |
| Agent keys `thm_…` (roles `mind:chat`, `mind:night`, `mind:reflex`) and `thc_…` (role `ci`) | The matching Claude environment's network secret `TH_TOKEN`, or the GitHub environment secret `TH_CI_TOKEN`; hash in `Auth.agents` | That role's scopes ([API.md §3](API.md#3-principals-and-scopes)) | The repo, Actions logs |
| Muse key `ths_…` | Muse's environment; hash in `Auth.agents` | `/v1/work/*`, its own thread | Anywhere else |
| Azure OIDC (`MissionaryTube` app, Storage Blob Data Contributor on the `thunderhead*` account) | Federated trust; IDs as GitHub secrets | Write `$web` | Claude sessions |
| `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, one account) | GitHub secret | Deploy, roll back, set Worker secrets | Claude sessions |
| R2 sign key (Object Read on `jarvis-music` + `thunderhead-private`) | Worker secrets `R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET` | Presign GETs | Actions, sessions |
| R2 Actions keys (read `jarvis-music`; read/write `thunderhead-jobs`) | GitHub secrets | Read audio bytes by sha256, write job results | The Worker, sessions |
| Mind fire secrets `MIND_FIRE_CHAT`, `MIND_FIRE_NIGHT`, `MIND_FIRE_REFLEX` | Worker secrets | Fire `mind-chat`, `mind-night`, `mind-reflex` with text `wake` | Everywhere else |

The full inventory, with rotation steps, is in [SECURITY.md](SECURITY.md) and [OPERATIONS.md §6](OPERATIONS.md#6-secret-rotation).

Acceptance: `tests/` grep checks that `backend/src` reads no `env.X` that is missing from `wrangler.jsonc` vars or the secrets list in SECURITY.md (test name `env-inventory`).

### 2.3 Boundaries that code must never cross

| Boundary | Rule | Enforced by |
|---|---|---|
| Site ↔ private data | `$web` is always world-readable. Nothing personal is ever staged. | `site.test.mjs` (no outside hosts, no secrets); review of the diff |
| Actions ↔ private data | Actions never hold a credential for `thunderhead-private` or any Worker token above `ci`. | Secrets inventory test; no binding of that bucket in any workflow |
| Session ↔ cloud credentials | No Cloudflare or Azure credential inside a Claude session. Break-glass and token rotation are Worker endpoints. | Decision (2026-10-28). PreToolUse hook denies `wrangler` in `mind/` roles **[proposal]** |
| Worker ↔ `jarvis-music` | No delete. `put` only in the reviewed `backend/src/areas/music/upload.ts`. | `no-music-delete` test greps `MEDIA.delete` and `MEDIA.put` |
| DO ↔ time | No `setTimeout` or `setInterval` in `backend/src/objects/` or any `store.ts`. | `no-timers-in-do` test |
| Route ↔ scope | Every route declares a scope. Unlisted means deny. | `route-scopes` test: each route without a token returns 401 |

---

## 3. Repository layout

```
thunderhead/
  AGENTS.md  CLAUDE.md  README.md      rules, entry point, commands
  package.json  package-lock.json      npm workspaces: ".", "backend", "mind"; one `npm test`
  biome.json  tsconfig.json            one lint/format config; tsc checks backend, shared, frontend JSDoc, mind
  .github/workflows/                   ci.yml (non-main pushes), deploy.yml (test → api → site), jobs-audio.yml (P5)
  .github/dependabot.yml               monthly, grouped
  .claude/settings.json                mind hooks: SessionStart, Stop (bounded), PreToolUse per TH_ROLE
  shared/contract/                     TYPES ONLY: api.ts events.ts refs.ts errors.ts (no runtime code)
  frontend/                            the site: plain ES modules, no build, // @ts-check + JSDoc
    index.html 404.html                the shell (home) and the not-found page
    manifest.webmanifest sw.js sw-kill.js config.js routes.json
    ui/                                tokens, base CSS, components, gestures, motion, theme.js, icons.svg, fonts/, csp.txt
    th/                                th.js api.js auth.js outbox.js live.js surfaces.js verbs.js push.js
    lib/                               router.js idb.js files.js audio/
    apps/<id>/                         app.js (mount/unmount), verbs.js (UI-free), <id>.css
    astra/                             Astra's own page (until it folds into the shell)
    vendor/<lib>-<version>/            pinned third-party ESM with LICENSE and a recorded sha256
  backend/                             the Worker: TypeScript, Hono, zod, aws4fetch
    wrangler.jsonc  vitest.config.ts  worker-configuration.d.ts (generated)
    src/index.ts src/app.ts            entry; middleware order
    src/http/                          cors auth scope errors validate paging client-version
    src/lib/                           ids time refs log r2sign wake push hash
    src/objects/                       base.ts core.ts auth.ts (later senses.ts music.ts library.ts)
    src/areas/<area>/                  routes.ts store.ts schema.ts — one folder per API area
    tests/                             unit/ integration/ cost/ migrations/ import/ restore/ fixtures/
  mind/                                CONSTITUTION.md ROLES.md cli/th.mjs hooks/ skills/ evals/ tests/ tools/
  scripts/                             serve.mjs stage.mjs deploy.sh dev.mjs icons.mjs
  tests/                               site + browser + live checks for the frontend; budgets.json
  docs/                                product/ design/ engineering/ mind/ process/ (this suite)
```

One line per root:

| Folder | What lives there | Never there |
|---|---|---|
| `frontend/` | Everything served from `$web`. What is in Git is what runs on the phone. | Secrets, personal content, build output |
| `backend/` | The Worker and its Durable Objects, with their tests | Frontend code |
| `mind/` | The mind's CLI, hooks, laws, skills, and the eval harness with synthetic fixtures | Private probes (they live in the Worker) |
| `shared/` | Request/response, event, ref and error **types** checked from all three sides | Any runtime code |
| `scripts/` | Maintained tools that run on a laptop or a runner | One-off scripts |
| `tests/` | Frontend static, unit, browser and live read-only checks | Real data |
| `docs/` | This suite. Owner rulings in `process/decisions.md` | Personal data |

Acceptance: `tsc --noEmit` from the root passes over `backend/`, `shared/`, `mind/` and the frontend's JSDoc. Changing a field in `shared/contract/api.ts` without updating its users fails CI.

---

## 4. Request paths

### 4.1 Phone → Worker → Durable Object (every API call)

1. The page calls `api(path, …)` in `frontend/th/api.js`. It adds `Authorization: Bearer th1_…`, `TH-Client: <build>.<sha7>` and `Content-Type: application/json`. The default timeout is 15 s.
2. Chrome sends a CORS preflight. The `Authorization` header always triggers one. The Worker answers it with `Access-Control-Max-Age: 7200`, so it repeats at most every 2 h per URL.
3. Worker middleware runs in this fixed order: `requestId` → `cors` → `clientVersion` → `bodyLimit` → `auth` → `scope` → route → `onError`.
4. `auth` hashes the token (SHA-256), then looks it up in the isolate cache (60 s TTL). On a miss it calls `Auth.verify(hash)` (1 DO request). The result is a `Principal`, or 401.
5. The route validates input with zod, then calls one RPC method on the DO that owns the data, e.g. `env.CORE.getByName('owner').postMessage(input, principal)`.
6. The DO method runs its SQL in one `transactionSync`, appends a row to `changes` if anything changed, and returns. It never awaits a timer.
7. The Worker returns JSON with `Cache-Control: no-store`.

Cost per call: 1 Worker request, plus 1 preflight at most every 2 h, ≤ 1 `Auth` request per isolate-minute, and 1 data-DO request. Acceptance: the cost test for `PUT /v1/messages/:id` asserts exactly 1 `Core` RPC and the row budget in [PERFORMANCE.md §4](PERFORMANCE.md#4-backend-budgets).

### 4.2 Live updates on the phone

1. `POST /v1/live/ticket` returns `{ticket, expires_at}`. The ticket is valid 30 s and single-use.
2. The phone opens `wss://<worker>/v1/live?ticket=…`. The Worker checks the ticket and forwards the upgrade to `Core`, which calls `ctx.acceptWebSocket(ws, ['device:<session_id>'])`.
3. On every committed change, `Core` sends `{"t":"changed","seq":N,"kinds":[…]}` to every socket. Sending is free. `Core` then hibernates.
4. The phone fetches `GET /v1/changes?after=<last seq>` and applies the result.
5. The phone sends the text `ping` every 50 s. `Core` answers it through `setWebSocketAutoResponse('ping','pong')`, which does not wake the object.
6. If the socket closes, the phone reconnects with a new ticket after 1 s, 2 s, 4 s … capped at 60 s. On `visibilitychange → visible` it reconnects at once.

Acceptance: an integration test with two sockets sees one `changed` frame per committed write. A Playwright test kills the socket and sees the client catch up through `/v1/changes` within 5 s.

### 4.3 Mind → Worker (wake, brief, listen, reply)

```
owner sends a message ─► PUT /v1/messages/:id ─► Core stores it, bumps seq
     │                                            │ is a mind-chat lease live? ── yes ─► the waiting /v1/live/wait returns
     │                                            └ no ─► Core writes a wakes row; the Worker POSTs the fire URL, text "wake"
     ▼
mind-chat session starts ─► SessionStart hook: `th brief --claim` ─► POST /v1/mind/brief {claim:true}
     ─► Core binds the session to the oldest open wake and returns the briefing core (≤ 9,500 chars) + full text
     ─► the model replies: `th say` ─► PUT /v1/messages/:id (role mind, reply_to […])
     ─► `th wait`: loops GET /v1/live/wait?after=<seq> (each take ≤ 25 s; renews the lease)
     ─► ends after the idle cutoff or on `day_closed`: `th note` ─► POST /v1/mind/notes
```

- `GET /v1/live/wait` is held by the **Worker**. The Worker opens a WebSocket to `Core`, which accepts it with the hibernation API. The Worker waits up to 25 s for a `changed` frame, then returns. `Core` holds no timer, and the Worker's wall-clock wait is not billed on Free. Gate: test X1 in [OPERATIONS.md §10](OPERATIONS.md#10-open-questions--tests). The fallback is a 15 s short poll of `/v1/changes`.
- Wake caps, retries and the honest "isn't waking" line are specified in [RUNTIME.md](../mind/RUNTIME.md).

### 4.4 Actions → R2 jobs → Worker

1. `mind-night` asks `GET /v1/jobs/next?kind=audio.analysis`. It receives a spec `{job_id, kind, v, shas[]}` with sha256 keys only.
2. It dispatches `jobs-audio.yml` with the single `workflow_dispatch` input `job_id`. The workflow fetches the spec with `TH_CI_TOKEN`, so no hash ever shows on the public run page.
3. Actions reads `jarvis-music/native/audio/<sha256>.opus` with a read-only key. It writes `thunderhead-jobs/results/<kind>/<job_id>/…`. Logs print counts and durations only.
4. `POST /v1/jobs/:id/collect` (scope `mind:night` or `ci`) makes the Worker validate every result file, copy it to `thunderhead-private/jobs/…`, apply it through a chunked DO job, and delete the raw files.

Details and validation rules are in [JOBS.md](JOBS.md).

### 4.5 Cron

- One cron, `*/15 * * * *`, calls `Core.tick()`.
- `tick` runs the watchdogs ([OPERATIONS.md §8](OPERATIONS.md#82-watchdogs-coretick-every-15-min)), checks the day roll (04:00 local after 60 quiet minutes), and calls `ensureAlarm()` on each DO class that exists. That is ≤ 5 DO requests per tick, or 480 a day.
- Each DO keeps one alarm, set to its earliest due job. `setAlarm` runs only when that time changes, because each call costs 1 row written.

---

## 5. Consequences of hosting on an Azure Storage static website

The owner ruled out Static Web Apps and Cloudflare hosting (decisions, 2026-10-28). These rules follow from that.

| Fact about the host | Consequence | Where it is enforced | Acceptance check |
|---|---|---|---|
| No custom response headers | The CSP is a `<meta http-equiv>` placed right after `<meta charset>`, byte-for-byte equal to `frontend/ui/csp.txt`. `frame-ancestors`, HSTS, `nosniff`, `X-Robots-Tag`, COOP/COEP and reporting are impossible. A JS frame guard (`if (top !== self)` → hide and stop) replaces `frame-ancestors`. `securitypolicyviolation` events are posted to `/v1/ops/errors`. | `site.test.mjs` "every page carries the CSP…" | Static test passes for every `*.html` |
| `connect-src` must name the API | When the API lands (P1), `csp.txt` adds `https://thunderhead-api.<sub>.workers.dev wss://thunderhead-api.<sub>.workers.dev`. In P5 it adds `https://<account>.r2.cloudflarestorage.com` to `connect-src`, `img-src` and `media-src`. | `csp.txt` is the one source; the test compares every page with it | The browser test has zero CSP console errors |
| No SPA fallback | Every app route is a real file. `scripts/stage.mjs` copies `index.html` to `<route>/index.html` for each route in `frontend/routes.json` **[proposal]**. App URLs have exactly one path segment (`/music/`); deeper state goes in the query or hash (`/music/?album=…`). | `stage.mjs`; a stage test checks every stub exists and is byte-equal to `index.html` | `GET /music/` returns 200 with the shell on the live site |
| `/dir` serves `index.html` with no redirect | Relative URLs break on `/music` (no slash). Every `src`/`href` is root-absolute. | `site.test.mjs` root-absolute test | Loading `/music` (no slash) shows no 404 assets |
| Missing files return `404.html` with status 404 | `404.html` is a plain page with "Nothing here." and a home link. It loads only `/ui/plain.css`. | `live.test.mjs` "missing files get a 404" | `GET /no-such-file.js` → 404 |
| HTTPS only; `http://` returns 400 | No HTTP links anywhere | No-outside-hosts test | — |
| `$web` is world-readable | Never stage personal data. `release.json` holds only `{commit, build, staged_at}`. | Diff review; secret scan | — |
| No compression | Files are served as uploaded. Option **[proposal]**: stage brotli-compressed copies of `.js .css .html .svg .json` and upload them with `Content-Encoding: br`. Adopt only after a live check shows Chrome and the test runner decode them. | Open question O3 | `curl -sI` shows `content-encoding: br` and the page loads clean |
| Blob uploads are not atomic | `deploy.sh` uploads `ui/*`, then `apps/*`, then everything else, then `release.json` last. It waits until the live `release.json` names the commit, then prunes stale blobs (at most 50; soft delete keeps them 7 days). | `scripts/deploy.sh` | The Deploy run reads back the commit |
| Content types come from the CLI's `mimetypes` | `.js` arrives as `application/javascript`, which browsers accept for modules. `.woff2` as `font/woff2`. | `live.test.mjs` content-type checks | — |
| Cache headers are per blob | Every blob is uploaded with `Cache-Control: no-cache`. Browsers revalidate with ETag; the service worker makes repeat loads instant. Vendor paths are versioned and the SW treats them as immutable. | `deploy.sh` | — |

---

## 6. Version skew between the phone and the API

A cached shell can be days old when it calls a newer Worker. Rules:

1. **Build number.** `stage.mjs` stamps `build` = `git rev-list --count HEAD` on `main`, a monotonic integer because force pushes are blocked. It writes the build into `release.json`, `config.js` (`export const RELEASE = {build, commit}`) and `sw.js` (`const BUILD = …`). **[proposal]**
2. **Header.** Every request sends `TH-Client: <build>.<sha7>`, e.g. `TH-Client: 412.1a2b3c4`. The mind's CLI sends `TH-Client: th/<version>`, and Actions sends `TH-Client: ci/<build>`.
3. **Minimum.** `GET /v1/health` returns `min_client` (an integer build). Every response also carries `TH-Min-Client: <int>` **[proposal]**, so the shell learns it without polling.
4. **Below the minimum.** The Worker answers `426 client_outdated` for **writes only**. Reads keep working, so an old shell can still show data. The shell shows the update line from [COPY.md](../design/COPY.md) and applies the waiting service worker update by the safe-update rule (§8.3).
5. **Additive only.** Inside `/v1`, fields are only added. A removal or a change of meaning needs a new path (`/v2/<area>` for that area only), and `min_client` rises only when an old client would corrupt data.
6. **Events and payloads.** An event `type` is never repurposed; a new shape gets a new type (`music.skip.v2`). JSON columns and payloads carry `"v": n`. Surfaces and verbs carry a `schema` integer, and a client ignores a payload whose `schema` is higher than it knows.
7. **Test.** CI keeps one N-1 client fixture: the previous build's `frontend/th/api.js` request shapes, replayed against the new Worker in vitest. Every one must succeed.

Acceptance: an integration test sets `MIN_CLIENT=500`, sends `TH-Client: 499.abc1234` and gets 426 on `PUT /v1/messages/:id`, but 200 on `GET /v1/changes`.

---

## 7. The frontend: one shell, apps as modules

1. **The shell** is `/index.html`. It owns home (conversation, ring, briefing, menu, `+` sheet), the router, `th/`, the audio engine, and the toast and sheet layers. It stays loaded for the whole visit.
2. **Apps** live in `frontend/apps/<id>/`. The shell runs `import('/apps/<id>/app.js')` on first open, then `mount(root, ctx)`. `root` is `<section data-app="<id>">`, and `ctx` is `{th, api, router, audio, files, ui}`. `mount` returns `unmount()`, which removes every listener, timer, observer, wake lock and in-flight fetch.
3. **Verbs** live in a UI-free `apps/<id>/verbs.js`. The shell can import and run them while the app is closed. Each verb returns `{result, undo}`.
4. **Styles** for an app load on mount, wrapped in `@layer app { @scope ([data-app="<id>"]) { … } }`.
5. **Routing** uses the Navigation API. Overlays (briefing, menu, `+` sheet) and open apps are history entries created only from a user gesture, so system Back closes them. Back at the home root leaves the app as normal; Back is never trapped. Exact gestures are in [GESTURES.md](../design/GESTURES.md).
6. **Only one app's DOM is alive at a time.** Heavy engines (pdf.js, alphaTab, mediabunny) are imported only by their app.
7. **Astra** stays its own document at `/astra/` until it earns a move into the shell. Leaving it stops its video, which is correct.
8. **Code rules:** ES modules; files of 400 lines or fewer; logic without DOM in its own module with a `node --test`; `// @ts-check` on every file; no globals except `window.th` in development.

Acceptance: a Playwright test mounts and unmounts each app 20 times. The DOM node count and the number of listeners (counted through an instrumented `on()`) return to their baseline ±5%.

---

## 8. Service worker

### 8.1 Strategy per request

| Request | Strategy |
|---|---|
| Navigation inside scope `/` (except `/astra/` while it owns its page) | The cached `/index.html` from `th-<build>`; the network if it is missing. Offline still opens the app. |
| Same-origin code, CSS, fonts, icons | Cache-first from `th-<build>`. Everything is precached at install. |
| `/vendor/<lib>-<version>/…` | Cache-first from `th-vendor`, shared across builds (paths never change content). |
| `/release.json`, `/config.js` | Network-first with a 3 s timeout, then cache. |
| Worker API, WebSocket | **Not intercepted.** |
| R2 presigned URLs | Not intercepted, except the optional song-heads module in P5 ([MUSIC.md](../product/apps/MUSIC.md)). |
| `POST /share` | Arrives with the share target in P8. |

### 8.2 Install and activate

1. `install`: fetch `/precache.json` (written by `stage.mjs`: every file except `vendor/` and the route stubs, with sizes) with `cache: 'no-store'`, then `cache.addAll` into `th-<build>`. If any file fails, the install fails and the old worker stays.
2. `activate`: delete only caches named `th-<n>` where `n` ≠ the current build. It never deletes `th-vendor` or any cache an app created (offline audio, PDFs).
3. Precaching all app code (not just the shell) is what stops an old shell from lazily loading a new app module.

### 8.3 Safe update

1. The shell calls `registration.update()` on `visibilitychange → visible`, at most once an hour.
2. A new worker installs fully, then waits.
3. The shell applies it only when **all** hold: nothing is playing, the ask bar is empty, no sheet is open, and the visible screen is home or an idle app. It then posts `{type:'skipWaiting'}`, waits for `controllerchange`, and reloads behind a 150 ms fade.
4. If that moment never comes, the update applies at the next cold start.
5. `TH-Min-Client` above the running build makes the update "wanted". The shell shows the update line and applies at the next safe moment.

### 8.4 Kill switch

`frontend/sw-kill.js` clears every `th-*` cache and unregisters itself. The runbook [OPERATIONS.md §3.3](OPERATIONS.md#33-emergency-service-worker-kill-switch) publishes it as `/sw.js`.

Acceptance (Playwright, local server): serve build A, then B. While a fake `audio.playing` flag is set, no reload happens. When it clears, B is active within 2 s, and the `th-A` cache is gone while `th-vendor` remains.

---

## 9. Key conventions

| Area | Convention |
|---|---|
| Names | snake_case on the wire, in SQL and in client objects; no mapping layer |
| IDs | UUIDv7 strings, generated by whoever creates the thing (the client for messages and events) |
| Time | `*_at` = integer ms UTC. `day` = `YYYY-MM-DD` in the owner's logical day ([DATA.md §2.2](DATA.md#22-time)) |
| Pointers | `ref` strings `<kind>:<id>[#<fragment>]` ([DATA.md §2.3](DATA.md#23-refs)) |
| Errors | `{error:{code, message, details?, request_id}}` with stable snake_case codes ([API.md §6](API.md#6-errors)) |
| Backend structure | All SQL in the area's `store.ts`. DO classes are thin RPC facades. Migrations are expand-only. Every bulk job is chunked and resumable. |
| Frontend structure | `mount()` returns full cleanup; verbs in `verbs.js` return their own undo; no inline script or style blocks |
| Logs | One JSON line per request: `{evt, route, status, ms, cpu_ms?, rows_w, rows_r, do_calls}`. Never bodies, tokens, titles, refs to personal items, or push endpoints. |
| Dependencies | Exact versions, lockfile committed. No GPL, AGPL or non-commercial licences. Runtime deps of the Worker: `hono`, `zod`, `aws4fetch` only. |
| Owner time zone | Stored as the `Core` setting `owner.tz` (IANA name), set from the phone at setup, **not** as a `wrangler.jsonc` var, so the public repo holds no location **[proposal]** |

---

## 10. What ships in which phase

| Phase | Architecture added |
|---|---|
| P0 | Site on the storage website, deploy with auto-rollback, meta CSP, self-hosted fonts |
| P1 | Worker, `Core` + `Auth`, sign-in, devices, agents, `/v1/health`, deploy job `api`, service worker, `config.js` |
| P2 | Threads, messages, FTS5, live WebSocket, `/v1/live/wait`, mind wakes, `th` CLI, `mind-chat` |
| P3 | Import from the old Worker, memory v1, ledger undo for memory, `mind-night` |
| P4 | Proposals with device approval, role enforcement, `mind-reflex`, watchdogs, weekly backups, restore drill, export, Muse work orders |
| P5 | `Senses` and `Music` (two deploys), presigned media, R2 CORS, `jobs-audio.yml`, router + view transitions |
| P6–P9 | Guitar, `Library` + Study, Board/Astra/Podcasts/My Media, push, the meter |

---

## 11. Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| O1 | Does a Worker-held WebSocket to a hibernating `Core` work for `/v1/live/wait` on Free, unbilled while waiting, and through the Claude session proxy (30 s cut)? (X1) | Preview Worker; 100 takes from a session; check DO duration in the dashboard |
| O2 | The Galaxy A15's CSS viewport, DPR and navigation mode | Remote DevTools: `innerWidth`, `innerHeight`, `devicePixelRatio`; ask the owner |
| O3 | Does the static website honour a stored `Content-Encoding: br`, and do Chrome and Node `fetch` decode it? | Upload one test blob to a scratch path; `curl -sI`; load it in Playwright |
| O4 | Do DOs keep running old code for minutes after a deploy (an old-repo observation of ~4 min)? | Deploy a version that reports `SCHEMA_VERSION` from `Core`; poll deep health every 10 s |
| O5 | Does `navigationFallback` matter any more? (No: the host has none.) Do one-segment app URLs cover every deep link the apps need? | Review each app doc's routes against the one-segment rule |
