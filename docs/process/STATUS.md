# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P1 · Worker + sign-in**: done 2026-10-29 (X1/X3/X4 pass). **P1b · Apps ported**: live 2026-10-29 (My Media waits on the `DRIVE_CONFIG_JSON` secret). **P2 · The daily conversation**: building on branch `p2-chat`. Stage 1 (the backend: conversation, search, day roll, live channel, wake loop, ledger, verbs, surfaces and the contract registries, [EXTENDING.md](../engineering/EXTENDING.md)) stage 2 (the `th` CLI and hooks in `mind/`, checked against the contract and tested against the real Worker under `wrangler dev`) stage 3 (the home chat: live socket, outbox, presence, chips, Stop, the phone's registries) and stage 4 (waking through the mind-chat trigger: the Worker fires once `ROUTINE_CHAT_URL` and `ROUTINE_CHAT_TOKEN` are set, `none` until then) are built, with stage 3.5 (the chat review fixes) on top. Next on home: the 40-turn window and the collapse of long older replies for very long days (HOME.md §4.1, §4.3). Waiting on the owner: SETUP.md K (the hooks file, the `mind-chat` routine, the two Worker secrets, one test message). Then P2's "done when": three days of chat, a day rolled with no lost message, warm and cold reply times over 10+ wakes.

## Next three tasks

1. Finish P1. Built on branch `p1-finish`: the service worker (precache per release, offline shell and sign-in pages, safe update, kill switch), the install manifest and icons, `ui/icons.svg`, the T7 live check, and the Bench workflow for X1/X3/X4. Left: run Bench `x3`, `x4`, `x1` in production and record the results in decisions.md; the owner's phone checks (TESTING.md §12.2 item 3b: T9, T11, T17, T19; sign-out everywhere; "this device"); sign-in p95 on the phone. Web Push is P8 (ROADMAP), not P1.
2. **P1b · Apps ported as they are**: Music, Guitar, Podcasts, Astra and My Media copied unchanged apart from paths, route folders and the API address; they keep calling the old Worker, whose allowed-origins change is asked first.
3. The `mind-spike` work (`mind/`: the `th` CLI and hooks) is P2 and waits on the P2 routes.

## Blocked / waiting on the owner

- Nothing for P1. P1b needs the owner's yes to the old Worker's allowed-origins change (SETUP.md J).

## Last deploy

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
