# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P3 · Import + memory v1**, in progress.
- Live since 2026-10-29 13:26 UTC (`c4bc51e`): memory (facts with provenance, supersede, forget and decay; day notes; loose ends; the profile and the briefing's memory sections) and Settings → What I remember.
- Live since 2026-10-29 14:52 UTC (`e61fd66`), inert until the owner's SETUP.md L1: the night shift's wiring (stages C–C.6, Core v11).
- Live with this deploy: the import (stages D and D.5, Core v12–v13, the VAULT binding to `thunderhead-private`). Only the `import-once` key writes it, and it waits for the old-Worker export and SETUP.md L2.
- P2 is live and connected: SETUP.md K done 2026-10-29, first reply received. Its "done when" (three days of chat, a day rolled with no lost message, reply times over 10+ wakes) is counting from 2026-10-29.

## Next three tasks

1. Owner: SETUP.md L1 (the night shift), then P3's "three clean night shifts".
2. Owner: the "Merge and deploy" tap on the old-Worker export (Missionarytube- PR #370). Then SETUP.md L2–L3: the import run with the `import-once` key, checked by matching counts and 20 spot checks.
3. P3's other "done when" (a fact stated on day N in day N+1's briefing, with evidence; forgetting it removes it). Then home's 40-turn window and the collapse of long older replies (HOME.md §4.1, §4.3), then P4. The owner kept the chat-built playlist with P5.

## Blocked / waiting on the owner

- The old-Worker export deploy: the "Merge and deploy" tap on PR #370's card.
- SETUP.md L1 (the night shift), sent ready to paste.

## Last deploy

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
