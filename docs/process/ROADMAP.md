# Roadmap

The build order. Every phase ends **live and useful**, with a "done when" the owner can check.
The first phases hold no personal data and touch nothing in the old system.
Current position: see [STATUS.md](STATUS.md). Fixed decisions: [decisions.md](decisions.md).

## Rules at a glance

1. One phase at a time; a phase is done only when its "done when" is true on the owner's phone.
2. Old systems keep working until the new one has replaced them and the owner has used it for 7 days.
3. Each Durable Object class arrives in its own deploy (Worker rollback can't cross a class change).
4. Anything in an ask-first class inside a phase waits for the owner's tap; the rest of the phase continues.
5. Measurements named in a phase are written to [decisions.md](decisions.md) before the next phase starts.

## Phases

| Phase | Ships | Done when |
|---|---|---|
| **P0 · Site live** | New repo; Azure Storage static website; hardened deploy with auto-rollback; home page with self-hosted fonts and meta CSP; the docs suite; STATUS and decisions. | Home loads on the owner's phone from the new address. A deploy that fails its live check rolls itself back (tested once on purpose). |
| **P1 · Worker + sign-in** | `thunderhead-api` with `Core` + `Auth`; `/v1/health`; CORS for the new site; deploy with version record, smoke check and `wrangler rollback`; logs on. Setup ticket, username + password, back-off, recovery code, device list, sign-out one/all, new-device notice, Settings → Agents with the first mind token. Measurements X1 (Worker-held wait to a hibernating DO), X3 (DO CPU on Free + scrypt cost), X4 (PITR on Free), X5 (JSDoc type-check of `shared/`). | The owner signs in with password-manager autofill and sees "this device". Sign-out everywhere works. The mind token reaches `/v1/ops/health/deep`. |
| **P2 · The daily conversation** | Threads, messages, FTS search, the day roll, live WebSocket for the phone, `/v1/live/wait` for the mind; the `th` CLI; SessionStart and bounded Stop hooks; the `mind-chat` task and environment; typing pre-warm; honest "the mind isn't waking" line. | The owner chats with the mind on the new home for 3 days. A day rolled with no lost message. Warm and cold reply times measured over 10+ wakes. The old chat still works in parallel. |
| **P3 · Import + memory v1** | One-time export from the old Worker (ask first: it deploys the old Worker); chunked import with counts and spot checks; facts, day notes, open threads, session notes, ledger with undo for memory; the `mind-night` task fired by the day roll; the Memory page. | Import counts match and 20 spot checks pass. A fact stated on day N appears in day N+1's briefing with evidence; deleting it removes it. Three clean night shifts. |
| **P4 · Safety, ops, switch-over** | Device-approved proposals; role tokens enforced; session taint; reader subagent; `mind-reflex` with watchdogs and SLOs; weekly backups, a restore drill, "download everything"; Muse on work orders; `jc` retired. | Injection fixtures create nothing. One real watchdog handled end to end. A restore drill passed. The old Worker has had zero callers for 7 days and a retirement proposal waits for the owner's tap. |
| **P5 · Music** | `Senses` and `Music` classes (separate deploys); presigned audio; bucket CORS (ask first); phone-data export from the old site; the audio engine ported; a new player UI; search tiers; the app router and transitions; music private (ask first). | The owner plays music daily from the new app for 7 days; search is never worse than plain search; the old player is unused. |
| **P6 · Guitar** | Tab reader on the new shell; practice senses; tempo ladder; margin tips; calibration; "ears" on demand. | A section is taught with a measured tempo climb. |
| **P7 · Study** | `Library` class; PDF ingestion in the mind's session; reader on presigned URLs; search; reference parser; cited answers. | Asking about a verse returns an answer with page citations and opens the book at the page. |
| **P8 · Briefing data, Astra, Podcasts, My Media, reach** | Each app moved or restyled; Web Push within budget; Workers AI routing and multilingual recall once their eval sets pass; share target. | Each app live and its old page retired. Pushes stay within 2 a day and never before 06:30. |
| **P9 · The meter + self-improvement** | Predictions with fixed resolvers; skill vs base rate; kept/undone tracking; a weekly improvement PR with an eval diff. | 30+ predictions resolved in one category; two weekly PRs merged with non-negative eval diffs. |

## Explicitly later or never

See the deferred list in [decisions.md](decisions.md) and the evaluated backlog in [IDEAS.md](IDEAS.md). Open questions that gate phases are in [RESEARCH-AGENDA.md](RESEARCH-AGENDA.md).
