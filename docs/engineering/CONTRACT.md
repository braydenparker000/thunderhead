# Contract appendix

<!-- Generated from shared/contract by scripts/contract.mjs; do not edit. Run `node scripts/contract.mjs`. -->

The runtime contract as data, generated from [`shared/contract`](../../shared/contract). [API.md](API.md) describes each route; this appendix lists what the code enforces. How to add to it: [EXTENDING.md](EXTENDING.md).

Who: D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci. Built phases: P1, P1b, P2, P3, P4, P5, P6, P7, P8.

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
| `POST /v1/media/sign` | D C N | P2 | built | music: refs (device only, P5), book: refs (P7); file: refs are not signable yet; 503 not_configured until the signing key is set |
| `POST /v1/mind/night` | N | P3 | built | the night run: start, step done, cursor, done |
| `GET /v1/mind/day/:day` | N | P3 | built | a closed day's stats, messages, ledger and notes |
| `GET /v1/memory/facts` | D C N | P3 | built |  |
| `GET /v1/memory/facts/:id` | D C N | P3 | built | one fact: its earlier versions, evidence and why |
| `GET /v1/memory/profile` | D C N | P3 | built |  |
| `GET /v1/memory/day-notes` | D C N | P3 | built |  |
| `GET /v1/memory/open-threads` | D C N | P3 | built |  |
| `POST /v1/memory/ops` | D C N | P3 | built | pin, may_raise and forget: device only |
| `PUT /v1/memory/day-notes/:day` | D N | P3 | built | device: the owner's edit (written_by owner) |
| `PUT /v1/memory/open-threads/:id` | D C N | P3 | built |  |
| `PATCH /v1/memory/open-threads/:id` | D C N | P3 | built | {status, why}: done or dropped |
| `POST /v1/import/runs` | D C (agents: the key `import-once` only) | P3 | built | one dataset of an export run (the owner, or the import-once key); 503 not_configured without VAULT |
| `POST /v1/ops/import/parts` | C (agents: the key `import-once` only) | P3 | built | one gzip JSONL part of the old export, stored as sent; never-exported tables 403 |
| `PUT /v1/ops/import/manifest/:run_id` | C (agents: the key `import-once` only) | P3 | built | the export run's manifest, written last, after every part it names |
| `GET /v1/import/runs/:id` | D C N R | P3 | built | state, counts and the verification report |
| `PUT /v1/proposals/:id` | C N R | P4 | built | an agent raises a decision card (from a claimed, untainted session) |
| `GET /v1/proposals` | D C N R | P4 | built |  |
| `POST /v1/proposals/:id/decide` | D C | P4 | built | device: a tap; mind:chat: the owner's own words (by_message) only |
| `POST /v1/proposals/:id/cancel` | D C N R | P4 | built | the agent that raised it, or the owner |
| `POST /v1/evals/sandbox` | C N | P4 | built | with TH-Sandbox: eval only: reset the eval sandbox to a synthetic seed |
| `GET /v1/evals/sandbox` | C N | P4 | built | with TH-Sandbox: eval only: what was written or tried since the reset |
| `PUT /v1/evals/runs/:id` | C N | P4 | built | one finished suite, numbers and ids only (never in the sandbox) |
| `GET /v1/evals/runs` | D C N | P4 | built |  |
| `GET /v1/ops/watchdogs` | D C N R I | P4 | built | every watchdog, its state and the SLO it guards |
| `POST /v1/ops/watchdogs/:name/handled` | C N R | P4 | built | what a mind session did about a trip (the reflex reports each one) |
| `POST /v1/ops/watchdogs/:name/drill` | D C | P4 | built | trip one watchdog by hand when the owner asks, to check that mind-reflex handles it (nothing is wrong) |
| `POST /v1/ops/backups/run` | N I | P4 | built | start the weekly backup now (the one running is answered again) |
| `POST /v1/ops/drill/run` | N I | P4 | built | the restore drill of the newest complete backup, now |
| `GET /v1/ops/backups` | D C N R I | P4 | built | counts only |
| `POST /v1/ops/restore` | D C N R | P4 | deferred: restores as proposals (OPERATIONS.md §4), after the drill has passed live |  |
| `POST /v1/export` | D | P4 | built | with the password again |
| `GET /v1/export/:id` | D | P4 | built | only the device that asked |
| `GET /v1/export/:id/zip` | D | P4 | built | the ZIP, streamed, for an hour, to the device that asked |
| `PUT /v1/work/orders/:id` | C N | P4 | built | a work order for Muse; its result schema is the kind's |
| `POST /v1/work/orders/:id/cancel` | D C N | P4 | built |  |
| `GET /v1/work/orders` | D C N R | P4 | built |  |
| `GET /v1/work/orders/:id` | D C N R | P4 | built |  |
| `GET /v1/work/hello` | M | P4 | built |  |
| `POST /v1/work/claim` | M | P4 | built | the order Muse holds, else the oldest queued one; 204 when none |
| `POST /v1/work/orders/:id/heartbeat` | M | P4 | built | a 30-minute lease from now |
| `PUT /v1/work/orders/:id/result` | M | P4 | built | checked against the kind's schema; 422 names each problem |
| `POST /v1/work/orders/:id/fail` | M | P4 | built |  |
| `POST /v1/work/orders/:id/files` | M | P4 | deferred: an order kind with files (music.ingest, P5) |  |
| `GET /v1/work/board/brief` | M | P4 | built | only with the owner's standing approval |
| `GET /v1/work/thread` | M D C N | P4 | built | Muse's own thread, never the owner's conversation |
| `POST /v1/work/thread/messages` | M D C N | P4 | built |  |
| `GET /v1/board/brief` | D C N | P4 | built |  |
| `PUT /v1/board/brief` | D C N | P4 | built | the owner's Board choices; the mind writes it from the owner's words |
| `DELETE /v1/board/approval` | D | P4 | built | withdraws Muse's reading of the brief |
| `GET /v1/briefing` | D | P4 | built |  |
| `PUT /v1/briefing/place` | D | P8 | built | the weather's place, by a town's name |
| `GET /v1/board/editions/:day` | D C N | P4 | built | outside text from Muse, checked against the v2 schema |
| `GET /v1/music/catalog` | D | P5 | built | the ported player's format; ETag, 304; 409 before the import |
| `GET /v1/music/waveforms/:id` | D | P5 | built |  |
| `GET /v1/music/tracks` | C N | P5 | built | ?q=&limit=: tracks by their tags, for a playlist the mind makes |
| `PUT /v1/music/uploads/audio/:file` | public | P5 | built | signed by an upload tool key; Ogg Opus, ≤ 32 MiB |
| `PUT /v1/music/uploads/art/:file` | public | P5 | built | signed by an upload tool key; JPEG or PNG, ≤ 2 MiB |
| `POST /v1/music/uploads/:op` | public | P5 | built | signed by an upload tool key; the catalog writer's operations, export and links |
| `PUT /v1/senses/batches/:id` | D | P5 | built | a sealed batch of 1–500 events, ≤ 256 KB |
| `POST /v1/senses/query` | C N R | P5 | built | a fixed, named query; never SQL |
| `GET /v1/jobs/next` | N I | P5 | deferred: P5: the indexing jobs |  |
| `POST /v1/jobs/:id/collect` | N I | P5 | deferred: P5: the indexing jobs |  |
| `GET /v1/jobs/:id` | C N R I | P5 | deferred: P5: the indexing jobs |  |
| `GET /v1/jobs/:id/spec` | I | P5 | deferred: P5: the indexing jobs |  |
| `GET /v1/guitar/search` | D | P6 | built | Songsterr search, ?q= |
| `GET /v1/guitar/songs/:id` | D | P6 | built |  |
| `GET /v1/guitar/songs/:id/score` | D | P6 | built | ?revision=&parts= |
| `GET /v1/guitar/gprotab/search` | D | P6 | built | ?q= |
| `GET /v1/guitar/gprotab/file` | D | P6 | built | ?path=; a Guitar Pro file, bytes |
| `GET /v1/guitar/sounds/:instrument/:file` | D | P6 | built | a guitar sample, audio/mpeg |
| `GET /v1/library/books` | D C N | P7 | built | every book, its place, how far it is read |
| `POST /v1/library/books` | D | P7 | built | a book under the client's id: its record and upload |
| `GET /v1/library/books/:id` | D C N | P7 | built |  |
| `PATCH /v1/library/books/:id` | D | P7 | built | title, author, kind, language |
| `PUT /v1/library/books/:id/parts/:n` | D | P7 | built | one part, bytes: 50 MiB but the last |
| `POST /v1/library/books/:id/complete` | D | P7 | built | all parts in: the book waits for the mind |
| `POST /v1/library/books/:id/retry` | D | P7 | built | a book that could not be read, again |
| `PUT /v1/library/positions/:book_id` | D | P7 | built | the newest place wins |
| `GET /v1/library/highlights` | D | P7 | built | ?book_id= |
| `PUT /v1/library/highlights/:id` | D | P7 | built | the newest version wins |
| `GET /v1/library/search` | D C N | P7 | built | ?q=&book_id=&limit=&cursor=; ready books |
| `GET /v1/library/books/:id/file` | D | P7 | built | the whole PDF, once its upload is whole; the phone keeps it |
| `GET /v1/library/books/:id/pages` | C N | P7 | built | ?from=&limit=: a book's stored page text, for the mind |
| `POST /v1/library/ingest/claim` | C N | P7 | built | the oldest waiting book, an hour; 204 if none |
| `GET /v1/library/ingest/:job_id/file` | C N | P7 | built | the claimed book's PDF, its holder only |
| `PUT /v1/library/books/:id/pages` | C N | P7 | built | 1–50 pages of a held run; bulk lane |
| `PATCH /v1/library/ingest/:job_id` | C N | P7 | built | the run: a state, then ready or failed |
| `GET /v1/library/scripture` | D C N | P7 | built | the owner's private book table; ETag |
| `PUT /v1/library/scripture` | C N | P7 | built | the table, checked by the parser |
| `GET /v1/library/scripture/text/:code/:chapter` | D C N | P7 | built | a chapter of the owner's copy |
| `PUT /v1/library/scripture/text/:code` | C N | P7 | built | one book's text, checked by the table |
| `GET /v1/library/cite` | C N | P7 | built | ?q=: the blocks a cited answer may use, at most 20 |
| `GET /v1/library/verses/:code/:chapter` | D C N | P7 | built | ?v=12[-14]&all=1: cited in your books |
| `GET /v1/podcasts/directory` | D | P8 | built | ?q=\|?category=, &country= |
| `GET /v1/podcasts/feed` | D | P8 | built | ?url=; the feed as sent, at most 4 MB |
| `GET /v1/podcasts/audio` | D | P8 | built | ?feed=&id=; byte ranges |
| `GET /v1/push/key` | D | P8 | built | the VAPID public key; 503 until the key is set |
| `PUT /v1/push/subscription` | D | P8 | built | this session's subscription |
| `DELETE /v1/push/subscription` | D | P8 | built |  |
| `POST /v1/push/test` | D | P8 | built | one test push to this phone, now |
| `GET /v1/push/items/:id` | D | P8 | built | a push's words, for the service worker |
| `PUT /v1/pushes/:id` | C | P8 | built | a nudge: at most 2 a day, 2 h apart, never in quiet hours |

## Verbs

| Verb | App | Class | Runs on | Queueable | Undo | Versions | Args (newest) | What it does |
|---|---|---|---|---|---|---|---|---|
| `app.open` | shell | reversible | device | no (owner tap) | none | 1 | `{ app: 'music' \| 'guitar' \| 'podcasts' \| 'astra' \| 'media' \| 'study', path: string }` | Opens an app at a place. Runs only when the owner taps a reply's action chip; the mind never opens an app by itself (BEHAVIOR.md §2.2). |
| `music.create_playlist` | music | reversible | device | yes | reported | 1 | `{ name: string, refs: array }` | Makes a playlist in the Music player from tracks (`music:<id>`), on this phone. Open it with a reply chip to `/music/#pl=<list_id>`. Its undo removes it while the owner hasn't changed it. |
| `music.delete_playlist` | music | reversible | device | no (owner tap) | none | 1 | `{ list_id: string }` | Only the undo of music.create_playlist: removes a playlist the Thunderhead made, while the owner hasn't changed it (else `owner_edited`). Deleting the owner's own playlists is ask-first and no verb. |
| `shell.appearance` | shell | reversible | device | yes | reported | 1 | `{ mode: 'auto' \| 'day' \| 'night' }` | Sets the phone's appearance (auto, day or night). The phone reports the previous mode as the undo. |

## Surface kinds

| Kind | Slots | Versions | Payload (newest) | What it is |
|---|---|---|---|---|
| `line` | home `^line\.[1-4]$` | 1 | `{ text: string, lang?: string }` | A home line under the voice line (HOME.md §2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line. |

## Change kinds

`message` · `thread` · `ledger` · `proposal` · `verb` · `surface` · `notice` · `fact` · `day_note` · `open_thread` · `setting` · `mind_status` · `error` · `work`

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
| `laws_unpinned` | This session's laws file is missing or is not the version the owner approved, so it may not write rules. |
| `device_only` | Only the owner can do this, from the Memory page. |
| `duplicate_id` | A fact with this id already exists. |
| `superseded` | This fact was already replaced; work on its newest version. |
| `proposal_required` | This change needs the owner first (decision cards arrive in P4). |
| `never_stored` | Keys, tokens, passwords and card or bank numbers are never stored (MEMORY.md §13). |
| `session_required` | Memory writes need a mind session that claimed its briefing and has not ended. |

## Night shift

The steps in order (`POST /v1/mind/night`, `th night`). The run: target 30 min, hard stop 45 (Sunday 60). A step of a phase not built yet, and the Sunday step on another night, is skipped on the way.

| Step | Name | Budget (min) | Phase | Cursor | Runs again without harm because |
|---|---|---|---|---|---|
| 1 | read the day | 1 | P3 | no | reads only |
| 2 | day note and thread titles | 5 | P3 | no | the same note again keeps version 1; titles are set, not added |
| 3 | loose ends | 3 | P3 | no | a loose end is put by its id; closing a closed one is a no-op |
| 4 | facts | 6 | P3 | yes | each part is one batch with its own id (`th facts --night --part <k>`); sent again, it is already applied |
| 5 | health and agreed fixes | 8 | P3 | no | reads, then one branch per agreed loose end |
| 6 | indexing (Study’s books) | 10 | P7 | no | a book is claimed by one run at a time and goes on from its cursor; a page is put by its number |
| 7 | arrange tomorrow | 4 | P3 | no | surfaces are put by app and slot |
| 8 | built overnight | 1 | P4 | no | items are put by id |
| 9 | weekly evals (the injection suite) (Sunday) | 15 | P4 | no | each fixture runs on a fresh sandbox; th eval end records one run |
| 10 | session note and done | 2 | P3 | no | the run is marked done once |

## Proposals

Decision cards (`PUT /v1/proposals/:id`, `th propose`). A card: question ≤ 80, why ≤ 140, if ignored ≤ 140, two options ≤ 20 each; at most 3 raised by agents wait at once; each expires after 7 days; "Not yet" brings it back the next morning at most 3 times; the canonical spec ≤ 8192 bytes. Only the owner decides: a tap on a device, or their own words recorded by mind:chat (`by_message`).

| Class | Ask first | Card label |
|---|---|---|
| `delete` | yes | Can't be undone |
| `money` | yes | Costs money |
| `access` | yes | Changes access |
| `reach_people` | yes | Reaches someone else |
| `memory_big` | no | Changes what I remember |

| Op | Classes | Raised by | Runs in | Acts on | Args | What approving does |
|---|---|---|---|---|---|---|
| `memory.forget` | delete | C | core | `fact:<id>` | `{ id: string }` | Forget a fact and every version of it for good (the owner's hard delete, MEMORY.md §3). |
| `agents.revoke` | access | C N R | auth | `agent:<agent_id>` | `{ agent_id: string }` | Revoke one agent key; it stops working within 60 s (SECURITY.md §14.2). |
| `repo.change` | access | C | core | `repo:<base>` | `{ paths: array, base: string }` | Let a mind session change these protected paths on a branch from this commit; the pre-tool hook checks the approval with th approved before an edit or a push. Decided by a tap on a signed-in device only. |
| `laws.pin` | access | worker | core | `laws:<sha256>` | `{ sha256: string, previous: string \| null }` | Pin mind/CONSTITUTION.md at this SHA-256; any other version is then reported in every briefing and its rule writes are refused (the constitution pin). Decided by a tap on a signed-in device only. |
| `board.allow` | reach_people | C worker | core | `board:<kind>` | `{ kind: 'board.edition' }` | Let Muse read the owner's Board brief (the topics, depth and length the owner chose, nothing else) to write the daily Board, until the owner withdraws it (MUSE.md §6, the standing approval). |

## Reader kinds

What the reader subagent (`.claude/agents/reader.md`) answers with, checked by `th read --check <kind>`: at most 1 sentence quoted, no query or fragment in a source or link, a note exactly when instructions were seen, at most 10 fetches.

| Kind | Fields | What it holds |
|---|---|---|
| `page` | `{ kind: 'page', source: string, title: string \| null, summary: string, points: array, quote: string \| null, links: array, instructions_seen: boolean, instructions_note: string \| null }` | One page, file or document: what it says, in the reader’s own words. |
| `answer` | `{ kind: 'answer', question: string, answer: string, odds: number, sources: array, quote: string \| null, instructions_seen: boolean, instructions_note: string \| null }` | The question the task asked, answered from the material only, with odds. |
| `list` | `{ kind: 'list', items: array, instructions_seen: boolean, instructions_note: string \| null }` | Items found (search results, a setlist, a table), each with a short note and its source. |
| `unreadable` | `{ kind: 'unreadable', source: string, why: string }` | The source could not be read (blocked, empty, not text, too large). |

## Watchdogs

Each 15-minute tick runs every built watchdog; a trip writes one ledger note and, for one that wakes, wakes `mind-reflex` (at most 4 in any 24 hours); `th reflex` prints what to do (OPERATIONS.md §8.2).

| Watchdog | Trips when | Severity | Guards | Wakes reflex | Phase | Built |
|---|---|---|---|---|---|---|
| `errors.spike` | ≥ 20 new server errors in 60 min, or ≥ 5 of one fingerprint in 15 min | S3 | API: ≤ 10 server errors a day | yes | P4 | built |
| `client.errors` | ≥ 50 client error reports in 60 min | S3 | Phone: no repeated client errors | yes | P4 | built |
| `roll.stuck` | the open day began more than 30 hours ago (the day roll never ran) | S2 | Chat: every day rolls after its quiet hour | yes | P4 | built |
| `night.late` | no day note for the night's day by 09:00 local (the night shift is connected) | S3 | Night shift: done by 09:00 local on ≥ 6 nights of 7 | yes | P4 | built |
| `jobs.stuck` | a job running for more than 2 hours, or one tried 5 times | S3 | Jobs: every job finishes or fails within its runs | yes | P4 | built |
| `db.size` | the Core object holds more than 700 MB | S3 | Budgets: storage stays inside the Free plan | yes | P4 | built |
| `quota.rows_written` | the account's rows written today ≥ 70,000 | S3 | Budgets: no Free-plan quota above 70% before 18:00 UTC | yes | P4 | waits for a stored per-day meter (DATA.md §3): today the counts live in each isolate only |
| `quota.rows_read` | rows read today ≥ 3,500,000 | S3 | Budgets: no Free-plan quota above 70% before 18:00 UTC | yes | P4 | waits for a stored per-day meter (DATA.md §3) |
| `quota.do_calls` | object calls today ≥ 70,000 | S3 | Budgets: no Free-plan quota above 70% before 18:00 UTC | yes | P4 | waits for a stored per-day meter (DATA.md §3) |
| `backup.stale` | the newest complete backup is more than 8 days old (once one exists) | S3 | Backups: newest complete backup < 8 days old | yes | P4 | built |
| `drill.failed` | the last restore drill failed | S3 | Backups: the monthly drill passes | yes | P4 | built |
| `drill.overdue` | no restore drill for 35 days since the first complete backup | S3 | Backups: the monthly drill passes | yes | P4 | built |
| `muse.silent` | no Muse API call in 26 hours | S4 | Muse checks in daily (MUSE.md §9) | no | P4 | built |
| `events.export.late` | day D not archived by D+1 09:00 | S3 | Senses: each day archived by the next morning | yes | P5 | built |

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
| `session_required` | 403 | Memory writes need a mind session that claimed its briefing and has not ended. |
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
| `not_configured` | 503 | This needs a binding that is not set up yet. |

## Phrase lint

"great question" · "amazing work" · "you're a natural" · "don't break your streak" · "i deeply apologize" · "i'm so sorry" · "i have successfully" · "keep pushing forward" · "as an ai language model" · "i will now run" · "using the bash tool"
