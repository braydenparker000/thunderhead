# Extending the Thunderhead

How to add a feature without breaking a phone, the mind or the free-plan budget. The Thunderhead
grows for decades; every addition goes through the same few seams, and tests fail when one is
skipped. [CONTRACT.md](CONTRACT.md) is the generated list of what exists today.

## Rules at a glance

1. **One contract source.** Routes, verbs, surface kinds, change kinds, live frames, apps, search
   sources, error codes and the phrase lint are data in [`shared/contract`](../../shared/contract).
   The Worker's guards and validation, the phone's copy, `th help`, the route-scope test and
   CONTRACT.md all derive from it. Add there first.
2. **Forward compatible by default.** Everything is versioned and every reader skips what it does
   not know: unknown change kinds and frame types are ignored (then resync), an unknown surface
   kind or version shows the generic card, an unknown verb or version is reported as
   `unsupported_verb`, a client older than `min_client` is told to update.
3. **Phone registries.** The phone renders surfaces, runs device verbs and opens apps through three
   registries keyed by the contract's names; the ring and chip links derive from them.
4. **One write path.** Every change to Core runs in `commit()` (`backend/src/objects/commit.ts`):
   the area's rows, its change-feed rows and, for actions, its ledger row commit in one
   transaction, and the live channel hears about it afterwards.
5. **Area seams.** Each area owns its tables, migration steps, retention and store
   (`backend/src/areas/<area>/`). The Core object only composes areas. No SQL joins across areas;
   areas link by refs (`msg:<id>`, `verb:<id>`).
6. **Federated search.** A search source answers `{source, ref, snippet, score, at}` for a query;
   the Worker fuses sources by reciprocal rank. New stores join as sources, not new endpoints.
7. **One live channel.** Features add change kinds, never sockets. Frames are versioned (`hello.v`)
   and only gain fields. The mind's wait sits behind one seam (`backend/src/areas/feed/wait.ts`).
8. **Generic `th` commands.** The mind reaches new features through `th get`, `th verb`,
   `th surface` and `th search`, and `th help` is printed from the contract, so most features need
   no CLI change.
9. **Guardrail tests.** Tables have migrations and enforced retention; verbs have a class, schemas
   and a doc line; surface kinds have a renderer or fall back; routes declare who may call them.
10. **This page** is linked from [AGENTS.md](../../AGENTS.md) and changes with the seams.

---

## 1. The contract

| File | Holds | Read by |
|---|---|---|
| `routes.ts` | API.md §13 as rows: who may call, phase, `deferred` with the reason | Worker `guard()`, public-route list, route-scope test, `th help` |
| `verbs.ts` | Each verb: app, class, executor, queueable, undo, versioned zod/mini schemas for args and result, doc line | Worker validation, phone executors, `th verb` |
| `surfaces.ts` | Each surface kind: allowed app/slot patterns, versioned payload schemas, doc line | Worker validation, phone renderers, `th surface` |
| `feed.ts` | Change kinds, the live protocol version, frame types, close codes, apps, search sources, message kinds | Worker, phone, `th` |
| `codes.ts` | Each error code's HTTP status and log message | Worker errors, `th` exit codes |
| `lint.ts` | The phrase lint | Worker (422) and `th say` (before sending) |
| `memory.ts` | Fact kinds (half-life, profile cap), sources (starting confidence, cap), the confidence thresholds, limits, the refusal reasons, the decay formula; and the memory wire types | Worker validation and renders, the Memory page, `th remember` |
| `api.ts`, `actions.ts`, `conversation.ts`, `memory.ts` | Types: request and response shapes | Worker `satisfies`, the phone's JSDoc |

The registries are plain data with zod/mini schemas, so Node imports them without a build
(type stripping). `node scripts/contract.mjs` writes the three copies:

- `frontend/th/contract.js`: the phone's copy (no schemas; the Worker validated whatever reaches a
  phone). Its JSDoc types point at `shared/contract`, so the type check fails if it drifts.
- `mind/cli/contract.json`: what `th` needs, with JSON Schemas for verb args and surface payloads.
- `docs/engineering/CONTRACT.md`: the appendix.

`tests/contract-gen.test.mjs` fails while any copy is stale and checks the registry guardrails.

### The phone's registries

| File | Keyed by | Holds | Fallback |
|---|---|---|---|
| `frontend/th/registry/apps.js` | `APPS` ids | Colour and icon per app; the ring, chips and deep links derive from it | An app whose phase isn't built says it comes later |
| `frontend/th/registry/verbs.js` | verb name and schema version | The executor: runs it, returns its result and (for `undo: 'reported'`) its inverse | `unsupported_verb` |
| `frontend/th/registry/surfaces.js` | surface kind and schema version | The renderer: where the surface shows (the voice line's second line for `line`) | The generic card with the surface's `why` |

`tests/registries.test.mjs` checks them against `frontend/th/contract.js`: every app has a ring entry and an icon in the sprite, every device verb the Worker can queue has an executor, and every surface kind and version has a renderer (anything else falls back).

The conversation client lives in `frontend/th/chat/`: `live.js` (the socket: ticket, `hello`/`changed`, pings, back-off, close codes), `model.js` (the logic without DOM, with node tests in `tests/chat-logic.test.mjs`), `store.js` (the cache and the outbox in IndexedDB `th-data`), `view.js` (drawing) and `index.js` (wiring). A feature that changes what the phone shows adds a change kind and reloads its data on that kind in `index.js`'s `sync`; it never opens a second socket.

## 2. Recipes

### A route

1. Add the row to `ROUTES` in `routes.ts` (who, phase, optional `note`). Rows of later phases
   belong there too: `th` already answers them with `not_built` until their phase is built. A route that waits on
   something else in its phase gets `deferred: '<what it waits on>'`.
2. Register it in the area's `routes.ts` with `guard('<METHOD> <path>')`. The guard reads its
   principals from the row; a typo is a type error.
3. Validate the body with zod/mini (`http/validate.ts`); call the Core RPC; return the type from
   `shared/contract/api.ts` with `satisfies`.
4. Describe it in API.md. The scope test (`backend/tests/integration/route-scopes.test.ts`)
   proves the Worker registers exactly the built rows, each refusing everyone not listed.

### A table

1. Add a numbered step to the area's `migrations.ts` (expand-only: no DROP, RENAME, DELETE or
   UPDATE in migration SQL; one transaction per step). The next free number is one past the
   highest in `CORE_MIGRATIONS`.
2. Add the table to the area's `*_TABLES` with its retention, backup and export flags. Anything
   kept for less than forever names its `prune(db, now, max)`; the daily pass in `Core.tick`
   runs it, at most 2,000 rows a step.
3. Add its row to [DATA.md §10](DATA.md#10-retention-and-export-inclusion) and its columns to §4.
4. Regenerate `backend/tests/migrations/core.schema.sql` (the schema test prints the new text).
5. Index every query a hot path makes. `backend/tests/cost/` measures rows per endpoint; a read
   that grows with the table is a bug (the free plan bills rows).

### A change kind

Add it to `CHANGE_KINDS` in `feed.ts` and write it with `w.change('<kind>', ref)` inside the
area's commit. Phones that do not know it ignore it and resync; nothing else changes.

### A verb

1. Add it to `VERBS` in `verbs.ts`: app, class (`reversible` or `ask_first`), executor (`device`
   or `worker`), `queueable` (false = owner taps only, e.g. a chip), `undo` (`reported` = the
   executor returns its inverse), schema version 1 with `args` and `result`, and a doc line.
2. A device verb gets its executor in `frontend/th/registry/verbs.js`; it returns its result and,
   for `undo: 'reported'`, its inverse. Until a phone has it, that phone answers `unsupported_verb`
   and the ledger shows the attempt failed.
3. Changing args or result means a new schema version beside the old one. Phones run the newest
   version they know; the Worker keeps validating every listed version.
4. Ask-first verbs are refused (`403 proposal_required`) until proposals arrive (P4).

### A surface kind

1. Add it to `SURFACE_KINDS` in `surfaces.ts`: the app/slot patterns it may fill, payload schema
   version 1, a doc line.
2. Give it a renderer in `frontend/th/registry/surfaces.js`. Without one the phone shows the
   generic card with the surface's `why`, so a new kind can ship to the Worker first.

### A search source

Add it to `SEARCH_SOURCES` in `feed.ts` (phase and ref kind), and its query to `SOURCES` in
`backend/src/areas/search/sources.ts`: a function of `(env, query)` returning
`{source, ref, snippet, at}` hits, ranked. The route fuses all requested sources by reciprocal rank
(k = 60), so scores from different stores never need to agree. Messages (P2), facts and day notes
(P3) are the built ones; a source with no thread facet returns nothing when one is asked.

### Semantic recall (P8)

Embeddings plug in behind the same route, not as a new endpoint: set `SEMANTIC.recall` in
`sources.ts` to an object whose `run(env, query, sources)` returns one ranked hit list over the
asked sources (it gets `query.text`, the query as typed). The route fuses it with the FTS lists by
rank. `backend/tests/integration/memory-notes.test.ts` plugs in a fake to prove the fusion; the
real one ships only after the cross-language probes pass (EVALS.md §3.4).

### An object method (deploy-transition tolerance)

During a deploy the new Worker can briefly reach an object still running the previous release. A
route that calls a Core method added in this release wraps the call in `fresh(...)`
(`backend/src/objects/rpc.ts`), so the moment answers `503 unavailable` (clients retry) instead
of a 500. Object methods accept what the previous Worker sends (new arguments optional, arrays read
with `Array.isArray`), and new fields in responses are optional for old readers.

### An app

Add it to `APPS` in `feed.ts` with its folder, name and phase. Once its phase is built, its
folder must hold an `index.html` (a test checks), and replies may carry a chip to it. Give it its
colour and icon in `frontend/th/registry/apps.js`; the ring and deep links come from there.

### A live frame or protocol change

Frames only gain fields. A new frame type goes into `FRAME_TYPES`; old phones ignore it. A change
an old phone cannot ignore raises `LIVE_PROTOCOL`, ships phone support first, then raises
`min_client` so older shells are told to update (close code 4426).

### A new Durable Object class

An area can move into its own object when it outgrows Core: its migrations and store already
stand alone. A new class arrives in **its own deploy** (ROADMAP rule 3: a Worker rollback cannot
cross a class change), with its migration tag in `wrangler.jsonc`, and nothing else in that deploy.

### A th command

Usually none is needed: `th get <path>` reads any built GET route, `th verb`, `th surface` and
`th search` take any verb, surface kind and search source in the contract, and `th help` lists
them. A new command (one that combines calls or keeps local state) goes into `mind/cli/lib/`, is
listed in `lib/help.mjs`, and calls only routes in the contract: `mind/tests/th-contract.test.mjs`
fails on a call to a route the contract lacks, and `mind/tests/th.test.mjs` runs th against the
real Worker under `wrangler dev`.

## 3. Budgets that shape every addition

- Rows: the free plan bills 5M rows read and 100k rows written a day. Every endpoint has a measured
  budget in `backend/tests/cost/budgets.json` (see [PERFORMANCE.md §4.3](PERFORMANCE.md)).
- Requests: hibernatable sockets and the alarm, never timers or long polls inside an object.
- The phone shell's JavaScript stays inside the stage budget (`scripts/stage.mjs`); heavy parts of
  a feature load lazily on first use.
