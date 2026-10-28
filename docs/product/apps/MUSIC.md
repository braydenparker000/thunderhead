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
   chips. It never rates songs, never deletes an owner playlist, and never starts sound without an
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

Everything after this section describes later steps. Each is proposed after the port and built only
if the owner agrees.

## Contents

1. Library and data · 2. Screens · 3. Queue, shuffle and repeat · 4. Playlists and mixes ·
5. The engine · 6. Media URLs and failures · 7. Offline · 8. Search · 9. DJ shuffle ·
10. The mind's part (senses, verbs, surfaces) · 11. Import from the old site · 12. Settings ·
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
| Track stats (plays, skips, last played, rating) | `Music.track_stats`, rebuilt nightly from senses | IndexedDB `th-music/stats` plus a local overlay of unsent changes | The phone applies its own changes at once |
| Playlists and mixes | `Core` lists | IndexedDB `th-music/lists` | One list per playlist, with ordered refs |
| Queue and position | Phone only, mirrored to `Core` device state at most every 60 s **[proposal]** | IndexedDB `th-music/session` | So "keep playing on the other device" is possible later |
| Search index and DJ features | `thunderhead-private/indexes/music/` (built by Actions jobs) | Cache Storage `th-music-index` | About 1 MB at 12k tracks; about 1.7 MB at 20k |
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
| Seek bar | The track's waveform (RMS bars from the catalog), played part in accent, rest in ink-3 at 40 %. Plain 4 px line when there is no waveform. Times under it in tabular figures: elapsed left, remaining right (`−1:12`). **Bar rule (the Poweramp reference behaviour):** 100 bars, each the RMS of an equal span of the stored bins; every bar divided by `sqrt(max² + 0.01)`, then raised to the power 1.35. Never draw the stored bytes directly: they are square-root coded (`round(255·sqrt(rms))`) and look flat. A loud, limited master stays fairly even by design; quiet intros and breaks drop. Acceptance: a test renders a fixture with a quiet intro and a break and checks those bars are below 0.7 while the loud sections reach ≥ 0.9 |
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
- A row's long-press menu: Play next · Add to queue · Add to playlist · Go to album · Go to
  artist · Keep offline · Ask about this.

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
| Rated "not for me" (rating 1) | Normal look; excluded from DJ shuffle and mixes |

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
| Manual skip | 400 ms equal-power crossfade. The old track waits at most 500 ms for the new one's first sound, then fades out regardless | Lab: no click above −80 dBFS; outgoing still at about −3 dB at the midpoint with a 300 ms network |
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
  average bitrate, plus 64 KB for tags) and, for Ogg/Opus files, their last 128 KB (Chrome reads
  the end for the length). About 0.4 MB per song.
- They download one at a time, low priority, starting 1.5 s after the current song sounds and once
  it has 10 s buffered. They pause while the current song is rebuffering.
- Only the heads of the next 3 songs are kept; others are deleted when the order changes.
- The service worker answers a song's range requests that a head or tail covers; everything else
  goes to the network untouched. Heads are keyed by `music:<id>` plus byte range, **not** by the
  signed URL, so re-signing never orphans them.
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
- `playbackState` mirrors the engine.
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

---

## 6. Media URLs and failures

### 6.1 Signing

- `POST /v1/media/sign {refs: [...]}` with up to 50 refs. Each URL has `X-Amz-Date` floored to
  the hour and a 3 h expiry, so it is valid for at least 2 h when received.
- The phone signs: the current track, the next 3 (for heads), and covers in view (batched per
  scroll stop, 150 ms debounce).
- Each signed URL is stored with `expires_at`. A URL with under 20 minutes left is re-signed
  before any new load, resume-after-pause or head fetch.
- Signed URLs live only in memory. Caches and OPFS are keyed by ref or sha256.

### 6.2 403 / expiry mid-track

A media element cannot read the HTTP status, so the engine infers:

1. The playing deck errors or stalls (no data for 10 s while online).
2. If its URL has under 20 minutes left, or the error is a network error, the engine re-signs
   that one ref (one call), swaps `src` at the current position, and fades back in.
3. If the fresh URL fails too, the stream-guard backoff takes over: retries 1, 2, 4, 8, 15, then
   every 30 s, each from the current position.
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
| Auth expired (401 from sign) | Pause at the end of the current buffer; the shell shows sign-in; playback resumes after sign-in on Play |

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

### 8.1 Placement and behaviour

- A search field at the top of Mixes, Playlists and Library. Focus → recent searches (last 8, with
  a "Clear" link). Typing runs search on every keystroke for tiers 0–1, with no debounce.
- Results are grouped: **Songs** (tiers 0–1, up to 50) · **Albums** (up to 6) · **Artists** (up
  to 6) · **Playlists** (up to 6) · **Similar vibe** (tier 2, up to 10, after a 150 ms pause in
  typing).
- Enter / tapping a result records the search (§10.1).

### 8.2 Normalisation (applied to queries and to indexed text)

1. Unicode NFKD, remove combining marks (`é → e`, `ñ → n`).
2. Lowercase with `toLocaleLowerCase('und')`; `ß → ss`, `æ → ae`, `ø → o`, `ł → l`.
3. `&` and `+` → ` and `; apostrophes removed (`don't → dont`); every other punctuation → space.
4. Collapse whitespace; trim.
5. A leading article ("the ", "el ", "la ", "los ", "las ") is indexed both with and without it.

### 8.3 Tiers

| Tier | Matches | Order inside the tier |
|---|---|---|
| 0: exact and prefix | Fields title, artist, album, album artist. Ranks: (a) whole title equals query; (b) title starts with query; (c) artist equals query; (d) artist starts with query; (e) album equals/starts with; (f) every query word is a word-prefix somewhere in title+artist+album | By rank a→f, then plays (desc), then title |
| 1: fuzzy | uFuzzy (MIT) over "title — artist — album" for rows not already in tier 0. Allows one typo per word of ≥ 4 letters and out-of-order words | uFuzzy's score, then plays |
| 2: similar vibe | Offline tags generated per song (mood, genre, instrument and tempo words, in English and Spanish) and optional 384-dim vectors | Shown only in its own section; never merged into tiers 0–1 |

Hard rule: tier 2 never changes the content or order of the Songs section. A test feeds the same
query with and without the tier-2 index and asserts the Songs section is identical.

Budgets (A15, 20k-track fixture): tier 0 ≤ 3 ms, tier 1 ≤ 8 ms per keystroke; tier 2 ≤ 25 ms.
Search runs in the main thread for tiers 0–1 and in a worker for tier 2 vectors.

### 8.4 Query words that act as filters [proposal]

`by:<artist>`, `album:<name>`, `year:1990s`, `kept` (offline only), `unplayed`. Unknown filters are
treated as words.

**Acceptance:** a golden set of 60 queries over a generic 2,000-track fixture (typos, accents,
reordered words, articles) with expected top results, run in `node --test`.

---

## 9. DJ shuffle

### 9.1 Data

Per track, computed offline by an Actions job (see [JOBS](../../engineering/JOBS.md)):
tempo (BPM), key and mode (as a Camelot number), energy (0–1), loudness, and a CLAP embedding
reduced to 32 dimensions. The job also writes each track's 50 nearest neighbours. Total on the
phone: about 1 MB at 12k tracks. Licence rule: librosa, pyloudnorm, CLAP (Apache-2.0); no GPL tools.

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

Not verbs, on purpose: rating, deleting an owner playlist (ask-first class), changing sound
settings, clearing offline copies.

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
8. Spanish titles are not marked `lang` per row (unknown per track); the UI chrome is `lang="en"`.

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

## 16. New feature ideas (all [proposal])

1. **"Pick up where the day left off."** At the day roll the mind notes what was playing at the end
   of the evening; the next morning, opening Music offers that album from the track after.
2. **Mood dial on a mix.** A mix's page has a 3-step dial (calmer · as is · livelier) that re-ranks
   the mix by energy from the DJ features, instantly, on the phone. Each turn is a sense, so the
   mind learns the recipe was off.
3. **Rediscovery shelf.** A Library section "Not heard in a year" built locally from stats: songs
   with ≥ 5 old plays and none in 365 days. No mind call needed.
4. **Song-length-aware queue for a time box.** "Play 25 minutes" (from the Thunderhead or the
   ··· menu) builds a queue whose durations sum to 25 min ± 30 s, ending on a track with a
   natural fade.
5. **Gentle transitions in DJ mode.** When both tracks have beat grids (from the analysis job), a
   DJ-mode crossfade of 8 s aligns downbeats; otherwise the normal crossfade.
6. **Guitar link.** A song that also exists as a tab in Guitar shows a small guitar glyph; tapping
   it opens the tab at the same position ([GUITAR](GUITAR.md) §12).

---

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
