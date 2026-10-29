# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P2 · The daily conversation**: built and live 2026-10-29 (`43003e1`). Home is the Thunderhead chat; messages are stored, searchable and synced live, the day rolls by itself, and the mind's `th` CLI and hooks are ready. Until the owner's SETUP.md K connects the `mind-chat` routine, messages are saved and wait ("Saved. I'll answer once I'm connected."). P1 (Worker, sign-in, measurements X1/X3/X4) and P1b (the five ported apps) are done; My Media waits on the `DRIVE_CONFIG_JSON` secret.

## Next three tasks

1. Owner: SETUP.md K, then the first chat. Then P2's "done when": three days of chat, a day rolled with no lost message, warm and cold reply times over 10+ wakes. Home follow-up: the 40-turn window and the collapse of long older replies (HOME.md §4.1, §4.3).
2. **P3 · Import + memory v1**, in progress on branch `p3-memory`, built and tested, not deployed: stage A, the memory backend (facts with provenance rules, supersede, forget, decay; day notes; open threads; facts and day notes in search; the profile and the briefing's memory sections), with two independent reviews' fixes (A.5, A.6: claimed sessions, a taint that lasts its role's day, protective-only flags, surfaces cleared and their words scrubbed on mute or forget, never-stored values); stage B, Settings → What I remember (MEMORY.md §12), with its review fixes (B.5: a Forget survives every exit); stage C, the night shift's wiring: the steps registry, the run record (`POST /v1/mind/night`), the closed day's input (`GET /v1/mind/day/:day`), `th night`/`th day`/`th facts --night`, and the day roll firing `mind-night`, inert until SETUP.md L1 sets `ROUTINE_NIGHT_URL`/`TOKEN`. Core migrations 8–11, all expand-only, no new object class. Next: D the import (the old-Worker export to ship on the owner's yes; the import into the new Worker with the private bucket `VAULT`).
3. Overlapping (owner ruling 2026-10-29): the app data moves (P5 Music first), each in its own deploy.

## Blocked / waiting on the owner

- Nothing for P1. P1b needs the owner's yes to the old Worker's allowed-origins change (SETUP.md J).

## Last deploy

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
