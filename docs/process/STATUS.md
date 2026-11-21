# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
At most 80 lines ([RUNTIME.md §14](../mind/RUNTIME.md#14-statusmd-upkeep)): older entries leave for git
history; October's and the deploy log are in [archive/STATUS-2026-10.md](../archive/STATUS-2026-10.md).

## Now (2026-11-21)

The owner enjoys the product; the agent leads, and work lands as pull requests the owner merges
(AGENTS.md). The plan is [PLAN.md](PLAN.md); fixed decisions are [decisions.md](decisions.md). Owner,
2026-11-01: "go ahead with everything", "ship everything as ready": the lead merges a pull request
once its tests and any second read pass, confirms it live, and says what changed in
`whats-new.json`. History is in [docs/archive/](../archive/README.md).

**Photos → LightCraft (owner, 2026-11-08):** step 1 the test page `/lab/lightcraft/`; step 2 export, 1:1 memory.

**Astra finished (2026-11-12 to 19; PRs #206 to #212, live):** TorBox direct play, sealed library
sync, remembered streams, the look and settings round, a feel report (`docs/product/apps/ASTRA.md`).

**The main pages' feel round (2026-11-19, PR #213, live).** Left: the ring's per-frame style work,
the re-rise on leaving an old conversation (owner's call). Music: audited read-only; its look and
behaviour change only after talking with the owner.

**Ink and Lamp (2026-11-20, PR #214 live; the default since PR #215):** the main pages' look, in Settings ›
Appearance › Look with Classic as the other choice ([INK-AND-LAMP.md](../design/INK-AND-LAMP.md);
decisions.md), all in `frontend/look/`, kept on the phone after one load; the island shows the artwork.

**The audit of 2026-11-20** (read-only, eight areas) found faults in delivery, the Worker and the docs;
one pull request fixes them (the live watch, the rollback, the test-scope rule, these documents among them).

## Current phase: what is live

- **Home:** a chat; hold for the ring of seven apps, swipe right for the Briefing, left for the menu
  and Settings, on one component set; Music and Podcasts open inside home and shrink into the island,
  one morphing capsule; a What's new card once after an update; the `/?feel` tuning panel.
- **The mind:** chat and the night shift; memory with provenance and taint; off the record and Delete
  with Recently deleted (Core step 27); the owner's music known song by song (Core 26, Music 4);
  predictions and the meter (P9); go quiet and quiet hours; Web Push within its budget; a layered
  briefing (now, the voice and the owner in its first 2,000 characters) and role knowledge on demand
  (`th skill`, 14 files in `mind/skills/`).
- **The apps on the new Worker:** Music (catalog, uploads, streaming up to 60 s ahead, never-play
  rules), Guitar (sources, tips per section, the tempo ladder), Study (books, verses, asking about
  your books), Podcasts (the data move, the night's new-episode check, Core 25); Astra and My Media
  as ported.
- **Safety and ops:** sign-in and devices; proposals and the decision card; the constitution pin;
  session taint and protected paths; the 25 injection fixtures in the eval sandbox; thirteen watchdogs (eleven built);
  the weekly backup and monthly restore drill; Export; playback reports; the rows-read guard.
- **Delivery:** every merge to `main` runs Deploy (checks in six parallel jobs: five site-and-mind
  parts and the Worker's suite; then the Worker, then the site) with automatic rollback; the live
  checks also run every 30 minutes (`live-watch.yml`). Previews (`preview.yml`) are run by hand, one
  branch at a time at one address, and wait for the owner's Cloudflare Pages token.

## Next three tasks

1. The island everywhere it helps (PLAN.md 4): Guitar's metronome and practice timer on the island,
   sideways swipes.
2. October's half-built list: per-app icons in the conversation list, upload progress after a
   reload, Download everything with file bytes, restore as proposals after a drill, speed measured on
   the A15.
3. The clocks: P8's 7-day done-when, then the old Worker's retirement proposal
   ([MIGRATION.md §8](../engineering/MIGRATION.md#8-retiring-the-old-worker)); P9's weekly improvement
   (the first was Sunday 2026-11-01); P4's first restore drill result.

## Blocked / waiting on the owner

- SETUP.md M2 (the watchdog drill; batch D is live) and M4 (retiring `jc`, from 2026-11-05). M3 is
  cut (owner, 2026-10-31: no Muse Daily Board).
- SETUP.md O2: the owner's scripture volumes added in Study, then the mind builds the table and text.
  P7's done-when also needs one real book in Study.
- Azure's error document (SETUP.md step 7): Storage account → Data management → Static website →
  Error document path: `404.html` → Save. Until then a missing page shows Azure's own page.
- Owner choices that would remove work (PLAN.md; none required): a Cloudflare token for previews,
  Workers Paid, a private repository. (The listening pass was cut on 2026-11-04, SETUP.md N6.)
- Owner picks (2026-10-30/31): nothing from the research pack is acted on until the owner says so;
  the menu's further direction and the look round's further changes wait for the owner.

## Last deploy

- 2026-11-20: the newest merge to `main` is `5fd0bd9` (PR #215, Ink and Lamp the default; before it
  #214 and #213). What is live is on `/release.json` and `/v1/health`; earlier ones in git history.
