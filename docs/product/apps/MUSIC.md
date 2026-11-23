# Music

> **Owner ruling 2026-10-28:** this app is first ported over **as it is**, with no changes. This spec describes where it goes *after* that port; nothing here is built until the owner agrees to it.

The owner's own music library (about 7,500 tracks today, built to hold 20,000), played by one audio
engine that keeps going across every screen. This doc is the source of truth for what Music does:
screens, the engine, offline, search, DJ shuffle, the mind's part, data, and the tests that prove it.

Status: spec for phase P5 (see [ARCHITECTURE](../../engineering/ARCHITECTURE.md)). Fixed decisions
come from [decisions.md](../../process/decisions.md); anything marked **[proposal]** is new and waits
for the owner's yes.

## Rules at a glance

1. **First the old player comes over as it is** (owner ruling 2026-10-28): its Poweramp-style UI,
   engine, presets, fonts and names, unchanged (see "First move" below). Later, only if the owner
   agrees: the engine's measured behaviours (gapless, dual deck, song heads, crossfades, EQ/limiter
   worklet, stream recovery, Media Session) move into the shell with a plain API and the screens
   below replace the old UI **[proposal]**.
2. **One engine, many screens** (later step). The audio engine lives in the shell (`frontend/lib/audio/`), not
   in the Music app. Leaving Music, opening home, or talking to the Thunderhead never stops sound.
3. **Gapless by default.** Track end to track start is 0 ms of added silence, with no click above
   −80 dBFS (lab metric, §5.3).
4. **Never clip.** A true-peak limiter at −1 dBTP is always on. Loudness normalisation is on by
   default **[proposal]**.
5. **Skips feel instant.** Skip to a song whose head is on the phone: first sound in ≤ 200 ms at
   p75 on the phone of record (the old engine measured 124 ms).
6. **Audio never passes through the Worker.** It comes from R2 presigned URLs
   (`POST /v1/media/sign`, 3 h expiry, re-sign on failure). Offline copies live in OPFS.
7. **Search never gets worse than plain search.** Exact and prefix matches always come first. Fuzzy
   matches follow. "Similar vibe" results sit in their own section and never reorder the others.
8. **The mind arranges; the owner decides.** The mind can build mixes, queue songs and add "why"
   chips. It never changes a rating the owner gave (it rates only a song they have not rated, from what they said), never deletes an owner playlist, and never starts sound without an
   owner action behind it (§10.3).
9. **Everything the owner does is a sense; everything the mind does is a verb with undo.**
10. **Works offline.** With no network the library still browses and searches; every song with a
    copy on the phone plays.
11. **Accessible without gestures.** Every gesture has a button; the seek bar is a real slider;
    TalkBack can do everything.

## First move: the as-is port (owner ruling)

1. Copy the old Music player into the new site at `/music/` **unchanged**: its Poweramp-style UI,
   engine, EQ presets, fonts, icons and wording.
2. Adjust only what it strictly needs to run on the new site:
   - every asset and link path made root-absolute (the host serves `/music` without a redirect);
   - the API address left as it is: the ported player keeps calling the old Worker (`jarvis-hub-api`)
     until its data moves in P5; the new site's origin is added to the old Worker's allowed origins
     (a one-line old-Worker deploy, ask first; [MIGRATION](../../engineering/MIGRATION.md) §6). No
     new-site token is sent, and the old sign-in does not come over;
   - its own `<meta>` security policy kept first in `<head>`, unchanged except for the new paths; it
     allows exactly what the unchanged page loads ([SECURITY](../../engineering/SECURITY.md) §4.4).
3. The owner's player data (plays, ratings, playlists, EQ and settings) is restored into the same
   stores on the new origin, so it looks and plays exactly as before **[proposal: through the export
   page, §11]**.
4. Done when the owner uses it on the phone and nothing has changed.
5. **The data move (P5, built).** The player itself is still unchanged. Its own service worker
   answers its library requests (still addressed to the old Worker's URLs, so its offline copies
   and song heads stay valid) from the new Worker: the catalog from `GET /v1/music/catalog` (kept
   with its ETag), audio and art by signed links straight from `jarvis-music`, waveforms from
   `GET /v1/music/waveforms/:id` (`frontend/th/music/bridge.js`). It uses the owner's session on
   this site. Nothing ever goes to the old Worker (MIGRATION.md §8): until the new Worker can answer
   (signed out, no catalog imported, no signing key, the bucket refusing a fresh link) the player
   gets that refusal as it is, and keeps the library it has; any other address on that origin is a
   404. On the site the player starts only once its worker controls the page, and signed out the
   page goes to the sign-in door. A network failure or a slow answer
   (a signature, or the first byte of the bucket, the catalog or a waveform, not within 4 s) is tried
   once more with longer waits (a signature 8 s, a first byte 12 s; a link already signed is reused, so
   a signed song starts its bytes with no extra round trip). If that fails too, the player gets a
   network error, not a 404, so it waits and tries again rather than skipping: within 24 s of the
   request at most (`ANSWER_MS`).
   The page names the current song and the next 3, and the worker signs their links together in one
   request before their turn.

Everything after this section describes later steps. Each is proposed after the port and built only
if the owner agrees.

## Contents

1. Library and data · 2. Screens · 3. Queue, shuffle and repeat · 4. Playlists and mixes ·
5. The engine · 6. Media URLs and failures · 7. Offline · 8. Search · 9. DJ shuffle ·
10. The mind's part (senses, verbs, surfaces, what it knows) · 11. Import from the old site · 12. Settings ·
13. Accessibility · 14. Empty, error and offline states · 15. Performance budgets ·
16. New feature ideas · 17. Open questions / tests

---

## 1. Library and data

### 1.1 What the library is

| Fact | Value | Source |
|---|---|---|
| Tracks in the R2 library index | 7,494 (2026-10-24) | old repo `docs/claude-player/audio-quality.md` |
| Formats | Opus 48 kHz 99.2 %; AAC 57; FLAC 2; MP3 1 | same |
| Typical loudness | Median integrated −7.7 LUFS; most tracks decode with sample peaks above 0 dBFS (median +1.2 dBFS) | same |
| Storage | about 35–45 GB in the shared bucket `jarvis-music` | fact-check A4 |
| Design target | 20,000 tracks with no change of design | this doc |

Audio and art stay in `jarvis-music` under their content-addressed keys
(`native/audio/<sha256>.opus`). Nothing is ever deleted from that bucket
(see [SECURITY](../../engineering/SECURITY.md)).

### 1.2 Where each piece of data lives

| Data | Home | On the phone | Notes |
|---|---|---|---|
| Catalog (tags, duration, size, art key, loudness, waveform flag) | `Music` Durable Object | IndexedDB `th-music/catalog` | Catalog writes come only from the upload tools |
| Track marks (rating, which is also the like and "never play this again"; plays, last played) | `Music.track_ratings` (the one rating the mind reads too) and `Music.track_plays`, synced by the phones (§1.4) | `claude-player` `state` `u:<id>` | The phone applies its own changes at once |
| Playlists | `Music.music_playlists`, synced by the phones (§1.4) | `claude-player` `state` `pl:<id>` | One record per playlist, with ordered ids; mixes are the mind's (§4.2) |
| Queue and position | Phone only, mirrored to `Core` device state at most every 60 s **[proposal]** | IndexedDB `th-music/session` | So "keep playing on the other device" is possible later |
| Search index | `thunderhead-private/indexes/music/` | Cache Storage `th-music-index` | **[proposal]** |
| Audio analysis and DJ features | `Music.analysis` (numbers per audio file, from the Actions listening pass) and `thunderhead-private/music/pack.v1.bin` (the phone's file, §9.1) | the phone's file, revalidated by its ETag | About 2.8 MB at 12k tracks; built |
| Waveforms | `Music` DO, one per track | Cache Storage `th-music-wave` | One byte per bar, 16–1000 bars |
| Offline copies | — | OPFS `music/<sha256>.<ext>` | LRU, 512 MB default (§7) |
| Song heads (first seconds) | — | Cache Storage `th-music-heads` | About 0.4 MB per song |
| Covers | `jarvis-music` art; 256 px thumbs in `thunderhead-private/indexes/music/thumbs/` **[proposal]** | Cache Storage `th-art`, 150 MB LRU **[proposal]** | Cache keys are the ref, never the signed URL |

Refs follow the shared format: a track is `music:<trackId>`, a playlist `music:playlist/<listId>`
**[proposal for the playlist form]**. Track ids are the old catalog's ids, kept as they are, so
imported plays and ratings line up (§11).

### 1.3 Catalog delivery

1. `GET /v1/music/catalog` returns the whole catalog without waveforms, with an `ETag`. At 7.5k
   tracks this is about 1.3 MB compressed; at 20k about 3.5 MB.
2. The phone revalidates on Music open and every 10 minutes while Music is visible. An unchanged
   catalog costs a 304.
3. **[proposal]** After the first full load the phone asks `?since=<seq>` and gets only changed
   rows (the catalog log keeps sequence numbers). A full reload happens if the gap is over 5,000
   changes or the server says `410`.
4. A catalog that fails validation is never applied; the phone keeps the last good one.

**Acceptance:** with a 7,494-track fixture, a second open with no catalog change makes exactly one
catalog request and receives 304; a fixture change of 3 tracks via `since` transfers ≤ 5 KB.

### 1.4 The owner's data on every phone (2026-11-21)

The owner: "all music data everywhere … likes etc." Music's look and playback do not change: only
data made on one phone now appears on the other. `frontend/th/music/sync.js` (loaded by
`th/music/dj.js` `installDj`) syncs it through `PUT/GET /v1/music/marks` and `/v1/music/playlists`
(API.md §11.29, Music schema step 6), modelled on Guitar's and Podcasts' sync.

| The owner's data on the phone | Where (`claude-player`, localStorage) | Synced |
|---|---|---|
| A song's rating (5 the like, 1 "not for me", which home's "never play this again" sets) | `state` `u:<id>` `rating`, with `ratedAt` (when it was set, stamped by the sync) | Yes: the newer `rated_at` wins |
| A song's play count and last played | `state` `u:<id>` `plays`, `lastPlayed` | Yes: the larger count and the later time |
| Playlists: name, entries in order, made, the file it came from | `state` `pl:<id>` | Yes: the newer record wins whole; a deleted one is a record marked deleted, kept 30 days |
| Songs imported from files on this phone (their ratings and plays) | `tracks` | No: they have no Worker id and their files are on this phone only |
| Pictures picked as covers | `state` `ca:<key>` (images) | No: images, not records; they would need the private bucket |
| List memory (List Position flags and the entry last played per folder or playlist), the queue and its place | `state` `lm:<key>`, `queue`, `queue-list` | No: where this phone is, and what it plays next, stay this phone's |
| EQ and reverb presets, the visualizer's preset ratings, search history, list and sort options, settings | `cp-eq-presets`, `cp-reverb-presets`, `cp-milk`, `cp-search-history`, `cp-list-opts`, `cp-settings`, … | No: device settings, and the sound must not change |
| The DJ's learned moves | `th.music.dj` | No: outside the player's stores; it is how this phone has learned to order |

- **When:** a pull when Music opens (once its library is there) and when it becomes visible; a push
  20 s after a change, on hiding the page and when the network returns. The first time, every song
  this phone has rated or played goes up, at most 1,000 a push. Only signed in.
- **The newer change wins** on the phone and on the Worker, also for a playlist edited on two phones.
  Times go up on the Worker's clock (the offset from each answer). A rating from before the sync has
  no stamp and goes up as the oldest, so any stamped rating wins over it.
- **Three sources of "not for me":** the phone's rating and the `music.rate` sense are the same truth,
  one row per song in `track_ratings`. One clock decides: the sync's (`rated_at` on the Worker's
  clock). A sense's time is the phone's own clock, so a sense never beats a synced rating: it only
  fills a row no sync has touched yet, and the phone's synced stamp replaces it (the phone that sent
  the sense syncs the same rating). The GET returns that row, so "never play this again" on one phone
  is a 1 on the other. A rating that came by sync is never sent back as a sense, and the senses'
  catch-up of songs rated 1 counts it as sent. The mind's
  never-play rules (`music.never` facts in Core, with their own life and undo) stay rules: find
  leaves out both, and they are not copied into ratings (that would be a second truth outliving the
  rule) nor onto the phone (they are not data a phone made).
- A rating from another phone reaches the rows with the player's own message, marked `synced`, so
  `th/music/ratings.js` does not send it back as a sense. Plays from another phone change the fields
  in place and post nothing.
- A change made while its push is on the way stays queued: a song is cleared only if its change count
  is still the one sent, a playlist's sent stamp is the `modified` that went up.
- **Settings → Reset stats** is a record with its own time (`reset_at`, the newest kept): on the
  Worker, plays last played at or before it read as none and an older count sent later changes
  nothing; on each phone, every song last played before it goes back to no plays at the next pull.
  Plays after it count again.
- **Waveforms made again:** the catalog gives each waveform its row's last change (`waveformAt`); the
  phone tags a stored waveform with it, so one registered again is fetched again. Any change to that
  row moves it (a refetch of one small file); the catalog itself is downloaded only when it changes,
  as before, and grows by about 27 bytes a track with a waveform.
- The catalog never carries this data: its ETag and size do not move (the cost suite checks the 304).

---

## 2. Screens

The look follows [DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md): Inter for all UI, Fraunces italic
only where the Thunderhead itself speaks (mind notes, mix titles it named, why text). Music's
accent is `#2f7df6`. Day uses the soft colour field; night is pure black. Until the owner agrees to
this redesign, the ported Poweramp-style screens stay exactly as they are; the design below is a
later proposal.

### 2.1 Map

```
Music (route /music/)
├── Home tab strip: Mixes · Playlists · Library        ← segmented control, top
│   ├── Mixes        mind-built mixes, newest first
│   ├── Playlists    the owner's playlists
│   └── Library      Songs · Albums · Artists · Genres · Recently added · Most played
├── Search           (field at the top of every tab)
├── Album / Artist / Genre / Playlist / Mix detail
├── Now Playing      (full screen, opens from the mini player)
│   └── Queue        (sheet over Now Playing)
├── Sound            (EQ, loudness, crossfade: a sheet from Now Playing's ··· menu)
└── Settings         (in the shell menu: Settings › Music)
```

Routes: `/music/`, `/music/mixes`, `/music/playlists`, `/music/library/{songs|albums|artists|genres|recent|top}`,
`/music/album/<id>`, `/music/artist/<id>`, `/music/playlist/<id>`, `/music/now`, `/music/search?q=`.
Each route has a stub file at stage time (no SPA fallback on the host).

### 2.2 Opening Music

| Situation | Music opens on |
|---|---|
| Something is playing, or was paused less than 30 minutes ago | Now Playing |
| Otherwise | The tab last used (default Mixes); scroll position restored |
| Opened by a verb (`music.play_playlist`) | Now Playing |
| Opened from a deep link | That route |

**Acceptance:** play a song, go home, open Music from the ring → Now Playing shows within one frame
of the view transition.

### 2.3 Mini player

- Shown at the bottom of every Music and Podcasts screen whenever the engine holds a track. Height
  64 px, 12 px above the safe area, liquid-glass surface, radius 16.
- Contents: 44 px cover, title (Inter 500 15/20, one line, ellipsis), artist (Inter 400 13/18,
  ink-2), play/pause (44 px target), and a 2 px progress line along its top edge.
- Tap → Now Playing. Swipe left/right on it → next/previous. Swipe down → nothing (no accidental
  stops).
- **Not shown on home** **[proposal]**. Home stays one quiet screen (owner ruling). The system media
  notification and the Briefing's "now playing" line cover it there.

### 2.4 Now Playing

Layout on a 390 × 844 viewport, top to bottom:

| Element | Spec |
|---|---|
| Top bar | Collapse chevron (left, 44 px), source label centred ("From *Evening mix*" / "From Albums"), ··· menu (right) |
| Cover | Square, side gutters 24 px, radius 28. No art → a generated gradient from the track id's hash (two OKLCH hues, low chroma), never a stock picture |
| Why chip | Only when the track came from the mind. Under the cover, left aligned (§10.4) |
| Title | Inter 600 22/28, two lines max, then ellipsis |
| Artist · album | Inter 400 15/20, ink-2. Tap artist → artist page |
| Seek bar | The track's waveform (RMS bars from the catalog), played part in accent, rest in ink-3 at 40 %. Plain 4 px line when there is no waveform. Times under it in tabular figures: elapsed left, remaining right (`−1:12`). **Bar rule (the Poweramp reference behaviour):** 100 bars, each the RMS of an equal span of the stored bins; every bar divided by `sqrt(max² + 0.01)`, then raised to the power 1.35. Never draw the stored bytes directly: they are square-root coded (`round(255·sqrt(rms))`) and look flat. A loud, limited master stays fairly even by design; quiet intros and breaks drop. Acceptance: a test renders a fixture with a quiet intro and a break and checks those bars are below 0.7 while the loud sections reach ≥ 0.9. **The bytes:** 1,000 bins of the uploaded Opus file's mean square over all channels, `round(255·ms^(1/4))`, kind `rms`, exactly as [MUSE-WAVEFORMS.md](../../engineering/MUSE-WAVEFORMS.md) hands to Muse (`tests/music-waveform-recipe.test.mjs`); the drawing was checked (2026-11-21) and the fault is in the data |
| Transport | Previous (48 px), Play/Pause (72 px filled circle, ink on day / white on night), Next (48 px) |
| Second row | Shuffle mode (Off / Shuffle / DJ), Heart (rating), Queue, Repeat (Off / All / One) |

Gestures (each has a button too, see [GESTURES](../../design/GESTURES.md)):
- Swipe left/right on the cover → next/previous, with the cover following the finger; commit at
  35 % of width or 0.5 px/ms flick velocity, else spring back.
- Swipe down anywhere above the seek bar → collapse to the screen underneath.
- Long-press the cover or title (500 ms) → "Ask about this" (`th.ask({ref})`).
- Drag on the waveform → scrub. The time label shows the target; audio seeks on release (with
  a 100 ms seek fade). TalkBack users get ±10 s per swipe on the slider.

The ··· menu: Add to playlist · Go to album · Go to artist · Rate… · Keep offline / Remove offline
copy · Sound (EQ) · Sleep timer · Share title (system share sheet, text only).

**Acceptance:** Playwright at 390 × 844: every control has an accessible name; swipe-left on the
cover advances exactly one track; long-press opens home with the track attached.

### 2.5 Queue sheet

- A sheet over Now Playing (slow spatial spring), 90 % height, draggable to dismiss.
- Sections, in order: **Now playing** (one row) · **Next up** (songs the owner queued) ·
  **From *<context>*** (the rest of the album, playlist or mix) · **Suggested** (up to 3 faded rows
  from the mind, §10.4).
- Each row: 48 px cover, title, artist, duration. Drag handle on the right (44 px).
- Reorder by dragging the handle, or with the row's menu: Play next · Move up · Move down · Remove.
- "Clear Next up" button at the head of that section when it has 2+ rows. It asks nothing (undo
  toast for 5 s).

### 2.6 Library

- **Songs:** virtual list, row height 64, A–Z fast-scroll rail on the right edge (letters
  accent-folded; Á is under A; digits and symbols under `#`). Sort: Title (default) · Artist ·
  Album · Recently added · Most played. The sort is remembered.
- **Albums:** two-column grid of covers (radius 16) with title and artist under each. Sort: Title ·
  Artist · Year · Recently added.
- **Artists:** list with a round thumbnail made from the artist's first album cover, and a count
  ("12 songs").
- **Genres:** list from the tags; genre names are taken as tagged, trimmed, case-merged.
- **Recently added:** the 200 newest by `added_at`.
- **Most played:** top 200 by plays (imported plus new).
- Tapping a song plays it in the context of the list it is in (the list becomes the queue context).
- A hold (450 ms) on a song or an entry does what the Select button does: selection mode with that
  row selected, one haptic tick (none with Haptics off, or on a phone that cannot vibrate). It never
  plays the song or opens a menu; a move past the touch slop (8 px, where a scroll starts) cancels it.
  Already selecting, a hold selects the row. (`onItemLongClick` in `frontend/music/src/list/power-list.js`.)

#### 2.6.1 Shelves in the ported player (built 2026-11-21, owner: "Go with all your changes")

The ported player's library lists, in its own row, header, grid and subhead styles
(`frontend/music/src/library/shelves.js`, grouped once per library change in `Library.shelves()`;
the lists in `list/sources.js`):

- **Albums** lists albums only: a release (album tag, keyed as before with `join_albums`) of 3 songs
  or more. Albums by Artist, Album Artists, Genres, Composers, Years and search keep every release.
- **Singles** (new, beside Albums; badge of the category family): the songs of 1–2 song releases and
  the songs with no album, by artist then title. Its header counts them.
- **Artists** lists artists with 5 songs or more or an album of their own (the album's album artist
  is them, split names included); its last row, "All artists (N)", opens every artist as before.
  Each row in Artists and All artists has a second line "N albums · N songs" (the albums holding any
  of their songs, as their page counts them), or "N songs" alone when none (`artistLine2`).
  A search from Artists searches every artist.
- **An album's page:** the cover header names the album, its artist (album artist, else the first
  song's) and "year · N songs · length" (unknown parts left out). Rows: "N. Title" (the
  `track_num_type` setting, when set, numbers as it says), the length in the meta line, and a second
  line only for a song whose artist is not the album's; a row without one takes the zoom level's
  one-line scene at the same height. In disc order (the default sort) an album with several disc
  numbers has a "Disc N" subhead (the search's section row) before each disc.
- **An artist's page:** the header names the artist with "N albums · N songs"; "All Artist Songs"
  stays the first row; then every album holding their songs as covers in the page's grid (its "View
  as" level), newest year first and unknown years last, each with "year · N songs" and never the
  artist; then a "Singles" subhead and their other songs as rows (the All Artist Songs zoom), each
  with its release's name as the second line. A cover opens the whole album's page. The page has no
  sort of its own; header Play and Shuffle play every song of the artist.
- **Possible duplicates** (new, last, shown only when there are any): songs whose title and artist
  are equal once case, spacing and punctuation are left out ("feat.", "(Live)", "Remastered" still
  count as different), wherever they are. Each group is a subhead "title · artist · N" over ordinary
  song rows whose second line is "album · format · bitrate · length". Nothing is merged, hidden or
  deleted.
- Singles and Possible duplicates are on for every saved home layout until unticked in List Options
  (`library_lists` bits 20 and 21; bit 22 marks a layout saved with them).

### 2.7 Detail pages

Album, artist, genre, playlist and mix pages share one layout: a header (cover or gradient, title,
meta line, Play and Shuffle buttons), then the track list. An album lists by disc and track number;
an artist page lists albums (grid) then "All songs".

### 2.8 Visual states of a row

| State | Look |
|---|---|
| Playing | Title in accent text colour; a 3-bar level icon replaces the duration (static under reduced motion) |
| Offline copy present | Small filled-circle-check glyph after the duration |
| Not playable offline (no copy, no network) | Row at 40 % opacity; tap shows "Not on this phone" toast |
| Rated "not for me" (rating 1) | Normal look; never plays on its own: next, previous and the end of a song pass over it in any order, shuffled or not, and the DJ and mixes leave it out. A tap on it plays it; a list of nothing else plays as it is (`stepOver` in `th/music/dj.js`) |

---

## 3. Queue, shuffle and repeat

### 3.1 Queue model

The engine holds one **play order**: `[...history, current, ...nextUp, ...context, ...suggested]`.

| Action | Effect |
|---|---|
| Tap a song in a list | Context = that list; current = the song; Next up is kept |
| Play next | Insert at the end of the Play-next group at the head of Next up (so several "Play next"s play in the order chosen) |
| Add to queue | Append to the end of Next up |
| Next | Advance one step in play order |
| Previous | Position > 3 s → restart the track. Else → the previous track in history |
| Context ends, repeat off | Suggested rows play if the owner has kept "Keep playing" on (default on **[proposal]**); else stop at the end |

### 3.2 Shuffle modes

| Mode | Behaviour |
|---|---|
| Off | Context order |
| Shuffle | Fisher–Yates over the context with the current track kept first. No track repeats until every track in the context has played once. Turning shuffle off returns to context order after the current track |
| DJ | §9. Picks the next track each time from the current one's neighbours, inside the context if the context has ≥ 40 tracks, else across the whole library **[proposal]** |

The shuffle seed is stored with the session, so reopening the app keeps the same order.

### 3.3 Repeat

Off · All (context loops) · One (track loops; Next still moves on; a track that fails with Repeat
One moves to the next track rather than retrying forever).

**Acceptance (unit, `node --test`):** queue operations over a 10-track fixture match a table of
expected play orders for every action above, including "Play next" ×3, previous at 2.9 s and 3.1 s,
shuffle with no repeat across 1,000 seeded runs.

---

## 4. Playlists and mixes

### 4.1 Owner playlists

- Create from: Playlists tab "New playlist" button, any song's "Add to playlist › New playlist", or
  by asking the Thunderhead.
- Default name "Playlist N" (lowest unused N). Rename from the playlist's menu. Names ≤ 100
  characters, trimmed, must not be empty.
- Duplicates allowed (a song can appear twice) **[harvested default]**. Adding a song already in the
  list shows "Already in *Name* · Add anyway".
- Order is manual. Sort views (title, artist, added) are display-only and do not rewrite the order.
- Delete playlist: menu › Delete → confirmation sheet ("Delete *Name*? Its songs stay in your
  library.") → deleted with a 10 s undo toast. The list moves to a 30-day trash on the server
  **[proposal]**.
- Limits: 5,000 tracks per playlist; 500 playlists.

### 4.2 Mixes (mind-built playlists)

A mix is a playlist the Thunderhead built from a **recipe** (a sentence like "calm instrumental for
evening reading, nothing played this month").

| Field | Rule |
|---|---|
| Title | Named by the mind, ≤ 40 characters, shown in Fraunces italic |
| Subtitle | "Built overnight · 24 songs" / "Built just now · 18 songs" |
| Size | 15–60 tracks |
| Why | One line per mix (≤ 120 characters) and one optional line per track (≤ 60 characters) |
| Refresh | `none` (one-off) or `daily` (rebuilt by `mind-night`; the previous version is kept for 7 days in the mix's history) |
| Count | At most 6 active mixes **[proposal]**; a seventh replaces the least played |
| Excluded | Tracks rated 1, tracks skipped under 30 s three or more times in the last 30 days |

Owner actions on a mix: Play · Shuffle · **Keep** (copies it into an owner playlist with the same
name in Inter; the mix itself stays) · **Less like this** (a sense with the recipe; the mix is
removed) · Edit (editing turns it into an owner playlist).

**From the chat (owner ruling 2026-10-27):** "a nostalgic playlist" → the mind builds the mix in the
Music player and sends the owner there to listen (the action chip "Open in Music").

**Acceptance:** a `music.create_playlist` verb with `kind: "mix"` and 20 refs produces a mix that
shows in Mixes within 2 s of the verb being pulled; its Undo in the Ledger removes it.

---

## 5. The engine

Later step (after the as-is port, only if the owner agrees): the engine is the old player's audio
core, moved into `frontend/lib/audio/` with a plain API. It serves Music and Podcasts ([PODCASTS](PODCASTS.md)). Guitar uses its own
low-latency context ([GUITAR](GUITAR.md)).

**[built] The streaming path** ([NEXT-BATCH](../../archive/NEXT-BATCH.md) part 2; `frontend/th/music/stream/`).
**In the player** (`deck.js`, called from `player.js` `assign`): each of the player's two decks plays
its song through its own feed, so cross-fades, gapless joins, the lock screen, AirPods and the playback
log work as before. A song streams when it is Opus from the network with a catalog length, not a CUE
part or a video, and the browser has MediaSource with Opus in WebM (Chrome and Android; **not iPhone
Safari**, which has only ManagedMediaSource: there songs play from the plain element as before). The
song starts at the element's time 0, so the player's position, seeks and end are the song's; its length
is the catalog's from the start. A deck not yet played (`preload` none) fetches nothing until its first
play. A seek outside the buffer goes to the feed. A song whose stream gives up plays on from the plain
element where it was, and from the element for the rest of the session (`noStream`); a preloaded one
loads that way when its turn comes. Switched off on one phone with `localStorage['th.music.stream'] =
'off'`. Tested in `tests/music-stream-player-browser.test.mjs` (also: no byte of the playing song
fetched twice). The feed itself can play a whole queue on one element (the lab uses that). Each song's Ogg Opus file is read in Range requests of 32–128 KB on its signed link
(`track.js`). Its pages are demuxed as they arrive (`ogg.js`: the capture pattern and CRC of every
page are checked) and the same Opus packets are written as WebM (`webm.js`). Nothing is re-encoded and
nothing changes in the bucket. At most 60 s is appended ahead of the play position (the owner,
2026-11-01; it was 15 s, which a tunnel or a switch between Wi-Fi and mobile data outlasted): fetching
stops at the cap and starts again under 30 s, so the refill comes in bursts and the radio rests between
them, and what lies more than 10 s behind is removed (`plan.js`). The
next song joins at the exact sample where the last one ended. Its pre-skip is trimmed by
`appendWindowStart`, the last song's end padding by `appendWindowEnd`, and the init segment's OpusHead
says pre-skip 0. Chromium's decoder drops a head's pre-skip itself only when the head changes, so a
join would otherwise lose 6.5 ms whenever the next song's head differs. Measured in Chromium: the
fixture played twice sounds 0.1 ms short of back to back, with no phase step at the join. A seek past
the buffer bisects the file on granule positions (a few Range requests); a seek inside the buffer is
instant. `skip()` jumps straight to a next song already joined, else starts it from its first byte.
**Fallback:** anything the path can't get past (no MSE or Opus in WebM, a corrupt page, a refused or
missing file after one fresh link, the network failing after four tries, a decode error) raises
`fallback` with a reason code, where playback is and which song failed, and the player plays on from
there on today's plain element path. Its events and methods are listed at the top of `feed.js`; the
lab page `/lab/stream/` (not linked) shows the buffer, the cap and the gap at each join.

### 5.1 API

```js
audio.load(program, queue, index, {positionMs})   // program: 'music' | 'podcast'
audio.play() / audio.pause() / audio.toggle()
audio.next() / audio.previous() / audio.seek(ms) / audio.skipBy(ms)
audio.setQueue(ops)            // insert / move / remove; returns the new play order
audio.setRate(r)               // podcasts; music stays at 1.0
audio.setSound({eq, preampDb, loudness, crossfade})
audio.state()                  // {program, track, positionMs, durationMs, playing, buffering}
audio.on('track' | 'state' | 'position' | 'error' | 'ended', fn) → off()
audio.pauseFor(reason)         // 'guitar' | 'video' | 'call'; never auto-resumes after 'video'
```

### 5.2 Graph

```
deck A (<audio>) ─┐
                  ├─ AudioWorklet "th-engine": fades · gapless splice · EQ cascade · tone · limiter ─ destination
deck B (<audio>) ─┘
```

- `AudioContext({latencyHint: 'playback', sampleRate: 48000})`. The library is 48 kHz Opus, so
  normal tracks reach the engine unresampled.
- Decks use `crossOrigin = 'anonymous'`. A cross-origin deck without CORS would make the worklet
  output silence, so R2 CORS must allow the site origin (§6.4).
- Before the worklet has loaded, decks play straight to the output with fades on element volume, so
  an early Play is never silent. The worklet takes over at the first moment nothing is sounding.
- No AudioWorklet, or the worklet dies → plain gain path, no EQ; the playback log says so.
- After 30 s paused, the context suspends (no 20 ms wake-ups in a pocket). Play resumes it; the
  fade-in waits for sound.

### 5.3 Measured behaviours to keep

All values are the old engine's measured defaults unless marked.

| Behaviour | Spec | Acceptance (lab = OfflineAudioContext harness ported from the old audio lab) |
|---|---|---|
| Gapless join | Ring buffer per deck, mix point 320 frames behind the newest frame. The next track starts 0.5 s early, held silent. Join on the frame after the outgoing track's last frame (128 frames of true silence = end). Leading silence under 150 ms is start jitter; trailing silence plays out except the last 120 ms. Give up if the end does not arrive within 2.5 s | Lab: two halves of a continuous tone join with 0 ms gap, click ≤ −80 dBFS. Chrome: 48 kHz WAV fixtures join with no gap |
| Resampled joins (44.1 kHz files) | Overlap the ringing edges by their modelled length; search ±6 frames for the least bend | Chrome: audible error at the join ≤ −29 dBFS |
| Manual skip | 400 ms equal-power crossfade. The old track waits at most 500 ms for the new one's first sound, then fades out regardless, and plays on silent until the new one sounds (at most 12 s), so Android keeps the media session and the headset buttons. The same holds for a stream reloaded after a stall (it reloads on the idle deck) | Lab: no click above −80 dBFS; outgoing still at about −3 dB at the midpoint with a 300 ms network |
| Next pressed twice quickly | The second pick takes the idle deck; the first old track plays on until the newest sounds | Lab: two presses 150 ms apart, no click above −80 dBFS |
| Play/pause fades | 400 ms S-curve; fades under 50 ms use an S-curve; with fades off, 8 ms de-click fades | Lab: pause, play 5 ms later, no click above −80 dBFS |
| Seek fade | 100 ms; the fade-in starts when the sound returns | Lab: seek on a 250 ms stream, no click above −80 dBFS |
| Automatic crossfade | Off by default (gapless). When on: equal power, length 1–12 s (default 5 s), starts when the incoming track sounds | Lab: incoming −3 dB at the midpoint (±0.5 dB) |
| Keep albums gapless | When crossfade is on, consecutive tracks of the same album (same disc, track n → n+1) still join gapless. Default on | Unit: `gaplessPair` table |
| Pause during a crossfade | Fades the outgoing deck instead of cutting it | Lab: ≤ −80 dBFS |
| Preload | The next track loads on the idle deck 30 s before the current one ends; reloads when "what's next" changes | Chrome: track end to next start 0 ms (gapless) |
| System pause | A call, unplugged headphones or the notification's pause: the engine follows; held audio fades in 8 ms; a system resume fades in | Device checklist |
| Play refused (no user gesture) | Player stays paused; never shows "playing" in silence | Browser test with autoplay blocked |
| Played threshold | A play counts once 50 % of the track has sounded, or 4 minutes **[proposal for the 4-minute rule]**, or the track ended | Unit |

### 5.4 Song heads

- When a song starts sounding, the next 3 songs in play order fetch their first 15 s (at the file's
  average bitrate, plus 64 KB for tags) and, for Ogg/Opus files the plain element will play, their
  last 128 KB (Chrome reads the end for the length; a streamed song needs no tail). About 0.3 MB per
  song.
- A song that starts streaming while its own head downloads (the one the app opened on) waits up to
  1.2 s for it, so the feed's first reads come from the phone instead of fetching those bytes twice;
  a stall or hold never stops that download (`heads.settle`, `hold(on, playing)`).
- They download one at a time, low priority, starting 1.5 s after the current song sounds and once
  it has 10 s buffered. They pause while the current song is rebuffering.
- Only the heads of the next 3 songs are kept; others are deleted when the order changes.
- The service worker answers a song's range requests that a head or tail covers; everything else
  goes to the network untouched. Heads are keyed by `music:<id>` plus byte range, **not** by the
  signed URL, so re-signing never orphans them.
- Opening the app (PERFORMANCE.md §3.1, "Opening on a weak link"): each open, the service worker asks
  the network for the site's `/release.json`, and the page itself comes from the network as before. The
  app's other files and the site's shared scripts it loads (`th/`, `assets/`, `ui/`, `config.js`) then come
  from `claude-player-release`, which holds exactly that release's files (`th/music/release.js`), with no
  round trip each to ask whether they changed (a warm open on a weak link went from 4.4 s to 1.2–1.5 s, 151 requests to 6: PERFORMANCE.md §3.1). A new
  release empties it, so the release takes over on the next open; a file is kept only if its release is still
  the live one when it arrives, and the cache starts again after 7 days at the latest; no answer from `/release.json`, a cache
  error or no signal leaves the worker's earlier way (network first, then its offline copies). Repair clears it.
- While audio plays, the page pings the service worker every 20 s so it is awake for the next skip
  (waking it costs about 1 s).
- Data saver (the app's own switch or the browser's): only the next song's head.
- Opening the app: if the last song was left within its first 12 s and its head is missing, fetch
  that head only. Nothing else downloads until something plays.

**Acceptance:** Chrome with a 1.5 s-latency network fixture: skip to a song with a head → first
sound ≤ 200 ms; with Data saver on, exactly one head request per song change.

### 5.5 EQ, tone and limiter

All inside the worklet, as one biquad cascade in double precision; every parameter glides
(gain in dB, frequency and Q logarithmic), so no change ever clicks.

| Control | Range | Default |
|---|---|---|
| EQ | On/off | Off |
| Graphic EQ | 10 bands at 31, 62, 125, 250, 500 Hz, 1, 2, 4, 8, 16 kHz; ±12 dB, 0.5 dB steps | Flat |
| Preamp | −12 to +6 dB | 0 dB |
| Bass / Treble | Low shelf 100 Hz / high shelf 10 kHz, ±12 dB | 0 |
| Limiter | True-peak, −1 dBTP ceiling, 4× oversampled detector, 2 ms lookahead, 15 ms hold, 120 ms release, no makeup gain, constant 103-frame latency | Always on (no switch) **[proposal: the old engine had a switch; with hot masters "off" means clipping]** |

**Clipping and headroom** (2026-11-21; the owner's report: `clippedSamples: 196778`, `inputPeakDb: 3.4`,
limiter off, preamp 0, EQ and tone on, one song clipping for 100 s; the owner: "the best audio quality
possible"). Measured first, in the code: `inputPeakDb` is the output stage's input, after preamp,
equaliser, tone, width and volume (the limiter's meter in `limiter.js`), not the decoded song, and
`clippedSamples` are the hard clamps at full scale at the very end. So the report could not tell where
the overs came from; the log now says (`level` in **Copy report**, `frontend/music/src/player/playback-log.js`):
`decodedPeakDb` and `decodedOvers` (the songs' own audio before any gain, metered in `cp-eq`),
`clippedAt` (`input` when decoded audio was over full scale, else `chain`), `chainBoostDb` (the most the
equaliser, tone, preamp and the later stages add, at their loudest frequency), `headroomDb`/`headroomMaxDb`,
`inputTrimMaxDb` and `safetyNetMaxDb`. (They are in **Copy report**; the batch sent to the Worker keeps
only the contract's `PLAYBACK_STATE` fields, which do not list them yet.) Then, with float all the way
and no resampling added:
- **Automatic headroom** (`frontend/music/src/dsp/headroom.js`, Settings › Equalizer › Automatic headroom,
  on by default, `cp_auto_headroom`): the gain before the equaliser goes down by the peak of the
  equaliser's, tone's and preamp's combined magnitude response (per channel, at DC and on a 1024-point log
  grid from 1 Hz, the lowest a band can take, refined around its top and at every band's frequency) plus
  every stage after the equaliser that can raise the level (`laterGainDb`; checked: the stereo matrix,
  whose Stereo X adds up to +6 dB on a side-only signal while mono and balance add none; the reverb's
  return, dry plus its wet send times the impulse's broadband gain, a typical figure rather than a worst
  case; the master volume; the limiter and ReplayGain add nothing after the equaliser). It never lets the
  gain overshoot during a change (`engine-worklet.js`): when the boost rises the headroom goes down first
  (about 50 ms) and the new bands follow; when it falls the bands change first and the headroom comes back
  once they have settled. With the settings flat it is 0 dB and the chain is bit-exact. A sine never comes
  out louder than it went in; other signals can still overshoot a little (a filter's time response).
- **Songs over full scale** (`frontend/music/src/dsp/trim.js`): a song's input trim is set only at its start
  and never changes inside it. Tagged songs (ReplayGain peaks) take the album's peak when played in album
  order (the next track of the album, or the first of its next disc), so a gapless album never steps
  between songs; otherwise the track's peak. Untagged: a song that goes over is caught by the safety net,
  and the trim its decoded peak calls for applies from the next song of that album in album order, then
  carries on through the album (taking a larger trim if a later song needs it, never a smaller one) until
  a change out of album order or to another album. Chosen over a mid-song drop of 2–3 dB, which is itself
  audible. Never a gain up. Each song's own decoded peak, measured while it plays, is kept on the phone with
  its plays (`decodedPeak`, the larger of the kept and the measured one; `Library.notePeak`, saved at most
  every 2 s) and trims that song from its next start on, wherever it is played (with the album's carry the
  smaller trim wins; the album rule is unchanged). The first play of an untagged song still meets the net:
  a true peak computed at upload (by Muse, `metadata.audioAnalysis.truePeakDbtp`, which the catalog writer
  already takes; requested in `docs/engineering/MUSE-WAVEFORMS.md` §6a) would make it right from the first
  play once the phone reads it.
- **The safety net**: with the Limiter switch off the limiter acts only on samples over full scale (held
  just under it, letting go in 10 ms) and passes every other sample exactly, with no gain change, so a
  master peaking at −0.1 dBFS comes out bit for bit; it replaces the hard clip at full scale. With the
  switch on it is the owner's −1 dBTP true-peak limiter as before. In the tests' material it engaged only
  on the deliberate overs (+3 and +3.4 dBFS); a +12 dB band stepped up and down on a −0.09 dBFS sine made
  no limiter action.
Guards: `tests/music-headroom.test.mjs` (the headroom equals the response's peak for four settings,
against a 200,000-point sweep; from 1 Hz and DC; the later stages counted; the net transparent below full
scale and exact again after an over), `tests/music-trim.test.mjs` (album order, tagged and untagged
trims) and `tests/music-headroom-browser.test.mjs` (the engine in an OfflineAudioContext: a +6 dB boost of
a full-scale signal has no sample over full scale, its shape within 0.05 dB of the filter's response;
flat, a −0.1 dBFS signal comes out as it went in, delayed; a +12 dB step up and down makes no limiter action).

**Presets** are our own, written fresh **[proposal]**: Flat · More bass (+5 dB at 62 Hz, +3 at
125 Hz) · Clear voices (+3 dB at 2 kHz, +2 at 4 kHz, −2 at 250 Hz) · Bright (+3 dB at 8 and
16 kHz) · Late night (−3 dB below 125 Hz, −2 above 8 kHz, preamp −2 dB) · Small speaker (−6 dB at
31 Hz, −3 at 62 Hz, +2 at 2 kHz). Owner presets: save the current curve under a name (≤ 30
characters, up to 20 presets).

**Headphone correction [proposal]:** profiles from the public AutoEq project (code MIT) only after
the data terms of each measurement source are checked (§17). Never from the old APK-extracted
database.

Sound settings are per output **[proposal]**: the engine keys them by
`AudioContext.sinkId`/output label where the browser exposes it, else one global set.

### 5.6 Loudness

- An Actions job measures each track once (pyloudnorm, BS.1770): integrated LUFS, true peak, and
  album loudness. Results land in the catalog as `loudness_lufs`, `true_peak_dbtp`,
  `album_lufs` (see [JOBS](../../engineering/JOBS.md)).
- Modes: **Off** · **Track** · **Album** · **Smart** (Album when playing an album in order, Track
  otherwise). Default **Smart**, target **−14 LUFS** **[proposal]**.
- Gain = target − measured, capped at +6 dB; the limiter catches peaks. A track with no measurement
  gets 0 dB.
- Old ReplayGain tags in the catalog are used only when no measurement exists.
- Changes apply to the playing track at once with a 200 ms glide.

**Acceptance:** lab: two fixtures at −8 and −18 LUFS play within ±0.5 LU of −14 LUFS in Track
mode; nothing exceeds −1 dBTP in any scenario (hot master + More bass + preamp +6 dB).

### 5.7 Background playback, Media Session and the lock screen

- The engine owns `navigator.mediaSession`. On every track change it sets `MediaMetadata` (title,
  artist, album, artwork at 96, 256 and 512 px from signed art URLs) and `setPositionState`
  (duration, rate, position) on play, pause, seek and rate change.
- Action handlers for Music: `play`, `pause`, `previoustrack` (same 3 s rule as §3.1), `nexttrack`,
  `seekto`, `stop` (pause and release the decks). `seekbackward`/`seekforward` are not set for
  Music so Android shows previous/next buttons.
- `playbackState` mirrors the engine: playing with nothing sounding for 12 s (a stall, a slow
  start), it reads paused until the sound returns.
- Hidden page: playback, track changes and heads go on; visual timers (clock, seek bar, marquee,
  edge light) stop; on return they catch up at once. The seek bar redraws only when progress moves
  a CSS pixel.
- Screen wake lock is never used by Music.

**Acceptance:** device soak (installed app, screen locked, Samsung battery setting "Optimised"):
30 minutes of continuous playback across ≥ 8 track changes with the EQ on; no stops, every join
gapless, notification controls work, `playbackStats` underruns = 0. This is test #4 in §17 and must
pass before this engine replaces the ported player.

### 5.8 Audio focus between apps

| Event | Music |
|---|---|
| A podcast starts | Music pauses (podcast and music never sound together) |
| Guitar playback, count-in or ears start | Music pauses; it does not resume by itself |
| Video starts in Astra or My Media | Music pauses; no auto-resume |
| Voice input on home (mic) | Music ducks to −12 dB while the mic is open, restores over 300 ms **[proposal]** |
| Thunderhead speaks aloud (future) | Duck to −12 dB, restore after |

### 5.9 Sleep timer

15 · 30 · 45 · 60 · 90 minutes · End of this track. The last 10 s fade out **[proposal]**, then
pause. A label on Now Playing shows the time left. Cancel from the same menu.

### 5.10 Playback log

Settings › Music › Playback log (or `?diag`): output rate and latency, dropouts
(`AudioContext.playbackStats`), limiter reduction, clipped samples caught, rebuffers, stalls,
recent errors, offline copies, heads. **Copy report** puts it on the clipboard as JSON. The report
holds no titles **[proposal]**: tracks appear as ids, so a report can be pasted into a public issue.

**Sent to the Worker** (NEXT-BATCH.md part 1; `frontend/th/music/report.js`, loaded by `th/music/dj.js`
`installDj`, which the player runs at start, so no ported file changes). Signed in on this site and in
a top-level page only, what the Worker hasn't taken from the log yet goes to `POST /v1/ops/reports`
([API.md §11.16](../../engineering/API.md#1116-ops)) as one batch: once a minute while music plays,
once when the page is hidden, nothing when nothing is new, and never while a batch is on its way.
After no answer in 15 s, a 408, 429 or 5xx the same events go again later (a minute, then 2, 4 … 30,
or the Worker's Retry-After); after a 401 or 403 nothing goes until the session changes. The Worker
keeps each batch as one row for 30 days, and the mind reads them with `th reports`, which counts an
event sent twice once. A batch (`frontend/th/music/report-batch.js`, at most 30 KB):

| Field | What |
|---|---|
| `v`, `page`, `seq`, `why` | Version 1; a random id for this page load (16 hex digits); the batch's number in it; `minute` or `hidden` |
| `build`, `t0` | The site build; when the log began (ms), so an event's `t` (ms since then) is a time |
| `lost`, `dropped` | Whether the log (300 events) let some go before a batch took them; how many old ones were left out to stay under 30 KB |
| `events` | The log's events the Worker hasn't taken, oldest first, each with its number in this page load (`n`), its time (`t`) and its type's own fields only: deck events (`loadstart` with where it played from, `playing`, `waiting` and `stalled` with the position, `error` with its kind and code), `first sound`, the recoveries (`stall`, `reload`, `recovered`, `skip`), `underrun`, `clipped`, `long task`, `hidden`/`visible`, `track` (id, format, bitrate, rate, channels, source), `play`/`pause` |
| `state` | The log's counters (the snapshot that **Copy report** copies), without its events and the browser's name: output, dropouts, level and limiter, each deck's waits, stalls, errors and start times, recovery, offline copies, long tasks, time hidden |

**Movement and layout** (`frontend/music/src/ui/feel-log.js`, modelled on Astra's feel log): **Copy
report** also carries `movement`, kept in memory with a cap on each list and never sent to the Worker:
every view transition (its scene or page names, ms, frames, worst gap between frames; frames are
counted only while one runs; and what ran during it, `frontend/music/src/ui/frame-work.js`: `relayouts`,
the whole-page layouts done at once, `resizes`, the window's and visual viewport's resizes such as the
keyboard's steps, `songAt`, when a song change or play/pause began, and `longTasks`, `longMs`, `longAt`,
the main thread's tasks of 50 ms or more that began in it); every open of the player (`innerHeight`, `visualViewport.height`, whether
a text field had focus in the last second, the layout's height, the player's box height); after each
song change and play/pause, once the scene changes have settled (600 ms at least), the play and pause
buttons (in the page, visible, box size), and in `playPauseMissing` each time neither shows at full
size (52 px or more) in a player scene that has them, with the scene names; and each search (viewport
before and after the keyboard, read in the frame of each change after its layout, with home's window
height when Music is in home's frame, the large-viewport height and the bottom inset; the results
list's height; scroll jumps over 40 px no finger or fling made, with the list's height, its scroll
limit and whether its results had just changed); and in `iconsMissing`, 600 ms after each change of
screen has settled, the navbar's icons and the A–Z bar that the views show but the page does not paint
(`frontend/music/src/ui/icon-check.js`: what hides it, display, visibility, content-visibility or opacity of it
or an element above; its box; its drawn marks; masked shapes whose mask id resolves elsewhere; the bar's
alpha), with the scene, the transitions still marked as moving and the work waiting for them. Numbers and
layout names only: no titles, artists, file names or search text.

**Library** (`frontend/music/src/ui/library-report.js`, loaded and computed only when **Copy report** is
tapped, never at start or while playing; never sent to the Worker): **Copy report** also carries
`library`, the library's shape as counts, sizes and percentages, to check its tags without reading it.
`filled`/`filledPct`: songs with each field (album, albumArtist and how many differ from the artist,
artist, year, track and disc number, genre, composer, length, cover and covers only in the file,
waveform, rating, plays); `notCarried`: a field no song has at all. `albums` (the album list's groups):
count, the unknown row, by size (1, 2–4, 5–9, 10+), with several artists, no year, mixed years,
complete track numbers (1..n on each disc), with a cover. `artists` (the artist list's groups): count,
by songs (1, 2–4, 5+) and albums (0, 1, 2+), names that differ only by case, spacing or "feat."/"&"
forms (`likelySplit`). `duplicates`: same title and artist, case and punctuation left out.
`placeholders`: empty or "unknown"/"untitled" titles, artists, albums; titles like a file name
(extension, "Track 01") or the file name itself. `shelves` (2026-11-21, the rows the new shelves build,
`frontend/music/src/library/shelves.js`, `list/sources.js`): albums (releases of 3 songs or more) and
their songs, singles, listed artists and all artists, possible duplicates (groups, songs). `screens`:
per shelf screen (Albums, Singles, Artists, All artists, Possible duplicates, an album's page, an
artist's page's albums and other songs) the screens, rows, rows with a second line, blank, unknown and
the same as the row above, each second line built as that screen builds it with the settings in effect
(before, it copied the old screens' rule). `playlists`: count and sizes (min, median, max). Never a title, artist, album, genre, file name
or id.

**The keyboard over Music in home** (2026-11-21, the owner's phone: every search open went innerH 731 →
759 → 424, `resizes: 4` in `scene_search>scene_playing`). Home asks for `resizes-content` (its chat's
composer rides the keyboard); while an app's frame is in front it now asks for `resizes-visual`, as
`/music` does, and its own ask comes back when the app goes into the island, closes or is parked
(`frontend/th/island/island.js` `keyboardOverApp`). The frame keeps its size, so no resize reaches
Music. With a field focused Music lays out at the space above the keyboard, read from the top page's
visual viewport (home's in the frame, its own at `/music`: `frontend/music/src/ui/viewport-top.js`),
so the search list ends above the keyboard; the search recorder also notes home's `homeVvH`. Guard:
`tests/music-frame-keyboard-browser.test.mjs` (the keyboard played as Chrome applies home's ask). On the
phone, check that Chrome takes the changed ask while the page is open (it reads the viewport tag again
when it changes; if it did not, the recorder would still show `resizes` in search).

**The bar around the keyboard** (the fourth report: home's window still went 731 ↔ 759 at every keyboard
open and close, Chrome's bar hiding while the keyboard is up, and `resizes: 2` in
`top_container:scene_search>scene_playing`, 16 frames against 42 without). Reproduced in the browser test:
the frame, `inset: 0` in its shell, took 759 the moment home did. Now, while an app's frame is in front,
the frame has a fixed height in px from the settled window (`frontend/th/island/hold-height.js`): it moves
only on a new width (orientation) or a height that lasts 300 ms with no keyboard over home (home's visual
viewport more than 150 px under its window); the shell's black fills the rest. Coming to the front with the keyboard up, it takes the height settled last in this orientation (by the window's width), never the other orientation's (`frontHeight`). Back in the island, closed
or parked, the frame takes its shell's height again. Guard: the same test file (731 → 759 → 731 around a
keyboard: no resize in Music's window; a lasting 759 with no keyboard moves the frame).

**Layout height and the keyboard** (`frontend/music/src/ui/layout-height.js`): at `/music` the keyboard
does not resize the page. In home's frame it did (home asked for `resizes-content`), so Music lays out
at: the window's height while a field has focus, never above the full height (a 731 → 759 → 424 opening
is one relayout); the full height at once when the field lets go (leaving search blurs it), while the
keyboard closes (1 s at most); the window's height otherwise. A height above the full height while the
keyboard closes (home's own viewport read 759 for a moment while it moved, where the screen is 731) is
taken only when it lasts: still there 300 ms after the closing time, read again then. Before, it was taken
at once and became the full height: the player once laid out at 759. A resize is laid out in its own frame.

**Time to first sound** is its own event, `first sound` with the track id and `ms`: from the play asked
for (a new song while playing, or Play) to the first `playing` of the deck that plays it. Not timed: a
song the engine joins gaplessly to the one before (it is already sounding).

Only known fields go: each event type's own (`PLAYBACK_EVENTS` in `shared/contract/reports.ts`; the
phone's copy is `th/music/report-fields.js`) and the counters' (`PLAYBACK_STATE`); any other field is
dropped, on the phone and again on the Worker, and an event of a type not listed goes as `other`. So
never: titles, artists, albums, composers, genres, file names or paths, searches, the browser's name.
A text (a browser's or the engine's own message) keeps of an address only its host, loses quoted
text, and is at most 160 characters.

---

### 5.11 Transitions at the screen's rate

The owner agreed (2026-11-21) to rebuild the engine's frame work for the transitions into and out of the
player, the art and search: the same motion, durations and end states, pixel for pixel at rest. Lists and
menus keep what they did (a row's own scenes and the list's level and zoom changes are theirs).

- **Nothing is built inside a transition** (`frontend/music/src/view/prebuild.js`). In idle time after start, one screen per
  idle period and never while a transition moves, the player screen's likely next scenes (player, library,
  search, equaliser) are built: their layouts are inflated, the views they show are laid out at their size
  there and written while hidden, laid out once by the browser and kept so while gone
  (`content-visibility: hidden` instead of `display: none`), and their art decoded. A scene not built by
  then is built in the scene change itself, before its first frame; the animation's clock starts at that
  frame, so it starts later and does not jump. Since 2026-11-21 (the phone: `page:aa>list` 47 fps,
  `top_container:scene_playing>scene_lib` 42 fps): the library's start rows are built too, bound, laid out
  and written hidden while the art shows (`list-widget.js` `prepareLibrary`, the way `prepareTrackList`
  builds the playing track's list), and the first trip to the library (the navbar's Library button
  included) shows those rows; rows now have their own icon mask ids, so a hidden row's mask never hides a
  shown one. Not when a start category is set (its second level has its own history entry). The
  navbar's lines scene (`scene_navbar_3lines`, its seekbar and mini player) is built the same way: its
  change runs in the same frames as the library's, whose first frame carried the rows. The builds wait
  for real idle time (no deadline: each is one long task on a slow phone). In the lab at 4x CPU slowdown
  the first player → library change's worst gap went from 117 ms to 33 ms (one run each; diagnostics).
  Guard: `tests/music-prebuild-browser.test.mjs`. Not done: a cache of target frames per scene pair.
- **Start-up** (the phone: four long tasks of 240–459 ms in the first 2.2 s). The recorder now names them:
  `startup` in **Movement and layout** gives each boot step's end (`modules`, `boot`, `model`, `theme`,
  `inflate`, `library`, `restore`, `ready`, `firstFrame`, `firstTap`; `frontend/music/src/ui/startup.js`)
  and each long task of the first 10 s with the step it began in. In the lab (4x CPU, demo songs) they are:
  the model's parse, the resources, the theme and the main layout's inflation in one task (284 ms); the
  library's open (110–190 ms); the first layout and frame (130 ms); then the idle builds above. The lyrics
  page, built at start inside the main layout before, is now built the first time lyrics show
  (`list-widget.js` `lyricsPage`): the first task fell to 205–232 ms. The rest is needed for the first screen.
- **Idle work** (the fourth report: 63 long tasks, 6,281 ms in 198 s, against 25 and 2,980 ms before the
  release that added work in idle time; `longTasks: 1, longMs: 54–64` inside `page:list>aa`,
  `scene_lib>scene_eq`, `page:aa>list`). Lab: the real page against a mock Worker with an invented library
  of 12,800 songs, Long Animation Frames naming the scripts. After start-up, before: 4x six long tasks
  (882 ms), 6x seven (1,395 ms); all but the list openings were idle work, in one burst 1.2–3.2 s after the
  library opened, when the first taps come: the playing track's list built hidden (`prepareTrackList`,
  498 ms at 4x, 783 at 6x), two screens built ahead (114 and 62 ms; 183 and 96), two category views (52–77
  ms). The long tasks inside transitions were their own frames (`FrameRequestCallback` in `context.js`) and
  a list's opening, 50–88 ms at 6x, not idle work. Signing ahead made none: its per-row work is the row's
  own song (`tracksAt` of one row; group rows are passed before), no scan of the library. Now every idle
  job is a list of pieces (`frontend/music/src/view/idle-work.js`: the screens built ahead, the category
  views, the playing track's list, spare rows): none starts within 300 ms of an input (touch, key, wheel)
  or while a transition, a pending layout or a scroll runs; pieces run back to back only within 8 ms and
  then yield; a job waits again as soon as one of those begins. Jobs go in order between pieces: the playing track's list (one piece, ahead of the screens as before, so the library's start rows built with them stay the list shown), the screens built ahead (the next transition needs them), the category views, the spare rows last (one queue in arrival order left the screens behind 50 spare rows for 15 s in the demo). Not done: pieces under 8 ms. A piece is one
  screen's layout, one grouping pass over the library or one list's build, and in the lab still took
  128–181 ms (screens), 51–61 ms (groups) and 79–162 ms (the track list) at 4x–6x; cutting them needs
  those builders made resumable. The recorder names them: `longWork` in **Movement and layout** lists each
  long task after start-up (10 s) with `what` ran in it (`idle:<job>`, else the handler and file the browser
  names, else `unnamed`) and each idle job's `longestPiece`; a transition's longest task gets `longWhat`
  (`frontend/music/src/ui/long-work.js`). Guard: `tests/music-idle-work.test.mjs`.
- **Five seconds before any code ran** (the fourth report: `modules 5,067 ms`, first frame 6,387). `modules` is
  marked when the first module runs, which is only once the whole static graph is loaded: 106 files,
  1.5 MB, three levels deep from `src/app.js`. Music's worker served them network first, so every launch
  asked for each one again (the site sends no Cache-Control; Azure's Last-Modified gives the browser's cache
  little freshness, none just after a release), over HTTP/1.1's six connections at 300 ms each. Lab (the
  real page and worker against a site that answers like Azure, a mock Worker, one 1.35 Mbps link with
  300 ms per request, cache warm, worker started afresh): 69–104 requests and 0.9–1.1 MB before `modules`.
  Home's ring frame is created at home's idle (`th/island/warm.js`, signed in, no Data Saver) and the
  worker controls it; the cost was the requests. Not fixed: a worker that served a release kept whole
  first cut `modules` to about 0.7 s in the lab (4x), but a second reading found it could leave a phone on
  an old release or mix two releases' modules; it was taken out. A safe one needs the build to write
  Music's file list (as `precache.json` is written for the shell), a cache per release pinned per page,
  and a way out through the kill switch. Until then the worker is network first, as before.
- **A transition frame writes only what moved** (`frontend/music/src/view/motion.js`). While a scene transition of the player's
  screens or a page transition of the list widget moves, a frame writes the views changed since the last one
  (`Context.dirty`: anything invalidated, and any change of visibility), not the whole tree; a view shown
  again after `display: none` writes its subtree; the frame after the last transition writes the whole tree.
  A view marked stays marked until a write reaches it: one changed under a gone view, or while out of the
  tree for a moment, is written once it is reached again (before, it was dropped until the transition ended).
- **The first frame is cheap** (`frontend/music/src/view/scene-layout.js`). Scene prepare measures only the participants whose
  scene parameters change and the views above them; every other view keeps its measure (Android's measure
  cache). Before, prepare, the restore to the start frames and the end each forced a measure of the whole
  tree. Not done: a cache of target frames per scene pair; the targeted pass already measures only what the
  scene changes, and a cache could not tell when anything else in the tree changed.
- **Other work waits** (`whenStill`): the waveform's next step, the blurred art of a new song, the Queue
  list's rebuild, the playing track's list built ahead and the saved session run once no transition moves,
  in a task after the next frame. Leaving the page still saves at once. When a second transition starts
  before the waiting work ran, the work waits for it too, and work asked for again meanwhile runs as last
  asked (before, the older request took the newer one's place).

**Turning back** (`frontend/music/src/view/scene.js`): a scene change turned back mid-way (play then pause
before the change ends) goes back over at most the time it took to get there, never longer than the whole
change, and at once when it had not moved yet. Before, it took the share of the whole time that was left
of the way, which on a decelerating curve is longer than the way there: taps 150–500 ms apart kept the
change moving for 1.4 s (a 321 ms change). The guard is in `tests/music-feel-layout.test.mjs` (taps at 0,
193, 381, 548, 716, 880 and 995 ms).

**Search to the player and back** (the owner's phone, 2026-11-21: `scene_search>scene_playing` 24 fps
with a 208 ms gap over 4 runs, the way back 23 fps and 126 ms, everything else 50–89 fps). Not found in
the demo songs: there, at 4x CPU slowdown with the window resized as a keyboard would, the change runs
with no gap over 50 ms. The tap's own task carries the song's start, the field let go and its relayout
(one) and the scene's prepare, all before the change's clock starts; what fills a gap after it on the
phone (the keyboard's steps, the song's start work, the browser's own long tasks) is what the recorder
now notes per transition (above). No change was made without it.

**Icons that disappeared** (the owner, 2026-11-21, after the release above: "the nav bar icons and the
library sections symbols … the A–Z scroll bar … entirely disappears"). Found: the round symbols (the
library's sections, the micro category icons, the equaliser's knob) cut their glyph out with an SVG mask,
and every copy of a symbol used the same mask id. A `url(#id)` resolves to the first element with that id
in the page, and with screens and rows built ahead that one could sit in a hidden copy (`display: none`
or `content-visibility: hidden`), where a mask draws nothing: the shown symbol lost its glyph. Each copy
now has its own ids (`frontend/music/src/icons.js` `iconSvg`). Not found in the demo songs: a cause for the
navbar's icons or the A–Z bar (after random runs of 40 quick changes of screen, play and pause at 4x CPU
slowdown, the page at rest equals a whole-tree write, no transition stays marked as moving and no work
stays waiting); the recorder now notes it (`iconsMissing` under **Movement and layout**, below). The guard
is `tests/music-icons-browser.test.mjs`: after the screens were built ahead and opened, a transition turned
back and interrupted, and rapid changes of screen, every navbar icon, shown section symbol and the A–Z bar
is painted (its pixels change when its marks are hidden) and drawn as defined (a symbol looks the same with
its mask given an id nothing else has).

The guard is `tests/music-transitions-browser.test.mjs`: each named transition at 4x CPU slowdown, its
frames recorded in the page (a gap over 50 ms is reported, enforced with `TH_STRICT_TIMING=1`), and its end
state's boxes equal to those the code drew before (`tests/fixtures/music-transition-boxes.json`, taken with
Playwright's Chromium; text widths move by a pixel on other Chromium builds, so a Playwright upgrade takes
them again with `TH_CAPTURE_BOXES=<file>` after checking the look by eye).

## 6. Media URLs and failures

### 6.1 Signing

- `POST /v1/media/sign {refs: [...]}` with up to 50 refs. Each URL has `X-Amz-Date` floored to
  the hour and a 3 h expiry, so it is valid for at least 2 h when received.
- The phone signs: the current track, the next 3 (for heads), and covers in view (batched per
  scroll stop, 150 ms debounce).
- Each signed URL is stored with `expires_at`. A URL with under 20 minutes left is re-signed
  before any new load, resume-after-pause or head fetch.
- Signed URLs live only in memory. Caches and OPFS are keyed by ref or sha256.

**A tapped song on a slow connection** (2026-11-21, the owner's phone on 3G: first sound 0.5–4.6 s after
the tap, 73–95 ms when already loaded). Lab run, `tests/music-tap-start-browser.test.mjs` (300 ms per
answer, 1.5 Mbps over one link): first sound **1,360 ms after the finger down before, 726 ms after**.
Where the time went:
- **The browser's HTTP cache** (the largest): the bridge fetched the bucket's signed links through it. A read
  cut short (a head stopped, a skip, the feed letting go) left part of a range there, and the next read of
  it went out first as a conditional request (`If-Range`) and then again in full: two more round trips
  before the bytes the song starts from. The bridge now fetches song bytes with `cache: 'no-store'`
  (`frontend/th/music/bridge.js`); heads and offline copies keep what is kept.
- **The signature**: a song not among the next ones was signed only once its first byte was asked for.
  Now a finger down on a song's row asks for its link (`frontend/music/src/player/sign-ahead.js`, from
  `input.js` through `PowerList.onItemPress`; a press that becomes a scroll or a hold leaves only a signed
  link, no bytes), and a list that has not moved for 150 ms has its shown songs' links signed in one
  request (at most 50, one post per song per 30 minutes; the Worker reads one row per song).
- **Heads in the way** (`frontend/music/src/library/heads.js` `settle`): another song's head downloading
  when a song starts now stops (fetched again later) and the heads wait for the starting song's stream;
  the song's own head, once its bytes come at a rate that cannot finish within the 1.2 s wait, stops at
  once instead of after the whole wait.
- Not changed: the first range (64 KB, 0.35 s at 1.5 Mbps, several seconds of Opus) and the start
  condition (a streamed deck plays as soon as the element has data: there is no `canplaythrough` wait).
  Not done: bytes asked for at pointer-down. Seen in the lab and not explained: each range reached the
  mock bucket twice from the worker.

### 6.2 403 / expiry mid-track

A media element cannot read the HTTP status, so the engine infers:

1. The playing deck errors or stalls (no data for 10 s while online).
2. If its URL has under 20 minutes left, or the error is a network error, the engine re-signs
   that one ref (one call), swaps `src` at the current position, and fades back in.
3. If the fresh URL fails too, the stream-guard backoff takes over: retries 1, 2, 4, 8, 15 and
   30 s, each from the current position. After 6 failed tries with the network up the player
   pauses with "Lost the connection · Tap play to try again"; Play reloads where it was.
4. A head served by the service worker that gets a 403 for its network remainder triggers the same
   re-sign.
5. A track that keeps failing while the network answers is skipped with the toast
   "Couldn't play *Title* · skipped". After 8 failures in a row the player pauses with
   "Several songs wouldn't play. Paused."

**Acceptance:** browser test with a fixture server that returns 403 once the URL's fake expiry
passes: playback paused across the expiry resumes within 1.5 s of Play, with one sign call; a
mid-track 403 resumes within 2 s at the same position (±250 ms).

### 6.3 Other recovery

| Case | Behaviour |
|---|---|
| Offline mid-track, no copy | Wait; resume where it was when the network returns |
| Offline at a track change | Skip to the next track that has an offline copy |
| Offline copy arrives for the playing track | Switch to it at once, silently |
| File will not decode | A bad copy is deleted and the stream tried; a bad stream is skipped |
| Auth expired (401 for a song) | The song stops where it was and Play shows; Music's toast says "Sign in to play your songs. · Tap play to sign in". Nothing more is asked for: Play goes to the sign-in door (and back to Music), and a new session on the phone (read from its own storage every 3 s while the page shows, no request) clears it, so Play plays on from where it was (`frontend/music/src/library/access.js`; the stream's `http-401` in `player.js` `streamFailed`, the plain element's probe in `stream-guard.js`) |
| No library on the phone and the catalog refused or failed | Signed out (401): the same sign-in toast, Play goes to sign-in, and the library loads by itself once a new session is on the phone. Any other failure: "Couldn't load your songs. · Tap play to try again"; Play tries again, and so do the connection coming back, the page showing again and a slow timer (30 s, doubling to 10 min). A library already on the phone (and its offline copies) plays as before, with nothing said at the open |
| A reload mid-song | The song and its place come back to within a second or two: leaving the page (hidden, `pagehide`, `freeze`) also keeps the place in `localStorage` (`cp.place`, about 130 bytes, under 0.1 ms, one write per leaving and none while playing), because the IndexedDB write does not finish before a reload; the newer of the two wins for the same song (`player/session.js` `newerPlace`). The clock shows the restored place at once (`positionMs` reads the place still to be sought) |

**A 404 seen 14 s late** (the owner's log, 2026-11-21: `loadstart deck 1 from "device"`, then nothing
until `stream fallback reason http-404` 14 s later, on 3G, with no offline copies). The player had not
tried the device: a song streamed through the feed plays from its Media Source, a blob URL, and the log
named every blob URL that is not an offline copy "device". It now names it `stream`
(`frontend/music/src/player/playback-log.js` `deckSource`). The feed itself gives up at the first 404 (no
try again, `frontend/th/music/stream/track.js`); what it waits on before that is not in the log, so it now
notes the feed's tries again after a network failure, a timeout or a 5xx (`stream retry`, with the code
and the try: 0.5, 1, 2 and 4 s apart) and a wait of 100 ms or more for the song's head before the first
request (`stream head wait`). Not found on the page: a path that waits 14 s for a 404. Found in the
service worker's bridge (`frontend/th/music/bridge.js`): it waited up to 4 s for a signature and 4 s for
the bucket's first byte, and after a timeout sent the request to the old Worker, whose 404 for a song it
does not have was the one in the log. Fixed (§5 step 5): a timeout is tried again on the new path, then
answered with a network error within 24 s; the old Worker is never asked (since 2026-11-22, MIGRATION.md §8).

**Stalls and slow starts on 3G** (the fourth report: `stalls: 2, reloads: 1`; a `waiting` 5.31 s into a song,
`stall` 10 s later; first sounds 765–6,068 ms). Lab: the real page, worker and bridge against a mock Worker
and bucket on one 1.35 Mbps link with 300 ms per request, a 193 kbps Opus song, 4x CPU, 60 songs whose
covers are in their files (`artId` `embedded:`). Found:
- **Covers took the link at a tap.** Each tap read the covers of the songs around it, 64 KB from each song's
  file (three slots at once), the tapped song's own twice (its cover and its row's thumbnail): 0.40–0.71 MB
  of other files while the song had less than 10 s on the phone. Now a cover's read waits, before it takes a
  download slot, until the playing song pauses or sounds with 10 s of its stream ahead, at most 3 s
  (`Player.linkFree`, `frontend/music/src/player/link-free.js`: read on the deck's own events, one wait for
  every caller, no polling); past 3 s covers load one at a time at low priority (`Library.lowSlot`). A cover
  is read once for every caller (`Library.remoteCover`). The tapped song's first 10 s were on the phone after
  5.0–6.9 s, now 3.0–3.4 s; first sound 708 / 1,278 / 609 ms, now 583–601 / 925–940 / 626 ms (one run each).
- **A stall reloaded a song whose request was about to deliver.** With the link dead from 3 s to 18 s after
  a tap, the guard reloaded at 10 s of waiting: the new deck sought the file again (five ranges) and played
  7 s after the link came back, while the first deck's request was already receiving again. Now a streamed
  song's stall waits while the feed has any request under way that showed life (its start or a byte) in
  the last 15 s, a seek's probes included (`feed.link()`, `linkOf` and `TrackReader.pending`/`alive` in
  `frontend/th/music/stream/track.js`), and acts 2 s after nothing is alive; one reload per stall, the next
  no sooner than 15 s times the tries so far, so a reload's own seek on a slow link is never met with
  another reload (`frontend/music/src/player/stream-guard.js`); a plain element keeps the 10 s rule. Same tunnel: playing
  again 0.25 s after the link came back, no reload.
- Not found in the lab: a refetch of ranges the song had (the stream feed keeps its own buffer, so the
  bridge's `cache: 'no-store'` costs nothing there); range sizes as a cause (128 KB at 300 ms used the link
  for 72 % of the time with nothing else on it, against 14 % the song needs); a reload from zero (it reloads
  at the stalled position). Sync, senses and the signature posts are a few hundred bytes each. Why the
  phone's mid-song stall never recovered (and was not reloaded: one reload for two stalls) is not shown
  by the report; the recorder now has what would show it:
- **The report's `songs`** (last 12 streamed songs, `frontend/music/src/player/song-net.js`): `signMs` (the
  bridge's wait for the signature, header `TH-Sign-Ms`; 0 when signed ahead), `firstByteMs` from the song's
  first request, `kbps` received while its reads ran, `bytes`, `firstRange`, and `othersAtStart` with
  `othersKinds` (the page's other requests on the link at its start: song bytes, cover, waveform, sync,
  senses, catalog). Guards: `tests/music-stream-guard.test.mjs`, `tests/music-song-net.test.mjs`.

### 6.4 CORS prerequisites

`jarvis-music` bucket CORS: allow the new site origin, methods GET and HEAD, request header
`Range`, expose `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`. This is an owner setup
step (ask first). Without it the EQ path outputs silence.

---

## 7. Offline

### 7.1 Modes (Settings › Music › Offline)

| Mode | What downloads | Default |
|---|---|---|
| Stream | Only song heads (§5.4) | **Yes** |
| Next song | The next whole song, once the current one has played 30 s | |
| A few songs | On Wi-Fi: the current track and the next 3. On mobile data: the next one | |
| Keep offline (per item) | Any song, album, playlist or mix the owner marks "Keep offline" | Independent of mode |

### 7.2 Storage

- Files go to OPFS `music/<sha256>.<ext>`, streamed to disk with `createWritable()`. A copy counts
  only once its size matches the catalog.
- Copies play as blob URLs from `getFile()`: same origin, so the EQ graph processes them.
- **Budget: 512 MB by default**; choices 256 MB · 512 MB · 1 GB · 2 GB · 4 GB, never above 90 % of
  `navigator.storage.estimate().quota`.
- Eviction: least recently played first. Never evicted: the playing track, the next 3, and
  anything marked "Keep offline". If kept items alone exceed the budget, the setting shows
  "Kept songs need 1.3 GB. Raise the limit or keep fewer." and nothing new downloads.
- New downloads wait until the current track has sounded for 30 s, so skipped songs cost nothing.
- `navigator.storage.persist()` is requested after the first "Keep offline".
- Settings shows: used / budget, number of songs, **Delete offline copies** (asks once).

### 7.3 Offline browsing and search

The catalog, search index, DJ features and the last 2,000 viewed thumbnails are on the phone, so
browsing and search work with no network. Rows without a copy are dimmed (§2.8). An "On this
phone" filter chip appears in Library when offline.

**Acceptance:** Playwright with `setOffline(true)` after keeping one 5-track playlist: the playlist
plays all 5 tracks; search returns results; a non-kept song shows the "Not on this phone" toast.

---

## 8. Search

**Built in the as-is player (2026-10-30, the owner's day-1 request: "better than normal search,
never worse"):** its Songs results (`frontend/th/music/search.js`, one recorded `improvement` edit to
`list/sources.js`) keep every song the player's own search finds, add §8.2's normalisation and a
one-typo match for words of 4+ letters (any order), and come best first by §8.3's tier 0 ranks, then
inside-word matches, then typo matches, A–Z within a tier. A test checks no plain hit is ever lost
over 300 random queries. The rest of this section (the new app's grouped results, recent searches,
"similar vibe", filters) waits for the app's rebuild.

### 8.1 Placement and behaviour

- A search field at the top of Mixes, Playlists and Library. Focus → recent searches (last 8, with
  a "Clear" link). Typing runs search on every keystroke for tiers 0–1, with no debounce.
- Results are grouped: **Songs** (tiers 0–1, up to 50) · **Albums** (up to 6) · **Artists** (up
  to 6) · **Playlists** (up to 6) · **Similar vibe** (tier 2, up to 10, after a 150 ms pause in
  typing).
- Enter / tapping a result records the search (§10.1).

### 8.2 Normalisation (applied to queries and to indexed text)

1. Unicode NFKD, remove combining marks (`é → e`, `ü → u`).
2. Lowercase with `toLocaleLowerCase('und')`; `ß → ss`, `æ → ae`, `ø → o`, `ł → l`.
3. `&` and `+` → ` and `; apostrophes removed (`don't → dont`); every other punctuation → space.
4. Collapse whitespace; trim.
5. A leading article ("the ", plus the second language's articles from the private language setting) is indexed both with and without it.

### 8.3 Tiers

| Tier | Matches | Order inside the tier |
|---|---|---|
| 0: exact and prefix | Fields title, artist, album, album artist. Ranks: (a) whole title equals query; (b) title starts with query; (c) artist equals query; (d) artist starts with query; (e) album equals/starts with; (f) every query word is a word-prefix somewhere in title+artist+album | By rank a→f, then plays (desc), then title |
| 1: fuzzy | uFuzzy (MIT) over "title — artist — album" for rows not already in tier 0. Allows one typo per word of ≥ 4 letters and out-of-order words | uFuzzy's score, then plays |
| 2: similar vibe | Offline tags generated per song (mood, genre, instrument and tempo words, in English and the second language) and optional 384-dim vectors | Shown only in its own section; never merged into tiers 0–1 |

Hard rule: tier 2 never changes the content or order of the Songs section. A test feeds the same
query with and without the tier-2 index and asserts the Songs section is identical.

Budgets (A15, 20k-track fixture): tier 0 ≤ 3 ms, tier 1 ≤ 8 ms per keystroke; tier 2 ≤ 25 ms.
Search runs in the main thread for tiers 0–1 and in a worker for tier 2 vectors.

**Acceptance:** a golden set of 60 queries over a generic 2,000-track fixture (typos, accents,
reordered words, articles) with expected top results, run in `node --test`.

---

## 9. DJ shuffle

**Built (2026-10-30, the owner's day-1 request), without the audio features yet:** DJ is the
player's sixth shuffle mode (`frontend/th/music/dj.js`, added to the as-is player by recorded
`improvement` edits). Until §9.1's data exists, "close" is the tags: the same composer (0.6), artist
(0.4, else album artist 0.2), shared genres (up to 0.5), a near year (up to 0.2). §9.2's rules hold:
nothing from the last 50 songs or 2 hours, no "not for me", no artist within 10 songs (unless
nothing else is left), −0.3 for an album within 20, the learner and the move scores, the top five by
`softmax(score / 0.15)`, seeded. §9.3's learning is on the phone (`th.music.dj` in localStorage,
not yet mirrored as senses). The player plans 60 songs at a time and plans again after a skip or
near their end. A new plan after a skip keeps the 3 songs already planned next (their heads may be
on the phone), unless one was just played or skipped. The analysis job (tempo, key, energy,
embedding) is built (§9.1, the listening pass) and plugs into `closeness` next.

### 9.1 Data

**Built 2026-11-01 (the listening pass, [JOBS.md §3](../../engineering/JOBS.md#3-actions-jobs-the-listening-pass)):** every song is analysed once in Actions, by its sha256 only, and the numbers come back through the Worker. Per audio file, stored in `Music.analysis` (schema v2): loudness (integrated LUFS, true peak, loudness range), tempo (BPM and confidence), key (and confidence; its Camelot place derived from it: `8A` is A minor, `8B` C major), silence at the start and the end, energy (0–1), valence and arousal (0–1), vocals vs instrumental (0–1), **16 mood scores** (0–1: calm, peaceful, melancholy, sad, hopeful, joyful, romantic, nostalgic, dark, tense, energetic, triumphant, playful, dreamy, reverent, focused: Music's own `MUSIC_MOODS`, the same list the mind's notes on each song use; each says how much that feeling stands out in the song against its own average, 0.5 being average, from CLAP's zero-shot similarity to a fixed text prompt per mood), and a **32-d CLAP embedding** made by a fixed projection, so songs from different runs compare. Once every song is analysed, a neighbours step works out each song's **50 nearest** by cosine on the embeddings. Per track, `Music.track_analysis` keeps the energy, the moods and the nearest tracks' ids (what the mind's knowledge of each song, Music step 4, reads and blends). Licences: numpy, scipy, opus-tools (BSD), LAION CLAP `clap-htsat-unfused` (Apache-2.0) through transformers (Apache-2.0) on PyTorch (BSD); no GPL tools. A song not stored as native Opus is not analysed (`unsupported`); one that fails three times is left out until the analyzer changes.

**The phone's one file** (`GET /v1/music/pack`, device only, with an `ETag`; built in the private bucket by a Music job after each applied job, about 2.8 MB at 12,000 songs): `THA1`, a JSON header naming each section's offset and size (every section on a 4-byte boundary, so each is read as a typed-array view), then one entry per analysed track in catalog order:

| Section | Type, per track | Meaning |
|---|---|---|
| `ids` | UTF-8, `\n`-joined | the track ids (`music:<id>`) |
| `bpm` | uint16 | BPM × 10; 0 unknown |
| `camelot` | uint8 | 1A = 1, 1B = 2 … 12B = 24; 0 unknown |
| `energy`, `valence`, `arousal`, `vocals` | uint8 each | 0–250 for 0–1; 255 unknown |
| `moods` | uint8 × 16 | the moods in the header's order, 0–250 |
| `emb` | int8 × 32 | the embedding scaled by its own largest value (cosine needs no scale) |
| `nbr` | uint16 × 50 | the nearest tracks as indexes into this file, nearest first; 0xFFFF none |

A track that shares its audio with another gets the same numbers; the neighbours list names each near song once (its first track in catalog order). The phone keeps the file and revalidates it with `If-None-Match` (304 when unchanged).

**The mind's read:** `th music analysis <id> [--n 10]`: one song's numbers, its three strongest moods and its `n` nearest songs by sound, with titles and how close each is (`GET /v1/music/analysis/:id`). The mind's own `th music like` and `find` (what it knows of each song, Music step 4) blend the same `track_analysis` rows with its notes.

**Not built yet (the lead's, on screen):** the DJ planner reading the file (`frontend/th/music/dj.js` still uses tag closeness).

The listening pass (Music schema step 3, NEXT-BATCH.md part 6) also scores each song's moods, in the
same fixed list the mind's notes use (`MUSIC_MOODS`, §10.5), so the Worker's find can blend the
two; its energy and neighbours feed find and "more like this" (§10.5: `th music find`, `like`).

### 9.2 Choosing the next track

For the current track `c`, candidates are its 50 neighbours plus 20 random tracks from the context
(for variety). Remove: anything played in the last 2 hours or in the last 50 tracks; rating 1;
tracks the learner scores ≤ −3. Score each candidate `x`:

```
score = 1.0 · cosine(c, x)
      + 0.3 · tempoFit   (1 within ±6 % or at half/double tempo; 0.5 within ±12 %; else 0)
      + 0.2 · keyFit     (1 same or relative key; 0.7 one step on the Camelot wheel; else 0)
      − 0.15 · |energy(x) − targetEnergy|
      − 0.5 if same artist in the last 10 tracks; − 0.3 if same album in the last 20
      + 0.25 · learner(x)   (clamped to −1..+1)
```

`targetEnergy` follows the last 3 tracks' energy, nudged by +0.05 per track during the first 20
minutes of a session **[proposal: a gentle warm-up arc]**. Pick at random among the top 5 with
weights `softmax(score / 0.15)`, seeded so a test can replay it.

### 9.3 Learning from skips

Stored on the phone (IndexedDB `th-music/learner`) and mirrored to the server through senses.

| Event | Track score | Transition `c→x` score |
|---|---|---|
| Skip before 30 s | −1 | −1 |
| Skip 30 s to 50 % | −0.25 | −0.5 |
| Played past 50 % | +0.5 | +0.5 |
| Played to the end | +1 | +1 |

Scores decay with a 60-day half-life. A transition score below −2 removes `x` as a follower of
`c` for 90 days.

**Acceptance:** unit test with a 500-track synthetic feature set: no artist repeats within 10
picks; 1,000 seeded picks after 5 early skips of track X never pick X again within the run;
DJ pick takes ≤ 5 ms on the A15.

---

## 10. The mind's part

### 10.1 Senses

All senses follow `{id: uuidv7, at, type, ref, data, sensitivity}` and go through `th.sense()`
(outbox, batched). See [DATA](../../engineering/DATA.md).

**Built 2026-10-31 (NEXT-BATCH.md part 6; `th/music/dj.js`, signed in, top-level page):**
`music.play` when the deck playing a new song first plays (a song loaded and not played, or passed
over in a skip, sends none; `data` is `{offline}` only so far), `music.skip` with `{at_ms,
duration_ms, next_ref}` when a song that sounded is left before its last 3 s (`at_ms` from the
position read every 250 ms, so within a quarter second), and `music.finish` with `{listened_ms}`
otherwise. Ids and times only, never a title. The rest of the table waits on its features.
**Used (2026-11-01, §10.5):** a skip before 30 s counts against a song in the Worker's find (three in
30 days leave it out, as §4.2 does for mixes); the newest `music.play` answers "who is this?"
(`th music now`); a week's plays, finishes and skips make the Sunday line (`th music week`). A song
whose newest `music.rate` is 1 is left out of find, like and the mind's mixes: the phone sends one
when the owner rates a song "not for me", and when they say "never play this again" to it (the phone
rates the song 1 through Music's library and skips it; its Undo sets the old rating, which brings
the song back). Every rating set in Music (its rating widget, a playlist import, that command) goes
as a `music.rate` sense (`{rating, from}`, `th/music/ratings.js` on Music's own bus, cached for
offline by Music's worker), and once, the songs already rated 1: 100 a page load at most, never more
than the senses outbox has room for (less 50, so it never drops the oldest), each counted as sent
only once the Worker took it (else the next load sends it again). The Worker keeps each song's newest rating for good
(`track_ratings`), so "not for me" never fades with the senses' 90 days.

| Type | When | `ref` | `data` |
|---|---|---|---|
| `music.play` | A track starts sounding | `music:<id>` | `{context_ref, source: 'list'|'search'|'mix'|'dj'|'shuffle'|'queue'|'verb', offline: bool}` |
| `music.skip` | The owner leaves a sounding track before its end (next, previous, picking another, notification next) | `music:<id>` | `{at_ms, duration_ms, by: 'next'|'previous'|'pick'|'notification'|'swipe', next_ref}` |
| `music.finish` | A track plays to its end | `music:<id>` | `{listened_ms}` |
| `music.played` | The played threshold (§5.3) is crossed (this is what increments play count) | `music:<id>` | `{}` |
| `music.rate` | Rating changes | `music:<id>` | `{rating: 0..5, from}` |
| `music.search` | A search is committed (Enter or a result picked) | `null` | `{q, results: n, picked_ref, picked_tier, picked_rank}` |
| `music.queue.edit` | Play next / Add to queue / remove / reorder | `music:<id>` | `{op}` |
| `music.playlist.edit` | Create, rename, add, remove, reorder, delete | `music:playlist/<id>` | `{op, refs}` |
| `music.mix.feedback` | Keep / Less like this / a why chip dismissed | `music:playlist/<id>` or `music:<id>` | `{op, recipe}` |
| `music.offline` | Keep offline set or removed | ref | `{on}` |
| `sys.audio` | Once per session end: dropouts, stalls, re-signs, failures | `null` | counts only |

All have sensitivity 0. The `q` text in `music.search` is the owner's typing; it is private data in
the Worker like every sense and never leaves it ([PRIVACY](../../engineering/PRIVACY.md)).

Position-dependent events (`at_ms`) are measured from what was heard, after gapless delay
correction.

**Acceptance:** a browser test plays fixture tracks and skips at 12 s; the outbox holds exactly one
`music.play` and one `music.skip` with `at_ms` within 12,000 ± 250.

### 10.2 Verbs

Declared in `frontend/apps/music/verbs.js`, which runs without the Music UI mounted. Every verb
returns `{result, undo}`.

| Verb | Args | Does | Undo |
|---|---|---|---|
| `music.queue` | `{refs: [≤ 200], at: 'next'|'end'}` | Adds to Next up | `music.unqueue {refs, ids}` |
| `music.unqueue` | `{ids}` | Removes those queue entries | `music.queue` |
| `music.play_playlist` | `{list_id, shuffle: 'off'|'shuffle'|'dj', start_ref?}` | Loads the list as context; plays if allowed (§10.3) | Restore the previous queue and position |
| `music.create_playlist` | `{name, refs, kind: 'playlist'|'mix', why?, track_whys?, recipe?, refresh?}` | Creates it | `music.delete_playlist {list_id}` (allowed only while the owner hasn't edited it) |
| `music.add_to_playlist` | `{list_id, refs}` | Appends | `music.remove_from_playlist` |
| `music.set_why` | `{ref, why, expires}` | Attaches a why chip | Removes it |
| `music.keep_offline` | `{refs}` | Marks for offline (downloads on Wi-Fi only when the verb came from the mind) | Unmark |

Not verbs, on purpose: changing a rating the owner gave, deleting an owner playlist (ask-first class),
changing sound settings, clearing offline copies.

**Built (2026-11-02, the mind's verbs batch 1; API.md §11.11):** `music.queue` (and its undo
`music.unqueue`), `music.play_mix` (a mix `music.mix_save` kept in the Worker, a find the Worker runs,
or songs; loaded paused; its undo is the queue before) and `music.rate` (only a song the owner has
not rated; its undo `music.unrate`) are intents: the queue and the ratings live in the player, so
Music applies them when it opens (`frontend/th/music/intents.js`, from `installDj`). `music.never`
(the owner's rule, through memory) and `music.mix_save` run in the Worker at once.

**Built (2026-10-30, the owner's day-1 request):** `music.create_playlist` v1 `{name, refs}` and its
undo `music.delete_playlist` v1 `{list_id}` (not queueable by the mind; refuses `owner_edited` once
the owner has changed the playlist). The phone's executor (`frontend/th/music/playlists.js`) writes
the playlist into the player's own storage (`claude-player`, `state`, `pl:<id>`, marked
`made_by: 'thunderhead'`), so the as-is player shows it; a chip to `/music/#pl=<list_id>` opens the
player on it (a recorded `improvement` edit to `music/src/app.js`). The mind picks songs with
`GET /v1/music/tracks?q=&limit=` (C N: each track's title, artist, album, genre, composer, year,
seconds). The other verbs of this table wait for their features. It needs the catalog on the new
Worker (SETUP.md N1–N4). From 2026-11-01 the mind picks a mix's songs by feeling or by likeness
(`th music find`, `th music like`, §10.5) and passes the mix's one-line why as the verb's `--why`.

### 10.3 When a verb may start sound

Browsers allow audio only after a user gesture, and the Thunderhead never surprises the owner with
sound.

1. If the verb answers a message the owner sent in the last 2 minutes from this device (the shell
   has a fresh user activation), `music.play_playlist` starts playback.
2. Otherwise the queue is loaded but paused, Now Playing shows "Ready · tap play", and the result
   says `{started: false, reason: 'no-owner-gesture'}`.
3. Never before 06:30 local unless the owner asked in that moment (quiet hours,
   [decisions](../../process/decisions.md)).

### 10.4 Surfaces

| Slot | Shows | Rules |
|---|---|---|
| `music.note` | One line from the mind at the top of Mixes (Fraunces italic 15/22) | ≤ 120 characters; expires in 24 h; tap opens home with the note attached; swipe away = `music.mix.feedback {op: 'dismiss'}` |
| `music.why` | A why chip on a track (Now Playing, mix rows) | Inter 500 12/16 pill, ≤ 60 characters visible; tap expands to the full line plus "Less like this"; rendered through `<th-why>` |
| `music.suggest` | Up to 3 faded rows at the end of the queue | 55 % opacity, label "Suggested"; tap = accept (moves into Next up); swipe away = dismiss; never auto-play unless "Keep playing" is on and the context has ended |
| `briefing.music` | For the [Briefing](../BRIEFING.md): "New: 12 songs added" and a mix built overnight | At most 2 lines |

Why text must be true and checkable ("Played most on rainy evenings" only if that's in the
evidence). Rules for why text live in [BEHAVIOR](../../mind/BEHAVIOR.md).

### 10.5 What the mind knows of each song

**Built 2026-11-01 (NEXT-BATCH.md part 6; owner: "build everything"):** each night the mind reads a
page of the catalog's tags (title, artist, album, genre, year) and writes a note per song from what
it knows of it (Music schema step 4, `track_notes`, one row a track; [DATA.md §6.2](../../engineering/DATA.md)).
The vocabularies are fixed, in `shared/contract/music.ts`, and the Worker refuses any other word:

| Field | Words | At most |
|---|---|---|
| `moods` | calm, peaceful, melancholy, sad, hopeful, joyful, romantic, nostalgic, dark, tense, energetic, triumphant, playful, dreamy, reverent, focused (`MUSIC_MOODS`, shared with the listening pass, §9.1) | 5, each with a confidence 0.05–1 |
| `occasions` | focus, wind-down, morning, workout, drive, study, worship, party, rainy-day, sunday, sleep | 4, each with a confidence |
| `themes` | love, heartbreak, longing, faith, gratitude, family, friendship, home, loss, freedom, journey, nature, night, celebration, struggle, growing-up (what its words are about; none for a song without words) | 3 |
| `language` | an ISO 639-1 code, or null (no words, or not known) | 1 |
| `era` | the decade it comes from (1990), from 1000 to the present one, or null | 1 |
| `energy` | 0 (still) to 1 (driving), or null | 1 |

`conf` holds one confidence for each of themes, language, era and energy that is set, and none for
one left empty. `known: false` is the mind saying it doesn't know the song: such a note says only
what the tags imply, and none of its confidences may pass 0.5. Each note records its writer (`by`:
`mind:night` or `mind:chat`) and its format version; a note of an older version comes up again in
the night's page, except one the owner corrected (or confirmed as it is) through the chat, which no
night note replaces. A song added at or below the night's place in the catalog (a deleted track's
place taken again, an import) is still offered; a write to the notes from outside a batch (a table
restore) rebuilds the packs and starts the place over.
The night writes at most 400 songs a night, as night step 11 with its own 6 minutes, until the
library is covered, then only new ones ([RUNTIME.md §12.1](../../mind/RUNTIME.md)). Every read is by
key: notes and tags by id, the night's page from the catalog place where its last page began, and
find from the notes packed 500 to a row ([DATA.md §6.2, §8.4](../../engineering/DATA.md)).

**Find by feeling** (`GET /v1/music/find?moods=&occasion=&energy=&like=&limit=`, `th music find`):

```
score = 1.0 · mood fit (each asked mood's confidence, the note's and the audio's averaged where
              both have it, the mean over the asked moods)
      + 0.8 · occasion fit + 0.5 · (1 − |energy − target|)   (the audio's energy before the note's)
      + 1.0 · likeness to `like` (the listening pass's neighbours when it has them for that song,
              else moods, occasions, tags as the DJ weighs them, era, language and energy)
      − 0.25 per skip before 30 s in the last 30 days
```

A song must show the asked feeling (mood and occasion fit together over 0.15); a song with neither
a note nor a measurement isn't ranked. Left out, and counted in `left_out`: songs whose newest
rating is 1 (`rated`: the phone's "not for me", which "never play this again" said to the phone
sets; the senses route hands each `music.rate` to the Music object, which keeps each song's newest
rating for good in `track_ratings`, so it never fades with the senses' 90 days, and the word search
`/v1/music/tracks?q=` leaves them out too), songs the owner told the mind never to play again in
other words (`never`: a rule fact from their own words, subject `music.never`, its text naming the
song as `music:<id>` and nothing else of it; MEMORY.md §6 M4), and songs skipped before 30 s three
times in 30 days (`skipped`, §4.2). Until the listening pass has measured songs, find ranks by the notes
alone and says so (`analysis: false`); its measurements are packed again once a job of it applies
songs. Find waits from 80% of the day's database budget, as the
night's batches do.

**In the chat** ([RUNTIME.md §4.7](../../mind/RUNTIME.md)): "who is this?" (`th music now`: the
newest `music.play` with its tags and note), "more like this" (`th music like`, then a mix) and
"play something calm" (`th music find`, then a mix, opened by a chip). **Overnight**: up to 2 mixes
a night when the evidence gives a reason, and on the night into Sunday one home line of what the
owner has been into, in the morning's Overnight card. Notes and find never leave the Worker
([PRIVACY.md §2](../../engineering/PRIVACY.md)); the night never looks a song up on the web: a
night session that has read songs' tags may not use the web, MCP tools or GitHub search after (the
PreToolUse hook, from the Worker's record, failing closed). Songs' tags are outside text (someone
else wrote them), so serving them taints the mind session like any outside text (the Worker records
it itself; the taint carries over as any does, and the next night's fired wake starts clean once the
tainted night has ended, [RUNTIME.md §4.3](../../mind/RUNTIME.md)), and a title never goes inside a
quoted shell argument: it travels on stdin ([RUNTIME.md §4.7](../../mind/RUNTIME.md)).

---

## 11. Import from the old site

At the as-is port the player's data is restored unchanged into the same stores on the new origin
(First move, item 3). The table below is for the later step, when the new app's own tables take over.

The old player kept its data in the old origin's IndexedDB `claude-player`. The old site gets a
small `/export/` page (owner OK needed, it deploys to the old repo). Full procedure:
[MIGRATION](../../engineering/MIGRATION.md).

| Old data | Imported as | Rule |
|---|---|---|
| `tracks[].plays` | `track_stats.plays_imported` | Kept separate from new plays; displayed play count = imported + new **[proposal]** |
| `tracks[].lastPlayed` | `track_stats.last_played_at` if newer than any new value | |
| `tracks[].rating` (0–5; old "like" = 5, "unlike" = 1) | `rating` | A rating set in the new app since the move wins |
| `state['pl:<id>']` `{name, ids, created, modified}` | Owner playlists, same names and order | Entries whose id is not in the catalog are dropped and counted; `path:` entries (unresolved file paths) are dropped and counted |
| EQ, presets, list memory, visualiser, tags editor state | Restored as they are for the as-is port | The ported player keeps its own presets; replacing them is a later step that waits for the owner |
| Waveforms, art, offline copies, heads | Not imported | Regenerated or downloaded again |

1. The import is idempotent by its export id: importing the same file twice changes nothing.
2. After import, Music shows a one-time sheet: "Imported from the old site: 412 ratings,
   9 playlists, play counts for 3,180 songs. 6 playlist entries weren't in your library."
   (numbers from the import).
3. **Acceptance:** counts on the sheet equal the export's counts; 10 random tracks' plays and
   ratings match the export (the import test in [MIGRATION](../../engineering/MIGRATION.md)).

---

## 12. Settings (Settings › Music)

| Setting | Values | Default |
|---|---|---|
| Track changes | Gapless · Crossfade | Gapless |
| Crossfade length | 1–12 s | 5 s |
| Keep albums gapless | on/off | on |
| Fade on pause and play | on/off | on |
| Loudness | Off · Track · Album · Smart | Smart **[proposal]** |
| Loudness target | −18 · −16 · −14 LUFS | −14 **[proposal]** |
| Offline mode | Stream · Next song · A few songs | Stream |
| Offline space | 256 MB … 4 GB | 512 MB |
| Data saver | on/off | off (follows the browser's Data Saver when that is on) |
| Keep playing when the list ends | on/off | on **[proposal]** |
| Playback log | opens §5.10 | — |

Sound (EQ) is reached from Now Playing, not here, because it is used while listening.

---

## 13. Accessibility

1. Every control is a `<button>` or `<input type=range>` with an accessible name; icon-only buttons
   have `aria-label` ("Next song", "Shuffle: DJ").
2. The seek bar: `role="slider"`, `aria-valuetext` "1 minute 12 seconds of 3 minutes 40 seconds";
   arrow keys ±5 s, PageUp/PageDown ±30 s.
3. Keyboard: Space play/pause; `J`/`L` −10/+10 s; Shift+←/→ previous/next; `/` focuses search.
4. Track changes are announced through a polite `aria-live` region only while Music is visible
   ("Now playing: *Title* by *Artist*").
5. Queue reordering has menu commands (Move up/down, Play next) besides dragging.
6. Targets ≥ 44 px; text in `rem`; contrast pairs from the design tokens pass WCAG 2.2 AA.
7. Reduced motion: no cover swipe-follow (a crossfade instead), static level icon, sheets fade.
8. Second-language titles are not marked `lang` per row (unknown per track); the UI chrome is `lang="en"`.

**Acceptance:** `@axe-core/playwright` reports 0 violations on Now Playing, Queue, Library and
Search in day and night.

---

## 14. Empty, error and offline states (copy)

Copy follows [COPY](../../design/COPY.md). Exact text:

| State | Text | Action |
|---|---|---|
| Library loading the first time | (skeleton rows, no text) | — |
| Catalog unreachable, nothing cached | "Can't reach your library right now." | Try again |
| Offline, catalog cached | Banner: "Offline · songs on this phone still play" | — |
| No mixes yet | "No mixes yet. Ask me for one, or I'll make one tonight." (Fraunces italic) | — |
| No playlists | "No playlists yet." | New playlist |
| Search, nothing found | "Nothing called "*q*". Try fewer words." | — |
| Search, offline and only uncached matches | "Found 4 songs, none on this phone." | — |
| Song fails | Toast: "Couldn't play *Title* · skipped" | — |
| 8 failures in a row | Toast: "Several songs wouldn't play. Paused." | Playback log |
| Signed out | "Sign in to play your music." | Sign in |
| Offline space full | "Offline space is full. Older songs will make room." | Settings |
| Play blocked by the browser | Now Playing shows "Tap play to start" | — |

---

## 15. Performance budgets (A15)

| Budget | Target | Check |
|---|---|---|
| Music app code on open | ≤ 300 KB raw (engine is in the shell) | stage-time budget test |
| Open Music to first rows (warm) | ≤ 300 ms | Playwright trace, 4× CPU |
| Songs list scroll | ≤ 40 row nodes; no frame over 16.7 ms p95 at 20k rows, 4× CPU | Playwright |
| Skip to sound, head present | ≤ 200 ms p75 | device log |
| Skip to sound, no head, 4G | ≤ 1.5 s p75 | device log |
| Main thread while playing, screen on | ≤ 6 % busy | trace |
| JS heap with Music open | ≤ 120 MB | DevTools |

See [PERFORMANCE](../../engineering/PERFORMANCE.md).

---


## The mind's arrangement slot (2026-11-04, verbs batch 2)

One slot, one kind ([BEHAVIOR.md §3.1](../../mind/BEHAVIOR.md#31-rung-0-silent-arrangement), API.md §11.11 "The apps' arrangements"): `music/tonight`, kind `mix`: a mix saved with `music.mix_save`, placed with `PUT /v1/surfaces` (`th surface music tonight --kind mix`) and shown on the home shelf; the owner's tap plays it. It carries its why behind a tap, and the app reports it seen, taken up or dismissed (`arrangement.seen`, `arrangement.tap`, `arrangement.dismiss`), so the meter and what lands count it.

**As built (2026-11-04, `th/music/tonight.js`):** a card over the library's home while it is on screen ("Tonight": the mix's name and size), Play, Why and Dismiss. Play reads the mix's songs (`GET /v1/music/mixes/:id`, the phone only), makes them the queue through `music.play_mix`'s own executor and starts at once, the tap being the gesture.
## 16. Taste from your listening history (2026-11-04, owner decisions 12 and 13)

The mind knows the owner's taste from years of listening, from exports they drop in **Settings › Music › Listening history**; the listening pass (audio analysed in Actions) was cut the same day ([JOBS.md §3](../../engineering/JOBS.md)).

### 16.1 The imports

Three formats, zip or json (or csv for Last.fm), each ≤ 32 MiB: Spotify's extended streaming history (`Streaming_History_Audio_*.json`; the older `StreamingHistory*.json` too; a stream counts as a play from 30 s, every stream's minutes count, podcasts and video streams are left out), YouTube Music's watch history from Google Takeout (`watch-history.json`, only the entries headed "YouTube Music"; the artist from its "- Topic" channel; no minutes) and a Last.fm export (its scrobbles as json pages or csv; no minutes). The phone sends each file with its SHA-256 (`PUT /v1/music/history`); the Worker keeps it in the private bucket by its hash and queues `music.history`, a bulk-lane job in Core: the file is summed by artist, album and the year of the play into Music's `listens` (schema step 5: artist key, album, year, source, plays, minutes) and `listen_artists` (plays per artist), a part of 2,000 rows a step, counted once per file and once per part. Track titles are read past and never kept. The rows guard holds it from 80 %.

### 16.2 Canonical names and similar artists

`music.mb` resolves each artist with 3 plays or more, most played first, to a MusicBrainz id and canonical name: one request a step, a step at most every 1.1 s, a User-Agent naming the app and nothing of the owner, three tries; an artist MusicBrainz doesn't know stays as the name. ListenBrainz's similar artists are fetched by MusicBrainz id when the mind asks (`th music similar <id>`) and kept a week (`similar_artists`, out of the backup). A Last.fm API key is optional (`LASTFM_API_KEY`, SETUP.md N6): with one, Last.fm's similar artists are merged in; MusicBrainz and ListenBrainz need none.

### 16.3 Reading the taste

`th music taste` (top artists by plays as MusicBrainz ids and canonical names, an unresolved artist as an opaque id with no name; top years; counts only), `th music similar <artist id>` (each with the owner's plays and the catalog's songs of them) and `th music find --like-history` (find's `history=1`: each catalog song weighted 0–1 by the log of its artist's plays, `why.history`). The brief's section 1 carries one line: plays, artists, the years and the top three by canonical name. The switch **Use my listening history** (Settings › Music, `music.history`, in the mind's settings) turns the brief's line off; the mind reads it and stops using taste.

### 16.4 The DJ shuffle and "playlist from words"

While **Use my listening history** is on, both lean towards the artists the owner played most, with the weights `th music find --like-history` uses (each catalog song 0–1 by the log of its artist's plays, `MusicTaste.historyWeights()`):

- **The DJ shuffle** (§9): when Music opens, the phone asks `GET /v1/music/taste/weights` (the owner's phone only; song ids and numbers) and keeps the answer on the phone (`th/music/taste.js`, `th.music.taste`). Each candidate's score gains up to 0.3 (`HISTORY_W`, under a shared genre's 0.5), so history breaks ties among songs that follow well and never outranks the flow; the artist and album rules, the skips and "not for me" hold as before. With the switch off the Worker answers `{on: false}`, the phone drops what it kept, and the order is the one without history (`tests/music-dj.test.mjs`, an invented history).
- **"Playlist from words"** (a `music.play_mix` with a `find`: the moods and occasion the mind read from the owner's words): the route adds find's `history` weighting while the switch is on (`verbs/routes.ts` `prepare`), so among the songs that fit the words the most played artists come first; history alone never brings in a song that doesn't fit.

## 17. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Does R2 presigned GET with Range work from the new origin into `MediaElementAudioSourceNode` on Android Chrome (CORS-clean, not silent)? | Spike in P5 after bucket CORS is set: play a signed fixture through the worklet, check the output meter is non-zero |
| 2 | Do OPFS `File` blob URLs play through the worklet with seeking? | Spike: keep a track offline, seek 5 times, check meters and positions |
| 3 | Is the 403-on-expiry inference reliable (element error vs stall) on Android Chrome? | Fixture server with forced 403 after N bytes, on the device |
| 4 | Background playback with the Web Audio graph, screen locked, installed WebAPK, 30 + min, battery setting "Optimised" | Device soak (§5.7). If it fails: fall back to decks straight to output while hidden, EQ off, and record it |
| 5 | Does the media notification show artwork from a presigned cross-origin URL? | Device check |
| 6 | −14 LUFS target vs the library's hot masters: does Smart mode sound right to the owner? | Owner A/B for a week; the setting is one tap |
| 7 | AutoEq data terms per measurement source | Read each source's licence before shipping any profile |
| 8 | CLAP tag quality on the owner's genres (Similar vibe) | Owner rates 30 tier-2 result sets; ship tier 2 only if ≥ 70 % are judged useful |
| 9 | Catalog `since` deltas: does the `Music` DO's catalog log cover every change type? | Unit test against each upload op |
| 10 | Real CSS viewport of the A15 for the layout checks | Remote DevTools (`innerWidth`, `devicePixelRatio`) |
| 11 | Ref format for playlists (`music:playlist/<id>`) agreed in [GLOSSARY](../GLOSSARY.md) | Coordinator |
| 12 | The chat's "nostalgic playlist" (§4.2) needs a way to write a playlist into the ported player, which has no verbs | Owner decides whether that small hook comes with the port or after it |

## 18. The audit of 2026-11-10 (owner's ask: bugs and lag, no change to the look, the gestures or the playback idea)

Nothing on screen moved, no animation or gesture changed, and the playback idea is as it was: one
song streams with about a minute ahead, and once it sounds the first seconds of the next three are
fetched for instant skips (`PRELOAD_S`, `HEADS_AHEAD`, `library/heads.js`, untouched).

**The Queue.** Its list now does what the reference's does, with the reference's own selection menu
(`merge_selection_menu_queue_items`, which the port had not used):

- **Delete** takes the selected entries out of the Queue (it was greyed out there). In queue mode the
  list follows; when the playing entry goes, the next one left plays, and an emptied Queue returns to
  the list it interrupted (`Player.removeFromQueue`).
- **Clear Queue** is in the selection menu beside Info/Tags (it was only in the header's menu).
- **A tap on an entry plays the Queue from it** (`Player.playQueueAt`). Before, a copy of the Queue
  played as an ordinary list: Next then jumped to the first unplayed entry, and the list that had been
  playing was forgotten.
- A song queued twice plays twice (its entries were marked played together), and adding to the Queue
  while its second copy plays no longer jumps back to the first.

**Shuffle.**

- **A shuffle goes on after the Queue.** Leaving the Queue started the list's shuffle over, so songs
  already heard came back and Previous had nothing behind it. The list's play order now comes back
  with it.
- **Shuffle All plays every category** (the reference: "Shuffle All Available Songs"). Chosen while
  an album played, it stayed inside that album, and with Advance List stopped at its end. The list now
  widens to every category of the playing list around the playing song, and narrows to that song's
  category when the mode is left (`Player.widenForShuffleAll`).
- A shuffled Queue that gets another song keeps what it has played behind the playing one and shuffles
  only what is still to come.

**A restart.** A phone closes a background tab whenever it wants the memory. The list that was
playing (an album, a playlist, a search), its play order, the Queue, the song and its place all come
back (`player/session.js`); before, the song came back inside the whole library, and a shuffle
started over. The place in the song is saved every ten seconds while it plays, and when the page is
hidden, frozen or closed (it was saved only at a song change or a pause). The category list the
playing list came from is found again too when it is a top-level library list (Albums, Artists,
Genres, Folders, Playlists...: `list/category-ref.js`), so the swipe to the next album, Advance List
at an album's end and the list behind the cover go on as before the restart. Not found again: a list
started from inside an entry's own albums (an artist's album), which plays on without a category.

**Lag** (a 7,500-song library, the page's thread slowed four times, `tests` aside):

| | Before | After |
|---|---|---|
| A skip in DJ shuffle (the plan made again) | 337 ms | 95 ms |
| The first DJ plan | 375 ms | 171 ms |
| Work after every song change | 45 ms and a long task | 28 ms, none |

- After every song the hidden list behind the cover was prepared by sorting the whole library again;
  the sorted All Songs list is now kept for a library and its list options (`ListWidget.sourceStack`).
- The DJ's planner read every song's tags again for each of its thousands of comparisons; they are
  read once for a song (`th/music/dj-tags.js`). The plans are the same, song for song, for the same seed.

Tests: `tests/music-queue.test.mjs`, `music-session.test.mjs` (the player's own logic in Node, through
`tests/fixtures/site-imports.mjs`), `music-queue-browser.test.mjs` and `music-session-browser.test.mjs`
(the real page).

---

## Not built

Sections once marked as proposals that are not built and not in PLAN.md; their full text is in
[archive/NOT-BUILT-2026-11-02.md](../../archive/NOT-BUILT-2026-11-02.md).

- **§8.4 Query words that act as filters.** `by:<artist>`, `album:<name>`, `year:1990s`, `kept`, `unplayed` in the player's search.
  Not built: search forgives accents, word order and a typo, without filters (§8.3's acceptance stays).
- **§16 New feature ideas.** Pick up where the day left off, a mood dial on a mix, a rediscovery shelf, a queue for a time box, beat-aligned DJ transitions, a Guitar link.
  Not built and not in PLAN.md.
