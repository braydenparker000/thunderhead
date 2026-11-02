# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
At most 80 lines ([RUNTIME.md §14](../mind/RUNTIME.md#14-statusmd-upkeep)): older entries leave for git
history. October's narrative and the whole deploy log are in
[archive/STATUS-2026-10.md](../archive/STATUS-2026-10.md).

## Now (2026-11-02)

The owner enjoys the product; the agent leads, and work lands as pull requests the owner merges
(AGENTS.md). The plan is [PLAN.md](PLAN.md); fixed decisions are [decisions.md](decisions.md). Owner,
2026-11-01: "go ahead with everything", "ship everything as ready": the lead merges a pull request
once its tests and any second read pass, confirms it live, and says what changed in
`whats-new.json`. Batch 2 went live at `594d2b7` (PRs #16 to #20, under Last deploy), and the docs
were tidied on 2026-11-02: history moved to [docs/archive/](../archive/README.md).

## Current phase: what is live

- **Home:** a chat; hold for the ring of seven apps, swipe right for the Briefing, left for the menu
  and Settings, on one component set; Music and Podcasts open inside home and shrink into the island,
  one morphing capsule; a What's new card once after an update; the `/?feel` tuning panel.
- **The mind:** chat and the night shift; memory with provenance and taint; off the record and Delete
  with Recently deleted (Core step 27); the owner's music known song by song (Core 26, Music 4);
  predictions and the meter (P9); go quiet and quiet hours; Web Push within its budget.
- **The apps on the new Worker:** Music (catalog, uploads, streaming up to 60 s ahead, never-play
  rules), Guitar (sources, tips per section, the tempo ladder), Study (books, verses, asking about
  your books), Podcasts (the data move, the night's new-episode check, Core 25); Astra and My Media
  as ported.
- **Safety and ops:** sign-in and devices; proposals and the decision card; the constitution pin;
  session taint and protected paths; the 25 injection fixtures in the eval sandbox; six watchdogs;
  the weekly backup and monthly restore drill; Export; playback reports; the rows-read guard.
- **Delivery:** every merge to `main` runs Deploy (checks in four parallel jobs, the Worker, then the
  site) with automatic rollback. Preview builds per pull request are built and wait for the owner's
  Cloudflare Pages token.

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
- Owner choices that would remove work (PLAN.md; none required): the read-only music key (then the
  listening pass, built, measures how each song sounds), a Cloudflare token for previews, Workers
  Paid, a private repository.
- Owner picks (2026-10-30/31): nothing from the research pack is acted on until the owner says so;
  the menu's further direction and the look round's further changes wait for the owner.

## Last deploy

- 2026-11-02 04:06 UTC: `594d2b7` (Deploy run #135, Worker and site), carrying PRs #17 to #20 (the
  runs for #18 and #19, #133 and #134, failed in a site test part and deployed nothing; #132 was
  cancelled):
  - #17 Menu and Settings re-skinned on one component set.
  - #18 Island v2: one morphing capsule, apps grow out of it, frames warmed and kept alive.
  - #19 What's new: the ring, the menu and Settings, the island capsule.
  - #20 Settings after Batch 2: the frosted panel behind the page, content before the slide.
- 2026-11-02 03:28 UTC: `2c0c407` (run #131), #16 Speed and the ring: flat surfaces while moving,
  springier ring, menu and Settings preloaded, a frames readout in `/?feel`.
- 2026-11-02 02:21 UTC: `6fd2e79` (run #130), #15 Feel engine: interruptible springs for the ring,
  swipes and island, and the `/?feel` tuning panel.
