# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P7 · Study**, step 1 (STUDY.md §11). The `Library` object is live alone since 00:31 UTC (`75aa1da`, run #46, migration tag `v4`). Going live with this push: its routes (API.md §11.21: books uploaded in 50 MiB parts straight into the private bucket, reading places, highlights, search, the mind's claimed reading runs with pages under the bulk lane), `book:` signing, the Library's daily pass, and the Library and the senses' rollups in the weekly backup and the export. Owner step: SETUP.md O1 (the private bucket's CORS rule for the reader, ask-first), needed once the reader ships.

**P6 · Evolve Guitar**, data move, live since 00:19 UTC (`ce29c20`, run #45): `/v1/guitar/*` (Songsterr, GProTab, samples, the old routes ported), and the ported app's sources module asks the new Worker with the owner's session when signed in on this site (else the old Worker). No owner step: it switches as soon as the page loads signed in. Checked in Chromium both ways, and live: the page's CSP carries the API host, the routes answer 401 without a key, the live files match the commit, and signed out the live page searches through the old Worker with no errors. The improvements (practice senses, tempo ladder, tips, calibration, ears) wait for the owner's yes.

**P5 · Evolve Music**, data move first (ROADMAP P5; owner steps in SETUP.md N).
- Step 1, live since 22:32 UTC (`c369d05`, run #38): the `Music` object alone (migration tag `v2`; a class change can't be rolled back).
- Step 2, going live with this push: the music catalog import (I7: datasets `music` then `music_log`, run by the owner as SETUP.md N3), `GET /v1/music/catalog` (the ported player's own format, ETag and 304), `GET /v1/music/waveforms/:id`, and `POST /v1/media/sign` for `music:` refs (signed links straight from `jarvis-music`, 503 until SETUP.md N1). Music is in deep health and the meter.
- Step 2 is live since 22:59 UTC (`02f2004`, run #39); checked live: the new routes answer 401 without a key, the preflight allows `If-None-Match` and exposes `ETag`.
- Step 3, going live with this push: the upload tools' routes (`/v1/music/uploads/*`, Ed25519-signed, the catalog's single writer now in `Music`; audio and art stored once, verified, in `jarvis-music` through the new `MEDIA` binding; nothing ever deleted from that bucket), and Music in the weekly backup and in "download everything". Owner step: SETUP.md N4 on the switch day.
- Step 3 is live since 23:20 UTC (`5389195`, run #40); checked live: uploads answer 503 until the tools' key is set, and 403 to any browser origin.
- Step 4, going live with this push: the player's switch, through its own service worker (`music/sw.js` loads `th/music/bridge.js`): the player's library requests, still addressed to the old Worker's URLs, are answered from the new Worker (the catalog with its ETag, audio and art by signed links, waveforms), with the owner's session and only for a top-level page; until the new Worker can answer, the old one does, so it switches by itself once SETUP.md N1–N4 are done. Checked in Chromium: the tone plays through range requests the worker answers, Web Audio hears it, the old Worker is never reached, the bucket never sees the session.
- Step 4 is live since 23:34 UTC (`39baf5c`, run #41); checked live: the files match, and the player's new worker installs and controls the page with no errors (signed out, it passes the library request to the old Worker). Step 4b (`63a9989`): the upload tool in this repository (`scripts/music/upload.py`, tested end to end against the real Worker), and new uploads keep the import's places free.
- The `Senses` object: the class alone (`5b14d09`, run #43, migration tag `v3`), then, going live with this push, its sealed batches, the agents' fixed queries, the rollups, the daily archive and the pruning, and `th day`'s `events_summary`. Nothing on the phone sends events yet: the player's senses (MUSIC.md §10.1) are an evolution that waits for the owner's yes.
- Then, after 3 days of zero old-Worker music calls: N5 (music private, ask-first) and the hourly Drive workflow off (ask-first).

**P4 · Safety, ops, switch-over**, built in batches (A+B, C, D, E+F, G+H with I), each reviewed, then deployed.
- Live: A+B (owner-approved proposals, the decision card, the constitution pin, pinned by the owner; quiet hours) and C with C.5 (session taint, protected paths, the role matrix, the injection fixtures, the eval sandbox, the reader). SETUP.md M1 done.
- Batch D, live since 21:12 UTC (`a02b5f7`): the watchdogs (six built of fourteen, Core v17, `GET /v1/ops/watchdogs`, a briefing line), `mind-reflex` woken by a trip (one open wake, 4 a day, `th reflex`, `th handled`, the Stop hook), and the drill (`th drill`). Inert until SETUP.md M2. The Agents page now says where a mind key goes (a network secret, `Bearer ` and the key).
- Batch E+F, live since 21:45 UTC (`e0afe43`, Core v18): the weekly backup (Sundays 02:30 local), the monthly restore drill (first Sunday, after the backup), the backup watchdogs, and Settings → Export ("download everything"). The first backup and drill run on their own this Sunday; that drill is P4's "a restore drill passed".
- Batch G+H, live since 22:26 UTC (`f82d706`, run #37; Core v19): work orders for Muse (`/v1/work/*`, the validator, leases, deadlines, Muse's thread), the Board brief with its standing approval card, the daily Board order, `muse.silent`, and the Briefing page with the Board reader. Owner step: SETUP.md M3 (the brief, the approval, Muse's key, the message to Muse).
- Stage I (the switch-over docs) is written: MIGRATION.md §7 has P4's switch-over checklist; SETUP.md M4 retires `jc` from 2026-11-05.
- P4's "done when": injection fixtures create nothing (built, C); one real watchdog handled end to end (SETUP.md M2's drill); a restore drill passed (the first runs on its own on Sunday 2026-11-01); the chat CLI and Muse use only the new Worker (`th` since 2026-10-29; Muse after SETUP.md M3, then 7 days of editions).

**P3 · Import + memory v1**, live: memory, the night shift (SETUP.md L1 done; the first night ran clean) and the import (`old-5`: 5 of 5 threads, 425 of 425 messages). It still counts its "done when" (three clean night shifts; a fact stated on day N in day N+1's briefing).

**P2** is live and connected (SETUP.md K), counting its "done when" from 2026-10-29.

## Next three tasks

1. P7 step 1b: the Library routes, book uploads, `book:` signing, Library in the backup and the export.
2. P7 steps 2–6: the Study app (library, reader, search, parser, verse page, highlights, offline copies, cited answers).
3. Owner: SETUP.md N1–N4 (music), M2 (the reflex routine and its drill), M3 (Muse moves over), M4 from 2026-11-05. Sunday's first backup and drill are P4's "a restore drill passed"; the Music object's first backup runs with it.

## Blocked / waiting on the owner

- SETUP.md M2 (batch D is live) and M3 (G+H is live).
- SETUP.md N1 (the signing token) and N2 (`jarvis-music` CORS, ask-first) any time; N4 (the tools' key) then N3 (the catalog import) on one day: the player switches by itself after them.
- The decision card's place at the top of home: the owner wants to talk about its design first; unchanged until then.

## Last deploy

- 2026-10-30: this push, P7 step 1b (the Library's routes, `book:` signing, its daily pass; the Library and the senses' rollups in the backup and the export; no schema change).
- 2026-10-30 00:31 UTC: `75aa1da` (run #46), the `Library` object alone (migration tag `v4`). The deploy's smoke check passed.
- 2026-10-30 00:19 UTC: `ce29c20` (run #45), P6 Guitar's data move. Checked live.
- 2026-10-30 00:08 UTC: `4262780` (run #44), the senses' routes, rollups, archive and pruning. Checked live: the routes answer 401 without a key.
- 2026-10-29 23:55 UTC: `5b14d09` (run #43), the `Senses` object alone (migration tag `v3`).
- 2026-10-29 23:4x UTC: `63a9989` (run #42), P5 step 4b (the upload tool; new uploads' places).
- 2026-10-29 23:34 UTC: `39baf5c` (run #41), P5 step 4 (the player's switch through its own worker; site only). Checked live.
- 2026-10-29 23:20 UTC: `5389195` (run #40), P5 step 3 (the upload tools' routes, the `MEDIA` binding to `jarvis-music`, Music in the backup and the export; no schema change). Checked live.
- 2026-10-29 22:59 UTC: `02f2004` (run #39), P5 step 2 (the music catalog import, catalog and waveform routes, media signing; no schema change). Checked live.
- 2026-10-29 22:32 UTC: `c369d05` (run #38), P5 step 1, the `Music` object alone (migration tag `v2`). The deploy's smoke check passed.
- 2026-10-29 22:26 UTC: `f82d706` (run #37), P4 batch G+H with its review fixes (Muse on work orders, the Board, the Briefing page; Core v19, expand-only). The live Briefing page drew its tiles and the Board reader with no errors.
- 2026-10-29 21:45 UTC: `e0afe43` (run #36), P4 batch E+F (backups, the drill, download everything; Core v18, expand-only). Live files checked against the commit.
- 2026-10-29 21:12 UTC: `a02b5f7` (run #35), P4 batch D (the watchdogs and `mind-reflex`, Core v17, expand-only; inert until SETUP.md M2).
- 2026-10-29 21:01 UTC: `ba01f3d` (run #34), the Conversations list rebuilt by the calendar (Yesterday, Earlier this week, Last week, then by month), with folding groups, richer rows, Now as a card, and long or imported replies read as text. Live files checked against the commit.
- 2026-10-29 20:31 UTC: `816a256`, the menu's Conversations list, the read-only past view, and Search. The old chats are visible.
- 2026-10-29 20:3x UTC: `ef10c21`, P4 batch C (taint, protected paths, injection fixtures, the eval sandbox, the reader; Core v16), after a deep review whose 3 blockers are fixed (C.5). Owner step: SETUP.md M1, the new `.claude/settings.json`.
- 2026-10-29: import run `old-5` done. 5 of 5 threads, 425 of 425 messages, the notebook (1 of 6 cc_state rows; the rest are bookkeeping), 20 of 20 and 5 of 5 spot checks. 70 tables, 39,549 rows and 55 parts are archived in `thunderhead-private`, with nothing deferred. SETUP.md L1 done: the first night ran clean at 19:46 UTC.
- 2026-10-29: this push, P3 import stages D and D.5 (Core v12–v13, expand-only; the VAULT binding), after a focused review. Its blocker was fixed: any chat key could write "old chats" that memory takes as the owner's words, and now only the `import-once` key can.
- 2026-10-29 14:52 UTC: `e61fd66` (run #28): P3 night shift stages C, C.5 and C.6 (Core v11, expand-only; inert until SETUP.md L1), after a focused security review. All of its findings are fixed.
- 2026-10-29 13:26 UTC: `c4bc51e` (run #27, site + Worker): P3 memory stages A–A.7, B, B.5 and B.6 (Core v8–v10), after reviews of the backend and the Memory page. B.6 fixed a never-stored gap and a lost Forget on sign-out.
- 2026-10-29 12:53 UTC: `7970c01` (run #25): the automatic rollback undoes only the run's own Worker deployment (`scripts/rollback-guard.mjs`). Run #26 (`0a1b05f`, the owner's hooks file) was red on an outdated test and deployed nothing; fixed in `c4bc51e`.
- 2026-10-29 07:54 UTC: `43003e1` (run #22, site + Worker): P2 stages 3, 3.5 and 4, the home chat and waking via `mind-chat`, after an independent review (no blockers; its eight should-fix items fixed and re-probed).
- 2026-10-29 06:43 UTC: `247e379` (run #21): stage 2.5 review fixes, deploy-transition fixes, a tag check that needs three matching answers. Run #20 saw one server still on the old version and rolled back automatically, as designed.
- 2026-10-29 05:58 UTC: `1725976` (run #19): P2 stages 1–2, the conversation backend (Core migrations v2–v7, expand-only) and the `th` CLI.

- 2026-10-29 04:15 UTC: site `22236b7` (run #17): the five ported apps live (P1b), service worker, icons, changed-files-only upload. Run #16 hit the job limit mid-upload (fixed: step limits keep the rollback runnable).
- 2026-10-29 04:21–04:36 UTC: production measurements X3, X4, X1 all PASS (decisions.md).

- 2026-10-29 01:53 UTC: Worker `5c0f33e53fb7` (Deploy run #14, target api): settings check, tests, deploy, smoke check with `TH_CI_TOKEN` (deep health ok) and the 4 live API tests.
- 2026-10-28 15:12 UTC: site `5c0f33e` with sign-in on (run #13, target site; `config.js` carries the API address).
- 2026-10-28 14:57 UTC: first Worker deploy (run #11, bootstrap; `WORKER_BOOTSTRAP` deleted afterwards). Runs #6–#10 stopped before deploying: settings typed with placeholders or in the wrong place; #9 was held by GitHub because the check read `toJSON(secrets)`.
- 2026-10-28 14:00 UTC: first site deploy `7ca3c35` (run #3); rollback drill (run #4) rolled back automatically.
- 2026-10-29: the mind key (`mind-chat`, role Mind · chat) reaches `/v1/ops/health/deep` from a `th-chat` session (HTTP 200).

## Notes for the next session

- Setup instructions for the owner: ready-to-paste values only, one exact place per step (page, tab, secret or variable, repository or environment), a screenshot first for screens the agent cannot see, and verify each step before the next.

- Hosting is the Azure Storage static website (owner ruling); Static Web Apps is ruled out.
- Existing apps are ported as they are (owner ruling); any change to them later is an evolution the owner agrees to first. Songsterr and libmedia stay (owner rulings).
- Read [decisions.md](decisions.md) before changing anything structural.
- The eight spec gaps from `mind-spike` (2251bf7) are applied in P2 stage 2 (docs and code); `mind/README.md` → "The spike's findings, and where they went" maps each one.
