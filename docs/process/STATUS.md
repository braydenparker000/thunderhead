# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P4 · Safety, ops, switch-over**, being built on branch `p4-safety` in batches (A+B, C, D, E+F, G+H with I), each reviewed, then deployed.
- Batch A+B with its review fixes (A.5, B.5; branch `p4-ab`, `d08cbdc`, Core v14–v15), being deployed: owner-approved proposals (one registry, a tap or the owner's own words checked by the Worker) and the decision card on home with the gold edge; the constitution pin (the first pin is the owner's tap); quiet hours as settings.
- Batch C on `p4-safety`, ready for review (not live): session taint (the PostToolUse hook, SETUP.md M1), approved changes to protected paths (`repo.change`, `th approved`), the role matrix, the 25 injection fixtures with their gate twins, the eval sandbox and record (Core v16, `th eval`, night step 9 on Sundays), the reader subagent (`.claude/agents/reader.md`, `th read`), and the A.5 follow-ups from the re-check.
- C.5, the C review's fixes, on `p4-c` (`5c93b72`, in re-check): `repo.change` by a tap only, the push check (each refspec source, renames, the remote's real main, fail closed), taint as an allowlist marked before each call, the sandbox kept from Auth, the reader held to the drop folder. SETUP.md M1's paste text changed with it.
- Batch D on `p4-safety`, ready for its focused review (not live): the watchdogs (six built of fourteen, Core v17, `GET /v1/ops/watchdogs`, a briefing line), `mind-reflex` woken by a trip (one open wake, 4 a day, `th reflex`, `th handled`, the Stop hook), and the drill (`th drill`) that checks it end to end on the live Worker. Owner step: SETUP.md M2.

**P3 · Import + memory v1**, still counting its "done when".
- Live since 2026-10-29 13:26 UTC (`c4bc51e`): memory (facts with provenance, supersede, forget and decay; day notes; loose ends; the profile and the briefing's memory sections) and Settings → What I remember.
- Live since 2026-10-29 14:52 UTC (`e61fd66`), inert until the owner's SETUP.md L1: the night shift's wiring (stages C–C.6, Core v11).
- Live with this deploy: the import (stages D and D.5, Core v12–v13, the VAULT binding to `thunderhead-private`). Only the `import-once` key writes it, and it waits for the old-Worker export and SETUP.md L2.
- P2 is live and connected: SETUP.md K done 2026-10-29, first reply received. Its "done when" (three days of chat, a day rolled with no lost message, reply times over 10+ wakes) is counting from 2026-10-29.

## Next three tasks

1. P4 batch A+B is going live: the first mind claim after it raises the card "Pin the laws as they are now?"; the owner taps **Pin them** (held until 06:30 if it comes in quiet hours). Batch C (with C.5): re-check, deploy, SETUP.md M1. Batch D: focused review, deploy, SETUP.md M2 with its drill. Then E+F (backups, the restore drill, download everything).
2. Owner: SETUP.md L1 (the night shift), then P3's "three clean night shifts".
3. Owner: the "Merge and deploy" tap on the old-Worker export (Missionarytube- PR #370). Then SETUP.md L2–L3: the import run with the `import-once` key, checked by matching counts and 20 spot checks. P3's other "done when" (a fact stated on day N in day N+1's briefing, with evidence; forgetting it removes it). Home's 40-turn window and the collapse of long older replies (HOME.md §4.1, §4.3) are still to do. The owner kept the chat-built playlist with P5.

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
