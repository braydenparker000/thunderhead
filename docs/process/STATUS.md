# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P1 · Worker + sign-in**: live and set up 2026-10-29. The owner's setup (SETUP.md A–I) is complete; engineering leftovers below.

## Next three tasks

1. Finish P1: the service worker and precache, `ui/icons.svg`, Web Push, sign-in p95 on the phone, T7/T9/T11/T17/T19 on the real site, and X1, X3 and X4 in production. Owner checks on the phone: sign-out everywhere, the device list shows "this device".
2. **P1b · Apps ported as they are**: Music, Guitar, Podcasts, Astra and My Media copied unchanged apart from paths, route folders and the API address; they keep calling the old Worker, whose allowed-origins change is asked first.
3. The `mind-spike` work (`mind/`: the `th` CLI and hooks) is P2 and waits on the P2 routes.

## Blocked / waiting on the owner

- Nothing for P1. P1b needs the owner's yes to the old Worker's allowed-origins change (SETUP.md J).

## Last deploy

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
- Before P2: apply the eight spec gaps found while building the `th` CLI (branch `mind-spike`, commit 2251bf7, `mind/README.md` → Findings): `thread_id: 'system'` on `PUT /v1/messages/:id`; a `TH-Stop: 1` header on the 204 status reply; define the briefing section marker (`## `) in MEMORY.md §9; say that messages shown in a claimed briefing need an ack within 120 s; a PATCH for open threads; small missing routes (get one work order, `since` on errors, `ledger_id` in verb/surface replies, `th approved`); the R2 host in the environment's network list for `th file`; and note that the pre-tool hook is a soft gate (the network allowlist is the real control).
