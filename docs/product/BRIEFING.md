# The Briefing

The Briefing is the page one swipe right of home: the day at a glance, arranged by the night shift. Weather, what's waiting, practice, study, what was built overnight and new media. (The Daily Board was part of it until the owner cut it on 2026-10-31.)
This file specifies its sections, ordering, data sources, freshness, empty states, tap and long-press behaviour, and limits.
Sibling docs: [HOME](HOME.md), [GESTURES](../design/GESTURES.md), [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md), [COPY](../design/COPY.md), [mind BEHAVIOR](../mind/BEHAVIOR.md), [JOBS](../engineering/JOBS.md), [API](../engineering/API.md), [MUSIC](apps/MUSIC.md), [GUITAR](apps/GUITAR.md), [STUDY](apps/STUDY.md), [MY-MEDIA](apps/MY-MEDIA.md), [PODCASTS](apps/PODCASTS.md).

**Built in P4 stage H** (`frontend/th/briefing/`, `tests/briefing-browser.test.mjs`; the Worker side `GET /v1/briefing`): the date, the title line by the hour (and *A quiet day.* with nothing to show), "Waiting on you" (gold; a tap goes home and pulses the card), Muse's line, and the page painted from this phone first. Weather, the night shift's tiles, media and podcasts come with P8's Briefing data; until then the page says so in one quiet line instead of a placeholder tile.

**Weather built in P8** (`backend/src/areas/briefing/weather.ts`, `frontend/th/briefing/weather.js`): Open-Meteo, the place set by typing a town's name in the tile's sheet (not a Settings page), kept only in Core's settings; the forecast asked again on open when the kept one is over 30 minutes old; the sentence covers the next 12 hours (the first wet spell and its kind, else "Dry for the rest of the day." / "Dry tonight."); freshness as §6. Tests: `backend/tests/unit/weather.test.ts`, `backend/tests/integration/weather.test.ts`, `tests/briefing-weather-browser.test.mjs`.

**The night shift's tiles built in P8**: a `tile` surface in app `briefing` (slots `practice`, `study`, `built`, `note.1`–`note.3`; §2's limits checked by the Worker; a tap opens its `path` inside its `app`), placed by night step 7 and shown after "Waiting on you" in that slot order, at most 8 tiles; one without an expiry leaves after a day. "Built overnight" is one tile for now (its sheet with Undo per item waits); Practice waits on Guitar's senses; My Media and Podcasts tiles wait on those apps reporting. With nothing but the weather the page says "I'll arrange this page each night. Tomorrow it fills in." Tests: `backend/tests/integration/briefing-tiles.test.ts`, `tests/briefing-tiles-browser.test.mjs`.


**Built 2026-10-31 (the look round):** his headline large and light, the weather as the page's hero (a big light temperature, the place and the next hours), then what waits on the owner and what the night arranged, on roomier tiles that cascade in as the page opens; Back home at the foot. The line about Muse shows only when Muse has gone quiet ("Muse hasn't checked in since yesterday."); "Muse is connected to the new Worker." was plumbing talk. From 60% of the day's database budget (the free plan's daily limit less the old Worker's share) one more plain line shows above it: "Today's database use is at 62% of the free plan's daily limit.", and from 80% "… Backups and uploads wait until 01:00." (the owner's clock for 00:00 UTC); `BriefingResponse.quota` (built 2026-10-31, the rows-read guard). "Waiting on you" returns home, where the card is docked in view, and pulses it.
**Built 2026-11-02 (tiles that need no mind):** the Worker fills three things itself every time the page asks, so the page has something to say even on a morning the night shift arranged nothing ([why](#why-the-briefing-was-empty-2026-11-02)): **Due** (the owner's reminders today and tomorrow), **Holidays** (the next public holiday within 14 days in the owner's country) and **the day's line** under the title (the date, and one sentence of counts). The weather tile shows tomorrow's high and low. When the connected night shift didn't arrange the page, one line says so. Code: `backend/src/areas/briefing/assemble.ts`, `holidays.ts`, `frontend/th/briefing/page.js`, `due.js`. Tests: `backend/tests/integration/briefing-tiles.test.ts`, `backend/tests/unit/holidays.test.ts`, `tests/briefing-tiles-browser.test.mjs`, `tests/briefing-weather-browser.test.mjs`.

## Rules at a glance

1. **Open it:** swipe right on home, or the hidden "Briefing" button. **Close it:** swipe left, Back, or a tile that goes home ([GESTURES](../design/GESTURES.md) §4, §7).
2. It is a **finite page**: at most **8 tiles**, about two phone screens. Never a feed, never infinite.
3. **Weather is always first; "Waiting on you" is second** when anything waits. The night shift orders everything else.
4. A tile appears **only when it has something to say.** No placeholders, no zeros, no "nothing new".
5. Every tile **carries its why** (plan law 3), reachable by long-press → "Why this?".
6. Every tile **does one thing on tap**: it opens the place it talks about.
7. It paints **from cache instantly and works offline**, showing "as of" times when data is old.
8. Only one gold element: the "Waiting on you" tile.
9. Nothing on it **needs the owner before 06:30** (owner ruling): decisions created in quiet hours stay off it until then.

## 1. Layout

| Part | Values (built unless marked) |
|---|---|
| Page | Full screen, slides in from the left; padding `18px + safe-area` top, 18 px sides, 40 px bottom; vertical scroll, no scrollbar |
| Date | Inter 600 11 px caps, +0.14em, `--ink-3`: `toLocaleDateString(undefined, {weekday:'long', day:'numeric', month:'long'})`, e.g. "TUESDAY 28 OCTOBER"; from 2026-11-02 the Worker's `today.date` ("Monday 2 November", the owner's calendar day) once the page has loaded |
| Title | Fraunces italic 34/1.12, margin 16 px above, 20 px below: the Thunderhead's line for the page (§3) |
| The day's line (built 2026-11-02) | Under the title, body size, `--ink-2`: `today.line`, one sentence the Worker makes from counts only, never from anyone's words: reminders due today, new podcast episodes the night counted (follows checked in the last 20 hours), songs added in the last day (the Music object's log). "2 reminders due today, 3 new episodes and 12 songs added." Zeros are left out; all zero: no line. ≤ 60 characters (over it, "due today" becomes "due"); a count over 99 reads "99+" |
| Grid | 2 columns, gap 10 px; a `.wide` tile spans both |
| Tile | Flat glass [proposal: built uses live glass], radius 22, padding 14/15; key line (16 px icon + Inter 600 12 in the app's text colour), value (Inter 500 15/1.35), detail (Inter 400 13/1.4, `--ink-3`), optional big number (Inter 500 30/1.05) |
| Footer | "Swipe left to go back" (Inter 500 12, `--ink-3`, centred, 18 px above). Shown only while the gesture hints are still showing on home ([HOME](HOME.md) §10) [proposal] |

**Packing rule:** tiles are placed in order. A tile marked `wide` takes a full row. Two half tiles share a row. A half tile left without a partner becomes wide. Acceptance: for any order of 1–8 tiles the grid has no empty half row.

## 2. Tiles

| Tile | Width | Key line | Value | Detail | Data source | Tap |
|---|---|---|---|---|---|---|
| **Weather** | wide | cloud-sun icon · place name | Big: current temperature ("24°") | One sentence for the rest of the day ("Storms from 21:00 to 02:00. Clear by morning."), then "Tomorrow 21° / 10°" (built 2026-11-02, from the daily high and low the same Open-Meteo call already returns) | The Worker fetches a free weather API for the owner's saved place every 60 min [proposal: Open-Meteo, no key; the place is stored only in the Worker, never in the repo] | A weather sheet: next 12 hours (time, temperature, rain chance) and tomorrow's high/low [proposal] |
| **Waiting on you** | half (gold) | gold dot · "Waiting on you" (gold text) | The first decision's short title (≤ 32 chars) | "One tap on home" / "3 waiting · one tap each on home" | Live: proposals with `status=waiting` that are not held for quiet hours | Goes home and scrolls the decision card into view, pulsing its border once ([HOME](HOME.md) §3.5) |
| **Due** (built 2026-11-02) | half | alarm icon · "Due" | Counts only: "2 today · 1 tomorrow", "1 today", "3 tomorrow" | The next one's time: "Next at 14:30" / "Next tomorrow at 09:00" | Live, by the Worker: the owner's set reminders delivered before the end of tomorrow (owner-local days, by delivery time, so one moved out of quiet hours counts where it rings), at most 50 | A sheet (`due.js`): Today, then Tomorrow, each reminder's time and words, Close |
| **Holidays** (built 2026-11-02) | half | calendar-star icon · "Holidays" | The holiday's name (≤ 32) | "Wednesday 11 November · in 9 days" / "… · tomorrow" / "Today" | By the Worker, from a static list in the repo (`backend/src/areas/briefing/holidays.ts`: US, GB, CA, AU, DE, FR, ES, MX, 2026–2027; fixed dates listed, Easter and nth-weekday days computed, nothing fetched; national days only, and a weekend holiday's substitute weekday is not shown), keyed by the private setting `owner.country` (ISO 3166-1 alpha-2), set from the weather place's country when Open-Meteo's geocoder gives one (a place kept before 2026-11-02 is looked up once more by its name). The next one within 14 days, the day itself included. No country, a country without a list, or a year past 2027: no tile | Nothing to open (a plain tile) |
| **Practice** | half | Guitar icon · "Practice" | Planned length ("12 min") | What and how ("Bars 9–12 at 92") | Night shift `briefing.practice` surface, from Guitar senses | Opens Guitar at that piece, section and tempo |
| **Study** | half | Study icon · "Study" | Today's reading | Book, page and minutes ("p. 212 · 20 min") | Night shift `briefing.study` surface | Opens Study at that book and page |
| **Built overnight** | half, or wide when 2+ things | Music/other app icon · "Built overnight" | What was made ("A calm playlist") | Where and how big ("31 songs, ready in Music") | Night shift ledger entries of the night with `show_in_briefing` | One thing: opens it. Two or more: a sheet listing each with its why and **Undo** |
| **My Media** | wide | My Media icon · "My Media" | "2 new videos saved" | "From channels you follow · 34 min total" | Live count from My Media since the last open | Opens My Media's "New" list |
| **Podcasts** | wide | Podcasts icon · "Podcasts" | "New episode downloaded" | "Ready for your walk" (the night's why, short) | Live: downloads finished since the last open | Opens Podcasts on that episode |

Tiles not yet possible are simply absent: their app has not moved over (e.g. Study before it ships), or it was ported as it is and does not report senses yet (owner ruling: apps come over unchanged first). The first build shows only the "Not connected yet" tile.

**Content limits** (enforced by the Worker when a surface is written; a longer field is rejected):

| Field | Limit |
|---|---|
| Key line label | ≤ 24 characters |
| Value | ≤ 32 characters |
| Detail | ≤ 60 characters (2 lines) |
| Big number | ≤ 5 characters |
| Why | ≤ 140 characters |

## 3. The title line

The Thunderhead's own line, Fraunces italic. Fixed lines by time of day, unless the night shift supplies one (≤ 32 characters):

| Local time | Line |
|---|---|
| 04:00–14:59 | *Here's your day.* (built) |
| 15:00–18:59 | *Here's the rest of today.* [proposal] |
| 19:00–03:59 | *Here's tonight.* [proposal] |
| No tiles except weather | *A quiet day.* [proposal] |
| Not built yet | *Here's your day.* plus the "Not built yet" tile (built; until stage H) |

## 4. Ordering and arrangement

1. **Weather** first, if a place is set.
2. **Waiting on you** second, when anything waits (outside quiet hours); then **Due** (built 2026-11-02), when a reminder is due today or tomorrow.
3. **Holidays** comes last of the tiles (built 2026-11-02): it is the one thing that is true whatever the night did.
4. The **night shift's order** for the rest: it writes a `briefing` surface for the day with an ordered tile list. Its rules ([mind BEHAVIOR](../mind/BEHAVIOR.md)):
   - what the owner is most likely to act on this morning comes first (practice before media on a practice day);
   - tiles about something the owner already did today drop to the bottom, then disappear the next day;
   - each tile has a `why` and an `expires` (end of day by default).
5. Live tiles the night shift did not place (My Media, Podcasts) go after the night's tiles, newest first.
6. At most **8 tiles**. If there are more candidates, the lowest-ranked are dropped; dropped items stay reachable in their apps.

**During the day** the page updates live:

| Event | Tile change |
|---|---|
| A practice session is logged | Practice tile: value "Done", detail "14 min · bars 9–12 clean", moves to the bottom |
| A decision is answered | "Waiting on you" updates its count or disappears |
| New media arrives | Its tile appears or its count goes up |
| Midnight | Nothing; the page belongs to the conversation day, which rolls at 04:00 after 60 quiet minutes |

If the night shift has not run by the first open of the day, the page is the Worker's own: weather, waiting, Due, Holidays and the day's line (built 2026-11-02), and, while the night shift is connected, one line under the tiles (`BriefingResponse.night`): "The night shift hasn't run yet." (from 07:00, after the 06:07 fallback had its chance) "The night shift ran out of time before arranging this page." (the hard stop ended its run before step 7) or "The night shift stopped before arranging this page." (not done, and no step for 20 minutes, before step 7). It takes the place of "I'll arrange this page each night."

## 5. Arranging, loading and refreshing

(This section held the Board, the Daily Board folded into the page, until the owner cut it on 2026-10-31: no Muse Daily Board. Its tile, reader, brief and approval were removed; the blocks it drew live on under a reply in the chat, HOME.md §4.3.)

- **Arranged by the owner** (built 2026-10-30): a long press (450 ms) on a tile opens Move earlier · Move later · Hide · Done under it (the press's tap is swallowed); the order and the hidden tiles are kept on this phone (`th.p.tiles`) and applied over the Worker's order; "One tile hidden · Show" brings them back. "Waiting on you" can move but never hide.
- **Loading and refreshing** (built 2026-10-30): with nothing on this phone yet, three skeleton tiles with a light passing across them; if that first read fails, one tile says so ("Your day didn’t load. Pull down to try again."). At the top of the page, pulling down 64 px ("Release to refresh") reads it again with the bottom light breathing until it is done.
- **Values roll in** (built 2026-10-30): when the Briefing redraws and a tile's value or detail has changed (the temperature, a count, "as of"), the new text rises in over 380 ms instead of jumping; reduced motion: no roll.

## 6. Freshness

| Data | Refreshed | "As of" shown when older than | Hidden when older than |
|---|---|---|---|
| Weather | Every 60 min while visible; on open if > 30 min old | 3 h ("as of 14:10" replaces the detail) | 12 h (tile shows "Weather is out of date" with no number) |
| Waiting | Live | never | n/a |
| Night tiles | Once per day (night shift), live updates during the day | n/a | Their `expires` (end of the day by default) |
| Due, Holidays, the day's line | On every read of the page (the Worker) | n/a | Due: once delivered; Holidays: after its day |
| Media, podcasts | Live | n/a | Opened, or 48 h old |

The whole page is cached in IndexedDB. Offline, it paints from cache with the date line suffix "· Offline" on home and "as of" on stale tiles.

## 7. Empty and error states

| State | Shown |
|---|---|
| Until the page is built (P4 stage H) | Title *Here's your day.*; one wide tile: "Not built yet" / "This page comes with an upcoming update." / "Weather, practice, study, and what I built overnight." (built; it said "Your briefing fills in once I'm connected.", untrue once the mind is connected) |
| First day after sign-in | Weather (if a place is set) and one wide tile: "I'll arrange this page each night. Tomorrow it fills in." [proposal] |
| No place set for weather | The weather tile reads "Weather" / "Set a place for the weather" and opens Settings → Briefing place [proposal] |
| Nothing at all to show | Title *A quiet day.* and the weather tile only |
| Weather API failing | Last good value with "as of"; hidden after 12 h |
| Night shift failed | The Worker's own page (§4) and the night line: "The night shift ran out of time before arranging this page." / "The night shift stopped before arranging this page." / "The night shift hasn't run yet." (built 2026-11-02) |

## 8. Long-press on a tile

Every tile is `[data-ask]` ([GESTURES](../design/GESTURES.md) §5). The action menu offers:

| Item | Does |
|---|---|
| Ask about this | Home, with the tile attached to the ask bar |
| Why this? | A small sheet with the tile's why ("Because you stopped at bar 12 yesterday.") |
| Hide for today [proposal] | Removes the tile until tomorrow; logged as a sense so the night shift learns |
| Show less of this [proposal] | Same, plus a feedback event the night shift weighs when arranging |

## 9. Accessibility

- The page is a `<section aria-label="Briefing">`; each tile is a `<button>` whose accessible name is "key line, value, detail".
- The "Waiting on you" tile says "Waiting on you, 1 decision, opens it on home".
- Focus moves to the briefing's title when it opens and back to the "Briefing" button when it closes.

## 10. Acceptance

| # | Check |
|---|---|
| B1 | With a mocked surface of 10 candidate tiles, at most 8 render, weather first, waiting second |
| B2 | Packing: no empty half row for any order of 1–8 tiles |
| B3 | A surface field over its limit is rejected by the Worker with 422 `validation` |
| B4 | Weather 4 h old shows "as of"; 13 h old shows "Weather is out of date" |
| B5 | A decision created at 23:00 is not on the briefing at 05:00 and is at 06:31 |
| B6 | Tapping "Waiting on you" closes the briefing and scrolls the card into view |
| B7 | Offline: the cached briefing paints in < 1 s with no network request blocking it |
| B8 | A swipe that ends on a tile does not tap it ([GESTURES](../design/GESTURES.md) G11) |
| B9 | Practice logged → the tile changes to "Done" within 2 s via the live channel |

## Why the Briefing was empty (2026-11-02)

The owner: the nightly briefing put no new cards or anything on the app. Counts and states only below; nothing personal.

**What the live Worker said.** From the diagnosing session, `GET /v1/health` answered 200 with the live build `5f7cdd9` (2026-11-01, 22 commits behind `main` that night). The eight private routes it was allowed (`/v1/ops/health/deep`, `/ops/errors`, `/ops/watchdogs`, `/ops/meter`, `/mind/wakes`, `/surfaces`, `/briefing`, `/settings`) all answered **401** `unauthorized`, not 403: no credential reached the Worker, so no wake, run, surface, watchdog or error could be counted. The diagnosis below is from the code and the repository's record (STATUS.md: SETUP.md L1 done on 2026-10-29, the first night ran clean; the night's tiles live since 2026-10-30).

**The path, end to end.**

1. *Fire.* Core's 15-minute tick (`backend/src/objects/core.ts` `tick`) rolls the day at 04:00 local after 60 quiet minutes and, in the same commit, `nightWake` (`areas/mind/night.ts`) inserts a `night` wake, only while `ROUTINE_NIGHT_URL`/`TOKEN` are set and not `none` (`areas/mind/fire.ts` `fireConfig`), the night of the day before isn't done, and no night wake of the last 12 hours is open. Then one `POST` to the routine with `{"text":"wake"}` and its status on the wake row; no retry: the routine's 06:07 schedule is the fallback.
2. *Run.* The session's hook claims the wake (`th brief --claim`, `areas/mind/ops.ts` `claim`); `mind/ROLES.md` (night) walks the steps of `shared/contract/night.ts` with `th night start` / `th night step <n> done` (`POST /v1/mind/night`), in the registry's order, a step out of order being 409.
3. *Place.* Step 7: `th podcasts new` (`home/line.4`), `th surface home line.<1-3>` and `th surface briefing <slot> --kind tile`, each a `PUT /v1/surfaces/:app/:slot` (`areas/surfaces/ops.ts` `put`): the kind, slot and payload are checked (422; the CLI checks the same JSON Schema first, exit 8), a topic the owner dismissed in the last 14 days is 409 `nudge_repeat`, an unknown, muted or private fact 422/403, an expiry in the past 422.
4. *Show.* `GET /v1/briefing` (`areas/briefing/assemble.ts` `nightTiles`): `tile` surfaces in app `briefing`, kept 24 hours without an expiry, at most 8 tiles. `GET /v1/surfaces` → the phone's `homeLines` (`frontend/th/registry/surfaces.js`): lines placed since 04:00 of the open day, the night's as one Overnight card when quiet hours end.

**What was wrong.**

1. *Step 7 sat behind the run's own target.* The budgets before it were 1 + 5 + 3 + 6 + 8 + 10 = **33 minutes** (step 6 also runs `th music jobs`), against a 30-minute target and a 45-minute hard stop. ROLES.md told the night to aim for 30 and at 45 to end with `th night done --partial`, which records every step left as skipped `hard_stop`, step 7 among them. Health (errors, deep health, agreed fixes on a branch) and the books (tool setup, then 10 minutes of reading) are the two steps most likely to overrun. A cut step 7 places nothing: no tile, no home line, no podcasts line, which is what the owner saw.
2. *Nothing said so.* A partial run sets `done_at`, so it counts as done: the mind's night line read "night shift: <day> done", the `night.late` watchdog (a day note or a done run by 09:00) stayed quiet, and the page said "I'll arrange this page each night. Tomorrow it fills in." every morning.
3. *Even reached, step 7 had little to place.* Study needs books read (SETUP.md O1, ask-first), Practice waits on Guitar's senses, Built only when something was built (the mixes come at step 11, after it), notes need a reason, and the rules forbid placeholders and zeros. The podcasts line needs followed shows synced from the phone and a new episode. Zero tiles was a correct outcome on most nights, and the page had nothing of its own but the weather.

**Ruled out in the code.** Taint: `surfaces.put` has no taint check, and after songs the night's shell still runs `th`. Quiet hours: tiles show when placed; home lines wait for the quiet end and then show. Age: a tile without an expiry lasts 24 hours from about 04:30, so all day. The phone: it draws every `night` tile it is given, and the night writes its lines after the roll, so after 04:00 of the open day.

**Not checkable from here (owner side, not faked).** Whether the fire secrets are still set and the routine still has its 06:07 schedule. If `GET /v1/mind/wakes` shows no `night` rows for the last nights, or rows with `fire_error` `http_401` (the token) or `http_404` (the URL), it is SETUP.md **L1 step 4** (the Worker's `ROUTINE_NIGHT_URL`/`TOKEN`) and **step 3** (the routine's Schedule trigger); the mind's own briefing says "night shift: not connected yet (SETUP.md L1)" while they are `none`.

**The fix (built 2026-11-02).**

- Step 7 runs right after step 4: the run is 1, 2, 3, 4, 7, 5, 6, 8, 9, 11, 10 (`shared/contract/night.ts`, `mind/ROLES.md` at 5,997 characters, RUNTIME.md §12). It starts by minute 15 of the budgets, with the facts of step 4 to draw on; a step's number is still its name.
- The mind's night line names what a hard stop cut: "night shift: <day> done, but the hard stop cut steps 5, 6".
- The page says when the connected night didn't arrange it (§4, §7), instead of the promise.
- The page fills itself without a mind: Due, Holidays, the day's line, tomorrow on the weather tile (§1, §2). `GET /v1/briefing` now reads 34 rows in Core (8 before) and 50 in Music (a day's songs, walked back from the newest log row), measured and pinned in `backend/tests/cost/budgets.json`.

To confirm on the live Worker once a key can read it: `GET /v1/mind/wakes` (the `night` rows: status, `fire_status`, `fire_error`), the chat briefing's night line (which now names cut steps), `GET /v1/surfaces` (how many `tile` and `line` surfaces and their `written_at`), `GET /v1/ops/watchdogs` (`night.late`).

## The report card (design, not built)

The owner chose: the night's written report becomes an **expandable tile** on the Briefing and the **first message of the day's fresh chat**. Design only; nothing of it is built.

**Who writes it, and when.** The night, as a new step 12 "the report", placed after step 9 and before step 11 (the run: 1, 2, 3, 4, 7, 5, 6, 8, 9, 12, 11, 10). Before the songs, because reading songs' tags taints the session and a tainted session's words may not reach the owner; what step 11 then does joins the report as Worker counts, never as words. `th report --headline "<…>" --line <kind>:"<…>" …` → `PUT /v1/briefing/report/:day`: the night key only (`N`), a claimed, live, untainted session (`403 session_tainted` otherwise), `:day` the run's closed day. The same body again answers the stored report; a new body from the same session replaces it (a ledger row with undo); from another session, 409.

**Data shape** (`shared/contract/briefing.ts`, to add):

```ts
type ReportKind = 'memory' | 'loose_ends' | 'built' | 'reading' | 'music' | 'health' | 'predictions' | 'note';
interface NightReport {
  day: string;                // the closed day the night worked on
  written_at: number;
  headline: string;           // the mind's, ≤ 60 characters, one line
  lines: { kind: ReportKind; text: string; ref: string | null }[]; // ≤ 6, each ≤ 100; ref app:<id> | ledger:<id>
  counts: {                   // the Worker's own record of the run, never the mind's words
    facts_added: number; facts_confirmed: number; loose_ends_closed: number; loose_ends_added: number;
    pages_read: number; songs_noted: number; mixes: number; predictions: number;
    steps_cut: number[];      // what a hard stop cut, in run order
  };
  ledger_id: string;
}
```

**Limits.** Headline ≤ 60 characters, at most 6 lines of ≤ 100, 800 characters in all; one line each, no exclamation marks, emoji or Markdown; the shared phrase lint (`shared/contract/lint.ts`) applies; a `ref` is only `app:<id>` or `ledger:<id>`. No names of other people, no song or episode titles (the counts carry those parts). One report per closed day; kept 30 days in Core (backup and export: yes), then pruned; a held (off the record) conversation is never in it, as the night never reads one.

**The tile.** `kind: 'report'`, wide, after Due and before the night's own tiles: key line moon-stars · "Overnight", value the headline, detail the counts in one line ("3 facts · 2 loose ends · 40 songs noted"). A tap expands it in place (`aria-expanded`): the lines, each opening its `ref` when it has one, and "Cut by the time limit: steps 5, 6" when `steps_cut` isn't empty; a second tap collapses it. It shows from the quiet hours' end (06:30 or the owner's later end) to the end of the open day. No report (the night cut before step 12, or didn't run): no tile, and the night line (§7) says why.

**The first message of the day.** When the report is put and the open day's thread has no owner message yet, the Worker (not the mind: the night may not post) adds it as that thread's first message: author `mind`, `meta.report = <day>`, the headline and the lines as a short list, the counts as one block, `visible_from` the quiet end, no push, no wake. If the owner has already written that day, it stays a tile only. The next chat session's briefing carries the report in its "Last night" section, so the mind can follow up on it.

**Cost.** One report row, one message row and their change and ledger rows: 4 to 6 writes a night; the tile reads one row.

**Tests (when built).** The route's guards (night key only, a tainted session refused, the limits, the same body again, another session 409); the report as the open day's first message only when the thread has no owner message, hidden until the quiet end, with no push; the tile expands and collapses at 390×844, keyboard and screen reader included; a cut run's `steps_cut`; the lint.

## Open questions / tests

| Question | How to settle it |
|---|---|
| Which weather source? Open-Meteo is free with no key but its free tier is for non-commercial use (fine for a personal app); MET Norway is free with a User-Agent. | Pick one; check its terms page; test from the Worker (no cost). |
| Does the briefing need its own "place" setting, or does the mind ask once? | Owner choice; default: the mind asks once in chat and stores it as a fact. |
| Does a fixed 8-tile cap feel right on the A15 (two screens)? | Screenshot at 384×832 with 8 tiles; owner looks. |
