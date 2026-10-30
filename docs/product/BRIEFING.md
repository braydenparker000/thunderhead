# The Briefing

The Briefing is the page one swipe right of home: the day at a glance, arranged by the night shift. Weather, what's waiting, practice, study, what was built overnight, new media, and the Board (owner ruling).
This file specifies its sections, ordering, data sources, freshness, empty states, tap and long-press behaviour, and limits.
Sibling docs: [HOME](HOME.md), [GESTURES](../design/GESTURES.md), [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md), [COPY](../design/COPY.md), [mind BEHAVIOR](../mind/BEHAVIOR.md), [JOBS](../engineering/JOBS.md), [API](../engineering/API.md), [MUSIC](apps/MUSIC.md), [GUITAR](apps/GUITAR.md), [STUDY](apps/STUDY.md), [MY-MEDIA](apps/MY-MEDIA.md), [PODCASTS](apps/PODCASTS.md).

**Built in P4 stage H** (`frontend/th/briefing/`, `tests/briefing-browser.test.mjs`; the Worker side `GET /v1/briefing`, `GET /v1/board/editions/:day`): the date, the title line by the hour (and *A quiet day.* with nothing to show), "Waiting on you" (gold; a tap goes home and pulses the card), the Board tile last with today's edition or yesterday's marked, the Board reader (cover, "In 30 seconds", every v2 block type, numbered sources, "Ask about this" filling the ask bar), Muse's line, and the page painted from this phone first. Weather, the night shift's tiles, media and podcasts come with P8's Briefing data; until then the page says so in one quiet line instead of a placeholder tile.

**Weather built in P8** (`backend/src/areas/briefing/weather.ts`, `frontend/th/briefing/weather.js`): Open-Meteo, the place set by typing a town's name in the tile's sheet (not a Settings page), kept only in Core's settings; the forecast asked again on open when the kept one is over 30 minutes old; the sentence covers the next 12 hours (the first wet spell and its kind, else "Dry for the rest of the day." / "Dry tonight."); freshness as §6. Tests: `backend/tests/unit/weather.test.ts`, `backend/tests/integration/weather.test.ts`, `tests/briefing-weather-browser.test.mjs`.

## Rules at a glance

1. **Open it:** swipe right on home, or the hidden "Briefing" button. **Close it:** swipe left, Back, or a tile that goes home ([GESTURES](../design/GESTURES.md) §4, §7).
2. It is a **finite page**: at most **8 tiles plus the Board**, about two phone screens. Never a feed, never infinite.
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
| Date | Inter 600 11 px caps, +0.14em, `--ink-3`: `toLocaleDateString(undefined, {weekday:'long', day:'numeric', month:'long'})`, e.g. "TUESDAY 28 OCTOBER" |
| Title | Fraunces italic 34/1.12, margin 16 px above, 20 px below: the Thunderhead's line for the page (§3) |
| Grid | 2 columns, gap 10 px; a `.wide` tile spans both |
| Tile | Flat glass [proposal: built uses live glass], radius 22, padding 14/15; key line (16 px icon + Inter 600 12 in the app's text colour), value (Inter 500 15/1.35), detail (Inter 400 13/1.4, `--ink-3`), optional big number (Inter 500 30/1.05) |
| Footer | "Swipe left to go back" (Inter 500 12, `--ink-3`, centred, 18 px above). Shown only while the gesture hints are still showing on home ([HOME](HOME.md) §10) [proposal] |

**Packing rule:** tiles are placed in order. A tile marked `wide` takes a full row. Two half tiles share a row. A half tile left without a partner becomes wide. Acceptance: for any order of 1–8 tiles the grid has no empty half row.

## 2. Tiles

| Tile | Width | Key line | Value | Detail | Data source | Tap |
|---|---|---|---|---|---|---|
| **Weather** | wide | cloud-sun icon · place name | Big: current temperature ("24°") | One sentence for the rest of the day ("Storms from 21:00 to 02:00. Clear by morning.") | The Worker fetches a free weather API for the owner's saved place every 60 min [proposal: Open-Meteo, no key; the place is stored only in the Worker, never in the repo] | A weather sheet: next 12 hours (time, temperature, rain chance) and tomorrow's high/low [proposal] |
| **Waiting on you** | half (gold) | gold dot · "Waiting on you" (gold text) | The first decision's short title (≤ 32 chars) | "One tap on home" / "3 waiting · one tap each on home" | Live: proposals with `status=waiting` that are not held for quiet hours | Goes home and scrolls the decision card into view, pulsing its border once ([HOME](HOME.md) §3.5) |
| **Practice** | half | Guitar icon · "Practice" | Planned length ("12 min") | What and how ("Bars 9–12 at 92") | Night shift `briefing.practice` surface, from Guitar senses | Opens Guitar at that piece, section and tempo |
| **Study** | half | Study icon · "Study" | Today's reading | Book, page and minutes ("p. 212 · 20 min") | Night shift `briefing.study` surface | Opens Study at that book and page |
| **Built overnight** | half, or wide when 2+ things | Music/other app icon · "Built overnight" | What was made ("A calm playlist") | Where and how big ("31 songs, ready in Music") | Night shift ledger entries of the night with `show_in_briefing` | One thing: opens it. Two or more: a sheet listing each with its why and **Undo** |
| **My Media** | wide | My Media icon · "My Media" | "2 new videos saved" | "From channels you follow · 34 min total" | Live count from My Media since the last open | Opens My Media's "New" list |
| **Podcasts** | wide | Podcasts icon · "Podcasts" | "New episode downloaded" | "Ready for your walk" (the night's why, short) | Live: downloads finished since the last open | Opens Podcasts on that episode |
| **The Board** | wide, always last | newspaper icon · "The Board" | The edition's title (≤ 2 lines) | "5 stories · 6 min read" | Today's Board edition (produced by Muse through a work order, owner ruling; v2 format) | Opens the Board reader (§5) |

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
2. **Waiting on you** second, when anything waits (outside quiet hours).
3. The **night shift's order** for the rest: it writes a `briefing` surface for the day with an ordered tile list. Its rules ([mind BEHAVIOR](../mind/BEHAVIOR.md)):
   - what the owner is most likely to act on this morning comes first (practice before media on a practice day);
   - tiles about something the owner already did today drop to the bottom, then disappear the next day;
   - each tile has a `why` and an `expires` (end of day by default).
4. **The Board** last: it is long reading.
5. Live tiles the night shift did not place (My Media, Podcasts) go after the night's tiles, newest first.
6. At most **8 tiles** before the Board. If there are more candidates, the lowest-ranked are dropped; dropped items stay reachable in their apps.

**During the day** the page updates live:

| Event | Tile change |
|---|---|
| A practice session is logged | Practice tile: value "Done", detail "14 min · bars 9–12 clean", moves to the bottom |
| A decision is answered | "Waiting on you" updates its count or disappears |
| New media arrives | Its tile appears or its count goes up |
| The Board publishes | The Board tile appears |
| Midnight | Nothing; the page belongs to the conversation day, which rolls at 04:00 after 60 quiet minutes |

If the night shift has not run by the first open of the day, the Worker builds a **fallback briefing** from live data only (weather, waiting, media, podcasts, Board) and the footer reads "The night shift hasn't run yet. I'll catch up." [proposal]

## 5. The Board, folded in

The Board (the old Daily Board) is a daily news edition **produced by Muse** to the owner's standing brief (owner ruling; Muse's procedures may change when a better option exists). It is merged into the intelligent chat and shown on the Briefing page instead of being a separate app (owner ruling): the Thunderhead can talk about any story, and "Ask about this" on a story opens home with it attached.

- **Tile:** as in §2. Today's edition only. If today's has not arrived by **09:00**, the tile shows yesterday's with the detail "Yesterday's edition"; editions older than 2 days are not shown.
- **Reader:** tapping opens a full-screen reader page over the briefing (a history entry; Back returns to the briefing).
  - Cover: date and the edition title, then "In 30 seconds" (each story's one-line dek).
  - Stories in the edition's order, each with title, label, dek, "Why it matters", blocks (text, stats, chart, timeline, quote and the rest of the v2 format) and numbered source marks that open the source list.
  - Type: Inter for everything. The Board is not the Thunderhead's voice, so it never uses Fraunces (owner ruling on type) [the old Board used a serif headline face; that changes].
  - Long-press a story: "Ask about this".
- **Brief:** the owner's Board choices (topics, depth, number of stories) are edited by asking the Thunderhead ("more economy, less sport"); the mind updates the brief. No settings screen in v1 [proposal].
- Its full reader spec belongs in a future `docs/product/apps/BOARD.md` (not yet assigned).

## 6. Freshness

| Data | Refreshed | "As of" shown when older than | Hidden when older than |
|---|---|---|---|
| Weather | Every 60 min while visible; on open if > 30 min old | 3 h ("as of 14:10" replaces the detail) | 12 h (tile shows "Weather is out of date" with no number) |
| Waiting | Live | never | n/a |
| Night tiles | Once per day (night shift), live updates during the day | n/a | Their `expires` (end of the day by default) |
| Media, podcasts | Live | n/a | Opened, or 48 h old |
| Board | When published | n/a | 2 days |

The whole page is cached in IndexedDB. Offline, it paints from cache with the date line suffix "· Offline" on home and "as of" on stale tiles.

## 7. Empty and error states

| State | Shown |
|---|---|
| Until the page is built (P4 stage H) | Title *Here's your day.*; one wide tile: "Not built yet" / "This page comes with an upcoming update." / "Weather, practice, study, and what I built overnight." (built; it said "Your briefing fills in once I'm connected.", untrue once the mind is connected) |
| First day after sign-in | Weather (if a place is set) and one wide tile: "I'll arrange this page each night. Tomorrow it fills in." [proposal] |
| No place set for weather | The weather tile reads "Weather" / "Set a place for the weather" and opens Settings → Briefing place [proposal] |
| Nothing at all to show | Title *A quiet day.* and the weather tile only |
| Weather API failing | Last good value with "as of"; hidden after 12 h |
| Night shift failed | Fallback briefing (§4) |

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
| B1 | With a mocked surface of 10 candidate tiles, at most 8 render before the Board, weather first, waiting second, Board last |
| B2 | Packing: no empty half row for any order of 1–8 tiles |
| B3 | A surface field over its limit is rejected by the Worker with 422 `validation` |
| B4 | Weather 4 h old shows "as of"; 13 h old shows "Weather is out of date" |
| B5 | A decision created at 23:00 is not on the briefing at 05:00 and is at 06:31 |
| B6 | Tapping "Waiting on you" closes the briefing and scrolls the card into view |
| B7 | Offline: the cached briefing paints in < 1 s with no network request blocking it |
| B8 | A swipe that ends on a tile does not tap it ([GESTURES](../design/GESTURES.md) G11) |
| B9 | Practice logged → the tile changes to "Done" within 2 s via the live channel |

## Open questions / tests

| Question | How to settle it |
|---|---|
| Which weather source? Open-Meteo is free with no key but its free tier is for non-commercial use (fine for a personal app); MET Norway is free with a User-Agent. | Pick one; check its terms page; test from the Worker (no cost). |
| Should the Board tile sit last or after the first two personal tiles? | Owner preference after a week of use. |
| Does the briefing need its own "place" setting, or does the mind ask once? | Owner choice; default: the mind asks once in chat and stores it as a fact. |
| Does a fixed 8-tile cap feel right on the A15 (two screens)? | Screenshot at 384×832 with 8 tiles + Board; owner looks. |
