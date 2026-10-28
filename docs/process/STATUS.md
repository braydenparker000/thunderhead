# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P0 · Site live** — done 2026-10-28. Next: P1.

## Next three tasks

1. Push `p1-spike` (one clean commit) and start P1 from the `p1-spike` branch (Worker with `Core` + `Auth`, sign-in, `deploy-worker.yml`, `backend/MEASUREMENTS.md`; X5 already measured): first bring it in line with API.md §11.1–11.4 and §13, SIGN-IN.md §4 and §6.1, SECURITY.md §5.1 and OPERATIONS.md §5.1 (route names, error codes, fingerprint setup, token format, one deploy workflow), then run X1, X3 and X4 in production.
2. Owner: SETUP.md G–I.
3. The `mind-spike` work (`mind/`: the `th` CLI and hooks) is P2 and waits on the P2 routes.

After P1 comes **P1b · Apps ported as they are**: Music, Guitar, Podcasts, Astra and My Media copied unchanged apart from paths, route folders and the API address; they keep calling the old Worker, whose allowed-origins change is asked first.

## Blocked / waiting on the owner

- Setup steps G–I in [SETUP.md](SETUP.md). A–F done 2026-10-28.
- Owner questions: all answered 2026-10-28 (yes to all 14 recommendations; gesture navigation; permission for everything in the old repo). See decisions.md.

## Last deploy

- 2026-10-28 14:00 UTC: site `7ca3c35` live at https://thunderhead.z13.web.core.windows.net/ (Deploy run #3, green: tests, Azure sign-in, publish, live check).
- 2026-10-28 14:02 UTC: rollback drill (run #4) failed on purpose, rolled back to `7ca3c35` and confirmed it live. Runs #1–#2 skipped before `AZURE_DEPLOY_ENABLED` was set.

## Notes for the next session

- Hosting is the Azure Storage static website (owner ruling); Static Web Apps is ruled out.
- Existing apps are ported as they are (owner ruling); any change to them later is an evolution the owner agrees to first. Songsterr and libmedia stay (owner rulings).
- Read [decisions.md](decisions.md) before changing anything structural.
- Before P2: apply the eight spec gaps found while building the `th` CLI (branch `mind-spike`, commit 2251bf7, `mind/README.md` → Findings): `thread_id: 'system'` on `PUT /v1/messages/:id`; a `TH-Stop: 1` header on the 204 status reply; define the briefing section marker (`## `) in MEMORY.md §9; say that messages shown in a claimed briefing need an ack within 120 s; a PATCH for open threads; small missing routes (get one work order, `since` on errors, `ledger_id` in verb/surface replies, `th approved`); the R2 host in the environment's network list for `th file`; and note that the pre-tool hook is a soft gate (the network allowlist is the real control).
