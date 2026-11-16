# Astra (new)

The ground-up rebuild of Astra, the media module. The home tile opens it.
Classic Astra (`frontend/media/`) is retired. Its software decoder (libmedia)
lives on in `frontend/assets/libmedia/`, and My Media hands files Chrome
refuses to this engine.

Design reference: Nuvio (Android) for screens and behaviour, Stremio's web
client for browser-only details. Both are GPL; nothing is copied from either.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `src/main.js` | The app at `/astra/`. Installable (`manifest.webmanifest`); `sw.js` opens it from a saved copy (below). |
| `src/app/` | `app.js` (tabs, screen stack), `playing.js` (from the tap on a stream to the player playing it, another source or episode, saving progress), `store.js` (saved data under `astra.v2.*`), `content.js` (rows, hero, what Play means), `cache.js` (add-on answers kept between visits), `back-stack.js` (Android back, one history entry per open screen, sheet or menu), `recovery.js` (the card shown when Astra cannot start), `skip.js` (Skip intro's two sources, merged), `intro-store.js` (what Skip intro has learned, in IndexedDB), `ready.js` (getting ready on Streams before a tap) and `next-ready.js` (the next episode made ready before Next). |
| `src/screens/` | Home, Details, Streams, Catalog ("View all"), Search and Discover, Library, Settings. |
| `lab/`, `src/lab/` | Playback lab at `/astra/lab/`: play a link or a stream from your add-ons, see what the file holds and how it plays, switch audio and subtitles, copy a report. |
| `src/engine/` | The playback engine (below). `player.js` is `AstraPlayer`; its parts are mixed into it: `player-start.js` (each pipeline), `player-subtitles.js`, `player-libass.js` (styled subtitles), `player-second.js` (the second subtitle), `player-sound.js` (the sound features' engine side), `player-data.js` (data used and the data saver), `player-routes.js` (what a failed route teaches), `player-report.js` (the lab's report), `adaptive.js` with `adaptive-tuning.js` (HLS and DASH). Reading: `probe.js`; the range reader `http-source.js` with `source-stream.js` (one download), `source-blocks.js` (the bytes held), `source-tuning.js` (read-ahead and cache by bitrate), `side-read.js`, `source-tail.js` (the film's end beside its start) and `film-memory.js` (a film's header and index remembered); `mkv.js`, `mkv-cluster.js`, `mkv-attachments.js` (a film's fonts), Astra's own Matroska packet reader `mkv-packets.js` with `mkv-blocks.js` and `mkv-sink.js`; `mp4.js`, `chapters.js`. Deciding: `plan.js`, `capabilities.js`, `route-memory.js`. Playing: `remux.js`, `remux-audio.js`, `sound-stream.js` (converted sound from Astra's own Matroska reader), `sound-six.js` (converted surround kept whole for Headphone surround), `fragments.js`, `early.js`, `mse.js`, `downmix.js`, `audio-decoders.js`, `stall-watch.js`; `software.js`, `software-sound.js` (libmedia) and `software-threads.js` (its threads, switched off). Subtitles inside the file: `embedded-subtitles.js`. Skip intro by sound: `sound-tap.js`, `fingerprint.js`, `fingerprint-match.js`, `intro-finder.js`. Also `file-hash.js`, `labels.js`, `languages.js`. |
| `src/player/` | The full-screen player (Nuvio's layout and gestures). `player-screen.js` opens, loads and closes; its parts each have `close()`: `view.js` (the elements), `controls.js`, `menus.js` and `subtitle-menu.js`, `surface.js` with `gestures.js` (pure) and `zoom.js`, `timeline.js` (the seek bar), `keys.js`, `video-events.js`, `markers.js` (Skip and the next-episode card), `loading.js` (waiting, errors, notices), `system.js` (full screen, picture-in-picture, wake lock, lock-screen controls). `extras.js` gathers the rest: `playback.js`, `sleep.js`, `repeat.js`, `sound-only.js`, `resume.js`, `marks.js`, `frames.js`, `find.js`, `info-extras.js`, `sound-menu.js`, `picture-menu.js`. Pure rules in `rules.js`, saved choices in `prefs.js`, another app in `external.js`; styles in `player.css` and `player-extras.css`. |
| `src/enhance/` | Sound and picture: `sound.js` and `sound-chain.js` (boost, night mode, dialogue, sound later), `loudness.js` and `leveller.js` (even loudness), `headphone.js` (headphone surround); `picture.js`, `filter.js` and `fsr.js` (sharpening and smoother banding in WebGL2, after AMD FSR 1.0), `anime4k.js` with `anime4k-upscale.js` and `anime4k-restore.js` (Anime4K's shaders), `tonemap.js` (HDR to the screen, BT.2390); see `LICENSES.md` there; `origin.js` (whether the page may read what the video shows). |
| `src/ui/` | Icons drawn for Astra, poster cards, the long-press lift menu, sheets, toasts and small DOM helpers. |
| `src/subtitles/` | `parse.js` (SRT and WebVTT), `markup.js` (times and inline markup), `ass.js` (ASS and SSA), `charset.js` (old code pages), `renderer.js` (draws cues over the video), `libass.js` (ASS/SSA drawn by libass), `pgs.js` and `vobsub.js` (picture subtitles). |
| `src/addons/` | The Stremio add-on protocol client (`client.js`), TorBox link resolution (`debrid.js`), subtitle add-ons (`subtitles.js`), what a stream's label says (`stream-facts.js`) and how it will likely play here (`device-facts.js`), and the optional skip-times lookup (`skip-times.js`). |
| `src/styles/` | `tokens.css` (colours, type, radii, motion and shared controls) and `app.css`. |
| `vendor/` | Mediabunny 1.66.0 and its AC-3, DTS and TrueHD decoders, hls.js 1.6.13, dash.js 5.2.0 and JASSUB 2.5.37 (libass), copied by `node scripts/astra/vendor.mjs` from the npm packages pinned in `vendor.json`, which also holds a hash of every file (see `vendor/LICENSES.md`). |
| `fonts/`, `icons/` | Inter (SIL OFL 1.1, `fonts/LICENSE.md`) and the app's icons. |

## The app

- Four tabs (Home, Search, Library, Settings) stay alive, so switching keeps
  each one's scroll; the floating nav shrinks to icons once a page scrolls.
  Back from another tab returns to Home; back on Home leaves the app.
  Every open screen, sheet and menu is one history entry (`back-stack.js`);
  a screen opened while a menu is closing waits for that menu's entry to go,
  and a reload on an open screen first returns the history to Home.
- Long-press opens one menu (Android's own long-press is folded into it), and
  the release of that press never taps an item. Sheets (Nuvio's floating
  card) close with a drag on their top, following the finger, or a quick
  flick.
- Anything that removes or replaces what you have (remove or replace an
  add-on, clear Continue Watching, copy again from classic Astra, reset
  Astra's data) asks first in a centred dialog, Cancel beside the action
  (`confirm()` in `src/ui/components.js`). Back, Escape or a tap outside
  cancel; a second tap on the action, or on a sheet row, runs nothing.
- Page headers stay at the top while their page scrolls (Library, Settings
  and its pages, View all, and Streams' add-on chips).
- **Home**: a hero of up to eight titles with art that turns every 8 s (or
  by swipe), Continue Watching, then one row per add-on catalog that needs no
  search text. Long-press any poster to save it or mark it watched.
- **Details**: Play says what it will do (Play, Resume, Play S1 E2,
  Upcoming). Series open on the season of the next unwatched episode. The
  page draws at once from the card that was tapped (its art, title and, when
  the catalog has it, the description) and fills in when the full details
  arrive; the hero art is kept, not re-faded. The story shows three lines;
  "Show more" appears only when that cuts it, at any width, and a tap on the
  story opens it too.
- **Streams**: every add-on is asked at once and fills in as it answers, in
  the add-ons' own order, with a chip per add-on. Each add-on's section holds
  its place with placeholder cards while it is asked and is filled in place,
  so cards already on screen never move to a new element under the finger.
  Continue Watching opens Streams at once from what was saved. Nothing is
  ranked or picked for you. Long-press a stream to copy it, play it in
  another app, open it in VLC or check it in the lab (the stream goes to the
  lab in the address's fragment, which never reaches a server or a cache,
  and the lab takes it out of the address bar once read). TorBox links from
  add-ons are resolved to the file at the press that starts a tap (with Get
  ready ahead on), else at the tap.
- **Get ready ahead** (Settings › Playback, on by default; `app/ready.js`,
  `app/next-ready.js`). With it on and the data saver off, what a tap will
  need is asked for while the list is read: when streams are listed Astra
  opens a connection to TorBox and reads the owner's own TorBox list, once
  per account (`addons/debrid.js` keeps it in memory ten minutes, never
  stores it); a finger coming down on a TorBox stream starts resolving it,
  and the tap that follows takes that answer (a press that becomes a scroll
  or a long-press starts nothing more); and the sound converter a listed
  stream's label asks for, when this phone would convert that sound, is
  fetched ahead on an unmetered connection (on a metered one only when it is
  already in the saved copy). While an episode plays, once the next-episode
  card is due (or a known outro is two minutes off), the next episode's
  streams are collected; only when the stream playing names a release group
  and one of them has the same group is that stream resolved and its file
  described (header and index, nothing of the picture or sound), then
  closed. Next within ten minutes takes that list. With the switch off, or
  the data saver on, nothing is asked of TorBox, an add-on or a film's host
  before a tap. Either way nothing plays without a tap, and no stream is
  ranked, picked or pre-selected.
- **What a stream card says.** Its size and, when the title's runtime is
  known, what an hour of it costs ("710 MB an hour"). Under it, one quiet
  line on how it will most likely play on this phone (`device-facts.js`):
  "Plays directly", or "Needs the software decoder (uses more battery)" with
  a dot. It is read from the label (codec, picture size, 10-bit or HDR) and
  the browser's own answer to whether it decodes that smoothly and
  power-efficiently (`navigator.mediaCapabilities.decodingInfo`, asked once
  per codec and size a visit), never from the browser's name. An MP4 that
  names no codec is asked as H.264; an MKV or WebM that names none says
  nothing; without an answer from the browser only 8-bit H.264 is said to
  play directly. A second note, "Sound converted on the phone", shows when
  the label names Dolby Digital or DTS and no AAC, Opus, MP3 or FLAC, unless
  every sound it names is one this phone's browser says it plays as it is
  and has not failed to here (How a file plays, below). The
  line's room is held before the answer arrives, so nothing moves under a
  finger. Both inform only: nothing is hidden, ranked or picked by them.
- **The owner's filter chips** (a second row under the add-ons'; the
  reading is in `stream-facts.js`): Smallest first, one size limit (under
  700 MB, 1.5 GB or 3 GB), any of 720p, 1080p, 4K and SD, any of HEVC and
  AV1, and Clear. They are kept between titles, the list's footer says how
  many they hide, and with a size limit on a stream of unknown size is
  hidden (it may be any size). A stream's size comes from the add-on's own
  number, else the first size in its name, description or file name, read
  as people write it: "1,400 MB", "1.4 GB", "700MiB", "1 400 MB"; one
  separator before three digits groups thousands in KB and MB but is a
  decimal point in GB and TB ("1.400 GB" is 1.4 GB). A picture size is read
  with sizes taken out ("720 MB" is not 720p) and "1920x800" by its width; a
  written 2160, 1080 or 720 wins over the words UHD and 4K. Codec names may
  run into a bit depth ("HEVC10bit"). A word is a word only between
  non-letters, so "1080p_x265" is read as both.
- **Nothing plays without a tap.** The next-episode card and skip buttons are
  taps; there are no countdowns. Next, or an episode picked in the player,
  stops what plays and collects that episode's streams: when the stream
  playing names a release group (`bingeGroup`) and one of the new streams
  has the same group, that one plays on; otherwise the player shows the
  episode's sources, through your filters (those they hide are counted and
  can be shown), and loads nothing until you pick one. Getting the next
  episode ready (Get ready ahead, above) follows this same rule and only
  saves the waiting; it never plays it.
- Progress is saved every 10 s while playing, and on pause, close and leaving the app. Streams under 121 s are
  placeholder clips and are not tracked. At 90% a title counts as watched and
  Continue Watching offers the next episode instead. A resumed film saves
  nothing until it has reached its saved place (or played a minute), so the
  early times of a resume never overwrite it.
- **Settings**: appearance, which catalogs Home shows, add-ons (install,
  enable, reorder, configure, remove), playback and your data (export,
  restore, clear). Install takes what people paste (`stremio://`, a
  `/configure` page, a trailing slash or `#…`), installs on Enter, ignores a
  second tap while checking, and offers to replace an add-on already
  installed from another address (same manifest id). Each add-on says
  Loading…, Active, or why it could not load, with Retry.
- **Settings › Playback**: touch gestures, the hold speed (1.25x to 3x),
  the pause overlay, picture size, rotation, picture-in-picture on leaving
  the app, **Save mobile data** (Automatic, Always, Never; below) and **Get
  ready ahead** (on unless turned off; above; an Astra setting, so it is in
  a backup). Under
  **Skip intro**: **Find intros by sound** (on unless turned off; works on
  this phone and sends nothing) and **Look up anime skip times** (off unless
  you turn it on; see Skip intro below). Then OpenSubtitles on or off, and
  the remembered audio and subtitle languages with a way to forget them.
  Subtitle style is set in the player.

## When add-ons misbehave

- **At the boundary**: `fetchManifest` normalises every manifest
  (`normaliseManifest`: catalogs, extras, resources, types and id prefixes
  are arrays; catalogs without an id and type are dropped) and `normaliseMeta`
  every title (names as string lists, season and episode as numbers or null,
  unreadable dates dropped and counted as aired). Home, Search and Discover
  also skip, one add-on at a time, anything that still fails. An answer
  larger than 5 MB is refused as soon as that is known, and one that never
  ends is cut there, so it cannot fill the phone's memory.
- **Failures are shown, not hidden**: a Home row whose catalog fails keeps
  its title with "Couldn't load this row · Retry"; Streams marks an add-on
  that did not answer and offers Retry for it alone; Search says "Couldn't
  search" when every add-on failed, and names the add-ons still being waited
  for once others have answered; Details says "Couldn't load details" (Play
  waits for a series' episodes) and tries again when the add-ons or the
  connection come back. Browser errors read as sentences ("The add-on took
  too long", "The add-on answered 404"; `addonError` in `client.js`).
- A series whose videos have no seasons (channels) lists them under Videos.
- On first launch Astra copies add-ons, library and progress from classic
  Astra (`astra.v1.*`) once, and leaves the classic data as it was.

## Opening fast

- **A saved copy of the app** (`sw.js`, over https). A release of Astra is
  named in the site's `/release.json` (`components.astra.tree`: a hash of
  every file under `frontend/astra` as staged, so a commit elsewhere in the
  site is not a new release) and listed with a hash of each file in
  `/astra/files.json` (`scripts/astra/files.mjs`, written by
  `scripts/stage.mjs`). The first visit saves the app's own files whole
  (`vendor/` is saved when a film first needs it); later visits open from the
  saved copy, offline too, and look for a newer release in the background
  (one small request). A newer release is saved whole before open pages are
  told: a file whose hash did not change is copied from the release in use,
  the rest are fetched and checked against their hash, and a try that fails
  or is cut short (or meets a deploy part-way) is never used, and is carried
  on from where it stopped on the next visit. A page keeps the release it
  started on until it is closed, even when the worker is stopped and started
  again (each page's release is kept in `astra-sw-state`), and so do the
  workers it starts; no release a page is open on is deleted. The page
  offers **Reload** until it is tapped or put off with **Later**. Pages are
  saved by address without their query (a stream address in one is never
  kept). Files Astra loads from outside its folder (`/assets/`, `/config.js`,
  `/th/`) are not saved: they always come from the network and must keep
  working with an older Astra. On a local `http` server the worker is off
  unless `localStorage` `astra.dev.sw` is `1`.
- **Add-on answers are kept** (`src/app/cache.js`, Cache Storage
  `astra-data-v1`). Manifests (6 h), Home's catalogs (30 min) and title pages
  (12 h) paint at once from the last answer while a fresh one is fetched;
  Home redraws only the rows that changed, keeping where they were scrolled.
  Entries unused for a week are dropped.
- **Nothing waits on a slow add-on.** Manifests have 6 s; Home starts 2.5 s
  after the first one answers and adds the rest as they come. Catalogs load
  four at a time, title pages ask every add-on at once. When no add-on
  answers, Home says so with Retry, and tries again when the phone is back
  online.
- **Only the start-up code loads at start-up.** `index.html` preloads the
  modules `main.js` imports (`tests/astra-startup.test.mjs` keeps the list
  exact); the player and the engine load on the first Play, fetched early
  while Details or Streams is open. Skip intro's finder, its store and the
  lookup load with the first episode; JASSUB with the first styled
  subtitle; hls.js, dash.js and each audio decoder with the first film that
  needs it.

## Saved data

Astra's own data is kept in this browser under `astra.v2.*`
(`src/app/store.js`).

- Each saved value is checked when read: a damaged entry is dropped and a
  value of the wrong shape counts as unsaved, so one bad value cannot stop
  the app. If Astra still cannot start, a card (`src/app/recovery.js`)
  offers **Export raw data** (what is stored, as text) and **Reset Astra
  data** (removes only `astra.v2.*`; classic Astra's data stays and is
  copied again, as on a first launch).
- A backup holds add-ons, library, progress, watched, settings (Skip
  intro's two switches among them) and recent searches.
- **Restore** (Settings > Your data) checks the whole file first. A file that
  isn't an Astra backup, or has a part of the wrong shape, is refused and
  nothing changes; damaged entries inside a good part are skipped and
  counted. Otherwise it replaces this device's data all or nothing: what the
  backup lacks is removed. Player choices (speed, volume, brightness, the
  Sound and Picture settings, the data saver, subtitle style), Library
  layout and sort, and the last stream filter stay, because they describe
  this phone rather than what you saved or watched. The message says what
  came back.
- After a restore or "Copy again from classic Astra" nothing is written until
  the reload, and progress is only written when there is something new to
  save, so leaving the page cannot undo either.
- Two Astra windows (the installed app and a Chrome tab) share the data. Each
  follows the other's changes, and a write changes only its own entries in
  what is stored now: progress entry by entry (the later save wins), add-ons
  by addition, removal, switch and order.
- When the browser cannot save (storage full, or site data blocked) Astra
  says so once instead of failing silently; with site data blocked it still
  opens.
- What Skip intro learns by sound is kept apart, in IndexedDB `astra-intro`
  (`src/app/intro-store.js`; localStorage is too small for fingerprints): at
  most 60 series, the most recently used kept, and eight episodes each. It
  is not in a backup and Reset leaves it; without IndexedDB nothing is kept.
- A film's header and index are kept in IndexedDB `astra-films`
  (`src/engine/film-memory.js`; How a file plays, below), and what this
  phone's decoders failed at in localStorage `astra-routes`
  (`src/engine/route-memory.js`). Neither is in a backup, Reset leaves both,
  and neither holds an address.

## How a file plays

`AstraPlayer.load()` (`src/engine/player.js`) reads the file, decides once
how it plays and plays it; it never switches pipeline mid-play. In detail:

1. **Read before playing** (`probe.js`, `http-source.js`, `mkv.js`,
   `chapters.js`). The range reader (5. below) opens the file and reads
   only what describing it asks for. The header gives the container, video codec and frame
   rate, every audio track (language, codec, channels), every subtitle track
   and the chapters (Matroska's own, or an MP4's chapter list), offered as
   `engine.chapters` before playback starts. If the host does not let a web
   page read the file (CORS) or ignores ranges, that is known at once; a
   playlist is known by its address or its type even then.
2. **Decide once** (`plan.js`, pure, tested in `tests/astra-plan.test.mjs`).
   Using answers from the browser itself (`capabilities.js`): `remux` for
   every film the page can read and Astra can unpack, a plain one-track
   MP4 or WebM too (so it has the data saver, the read-ahead by bitrate, the
   data count, the sound features and reconnecting); `native` (the browser
   plays the address itself) only for a host that does not let the page
   read the file, a file written like a live recording (Matroska clusters
   of unknown size), or a picture or sound Astra cannot unpack that the
   browser plays (VP8 has no place in the MP4 that Media Source takes);
   `software` when the phone has no browser decoder for the video
   (HEVC, AV1 or VP9 without hardware support, 10-bit H.264, and the older
   codecs in the table below), when Mediabunny cannot read the container
   (AVI, FLV, MPEG-PS) or did not list the picture (MPEG-2 in a transport
   stream), `hls`/`dash` for adaptive streams, or `unsupported` with a
   reason and an offer to play the file in another app. A plain MP4 or WebM
   the browser would play whole is marked so (`whole`): if unpacking it
   fails before the first picture, it goes to the browser once, by itself
   (`player-start.js`). Audio tracks are `direct` (AAC, Opus, FLAC, MP3, and
   Dolby Digital, Dolby Digital Plus and DTS where the browser says it
   decodes them: passed to the phone's own decoder, surround kept, no
   converter downloaded), `rebuilt` (AC-3, E-AC-3 and DTS elsewhere, Dolby
   TrueHD, Vorbis, PCM and G.711: decoded and re-encoded to Opus on the
   device; each decoder downloads only when a film needs it; in a Matroska
   film the decoder is fed block by block from Astra's own reader,
   `sound-stream.js`, so such sound starts as fast as the picture; with
   Headphone surround on, 5 to 8 channels are kept whole as uncompressed
   FLAC, `sound-six.js`) or `unsupported` (ALAC
   and other codecs no browser decoder exists for); a file with
   only unplayable audio can be played without sound when the viewer asks.
   Dolby Vision profiles are read from the MKV header and explained
   (profile 5 has no standard picture underneath).
   **What a failed route teaches** (`player-routes.js`, `route-memory.js`,
   localStorage `astra-routes`, per device, each entry for 30 days so a
   browser update gets another chance). A browser can say it decodes Dolby
   Digital or DTS and then fail: a decode error, a failed start, or a sound
   buffer that stays empty for 5 s while the picture's holds 2 s switches
   that sound to `rebuilt` at the same place, once per film, and later films
   start rebuilt; if the rebuilt sound fails the same way straight after,
   the sound was not the cause and the memory is taken back. A picture that
   fails in the browser's decoder and then plays in the software decoder is
   remembered by its codec string (at most 40), so the next film with it
   starts in software; Try again, when the software decoder failed too,
   forgets it.
3. **Play** (`remux.js`, `mse.js`, `early.js`, `downmix.js`). Video packets
   are re-wrapped as fragmented MP4 untouched, in half-second fragments, so
   the phone's hardware decoder does the work;
   audio has its own SourceBuffer, so changing track refills only the audio.
   Fragments carry absolute timestamps, so a seek outside the buffer starts
   fresh pipelines at the nearest key frame, and a seek inside what is
   already buffered (or just ahead of where reading is) starts nothing. Text
   subtitles in MKV and MP4 are read from data already downloaded
   (`embedded-subtitles.js`) and drawn by `src/subtitles/renderer.js`;
   picture subtitles (PGS, VobSub) are decoded only while chosen. Files whose
   timestamps start after zero (MPEG-TS) are shifted to start at 0:00, and
   their chapters and subtitles with them. A film the browser plays itself
   from a host that lets the page read it (the one-time fallback above) is
   asked for with CORS, so the sound features and frame capture work on it
   too.
   **Astra's own Matroska reader** (`mkv-packets.js`, `mkv-blocks.js`,
   `mkv-sink.js`; `TUNING.ownMkv` in `remux.js`, on). For a Matroska or
   WebM film the picture and the sound passed through as they are are read
   here rather than by Mediabunny, which loads a whole cluster (up to 5 MB
   or 5 s) before it hands out its first packet: each block is handed out
   as soon as its bytes have arrived, so a start or a far seek waits for its
   first frames, not for the cluster. A seek goes by the cue index kept from
   the description, straight to the key frame's block where the cue says
   where it sits. Mediabunny still reads a film without cues, a track with
   zlib compression, encryption or more than one encoding, and anything the
   reader meets mid-film that it will not guess at (an element larger than
   its cluster, a second cluster time, a cue that points at no block, lace
   sizes that do not add up): that ends its use for the film
   (`MkvFallback`), and Mediabunny's reader takes over from the place
   playing. Converted sound (Dolby Digital, DTS, TrueHD where they are
   `rebuilt`) is decoded through Mediabunny's own sample reader, which still
   reads it a whole cluster at a time.
   A watchdog (`stall-watch.js`) looks once a second at a film that is stuck
   with nothing on its way: it steps over a hole of up to three seconds in
   the sound or the picture; when the sound ends before the picture, the
   film carries on from the same place without sound (the stream's notes say
   so), rather than stopping for good.
   HLS and DASH streams play through hls.js and dash.js, served from Astra's
   own `vendor/` and loaded only when such a stream is played, with a
   phone's settings in place of their desktop defaults
   (`adaptive-tuning.js`): a level no larger than the player shows it (its
   size times the screen's pixel ratio, counted at most 2, so a phone held
   sideways is not given 4K), 40 s read ahead and 30 s kept behind, and with
   the data saver on 20 s ahead and a ceiling of 720p (where a stream does
   not give picture sizes, 3 Mbit/s); the saver's change reaches a stream
   already playing.
4. **Software decoding** (`software.js`): libmedia's AVPlayer (LGPL-3.0,
   served from `frontend/assets/libmedia/`, loaded only when needed) decodes with
   WebCodecs where the browser has the decoder and WebAssembly otherwise,
   into a MediaStream on the same `<video>`, reading through the same range
   reader. The session gives the element the file's clock, so the player,
   subtitles and picture-in-picture work unchanged. If Astra's own unpacking
   or Chrome fails to decode before the first frame, playback switches to it
   once by itself. A decoder that gives up while the film plays (a hardware
   decoder taken away, a seek into an open GOP in Chrome's own H.264
   decoder) is met first with a fresh pipeline at the same place, with
   fragments only at key frames, then with the software decoder there. A file whose picture has no decoder stops
   with that reason at once; one whose sound has none plays with a notice.
5. **Reading the file** (`http-source.js` with `source-stream.js`,
   `source-blocks.js`, `source-tuning.js`, `side-read.js`, `source-tail.js`,
   `film-memory.js`). Playback's reads pull one download along (two at
   most), held in 1 MiB blocks; a read is answered as soon as its own bytes
   have arrived, not when its block is whole, and a read far inside a block
   is fetched from its own byte.
   - *While a film is described*, only what is asked for is fetched: a
     download stops 64 KiB past the last byte asked of it (and never runs
     more than 2 MiB ahead), since where playback starts is not known yet;
     resuming halfway then closes the connection at the start.
   - *Read-ahead by bitrate* (`source-tuning.js`). Once the size and the
     length give the film's bitrate, a download runs about 10 s of the film
     past the furthest byte read (5 s with the data saver), never under
     2 MiB nor over 24 MiB (8 MiB with the saver); before that, the byte
     limit alone. It asks for that in bounded requests, the next part once
     playback has come within half a reach of its end, so a seek or a stop
     throws away little the connection already carried (a host that ignores
     a range's end is read open-ended and paused instead). The block cache
     keeps 80 s of the film at its bitrate (a 30 s back-seek, the pipelines'
     40 s and the reach; 55 s with the saver), between 16 and 96 MiB.
   - *Both ends at once* (`source-tail.js`). On a film's first open, as soon
     as the first answer gives the size, its last 64 KiB are asked for beside
     its start, in a request of their own: the subtitle hash needs them, and
     a short film's index (Matroska's cues, an MP4's index written at the
     back) often lies there too, so a read of
     the end waits for those bytes instead of costing another round trip.
   - *A film remembered* (`film-memory.js`). What describing a film read is
     kept in IndexedDB `astra-films`: at most 4 MB a film and 60 films, the
     least recently opened dropped first. A film is known by its size and a
     SHA-256 of its first 64 KiB, never by its address (which carries
     secrets). On the next open, once those 64 KiB have arrived (the lookup
     waits at most 1.5 s), the description's reads are answered from memory
     and its end is not asked for; a kept range is used only when size, hash
     and its own checksum match, a damaged entry is dropped and replaced, and
     storage that fails or is missing changes nothing but the cost.
   - *Side reads* (`side-read.js`): the film's end beside its start, and the
     first part of a block a seek's download began inside (fetched once
     playback is under way, for the subtitle scanners), are bounded
     requests of their own that never end, starve or redirect a download
     playback reads from; their bytes count in what the film cost.
   - *Waiting or asking.* A read just ahead of a running download waits for
     it only when the download will get there within about a second at the
     speed it has shown (at least 256 KiB, at most 12 MiB); further ahead,
     the read asks for its own bytes, so a resume ten seconds in does not
     wait for megabytes the viewer skips on a slow link.
   The subtitle readers only peek at what playback already fetched, so they
   cost nothing and never pull the download along. A seek ends the
   downloads and reads of the place it left, so the new place has the whole
   connection. A download that breaks off after bringing a fair part of the
   file (a host that cuts every connection after so many bytes) is continued
   from the byte it reached; one that brings nothing is tried again with a
   growing pause for up to a minute (at once when the phone is back online)
   while the buffer plays. When the network changes (Wi-Fi to mobile data,
   or back online), a download that has brought nothing for 3 s is asked
   again at once, without counting a failure. `engine.dataUsed()` is what
   the film has downloaded so far, as the reader counts it (for HLS and
   DASH, as their players count it).
6. **The data saver** (`player-data.js`, Settings > Playback > Save mobile
   data). Automatic by default: on when the phone asks to save data or is on
   a mobile network. With it on, the reader reads about 5 s of the film
   ahead instead of 10 (at most 8 MiB instead of 24), the cache keeps 55 s
   instead of 80, the pipelines keep 20 s ahead instead of 40, HLS and DASH
   are held to 720p and 20 s ahead, and nothing is got ready before a tap; a
   change applies to the film that is playing. With the earlier fixed
   read-ahead (8 MiB instead of 24), a three-minute 3.3 Mbit/s film, 40 s
   in, had downloaded 32 MB instead of 56.
7. **Another app**: when nothing in the browser can play a file, the player
   offers it to the phone's video apps (VLC, MX Player…) through an Android
   intent with the title and position (`src/player/external.js`).

### What plays (measured 2026-11-10)

Seventy-two short test films, one for each container and codec pairing
worth trying, were played through `/astra/lab/` in desktop Chrome (which has
no HEVC decoder of its own, so HEVC shows the software route): 57 play,
11 stop with a reason and 4 still fail (as of 2026-11-11; on the 10th it
read "56 play, four of them without sound", and that was the checker's
fault: see MPEG Layer II below).
Before this pass 38 of the first 64 played and 14 showed black or stalled.
These counts were made with Mediabunny 1.55.7, before the TrueHD decoder
and the engine work of 2026-11-15, and the matrix has not been run again
since. Dolby TrueHD, then among the files that stop, now plays
(`truehd.mkv` in `tests/astra-play-browser.test.mjs`).

| Picture | Where | How |
|---|---|---|
| H.264, VP9, AV1 | MP4, MOV, MKV, WebM, TS, M2TS | the phone's decoder (`remux`; when the matrix ran, a plain MP4 or WebM went `native`) |
| H.264 | FLV | software decoder |
| HEVC (8 and 10 bit) | MP4, MKV, TS | the phone's decoder where it has one, else software |
| VP8 | WebM as it is; MKV in software | |
| MPEG-4 ASP (Xvid, DivX), MS-MPEG4, WMV 7/8/9, Motion JPEG | AVI, MKV; MPEG-4 also in MP4 | software decoder |
| MPEG-1, MPEG-2 | MPG, VOB, TS, MKV | software decoder |
| Theora | MKV | software decoder |

Sound: AAC, Opus, FLAC and MP3 as they are; AC-3, E-AC-3, DTS, Dolby
TrueHD, Vorbis, PCM (every kind in MOV and MKV) and G.711 (µ-law and A-law,
in MOV) converted as they play, and so is MP3 in a MOV file (or, all but
TrueHD and G.711, decoded by the software decoder when it plays the file);
Windows Media Audio and ADPCM in an AVI.

Stops with a reason (and the offer of another app): the Windows Media
container (WMV, ASF) and RealMedia, which nothing here unpacks; Theora in
an Ogg file; H.263 in 3GP; Motion JPEG in MOV; Sorenson Spark in FLV;
ProRes; a file whose only sound is ALAC or WMA in an MKV. Still
broken: H.264 inside an AVI, where libmedia 1.3.1 fails on a stream with
no decoder setup in its header ("Offset is outside the bounds of the
DataView" in its worker); it stops with "could not show a picture" after
six seconds of sound.

**MPEG Layer II** (the usual sound of VCDs, DVDs' MPG files and DVB
recordings) plays, in MPG, TS and, since 2026-11-11, MKV. There is no
decoder build for it: libmedia's MP3 build decodes all three layers, its
MPG and TS readers already name that sound MP3, and a Matroska file's
track is renamed as it is read (`fixMkvLayers` in `engine/software.js`).
The note of 2026-11-10 that MPG and TS played "without sound" was wrong:
`scripts/astra/tone.cjs` listens to the video element, and the software
decoder plays through its own audio graph. `scripts/astra/heard.cjs` taps
what really reaches the speakers and hears the test tone in all of them.

The decoders added on 2026-11-10 (`mpeg2video`, `mpeg4`, `msmpeg4`,
`mjpeg`, `theora`, `h263`, `wmv`, `wma`, `speex`, `adpcm`, `vvc`) are the
unmodified builds from the same libmedia commit as the rest
(`frontend/assets/libmedia/licenses/`). VVC, Speex and H.263 in an AVI are
wired but were not tried: no test film could be made here.

### How smoothly (measured 2026-11-10)

`scripts/astra/smooth.cjs` on a three-minute 1080p H.264 film at 8 Mbit/s
with Dolby Digital 5.1 (converted as it plays) and a second AAC track, in
desktop Chrome; the slowed columns have the page's thread six times slower
and the connection limited to 20 Mbit/s, which is nearer a slow phone.
Measured with Mediabunny 1.55.7, before the engine work of 2026-11-15; not
measured again since.

| | Fast machine | Slowed, 20 Mbit/s: before | after |
|---|---|---|---|
| First frame | 0.7 s | 5.2 s | 4.1 s |
| Seek two minutes ahead | 0.4 s | 6.6 s | 1.8 s |
| Seek six seconds on, inside the buffer | 0.06 s | 2.4 s | 0.05 s |
| Seek back to the start | 0.5 s | 2.5 s | 1.1 s |
| Frames dropped in 15 s of play, stalls | 0, 0 | 0, 0 | 0, 0 |

Three things made the difference.

- **A seek has the whole connection** (`http-source.js`, `jumped()`). The
  downloads of the pipelines being dropped went on filling their read-ahead
  and took half the connection from the place playback was waiting for; they
  are closed and their waiting reads ended (`tests/astra-source.test.mjs`).
- **Converted sound starts at once** (`downmix.js`). Mediabunny mixes to
  stereo in five-second blocks, so Dolby Digital and DTS could not start
  until five seconds of the file had been read. 48 kHz sound is now mixed
  here a sample at a time; other rates still go through Mediabunny, which
  also resamples (`tests/astra-downmix.test.mjs`).
- **The picture arrives in half-second fragments** (`early.js`). Mediabunny
  closes a video fragment only at the next key frame, so the first picture
  waited for a second Matroska cluster. A fragment is now cut every half
  second at a frame shown after all before it, and its first frame written
  back as the ordinary frame it is, as chunked CMAF streams do
  (`tests/astra-early.test.mjs`; `scripts/astra/rewrap.mjs` re-wraps a film
  to a file for ffmpeg, which decoded every frame of nine films, HEVC, VP9
  and AV1 among them, with the same key frames as their sources).

The audio decoder (1.2 MB for Dolby Digital, 1.7 MB for DTS, 0.7 MB for
TrueHD) also downloads while the first video is read instead of before it.

What is left, and why: these figures were taken when the first frame
waited for one whole Matroska cluster (up to 5 MB or 5 s), because
Mediabunny (1.66 as well) reads a cluster whole before it hands out its
first packet, and for the whole 1 MiB block of the reader that holds its
end: on a connection of 300 kB/s, 3.2 s for the small test film (one
block) and 10.3 s for a 3.3 Mbit/s film with 5 s clusters. Neither wait is
there now for the picture and passed-through sound: Astra's own Matroska
reader hands out each block as it arrives and the reader answers each read
as its bytes come (`tests/astra-mkv-browser.test.mjs`: paced at 375 kB/s,
a film of 2.5 MB clusters shows its first picture after well under one
cluster, from the start and after a seek). Converted sound (Dolby Digital,
DTS, TrueHD where they are rebuilt) still waits for its whole cluster,
since Mediabunny decodes it, and on a first play for its decoder's
download. Changing the audio track stops the picture for about a third of a
second (the seek in place that flushes the old sound). None of this was
measured on the phone itself.

### Several cores (present, switched off)

The code for using more than one core is in place and off: `ISOLATE =
false` in `sw.js` (with it on, the worker gives the pages it serves COOP
`same-origin` and COEP `credentialless`, so they are cross-origin isolated
from the second visit and have SharedArrayBuffer) and `THREADS = false` in
`src/engine/software-threads.js` (with it on, on an isolated page,
libmedia decodes on one core fewer than the phone has, at most 4). Measured
2026-11-15 in desktop Chromium: threads raised the frames the software
decoder showed when cores were free, but delayed the first picture by 0.4
to 0.8 s; and isolation makes JASSUB start as many threads as the phone has
cores less two, which made libass start about twice as slowly and draw no
faster. To switch it on, set both to `true`; it also needs JASSUB's thread
count held (it has no switch Astra uses today), or libass will be slower
than it is now. `tests/astra-isolation-browser.test.mjs` serves the site
with both on and checks that everything Astra does still works isolated.

## The player screen

`new PlayerScreen().open({stream, meta, sources, episodes, next, segments})`
must be called from a tap: it goes full screen. With no `stream` nothing
loads and the Sources panel opens for a pick. It follows the phone's
rotation unless Settings > Playback > Rotation says Landscape or Portrait;
the rotate button in the top bar switches until the player closes (and says
so where the screen cannot be turned, as on a desktop). In
portrait the picture is a band across the middle; when there is room,
subtitles sit in the black under it. With the controls showing, bottom
subtitles, Skip and the next-episode card are placed from the controls'
measured height, so nothing covers the title or the buttons.

- Tap toggles the controls; they hide 3.5 s after the last touch while playing.
- Double tap left or right seeks 10 s; more taps within 0.8 s add 10 s each.
- Horizontal swipe seeks (a full width is 60, 90 or 120 s by length), with a
  preview; vertical swipe on the left changes the picture's brightness (a page
  cannot change the screen's), on the right the volume.
- Hold anywhere but a button plays at the hold speed (2x unless changed in
  Settings) until release, and gives the chosen speed back.
- **Pinch to zoom** (`zoom.js`): two fingers enlarge the picture from 1x to
  4x, a one-finger drag then moves it within its edges (instead of
  seeking), and a pinch back to about 1x or the picture-size button puts it
  back. The picture filter's canvas moves with it; subtitles stay where they
  are, so they never leave the screen.
- Lock hides everything; any touch shows "Tap to unlock" and how far along
  playback is.
- Sound turned all the way down shows a "Sound off" chip in the corner; a tap
  turns it back on.
- **Remembered between films**: the volume, the brightness and the speed
  go on every film as it opens, as do the Sound and Picture settings below.
  A resume more than a minute in says "Resumed at 12:34" for 7 s across the
  top, with **Start over**; a source switch or Try again does not.
- **The Playback menu** (the Speed button, which shows the speed): speed
  from 0.5x to 2x with the pitch kept; a **sleep timer** of 15, 30, 45 or
  60 minutes or the end of the episode, which pauses the film (so its place
  is saved), says so, and shows what is left quietly at the top (at the end
  of the episode the next-episode card is not offered); **Repeat a part**:
  a tap marks A, a second marks B, and playback goes back to A each time it
  reaches B until Stop repeating or a seek outside the part; **Sound only**:
  the picture is covered with black showing the title, the time, play and
  Show picture, the screen is let go so the phone may sleep, and leaving the
  app does not open picture-in-picture (the lock screen's play resumes it).
  The sleep timer and Sound only last until the player closes.
- **The seek bar** shows the skippable parts (intro, recap, outro) as tinted
  spans, the chapters as thin gaps (none closer than 6 px), and A and B
  while repeating; dragging shows the chapter's name under the time. A
  stream with no length (live) shows a full bar marked Live that cannot be
  dragged or swiped across.
- **Frame by frame**: while paused, the buttons beside play step one frame
  back or on (the file's frame rate when known, else 24).
- Menus: audio (Tracks and Sound tabs), subtitles (a Tracks tab with
  language and track; a Style tab with delay, size, position, colour,
  background, outline and bold, which leaves the picture showing so changes
  can be seen), stream info, Playback; side panels for sources and
  episodes, opened at the current one. Back closes the menu first, then the
  player; on a phone in full screen, Android's back (which leaves full
  screen) does the same, and does nothing while locked.
- **Subtitle delay** in steps of 0.1 s and 1 s, up to a minute either way
  (z and x on a keyboard move it 0.1 s); it is kept for the next episode of
  the same series and starts at 0 with another title. **Find a line**
  (subtitles menu, while a text track shows) searches every line of the
  track, case and accents ignored, and a tap goes to a second before it.
  **Second subtitle** (for learning a language): another text track at the
  top of the picture, smaller, in the first one's colours and with its
  delay; never a picture track, an HLS or DASH stream's own track, or the
  track the first shows (a styled track shows there as plain text).
- **Stream info** says how the film plays, its picture, sound, file, frames
  shown and dropped, the notes of the plan, **Data used** ("412 MB so far",
  refreshed while open; not counted when Chrome plays the film itself), the
  chapters (a tap goes there), and **Save this frame**: the frame at the
  video's own size, without subtitles, as a PNG named after the title and
  the time (never the stream or the add-on). A film from a host that does
  not let the page read it says it cannot be saved.
- **The audio menu's Sound tab** (`sound-menu.js`, `enhance/sound.js`):
  **volume boost** (100, 150, 200 or 300 %, through a limiter, shown as a
  "Boost 200 %" chip by the corner whose tap opens the tab; the volume
  level stays 0 to 100 %), **night mode** (quiet sound up, loud bangs
  down), **dialogue** (+1 or +2: the centre channel lifted, or the speech
  band in stereo; for sound the engine converts, the centre is lifted in
  its own mix-down), **even loudness**, **headphone surround** (both below,
  off unless turned on), and **sound delay** in 0.05 s steps up to a second
  later, or earlier where the engine re-wraps the film (the page itself can
  only make sound later). Boost, night mode, dialogue, even loudness and
  headphone surround are kept for every film; the delay belongs to one
  title. The chain runs, in order: the mix to stereo (plain, with the
  centre lifted, or placed for headphones), the even-loudness gain, night
  mode, boost, the limiter, the delay (`enhance/sound-chain.js`), so night
  mode meets every film at the same level and neither a lift nor a boost
  can clip. The tab is greyed with the reason
  before the film has started and for a film played straight from a host
  that does not let the page read it (its sound would be silenced). In the
  software decoder the same chain goes into libmedia's own sound path. With
  everything off the sound passes untouched, and nothing takes the film's
  sound until a feature is first turned on.
  - **Even loudness** (`enhance/loudness.js`, `leveller.js`): a meter on the
    chain's input (an AudioWorklet, before every feature, so it measures
    the film and not what Boost or the gain made of it) measures its
    programme loudness as EBU R 128 / ITU-R BS.1770-4 does (K-weighting,
    400 ms blocks every 100 ms, surrounds weighted 1.41, the bass channel
    left out, the -70 LUFS and relative -10 LU gates), and a gain moves
    towards the level that brings it to -18 LUFS, never more than 12 dB
    up or down. It holds for the first 2 s of sound, then moves at up to
    3 dB a second, and once 10 s have been measured at most 1 dB per 2 s.
    The element's volume is divided out of what is measured, so the
    owner's own volume swipe is never taken for a quieter film and undone.
    Each title's settled gain (after 30 s of measure) is remembered in the
    player's prefs, at most 200 titles: its next play starts there and
    moves only slowly after 10 s; a title never measured starts from the
    middle of those remembered, else 5 dB up.
  - **Switching** (`enhance/sound-chain.js`): turning any of these on or
    off builds the new path beside the old one, lets it settle silently for
    0.2 s and crossfades in 50 ms, so the level never jumps or clicks;
    headphone surround first waits for the browser's HRTF data.
  - **Headphone surround** (`enhance/headphone.js`): a 5.1 or 7.1 film is
    placed around the listener with the browser's own binaural rendering
    (Web Audio's HRTF panner, each speaker a metre away at its standard
    angle; no outside data), each channel at its level in the stereo mix,
    the centre at -3 dB (the dialogue lift still works on it), the bass
    channel to both ears at -6 dB through a 120 Hz low-pass, and the whole
    2 dB down to be as loud as the plain mix. It is offered only for sound
    that reaches the page with a centre and surrounds: not for a track the
    engine converts (it arrives already mixed to stereo), nor in the
    software decoder.
- **The Picture section** at the top of Stream info (`picture-menu.js`,
  `enhance/picture.js`, `filter.js`): **upscale** (Standard: AMD FSR 1.0's
  edge-adaptive upscale, `fsr.js`; or Animation: Anime4K's "Upscale CNN x2
  (S)" network for drawn films, `anime4k.js`), **sharpen** (Off, Low,
  Medium, High: FSR's RCAS) and **smooth banding**, in WebGL2 up to 1080p
  output, kept for every film. The film is drawn through the
  filter onto a canvas over the video only when a new frame is presented,
  not while the page is hidden or in picture-in-picture. Animation runs
  only where the phone can draw into half-float targets and the picture is
  shown more than 1.2 times larger both ways (Anime4K's own rule); the
  section says when Standard is drawn instead and why. **HDR films** in PQ
  (HDR10, Dolby Vision's HDR10 layer) are
  uploaded as half floats and tone-mapped to the screen (`tonemap.js`:
  ITU-R BT.2390's curve on the PQ signal, 1,000 nits assumed for the
  source, mid-tones placed where Chrome's own picture puts them; into
  Display P3 on a P3 screen, else sRGB) before the other passes; a phone
  that cannot draw into half floats keeps the plain picture for them, and
  so does an HDR film in HLG (or one that does not say it is PQ): the
  browser's own picture maps those rightly, and the section says why. A
  film from a host that does not let the page read it keeps the plain
  picture too; the section says why. When frames start to be missed it
  steps itself down (Animation to Standard, then smooth banding off, then
  a smaller output) and then off, and says so once.
- **Skip intro, recap, outro** (`markers.js`): the Skip button appears while
  the playhead is in a segment and skips only on a tap; without the
  controls it stays 10 s, then waits for them. The next-episode card
  appears at 99% (or when an outro that runs to the end starts), for titles
  over two minutes, and plays only when tapped; while it shows, the outro's
  Skip does not. An episode not out yet says when it is out, and Next does
  not play it. Where the segments come from is under Skip intro below.
- Picture-in-picture (top bar): the video moves to Android's floating window
  and the app can be used; expanding the window brings the player back (also
  after pausing in the window), closing it ends playback. Leaving Astra while playing opens it by itself
  where Chrome allows (Settings > Playback > Picture-in-picture). Android leaves full screen on the way
  into and out of the window; those changes are not taken for the back button,
  and nor is the full screen Android drops when Chrome goes to the background.
- A load that runs past 5 s shows how long and how much has arrived; past 10 s it says what it is
  waiting on (the debrid service, a host that has not answered, or a slow one) and offers the other
  sources and another app.
- Waiting for data shows a spinner of its own after 400 ms; the controls
  stay as they were.
- A lost connection is retried for up to a minute (at once when the phone is
  back online) while the buffer plays, with "Reconnecting…"; only then does
  the player stop, offering Try again from where it stopped. A dead link
  (404/410) asks for another source; a host that does not answer in 15 s
  says so. Another app is offered only for files the browser cannot play.
- Media Session controls (the lock screen's play, pause, seek and next
  episode, with the position line); the screen is kept awake while playing,
  except in Sound only.
- With a keyboard, a menu takes focus and Escape gives it back; the app
  behind the player cannot be reached while it is open. Space or k, the
  arrows or j and l, m, f, c, z and x do what a desktop player's do.
- Unpacking a file gives the page a turn every 8 ms, so taps (Close
  included) answer while a film starts.
- While a file is being described, Astra reads only a little past what it
  asked for (How a file plays, 5.); resuming halfway then closes the
  connection at the start, so it does not share the phone's bandwidth with
  the one that is needed.
- **Close** (the back arrow, back, or closing the floating window) stops
  everything at once: the sleep timer, Sound only, the picture filter's
  canvas, Find a line, menus, gestures, notices, full screen, the wake
  lock, picture-in-picture and the lock-screen controls; the app is
  reachable again, where playback got to is saved, a debrid lookup or play
  still on its way is dropped, Skip intro's finder stops and keeps what it
  learned, and the engine lets go of the film and its connections.

## Skip intro

The segments the Skip button offers come from two places (`src/app/skip.js`),
merged by kind; nothing ever skips by itself, and movies get neither.

- **Found by sound, on this phone** (Settings › Playback › Find intros by
  sound, on unless turned off). While an episode plays, the engine hands
  decoded sound to a finder (`engine/sound-tap.js`, `intro-finder.js`) as
  it reads it, for the first six and last four minutes. It is fingerprinted
  (`fingerprint.js`: pitch-class and band energies below 3.5 kHz, compared
  with each other and half a second earlier, so loudness and the encoder
  hardly matter) and matched against episodes of the same series heard
  before (`fingerprint-match.js`) in slices of a few milliseconds, so the
  page stays free. A segment is offered once its start and end have been
  heard here and in the other episode; once two pairs of episodes agree on
  the opening, its fingerprint is kept as the series' intro and new
  episodes are matched against it first. What was found before shows at
  once next time. Nothing is sent anywhere; what is kept is in
  `astra-intro` (Saved data above). The tap works only where Astra reads
  the sound itself, a re-wrapped film (`remux`, a plain MP4 or WebM
  included): a film Chrome plays itself, an HLS or DASH stream, the
  software decoder, and Dolby or DTS sound passed to the phone's own
  decoder where WebCodecs cannot decode it (it is asked first; the log
  says so in one line) give it nothing,
  so the first episodes of a series find nothing until two have been heard.
- **Looked up, for anime** (Settings › Playback › Look up anime skip times,
  off unless you turn it on; `src/addons/skip-times.js`). For a series whose
  id is a MyAnimeList (`mal:`), Kitsu (`kitsu:`) or IMDb id (`tt…`, first
  season only), once the episode's length is known, Astra asks
  api.ani.zip for the MyAnimeList id that matches a Kitsu or IMDb id (the
  id is the only thing in the request), then api.aniskip.com for that id
  and episode number, with the opening, ending, mixed and recap kinds and
  the file's length in whole seconds (to pick the timing that fits this
  release). No cookies and no referrer go with either; no add-on, stream
  or title name. Answers, "nothing known" included, are kept in memory for
  the visit. A looked-up segment wins over one found by sound of the same
  kind, and recaps come only from the lookup.

## Subtitles

- **Add-ons**: every add-on with a `subtitles` resource is asked, plus
  OpenSubtitles v3 unless turned off in Settings > Playback. When Astra can
  read the file it sends the OpenSubtitles hash and size (`file-hash.js`), so
  subtitles timed for that exact release are marked "Exact match" and come
  first. Files are downloaded only when chosen (`src/addons/subtitles.js`),
  and one over 8 MB is refused.
- **Inside the file**: SRT, ASS and WebVTT in MKV; PGS (Blu-ray) and VobSub
  (DVD) picture subtitles in MKV (`src/subtitles/pgs.js`, `vobsub.js`); 3GPP
  timed text and WebVTT in MP4 (`src/engine/mp4.js`). They are read from data
  the video pipeline already downloaded (`embedded-subtitles.js`), block by
  block as it arrives, so seeking works with or without a cue index.
- **Styled subtitles (ASS/SSA) are drawn by libass** (`subtitles/libass.js`:
  JASSUB, libass in WebAssembly, drawing on its own canvas from a worker),
  so signs, typesetting, karaoke and positioned lines look as authored. For
  a film's own track the fonts attached to the film are read
  (`engine/mkv-attachments.js`: fonts only, bounded in number and size,
  read a header at a time so cover pictures and the film around them are
  not downloaded); Liberation Sans is the fallback, and the phone's own
  fonts and online font services are never asked. An .ass file from an
  add-on or the phone is drawn the same way. JASSUB (2.4 to 2.5 MB) is
  fetched when a styled track is first chosen; a frame is asked of it only
  while a line is on screen. Until it draws, and for good if it cannot
  start, Astra's own renderer shows the track's text.
- **In adaptive streams**: an HLS or DASH stream's own subtitle tracks are
  listed; hls.js and dash.js load them and Astra copies each cue once into
  its own renderer, so they take the same style as every other subtitle.
- **From the phone**: the subtitles menu can load an .srt, .vtt or .ass file.
- The remembered language is shown by itself: the file's own track first,
  then an exact match, then the first add-on file. Choosing Off forgets it.
- Old code pages (Cyrillic, Arabic, Central European and others) and UTF-16
  files are decoded by language, from add-ons' two- or three-letter codes
  (or the language picked in the menu for a file from the phone); the
  language is a hint checked against the bytes, so French loaded under
  "Russian" does not come out in Cyrillic letters.
- A file's format is read from its first line (an .srt named
  "Glass.Onion" stays SRT); a file one reader finds empty is offered to the
  others. A host that blocks reading the file is said in the subtitles menu
  (add-on subtitles still work).
- **Files as people find them**: a timing line starts a cue whether or not
  blank lines (or lines holding only a space) separate cues; a number just
  above a timing line is that cue's counter, and a cue whose text is a
  number keeps it in a file that does not count its cues; hours or the
  fraction may be missing; a timing line that cannot be read ends the cue
  above and starts none; old .ssa colours and styles are read; an entity
  that is no character stays as written.
- **Picture subtitles stay small**: pictures stay run-length coded until
  shown, and only the last few drawn are kept (never more than 32 MB of
  pixels) for a redraw. Sizes a file claims are held to a real film's frame
  (4096x2304 at most), and a VobSub file that gives no frame size, or an
  impossible one, is placed as 720x576.

## Tests

The `tests/astra-*.test.mjs` files run in the root `npm test` (and `npm run
test:site`). Those named `-browser` drive a real Chromium through
Playwright (`CHROMIUM_PATH=/opt/pw-browsers/chromium` in agent sessions) on
the site served by `scripts/serve.mjs`, reach nothing on the internet, and
are skipped against a deployed site (`SITE_URL`); checks that need H.264
skip in a browser without it.

| File | What it covers |
| --- | --- |
| `astra-plan.test.mjs` | The planner and the software decoder's tables: which way each kind of file plays; a plain MP4 or WebM unpacked like any other film; Dolby and DTS passed through where the browser says it decodes them, until that failed here; a picture that failed in the browser starting in software. |
| `astra-routes.test.mjs` | What the device remembers of a failed route (30 days, at most 40 pictures, broken storage), the lab's words on Dolby and DTS sound, and the phone settings hls.js and dash.js get, with the saver's 720p ceiling. |
| `astra-engine.test.mjs` | The range reader against hosts that cut, stall, answer nothing or move; headers read without trusting their sizes (MKV, clusters, MP4); the stall watchdog; early fragments; playlists without byte ranges. |
| `astra-source.test.mjs` | After a seek the dropped pipelines' reads end and their downloads close. |
| `astra-bytes.test.mjs` | The range reader: reads answered as their bytes arrive, downloads that stop where describing stopped asking, the reach and the cache by bitrate, bounded requests, side reads that leave playback alone, a network change, and waiting for a download by time rather than bytes. |
| `astra-film-memory.test.mjs` | A film remembered by its size and first 64 KiB, answered from memory the next time; a damaged entry, another film of the same size or failing storage changing nothing but the cost; a block a seek began inside made whole on the side. |
| `astra-mkv-packets.test.mjs` | Astra's own Matroska reader against Mediabunny's on every Matroska test film (the same packets, every byte), a cluster read as it arrives, hand-built files (lacing, block groups, header stripping, Void and CRC-32, negative times, a file cut short), and stepping aside for what it will not guess at. |
| `astra-early.test.mjs` | Half-second fragments. |
| `astra-downmix.test.mjs` | Converted sound mixed to stereo a sample at a time. |
| `astra-sound-stream.test.mjs`, `astra-sound-stream-browser.test.mjs` | Converted sound from Astra's own Matroska reader: the same samples as Mediabunny's sink (Dolby Digital, TrueHD, DTS), heard after seeks and track changes, picture and sound after well under one cluster on a slow host; surround kept whole (FLAC) with Headphone surround on. |
| `astra-chapters.test.mjs` | Chapters from Matroska and MP4, in order and bounded. |
| `astra-datasaver.test.mjs` | When the data saver is on and what it changes, on a download already running, and the player handing the film's length to the reader. |
| `astra-feed.test.mjs` | A film's attached fonts (bounded), which files libass can draw, the second track moved to the top, the sound tap's bookkeeping. |
| `astra-sound-tap.test.mjs` | Skip intro's tap on sound passed through: WebCodecs asked first, one plain line and no error where it cannot decode it. |
| `astra-subtitles.test.mjs` | The parsers on files as people find them, and picture subtitles with impossible sizes or out of order. |
| `astra-subtitles-files.test.mjs` | Code pages from a language hint checked against the bytes, and what a subtitle add-on may send. |
| `astra-streams.test.mjs` | What a stream's words say (size, picture size, codec), the filter chips, what an hour costs, and the card's sound note against what this phone plays and what failed here. |
| `astra-debrid.test.mjs` | TorBox's list asked once and kept in memory ten minutes per token, asked again once when a pick is not in it. |
| `astra-tap.test.mjs` | What is fetched ahead for a list and a saver state, a press that starts a resolve the tap takes, the next episode made ready only for the same release group, and a film's tail asked for beside its start. |
| `astra-addon-json.test.mjs` | Add-on answers over 5 MB refused, and one that never ends cut. |
| `astra-skip.test.mjs` | The sound fingerprint and its matching, what the intro store keeps, and the skip-times lookup against invented answers. |
| `astra-player.test.mjs` | The gesture rules, when progress may overwrite the saved place, the next episode's sources through the filters, and `player/rules.js`. |
| `astra-enhance.test.mjs` | The sound chain's stereo mix against the engine's, dialogue steps, the picture's sizes, and the BT.2390 curve. |
| `astra-loudness.test.mjs` | The BS.1770 measure against the standard's coefficients and EBU Tech 3341's test signals, channel weights, the gain law, and the remembered gains. |
| `astra-software-threads.test.mjs` | How many cores libmedia may use, and that as shipped it stays on one thread. |
| `astra-startup.test.mjs` | `index.html` preloads exactly what start-up imports. |
| `astra-sw.test.mjs` | The service worker in a vm with Cache Storage that outlives it: releases, updates, restarts, and isolation off as shipped and right when switched on. |
| `astra-sw-browser.test.mjs` | The worker in Chromium: offline start, a one-file update, the Reload offer staying, a page keeping its release across an update and a restart, no query as a key. |
| `astra-isolation-browser.test.mjs` | Isolation and threads switched on by a server in front of the site: the second opening is isolated, and posters, a film the page may not read, the engine and the software decoder still work. |
| `astra-play-browser.test.mjs` | The engine on real films from another origin: every way of playing (HLS and DASH from `vendor/`), seeks, changing sound track, TrueHD heard, a plain MP4 and a WebM unpacked, the one-time fallback to the browser (with CORS where allowed), connections let go on close, a host that is gone, silent or cutting. |
| `astra-mkv-browser.test.mjs` | Astra's own Matroska reader in the browser: 5-second clusters and front cues played and seeked, the fall back to Mediabunny mid-film, and the first picture after well under one cluster on a paced host. |
| `astra-routes-browser.test.mjs` | A browser that claims Dolby Digital and then fails three ways, each met with the sound rebuilt in place and remembered; a picture's software fallback remembered; HLS levels by player size and the saver; DASH with the phone settings. |
| `astra-adaptive-browser.test.mjs` | hls.js on a dense screen: the pixel ratio counted at most 2. |
| `astra-player-browser.test.mjs` | The player screen at phone size with touch and a stubbed engine: resume point, picture-in-picture, holds, close, controls, live seek bar, focus, lock, full screen lost in the background. |
| `astra-features-browser.test.mjs` | The Playback menu, remembered volume, Start over, seek-bar marks, subtitle delay, Find a line, the second subtitle, frames and stills, pinch to zoom, data used, the source line, the lab's address. |
| `astra-feed-browser.test.mjs` | On the real page and CSP: libass with the film's font, the second subtitle's layer, the sound tap, dialogue lift and earlier sound in the engine. |
| `astra-libass-browser.test.mjs` | The libass layer: placement, drawing only while a line shows, the film's font, delay, destroy, and a start that fails falling back. |
| `astra-enhance-browser.test.mjs` | Sound measured after the chain and the picture read back from the canvas, on real films. |
| `astra-sound-browser.test.mjs` | Even loudness bringing two films 12 dB apart together while the volume stays the owner's, headphone surround placing the left surround, and the Sound tab's two switches. |
| `astra-picture-browser.test.mjs` | Animation (Anime4K) drawn over a playing film, and an HDR film tone-mapped along the BT.2390 curve, read back from the canvas. |
| `astra-wiring-browser.test.mjs` | The Sound tab, the Picture section, skip times reaching the Skip button, and the Settings › Playback rows, with the real engine. |
| `astra-app-play-browser.test.mjs` | The app end to end: an invented add-on, a tap on a stream, chapters, the sound tap fed, data used, the Sound tab, Find a line, another source drawn by libass, no page error. |
| `astra-tap-browser.test.mjs` | From a tap to the first picture in the real app with Get ready ahead on, off and under the saver: the list read once, the press's resolve taken by the tap, the next episode made ready so Next asks nothing, nothing before a tap when off, nothing ever playing without one. |
| `astra-open-browser.test.mjs` | The Thunderhead's link (`?find=…&max_mb=…`) opens Details, the size chip, nothing plays by itself. |

- **Films**: `tests/fixtures/astra/` (about 3.4 MB, committed). Most are
  made by `bash scripts/astra/fixtures.sh [film…]` (needs ffmpeg; name
  films to remake only those, since x264 builds differ). Each is a moving
  test picture with a clock and a sine tone per sound track at its own
  pitch, so a check can tell by ear which track plays: `multi.mkv` (two AAC
  tracks, SRT, chapters), `surround.mkv` (Dolby Digital 5.1), `plain.mp4`
  (a plain MP4, unpacked by Astra like any other film), `open.webm` (VP9,
  Opus), `anime.mkv` (the hand-written, invented `signs.ass` with Inter Bold
  attached), `centre.mkv` (a tone in the centre channel only), `truehd.mkv`, `dts.mkv` (DTS 5.1, 3 s),
  `hevc.mkv` (software decoder in the test browser), `clusters.mkv` (a
  cluster every 5 s and a key frame every 10 s, so half the clusters begin
  between key frames: Astra's Matroska reader), `frontcues.mkv` (its cue
  index before the clusters), `hls/` and `dash/`; `beside.srt` loads beside
  a film. Three are made by the command in their test's header:
  `hls2/` (two picture-only levels, 320x180 and 1920x1080, for the level a
  player's size takes; `astra-routes-browser.test.mjs`),
  `hdr-patches.webm` (VP9 profile 2, PQ, BT.2020 grey and colour patches at
  known levels, for the tone mapping; `astra-picture-browser.test.mjs`) and
  `surround-left.mkv` (5.1 AAC with a burst in the left surround only, for
  headphone surround; `astra-sound-browser.test.mjs`).
- **The file host** (`tests/fixtures/astra-host.mjs`) serves them as a real
  host does (byte ranges, readable from another origin) and counts what was
  asked and sent. Its switches make it misbehave: `hang` (never answers),
  `status` (answers every request with that code), `cutAfter` (drops each
  connection after so many bytes), `bps` (a slow connection), `delay`
  (milliseconds each request waits before it is answered: a far host's
  round trip), `noRange` (sends the whole file), `noCors` (no CORS headers;
  `?nocors` on one film's address does it for that film alone).
- Vendored files: `node scripts/astra/vendor.mjs --check` checks every
  file in `vendor/` against the hashes in `vendor.json`, without the
  network.
- Measuring a real Chrome on larger films (the tables above) is
  `scripts/astra/` (its README); none of it runs in CI.

## Not checked on a phone

Everything above was run in desktop Chrome or the headless Chromium of the
tests, never on the Galaxy A15. Until it is, these are not proven:

- the picture filter's speed on the phone's graphics chip, and how soon it
  steps itself down;
- Sound only with the screen off and the phone asleep, and the lock
  screen's play resuming it;
- picture-in-picture and full screen on Android: going in and out, closing
  the floating window, leaving the app while playing;
- the wake lock keeping the screen on through a film;
- Skip intro on real episodes of a real series, by sound and by lookup;
- the software decoder's speed (HEVC, 10-bit H.264, AVI) on the phone;
- libass on the phone's processor (the build without SIMD, used on phones
  with 2 GB of memory or less);
- the data saver's Automatic, which depends on what Chrome on Android says
  about the connection.

These were run only in the tests' desktop Chromium, which has no Dolby
decoder, no phone graphics chip, no HDR screen and no real network:

- Dolby Digital and DTS passed to the decoder of a phone that has one (the
  tests play a browser that only claims it), and the fall back to
  converting when it fails;
- Anime4K's speed on the phone's graphics chip, and how soon Animation
  steps down to Standard;
- an HDR film on a real HDR screen and on a P3 screen (the tests read back
  an sRGB canvas);
- the preconnect to TorBox and to a film's host on Android, and what Get
  ready ahead saves before the first picture there;
- a film remembered (`astra-films`) on a real connection: how much sooner
  it opens the second time;
- headphone surround's cost on the phone's processor;
- a real network change (Wi-Fi to mobile data) while a film plays.
