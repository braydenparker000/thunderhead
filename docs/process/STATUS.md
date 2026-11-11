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

**Photos → LightCraft (owner, 2026-11-08; decisions.md):** step 1, the test page `/lab/lightcraft/`
(engine/lightcraft-web/README.md) for the owner's phone; step 2 is export and 1:1 memory (measured there).

**The 30-hour run (2026-11-10 to 11, the owner away; PRs #114 to #133, each merged when green and
confirmed live):** the new editor's quality passes; Astra's eleven more decoders and quicker seeks;
Music's queue, shuffle and restart; the night's report (two causes fixed, a third way left for the
owner in BRIEFING.md); fewer rules on the chat; apps loaded ahead from the ring; 34 new settings and
12 old ones wired; Edit opening the new editor. What is left from it is in each area's doc
(`engine/raw/STATUS.md`, `frontend/astra/README.md`, MUSIC.md §18, BRIEFING.md, PHOTOS.md §4).

## Current phase: what is live

- **Home:** a chat; hold for the ring of seven apps, swipe right for the Briefing, left for the menu
  and Settings, on one component set; Music and Podcasts open inside home and shrink into the island,
  one morphing capsule; a What's new card once after an update; the `/?feel` tuning panel.
- **The mind:** chat and the night shift; memory with provenance and taint; off the record and Delete
  with Recently deleted (Core step 27); the owner's music known song by song (Core 26, Music 4);
  predictions and the meter (P9); go quiet and quiet hours; Web Push within its budget; a layered
  briefing (now, the voice and the owner in its first 2,000 characters) and role knowledge on demand
  (`th skill`, 13 files in `mind/skills/`).
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

- 2026-11-11: the 30-hour run, PRs #114 to #133, each deployed by its own merge (Worker and site);
  the newest is on `/release.json` and `/v1/health`.
- 2026-11-02 04:06 UTC: `594d2b7` (Deploy run #135), PRs #17 to #20: Menu and Settings on one
  component set, Island v2, What's new, Settings after Batch 2. Earlier ones are in git history.
