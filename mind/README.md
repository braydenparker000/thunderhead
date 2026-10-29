# mind/

The mind's runtime: the `th` CLI and the Claude Code hooks that a scheduled-task session (chat,
later night and reflex) uses to talk to the Worker, plus the two files every session reads. Spec:
[docs/mind/RUNTIME.md](../docs/mind/RUNTIME.md) §2–§7, [docs/engineering/API.md](../docs/engineering/API.md) §11.

| Path | What it is |
|---|---|
| `CONSTITUTION.md` | The constitution's loaded text, byte for byte from [docs/mind/CONSTITUTION.md](../docs/mind/CONSTITUTION.md) (a test checks). |
| `ROLES.md` | The procedure each role's prompt points at (`## chat` now; night in P3, reflex in P4). |
| `cli/th.mjs` | Entry point. `th help` lists the commands and what this Worker build offers. Node ≥ 22, no dependencies. |
| `cli/contract.json` | Generated from `shared/contract` by `scripts/contract.mjs`: routes, verbs and surface kinds with JSON Schemas, error codes, the phrase lint. Never edited by hand. |
| `cli/lib/*.mjs` | `http` (headers, retries, the contract check), `contract` and `schema` (local validation), `io` (output, exit codes, redaction), `wait`, `brief`, `conv`, `memory`, `act`, `help`, `state` |
| `bin/th` | Shell shim so `th …` works once `mind/bin` is on `PATH` (the SessionStart hook adds it). |
| `hooks/session-start.mjs` | Briefs the session: `th brief --claim`, core ≤ 9,500 characters on stdout, the full briefing in `$TMPDIR/th/brief.md`. |
| `hooks/stop.mjs` | Bounded Stop hook: at most 3 blocks per session. |
| `hooks/stop-failure.mjs` | Reports `th status limited --error <e>` after an API error. |
| `hooks/pre-tool.mjs`, `hooks/lib/rules.mjs` | Per-role deny rules (deterministic, no network). A soft gate: the environment's network list is the real control. |
| `hooks/settings.example.json` | The hooks block the owner pastes into `.claude/settings.json` (a protected path; nothing here writes it). |
| `jobs/old-export.mjs` | The one-time pull of the old Worker's export into the import ([MIGRATION.md §3](../docs/engineering/MIGRATION.md), [SETUP.md L2](../docs/process/SETUP.md)): parts posted unchanged, the manifest last, then the imports. Run by hand in the owner's existing environment; prints counts only. |
| `evals/` | Synthetic memory-eval fixtures: `seed.jsonl` (a fake owner), `probes/memory.json`, `abstain.json` and the deterministic scorer `probes/score.mjs` ([EVALS.md §3](../docs/mind/EVALS.md)). The private weekly probes live only in the Worker. |
| `tests/` | `th.test.mjs` runs `th` against the real Worker under `wrangler dev --local`; the other suites use `tests/fake-worker.mjs`, an in-memory fake that also serves later phases' routes. |

Run the tests: `npm run test:mind` (also part of the root `npm test`).

## How th meets the Worker

- **The contract decides.** Every call is checked against `cli/contract.json` before the network.
  A route this Worker build does not have yet exits 8 with `not_built` and the phase it arrives in,
  so the procedure in `ROLES.md` never changes when a phase ships. Verb args, surface payloads and
  the phrase lint are checked locally too (exit 8, with the path that is wrong); the Worker checks
  everything again.
- **Generic commands** reach new features without a th change: `th get <path> [key=value…]` reads
  any built GET route the role may call, `th verb <name> '<json>' --why …` queues any verb in the
  contract, `th surface …` places any surface kind, `th search` queries every built search source.
- **Token:** in cloud sessions the environment's network secret adds `Authorization` on the way
  out, so th has no token at all. `TH_TOKEN` is used only when set (local runs, tests). th restarts
  itself with `NODE_USE_ENV_PROXY=1` when a proxy is configured, because Node's `fetch` otherwise
  skips the proxy and the token.
- **Headers sent:** `TH-Client: th/<version>`, `TH-Role`, `TH-Session` (`CLAUDE_CODE_REMOTE_SESSION_ID`).
- **Output:** one line of compact JSON (help and briefings print text); errors as
  `{"error":{"code","message","request_id"}}` on stderr; exit codes per RUNTIME.md §5.2. Anything
  token-shaped is redacted from everything th prints.
- **Retries:** network errors and 5xx (except `503 budget_exhausted`) retry 3 times (1 s, 2 s, 4 s).
  Every create carries a UUIDv7 made by th, so a retry after a lost response is the same record.
- **`th wait`:** takes of `GET /v1/live/wait?after=<seq>&timeout=≤25`, aborted by the client at
  28 s, retried with back-off until `--minutes` runs out. A take with nothing for the mind (its own
  posts, presence changes) just waits again. Exit 0 messages/events, 3 timeout, 4 Stop, 5 day
  closed; 2/6/11 at once. When a signal and messages arrive in one take, the signal's exit code wins
  and the messages are in its output.
- **Stop:** while the owner's Stop stands, `say` and `status` replies carry `TH-Stop: 1` and th
  prints `th: STOP` on stderr; the next text reply clears it.
- Local state lives in `$TMPDIR/th/state/` (one file per key: `seq`, `wake`, `last_owner_at`,
  `note_at`, the Stop hook's per-session block count, the StopFailure mark).

## Setup per role

One Claude cloud environment per role (`th-chat` now, `th-night` in P3, `th-reflex` in P4),
RUNTIME.md §7, and the owner steps in [SETUP.md](../docs/process/SETUP.md) K.

| Setting | Value |
|---|---|
| Network access | Custom: the Worker host, the site host, `api.github.com`, the default package-manager list. (`th file` will also need the private bucket's host once attachments ship.) |
| Network secret | Worker host → `Authorization: Bearer <thm_… key for this role>` (Settings → Agents). The key never appears as an env var. |
| Env vars (not secret) | `TH_ROLE=chat`, `TH_API=https://<worker host>`, `TH_SITE=https://<site host>`, `NODE_USE_ENV_PROXY=1`, `BASH_MAX_TIMEOUT_MS=7200000` |
| Optional env vars | `TH_WAIT_MINUTES` (default 24, the P2 launch value), `TH_ALLOWED_HOSTS` (extra hosts for curl/wget, comma-separated, `*.suffix` allowed) |
| Setup script | `npm ci --ignore-scripts` |

## Hooks

The owner pastes `hooks/settings.example.json` into `.claude/settings.json` (a protected path; the
mind never writes it). Every hook exits 0 at once with no output when `TH_ROLE` is unset, so the
owner's and developers' own sessions in this repo are unaffected. The PostToolUse taint hook
(RUNTIME.md §6.5) arrives with taint enforcement (P4), so the block leaves it out.

Hook output formats follow the Claude Code hooks reference (https://code.claude.com/docs/en/hooks,
read 2026-10-28): SessionStart stdout becomes context (cap 10,000 characters); Stop blocks with
`{"decision":"block","reason":…}` and receives `background_tasks`; PreToolUse denies with
`hookSpecificOutput.permissionDecision: "deny"` and a `permissionDecisionReason`; StopFailure output
is ignored. Without `background_tasks` (older Claude Code) the Stop hook cannot see the wait, so it
does not block for that reason.

## The spike's findings, and where they went

The `mind-spike` branch (2251bf7) built th against a fake and listed the spec points that did not
work as written. In this build:

1. `th say <thread>`: messages always go to today's thread; `thread_id: 'system'` (night and reflex
   errors) is in API.md §11.7, and th takes `today` or `system`.
2. Stop on a 204: `TH-Stop: 1` is a response header (API.md §1) on say and status replies, and
   `POST /v1/mind/stop` is the owner's tap.
3. The briefing's section marker is `## <n>. <Name>` at the start of a line (MEMORY.md §9); the
   hook and `--section` cut on it.
4. Messages shown in a claimed briefing count as handed out and need an ack within 120 s
   (RUNTIME.md §4.5, DATA.md §4.2).
5. Open threads close with `PATCH /v1/memory/open-threads/:id {status, why}` (P3 route).
6. The small routes: `GET /v1/work/orders/:id` (P4), `since` on `GET /v1/ops/errors`, `since` and
   `kind` on `GET /v1/ledger`, `ledger_id` in verb and surface replies. `th approved` is dropped:
   protected paths are always denied in mind sessions until P4.
7. `th decide` has `--reject` and `--spec-hash` (RUNTIME.md §5.3).
8. `th file`: the presigned download needs the private bucket's host in the network list; it
   arrives with attachments (SETUP.md J2).
9. The pre-tool hook is a soft gate; the environment's network list is the real control
   (RUNTIME.md §6.4).
10. `mind/CONSTITUTION.md` exists, so `th brief` sends its SHA-256 (or `none` if it is missing).
11. Stop hook without `background_tasks`: documented above; its block reason uses `TH_WAIT_MINUTES`.
12. Defaults: `th remember` uses `--subject owner` and `--source user`; `th propose` options default
    to "Do it|Not now".
13. Node 22.22 works (`NODE_USE_ENV_PROXY` exists from 22.21); `engines` stays `>=22`.
14. The full briefing is at `$TMPDIR/th/brief.md`.
