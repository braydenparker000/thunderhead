# Contract appendix

<!-- Generated from shared/contract by scripts/contract.mjs; do not edit. Run `node scripts/contract.mjs`. -->

The runtime contract as data, generated from [`shared/contract`](../../shared/contract). [API.md](API.md) describes each route; this appendix lists what the code enforces. How to add to it: [EXTENDING.md](EXTENDING.md).

Who: D device · C mind:chat · N mind:night · R mind:reflex · M muse · I ci. Built phases: P1, P1b, P2, P3, P4, P5, P6, P7, P8, P9.

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
| `PUT /v1/threads/:id/title` | D | P2 | built | the owner names a thread (the mind never renames it after); empty gives naming back |
| `PUT /v1/threads/:id/off-record` | D | P2 | built | a conversation off the record: never remembered, gone 7 days after its last message |
| `DELETE /v1/threads/:id` | D | P2 | built | hidden at once; Recently deleted for 30 days, then purged |
| `POST /v1/threads/:id/restore` | D | P2 | built | back from Recently deleted |
| `GET /v1/threads/deleted` | D | P2 | built | Recently deleted, newest first |
| `PUT /v1/messages/:id` | D C N R | P2 | built | N and R: kind 'error' with thread_id 'system' only |
| `PATCH /v1/messages/:id` | C | P2 | built | own posts only |
| `PUT /v1/files/:id` | D C | P2 | built | raw bytes ≤ 25 MiB; TH-File-Name, TH-Sha256, TH-Seconds |
| `POST /v1/dictate` | D | P2 | built | a few seconds of voice (audio/*, ≤ 1 MiB) to Whisper; `?lang=en\|es` names the language, else it works it out; keeps nothing |
| `GET /v1/files/:id` | D C N | P2 | built | the bytes, private, no-store; ?meta=1 the record |
| `GET /v1/search` | D C N | P2 | built |  |
| `POST /v1/mind/typing` | D | P2 | built |  |
| `POST /v1/mind/stop` | D | P2 | built | the owner taps Stop: the work ends, not the session |
| `GET /v1/mind/wakes` | D C N R | P2 | built |  |
| `GET /v1/mind/watches` | D C N R | P9 | built | the day pulse: waiting watches, the last day's others, the wake budget |
| `GET /v1/mind/usage` | D C N R | P9 | built | the meter: wakes by cause, minutes awake, night minutes, watches (today, 7 days) |
| `POST /v1/mind/brief` | C N R | P2 | built |  |
| `POST /v1/mind/status` | C N R | P2 | built |  |
| `POST /v1/mind/notes` | C N R | P2 | built |  |
| `POST /v1/mind/taint` | C N R | P2 | built |  |
| `GET /v1/mind/pending` | C N R | P2 | built |  |
| `GET /v1/ledger` | D C N R | P2 | built |  |
| `PUT /v1/ledger/:id` | C N R | P2 | built |  |
| `POST /v1/ledger/:id/undo` | D C | P2 | built | mind:chat: its own actions only |
| `PUT /v1/verbs/:id` | C N | P2 | built | a Worker-side verb runs at once (status done); a phone verb waits for a phone, an intent for its app |
| `GET /v1/verbs/pending` | D | P2 | built | ?app=: that app's pending intents; without it, never an intent |
| `POST /v1/verbs/:id/claim` | D | P2 | built |  |
| `POST /v1/verbs/:id/result` | D | P2 | built |  |
| `POST /v1/verbs/plan` | C N | P2 | built | 2–8 verbs, one why, one undo; the strictest step decides its permit; fire_at runs it later |
| `GET /v1/verbs/scheduled` | D C N | P2 | built | what waits for its fire_at, soonest first (≤ 20) |
| `GET /v1/routines` | D C N | P2 | built | the approved routines (at most 12), on and off, each with its condition in words and its last run |
| `POST /v1/routines/:id/switch` | D C N | P2 | built | {on}: the owner switches one on or off; the mind only off (th routine cancel) |
| `DELETE /v1/routines/:id` | D | P2 | built | removes one that is off (409 while it is on) |
| `POST /v1/verbs/:id/cancel` | D C N | P2 | built | a scheduled verb or plan before it runs (its undo until then); the mind cancels its own |
| `GET /v1/surfaces` | D C N R | P2 | built |  |
| `PUT /v1/surfaces/:app/:slot` | C N | P2 | built |  |
| `DELETE /v1/surfaces/:app/:slot` | D C N | P2 | built |  |
| `POST /v1/surfaces/topics/:key/reopen` | D C | P9 | built | a resting topic open again: a tap, or the owner's own words (by_message, checked as a card's) |
| `POST /v1/surfaces/topics/:key/said` | C N | P9 | built | the mind said a topic went quiet (once: 409 already_said) |
| `POST /v1/media/sign` | D C N | P2 | built | music: refs (device only, P5), book: refs (P7); file: refs are not signable yet; 503 not_configured until the signing key is set |
| `POST /v1/mind/night` | N | P3 | built | the night run: start, step done, cursor, done |
| `PUT /v1/mind/growth/:day` | N | P7 | built | night step 13, the week's growth (growth.ts): from a claimed night session, for a closed day with a run; the Briefing's practice and study tiles from the week's counts and the plans through guitar.set_plan and study.mark_next, silent under 3 sessions; the same again writes nothing |
| `GET /v1/mind/day/:day` | N | P3 | built | a closed day's stats, messages, ledger and notes |
| `GET /v1/memory/facts` | D C N | P3 | built |  |
| `GET /v1/memory/facts/:id` | D C N | P3 | built | one fact: its earlier versions, evidence and why |
| `GET /v1/memory/profile` | D C N | P3 | built |  |
| `GET /v1/memory/day-notes` | D C N | P3 | built |  |
| `GET /v1/memory/open-threads` | D C N | P3 | built |  |
| `POST /v1/memory/ops` | D C N | P3 | built | pin, may_raise and forget: device only |
| `PUT /v1/memory/day-notes/:day` | D N | P3 | built | device: the owner's edit (written_by owner) |
| `PUT /v1/memory/day-notes/:day/voice` | N | P3 | built | the night's one line on the day (≤ 200), from a clean session |
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
| `GET /v1/evals/runs` | D C N I | P4 | built | ci: the weekly improvement check reads the numbers (P9) |
| `PUT /v1/predictions/:id` | N | P9 | built | a prediction about the open day or the next, with a fixed resolver; at most 12 a day |
| `GET /v1/predictions` | D C N | P9 | built | newest first; ?open=1 for the unresolved |
| `GET /v1/predictions/skill` | D C N | P9 | built | Brier skill per category (EVALS.md M-18) |
| `GET /v1/insight` | D C N | P9 | built | the meter: M-8, M-10, M-16, M-18 (EVALS.md §9), counts only |
| `GET /v1/insight/topics` | D C N | P9 | built | what lands: per topic, 30 days of kept, undone, ignored and unseen, the streak and when a resting one reopens |
| `GET /v1/predictions/calibration` | D C N | P9 | built | per category, the last 28 days: odds claimed against what happened (cards: against a yes) |
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
| `GET /v1/work/thread` | M D C N | P4 | built | Muse's own thread, never the owner's conversation |
| `POST /v1/work/thread/messages` | M D C N | P4 | built |  |
| `GET /v1/briefing` | D | P4 | built |  |
| `PUT /v1/briefing/report/:day` | N | P4 | built | night step 12, the night's report (night-report.ts): a claimed, live, untainted night session; the same body again answers the stored report, a new one from the same session replaces it (undo), another session's is 409 |
| `PUT /v1/briefing/place` | D | P8 | built | the weather's place, by a town's name |
| `GET /v1/briefing/calendar` | D C N | P8 | built | ?days=1–14 (7): the owner's calendar events kept from today's midnight, each link by its host only; `source: outside` marks a shared link's words |
| `GET /v1/music/catalog` | D | P5 | built | the ported player's format; ETag, 304; 409 before the import |
| `GET /v1/music/waveforms/:id` | D | P5 | built |  |
| `GET /v1/music/tracks` | C N | P5 | built | ?q=&limit=: tracks by their tags (songs rated 1 left out), for a playlist the mind makes; &untagged=1: the night's next ≤ 200 songs needing a note, `more` |
| `PUT /v1/music/notes` | C N | P5 | built | {items}: 1–200 notes checked against the vocabularies; a bad note or unknown id refuses the batch; 429 from 80% of the day's budget |
| `GET /v1/music/notes` | D C N | P5 | built | ?ids=a,b (≤ 200, each with its tags) or ?cursor=&limit=: every note, a page at a time |
| `GET /v1/music/find` | C N | P5 | built | ?moods=&occasion=&energy=&like=&limit=: songs by feeling or like one; never-play rules, songs rated 1 and early skips left out; 429 from 80% |
| `GET /v1/music/mixes` | D C N | P5 | built | the mixes music.mix_save kept, newest first, ≤ 50: id (for music.play_mix), name, tracks, recipe |
| `PUT /v1/music/history` | D | P5 | built | raw bytes ≤ 32 MiB (zip, json or csv); TH-File-Name, TH-Sha256; 200 done before, 202 queued |
| `GET /v1/music/history` | D C N | P5 | built | the imported files and the artists resolved: counts only |
| `GET /v1/music/taste/weights` | D | P5 | built | the DJ shuffle's history weights by song id, none while music.history is off |
| `GET /v1/music/taste` | C N | P5 | built | ?limit=1-50: top artists (MusicBrainz ids, canonical names) and years by plays |
| `GET /v1/music/similar/:mbid` | C N | P5 | built | ListenBrainz's similar artists, kept a week; plays and catalog songs of each |
| `GET /v1/music/mixes/:id` | D | P5 | built | one mix's songs in order, for the owner's tap on Music's "tonight" (404 not_found) |
| `PUT /v1/music/uploads/audio/:file` | public | P5 | built | signed by an upload tool key; Ogg Opus, ≤ 32 MiB |
| `PUT /v1/music/uploads/art/:file` | public | P5 | built | signed by an upload tool key; JPEG or PNG, ≤ 2 MiB |
| `POST /v1/music/uploads/:op` | public | P5 | built | signed by an upload tool key; the catalog writer's operations, export and links |
| `PUT /v1/senses/batches/:id` | D | P5 | built | a sealed batch of 1–500 events, ≤ 256 KB |
| `POST /v1/senses/query` | C N R | P5 | built | a fixed, named query; never SQL |
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
| `GET /v1/podcasts/feed` | D N | P8 | built | device ?url=: the feed, ≤ 4 MB; night ?show=: counts only |
| `GET /v1/podcasts/audio` | D | P8 | built | ?feed=&id=; byte ranges |
| `PUT /v1/podcasts/progress` | D | P8 | built | 1–100 positions; the newer updated_at wins |
| `GET /v1/podcasts/progress` | D N | P8 | built | ?since=&cursor=: what changed since, oldest first |
| `PUT /v1/podcasts/follows` | D | P8 | built | 1–100 shows followed or unfollowed; the newer wins |
| `GET /v1/podcasts/follows` | D N | P8 | built | ?since=&cursor=; night: no titles, its last check |
| `POST /v1/podcasts/follows/checked` | N | P8 | built | the shows the night read: ≤ 20, their newest episode |
| `GET /v1/push/key` | D | P8 | built | the VAPID public key; 503 until the key is set |
| `PUT /v1/push/subscription` | D | P8 | built | this session's subscription |
| `DELETE /v1/push/subscription` | D | P8 | built |  |
| `POST /v1/push/test` | D | P8 | built | one test push to this phone, now |
| `GET /v1/push/items/:id` | D | P8 | built | a push's words, for the service worker |
| `PUT /v1/pushes/:id` | C | P8 | built | a nudge: at most 2 a day, 2 h apart, never in quiet hours |
| `PUT /v1/reminders/:id` | D C | P8 | built | mind:chat: names the owner's message that asked |
| `GET /v1/reminders` | D C N | P8 | built |  |
| `DELETE /v1/reminders/:id` | D C | P8 | built | takes back one not yet delivered; the row stays |
| `POST /v1/ops/reports` | D | P8 | built | {kind, body ≤ 32 KB}; at most 6 in any 5 minutes |
| `GET /v1/ops/reports` | D C N R | P8 | built | ?kind=&since=&limit=&cursor=, newest first, ≤ 512 KB |
| `GET /v1/photos/drive` | D | P9 | built | connected or not, the folder by name, a revoked grant |
| `POST /v1/photos/drive/connect` | D | P9 | built | Google's consent address, scope drive.file, a state good for 10 minutes |
| `GET /v1/photos/drive/callback` | public | P9 | built | Google's redirect: ?code=&state=; stores the grant sealed, makes the folder, back to /photos/ |
| `DELETE /v1/photos/drive` | D | P9 | built | forgets the grant (the files stay in Drive) |
| `POST /v1/photos/upload-token` | D | P9 | built | a Drive access token for the phone’s own upload, and the folder id |
| `POST /v1/photos/from-drive` | D | P9 | built | {ids ≤ 20}: files picked in Google’s picker, registered by reference with what Drive says of each (one Drive call a file); a known one is `already` |
| `GET /v1/photos` | D | P9 | built | ?before=<day>: days newest first, 4 photos and a count each; ?day=: one day; ?filter= all\|favorites\|stars3\|stars4\|stars5\|raw\|jpeg\|edited\|unedited (a stack once, as its RAW) |
| `GET /v1/photos/looks` | D | P9 | built | every look, newest first: at most 500 |
| `PUT /v1/photos/looks` | D | P9 | built | {items ≤ 50: id, name, source mine\|xmp\|recipe\|camera, recipe ≤ 4 KB in its panels, panels, tag?, film?, credit?}: each added or replaced by id; past 500 refused |
| `PATCH /v1/photos/looks/:lid` | D | P9 | built | {name?, recipe?, panels?}: renames, or updates it from the current edit |
| `DELETE /v1/photos/looks/:lid` | D | P9 | built |  |
| `GET /v1/photos/deleted` | D | P9 | built | Recently deleted, newest first: 30 days |
| `GET /v1/photos/pending` | D | P9 | built | photos whose background upload has no Drive id yet, newest first: at most 200 |
| `PUT /v1/photos/:id` | D | P9 | built | registers an upload: Drive id (null: pending, a background upload), size, hash, camera, capture time, format |
| `GET /v1/photos/:id/around` | D | P9 | built | ?filter=: the newer and older photo beside this one in the shelf’s order, for culling |
| `GET /v1/photos/:id` | D | P9 | built | the photo and its recipe |
| `PATCH /v1/photos/:id` | D | P9 | built | {rating 0–5, favorite, flag pick\|reject\|null (a stack’s on both its photos), drive_id: a pending photo’s, checked with Drive} |
| `DELETE /v1/photos/:id` | D | P9 | built | to Recently deleted (a stack with both its photos) |
| `POST /v1/photos/:id/restore` | D | P9 | built |  |
| `PUT /v1/photos/:id/recipe` | D | P9 | built | the edit as a recipe (crs names); the same hash again writes nothing; a ledger row, undo = the recipe before |
| `POST /v1/photos/paste` | D | P9 | built | {ids ≤ 20, panels, recipe}: each photo’s recipe with those panels replaced, an automatic version of an edit it replaces; one ledger row, undo = every recipe before |
| `GET /v1/photos/:id/versions` | D | P9 | built | the versions, newest first: 20 automatic and 20 named at most |
| `POST /v1/photos/:id/versions` | D | P9 | built | {id, kind auto\|named, name?, recipe}; an automatic one equal to the newest writes nothing; the oldest automatic goes past 20 |
| `PATCH /v1/photos/:id/versions/:vid` | D | P9 | built | {name}: renames (an automatic one becomes named) |
| `DELETE /v1/photos/:id/versions/:vid` | D | P9 | built |  |
| `PUT /v1/photos/:id/info` | D | P9 | built | {info, camera?, film?}: what the file says (an allowlist, ≤ 2 KB; unknown keys dropped; never GPS) for a photo registered without it; camera and film only where it has none |
| `PUT /v1/photos/:id/preview` | D | P9 | built | the JPEG preview, ≤ 400 KB |
| `GET /v1/photos/:id/preview` | D | P9 | built | the preview bytes, private; an ETag |
| `GET /v1/workshop` | D | P9 | built | the files sent for the workshop, newest first, and how much room they take |
| `PUT /v1/workshop/:id/parts/:n` | D | P9 | built | ?bytes=<the whole file>; one piece, bytes: 8 MiB but the last; TH-File-Name, TH-Sha256 of the piece |
| `DELETE /v1/workshop/:id` | D | P9 | built | removes a file, every piece |

## Verbs

Side `worker`: run inside the commit that queues it, `done` at once, its inverse stored on the ledger row (`stored`). Side `phone`: claimed and run by a signed-in phone, which reports its inverse (`reported`); an intent waits for its app to open (`GET /v1/verbs/pending?app=`). `tell_min`: never below tell. `now only`: never scheduled or a step of a scheduled plan.

| Verb | App | Class | Permit | Side | Queueable | Undo | Versions | Args (newest) | What it does |
|---|---|---|---|---|---|---|---|---|---|
| `app.open` | shell | reversible | tiles | phone | no (owner tap or undo) | none | 1 | `{ app: 'music' \| 'guitar' \| 'podcasts' \| 'astra' \| 'media' \| 'study' \| 'photos', path: string }` | Opens an app at a place. Runs only when the owner taps a reply's action chip; the mind never opens an app by itself (BEHAVIOR.md §2.2). |
| `music.create_playlist` | music | reversible | music | phone | yes | reported | 1 | `{ name: string, refs: array }` | Makes a playlist in the Music player from tracks (`music:<id>`), on this phone. Open it with a reply chip to `/music/#pl=<list_id>`. Its undo removes it while the owner hasn't changed it. |
| `music.delete_playlist` | music | reversible | music | phone | no (owner tap or undo) | none | 1 | `{ list_id: string }` | Only the undo of music.create_playlist: removes a playlist the Thunderhead made, while the owner hasn't changed it (else `owner_edited`). Deleting the owner's own playlists is ask-first and no verb. |
| `music.queue` | music | reversible | music | phone (intent) | yes | reported | 1 | `{ refs: array, at: 'next' \| 'end' }` | Adds songs (`music:<id>`) to the player's queue, next or at the end. The play queue lives in the player, so Music applies it when it next opens (an intent); songs not in that phone's library are counted as `missing`. Its undo (`music.unqueue`) takes them back out. |
| `music.unqueue` | music | reversible | music | phone (intent) | no (owner tap or undo) | none | 1 | `{ refs: array }` | Only the undo of music.queue: takes those songs back out of the queue where they have not played yet. |
| `music.play_mix` | music | reversible | music | phone (intent) | yes | reported | 1 | `{ mix_id?: string, find?: object, refs?: array, index?: integer }` | Loads a saved mix (`mix_id`), the songs a find picks (`find`: moods, occasion, energy, like, limit, as `th music find`; songs ruled out are left out) or songs (`refs`) as the player's queue; it starts only after an owner gesture (MUSIC.md §10.3), else it waits paused. Music applies it when it next opens (an intent). Its undo restores the queue before it (its first 500 songs and the place). |
| `music.rate` | music | reversible | music | phone (intent) | yes | reported | 1 | `{ ref: string, rating: integer }` | Rates a song 1–5 in the player's library, only one the owner has not rated (else `owner_rated`): the owner's rating stays theirs. The ratings live in the player, so Music applies it when it next opens (an intent), and its own `music.rate` sense tells the Worker. Its undo (`music.unrate`) clears it while it is still the rating set. |
| `music.unrate` | music | reversible | music | phone (intent) | no (owner tap or undo) | none | 1 | `{ ref: string, rating: integer }` | Only the undo of music.rate: clears the song's rating while it is still the one set (else `owner_edited`). |
| `music.never` | music | reversible | music | worker | yes (now only) | stored | 1 | `{ ref: string, evidence: array }` | Records the owner's "never play this again" as their rule (subject `music.never`, its text naming the song by `music:<id>` only), through memory's own rules: `evidence` must be the owner's messages. Find, like and every mix leave the song out at once. Its undo closes the rule. |
| `music.mix_save` | music | reversible | music | worker | yes | stored | 1 | `{ name: string, refs: array, recipe?: string }` | Saves songs (a find's result) as a named mix in the Worker (`GET /v1/music/mixes`), for `music.play_mix {mix_id}` later; `recipe` is the one line it was found by. The mix's id is the verb's id. Its undo deletes the mix. |
| `podcasts.follow` | podcasts | reversible | podcasts | phone (intent) | yes | reported | 1 | `{ feed_url: string, title: string, author?: string, artwork?: string }` | Follows a show by its feed address in Podcasts. The follows live in the app (the Worker keeps the copy it sends), so Podcasts applies it when it next opens (an intent). Its undo unfollows it; a show already followed changes nothing and has no undo. |
| `podcasts.unfollow` | podcasts | reversible | podcasts (tell_min) | phone (intent) | yes | reported | 1 | `{ show_id: string }` | Unfollows a show by its id (16 hex digits, the night's name for it) in Podcasts, when it next opens (an intent). Never below `tell`: it takes away something the owner chose. Its undo follows it again. |
| `podcasts.queue_episode` | podcasts | reversible | podcasts | phone (intent) | yes | reported | 1 | `{ show_id: string, episode_id?: string }` | Adds an episode of a followed show (by the show's id; without `episode_id`, its newest) to the end of Podcasts' Up Next, when Podcasts next opens (an intent). Its undo takes it out again. |
| `podcasts.unqueue_episode` | podcasts | reversible | podcasts | phone (intent) | no (owner tap or undo) | none | 1 | `{ key: string }` | Only the undo of podcasts.queue_episode: takes that episode out of Up Next. |
| `podcasts.mark_played` | podcasts | reversible | podcasts | worker | yes | stored | 1 | `{ key: string }` | Marks an episode (`<feed address>#<episode id>`, as GET /v1/podcasts/progress names it) played in the Worker's positions, which every phone takes when Podcasts opens (the newer wins). Its undo puts back where it was left. |
| `reminder.move` | shell | reversible | reminders | worker | yes (now only) | stored | 1 | `{ id: string, at: integer, source_message_id?: string }` | Moves a set reminder to a new time, by the reminders' own rules: in the future, at most 400 days ahead, a time inside quiet hours rings at their end; only from the chat, from a clean session; one the owner set on the phone needs the owner's message that asked (`source_message_id`). Its undo puts back the time before, while the reminder is still set at the new one. |
| `reminder.snooze_rule` | shell | reversible | reminders | worker | yes | stored | 1 | `{ during: 'practice' \| 'study' \| 'watching' \| 'work' \| 'meals', from: string, to: string }` | A standing rule like "never during practice": a daily window (`from`–`to`, the owner's local time) named by what it is for (`practice`, `study`, `watching`, `work`, `meals`), at most 3; a rule for the same `during` replaces it. A reminder set or moved into the window rings at its end, and one already due inside it lands in the thread without a push. Its undo puts back the rules before. |
| `settings.set` | shell | reversible | settings | worker | yes | stored | 1 | `{ key: string, value: json }` | Changes one of the Worker's settings in the catalogue (MENU-AND-SETTINGS.md §6), to a value the catalogue allows. Never the standing permissions (`mind.permit.*`), the outside-sources switch (`mind.ask_outside`) or Privacy and data (`privacy.*`): those are the owner's alone. Its undo puts back the value before (or the default), while the setting still holds the new one. |
| `briefing.pin_tile` | shell | reversible | tiles | worker | yes | stored | 1 | `{ tile: 'due' \| 'holidays' \| 'practice' \| 'study' \| 'built' \| 'note.1' \| 'note.2' \| 'note.3' }` | Pins a tile the Briefing knows (`due`, `holidays`, or a night slot: `practice`, `study`, `built`, `note.1`–`note.3`) right after "Waiting on you", newest pin first, at most 3 (a fourth unpins the oldest); a pinned tile shows only when it has something to say. The owner's own arrangement on the phone still wins. Its undo puts back the pins before. |
| `briefing.unpin_tile` | shell | reversible | tiles | worker | yes | stored | 1 | `{ tile: 'due' \| 'holidays' \| 'practice' \| 'study' \| 'built' \| 'note.1' \| 'note.2' \| 'note.3' }` | Unpins a Briefing tile, which goes back to its usual place. Its undo pins it again where it was. |
| `thread.file` | shell | reversible | titles | worker | yes | stored | 1 | `{ thread_id: string, topic: string }` | Files a conversation under a topic (≤ 40 characters, plain words) that the menu shows with it; never one held off the record or deleted. Its undo puts back the topic before (or none), while it still holds this one. |
| `memory.note` | shell | reversible | none (the owner's words) | worker | yes (now only) | stored | 1 | `{ text: string, kind: 'state' \| 'goal' \| 'preference' \| 'routine' \| 'habit' \| 'fact' \| 'rule', subject?: string, evidence: array }` | Remembers a fact about the owner from their own message (source `user`), through memory's rules: every evidence ref must be the owner's own message (M3), never off the record; no card. `provenance` is the label memory gave it (MEMORY.md §6 M11): `owner`, or `outside` from a session that read outside text, which waits for the owner's keep. Its undo closes the fact (it stops being current, as a supersede closes the old version); forgetting it for good stays the owner's. |
| `astra.shortlist` | astra | reversible | watch | worker | yes | stored | 1 | `{ titles?: array, filters?: array }` | Places Astra's arrangement "three for tonight" (`astra/tonight`, kind `shortlist`): two or three titles (`astra:<type>:<id>` with its name) and up to three filters ("under two hours") for the owner to pick from; it never picks or plays. The verb's why is the arrangement's why chip. Its undo clears it, or puts back the one before. |
| `media.shortlist` | media | reversible | watch | worker | yes | stored | 1 | `{ titles?: array, filters?: array }` | As astra.shortlist, for My Media (`media/tonight`, titles `media:<drive file id>`). Its undo clears it, or puts back the one before. |
| `study.mark_next` | study | reversible | practice | worker | yes | stored | 1 | `{ book: string, left_off: string, next: string, page?: integer }` | Places Study's arrangement (`study/next`, kind `passage`): the book (`book:<id>`), where the owner left off and the next passage (each ≤ 60 characters), with the page to open; the verb's why says why that one. Only the owner's own study plan, as they set it (BEHAVIOR.md §9 rule 3); a law-8 topic is refused like every verb's. Its undo clears it, or puts back the one before. |
| `study.pace_goal` | study | reversible | practice | worker | yes (now only) | stored | 1 | `{ pages: integer, evidence: array }` | Records the owner's own pace for Study (pages a week) as their goal (subject `study.pace`), through memory's rules: `evidence` must be the owner's messages (M3). A pace already set is replaced (`previous`: its fact id). Its undo puts the previous pace back (or none). |
| `guitar.set_plan` | guitar | reversible | practice | worker | yes | stored | 1 | `{ tab: string, sections: array, label?: string }` | Places Guitar's arrangement "today's section" (`guitar/today`, kind `section`): a song (`tab:<id>`), one to four sections (`<first bar>-<last bar>`, as the ladder keys them) each at a tempo (20–300 bpm) from the ladder's last ceilings, and a short label. Coaching, not doing (law 5): the owner plays it. Its undo puts back the plan before. |
| `guitar.start_practice` | guitar | reversible | practice | phone (intent) | yes | none | 1 | `{ tab: string, section: string, bpm?: integer }` | Opens Guitar's reader at a section of a song (`tab:<id>`, `<first bar>-<last bar>` as guitar.set_plan names it), looped, at its tempo when given, the next time the owner opens Guitar (an intent): it never opens the app or plays by itself. A song this phone has never opened is `song_unknown`. Nothing to undo: the owner closes it. |
| `island.show` | shell | reversible | tiles | phone | yes | reported | 1 | `{ text: string }` | Shows one sentence (at most 80 characters, never a question, under the phrase lint) in the island's capsule while Music or Podcasts plays there; the next one replaces it, and it goes when that app leaves the island (opened full screen, or another app takes the capsule). Nothing playing in the island is `not_playing`. The phone reports `island.clear` as its undo. |
| `island.clear` | shell | reversible | tiles | phone | no (owner tap or undo) | none | 1 | `{ line: string }` | Takes away the island line that `island.show` put up, if it still stands; a later line stays (`cleared: false`). |
| `watch.set` | shell | reversible | none (the owner's words) | worker | yes | stored | 1 | `{ kind: 'at' \| 'event' \| 'change', at?: integer, type?: 'player.open' \| 'music.play' \| 'music.skip' \| 'music.finish' \| 'music.rate' \| 'podcasts.open' \| 'podcast.play' \| 'podcast.finish' \| 'podcast.skip' \| 'podcast.follow' \| 'podcast.unfollow' \| 'guitar.open' \| 'guitar.piece_opened' \| 'guitar.pass' \| 'guitar.bpm' \| 'guitar.session' \| 'study.open' \| 'study.read' \| 'study.search' \| 'study.highlight' \| 'photo.import' \| 'photo.delete' \| 'photo.edit' \| 'photo.export' \| 'photo.paste' \| 'photo.look' \| 'photo.rate' \| 'astra.open' \| 'mymedia.open' \| 'media.watch' \| 'media.finish' \| 'media.drop' \| 'app.open' \| 'app.close' \| 'ring.choice' \| 'island.tap' \| 'briefing.open' \| 'settings.change' \| 'briefing.tile' \| 'line.seen' \| 'line.dismiss' \| 'arrangement.seen' \| 'arrangement.tap' \| 'arrangement.dismiss' \| 'card.decide' \| 'reply.open_chip' \| 'reminder.fired' \| 'work' \| 'verb' \| 'proposal' \| 'prediction', ref?: string, why: string, note?: string }` | Sets a watch: `at` (a time, at most 7 days ahead), `event` (a sense type or `reminder.fired`, optionally its ref) or `change` (`work`, `verb`, `proposal` or `prediction`, met when it settles; optionally its ref). Met once, it wakes the chat with its why and note (a live session hears it in `th wait`), within the wake budget; at most 20 wait at once. From a claimed session that was handed nothing off the record. Its undo cancels it. |
| `watch.cancel` | shell | reversible | none (the owner's words) | worker | yes | stored | 1 | `{ id: string }` | Cancels a live or queued watch. Its undo sets it waiting again while its time has not passed and fewer than 20 wait. |
| `thread.title` | shell | reversible | titles | worker | yes | stored | 1 | `{ thread_id: string, title: string }` | Names a conversation (≤ 80 characters, one line), as `PATCH /v1/threads/:id` does; never one the owner named, one held off the record or deleted, or a title on law 8's topics. Its undo puts back the title before (or none), while it still holds this one. |
| `memory.outside_keep` | shell | reversible | outside | worker | yes (now only) | stored | 1 | `{ fact_id: string }` | The owner's Keep of a current `outside` fact, asked in the chat: it always waits for an approved card (no position loosens it), and then lifts the fact into an `owner` version as Keep under "Learned from outside" in Settings › Memory does. Only from a session that read no outside text. Its undo puts back the outside version, while the kept one is still current. |
| `muse.order_personal` | shell | ask_first | muse (floor: reach_people) | worker | yes (now only) | stored | 1 | `{ title: string, words: string, app?: 'music' \| 'guitar' \| 'podcasts' \| 'astra' \| 'media' \| 'study' \| 'photos' }` | A `muse.request` whose words carry the owner's data (the order is marked `personal`), placed for Muse with a 7-day deadline: always with an approved `reach_people` card, only from a session that read no outside text, never with what MEMORY.md §13 says is never stored or with words on law 8's topics. Its order id is the verb's. Its undo cancels the order while it is still open. |
| `shell.appearance` | shell | reversible | settings | phone | yes | reported | 1 | `{ mode: 'auto' \| 'day' \| 'night' }` | Sets the phone's appearance (auto, day or night). The phone reports the previous mode as the undo. |

## Standing permissions

How the mind may take each class of action, the owner's `mind.permit.<class>` setting: `ask`, `tell`, `quiet` (a card first; do it and say so; do it, the ledger only). Floors always ask, whatever the setting: `money` (money), `delete` (deleting your data), `access` (keys and access), `reach_people` (reaching another person). A refusal is `403 proposal_required` with reason `permit` and the `permit.allow` card to raise (API.md §11.11).

| Class | Setting | Label | Default | Verbs | Core actions |
|---|---|---|---|---|---|
| `music` | `mind.permit.music` | Music | quiet | `music.create_playlist`, `music.delete_playlist`, `music.queue`, `music.unqueue`, `music.play_mix`, `music.rate`, `music.unrate`, `music.never`, `music.mix_save` | — |
| `podcasts` | `mind.permit.podcasts` | Podcasts | quiet | `podcasts.follow`, `podcasts.unfollow`, `podcasts.queue_episode`, `podcasts.unqueue_episode`, `podcasts.mark_played` | — |
| `reminders` | `mind.permit.reminders` | Reminders | tell | `reminder.move`, `reminder.snooze_rule` | `reminder.set`, `reminder.cancel` |
| `settings` | `mind.permit.settings` | Settings | tell | `settings.set`, `shell.appearance` | — |
| `muse` | `mind.permit.muse` | Muse orders | ask | `muse.order_personal` (floor: reach_people) | `muse.order` |
| `watch` | `mind.permit.watch` | Watch lists | tell | `astra.shortlist`, `media.shortlist` | — |
| `practice` | `mind.permit.practice` | Practice | tell | `study.mark_next`, `study.pace_goal`, `guitar.set_plan`, `guitar.start_practice` | — |
| `tiles` | `mind.permit.tiles` | Lines and tiles | quiet | `app.open`, `briefing.pin_tile`, `briefing.unpin_tile`, `island.show`, `island.clear` | `surface.put` |
| `titles` | `mind.permit.titles` | Titles | quiet | `thread.file`, `thread.title` | — |
| `outside` | `mind.permit.outside` | Remembering from outside text | ask | `memory.outside_keep` | — |

| Core action | Class | Floor | What it is |
|---|---|---|---|
| `surface.put` | tiles | — | A line on home or a tile on the Briefing (`PUT /v1/surfaces/:app/:slot`). |
| `reminder.set` | reminders | — | A reminder the owner asked for (`PUT /v1/reminders/:id`). |
| `reminder.cancel` | reminders | — | Taking a reminder back (`DELETE /v1/reminders/:id`). |
| `muse.order` | muse | — | A work order for Muse (`PUT /v1/work/orders/:id`). |

## Scheduled actions and plans

A verb or a plan with `fire_at` (ISO, owner-local or with its offset) waits as a `scheduled` row: at most 20 at once (429 `too_many_scheduled`), at most 7 days ahead; its permit is checked when it is queued. Classes that wait out quiet hours (fired at their end, `shifted`): `music`, `podcasts`. A plan is 2–8 verbs with one why, one undo and a line of at most 80 characters, gated and carded as `plan.run` under its strictest step's position (API.md §11.11).

## Surface kinds

| Kind | Slots | Versions | Payload (newest) | What it is |
|---|---|---|---|---|
| `line` | home `^line\.[1-4]$` | 1 | `{ text: string, lang?: string }` | A home line, shown as a card in today's chat at its time; the night's lines are one Overnight card shown when quiet hours end (HOME.md §2.2): app `home`, slots `line.1`–`line.4`; `lang` for a second-language line. |
| `tile` | briefing `^(practice\|study\|built\|note\.[1-3])$` | 1 | `{ label: string, value: string, detail?: string, big?: string, wide?: boolean, app?: string, path?: string }` | A Briefing tile (BRIEFING.md §2), app `briefing`: `study` (today's reading), `practice`, `built` (what you made overnight), `note.1`–`note.3`. {label ≤24, value ≤32, detail? ≤60, big? ≤5, wide?, app?+path? (opens it)}; set --expires, else it goes after a day. |
| `mix` | music `^tonight$` | 1 | `{ mix_id: string, name: string, tracks?: integer }` | Music's "tonight" (`music/tonight`): a mix saved with music.mix_save, on the home shelf, played by the owner's tap. {mix_id, name ≤60, tracks?}. |
| `section` | guitar `^today$` | 1 | `{ tab: string, sections: array, label?: string }` | Guitar's "today's section" (`guitar/today`), placed by guitar.set_plan: {tab, sections [{key, bpm}] 1–4, label? ≤40}. |
| `episode` | podcasts `^next$` | 1 | `{ key: string, title: string, show?: string }` | Podcasts' "next up" (`podcasts/next`): one episode by its key (`<feed address>#<episode id>`), {key, title ≤80, show? ≤60}; the owner's tap plays it. |
| `passage` | study `^next$` | 1 | `{ book: string, left_off: string, next: string, page?: integer }` | Study's "where you left off, and what next" (`study/next`), placed by study.mark_next: {book, left_off ≤60, next ≤60, page?}. |
| `shortlist` | astra `^tonight$`; media `^tonight$` | 1 | `{ titles?: array, filters?: array }` | Astra's "three for tonight" (`astra/tonight`) or My Media's (`media/tonight`), placed by astra.shortlist or media.shortlist: {titles? [{ref, title ≤80}] 2–3, filters? ≤3}; the owner picks. |

## Change kinds

`message` · `thread` · `ledger` · `proposal` · `verb` · `plan` · `surface` · `notice` · `fact` · `day_note` · `open_thread` · `setting` · `mind_status` · `error` · `work` · `watch` · `prediction` · `routine` · `photo`

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
| `photos` | `/photos/` | Photos | P9 |

## Senses

Every event type the phone may send (`PUT /v1/senses/batches/:id`, API.md §11.14), its app's switch (`privacy.senses.<app>`), the ref kinds it may carry, its only data fields and their kinds, and its sensitivity (1: type and time only in every answer). Anything else is refused: `bad_type`, `bad_data`, `bad_ref`; an app switched off, `switched_off`. The `routines` query: 28 logical days, a band of 1 to 3 hours on the weekdays with events in 2+ weeks, kept at 10+ events in 3+ weeks.

| Type | App | Ref | Data | Sensitivity | When |
|---|---|---|---|---|---|
| `player.open` | music | — | — | 0 | Music's page opens. |
| `music.play` | music | `music:` | context_ref: ref, source: `list` \| `search` \| `mix` \| `dj` \| `shuffle` \| `queue` \| `verb`, offline: bool | 0 | A song starts sounding. |
| `music.skip` | music | `music:` | at_ms: ms, duration_ms: ms, by: `next` \| `previous` \| `pick` \| `notification` \| `swipe`, next_ref: ref | 0 | A song that sounded is left before its last 3 s. |
| `music.finish` | music | `music:` | listened_ms: ms | 0 | A song plays to its end. |
| `music.rate` | music | `music:` | rating: int, from: num | 0 | A rating set in Music (0–5; from: the one before). |
| `podcasts.open` | podcasts | — | — | 0 | Podcasts' page opens. |
| `podcast.play` | podcasts | `podcast:` | at_ms: ms | 0 | An episode starts sounding (at_ms: where in it). |
| `podcast.finish` | podcasts | `podcast:` | listened_ms: ms | 0 | An episode plays to its end. |
| `podcast.skip` | podcasts | `podcast:` | at_ms: ms, duration_ms: ms | 0 | Another episode starts while this one was not finished. |
| `podcast.follow` | podcasts | `podcast:` | — | 0 | A show followed. |
| `podcast.unfollow` | podcasts | `podcast:` | — | 0 | A show unfollowed. |
| `guitar.open` | guitar | `tab:` | — | 0 | Guitar's page opens. |
| `guitar.piece_opened` | guitar | `tab:` | — | 0 | A piece opens in the reader. |
| `guitar.pass` | guitar | `tab:` | bpm: int, speed_pct: num, clean: bool, by: `owner` \| `ears` | 0 | A loop pass marked Clean or Not yet. |
| `guitar.bpm` | guitar | `tab:` | bpm: int | 0 | A new best clean tempo for a section. |
| `guitar.session` | guitar | `tab:` | seconds: int, played_seconds: int, sections: ids, bpm: int | 0 | The reader closes after practice (sections: the section keys marked; bpm: the best clean tempo reached). |
| `study.open` | study | `book:` | — | 0 | Study's page opens. |
| `study.read` | study | `book:` | pages: int, ms: ms | 0 | Reading in a book, on leaving it or hiding the page. |
| `study.search` | study | — | hits: int | 0 | A search shows its results (the count only, never the words). |
| `study.highlight` | study | `book:` | — | 1 | A highlight made in a book (nothing on the phone makes one yet). |
| `photo.import` | photos | `photo:` | format: `raf` \| `dng` \| `jpeg` \| `heic` \| `other`, source: `phone` \| `drive` | 0 | A photo imported: in Drive and on the shelf, from this phone or picked in Drive. |
| `photo.delete` | photos | `photo:` | — | 0 | A photo moved to Recently deleted. |
| `photo.edit` | photos | `photo:` | panel: `light` \| `color` \| `effects` \| `detail` \| `optics` \| `crop` \| `versions` \| `looks` | 0 | A panel of the editor used on a photo (the panel only, never a value). |
| `photo.export` | photos | `photo:` | size: `full` \| `2048` \| `1080`, format: `jpeg` \| `heic`, to: `share` \| `files` \| `drive` | 0 | A photo exported: the size, format and where, never a pixel. |
| `photo.paste` | photos | — | count: int, light: bool, color: bool, effects: bool, detail: bool, optics: bool, crop: bool | 0 | A copied edit pasted onto photos: how many and which panels, never a value or an id. |
| `photo.look` | photos | — | source: `mine` \| `xmp` \| `recipe` \| `camera`, panels: int | 0 | A look applied to a photo: where the look came from and how many panels it sets, never its name or a value. |
| `photo.rate` | photos | `photo:` | rating: int, favorite: bool, flag: `pick` \| `reject` \| `none` | 0 | A photo rated, given or taken its heart, flagged or rejected. |
| `astra.open` | media | — | — | 0 | Astra's page opens. |
| `mymedia.open` | media | — | — | 0 | My Media's page opens. |
| `media.watch` | media | `astra:`, `media:` | ms: ms | 0 | Time watched of a title since the last report. |
| `media.finish` | media | `astra:`, `media:` | — | 0 | A title watched to its end. |
| `media.drop` | media | `astra:`, `media:` | at_ms: ms | 0 | A title not finished taken off Continue Watching. |
| `app.open` | shell | `app:` | — | 0 | Music or Podcasts comes to the front inside home. |
| `app.close` | shell | `app:` | ms: ms | 0 | Music or Podcasts goes back into the island (ms: how long it was in front). |
| `ring.choice` | shell | `app:` | — | 0 | An app picked on the ring. |
| `island.tap` | shell | `app:` | to: `details` \| `app` \| `control` | 0 | The island tapped: its details, its app, or a control. |
| `briefing.open` | shell | — | — | 0 | The Briefing comes into view. |
| `settings.change` | shell | `setting:` | — | 0 | A setting changed: its key only, never its value. |
| `briefing.tile` | home | `ledger:` | — | 0 | A night tile tapped (its ref: the tile's ledger row). |
| `line.seen` | home | `ledger:` | — | 0 | A home line on screen (its ref: the line's ledger row). |
| `line.dismiss` | home | `ledger:` | — | 0 | A home line dismissed (nothing on the phone sends it yet). |
| `arrangement.seen` | home | `ledger:` | — | 0 | An app's arrangement on screen. |
| `arrangement.tap` | home | `ledger:` | — | 0 | An app's arrangement taken up (played, opened, started). |
| `arrangement.dismiss` | home | `ledger:` | — | 0 | An app's arrangement dismissed. |
| `card.decide` | home | `proposal:` | class: `delete` \| `money` \| `access` \| `reach_people` \| `permit` \| `routine` \| `memory_big` | 1 | A decision card answered Yes or No (its class only). |
| `reply.open_chip` | home | `app:` | — | 0 | A reply's Open chip tapped (its ref: the app it opens). |

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
| `habit` | 28 | 10 |
| `fact` | 1825 | 30 |
| `rule` | never decays | not in the profile (briefing section 4) |

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
| `outside_rule` | This write is labelled outside: outside text never becomes or replaces a rule. |
| `outside_supersede` | This write is labelled outside: it can't replace what the owner said or did. Add it as a new fact; it waits for the owner's keep. |
| `outside_confirm` | This session read outside text, so it confirms nothing (a fact would stop fading on outside say-so). Remember it as a new fact; it waits for the owner's keep. |
| `laws_unpinned` | This session's laws file is missing or is not the version the owner approved, so it may not write rules. |
| `device_only` | Only the owner can do this, from the Memory page. |
| `duplicate_id` | A fact with this id already exists. |
| `superseded` | This fact was already replaced; work on its newest version. |
| `proposal_required` | This change needs the owner first (decision cards arrive in P4). |
| `never_stored` | Keys, tokens, passwords and card or bank numbers are never stored (MEMORY.md §13). |
| `session_required` | Memory writes need a mind session that claimed its briefing and has not ended. |
| `off_record_evidence` | That conversation is off the record: nothing from it becomes memory. |
| `deleted_evidence` | That conversation was deleted: nothing from it becomes memory. |

## Music notes

What the mind knows of each song (`PUT /v1/music/notes`, `th music note`), format version 1. A batch holds 1–200 notes and is refused whole for one bad note. Each mood and occasion carries its own confidence (0.05–1); `conf` has one for each of themes, language, era and energy that is set, none for one left empty; a song the mind doesn't know (`known: false`) keeps every confidence at or under 0.5. The listening pass scores the same moods. "Never play this again" is a rule fact under the subject `music.never` naming `music:<id>`.

| Field | At most | Words |
|---|---|---|
| moods | 5 | calm, peaceful, melancholy, sad, hopeful, joyful, romantic, nostalgic, dark, tense, energetic, triumphant, playful, dreamy, reverent, focused |
| occasions | 4 | focus, wind-down, morning, workout, drive, study, worship, party, rainy-day, sunday, sleep |
| themes | 3 | love, heartbreak, longing, faith, gratitude, family, friendship, home, loss, freedom, journey, nature, night, celebration, struggle, growing-up |
| language | 1 | ISO 639-1 (183 codes), or null |
| era | 1 | a decade from 1000 to the present one, or null |
| energy | 1 | 0 to 1, or null |

## Night shift

The steps in order (`POST /v1/mind/night`, `th night`). The run: target 30 min, hard stop 45 (Sunday 60). A step of a phase not built yet, the Sunday step on another night, and the weekly step once a night of its week did it (the night into Sunday, or the first after it that runs), are skipped on the way.

| Step | Name | Budget (min) | Phase | Cursor | Runs again without harm because |
|---|---|---|---|---|---|
| 1 | read the day | 1 | P3 | no | reads only |
| 2 | day note and thread titles | 5 | P3 | no | the same note again keeps version 1; titles are set, not added |
| 3 | loose ends | 3 | P3 | no | a loose end is put by its id; closing a closed one is a no-op |
| 4 | facts | 6 | P3 | yes | each part is one batch with its own id (`th facts --night --part <k>`); sent again, it is already applied |
| 7 | arrange tomorrow | 4 | P3 | no | surfaces are put by app and slot |
| 13 | growth (the week in Guitar and Study) (weekly) | 1 | P7 | no | tiles and plans are put by slot, and one the same as the one in place writes nothing |
| 5 | health and agreed fixes | 8 | P3 | no | reads, then one branch per agreed loose end |
| 12 | the report | 1 | P4 | no | the same report again answers the stored one; a new one from the same session replaces it |
| 6 | indexing (Study’s books) | 10 | P7 | no | a book is claimed by one run at a time and goes on from its cursor; a page is put by its number |
| 8 | built overnight | 1 | P4 | no | items are put by id |
| 9 | weekly evals (the injection suite) (Sunday) | 15 | P4 | no | each fixture runs on a fresh sandbox; th eval end records one run |
| 11 | songs (notes, mixes) | 6 | P5 | no | a note is put by its track, the same note again writes nothing, and the next page is always the next songs without one |
| 10 | session note and done | 2 | P3 | no | the run is marked done once |

## Proposals

Decision cards (`PUT /v1/proposals/:id`, `th propose`). A card: question ≤ 80, why ≤ 140, if ignored ≤ 140, two options ≤ 20 each; at most 3 raised by agents wait at once; each expires after 7 days; "Not yet" brings it back the next morning at most 3 times; the canonical spec ≤ 8192 bytes; odds, when given, 0.05–0.95, and required on a card of class `permit`, `routine` (an arrangement): the card words them as "a guess", "fairly sure", "sure" (below .4, .4 to .75, above .75). Only the owner decides: a tap on a device, or their own words recorded by mind:chat (`by_message`).

| Class | Ask first | Card label |
|---|---|---|
| `delete` | yes | Can't be undone |
| `money` | yes | Costs money |
| `access` | yes | Changes access |
| `reach_people` | yes | Reaches someone else |
| `permit` | yes | You said to ask |
| `routine` | yes | Runs on its own |
| `memory_big` | no | Changes what I remember |

| Op | Classes | Raised by | Runs in | Acts on | Args | What approving does |
|---|---|---|---|---|---|---|
| `memory.forget` | delete | C | core | `fact:<id>` | `{ id: string }` | Forget a fact and every version of it for good (the owner's hard delete, MEMORY.md §3). |
| `agents.revoke` | access | C N R | auth | `agent:<agent_id>` | `{ agent_id: string }` | Revoke one agent key; it stops working within 60 s (SECURITY.md §14.2). |
| `repo.change` | access | C | core | `repo:<base>` | `{ paths: array, base: string }` | Let a mind session change these protected paths on a branch from this commit; the pre-tool hook checks the approval with th approved before an edit or a push. Decided by a tap on a signed-in device only. |
| `laws.pin` | access | worker | core | `laws:<sha256>` | `{ sha256: string, previous: string \| null }` | Pin mind/CONSTITUTION.md at this SHA-256; any other version is then reported in every briefing and its rule writes are refused (the constitution pin). Decided by a tap on a signed-in device only. |
| `permit.allow` | permit, money, delete, access, reach_people | C N | core | `call:<call>` | `{ action: string, call: string }` | Let the mind take one action its standing permission (Ask) or a floor keeps behind a card: exactly the call its refusal named (`call`, the SHA-256 of the action and its canonical body), once, within 7 days of the yes. The refusal's details carry this spec ready to raise (API.md §11.11). |
| `routine.propose` | routine | C N | core | `routine:<id>` | `{ id: string, name: string, why: string, what: string, steps: array, condition: object \| object \| object }` | Store a routine the owner approves once (routines.ts): a plan of 1-8 verbs (one why, one line on home) and a condition, `at` HH:MM on some weekdays, `after` a sense type (at most once a day) or `fact` an observed routine fact's usual time. The card's target is the steps and the condition in words, written by the Worker; the yes stores it on, under the permit as it stands then, and it runs without a session until switched off. |

## Reader kinds

What the reader subagent (`.claude/agents/reader.md`) answers with, checked by `th read --check <kind>`: at most 1 sentence quoted, no query or fragment in a source or link, a note exactly when instructions were seen, at most 10 fetches.

| Kind | Fields | What it holds |
|---|---|---|
| `page` | `{ kind: 'page', source: string, title: string \| null, summary: string, points: array, quote: string \| null, links: array, instructions_seen: boolean, instructions_note: string \| null }` | One page, file or document: what it says, in the reader’s own words. |
| `answer` | `{ kind: 'answer', question: string, answer: string, odds: number, sources: array, quote: string \| null, instructions_seen: boolean, instructions_note: string \| null }` | The question the task asked, answered from the material only, with odds. |
| `list` | `{ kind: 'list', items: array, instructions_seen: boolean, instructions_note: string \| null }` | Items found (search results, a setlist, a table), each with a short note and its source. |
| `unreadable` | `{ kind: 'unreadable', source: string, why: string }` | The source could not be read (blocked, empty, not text, too large). |

## Skills

Role knowledge the mind reads on demand (`th skill <name>`, the briefing's section 8): one file per app and area at `mind/skills/<name>.md`, at most 2500 characters, with the headings "What it is", "What you can read", "What you can do", "What you must not do" in that order.

`music` · `podcasts` · `guitar` · `study` · `astra` · `media` · `briefing` · `calendar` · `memory` · `verbs` · `muse` · `night` · `code` · `voice`

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
| `quota.rows_written` | rows written today by the five objects and a drill's scratch copy ≥ 40,800 (60% of the 68,000 a day the Free plan leaves after the old Worker's share) | S3 | Budgets: no day's Free-plan budget above 60% | yes | P4 | built |
| `quota.rows_read` | rows read today across the five objects ≥ 2,880,000 (60% of the 4,800,000 a day the Free plan leaves after the old Worker's share) | S3 | Budgets: no day's Free-plan budget above 60% | yes | P4 | built |
| `quota.do_calls` | object calls today ≥ 60,000 (60% of the Free plan's 100,000 a day, the old Worker's share aside) | S3 | Budgets: no day's Free-plan budget above 60% | yes | P4 | waits for a count of object calls: an RPC reaches its method directly, so an object has no one place to count them |
| `backup.stale` | the newest complete backup is more than 8 days old (once one exists) | S3 | Backups: newest complete backup < 8 days old | yes | P4 | built |
| `drill.failed` | the last restore drill failed | S3 | Backups: the monthly drill passes | yes | P4 | built |
| `drill.overdue` | no restore drill for 35 days since the first complete backup | S3 | Backups: the monthly drill passes | yes | P4 | built |
| `events.export.late` | day D not archived by D+1 09:00 | S3 | Senses: each day archived by the next morning | yes | P5 | built |

## Watches

The day pulse (RUNTIME.md §3): `watch.set` stores a condition (`at`, `event`, `change`) that, met once, wakes the chat with its why and note, within the owner's wake budget (`mind.wake_budget`). At most 20 wait at once; an `at` watch is at most 7 days ahead, and an event or change watch lapses unmet after as long; a met watch that cannot wake the mind yet waits 12 hours. States: `live` · `queued` · `fired` · `over_budget` · `cancelled` · `expired`. The meter counts wakes by cause: `owner` · `watch` · `roll` · `schedule` · `watchdog`.

| Event watch (beside every sense type) | When |
|---|---|
| `reminder.fired` | A reminder rings (ref: reminder:<id>). |

| Change watch | Met when |
|---|---|
| `work` | A work order ends: done, failed, rejected, expired or cancelled (ref: work:<id>). |
| `verb` | A verb's result comes back, done or failed (ref: verb:<id>); never a watch verb's own. |
| `proposal` | A decision card is answered or lapses (ref: proposal:<id>). |
| `prediction` | A prediction resolves (ref: prediction:<id>). |

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
| `off_record` | 403 | That conversation is off the record: nothing from it is remembered or read later. |
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
| `already_said` | 409 | The mind already said this topic went quiet. |
| `setup_done` | 410 | Setup is already done. |
| `expired` | 410 | Past its time. |
| `reset_cancelled` | 410 | This reset was cancelled. |
| `reset_expired` | 410 | This reset expired. |
| `reset_used` | 410 | This reset was already used. |
| `resync_required` | 410 | Reload the full state. |
| `gone` | 410 | That conversation was deleted, or its time is up. |
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
| `topic_quiet` | 422 | This topic rests: the owner passed it over three times in a row. |
| `speech_budget` | 422 | The owner's speech setting holds this back today. |
| `reset_not_ready` | 425 | The reset ticket is not usable yet. |
| `client_outdated` | 426 | A newer client is required for writes. |
| `rate_limited` | 429 | Too many attempts. Try again soon. |
| `too_many_scheduled` | 429 | Twenty scheduled actions already wait; cancel one or let one run first. |
| `internal` | 500 | Something went wrong on our side. |
| `upstream` | 502 | An upstream service failed. |
| `budget_exhausted` | 503 | Today's free-plan budget is used up. |
| `auth_unavailable` | 503 | Sign-in is unavailable. |
| `unavailable` | 503 | Temporarily unavailable. |
| `not_configured` | 503 | This needs a binding that is not set up yet. |

## Phrase lint

"great question" · "amazing work" · "you're a natural" · "don't break your streak" · "i have successfully" · "keep pushing forward" · "as an ai language model" · "i will now run" · "using the bash tool"
