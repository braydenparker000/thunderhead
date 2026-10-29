# Contract appendix

<!-- Generated from shared/contract by scripts/contract.mjs; do not edit. Run `node scripts/contract.mjs`. -->

The runtime contract as data, generated from [`shared/contract`](../../shared/contract). [API.md](API.md) describes each route; this appendix lists what the code enforces. How to add to it: [EXTENDING.md](EXTENDING.md).

Who: D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci. Built phases: P1, P1b, P2, P3.

## Routes

| Route | Who | Phase | Status | Note |
|---|---|---|---|---|
| `GET /v1/health` | public | P1 | built |  |
| `GET /v1/auth/state` | public | P1 | built |  |
| `POST /v1/auth/setup` | public | P1 | built |  |
| `POST /v1/auth/login` | public | P1 | built |  |
| `POST /v1/auth/recover` | public | P1 | built |  |
| `GET /v1/ops/health/deep` | D C N R I | P1 | built |  |
| `POST /v1/auth/signout` | D | P1 | built |  |
| `POST /v1/auth/password` | D | P1 | built |  |
| `POST /v1/auth/recovery-code` | D | P1 | built |  |
| `POST /v1/auth/recovery-code/confirm` | D | P1 | built |  |
| `POST /v1/auth/breakglass/cancel` | D | P1 | built |  |
| `POST /v1/auth/notices/:id/ack` | D | P1 | built |  |
| `GET /v1/auth/sessions` | D | P1 | built |  |
| `PATCH /v1/auth/sessions/:id` | D | P1 | built |  |
| `DELETE /v1/auth/sessions/:id` | D | P1 | built |  |
| `GET /v1/auth/agents` | D | P1 | built |  |
| `POST /v1/auth/agents` | D | P1 | built |  |
| `DELETE /v1/auth/agents/:id` | D | P1 | built |  |
| `GET /v1/auth/me` | D C N R M I | P1 | built |  |
| `POST /v1/auth/breakglass` | C | P1 | built |  |
| `GET /v1/settings` | D C N R | P1 | built |  |
| `PATCH /v1/settings` | D | P1 | built |  |
| `POST /v1/ops/errors` | D C N R | P1 | built |  |
| `GET /v1/ops/errors` | D C N R I | P1 | built |  |
| `GET /v1/ops/meter` | D C N R I | P1 | built |  |
| `POST /v1/ops/errors/:fp/resolve` | D C R | P1 | built |  |
| `POST /v1/ops/perf` | D | P1 | built |  |
| `POST /v1/import/phone` | D | P1b | deferred: the private bucket (SETUP.md J2) |  |
| `POST /v1/live/ticket` | D | P2 | built |  |
| `GET /v1/live` | D (ticket) | P2 | built | WebSocket; the ticket comes from POST /v1/live/ticket |
| `GET /v1/live/wait` | C N R | P2 | built |  |
| `GET /v1/changes` | D C N R | P2 | built |  |
| `GET /v1/threads` | D C N R | P2 | built |  |
| `GET /v1/threads/today` | D C N R | P2 | built |  |
| `GET /v1/threads/:id` | D C N R | P2 | built |  |
| `GET /v1/threads/:id/messages` | D C N R | P2 | built |  |
| `PATCH /v1/threads/:id` | C N | P2 | built |  |
| `POST /v1/threads/:id/continue` | D | P2 | built |  |
| `PUT /v1/messages/:id` | D C N R | P2 | built | N and R: kind 'error' with thread_id 'system' only |
| `PATCH /v1/messages/:id` | C | P2 | built | own posts only |
| `PUT /v1/files/:id` | D C | P2 | deferred: the private bucket (SETUP.md J2) |  |
| `GET /v1/search` | D C N | P2 | built |  |
| `POST /v1/mind/typing` | D | P2 | built |  |
| `POST /v1/mind/stop` | D | P2 | built | the owner taps Stop: the work ends, not the session |
| `GET /v1/mind/wakes` | D C N R | P2 | built |  |
| `POST /v1/mind/brief` | C N R | P2 | built |  |
| `POST /v1/mind/status` | C N R | P2 | built |  |
| `POST /v1/mind/notes` | C N R | P2 | built |  |
| `POST /v1/mind/taint` | C N R | P2 | built |  |
| `GET /v1/mind/pending` | C N R | P2 | built |  |
| `GET /v1/ledger` | D C N R | P2 | built |  |
| `PUT /v1/ledger/:id` | C N R | P2 | built |  |
| `POST /v1/ledger/:id/undo` | D C | P2 | built | mind:chat: its own actions only |
| `PUT /v1/verbs/:id` | C N | P2 | built |  |
| `GET /v1/verbs/pending` | D | P2 | built |  |
| `POST /v1/verbs/:id/claim` | D | P2 | built |  |
| `POST /v1/verbs/:id/result` | D | P2 | built |  |
| `GET /v1/surfaces` | D C N R | P2 | built |  |
| `PUT /v1/surfaces/:app/:slot` | C N | P2 | built |  |
| `DELETE /v1/surfaces/:app/:slot` | D C N | P2 | built |  |
| `POST /v1/media/sign` | D C N | P2 | deferred: the private bucket (SETUP.md J2) |  |
| `POST /v1/mind/night` | N | P3 | deferred: P3 stage C (the night shift) |  |
| `GET /v1/mind/day/:day` | N | P3 | deferred: P3 stage C (the night shift) |  |
| `GET /v1/memory/facts` | D C N | P3 | built |  |
| `GET /v1/memory/facts/:id` | D C N | P3 | built | one fact: its earlier versions, evidence and why |
| `GET /v1/memory/profile` | D C N | P3 | built |  |
| `GET /v1/memory/day-notes` | D C N | P3 | built |  |
| `GET /v1/memory/open-threads` | D C N | P3 | built |  |
| `POST /v1/memory/ops` | D C N | P3 | built | pin, may_raise and forget: device only |
| `PUT /v1/memory/day-notes/:day` | D N | P3 | built | device: the owner's edit (written_by owner) |
| `PUT /v1/memory/open-threads/:id` | D C N | P3 | built |  |
| `PATCH /v1/memory/open-threads/:id` | D C N | P3 | built | {status, why}: done or dropped |
| `POST /v1/import/runs` | D C | P3 | deferred: P3 stage D (the import) |  |
| `POST /v1/ops/import/parts` | C I | P3 | deferred: P3 stage D (the import) |  |
| `PUT /v1/ops/import/manifest/:run_id` | C I | P3 | deferred: P3 stage D (the import) |  |
| `GET /v1/import/runs/:id` | D C N R | P3 | deferred: P3 stage D (the import) |  |
| `PUT /v1/proposals/:id` | C N R | P4 | later (P4) |  |
| `GET /v1/proposals` | D C N R | P4 | later (P4) |  |
| `POST /v1/proposals/:id/decide` | D C | P4 | later (P4) | mind:chat with by_message only |
| `POST /v1/proposals/:id/cancel` | D C N R | P4 | later (P4) |  |
| `POST /v1/ops/backups/run` | N I | P4 | later (P4) |  |
| `POST /v1/ops/drill/run` | N I | P4 | later (P4) |  |
| `GET /v1/ops/backups` | D C N R I | P4 | later (P4) |  |
| `POST /v1/ops/restore` | D C N R | P4 | later (P4) |  |
| `POST /v1/export` | D | P4 | later (P4) |  |
| `GET /v1/export/:id` | D | P4 | later (P4) |  |
| `PUT /v1/work/orders/:id` | C N | P4 | later (P4) |  |
| `POST /v1/work/orders/:id/cancel` | D C N | P4 | later (P4) |  |
| `GET /v1/work/orders` | D C N R | P4 | later (P4) |  |
| `GET /v1/work/orders/:id` | D C N R | P4 | later (P4) |  |
| `GET /v1/work/hello` | M | P4 | later (P4) |  |
| `POST /v1/work/claim` | M | P4 | later (P4) |  |
| `PUT /v1/senses/batches/:id` | D | P5 | later (P5) |  |
| `POST /v1/senses/query` | C N R | P5 | later (P5) |  |
| `GET /v1/jobs/next` | N I | P5 | later (P5) |  |
| `POST /v1/jobs/:id/collect` | N I | P5 | later (P5) |  |
| `GET /v1/jobs/:id` | C N R I | P5 | later (P5) |  |
| `GET /v1/jobs/:id/spec` | I | P5 | later (P5) |  |
| `PUT /v1/pushes/:id` | C | P8 | later (P8) |  |

## Verbs

| Verb | App | Class | Runs on | Queueable | Undo | Versions | Args (newest) | What it does |
|---|---|---|---|---|---|---|---|---|
| `app.open` | shell | reversible | device | no (owner tap) | none | 1 | `{ app: 'music' \| 'guitar' \| 'podcasts' \| 'astra' \| 'media' \| 'study', path: string }` | Opens an app at a place. Runs only when the owner taps a reply's action chip; the mind never opens an app by itself (BEHAVIOR.md §2.2). |
| `shell.appearance` | shell | reversible | device | yes | reported | 1 | `{ mode: 'auto' \| 'day' \| 'night' }` | Sets the phone's appearance (auto, day or night). The phone reports the previous mode as the undo. |

## Surface kinds

| Kind | Slots | Versions | Payload (newest) | What it is |
|---|---|---|---|---|
| `line` | home `^line\.[1-4]$` | 1 | `{ text: string, lang?: string }` | A home line under the voice line (HOME.md §2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line. |

## Change kinds

`message` · `thread` · `ledger` · `proposal` · `verb` · `surface` · `notice` · `fact` · `day_note` · `open_thread` · `setting` · `mind_status` · `error`

## Live channel

Protocol 1. Frames (server → client): `hello`, `changed`, `typing`, `bye`. Close codes: 4401 revoked, 4426 outdated, 1012 restart.

## Apps

| App | Folder | Name | Phase |
|---|---|---|---|
| `music` | `/music/` | Music | P1b |
| `guitar` | `/guitar/` | Guitar | P1b |
| `podcasts` | `/podcasts/` | Podcasts | P1b |
| `astra` | `/astra/` | Astra | P1b |
| `media` | `/media/` | My Media | P1b |
| `study` | `/study/` | Study | P7 |

## Search sources

| Source | Phase | Ref kind |
|---|---|---|
| `messages` | P2 | `msg` |
| `facts` | P3 | `fact` |
| `day_notes` | P3 | `day` |
| `library` | P7 | `book` |

## Memory

| Fact kind | Half-life (days) | Profile cap |
|---|---|---|
| `state` | 3 | 10 |
| `goal` | 90 | 10 |
| `preference` | 180 | 25 |
| `routine` | 60 | 15 |
| `fact` | 1825 | 30 |
| `rule` | never decays | not in the profile (briefing section 3) |

| Source | Starts at | Cap | Profile letter |
|---|---|---|---|
| `user` | 0.95 | 0.95 | u |
| `observed` | 0.7 | 0.85 | o |
| `inferred` | 0.5 | 0.8 | i |

| Refusal reason | Meaning |
|---|---|
| `bad_op` | The op does not match its shape. |
| `bad_evidence` | Evidence must be 1–20 existing messages, day notes, imports or owner ledger rows. |
| `unknown_ref` | The fact this op names does not exist. |
| `not_owner_evidence` | A 'user' fact needs evidence that is all the owner's own words. |
| `rule_needs_owner` | A rule needs source 'user'. |
| `too_little_evidence` | An 'observed' fact needs at least 10 owner-device events. |
| `tainted_evidence` | Muse or outside text is never evidence. |
| `needs_owner_words` | Faith and facts about people come only from the owner's words. |
| `too_long` | One claim, at most 280 characters. |
| `no_inferred_sensitive` | Sensitive traits are never inferred. |
| `session_tainted` | This session read outside text, so it may not write memory. |
| `laws_unpinned` | This session's constitution is missing, so it may not write rules. |
| `device_only` | Only the owner can do this, from the Memory page. |
| `duplicate_id` | A fact with this id already exists. |
| `superseded` | This fact was already replaced; work on its newest version. |
| `proposal_required` | This change needs the owner first (decision cards arrive in P4). |

## Error codes

| Code | Status | Message |
|---|---|---|
| `bad_request` | 400 | The request could not be read. |
| `unauthorized` | 401 | Sign in to continue. |
| `session_revoked` | 401 | This session was signed out. |
| `session_expired` | 401 | This session expired after 90 idle days. |
| `wrong_username_or_password` | 401 | That username and password don't match. |
| `wrong_username_or_code` | 401 | That username and code don't match. |
| `setup_code_wrong` | 401 | The setup code doesn't match the installed fingerprint. |
| `current_password_wrong` | 401 | That's not the current password. |
| `forbidden` | 403 | This principal may not call this route. |
| `origin_not_allowed` | 403 | This origin is not allowed. |
| `not_owner_words` | 403 | The cited message is not the owner's latest words after the card. |
| `session_tainted` | 403 | This session is tainted. |
| `laws_unpinned` | 403 | The constitution pin failed for this session. |
| `proposal_required` | 403 | This needs an approved proposal. |
| `needs_approval` | 403 | This work order needs an approved reach_people proposal. |
| `not_found` | 404 | Not found. |
| `conflict` | 409 | Same id, different body. |
| `already_decided` | 409 | Already decided. |
| `already_undone` | 409 | Already undone. |
| `already_claimed` | 409 | Already claimed. |
| `already_live` | 409 | Another chat session holds the lease. |
| `decision_budget` | 409 | Three proposals are already waiting. |
| `nudge_repeat` | 409 | This topic was ignored in the last 14 days. |
| `push_budget` | 409 | Push budget used up. |
| `push_gap` | 409 | Too soon after the last push. |
| `quiet_hours` | 409 | Quiet hours. |
| `quiet` | 409 | The owner asked for quiet. |
| `spec_mismatch` | 409 | The spec hash differs from the stored one. |
| `setup_required` | 409 | Set up the account first. |
| `setup_fp_missing` | 409 | No setup fingerprint is installed yet. |
| `reset_already_pending` | 409 | A reset is already waiting. |
| `agent_name_taken` | 409 | An active key already has that name. |
| `agent_limit` | 409 | There are already 20 active keys. |
| `setup_done` | 410 | Setup is already done. |
| `expired` | 410 | Past its time. |
| `reset_cancelled` | 410 | This reset was cancelled. |
| `reset_expired` | 410 | This reset expired. |
| `reset_used` | 410 | This reset was already used. |
| `resync_required` | 410 | Reload the full state. |
| `too_large` | 413 | The request is too large. |
| `unsupported_media_type` | 415 | Wrong content type. |
| `validation` | 422 | Some fields are not valid. |
| `password_too_short` | 422 | Use at least 15 characters. |
| `password_too_long` | 422 | Use at most 128 characters. |
| `password_guessable` | 422 | Don't use the username or the app's name in it. |
| `password_breached` | 422 | This password has appeared in a data breach. |
| `password_same` | 422 | That's the current password. |
| `invalid_result` | 422 | The result fails its schema. |
| `too_sensitive` | 422 | This points at sensitive data. |
| `username_invalid` | 422 | Use 3–32 letters, numbers, dots, dashes or underscores. |
| `reset_not_ready` | 425 | The reset ticket is not usable yet. |
| `client_outdated` | 426 | A newer client is required for writes. |
| `rate_limited` | 429 | Too many attempts. Try again soon. |
| `internal` | 500 | Something went wrong on our side. |
| `upstream` | 502 | An upstream service failed. |
| `budget_exhausted` | 503 | Today's free-plan budget is used up. |
| `auth_unavailable` | 503 | Sign-in is unavailable. |
| `unavailable` | 503 | Temporarily unavailable. |

## Phrase lint

"great question" · "amazing work" · "you're a natural" · "don't break your streak" · "i deeply apologize" · "i'm so sorry" · "i have successfully" · "keep pushing forward" · "as an ai language model" · "i will now run" · "using the bash tool"
