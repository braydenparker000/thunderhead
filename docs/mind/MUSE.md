# Muse

Muse's place in the Thunderhead: a separate AI agent that does routine jobs through **work orders**, never through conversation with the mind. This page fixes the work-order schema, what Muse may and may not do, its token, how its results are checked, how it moves off the old relay, and what happens when it goes silent.

## Rules at a glance

1. **Muse is a worker, not a second mind.** It takes work orders, returns results that match a schema, and posts short notes in its own thread. It writes no memory and no code, and it never instructs the mind.
2. **Everything Muse returns is outside text** (taint). It can be shown, labelled "from Muse", and cited. It can never become a fact, a rule, an approval or an instruction.
3. **The Worker validates every result** against the order's schema before anyone sees it. Invalid results are rejected with reasons and never shown.
4. **Muse's token is scoped to its own orders and its own thread**, issued from Settings → Agents, and stored only as a hash in `Auth`.
5. **No personal data goes to Muse without the owner's approval** (a device tap or the owner's own words, owner ruling). An order carrying personal data is `reach_people`. The one standing exception is the Board brief, which the owner approves once **[proposal]**.
6. **The switch from the old relay happens in P4**, with 7 days of running in parallel, and the old token is retired only with the owner's approval.
7. **When Muse goes silent,** orders expire on time, the Briefing page says so plainly, and after two missed daily orders the mind asks once whether to take the job over.

Sibling docs: [BEHAVIOR.md §11](BEHAVIOR.md#11-outside-content-muse-output-web-pages-files) (outside content), [RUNTIME.md §7](RUNTIME.md#7-environments-and-tokens) (token roles), [MEMORY.md §6](MEMORY.md#6-provenance-and-taint-rules-worker-enforced) (taint rules M6), [EVALS.md](EVALS.md) (INJ-10, INJ-11). Engineering: [API.md](../engineering/API.md) (canonical routes), [SECURITY.md](../engineering/SECURITY.md), [MIGRATION.md](../engineering/MIGRATION.md) (importing Muse's history), [JOBS.md](../engineering/JOBS.md).

---

## 1. Who Muse is

- A separate AI agent the owner already uses, running on its own plan, outside Claude Code. It reaches the backend server to server with a bearer token.
- Today it talks to the **old** Worker through the relay (`/relay/mast/*`): it publishes the Daily Board, follows a written procedure for music uploads, and keeps a private line with the owner.
- **Muse keeps producing the Daily Board (owner ruling).** The Board is merged into the chat: the mind arranges Muse's edition into the Briefing page. Muse's procedures may change when a better option exists.
- In the Thunderhead it becomes the "hands" for routine work: jobs that are repetitive, well specified, and checkable by a schema. The mind directs; Muse does; the Worker checks.
- The owner's private conversation with Muse stays in Muse's own app. The Thunderhead does not read it. **[proposal]**

---

## 2. What Muse may and may not do

| Muse may | Muse may not |
|---|---|
| Read work orders assigned to `muse` (queued or claimed by itself) | Read messages, memory, the ledger, other threads, events, or the profile |
| Claim one order at a time **[proposal]**, heartbeat it, return a result or a failure | Create, edit or cancel orders |
| Post notes in its own `muse` thread (questions, status) | Post in the owner's daily thread, write home lines, surfaces or pushes |
| Upload result files for its claimed order (≤ 15 MB each, ≤ 10) | Write anywhere in R2 except its order's upload slot |
| Read the Board brief, when the owner's standing approval exists | Read any other personal data |
| Call `GET /v1/work/hello` to see its scopes | Touch auth, devices, tokens, settings, deploys, the repo |

The mind may: create and cancel orders, read results, summarise them in its own words ("Muse reports …"), reply in the `muse` thread. It may not: forward the owner's messages to Muse, or copy memory into an order, without a `reach_people` proposal.

**Acceptance:** route-scope test: every route with the `muse` token returns `403` except the `/v1/work/*` routes listed in §4.

---

## 3. Work orders

### 3.1 Schema

```sql
work_orders(
  id TEXT PRIMARY KEY,                       -- UUIDv7
  kind TEXT NOT NULL,                        -- 'board.edition' | 'research.brief' | 'media.check' | later 'music.ingest'
  assignee TEXT NOT NULL,                    -- 'muse' | 'edge' (edge = small Workers AI models, P8)
  title TEXT NOT NULL,                       -- ≤ 80 chars, shown on cards
  spec_json TEXT NOT NULL,                   -- instructions + inputs, ≤ 16 KB, {"v":1, ...}
  schema_json TEXT NOT NULL,                 -- result schema (JSON Schema subset, §5), ≤ 8 KB
  personal INTEGER NOT NULL,                 -- 1 if the spec carries owner data
  approval_id TEXT,                          -- proposal id when personal = 1
  recurrence TEXT,                           -- NULL | 'daily@HH:MM' (owner-local)   [proposal]
  deadline_at INTEGER NOT NULL,
  status TEXT NOT NULL,                      -- 'queued'|'claimed'|'done'|'rejected'|'failed'|'expired'|'cancelled'
  attempts INTEGER NOT NULL DEFAULT 0,       -- claims so far, max 3
  created_by TEXT NOT NULL,                  -- session id or 'owner'
  created_at INTEGER NOT NULL,
  claimed_at INTEGER, heartbeat_at INTEGER, heartbeat_note TEXT,   -- note ≤ 120 chars
  result_json TEXT,                          -- ≤ 256 KB
  result_files_json TEXT,                    -- [{ref, name, type, size, sha256}]
  result_valid INTEGER,                      -- 1 | 0
  result_errors_json TEXT,                   -- validator messages when invalid
  finished_at INTEGER)
```

`spec_json` always has: `v`, `goal` (one sentence), `inputs` (object), `constraints` (list of strings), `done_when` (one sentence), `sources_policy` (for research kinds: "primary sources first; at least 2 independent").

### 3.2 States

```
queued ──claim──► claimed ──result (valid)──► done
   ▲                 │  └──result (invalid)──► rejected ──(mind may re-queue a fixed order as a new id)
   │                 ├──fail──► failed (attempts < 3 → queued again)
   └──lease lapses───┘
queued/claimed ──deadline passes──► expired
queued/claimed ──mind or owner cancels──► cancelled
```

| Rule | Value |
|---|---|
| Claim lease | 30 min; each heartbeat extends it to 30 min from now |
| Heartbeat | At least every 10 min while working |
| Lease lapses | Back to `queued`, `attempts + 1` |
| Max attempts | 3, then `failed` |
| Deadline | Hard. At `deadline_at` an unfinished order becomes `expired`, even if claimed |
| Recurring orders | When a `daily@HH:MM` order finishes or expires, the Worker creates the next instance for the next day with deadline at `HH:MM` |

### 3.3 Order kinds

| Kind | Phase | What Muse does | Result schema (summary) | Personal? |
|---|---|---|---|---|
| `board.edition` | P4 (moves over from the relay) | Writes the day's Board from the owner's Board brief | The Board format (v2) from the old repo's doc, re-specified in [BRIEFING.md](../product/BRIEFING.md) | Uses the brief: covered by the standing approval |
| `research.brief` | P4 **[proposal]** | Web research on a non-personal topic the mind names | `{summary ≤ 1200, findings:[{claim ≤ 280, sources:[url]≥1}] ≤ 12, unknowns:[string] ≤ 5}` | No |
| `media.check` | P4 **[proposal]** | Check that a list of public feed or page URLs still work and report changes | `{items:[{url, ok, status, note ≤ 120}] ≤ 100}` | No |
| `music.ingest` | P5 **[proposal]** | Upload new audio by content hash and register it (replaces the old music procedure) | `{tracks:[{sha256, title ≤ 200, artist ≤ 200, duration_ms}] ≤ 100}` | No (titles of the owner's own music are stored privately; they are owner data going *from* Muse) |

**Acceptance:** each kind has a fixture spec, a valid result and an invalid result in `backend/tests/fixtures/work/`; the validator accepts and rejects them as expected.

---

## 4. Muse's API

All under `/v1/work/` with `Authorization: Bearer <muse token>`, JSON only, no `Origin` header (server to server). Route names are **[proposal]** until [API.md](../engineering/API.md) fixes them.

| Route | Does | Returns |
|---|---|---|
| `GET /v1/work/hello` | First contact and self-check | `{agent:"muse", scopes:[…], server_time, board_brief_allowed: bool}` |
| `POST /v1/work/claim` | Claims the oldest `queued` order assigned to `muse` whose deadline hasn't passed | `200 {order}` or `204` when none |
| `POST /v1/work/orders/:id/heartbeat` | `{note?}` | `{lease_until}` |
| `PUT /v1/work/orders/:id/result` | `{result, files?}` | `200 {status:"done"}` or `422 {error:{code:"invalid_result", details:[…]}}` (order becomes `rejected`) |
| `POST /v1/work/orders/:id/fail` | `{reason ≤ 280}` | `{status}` |
| `POST /v1/work/orders/:id/files` | Upload one file (body = bytes, header `X-File-Name`) | `{ref, sha256}` |
| `GET /v1/work/board/brief` | The owner's Board brief, if the standing approval exists | `{version, brief}` or `403` |
| `GET /v1/work/thread?after=<seq>` | Muse's own thread | `{items, next}` |
| `POST /v1/work/thread/messages` | `{id, body ≤ 2000}` | `{id}` |

Polling: Muse calls `POST /v1/work/claim` every 5 min when idle (288 requests a day, already in the Worker budget), and again at once after finishing an order.

---

## 5. How results are validated

In this order, in the Worker. The first failure rejects the result.

1. **Lease:** the caller holds the claim and the order is `claimed`. Else `409 conflict`.
2. **Size:** body ≤ 256 KB; each file ≤ 15 MB, ≤ 10 files. Else `413 too_large`.
3. **Parse:** valid JSON object with `"v"`. Else `422`.
4. **Schema:** the JSON Schema subset validator (`backend/src/areas/work/validate.ts`, about 80 lines, no ajv). Supported keywords: `type`, `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `minimum`, `maximum`, `pattern` (anchored, ≤ 200 chars, no backreferences), `format: "uri"` (https only). Unknown keywords in an order's schema are refused when the mind creates the order, not when Muse answers.
5. **Hygiene:** strip control characters except newline and tab; refuse token-shaped strings (`tha_`, `sk-`, long base64 runs); refuse `javascript:` and `data:` URLs.
6. **Store:** `result_json`, `result_valid=1`, `status=done`, `finished_at`. The result is marked `origin=muse` everywhere it travels.
7. **Notify:** a `work.done` event reaches the mind's `th wait` (chat) or the next briefing (section 10).

After validation, the mind still treats the content as data: for long results it uses the quarantined reader (P4). Board editions are arranged by the mind into the Briefing page (where the Board sits, which items link into which app) and rendered as outside content with a "from Muse" label; the mind never rewrites them in its own voice; the page escapes all text and allows links only to https URLs.

**Acceptance:** fixtures: a result with an extra property → `422` with the property named; a result with a `javascript:` link → `422`; a valid result → `done` and a `work.done` event.

---

## 6. Personal data and approvals

1. The mind sets `personal=1` on any order whose spec contains owner data (messages, facts, listening history, notes, names). The Worker requires `approval_id` pointing to an approved `reach_people` proposal whose spec hash covers this order's spec. Without it: `403 needs_approval`.
2. **Standing approval for the Board [proposal]:** the owner approves once a `reach_people` proposal "Let Muse read your Board brief to write the daily Board" with spec `{kind:"board.edition", fields:["board_brief"]}`. It stays valid until revoked in Settings → Agents. It covers only the brief the owner wrote, never memory.
3. The mind cannot detect personal data perfectly, so the weekly in-session review samples 10 orders and checks the flag. Any miss is a `kind=mistake` ledger row.

**Acceptance:** an order with `personal=1` and no approval is refused (backend test); revoking the Board approval makes `GET /v1/work/board/brief` return `403` within 60 s.

---

## 7. Muse's token

| Property | Value |
|---|---|
| Issued | Settings → Agents → "Add agent: Muse" on a signed-in device; shown once |
| Format | `tha_muse_<43 base64url chars>` **[proposal]** |
| Stored | SHA-256 only, in the `Auth` Durable Object (decisions.md) |
| Scope | `/v1/work/*` above; nothing else |
| Shown in Settings | Name, created, last used (to the hour), calls today, a Revoke button |
| Rotation | On suspicion, or yearly **[proposal]**: issue a new one, send it to Muse, revoke the old one after Muse's first call with the new one |
| Old values | The old relay's token is never reused in the new Worker |

---

## 8. Switching from the old relay (P4)

The old Worker stays untouched and live until every caller has switched (decisions.md).

| Step | Who | Action | Done when |
|---|---|---|---|
| 1 | Mind | Build `/v1/work/*`, the validator, the `muse` thread, the Board standing approval, with tests | CI green, live |
| 2 | Mind | Import Muse's history from the old export: chat → a `muse` thread (`origin=import`), finished jobs → closed `work_orders` | Import counts match, 5 spot checks |
| 3 | Owner | Settings → Agents → issue Muse's token; approve the Board standing approval | Token shown once |
| 4 | Mind | Write the brief for Muse (template below) and show it to the owner as a card with a copy button. The mind cannot send it: reaching Muse with a token is the owner's act | Card shown |
| 5 | Owner | Sends the brief and token to Muse through Muse's own channel | — |
| 6 | Muse | Calls `GET /v1/work/hello` | Worker records `muse_first_seen_at`; Briefing page: "Muse is connected to the new Worker." |
| 7 | Both | 7 days in parallel: the new Worker queues `board.edition` daily; Muse may still publish to the old relay; the Briefing page shows the new edition | 7 consecutive valid editions on the new Worker |
| 8 | Mind | Checks the old relay has had no Muse calls for 7 days (from the old Worker's public health or the owner's look at its logs; the mind holds no Cloudflare token) and creates an `access` proposal: "Muse has moved. Retire its old relay token?" | Proposal waiting |
| 9 | Owner | Approves (tap or own words), then removes the old secret in the old Worker's dashboard (the mind has no credential for it) | Old relay returns 401 to Muse |

**The brief for Muse** (template; the mind fills the bracketed values and nothing personal):

> The backend you work with has moved. From now on:
> - Base URL: [new Worker URL]. Token: [shown once to the owner, pasted here by the owner].
> - Start with `GET /v1/work/hello`. Then every 5 minutes, `POST /v1/work/claim`. When you get an order, follow its `spec`, send a heartbeat at least every 10 minutes, and finish with `PUT /v1/work/orders/{id}/result`. Your result must match the order's `schema` exactly; if it doesn't, you'll get a 422 that names the problem.
> - Your daily Board is now an order of kind `board.edition`. Read the brief from `GET /v1/work/board/brief`.
> - You can post short notes or questions in your thread: `POST /v1/work/thread/messages`.
> - The old relay address keeps working for 7 days, then it will be switched off.

---

## 9. When Muse is silent

| Signal | Threshold | Response | Owner sees |
|---|---|---|---|
| An order passes its deadline unfinished | `deadline_at` | `expired`; ledger row | The order's card (if any) shows "Expired" |
| Claimed but no heartbeat | 30 min | Lease lapses; back to `queued`, `attempts+1` | Nothing |
| No Muse API call at all | 26 h (watchdog, P4) | Watchdog `muse_silent` trips; one ledger note | Briefing page: "Muse hasn't checked in since yesterday." |
| Daily Board missing | Not `done` by 07:30 local **[proposal]** | Board section shows the last edition with its date | Briefing page: "No Board today (Muse didn't deliver)." |
| Two consecutive daily orders of the same kind expired | 2 | The mind asks once (decision card, not a push) | "Muse went quiet. Shall I take over its Board job tonight?" (the prototype's decision) |

Decision outcomes:
- **Yes:** a stopgap only; Muse stays the Board's producer (owner ruling). The night shift does that kind itself for up to 7 days, or until Muse delivers a valid result again, whichever comes first. Each night's work is a ledger row ("Wrote the Board myself because Muse was silent"). When Muse returns, the mind stops and says so in one Briefing line.
- **No / Not now:** nothing more is done for that outage. The mind may raise it once more after 7 days if Muse is still silent (law 4: remind once), then lets go.
- **Ignored for 7 days:** expires; same as No.

The mind never contacts Muse about the silence except by a note in the `muse` thread, and never tries to reach Muse by any other channel.

**Acceptance (P4):** in a test, two expired `board.edition` orders create exactly one decision card; answering Yes makes the next night shift produce a Board marked "written by the Thunderhead"; a valid Muse result the next day stops the takeover.

---

## Open questions / tests

| # | Question | How to settle it |
|---|---|---|
| 1 | Should the owner's private conversation with Muse ever be visible in the Thunderhead? | Owner decision; default here: no. |
| 2 | Does the owner accept the Board standing approval as a one-time `reach_people` approval? | Owner decision at P4. |
| 3 | 07:30 as the Board deadline? | Owner decision; match the owner's usual first open (from events after P5). |
| 4 | The prototype's "No" toast says "I'll ask about Muse tomorrow"; this page says "raise once more after 7 days". | Writer A / COPY.md to align; recommend this page's rule (law 4). |
| 5 | Can Muse follow a JSON schema reliably enough? | Run the parallel week (step 7); target ≥ 6/7 valid on the first try. |
| 6 | Is Muse's music procedure (signed uploads) worth keeping as an order kind, or does the music upload tool replace it? | Decide at P5 with [MUSIC.md](../product/apps/MUSIC.md). |
