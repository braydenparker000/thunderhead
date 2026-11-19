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
| `src/app/` | `app.js` (tabs, screen stack), `playing.js` (from the tap on a stream to the player playing it, another source or episode, saving progress), `store.js` (saved data under `astra.v2.*`), `content.js` (rows, hero, what Play means), `cache.js` (add-on answers kept between visits), `back-stack.js` (Android back, one history entry per open screen, sheet or menu), `recovery.js` (the card shown when Astra cannot start), `skip.js` (Skip intro's two sources, merged), `intro-store.js` (what Skip intro has learned, in IndexedDB), `ready.js` (getting ready on Streams before a tap), `next-ready.js` (the next episode made ready before Next) and `player-load.js` (the player's code evaluated a piece a frame, in the order `player-graph.js` gives: `node scripts/astra/player-graph.mjs --write` after changing its imports; a test runs `--check`). |
| `src/screens/` | Home (with its hero, `hero.js`), Details, Streams (a card is built in `stream-card.js`), Catalog ("View all"), Search and Discover, Library, Settings; `logo.js` keeps a title's logo readable on a dark picture. |
| `lab/`, `src/lab/` | Playback lab at `/astra/lab/`: play a link or a stream from your add-ons, see what the file holds and how it plays, switch audio and subtitles, copy a report; and the TorBox check (`torbox-check.js`, `torbox-panel.js`, with the report's scrubber `scrub.js`; see The playback lab, below). |
| `src/engine/` | The playback engine (below). `player.js` is `AstraPlayer`; its parts are mixed into it: `player-start.js` (each pipeline), `player-subtitles.js`, `player-libass.js` (styled subtitles), `player-second.js` (the second subtitle), `player-sound.js` (the sound features' engine side), `player-data.js` (data used and the data saver), `player-routes.js` (what a failed route teaches), `player-report.js` (the lab's report), `adaptive.js` with `adaptive-tuning.js` (HLS and DASH). Reading: `probe.js` with `probe-limit.js` (describing bounded); the range reader `http-source.js` with `source-stream.js` (one download), `source-blocks.js` (the bytes held), `source-tuning.js` (read-ahead and cache by bitrate), `source-state.js` (the connection lost and found), `source-gate.js` (three connections at most), `source-renew.js` (a dead link renewed), `side-read.js`, `source-tail.js` (the film's end beside its start) and `film-memory.js` (a film's header and index remembered); `mkv.js`, `mkv-cluster.js`, `mkv-attachments.js` (a film's fonts), `mkv-hide.js` (fonts and tags Void to Mediabunny), Astra's own Matroska packet reader `mkv-packets.js` with `mkv-blocks.js` and `mkv-sink.js`; `mp4.js`, `chapters.js`. Deciding: `plan.js`, `capabilities.js`, `route-memory.js`. Playing: `remux.js`, `remux-audio.js`, `remux-switch.js` (changing the sound), `rebuffer.js` (a link slower than the film), `sound-wait.js` (a converter that does not come), `hold.js`, `preview.js` with `preview-frames.js`, `preview-decode.js` and `player-preview.js` (the key frame where a drag lands), `sound-apart.js` and `sound-worker.js` (converted sound decoded, mixed and encoded in a worker, off the page's thread), `sound-stream.js` (converted sound from Astra's own Matroska reader, on the page), `sound-write.js` (the Opus and FLAC writers both use), `sound-six.js` with `flac-frames.js` (converted surround kept whole for Headphone surround), `fragments.js`, `early.js`, `mse.js`, `downmix.js`, `audio-decoders.js`, `stall-watch.js`; `software.js`, `software-loader.js` (how libmedia reads the film), `software-sound.js` (libmedia) and `software-threads.js` (its threads, switched off). Subtitles inside the file: `embedded-subtitles.js`. Skip intro by sound: `sound-tap.js`, `fingerprint.js`, `fingerprint-match.js`, `intro-finder.js`. Also `file-hash.js`, `labels.js`, `languages.js`. |
| `src/player/` | The full-screen player (Nuvio's layout and gestures). `player-screen.js` opens, loads and closes; its parts each have `close()`: `view.js` (the elements), `controls.js`, `menus.js` and `subtitle-menu.js`, `surface.js` with `gestures.js` (pure) and `zoom.js`, `timeline.js` (the seek bar) with `seek-preview.js` (the picture in its bubble), `keys.js`, `video-events.js`, `markers.js` (Skip and the next-episode card), `loading.js` (waiting, errors, notices), `address.js` (where the film's address came from, for Stream info and the notice), `system.js` (full screen, picture-in-picture, wake lock, lock-screen controls). `extras.js` gathers the rest: `playback.js`, `sleep.js`, `repeat.js`, `sound-only.js`, `resume.js`, `marks.js`, `frames.js`, `find.js`, `info-extras.js`, `sound-menu.js`, `picture-menu.js`. Pure rules in `rules.js`, saved choices in `prefs.js`, another app in `external.js`; styles in `player.css` and `player-extras.css`. |
| `src/enhance/` | Sound and picture: `sound.js` and `sound-chain.js` (boost, night mode, dialogue, sound later), `loudness.js` and `leveller.js` (even loudness), `headphone.js` (headphone surround); `picture.js`, `filter.js` and `fsr.js` (sharpening and smoother banding in WebGL2, after AMD FSR 1.0), `anime4k.js` with `anime4k-upscale.js` and `anime4k-restore.js` (Anime4K's shaders), `tonemap.js` (HDR to the screen, BT.2390), `dolby.js` (Dolby Vision profile 5 colours); see `LICENSES.md` there; `origin.js` (whether the page may read what the video shows). |
| `src/ui/` | `motion.js`, the one place motion is made (with `motion-core.js`, `press.js` (the press and the feel report), `sheet-motion.js`, `feel-log.js`, `feel-frames.js` (what froze) and `spring.js`: see Motion and settings, below); `overlays.js` (the lift menu, sheets, confirm dialogs, toasts); `components.js` (poster cards, the long press, skeleton rows); `icons.js` and `nav-icons.js` (the tab icons at two weights); `dom.js`. |
| `src/settings/` | The settings registry (`registry.js`), each area's rows (`general.js` for the settings from before, `appearance.js`, `motion.js`, and the other areas' own files), the row helpers (`rows.js`) and the accent's contrast sums (`colour.js`). Settings' pages are in `src/screens/settings*.js`. |
| `src/subtitles/` | `parse.js` (SRT and WebVTT), `markup.js` (times and inline markup), `ass.js` (ASS and SSA), `charset.js` (old code pages), `renderer.js` (draws cues over the video), `libass.js` (ASS/SSA drawn by libass), `pgs.js` and `vobsub.js` (picture subtitles). |
| `src/addons/` | The Stremio add-on protocol client (`client.js`), a stream's address from the owner's own server (`debrid.js`, with `worker-api.js`, the signed-in client of the Worker, and `link-facts.js`, what a link says of its file), subtitle add-ons (`subtitles.js`), what a stream's label says (`stream-facts.js`), its text as shown, without a hash (`stream-text.js`), how it will likely play here (`device-facts.js`) and the one note a card carries for that (`stream-note.js`), and the optional skip-times lookup (`skip-times.js`). |
| `src/styles/` | `tokens.css` (colours, type, space, durations, the generated springs, radii and shared controls), then one sheet per area, loaded in this order: `shell.css` (launch, tabs, nav, overlays, shared bits), `browse.css`, `streams.css`, `settings.css`. |
| `vendor/` | Mediabunny 1.66.0 and its AC-3, DTS and TrueHD decoders, hls.js 1.6.13, dash.js 5.2.0 and JASSUB 2.5.37 (libass), copied by `node scripts/astra/vendor.mjs` from the npm packages pinned in `vendor.json`, which also holds a hash of every file (see `vendor/LICENSES.md`). |
| `fonts/`, `icons/` | Inter (SIL OFL 1.1, `fonts/LICENSE.md`) and the app's icons. |

## Motion and settings

The rules (ASTRA.md, "Look, motion and settings"): a touch answered in the frame it lands; only
`transform` and `opacity` move (`tests/astra-motion-rules.test.mjs`); everything comes from somewhere and can
be interrupted; durations follow size (90 to 150 ms a control, 220 a card, 320 a screen, 380 a shared element).

- **Moving something**: import from `src/ui/motion.js` only. `press(el)`; `travel(from, to, {name})`;
  `push(inEl, outEl, {name})` / `pop(inEl, outEl, {name})`; `swap` (tabs); `rise(els, {name})`;
  `sheet(body, {scrim, onDismiss})`; `enter`, `exit`, `fadeTo`; `tick(kind)` for haptics; `level()` and
  `onLevel(fn)`. Each returns `{finished, cancel()}`, follows Settings › Motion and touch, and is timed under its
  `name` (`kind:what`, fixed words only, e.g. `push:details`) into the feel report.
- **What froze**: each timed run keeps its longest frames as the browser reports them (Long Animation Frames,
  Chrome 123+; long tasks without scripts elsewhere), and the report prints them for the ten worst gaps: the
  frame's ms, how long it blocked, its style and layout, and its top three scripts as file name (Astra's own;
  "other" for anything else, "unknown" when the browser names none), function, kind of call and ms.
- **Durations and curves** are tokens (`--t-*`, `--spring-snappy`, `--spring-smooth`, `--spring-lively`). The
  springs are generated: change a stiffness or damping in `src/ui/spring.js`, then
  `node scripts/astra/springs.mjs --write` (a test runs `--check`).
- **Adding a setting**: in your area's `src/settings/<area>.js`, `define([{id, area, title, detail, kind:
  'switch' | 'choice' | 'steps' | 'colour' | 'action', options, default, where: 'astra' | 'device' | 'player',
  apply(value, app)}])`, imported once at start (and preloaded in `index.html`). Read it with
  `app.setting(id)`; Settings draws it on its area's page and in search by itself. An existing setting keeps
  its id and `where`, so nothing saved is lost.

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
  by swipe; `hero.js`), Continue Watching, then one row per add-on catalog
  that needs no search text. Long-press any poster to save it or mark it
  watched.
- **A logo that can be read** (`screens/logo.js`; Home's hero and the
  Streams header). A title's logo is asked for with CORS and, as it
  arrives, drawn to a 48-pixel canvas to measure its own lightness: a dark
  wordmark of little colour (black, dark grey, dark navy) is lifted to
  light with a filter (`invert(1) hue-rotate(180deg)`), a dark coloured one
  gives way to the title in text, as when there is no logo, and anything
  else (light, bright, or drawn on its own opaque box) is left exactly as
  it was. A host that refuses CORS fails that request; the logo is asked
  again plainly, that host is not asked with CORS again in the visit, and
  the logo, which cannot be measured, gets a soft 1px light rim that a
  light logo absorbs into its own edges and that outlines a dark one. The
  hero's parallax and reduced motion are untouched.
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
  A Continue Watching card plays the stream you picked, again (below); one
  that remembers none opens Streams at once from what was saved. Nothing is
  ranked or picked for you. A long list (an add-on can send 300 streams)
  is drawn ten cards at once, then at most eight a frame, each slice laid
  out in its own frame and only ever appended, so a card under a finger
  never moves (`stream-card.js`; measured at 390×844 on a CPU slowed 4× and
  6×: the longest frame on opening went from 400-660 ms to 80-160 ms, a
  filter chip's from 370-770 ms to 55-115 ms, and scrolling keeps 238-242
  of 242 frames; `content-visibility` was tried and left out, as it cost
  8-12 % of frames while scrolling). Nothing of a long list is read in one go
  (`stream-pace.js`): each card reads its own facts as it is made, unless an
  order or a filter needs them all first (then read a few ms a frame); the
  reader's one-time cost is paid a step a frame while the add-on is asked;
  the first cards are made ahead, and none past the tenth before the header
  has settled. Long-press a stream to copy it, play it in
  another app, open it in VLC or check it in the lab (the stream goes to the
  lab in the address's fragment, which never reaches a server or a cache,
  and the lab takes it out of the address bar once read). A stream's address
  is asked of the owner's own server at the press that starts a tap (with
  Get ready ahead on), else at the tap (How a stream's address is found,
  below).
- **Get ready ahead** (Settings › Playback, on by default; `app/ready.js`,
  `app/next-ready.js`). With it on and the data saver off, what a tap will
  need is asked for while the list is read: when streams are listed and
  Astra is signed in, it only opens a connection to the owner's own server
  (it asks it nothing); a finger coming down on a stream asks that server
  for its address with mode `ahead`, which never adds anything to TorBox,
  and the tap that follows takes that answer when it has an address, else
  asks to play (a press that becomes a scroll or a long-press starts
  nothing more); and the sound converter a listed
  stream's label asks for, when this phone would convert that sound, is
  fetched ahead on an unmetered connection (on a metered one only when it is
  already in the saved copy). While an episode plays, once the next-episode
  card is due (or a known outro is two minutes off), the next episode's
  streams are collected; only when the stream playing names a release group
  and one of them has the same group is that stream's address asked ahead,
  and only when that gives a direct address (the film is already in the
  owner's TorBox account) is its file described (header and index, nothing
  of the picture or sound), then closed; the add-on's own link is never
  opened before a tap, since following it can make the add-on add the film
  to TorBox. Next within ten minutes takes that list. With the switch off,
  or the data saver on, nothing is asked of the server, an add-on or a
  film's host before a tap. Either way nothing plays without a tap, and no stream is
  ranked, picked or pre-selected.
- **What a stream card says.** The add-on's own words, without the
  torrent's hash (`stream-text.js`): the owner's add-on writes it into its
  text so Astra can reach TorBox directly, and a line that only gives it
  (with or without an emoji or a label such as "Hash:" or "btih:") is
  dropped, a hash inside a longer line is cut out with its label, brackets
  and one of two separators, and nothing else changes; a 40-hex run inside
  a longer hex string is no hash and stays. Astra still reads the hash from
  the stream itself (`link-facts.js`), and a stream's facts are read
  without it. Its size and, when the title's runtime is
  known, what an hour of it costs ("710 MB an hour"). Under it, at most one
  quiet note on how it will play on this phone (`stream-note.js`), the most
  important of: "10-bit HEVC: this phone decodes it in software (slow, more
  battery)" (the label says 10-bit, Hi10, Main 10, HDR or Dolby Vision with
  HEVC, and the browser has no hardware decoder for it); "No hash from this
  source: may open in Chrome's plain player" (signed in, the owner's server
  has not said it lacks a TorBox key, and the link carries no hash and is
  not a plain file address such as a CDN's MKV or an HLS playlist; the key
  is learnt from the server's own steps when a press asks ahead, nothing is
  asked for it); and "Needs the software decoder (uses more battery)" for
  any other codec this phone decodes only in software. Nothing when all is
  well. The decoding is read from the label (codec, picture size, 10-bit or HDR) and
  the browser's own answer to whether it decodes that smoothly and
  power-efficiently (`navigator.mediaCapabilities.decodingInfo`, asked once
  per codec and size a visit; `device-facts.js`), never from the browser's name. An MP4 that
  names no codec is asked as H.264; an MKV or WebM that names none says
  nothing; without an answer from the browser nothing is guessed. A card is
  drawn once what its note needs is known (the browser's answers and the
  sign-in, at most 300 ms; the add-on's placeholders stay till then), so a
  note never arrives under a finger. A second note, "Sound converted on the phone", shows when
  the label names Dolby Digital or DTS and no AAC, Opus, MP3 or FLAC, unless
  every sound it names is one this phone's browser says it plays as it is
  and has not failed to here (How a file plays, below). Both inform only:
  nothing is reordered, dimmed, hidden, ranked or picked by them.
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
- **Continue Watching remembers the stream** (owner ruling 2026-11-19;
  `app/resume.js`, `app/remembered.js`): the entry keeps the stream you tapped
  (its link, the torrent's hash and file, the release group, the add-on's name
  and the card's label; checked on every read, in the backup and the server
  copy; a finished entry keeps only the release group). A tap on the card
  opens the player at once and resolves that stream as a tap on the list
  does, from where it stopped; the title's streams are collected behind it
  for the Sources panel. If it cannot be reached, the same file is looked for
  in that list; if it is not offered any more, the sources panel says so and
  waits for your pick. Next Up continues the release group you watched, as
  Next does. Hold a card for "Choose another stream" (the list) and "Start
  from beginning" (the same stream from 0:00). A finger on a card asks for
  its address ahead (Get ready ahead). Entries from before open the list.
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

## How a stream's address is found

The owner's add-on (AIOStreams, which wraps Comet, MediaFusion and others)
gives a forwarding link, not the film's address, and a web page can follow
neither it nor TorBox's API, which let only TorBox's own site read them;
TorBox's file servers do let a page read the film. So Astra asks the
owner's own Worker (`addons/debrid.js`, `POST /v1/astra/play`), which
holds the TorBox key as a secret, with the add-on's link and what the link
says of the file (`addons/link-facts.js`: the torrent's hash, the file's
index, its name and size, read from AIOStreams' own link, Comet,
MediaFusion, Torrentio, StremThru, or one hash in the link; never asked
of anyone). The server answers with the film's direct address, from TorBox
itself or where the add-on's link leads, and the player reads it as any
host. The page never calls TorBox.

- **Signed in.** Astra's page reads the site's sign-in as Guitar's does
  (`addons/worker-api.js` through `th/ported/session.js`, SECURITY.md §4.4
  rule 4): a top-level page, or a frame whose top page is this site's own
  (home's island), never another site's frame; it never writes or creates
  the sign-in's database. The API's address comes from the site's
  `/config.js`, and the page's CSP names it at deploy (`MOVED_PAGES`).
- **At the tap** the mode is `play`: the server may add a film TorBox
  already holds to the owner's account (never an uncached one). **Before a
  tap** (a press, the next episode) the mode is `ahead`, which never adds
  anything: it answers with an address only for what is already in the
  account. A press that finds the film ready on TorBox but not in the
  account answers `ready: true` (no address yet; not a miss): the server
  keeps what it learnt for half an hour, so the tap costs only the add and
  the address.
- **What the server waits for** (measured in its tests' stub with the live
  delays, createtorrent 1000 ms, mylist 350, requestdl 400, checkcached 300,
  2026-11-19): a press asks checkcached and the account's list together
  (360 ms, or 760 with the address when the account holds it); a tap after
  it waits for createtorrent, then requestdl beside the listing that
  confirms the file's id (1410 ms, was 1760); a tap with no press asks
  checkcached beside the add (1410 ms, was 1760); a film remembered from
  the last half hour, requestdl alone (400 ms). Each answer carries every
  step's own time and the server's whole time (`total_ms`).
- **A tap during a press**: a tap follows the finger by about a tenth of a
  second, and a press needs a round trip and TorBox's answers, so the press
  has usually not answered by the tap. The tap gives it 100 ms (`GRACE`),
  then asks to play itself; whichever address comes first is played.
- **What is kept**: each answer, in memory only (never stored, gone with
  the page), per link, for 45 minutes (a TorBox link lives 3 hours, so the
  engine always starts with over two left); one under way is shared, so a
  press and a quick tap ask once. A tap's answer without an address is not
  kept; a press's is, a minute for a miss and half an hour for a `ready`
  one. A clock set back counts as expired. A renewed address replaces the
  kept one, and an older answer arriving late does not put it back. Signed
  out, everything kept is forgotten, and so it is when the add-ons change.
  The player is also given a way to ask afresh (`renew`) for an address
  that stops working mid-film.
- **When the server cannot help** (signed out, no answer within 30 s for a
  tap or 6 s ahead, an error, no address), the add-on's own link plays as
  it always did, and one plain sentence says why: the server's own reason,
  or Astra's ("Your server took too long to answer."). Stream info's
  **Address** line says "From TorBox directly", "Where the add-on's link
  leads, found by your server", "Through the add-on's link", or, when
  Chrome's own player plays it, that sentence; and when Chrome's player
  takes over because the add-on's link cannot be read, the notice gives
  that sentence instead of the general one (`player/address.js`).
- **Signed out**, Astra behaves as before: nothing is asked of the server
  and every link plays as the add-on gave it.
- Addresses, links, hashes and file names are sent only to the owner's own
  server, and are never stored, logged or put in a report by Astra.
- **The playback report** (`player/playback-report.js`): "Copy playback
  report" in Stream info while a film plays, the error card's "Copy
  report" and the lab's copy all give the same plain text: where the time
  went from the load to the first picture (the engine's `timing` entries),
  the route and why, the tracks, this phone's decoders, how the address was
  found (`via`, each step's time and the server's own, from
  `debrid.js answerFor`, looked up by the stream's own link or the address
  played, never another film's), the server group, the link's speed, the
  stalls so far, the chapter count, and the log as the engine wrote it (a
  kind it does not know is a plain line). A film that never opened says so,
  with why. **Owner ruling 2026-11-19: it keeps out only links, hashes,
  tokens and keys**, so the file's own words stay: each sound's title,
  language, codec, channels and how it plays and why (a title that claims
  FLAC over an AAC track shows), each subtitle's title, language and kind
  (inside the file, from an add-on, from this phone: a file picked from the
  phone shows its name), the plan's reason and notes, an error's detail in
  the engine's and libmedia's own words, why a sound was passed through,
  font names, and which track was chosen (its number and title). Every line
  is scrubbed whole, then cut to 300 characters: every web address in any
  form, magnet, hash, token and key goes, and so do the stream's own
  address, its host and its file's name wherever they appear
  (`scrubSecrets` with `names: false`). The lab's TorBox check keeps the
  stricter scrubbing (`names: true`: file and release names go too).

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
- **This phone and your others** (Settings > Your data; `src/app/sync.js`,
  with `sync-wire.js`, `sync-read.js`, `sync-merge.js`, `sync-addons.js`,
  `sync-record.js` and `sync-senses.js`; ASTRA.md §5.3). Signed in on the
  Thunderhead, "Keep Astra the same on every phone I sign in on" is on by
  default: add-ons, library, Continue Watching, the watched list, settings
  and recent searches are merged with a copy your own server keeps sealed
  (`/v1/astra/backup`), shortly after Astra opens (never before Home is
  drawn), back in front after more than five minutes, a minute after the
  last change, with **Sync now**, and when the page is hidden. Each time it
  names the version it already holds, so when nothing changed elsewhere the
  copy is not downloaded again. Progress, watched and library merge entry by
  entry (the later save of each wins; a removal is remembered for 60 days so
  the other phone cannot bring it back); Continue Watching stays at Astra's
  own 300. Add-ons merge address by address: one removed on any phone stays
  removed until it is added again, and one that arrives from another phone
  is named in a notice ("Added from your other phones: …"). Settings and
  recent searches go to the latest change. The first time, both sides are
  put together and nothing is lost, and a new phone simply takes what the
  server has. The film playing keeps its own progress, and progress that
  came from another phone is not reported to the Thunderhead as watched
  here. Player choices, Library layout and sort and the last stream filter
  never travel; the copy carries the newest 3,000 watched marks (older ones
  stay on the phones that have them). A copy too large for your server
  (1 MB) is not sent, and Your data says so. Failures stay quiet and are
  tried again later. Signed out or switched off, nothing is sent at all;
  signing out of a phone that kept Astra in step removes Astra's data from
  it (the server has it). **Remove the copy on my server** deletes it, with
  its daily copies, and switches this phone off. What the phone remembers
  for this (when each part last changed, removals, the server's version,
  when it last saved and fetched) is in localStorage `astra.sync.v1`,
  outside `astra.v2.*`, so no backup carries it. A restore, Clear Continue
  Watching, Copy again or turning Recent searches off with the switch on is
  a change like any other: it reaches your other phones, though a title
  another phone saved later than the backup keeps that phone's place.
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
   film the decoder is fed block by block from Astra's own reader, so such
   sound starts as fast as the picture, and the decoding, mixing and
   encoding run in a worker of their own, off the page's thread
   (`sound-apart.js`, `sound-worker.js`; on the page, `sound-stream.js`, only
   where no worker can run); with Headphone surround on, 5 to 8 channels
   are kept whole as uncompressed FLAC, `sound-six.js`) or `unsupported` (ALAC
   and other codecs no browser decoder exists for); a file with
   only unplayable audio can be played without sound when the viewer asks.
   Dolby Vision profiles are read from the MKV header and explained
   (profile 5 has no standard picture underneath). A DTS track's codec
   string, which Mediabunny finds only by reading the film's first cluster
   whole (5 MB of a 25 Mbit/s film before anything is planned), is read
   only where the browser takes some DTS as it is (`probe.js`); elsewhere
   the sound is converted anyway and the converter reads its own frames.
   The fonts a Matroska film carries for its styled subtitles (nearly every
   anime release: megabytes, before the first cluster) and its tags are
   Void to Mediabunny, which read both whole (`mkv-hide.js`; Fonts attached,
   below). Describing the tracks is bounded (`probe-limit.js`): the first
   cluster is read freely, and past it 3 s and 2 MiB in all; a track not
   described by then is left unread and the plan is made from what is known
   (A description that runs long, below). The engine's log (the report's)
   times the start: `timing` entries when the file is open, when its index
   is in, for each track that took over 200 ms to describe, at the plan, at
   the first fragment appended and at the first picture, each with the ms
   since `load()`, the bytes and the requests so far. A `memory` entry
   (`player-memory.js`) comes at each film's first picture and after every
   60 s of play while the page is visible: the JS heap in MB where the
   browser gives it (Chrome's, its arrays included), the seconds buffered
   ahead of the playhead and behind it and about how many MB that is, the
   reader's cache in MB and the budget in force (its name, its MB and its
   film MB), so a report from the phone shows what it held.
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
   audio has its own SourceBuffer, so changing track refills only the audio
   (`remux-switch.js`): another track, or the same one mixed again for the
   dialogue lift, is written over the old sound from a second past the
   playhead, so the old sound plays to there, the new one from there, and the
   picture does not stop. The buffer is emptied and the film seeks in place,
   which stops the picture briefly, as every change did before, when less
   than the join and half a second is buffered ahead, when the sound moves in
   time (Sound › earlier), after two changes written over in a row (each moved
   the sound against the picture by up to 27 ms; a seek sets it right), and
   when the film ran short since its last seek (Chrome then keeps up to 3 s of
   decoded sound, and the old track went on that long). A change whose new
   sound came late makes the next join longer, up to 2.5 s (A slow link, a
   change of track, below).
   Fragments carry absolute timestamps, so a seek outside the buffer starts
   fresh pipelines at the nearest key frame, and a seek inside what is
   already buffered (or just ahead of where reading is) starts nothing. A
   cluster only the dropped pipelines were reading is not read again for
   them (`mkv-packets.js` `jumped()`): it began a download at the place
   left, which took half the link from the new place.
   **How much is held** (`budget.js`, `hold.js`). The pipelines read 40 s
   past the playhead (20 with the data saver), the browser's buffer keeps
   20 s behind it (`mse.js`) and the reader's cache 80 s, and a film too
   fast for those seconds to fit is held to a memory budget, bytes first
   and seconds second: 112 MiB of film on a phone that says it has 4 GB or
   more (or says nothing), 56 on 2 GB, 32 on 1 GB, three quarters of that
   with the data saver. The budget is shared out at the film's average
   bitrate: what reading needs (the reach and a second behind it), at
   least 6 s ahead of the playhead and 2 behind, behind up to 12 s (the
   player's 10 s skip back and a key frame), the cache keeping what is
   ahead as well (a change of sound track reads it again from there), then
   more ahead and behind. A 25 Mbit/s film keeps about 8 s ahead and 12
   behind, a 60 Mbit/s one 6 s on each side; one under about 10 Mbit/s is
   held as before. By time alone a 25 Mbit/s film filled Chrome's video
   buffer to its own limit (about 150 MB, past which Chrome drops what is
   behind the playhead itself) (How smoothly, below; Memory while a film
   plays, below, for what holds the page's memory and why these numbers).
   Until the film plays at its place (a start, a seek), picture and
   sound are read at most 4 s past the playhead (`remux.js` `room()`; the
   sound alone was held so before, and the picture followed it, 3 s behind at
   most); then both read on. Text
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
   `rebuilt`) is read the same way, block by block, and decoded by
   Mediabunny's own sample reader in the sound worker (see Converted sound
   on a real film, below).
   A watchdog (`stall-watch.js`) looks once a second at a film that is stuck
   with nothing on its way: it steps over a hole of up to three seconds in
   the sound or the picture; when the sound ends before the picture, the
   film carries on from the same place without sound (the stream's notes say
   so), rather than stopping for good.
   **A link slower than the film** (`rebuffer.js`). The browser plays on as
   soon as anything is buffered, so such a link stalled every few seconds.
   After a stall (not a start or a seek, which go as fast as they can) the
   fragments of picture and sound now wait in the page until enough of the
   film is read to play a good while, so the element waits by itself and
   nothing is paused: 20 s of play times the part of each second the link
   cannot bring in time, at least 3 s of film, doubled when a stall comes
   within a minute of the last resume (twice at most), and never more than a
   wait of 15 s nor the pipelines' read-ahead less 2 s. The link's speed is
   what the reader received while a download ran, over the last 8 s of it; on
   a link as fast as the film or faster nothing is held, and a film plays
   exactly as before. The sound is held with the picture: with only the
   picture held, Chrome played the sound on for up to 3 s over a frozen
   picture before it waited. While such a wait has more than 2 s left, a line
   under the spinner says so and how long ("The connection is slower than
   this film. Playing again in 12 s", `player/loading.js`). The time spent
   waiting is the same (the bytes are what they are); the interruptions are
   fewer and longer apart (A slow link, below).
   **A converter that does not come** (`sound-wait.js`, `player-start.js`
   `converterLate`). Converted sound waits for its decoder's download; the
   browser plays only where every track has data, so a refused download
   stopped the film ("The audio converter could not be downloaded.", about
   3 s in) and a slow one held back the first picture. Now the picture waits
   for it at most 2 s once its own first second is buffered; then silence of
   the sound buffer's kind is written in its place, so the film plays, and
   the player says what happens: another track that needs no converter plays
   instead when the film has one, in the preferred language first ("The
   audio converter could not be downloaded, so this plays Stereo. Choose
   Surround in Audio to try again."; the converted track stays in the menu,
   and choosing it tries the download again); when the converter was only
   slow, the chosen track comes back by itself once it arrives. A film with
   no such track plays on without sound ("…so this plays without sound until
   it can be."), the download is tried again every 15 s, and the sound comes
   in over the silence from a second past the playhead when it arrives. A
   track chosen while playing whose converter is refused leaves the track
   that plays as it is, and says so.
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
   libmedia reads the film through `software-loader.js`: what has arrived
   as it arrives (at least 64 KiB; it asked for 1 MiB at a time and had
   nothing until all of it had come), and a Matroska film's fonts and tags
   as Void elements of zeros it never fetches (it steps over a Void by
   reading through it), its seek head naming the Info element in their
   place (it goes back to each element named there that it has not met).
   An HEVC 10-bit film started in 1.0 s instead of 2.0, and 1.3 s instead
   of 14.0 with an 8 MB font (Fonts attached, below).
   When libmedia cannot open or start a film, its own words ("[packages/avplayer/src/AVPlayer.ts][line 1858]
   [fatal]: open stream failed, ret: …") no longer reach the screen: the viewer reads one plain sentence by why the
   film came to the software decoder ("This phone's browser cannot decode this film's picture, and Astra's software
   decoder could not read the file either.", or after a failed start in the browser "This phone could not decode
   this film's picture, and…", else "Astra's software decoder could not read this file."), with the error card's
   choices (another source, another app), and libmedia's words stay in the engine's log for the report
   (`software.js` `plainly`, `player-start.js`).
5. **Reading the file** (`http-source.js` with `source-stream.js`,
   `source-blocks.js`, `source-tuning.js`, `side-read.js`, `source-tail.js`,
   `film-memory.js`). Playback's reads pull one download along (two at
   most), held in 1 MiB blocks; a read is answered as soon as its own bytes
   have arrived, not when its block is whole, and a read far inside a block
   is fetched from its own byte.
   - *While a film is described*, only what is asked for is fetched: a
     download stops 64 KiB past the last byte asked of it (and never runs
     more than 2 MiB ahead), since where playback starts is not known yet;
     resuming halfway then closes the connection at the start. Where what
     follows is passed over by its size (fonts attached, a Void), it stops
     at once. A download begun past such a part asks, as the first one
     does, for those 2 MiB, so a film from 0:00 plays on from it.
   - *Read-ahead by bitrate* (`source-tuning.js`). Once the size and the
     length give the film's bitrate, a download runs about 10 s of the film
     past the furthest byte read (5 s with the data saver), never under
     2 MiB nor over 24 MiB (8 MiB with the saver); before that, the byte
     limit alone. It asks for that in bounded requests, the next part once
     playback has come within half a reach of its end, so a seek or a stop
     throws away little the connection already carried (a host that ignores
     a range's end is read open-ended and paused instead), and stops where
     bytes already here begin (the film's end, a range remembered, a part
     another download brought), copying them in rather than fetching them
     again, so its block is still made whole. The block cache
     keeps 80 s of the film at its bitrate (a 30 s back-seek, the pipelines'
     40 s and the reach; 55 s with the saver), between 16 and 96 MiB. A film
     too fast for that within the memory budget (How much is held, above)
     keeps what reading needs and, while the budget lasts, what the
     browser's buffer holds ahead; its reach is at most 15 % of the budget
     (16.8 MiB on a 4 GB phone, about 5 s of a 25 Mbit/s film).
   - *Both ends at once* (`source-tail.js`). On a film's first open, as soon
     as the first answer gives the size, its last 64 KiB are asked for beside
     its start, in a request of their own: the subtitle hash needs them, and
     a short film's index (Matroska's cues, an MP4's index written at the
     back) often lies there too, so a read of
     the end waits for those bytes instead of costing another round trip. A
     long film's index is larger (a two-hour film with a key frame every
     2 s: 106 kB): it is read from its own first byte, and that download
     takes the tail's bytes from where they lie instead of fetching them a
     second time. The subtitle hash takes its two chunks from the reader by
     looking (`peek`), not reading: a read let the download at the film's
     start read on, 24 MiB of a film resumed at 2:00.
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
   - *At most three connections* (`source-gate.js`). A TorBox link allows
     four connections at once, and Astra keeps one in hand. Every request
     the reader makes to the film (its downloads, the film's end, the
     subtitle hash's reads, a block's first part, seek previews) takes one
     of three slots first and gives it back when its answer is over: read to
     its last byte (its Content-Length), cancelled, or broken off, which
     keeps the slot 100 ms longer while the connection closes, so a download
     restarted after a seek or a network change never stands beside the one
     it replaces. A request that finds all three taken waits: playback's
     downloads first, then side reads, previews last; and a download that
     has to wait ends a preview's request to take its place. A free slot is
     taken at once, so what need not wait is sent exactly when it was
     before. The subtitle hash reads through the reader now (it fetched on
     its own before). Each film has its own count (the next episode made
     ready is another link); HLS, DASH and a film the browser plays itself
     open their own connections. Measured 2026-11-18 on the test host (a
     one-minute 3 Mbit/s film, 1.5 MB/s a connection and 40 ms a request,
     `tests/fixtures/astra-host.mjs` counting the requests open at once):
     before, a preview drag held four (and by the code's paths up to five
     were possible: two downloads, the film's end and the hash's two reads
     at the start); now never more than three over a start, a far seek, a
     drag, a network change and a resume, with the same times to the first
     picture (medians of 12 runs, Matroska: start 424 ms before and 425
     after, resume at 30 s 475 and 475, far seek 832 and 832; MP4 with its
     index at the end, 7 runs: 417 and 417, 997 and 999, 791 and 792).
   - *A link that dies* (`source-renew.js`). A TorBox link lives three
     hours. `AstraPlayer.load({url, renew})` takes an optional `renew`: an
     async function giving a fresh address for the same film (the page asks
     the owner's Worker again). When a request to the film, after it had
     opened, is answered 401, 403, 404 or 410, or its connection is refused
     twice in a row (a page cannot tell that from an error page without
     CORS), the reader calls it once for every read waiting at that moment
     (15 s at most, and at most once a minute), moves both the address it
     was given and the one it reads from to the fresh one, and carries on
     from the same place with nothing shown: the blocks held and the film's
     memory belong to the file (its size and first bytes), not to an
     address, and stay. A side read answered as dead is asked again once on
     the fresh address. Without `renew`, at the very first open, or when
     renewing fails or the fresh address dies too, the reader fails as it
     always did. The player keeps the fresh address for its fallbacks, and
     its log says a renewal happened, never the address. HLS, DASH and the
     browser's own player read their addresses themselves and are not
     renewed.
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
   instead of 80, the pipelines keep 20 s ahead instead of 40, the memory
   budget is three quarters of the phone's, HLS and DASH
   are held to 720p and 20 s ahead, and nothing is got ready before a tap; a
   change applies to the film that is playing. With the earlier fixed
   read-ahead (8 MiB instead of 24), a three-minute 3.3 Mbit/s film, 40 s
   in, had downloaded 32 MB instead of 56.
7. **Another app**: when nothing in the browser can play a file, the player
   offers it to the phone's video apps (VLC, MX Player…) through an Android
   intent with the title and position (`src/player/external.js`).

### What plays (measured 2026-11-10, again 2026-11-16)

Seventy-two short test films, one for each container and codec pairing
worth trying, were played through `/astra/lab/` in desktop Chrome (which has
no HEVC decoder of its own, so HEVC shows the software route): 57 play,
11 stop with a reason and 4 still fail (as of 2026-11-11; on the 10th it
read "56 play, four of them without sound", and that was the checker's
fault: see MPEG Layer II below).
Before this pass 38 of the first 64 played and 14 showed black or stalled.
These counts were made with Mediabunny 1.55.7, before the TrueHD decoder
and the engine work of 2026-11-15. Dolby TrueHD, then among the files that stop, now plays
(`truehd.mkv` in `tests/astra-play-browser.test.mjs`).
Run again on 2026-11-16 (73 films, the three-minute one among them, in the
Chrome for Testing 153 the browser checks use): 55 play, 9 stop with a
reason, 9 fail; then, with three small patches to libmedia's readers (below),
61 play, 6 stop with a reason and 6 fail, one of them 10-bit H.264 in MP4,
which played before and in both runs again after (the checker's STILL: a
flake). The seven that changed are the four
H.264 AVIs, H.263 in 3GP and the two MKVs with Windows Media Audio, each
heard at the test tone's pitch by `scripts/astra/heard.cjs`. Of the other
five, four are the checker's STILL (two looks at the picture alike) on films
whose clock and frame count ran, not looked at further: the MPG pair (see
the note in `scripts/astra/README.md`), the open-GOP MKV, and 4K HEVC in
software, whose seek also stuck. The fifth is Sorenson Spark in FLV, below.

| Picture | Where | How |
|---|---|---|
| H.264, VP9, AV1 | MP4, MOV, MKV, WebM, TS, M2TS | the phone's decoder (`remux`; when the matrix ran, a plain MP4 or WebM went `native`) |
| H.264 | FLV, AVI | software decoder |
| H.263 | 3GP; AVI wired, not tried | software decoder |
| HEVC (8 and 10 bit) | MP4, MKV, TS | the phone's decoder where it has one, else software |
| VP8 | WebM as it is; MKV in software | |
| MPEG-4 ASP (Xvid, DivX), MS-MPEG4, WMV 7/8/9, Motion JPEG | AVI, MKV; MPEG-4 also in MP4 | software decoder |
| MPEG-1, MPEG-2 | MPG, VOB, TS, MKV | software decoder |
| Theora | MKV | software decoder |

Sound: AAC, Opus, FLAC and MP3 as they are; AC-3, E-AC-3, DTS, Dolby
TrueHD, Vorbis, PCM (every kind in MOV and MKV) and G.711 (µ-law and A-law,
in MOV) converted as they play, and so is MP3 in a MOV file (or, all but
TrueHD and G.711, decoded by the software decoder when it plays the file);
Windows Media Audio in AVI and MKV; ADPCM in an AVI.

Stops with a reason (and the offer of another app): the Windows Media
container (WMV, ASF) and RealMedia, which nothing here unpacks; Theora in
an Ogg file; Motion JPEG in MOV; ProRes; a file whose only sound is
ALAC. Sorenson Spark in FLV stops with "Astra has no decoder for the
video": libmedia's H.263 build has FFmpeg's `h263` decoders but not its
`flv` one (tried 2026-11-16: named as FLV1, the build will not open it).

**Three patches to libmedia's readers** (2026-11-16, one expression each,
recorded in `frontend/assets/libmedia/licenses/libmedia-modifications.txt`
and as `edits` in `frontend/ported.json`; checked by
`tests/astra-formats.test.mjs`, played by `tests/astra-formats-browser.test.mjs`).
H.264 in an AVI with no decoder setup in its header (as ffmpeg writes it)
failed with "Offset is outside the bounds of the DataView": the AVI reader
left such a stream unmarked as Annex B, so the decoder read its start codes
as lengths. 3GP calls H.263 `s263`, which the MP4 reader did not know.
The Matroska reader gave an `A_MS/ACM` track (Windows Media Audio, as MKV
keeps it) no codec at all; it now reads the WAV header inside, as FFmpeg
does. No newer libmedia helps: 1.3.1 (2026-06-27) is still the newest
release, and the 13 commits on upstream master since (to 2026-11-15) touch
none of these, nor add a Windows Media, RealMedia or ALAC reader or
decoder. Motion JPEG in MOV was tried the same way: named, it is read and
its sound plays, but no picture comes, so it still stops.

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

### How smoothly (measured 2026-11-18, on films shaped like real ones)

`scripts/astra/real.mjs` plays a film through the engine in Playwright's
Chromium (Chrome for Testing 153: it decodes H.264 itself and converts
Dolby and DTS sound, as the phone most likely does), served by
`tests/fixtures/astra-host.mjs`, one fresh browser profile a run. Two films
made for it and never committed: *heavy*, 3 minutes of 1080p H.264 at
about 25 Mbit/s (27.8 with its sound: Dolby Digital Plus 5.1 by default,
TrueHD 5.1, DTS 5.1 and AAC stereo) with an SRT track, 625 MB; *long*,
2 hours of 640x360 at 300 kbit/s with Dolby Digital 5.1 and AAC, 1500
subtitle lines, twelve chapters and a key frame every 2 s, so a cue index
of 106 kB at its end, 506 MB. *Slowed* is the page's thread six times
slower and one 20 Mbit/s link shared by the requests open, 40 ms a
request; *fast* is neither (the link is the machine's own). Medians of
three runs (two at 40 and 8 Mbit/s, five for the small film), before
(commit `ff95b75`) and after this change in the same sitting, on a
shared four-core machine with other measurements running, so a fast
figure moves by 15 % from one run to the next. The default sound is
converted to Opus here; the AAC track, passed through, gave the same
picture of things (one line below).

| Heavy film, slowed | before | after |
|---|---|---|
| First picture from 0:00 | 4.3 s | 2.9 s |
| Resuming at 2:00; opened again (remembered) | 5.2 s; 5.0 s | 2.7 s; 2.5 s |
| Far forward (to 1:59), far back (to 0:15), last minute (2:45) | 8.7, 7.9, 4.7 s | 4.6, 4.4, 2.6 s |
| Five seconds on (past the 1.4 s buffered: the link is slower than the film) | 6.9 s | 6.1 s |
| 60 s of play: stalls, time stalled, frames dropped | 9, 23 s, 55 | 8, 17 s, 17 |
| The page's thread: long tasks a minute, their total, the worst; most late | 19, 1.3 s, 152 ms; 195 ms | 1, 55 ms, 55 ms; 52 ms |
| The page's memory at its peak (renderer PSS); JS heap and its ArrayBuffers | 374 MB; 188 MB | 256 MB; 99 MB |
| The reader's cache; the browser's buffer behind the playhead | 97 MB; 21 s | 49 MB; 9 s |
| The same with the AAC track: first, resume, far; memory; long tasks | 3.2, 5.4, 8.8 s; 337 MB; 19 | 2.9, 2.7, 4.5 s; 230 MB; 0 |

| Heavy film, other links | before | after |
|---|---|---|
| Fast (the same within the machine's noise): first, resume, far forward | 0.76, 0.74, 1.26 s | 0.80, 0.88, 1.23 s |
| Fast: memory peak; JS heap; browser's buffer ahead | 653 MB; 231 MB; 39 s | 494 MB; 144 MB; 14 s |
| Fast: downloaded in the first minute, for 203 MB of film played | 355 MB | 267 MB |
| 40 Mbit/s, thread slowed: first, resume, far | 3.4, 3.1, 5.1 s | 2.1, 2.0, 3.1 s |
| 40 Mbit/s, thread slowed: stalls in 60 s; long tasks; most late | 5 (1.7 s); 59 (4.7 s); 461 ms | 1 (0.1 s); 5 (0.3 s); 88 ms |
| 8 Mbit/s: first, resume, far, last minute | 6.2, 11.1, 18.8, 11.2 s | 6.2, 5.9, 10.2, 6.0 s |
| 8 Mbit/s: 60 s of play (17 s of film): stalls, time stalled | 8, 44 s | 8, 44 s |

| Long film (2 h, 300 kbit/s), slowed | before | after |
|---|---|---|
| First picture from 0:00 | 1.40 s | 1.24 s |
| Requests to the film's end before it (the 64 KiB tail, the 106 kB index from its first byte, the tail again in part) | 3 | 2 |
| Resuming at 1:30:00; opened again (remembered) | 1.20 s; 0.63 s | 1.28 s; 0.51 s |
| Far forward (to 1:00:00), far back (to 0:10:00), last minute (1:59:30) | 0.74, 0.59, 0.56 s | 0.70, 0.65, 0.56 s |
| Five seconds on, inside the buffer | 0.03 s | 0.03 s |
| 60 s of play: stalls; memory peak (from one run to the next) | 0; 123 to 181 MB | 0; 140 to 175 MB |
| Fast: first, resume, remembered | 0.56, 0.66, 0.26 s | 0.44, 0.37, 0.18 s |

The long film was never in trouble: its times are the same within the
machine's noise (a run's resume: 1.10 to 1.37 s before, 1.03 to 1.37
after), with one request fewer at its end. Its figures are from the code
as it stands; the heavy film's from the code before the last change
(remembered bytes copied into a download's block rather than ending the
download there), which asks for nothing more or less.

A seek or a resume on the long film costs two bounded requests of 2 MiB
(the picture from its cue's block, the sound from the start of that
cluster) and about 1.5 MB before its picture; the cue lookup itself is
nothing (3,600 points, searched in memory). A small film is no worse:

| Small film (1 min, 720p at 3 Mbit/s; 1.5 MB/s a connection, 40 ms a request; 5 runs) | before | after |
|---|---|---|
| First picture; resuming at 0:30; opened again | 329, 673, 606 ms | 334, 633, 571 ms |
| Far seek; memory peak | 71 ms; 146 MB | 73 ms; 137 MB |

What fell over, and what changed (each with a test that would catch its
loss):

- **Describing a film read its first cluster whole** (`probe.js`;
  `tests/astra-probe-reads.test.mjs`). Mediabunny's `getMimeType()`, for a
  report field, and the DTS track's codec string both need DTS's first
  frame, which Mediabunny finds by reading the first cluster: 5.3 MB of the
  heavy film, half of it before anything was planned and the rest with a
  playback download's reach, even for a resume. Neither is asked now where
  the browser takes no DTS as it is.
- **A resume downloaded the film's start** (`player.js` `fileFacts`). The
  subtitle hash read its first 64 KiB through the reader, which let the
  download left at the start read on: 24 MiB a resume never plays, beside
  the download it needed. It looks (`peek`) instead.
- **A seek left a download at the place it left** (`mkv-packets.js`
  `jumped()`; `tests/astra-mkv-packets.test.mjs`). The pipeline being
  dropped read its cluster again once its read was refused, which started a
  24 MiB download there that took half the link from the new place.
- **The film was held two and three times** (`hold.js`, How a file plays;
  `tests/astra-hold-browser.test.mjs`, `tests/astra-bytes.test.mjs`). The
  browser's buffer sat at its own limit (39 s ahead, so Chrome dropped all
  but 10 s behind), the cache held its last 96 MiB again, and the copies
  made on the way waited for the garbage collector. Held to bytes, the
  heavy film keeps 14 s ahead, 8 behind and a 48 MiB cache.
- **Fewer copies** (`mkv-blocks.js`, `fragments.js`). Each block of
  picture was copied twice while its cluster was read and each fragment
  once more to join its two boxes, 3 MB a second each on the heavy film:
  a block is now a view of the reader's own bytes and the boxes are
  appended one after the other. Together with the smaller buffers, the
  long tasks went from 19 a minute to 1.
- **An index larger than the tail was fetched twice in part**
  (`source-stream.js`, `source-blocks.js` `present()`;
  `tests/astra-bytes.test.mjs`). The download reading the long film's cue
  index asked again for the tail it ran into; it stops where bytes already
  here begin and copies them in from where they lie, so its block is still
  made whole for the subtitle scanners (stopping alone left a block with a
  remembered range inside never whole, and its subtitles unread).

What is left: on a link slower than the film (8 and 20 Mbit/s against
27.8) it stalls, as anything must: 8 or 9 times a minute, about 2 s each
at 20 Mbit/s and 5.5 s at 8, the element reporting `waiting` each time
(the player shows its spinner after 400 ms of it; not looked at on screen
here); nothing restarts or seeks meanwhile. (Since then a stall on such a
link waits for seconds of film: fewer, longer stalls; A slow link, below.) A seek five seconds on is then
not inside the buffer and waits for the download to reach it. The page is
under 250 MB only while the link is slower than the film: at 40 Mbit/s it
peaks at 380 MB, of which about 120 MB is garbage the collector had not
taken yet (260 MB with a collection forced before each look), and on the
fast link near 500 MB (what holds it, and what was tried: A slow link,
below, Memory on a fast link; all these memory figures include the copy
of every download Playwright's DevTools connection keeps in the page,
about 190 MB of this film after 90 s: Memory while a film plays, below). For scale, Chrome playing the same picture from a
plain MP4 by itself, with no Astra, peaks at 175 MB (the lab page alone:
50 MB). On the fast machine a seek five seconds on, inside the buffer,
takes 0.35 to 0.9 s where Chrome playing that MP4 itself takes 0.16 s: not
explained yet, and the same before (four more runs of each, taken in turn:
0.42 s before, 0.35 s after). This Chromium counts nearly every frame as
dropped while `requestVideoFrameCallback` is asked for again and again
(the browser playing a file by itself too), so the script watches frames
only while it waits for a picture. Not measured: the phone itself,
Chrome's video buffer limits on Android, HEVC and 4K films, a real debrid
host, changing the sound track on the heavy film, a film with its index at
the front.

Earlier (2026-11-10, a three-minute 1080p film at 8 Mbit/s, Mediabunny
1.55.7): a seek's downloads of the place left are closed (`jumped()`),
Dolby Digital and DTS are mixed to stereo a sample at a time
(`downmix.js`) and the picture arrives in half-second fragments
(`early.js`, `scripts/astra/rewrap.mjs`); the audio decoder downloads while
the first video is read. Changing the audio track stopped the picture for
about a third of a second (the seek in place that flushed the old sound;
since 2026-11-18 it does not stop it, `remux-switch.js`).

### Converted sound on a real film (measured 2026-11-18)

Films made with ffmpeg for this only (never committed): a 3-minute 1080p24
H.264 film at about 25 Mbit/s (noise in the picture) with four sound tracks,
Dolby Digital Plus 5.1 (640 kbit/s), Dolby TrueHD 5.1, DTS 5.1 (1.5 Mbit/s)
and AAC stereo, each a tone at its own pitch; the same film with marks (each
tone 26 dB louder for the first 50 ms of every second, the picture copied
untouched); and a two-hour 360p film with Dolby Digital 5.1 and AAC, a key
frame every 2 s, marked the same way. Played by the engine from the tests'
file host in the tests' headless Chromium 153, on a 4-core machine other
measurements shared (single figures move by up to a second: the counts of
runs are given). "Slowed" is the page's thread made six times slower through
DevTools; DevTools cannot slow a worker ("only supported for pages"), so
there the workers ran at full speed and the phone's cost of them is not
measured. Sync is the moment each mark is heard (a recorder on the page's
sound) against the film's clock from the frames shown
(requestVideoFrameCallback), compared with the AAC track, which the browser
plays itself (+16 to +43 ms by this measure, from one sitting to the next:
the reference).

**Where the work ran.** The decoders' WebAssembly already ran in a worker
of their own (Mediabunny's packages start one). Everything around it ran on
the page's thread: Mediabunny's sample reader fed a packet at a time
(TrueHD: 1,200 a second), the mix to stereo, each AudioData built, the Opus
encoder's calls and its output, the MP4 writer, and on a film's first
converted sound the decoder's 0.7 to 1.7 MB of JavaScript. Opus itself is
encoded in the browser's own threads. Now only the reading stays on the
page; the rest runs in the sound worker (`sound-apart.js`,
`sound-worker.js`), which the packets reach in quarter-second batches as one
buffer handed over (not copied again) and which hands back each MP4
fragment. Thread time for each second of film, fast machine, from a trace
(before: medians of 3 runs; after: the range of 4 runs, 2 for DTS):

| Sound | Page before | Page after | Sound worker | Decoder's worker | Opus |
|---|---|---|---|---|---|
| Dolby Digital Plus 5.1 | 75 ms | 48 to 63 ms | 18 to 23 ms | 9 to 12 ms | about 11 ms |
| Dolby TrueHD 5.1 | 165 ms | 42 to 64 ms | 47 to 70 ms | 19 to 33 ms | about 20 ms |
| DTS 5.1 | 85 ms | 54 to 60 ms | 25 to 27 ms | 18 to 23 ms | about 10 ms |
| AAC, passed through | 55 ms | 55 ms | | | |

So the page's thread now spends on a converted film what it spends on one
whose sound passes through (the reading, the picture, the MP4 writer). The
worker holds about 20 to 28 MB of JavaScript heap (a second copy of
Mediabunny and the decoder), while the page's heap with TrueHD playing went
from 19 to 27 MB to 13 to 18 MB (7 MB with AAC).

Slowed six times, one run each (the "before" runs while the machine was
busier, so their long tasks and waits are not a fair match; the seeks are
compared fairly below):

| Slowed six times | DD+ before | after | TrueHD before | after | DTS before | after |
|---|---|---|---|---|---|---|
| Converted sound ready ahead, least and median | 9.7, 39 s | 9.9, 40 s | 0.7, 22 s | 10.2, 40 s | 2.1, 39 s | 9.8, 40 s |
| Long tasks a minute while playing (their time) | 2.9 (0.17 s) | 2.2 (0.12 s) | 7.1 (0.44 s) | 6.1 (0.39 s) | 25 (1.7 s) | 2.5 (0.14 s) |
| First sound from 0:00 | 1.9 s | 2.1 s | 2.9 s | 2.5 s | 3.1 s | 2.7 s |
| Picture stopped by a change of track | 2.7 s | 1.1 s | 0.9 s | 1.0 s | 1.4 s | 0.65 s |

TrueHD converted on the slowed page kept 22 s ahead at the median and once
0.7 s (a second run: 9 s and 1.3 s): close to running dry. In the worker
every track keeps its full 40 s. In no run, before or after, did the sound
run short under the picture (less than 0.3 s of sound ahead while the
picture had a second); the waits seen while playing had both buffers full
(the machine's own load). Four times slower (TrueHD, one run each, the
"before" one beside other work): least ready ahead 3.2 s before, 9.5 s
after; long tasks 6.8 and 2.5 a minute; picture stopped by a change of
track 1.5 s and 0.6 s.

**Reading after a seek.** Converted on the page, the sound held the
picture's reading back (the picture reads no more than 3 s past the sound),
by accident. Freed of that, on a host faster than the film (the tests' host
here, or fast Wi-Fi to a debrid server) the picture read on to its 40 s
read-ahead straight after a seek and filled the page's thread, and the
frames the film waited for came later: far seeks, page six times slower,
3.2 s to the sound and 3.8 s to the picture (Dolby Digital Plus, 4 runs of 8
seeks) against 2.6 s and 2.6 s before. Sound passed through as it is had
the same trouble already (AAC: 3.1 s and 3.9 s, 2 runs). Now sound is read
at most 4 s past the playhead until the film plays at its place
(`remux-audio.js`; since moved into `remux.js` for both), and the picture with it: 2.6 to 3.1 s for both with
Dolby Digital Plus, 2.7 to 3.0 s for both with AAC (2 runs each). From a
host at 40 Mbit/s, which paces the reading anyway: 2.1 s to sound and
picture against 2.8 s before (2 runs before, 4 after), and 2.2 to 2.4 s
from 0:00 against 2.8 to 3.0 s.

**Sound fragments of a quarter second.** The film cannot play at a new
place until the sound's first MP4 fragment is in, and the page's writer
cut sound every second at least (`fragments.js`; a quarter second too since,
for sound passed through: A slow link…, below): the picture waited for a
second of the film to be read. The sound worker cuts every quarter second:
from a 40 Mbit/s host, a far seek gave picture and sound back in 2.0 s
against 2.5 s (3 runs of 8 seeks each, fast machine).

**Sync.** No converted track's sound was more than 20 ms from where the AAC
track's is (medians of a stretch), before or after, and none drifted. In
one sitting, fast machine, 2 runs each, at the start / after a minute /
after seeks: the AAC track +40 to +43 / +41 to +54 /
+28 to +46 ms; Dolby Digital Plus +31 to +36 / +13 to +33 / +24 to +40
before and +41 to +45 / +31 to +42 / +13 to +49 after; DTS +38 to +50 /
+49 to +51 / +26 to +60 before and +44 to +54 / +45 to +56 / +20 to +57
after. Over three minutes, slowed or not, the measure stepped by 10 to 25 ms
at times, either way and for the AAC track too; the sound as written does
not: every fragment the worker wrote began exactly where the one before
ended (about 2,300 joins a run, Dolby Digital Plus and DTS, not one sample
of gap or overlap).

**Changing track** stops the picture: the audio buffer is emptied and the
film seeks in place once the new sound covers the playhead (`remux.js`).
On the real film, Dolby Digital Plus to TrueHD: 0.9 to 1.2 s of no new
frame on a fast machine, 1.8 to 2.7 s slowed; the first time a film needs a
decoder on the page, its download and compiling were in that wait too (AAC
to Dolby Digital Plus, slowed: 3.2 s); the decoder now loads in the worker.
Writing the new sound over the old from a second ahead, without emptying the
buffer or seeking (tried in a copy of `remux.js`, not here: it is not this
work's file), stopped the picture 0.1 to 0.4 s fast and 0.45 to 0.6 s
slowed (2 runs each), and the tests that change track passed with it. It is
how a track changes now (`remux-switch.js`; A slow link, a change of track,
below).

**Headphone surround** keeps Dolby Digital Plus 5.1 whole as FLAC: 576 kB
a second, read 15 s ahead (`sound-six.js`). Slowed six times, the audio
buffer held up to 21.7 s, about 12.5 MB, which is at the browser's limit
for an audio buffer (about 12 MB on a computer): it dropped what had played
by itself and refused no append, before or after. Ready ahead, least and
median: 6.0 and 14.3 s before, 9.9 and 14.6 s after. Out of the worker the
fragments came faster than the slowed page appended them (up to 6.5 MB
waiting); whole surround is now kept within a second of the reading and at
most 2 MB waits (2.7 MB seen). Far seeks: 2.2 s before, 2.5 s after (one
run each). The placed sound measured +31 to +33 ms at the start and +59
to +61 ms after three minutes in all four runs, before and after alike,
rising by steps, where the plain mix in the same sitting went from +7 to
+33 ms (one run): some 25 ms later than the plain mix, and rising as it
does; with the measure's own steps (above) the size of the rise is not
sure. Explained since: the chain's HRTF panners and limiter, 12 ms, now
compensated (A slow link, a change of track, below).

**Even loudness** changed nothing measured: fast machine, 2 runs each, the
sound +31 to +37 ms at the start and +39 to +42 ms after a minute before,
+33 to +37 and +38 to +44 after (AAC alone, that sitting: +40 to +43);
slowed six times, long tasks 5 and 7 a minute, seeks 2.4 s, before and
after (one run each).

**The two-hour film** (Dolby Digital 5.1 converted, fast machine, one run
each): at 1:00:00 the sound was +28 ms before and +31 to +34 ms after,
against +37 ms for its AAC track; after ten seeks across the two hours,
+26 to +47 ms before and +24 to +39 ms after, against +32 to +45 ms: no
drift with the place in the film. Its seeks: 0.3 to 1.4 s to sound after
(0.3 to 2.2 s before).

**The converter's download.** Refused: the film stops with "The audio
converter could not be downloaded." about 3 s after it is planned (three
tries), before and after. Held back 8 s: the first picture waits for it
(9.2 s from the tap before, 11.8 s after, one run each on a busy machine;
the first picture always waits for the sound's first fragment). It plays on
now, with another track or without sound (`sound-wait.js`; A slow link, a
change of track, below). In the app the decoder is usually fetched ahead,
when the list of streams shows converted sound.

Not changed, measured: Opus at complexity 5 or with 60 ms frames instead of
the browser's defaults (no difference beyond the noise in the browser
threads' time, 2 runs each). Considered and not tried: FLAC instead of
Opus for stereo (no encoder, but eight times the bytes in an audio buffer
the browser holds to about 12 MB). Converted sound still runs 40 s ahead
as the picture does, so a far seek throws away up to 40 s of conversion
(in the worker now). Not
measured: any of this on the phone; the workers' cost on its slower cores;
a decoder that fails mid-film in the worker beyond the test's.

### A slow link, a change of track, a converter that does not come (measured 2026-11-18)

The heavy film again (`scripts/astra/real.mjs` and `heard.cjs`), in Playwright's Chromium on the four-core machine
with nothing else measuring, before (commit `a84f9b1`) and after in the same sitting; medians of 3 runs unless said.

**A link slower than the film** (`rebuffer.js`, How a file plays). The page's thread six times slower, one link of
20 or 8 Mbit/s shared by the requests open, 40 ms a request; 120 s of play from the first picture:

| Heavy film (27.8 Mbit/s), slowed | 20 Mbit/s before | after | 8 Mbit/s before | after |
|---|---|---|---|---|
| Stalls in 120 s | 11 | 3 | 11 | 6 |
| Time stalled in all | 35.9 s | 39.7 s | 88.2 s | 87.6 s |
| Longest play between stalls; longest stall | 10.7 s; 4.1 s | 39.5 s; 15.7 s | 4.2 s; 10.3 s | 7.0 s; 17.0 s |
| Film played; first picture | 86.3 s; 2.52 s | 82.6 s; 2.46 s | 34.0 s; 4.84 s | 34.5 s; 4.85 s |
| Memory at its peak (PSS); held in the page at most | 313 MB; 1.6 MB | 321 MB; 32 MB | 274 MB; 1.6 MB | 286 MB; 15 MB |

At 20 Mbit/s the first stall waited for 5.6 s of film (8.4 s), the next, a minute later, for 10.7 s (15.7 s), and
the film then played about 40 s at a time; the estimate shown under the spinner was within a second of the wait. At 8
Mbit/s the 15 s cap holds every wait to about 4.3 s of film, so it plays 7 s at a time instead of 4: a link that slow
is still a poor match for such a film, and the stalls only halve. The time stalled in all is the same within the
measure (it ends inside a stall), as it must be; the film's bytes in the page while held are the price, and the page
peaked 8 to 12 MB higher. The first picture, a start and a seek are not held.

**A change of track** (`remux-switch.js`, How a file plays). `heard.cjs --switch` on the heavy film with sound marks
(its four tracks at their own pitches: Dolby Digital Plus 440 Hz, TrueHD 550, DTS 660, AAC 880), twelve changes
7 s apart, every ordered pair of the four once, listening all along (the pitch every 5 ms) and watching each frame
shown; one run each, minimum / median / most of the twelve changes:

| Each change of the twelve | fast, before | fast, after | page slowed six times, before | slowed, after |
|---|---|---|---|---|
| Written over the old sound (no seek in place) | 0 | 8 (8 in a second run too) | 0 | 5 |
| The new track heard after the tap | 0.29 / 0.42 / 1.11 s | 0.48 / 1.07 / 1.81 s | 1.09 / 1.46 / 1.79 s | 1.58 / 1.81 / 3.07 s |
| Longest silence on the way | 162 / 853 / 969 ms | 0 / 0 / 963 ms | 789 / 1163 / 1480 ms | 0 / 423 / 1741 ms |
| Picture's longest pause | 167 / 851 / 1138 ms | 83 / 125 / 1109 ms | 933 / 1266 / 1517 ms | 367 / 733 / 2771 ms |
| The old track heard after the new | 0 to 32 ms (the listening window) | 0 to 21 ms | 5 to 27 ms | 0 to 21 ms |
| Sound against the picture after it | +28 to +53 ms | +13 to +55 ms | +28 to +52 ms | +23 to +59 ms |

The new track now comes a second after the tap by design (the old one plays to the join), where before it came
sooner but through a silence of up to a second with the picture stopped. A change written over the old sound left
no silence and no old sound after it on any of the twelve pairs, passed
through to converted and back included (`changeType` keeps what is buffered of the other kind and Chrome's decoder
follows on); the picture's longest pause was 83 to 167 ms, against 50 to 83 ms with no change at all. Two things
make the others seek in place. Written over every time (twelve in a row, three runs), the sound moved against the
picture by -27 to +17 ms a change (the tracks' own timing differs, and a seek sets it right), 47 ms in all once; so
after two in a row the third seeks. And on the slowed page a change written over at a second ahead came 0.4 to 0.8 s
late, the sound ran short, and from then on Chrome kept up to 3 s of decoded sound: the old track went on for 3 s
and the sound drifted 80 ms late over twelve changes (heard 3.1 s after the tap); now a change after the film ran
short seeks in place (which brings Chrome's store back), and a late one makes the next join longer (1.75, then 2.5 s).
With no change at all, the same measure gave +19 to +25 ms for Dolby Digital Plus.

**The converter refused or late** (`sound-wait.js`; the decoder's file refused, or answered 8 s late, by the test
browser itself, the film from the tests' host; one run each):

| The heavy film (DD+ by default, AAC beside it) | before | after |
|---|---|---|
| Refused, fast: the first picture; what plays | none in 16 s; nothing | 2.66 s; the AAC track, with "The audio converter could not be downloaded, so this plays Stereo…" |
| Refused, page slowed six times | none in 16 s | 3.70 s, the AAC track |
| 8 s late, fast: the first picture; then | 8.58 s, DD+ | 2.62 s with the AAC track; DD+ from 8.7 s, by itself |
| 8 s late, slowed | 8.96 s | 3.85 s, AAC; DD+ from 7.5 s |
| `surround.mkv` (Dolby Digital only), refused | no picture | 2.21 s without sound, and the notice; the sound comes in once a later try downloads it (the test) |

**How the reading lets the page breathe** (`remux.js`). The reading loops yield every 8 ms with `scheduler.yield`, which
runs them again ahead of other waiting work; with `setTimeout` instead the sound worker's report saw the picture after
a seek 0.7 s sooner (2 runs). Measured here (the unpaced host, the page six times slower, a tap every 2 s while it
plays changing a line of text, as a menu does; medians of 3):

| Heavy film, slowed, unpaced host | `scheduler.yield` (as it was) | `setTimeout` | `scheduler.yield`, both kinds held to 4 s in `room()` (now) |
|---|---|---|---|
| First picture; resume at 2:00; opened again | 1.77, 1.67, 1.22 s | 1.88, 1.53, 1.24 s | 1.81, 1.45, 1.10 s |
| Five seconds on; far forward, far back, last minute | 0.71; 2.43, 2.16, 1.36 s | 0.76; 2.40, 2.26, 1.37 s | 0.82; 2.14, 1.91, 1.15 s |
| A tap to the next paint, median and worst | 16, 24 ms | 16, 32 ms | 16, 32 ms |
| Long tasks while it plays; the 50 ms timer most late | 0; 230 ms | 0; 86 ms | 0; 97 ms |
| Frames dropped in 40 s; memory at its peak | 21; 490 MB | 22; 503 MB | 16; 468 MB |

`setTimeout` gained nothing measurable here, and a tap reached the screen in a frame or two either way (the 64 to
360 ms the player's own measure found were on the real menus, which this does not draw: not reproduced); holding the picture's
reading to 4 s with the sound's until the film plays at its place gained 0.2 to 0.3 s on every seek and resume.

**Fragments of a quarter second** (`fragments.js`, `early.js`). Sound passed through as it is (AAC here) was written in
fragments of a second at least, the picture in half-second ones. Medians of 3, a 40 Mbit/s host on the fast machine
and the page six times slower on 20 Mbit/s with 40 ms a request; the sound's with the AAC track, the picture's with
the default (converted) one:

| Heavy film | sound: 1 s fragments | ¼ s (now) | picture: ½ s fragments (now) | ¼ s |
|---|---|---|---|---|
| Fast: first picture; far forward, far back, last minute | 1.04; 2.65, 1.00, 1.46 s | 1.01; 2.10, 0.94, 0.97 s | 0.85; 2.23, 1.13, 0.99 s | 0.98; 2.15, 0.99, 1.00 s |
| Slowed: first picture; far forward, far back, last minute | 2.82; 4.48, 4.33, 2.48 s | 2.50; 3.48, 3.29, 1.52 s | 2.48; 3.55, 3.40, 1.61 s | 2.46; 3.43, 3.41, 1.59 s |

Quarter-second sound gained up to a second on every far seek, slowed; quarter-second picture gained nothing beyond
the noise, so the picture's fragments stay at half a second. With four times as many sound fragments, a refill that
came between a fragment's two boxes (each moof and mdat is appended on its own) left the buffer inside a segment,
and setting its timestampOffset threw (`astra-sound-stream-browser.test.mjs` failed two runs in three); a reset now
always starts the buffer's parser afresh (`mse.js`), which only a reset during an append did before.

**Memory on a fast link** (these figures, read through Playwright, include its copy of every download, up to 190 MB; Memory while a film plays, below, has them without it). Every array of 64 KiB or more the page's scripts made while the heavy film played 37 s on
the fast link, counted by where it was made (a counter wrapped around `Uint8Array`, `ArrayBuffer` and `slice`): 285
MiB in Mediabunny's writer, which collects each box it hands over in an array that starts at 1 KiB and doubles, copied
each time; 121 MiB in the reader's blocks (the film's bytes, once); 15 MiB answering reads from blocks still filling;
and, made by the browser, the download's own chunks (121 MiB). Making each mdat's array at its size, read from the
moof before it, cut the writer's 285 MiB to 114, but the page's memory did not move (fast: 461 MB at its peak and
405 at the median before, 480 and 405 after; slowed: 311 and 305 MB; medians of 3): the collector keeps up, and most
of the page is outside its heap. So it was not kept. What the page holds, fast: the JS heap with its arrays 75 to 125
MB, of which the reader's cache is 49 MB; the browser's buffer, 14 s ahead and 8 behind (about 75 MB at this
bitrate); converted sound's worker and its decoder about 50 MB (the same film with its AAC track peaked 240 MB where
Dolby Digital Plus peaked 289, ten seconds in); the rest is Chrome's own (the lab page alone 50 MB, Chrome playing
the same picture from a plain MP4 by itself 175 MB). Holding less (the reader's cache 32 MiB, which with the reach
it needs at this bitrate is 39, and 16 MiB kept behind the playhead, 5.8 s instead of 8) took the fast link's peak
from 529 to 514 MB, inside the runs' own spread (504 to 544), and gave up a third of what a seek back finds at once:
not kept either. So the aim of 350 MB on a fast link and 280 slowed is not met (fast 529 MB at its peak this sitting,
536 before this round; slowed 331 and 312, the 19 MB more being film held through a stall, A slow link above). Most
of it is Chrome's: its buffer at the bytes Astra holds (75 MB), its decoders and frames, and the page itself; Astra's
own floor is the reader's cache (the reach and 4 s of film, 38 MiB at this bitrate), the JS heap around it (about 30
MB) and the converted sound's worker (about 50 MB, none with sound passed through).

**Headphone surround's delay.** An impulse through the chain offline: off, it comes out at once; with Headphone
surround 12.2 ms later (the HRTF panners' convolution, 6.2 ms, and the limiter's 6 ms look-ahead, which the chain
puts in for it); boost or night mode alone, 6 ms (the compressor's look-ahead). Against the film's frames (the
marks, fast machine, two runs, over 100 s and two seeks), Headphone surround's sound was +46 to +61 ms (median +52),
the plain mix +24 to +43 (+36.5) and the AAC track +35 to +50 (+39.5): 12 to 16 ms later, the chain's own delay. It
is the browser's (Web Audio's nodes; nothing makes the video wait for them), so whole surround, which only that
chain plays, is now written 12 ms ahead of the picture (`sound-six.js` PLACED). After (two runs): +21 to +47 ms
(median +39.5) against the plain mix's +24 to +48 (+38.5) in the same sitting. On the two-hour film (Dolby Digital
5.1 placed, from 1:00:00, then six seeks between 5:00 and 1:56:40): +49 at the start and +49 a minute on, +33 to +48
after the seeks, against its AAC track's +21 to +48: nothing drifts with the place in the film or over a minute. The
earlier figure of +60 after three minutes, rising from +31, went with the plain mix rising too (+7 to +33): the
measure's own steps, not the sound's. Boost, night mode, the dialogue lift and even loudness put the same limiter in
for any sound (6 ms) and are not compensated.

**A small film is no slower** (the one of How smoothly: 1 min of 720p at 3 Mbit/s with AAC, 1.5 MB/s a connection,
40 ms a request; medians of 5, the same sitting):

| Small film | before | after |
|---|---|---|
| First picture; resuming at 0:30; opened again | 326, 628, 554 ms | 240, 542, 467 ms |
| Far forward, far back, last 15 s; memory at its peak | 112, 76, 87 ms; 160 MB | 107, 84, 81 ms; 164 MB |

Its sound passed through now comes in quarter-second fragments, which is the 85 ms its start and resume gained (with
everything else of this round and the old fragments: 337, 620 and 562 ms).

### Fonts attached (measured 2026-11-18)

A Matroska film that carries the fonts of its styled subtitles started only after Astra had downloaded every
font: Mediabunny walks the top-level elements before the first cluster and reads the Attachments element (and the
Tags) whole. On a real anime episode from the owner's add-on the engine sat 9.8 s in "Reading what is inside…";
the phone took 10 to 25 s to start such films. Now (`mkv-hide.js`, `probe.js`) Mediabunny is handed both elements
as Void elements of the same length, which it steps over by their size; the download at the film's start stops
where the fonts begin, and the header past them is asked for in a request of its own that reads on into the first
cluster, so a film from 0:00 plays on from it. The fonts are read only when a styled track is shown, once the first
picture is up, in requests of their own that end with the element (`mkv-attachments.js` `sideReader`,
`player-libass.js`): the track's text shows at once in Astra's own renderer, and libass draws it with the film's
fonts when they land. A block before the first cluster that holds only fonts is not fetched for the subtitle
scanners (`side-read.js`).

Films made from one 2-minute 1.5 Mbit/s film (H.264, AAC, an ASS track) that differ only in what lies before the
first cluster (`scripts/astra/real.mjs --mbit 5.4 --delay 110`, a fresh profile a run, medians of 3 to 5 runs; the first
picture and the MB downloaded by then):

| Before the first cluster | From 0:00, before | after | Resumed at 1:00, before | after |
|---|---|---|---|---|
| Nothing more | 0.29 s, 0.2 MB | 0.28 s, 0.2 MB | 0.80 s, 0.5 MB | 0.77 s, 0.5 MB |
| An 8 MB font attached | 12.2 s, 7.8 MB | 0.45 s, 0.3 MB | 12.3 s, 7.9 MB | 0.48 s, 0.4 MB |
| 4 MB of tags | 6.3 s, 4.0 MB | 0.45 s, 0.3 MB | 6.8 s, 4.3 MB | 0.85 s, 0.6 MB |
| An 8 MB Void | 0.67 s, 0.4 MB | 0.46 s, 0.3 MB | 0.85 s, 0.6 MB | 0.86 s, 0.6 MB |
| The cue index, then an 8 MB Void | 0.67 s, 0.4 MB | 0.45 s, 0.3 MB | 0.85 s, 0.6 MB | 0.85 s, 0.6 MB |
| 1 MB of chapters (47,000) | 1.98 s, 1.3 MB | 1.91 s, 1.2 MB | 2.48 s, 1.5 MB | 2.48 s, 1.6 MB |
| The font after the clusters | 0.29 s, 0.3 MB | 0.29 s, 0.3 MB | 1.04 s, 0.6 MB | 0.95 s, 0.7 MB |

The software decoder (libmedia, for a picture the browser cannot decode: HEVC 10-bit on the owner's phone, which sat
60 s and 16 MB in "Reading the file…" for a 79 MB film) read the fonts through too, and waited for a whole MiB before
it had a byte (`software-loader.js`). The same two films with their picture as HEVC 10-bit (libx265, 1.3 Mbit/s; the
test browser has no HEVC decoder, so they go to libmedia), the same link, 3 runs: the first picture decoded, the MB by
then, and the time in "Reading the file…":

| HEVC 10-bit | Before | After |
|---|---|---|
| Without the font | 2.03 s, 1.3 MB, 1.58 s | 1.05 s, 0.6 MB, 0.60 s |
| With the 8 MB font | 13.96 s, 8.9 MB, 1.69 s (after 12 s in "Reading what is inside…") | 1.26 s, 0.8 MB, 0.83 s |

libmedia's own analysis was not what held it: its `maxProbeDuration` at 1 s instead of 3 changed nothing (1.58 and
1.59 s) and is not set. The sound is heard as before through libmedia's own audio graph (`heard.cjs`: 441 Hz at the same
level, before and after), and the AVI, 3GP and Windows Media films of `astra-formats-browser.test.mjs` still show a
moving picture at their pitches.

The 0.17 s left between a film with fonts and one without is the request past them (110 ms) and the link it shares
with the film's end. Chapters are still read whole before the plan (the chapter list is offered before playback);
a real film's are a few kB. With the styled track chosen from the start (the 8 MB font): first picture 12.2 s
before, 0.46 s after, no stall in the first 20 s; the font, read through the reader's downloads before, had begun
one that read on past it into the film playback was reading already (2 MB of the film twice).

### A description that runs long (measured 2026-11-18)

On the owner's phone one film (HEVC 10-bit, an AAC track whose name claims FLAC, 79 MB, 93 s) spent 91 s in "Reading
what is inside…" and read 21 MB before any plan. What a few codecs need to be described comes from their first packet
(DTS's codec string; the setup of VP9, of AV1 and of an H.264 or HEVC track whose header carries none), which Mediabunny
finds by reading clusters whole from the film's start until one holds a block of that track. A film made to show it:
two minutes of 640×360 H.264 at 3 Mbit/s with AAC and a DTS 5.1 track that begins a minute in, on a browser that says
it takes DTS as it is (Media Source told so), 5.4 Mbit/s and 110 ms a request, 3 runs:

| | "Reading what is inside…" | First picture | MB by then |
|---|---|---|---|
| Before | 35.7 s | 35.9 s | 23 |
| After (`probe-limit.js`) | 3.1 s | 3.3 s | 2.1 |
| The same film where the browser takes no DTS (nothing of DTS is read) | 0.13 s | 1.0 s | 0.6 |

The first cluster is read freely (a start from 0:00 reads it anyway, and nearly every first packet is in it). Past it,
all the tracks together get 3 s from the first read there and 2 MiB not already here: a few seconds and a couple of
MiB on a slow link, and on a fast one the bytes end it sooner. Mediabunny's reads serve every track looking at once, so
the limit is one for all; each track not described by then is left as an unread one (no codec string, no decoder
setup, `limited` in the report), the reads still waiting are let go and a download begun past the first cluster for
them alone stops. DTS so left is converted (as where the browser takes no DTS as it is), the converter given what
the track's header holds (Mediabunny would otherwise answer it with the refused read): the film then plays its DTS
track from 1:05, converted in the worker. A small film is no worse (the 2-minute film of Fonts attached, 5 runs: first
picture 282 and 284 ms, resumed at 1:00 773 and 770 ms).

### Memory while a film plays (measured 2026-11-19)

`scripts/astra/memory.mjs` plays a film through the engine in Chromium driven over the bare DevTools protocol and
breaks the renderer down with memory-infra dumps every 3 s. Playwright, which `real.mjs` uses, turns DevTools' Network
domain on, and the page then keeps a copy of every download: partition_alloc's buffer partition grew to 218 MB in 90 s
of the heavy film, 8 MB without Playwright. About 190 MB of the "near 500 MB" above was that copy.

**What holds it** (heavy film, fast link, before this change): the renderer 341 MB at its median, 386 at its peak, of
which Chrome's decoded frames 48 MB (on the phone the hardware decoder's, not the page's), the browser's media buffer
(the SourceBuffers: 14 s ahead, 7 behind) 66 MB, V8's heaps 25 to 32 MB, and the JS ArrayBuffers 108 MB at the median
and 153 at the peak: the reader's cache 49 MB, the converted sound's worker about 10 MB, clusters and queues about 13 MB,
the rest garbage. With a collection forced before each look they held 86 MB. The peak comes at the start and after a
seek, when the reading runs at the link's speed: Mediabunny's writer collected each fragment in an array doubling from
1 KiB (2.4 bytes of arrays for each byte of film), and V8 collects arrays only now and then (20 to 70 MB of them waited). The
lab page alone is 73 MB. "Astra's share" below is V8's heaps, the JS ArrayBuffers and the media buffer: what Astra decides.

**The budget** (`budget.js`, `hold.js`; How a file plays, How much is held). 250 MB of share on a 4 GB phone (the owner's,
the brief's aim), 180 on 2 GB, 140 on 1 GB; of that the film's own bytes (the media buffer ahead and behind and the
reader's cache) 112, 56 and 32 MiB, since the rest (the engine, the worker, the garbage) measured 90 to 150 MB on 25 to
60 Mbit/s films whatever was held. With the data saver three quarters of the film bytes. A 25 Mbit/s film keeps 8 s
ahead and 12 behind (the 10 s skip back is held) and the cache keeps what is ahead too: without that, a change of sound
track read the film again over the link (the first change to DTS on a 40 Mbit/s link heard 3.1 s after the tap after a
silence of 2.0 s, three runs; with it 2.3 s and 1.2 s, two runs, as before). A 60 Mbit/s film keeps 6 s on each side and the cache
only what reading needs. Picture and sound were never read more than 0.12 s apart (page six times slower too), so the
cache keeps 1 s behind the reading, not 4. On 2 GB a 25 Mbit/s film keeps 6 s ahead and 7 behind; a 60 Mbit/s one there
holds its floors (6 s ahead, 2 behind, 96 MiB), past the budget.

| Same sitting, one run each (two more of each after, earlier) | before | after |
|---|---|---|
| Heavy (27.8 Mbit/s), fast: share at its peak; median | 241; 196 MB | 197; 180 MB (208 to 238 in two earlier runs) |
| Heavy, fast: renderer at its peak; media buffer; ahead, behind | 382 MB; 66 MB; 14 s, 8 s | 371 MB; 59 MB; 7 s, 12 s |
| 60 Mbit/s 4K, fast: share at its peak; median | 311; 277 MB | 256; 201 MB (225 and 241 earlier) |
| 4K, fast: renderer at its peak (Chrome's 4K frames 180 MB of it) | 607 MB | 517 MB |
| Heavy, 5.4 Mbit/s and 110 ms (the owner's link): share peak; stalls in 60 s | 135 MB; 4 | 151 MB; 4 |
| Long (2 h, 0.56 Mbit/s) and the small 3 Mbit/s film, fast: share peak | 55, 91 MB | 68, 88 MB (held as before) |
| First picture: heavy, 4K, long, small (fast) | 719, 1749, 285, 285 ms | 701, 1717, 247, 225 ms |

Making each fragment's array at its size, read from the moof before it (`fragments.js`), took the arrays' peak on the
heavy film from 176 and 199 MB to 95 and 158 (two runs each) and the share's median from 185 to 175 MB; tried
2026-11-18 and dropped because the renderer's PSS did not move, which was Playwright's copy hiding it. The 4K film
stalls 14 to 16 times a minute here before and after alike: the test browser decodes 4K H.264 in software.

Not measured with the final code: the 2 GB, 1 GB and saver budgets (an earlier version of the same split held the heavy
film to 142 MB of share on 2 GB), a long sitting with many seeks and track changes, and the start, seek and resume times
by `real.mjs` (the first picture above is `memory.mjs`'s, one run). Not on a phone at all: Chrome on Android's own media
buffer limits, its garbage collector under memory pressure, and `navigator.deviceMemory` on the owner's phone.

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
  while repeating; dragging shows the chapter's name under the time, and,
  once the finger rests 120 ms, the picture at that place: the key frame
  nearest it, found from the index already in memory, fetched alone beside
  the film's own download (at most half a second of the film's own data,
  never under 1.5 MB nor over 4 MB: a 4K film's key frames run past a
  megabyte) and decoded by one WebCodecs decoder per film, in a worker of its
  own, so the page's thread only receives the small picture; 24 pictures
  are kept. One key frame is fetched at a time and a fetch under way is let
  finish: while the latest place waits behind it, its picture shows, dimmed.
  No previews with the data saver
  on, with no connection, for a film Astra does not unpack itself, or with
  "Seek previews" off in the Playback menu. A
  stream with no length (live) shows a full bar marked Live that cannot be
  dragged or swiped across.
- **Fine seeking** (`timeline.js`): on a film long enough that a pixel of the
  bar is more than 2 s (a two-hour film's bar on a phone is 20.6 s a pixel
  upright, 9 s across), the bubble says "Slide up for fine seeking" until it
  has been used three times. A finger slid 60 px up from the bar moves the
  drag an eighth as fast ("Fine seeking": 2.6 s a pixel there), 180 px up a
  sixty-fourth ("Finest seeking": 0.3 s), from where it is; the bubble rises
  above the finger and the buttons in the middle make way. Once slowed, the
  drag stays relative to the finger until it is released, so drifting back
  to the bar keeps the place found. Shorter films keep the bar as it was.
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
  track read so far (all of a file's; of a track inside the film, the lines
  of the parts downloaded so far, which the count says), case and accents
  ignored, and a tap goes to a second before it. The first 30 rows show at
  once and the rest of the 200 after that frame, so a 1,500-line track opens
  the search in half the time.
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
  film that comes with no container facts (HLS, DASH, or one the browser
  plays by itself) is asked from its own first frame whether it is PQ or
  HLG (`Picture.see`), so it is treated the same. A
  **Dolby Vision profile 5** film (IPT planes the browser shows purple and
  green; the record read from an MKV's or MP4's header) has its colours
  corrected before the tone-mapping (`dolby.js`), even with everything else
  off, under a "Correct Dolby Vision colours" switch; colours the browser
  clipped (saturated blues, the deepest greens) come out only nearly right. A
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
  waiting on (the owner's server or TorBox, a host that has not answered, or a slow one) and offers the other
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
  reachable again, where playback got to is saved, an address being asked for or a play
  still on its way is dropped, Skip intro's finder stops and keeps what it
  learned, and the engine lets go of the film and its connections.

**On real films** (2026-11-18, 390×844 with touch, the page's CPU slowed six
times, the link paced through Chrome; a two-hour 640×360 film with twelve
chapters and a 1,500-line SRT track, a three-minute 1080p film at 25 Mbit/s
with four audio tracks, a 4K film at 60 Mbit/s): resuming lands within
0.02 s of the place asked; a double tap moves 10 s and a swipe 0.31 s a
pixel; the twelve chapters show as eleven gaps and name themselves in the
bubble. A 1080p key frame is about 330 kB (the first, 1.4 MB), a 4K one
1.1 MB (the first, 3.6 MB, which the old 1.5 MB limit refused). Turning a
decoded frame into the bubble's picture held the page's thread 75 ms (1080p)
and 256 ms (4K) for each preview before it moved to the worker: a 10 s drag
on the 1080p film at 20 Mbit/s went from 6 and 11 long tasks to 1 and 1,
with 8 pictures instead of 7; at 8 Mbit/s, where a key frame takes longer
than a finger rests, it showed 7 pictures (dimmed: each for a place just
passed) instead of 0 and 1, for the same 2.5 MB. Each menu's own work is 12 to 34 ms there (Find a line on 1,500
lines: 39 ms, was 90); a tap that takes longer waits behind the film's own
unpacking on the page's thread.

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
  block as it arrives, so seeking works with or without a cue index, and
  nothing is downloaded for them: a text track's lines are those of the
  parts played or read ahead (on the two-hour film, 47 of its 1,500 lines
  after three far seeks), and a far seek's line shows 0.03 to 0.4 s after
  its first frame. Clusters are found from the cue index and each from the
  end of the one before; only a block no known cluster covers is searched
  byte by byte, which cut the scan's time on the page's thread from 330 to
  790 ms to 80 to 130 ms in 10 s of the 25 Mbit/s film (CPU slowed six
  times). The renderer finds the lines showing by a binary search: with
  1,500 lines it costs 0.4 ms a frame at most there.
- **Styled subtitles (ASS/SSA) are drawn by libass** (`subtitles/libass.js`:
  JASSUB, libass in WebAssembly, drawing on its own canvas from a worker),
  so signs, typesetting, karaoke and positioned lines look as authored. For
  a film's own track the fonts attached to the film are read
  (`engine/mkv-attachments.js`: fonts only, bounded in number and size,
  once the first picture is up, in requests of their own that end with the
  attachments, so cover pictures past a 1 MiB window and the film around
  them are not downloaded); Liberation Sans is the fallback, and the phone's own
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

## The playback lab

`/astra/lab/` is the engineering page: play a link or a stream from the
add-ons, see what the file holds and how it plays, this phone's decoders
(the device report), and copy a playback report (run through the scrubber
below before it reaches the clipboard). The add-ons are the ones Astra
keeps on this phone (`installedAddons` in `addons/client.js`: `astra.v2.addons`,
or classic Astra's list when that is all there is). Until 2026-11-18 the lab
read only classic Astra's list, so on a phone set up in Astra itself it
searched with Cinemeta alone: titles were found and no stream ever was.
Each playable stream in the list has "Analyse" and "TorBox", which puts its
address in the TorBox check's field as the owner's own pick.

**The TorBox check** (`src/lab/torbox-check.js`, `torbox-panel.js`). A
field for a stream's address (pasted, or handed over the way "Check
playback in the lab" hands one: in the fragment, which the lab takes out of
the address bar at once) and a "TorBox check" button. Any page can link to
the lab with an address in its fragment, and the check asks the Worker to
play it (which may add a cached item to the owner's TorBox), so for an
address that came that way, and was not typed or pasted, the first tap only
names its host ("It is on example.com. Check it?") and the button reads
"Check it"; the second runs it. It first ends the
lab's own playback, then runs, showing each step as it goes:

- (a) signed in on this phone, and (b) `GET /v1/astra/torbox`: whether the
  Worker holds the TorBox key, whether TorBox accepts it, and the plan;
- (c) `POST /v1/astra/play` with the link (mode `play`, as a tap; the
  hash too when the link's path shows one): how the Worker got the film's
  address (`via`), whether the last answer let a page read it, and each of
  its steps with its time;
- (d) from the phone, the first and the last 64 KiB of that address:
  status, whether the page could read it (and, when not, whether the server
  answers at all), the size, the time to the first byte, and the TorBox
  server group, the host's label before `tb-cdn` and nothing else of it;
- (e) a 2 MB read for a speed figure;
- (f) four requests at once, held, then a fifth beside them: the status of
  each, all five ended at once (what the server does at a link's limit);
- (g) the film's container and codecs by the engine's own probe, and the
  route the planner would take.

**Server speed** (`src/lab/server-speed.js`), under the check: a tap asks
the Worker for TorBox's speed-test files (`GET /v1/astra/torbox/servers`:
each server group's label, its region and a public test file; a page may
not read TorBox's list itself), then says what it will read: 1 MB from each
group, 20 groups (20 MB) at most, three at a time. A second tap ends the
lab's film and reads them; the table is fastest first: group, region,
Mbit/s, the first byte's time, and the group the last check's film came
from. **Copy report** carries the table, never an address. Choosing a
server is not offered: TorBox's only choice is the account-wide
`cdn_selection` setting, and requestdl takes nothing but `user_ip`.

The Worker is asked through the page's own helper, `src/addons/worker-api.js`
(`api(path, {method, body, signal})`, the owner's session, a top-level page
only; it throws "not signed in" without a session), loaded when the check
runs; without it the check stops at (a). **Copy report** copies plain text:
the steps' words, which never hold an address, a hash, a key or a file
name, run through `scrubSecrets` (`src/player/playback-report.js`, passed on by
`src/lab/scrub.js`, ASTRA.md §5.2 rule 3) with the link and the film's
address named as well, so it is safe to paste into a chat. The scrubber
turns every address into its host (or, for the reports, `[address]`),
also one escaped in JSON, percent-encoded or without its scheme; a magnet
into `[magnet]`; a key, token, password or magnet title named at any word
(`token=…`, `apikey: …`) and any run of 32 or more hex or base64url
characters, or 16 or more hex, into `***`; a video, subtitle or font file's
whole name, spaces and brackets and all (back to the line, a quote, `: `,
`; `, `, ` or the bracket around it), into `[file]`; and a dotted release
name into `[name]`. The lab's **Copy playback report** (after Analyse) is the
player's own report.

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
| `astra-renew.test.mjs` | The range reader within a TorBox link's limits: never more than three requests at once, playback first, side reads next, previews last and given up for playback, slots given back at the last byte; a dead link renewed once for every read waiting, a refused one when refused again, side reads too, once a minute; the old failures without `renew`, at the first open, or when renewing fails. |
| `astra-renew-browser.test.mjs` | On a 40-second VP9 film made with ffmpeg: never more than three requests open on the host over a start, a far seek, a preview drag and a network change; a film playing on through a dead link with `renew`, its position kept and no error; and the reader's error without it. |
| `astra-torbox-check.test.mjs`, `astra-torbox-check-browser.test.mjs` | The lab's TorBox check against a stubbed Worker helper and the test host: every step's line, a phone signed out, no key in the Worker, the Worker's own failure, a fifth connection refused at a host that allows four, an address the page may not read, one handed over in the fragment (run only once its host is confirmed), and a report with no address, hash, key or file name; the scrubber itself. |
| `astra-bytes.test.mjs` | The range reader: reads answered as their bytes arrive, downloads that stop where describing stopped asking, the reach and the cache by bitrate and the memory budget, bounded requests, side reads that leave playback alone, a network change, waiting for a download by time rather than bytes, and an index larger than the tail fetched once. |
| `astra-hold-browser.test.mjs` | A fast film held to the memory budget's bytes (`hold.js`): a few seconds read ahead of the playhead and kept behind it, where by time alone the whole small film stays; the log's `memory` entry at the first picture. |
| `astra-budget.test.mjs` | The memory budget by the phone's memory and the saver, how it is shared out at 4, 25, 60 and 100 Mbit/s (what reading needs, the floors, a skip back, the ahead kept twice), and the `memory` log entries: at the first picture, every 60 s of play, none while paused, numbers and fixed words only. |
| `astra-attachments.test.mjs` | A film with 8 MiB of fonts attached is described from its start, its end and its first cluster; the download at the start stops where the fonts begin, the one past them reads on; the fonts read later in requests that end with the element; a Void header the length of the element's own. |
| `astra-software-words-browser.test.mjs` | A film the software decoder cannot open (libmedia stood in for by one whose load fails as it did on a phone): one plain sentence on screen, libmedia's own words in the log. |
| `astra-probe-limit.test.mjs` | A DTS track none of whose blocks is near the start (dts.mkv renumbered) is left unread once describing reaches its limit, converted, and given its header's setup; the limit's reads, counted and refused. |
| `astra-probe-reads.test.mjs` | Describing a film with a DTS track the browser cannot take as it is asks nothing of that track's first frame, nor Mediabunny's MIME type. |
| `astra-film-memory.test.mjs` | A film remembered by its size and first 64 KiB, answered from memory the next time; a damaged entry, another film of the same size or failing storage changing nothing but the cost; a block a seek began inside made whole on the side. |
| `astra-mkv-packets.test.mjs` | Astra's own Matroska reader against Mediabunny's on every Matroska test film (the same packets, every byte), a cluster read as it arrives, hand-built files (lacing, block groups, header stripping, Void and CRC-32, negative times, a file cut short), stepping aside for what it will not guess at, blocks handed out as views rather than copies, and a cluster only a dropped pipeline held not read again after a jump. |
| `astra-early.test.mjs` | Half-second fragments of picture, and quarter-second ones of sound passed through; each fragment of picture written into one array at its size, byte for byte as Mediabunny writes it. |
| `astra-rebuffer.test.mjs` | A link slower than the film: how many seconds are made ready after a stall, the link's speed counted only while a download runs, and a session's stall held and let go with a stand-in buffer (all that was held appended, a seek letting go at once, a fast link never held). |
| `astra-switch-browser.test.mjs` | Changing sound track without stopping the picture (no seek in place, the new pitch heard); the converter refused, met with another track that needs none and a notice, or with silence until it can be downloaded and the sound coming in then. |
| `astra-downmix.test.mjs` | Converted sound mixed to stereo a sample at a time. |
| `astra-sound-stream.test.mjs`, `astra-sound-stream-browser.test.mjs` | Converted sound from Astra's own Matroska reader: the same samples as Mediabunny's sink (Dolby Digital, TrueHD, DTS), heard after seeks and track changes, picture and sound after well under one cluster on a slow host; surround kept whole (FLAC) with Headphone surround on; TrueHD converted in the sound worker with no encoder made and no decoder loaded on the page and its first fragment a quarter second, and the page taking the sound over when the worker fails mid-film. |
| `astra-chapters.test.mjs` | Chapters from Matroska and MP4, in order and bounded. |
| `astra-datasaver.test.mjs` | When the data saver is on and what it changes, on a download already running, and the player handing the film's length to the reader. |
| `astra-feed.test.mjs` | A film's attached fonts (bounded), which files libass can draw, the second track moved to the top, the sound tap's bookkeeping. |
| `astra-sound-tap.test.mjs` | Skip intro's tap on sound passed through: WebCodecs asked first, one plain line and no error where it cannot decode it. |
| `astra-subtitles.test.mjs` | The parsers on files as people find them, and picture subtitles with impossible sizes or out of order. |
| `astra-subtitles-files.test.mjs` | Code pages from a language hint checked against the bytes, and what a subtitle add-on may send. |
| `astra-subtitles-scan.test.mjs` | A film's own text lines gathered as its blocks land, in order and after a jump, searching byte by byte only the blocks no known cluster covers. |
| `astra-streams.test.mjs` | What a stream's words say (size, picture size, codec), the filter chips, what an hour costs, and the card's sound note against what this phone plays and what failed here. |
| `astra-streams-text.test.mjs` | The torrent's hash taken out of what a card shows (a line that only gives it, one inside a longer line, upper case, "btih:", hex that is not a hash), still read from the stream, and never read as a word. |
| `astra-streams-note.test.mjs` | The card's one note for each kind of stream with three device reports (the owner's phone, a browser that decodes everything, an older phone), the hashless note's conditions, and the wait for its facts. |
| `astra-streams-browser.test.mjs` | Streams at 390×844, signed in: no hash on a card while a press still sends it, the notes on the owner's phone and on a browser that decodes everything, the add-on's order kept, and 300 streams drawn ten at once then eight a frame, each answering a press. |
| `astra-logo-browser.test.mjs` | Logos measured from their pixels, and on Home's hero and the Streams header: a black and a grey wordmark lifted, a deep red one as text, white and red ones as they are, one whose host refuses CORS shown with a rim after one plain retry. |
| `astra-link-facts.test.mjs` | What a link says of its file (hash, index, name, size) in every add-on shape Astra knows and the general case; two hashes; damaged input never throwing. |
| `astra-debrid.test.mjs` | The address asked of a stand-in for the owner's server: its answers, an answer without an address, its error envelope, the 30 s and 6 s waits, signed out, answers kept 45 minutes and shared while under way, a press's address taken by the tap, renew and forgetting. |
| `astra-tap.test.mjs` | What is done ahead for a list and a saver state (one connection to the server), a press that asks ahead and the tap that takes it, the next episode made ready only for the same release group and a direct address, and a film's tail asked for beside its start. |
| `astra-addon-json.test.mjs` | Add-on answers over 5 MB refused, and one that never ends cut. |
| `astra-skip.test.mjs` | The sound fingerprint and its matching, what the intro store keeps, and the skip-times lookup against invented answers. |
| `astra-player.test.mjs` | The gesture rules, when progress may overwrite the saved place, the next episode's sources through the filters, and `player/rules.js`. |
| `astra-enhance.test.mjs` | The sound chain's stereo mix against the engine's, dialogue steps, the picture's sizes, the BT.2390 curve, and whole surround written 12 ms ahead of the chain's own delay. |
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
| `astra-features-browser.test.mjs` | The Playback menu, remembered volume, Start over, seek-bar marks, fine seeking, subtitle delay, Find a line, the second subtitle, frames and stills, pinch to zoom, data used, the source line, the lab's address. |
| `astra-feed-browser.test.mjs` | On the real page and CSP: libass with the film's font, the second subtitle's layer, the sound tap, dialogue lift and earlier sound in the engine. |
| `astra-libass-browser.test.mjs` | The libass layer: placement, drawing only while a line shows, the film's font, delay, destroy, and a start that fails falling back. |
| `astra-enhance-browser.test.mjs` | Sound measured after the chain and the picture read back from the canvas, on real films. |
| `astra-sound-browser.test.mjs` | Even loudness bringing two films 12 dB apart together while the volume stays the owner's, headphone surround placing the left surround, and the Sound tab's two switches. |
| `astra-preview.test.mjs`, `astra-preview-browser.test.mjs` | Seek previews: the key frame chosen from a Matroska and an MP4 index, one frame's bytes fetched within a cap that follows the bitrate, one fetch at a time let finish and shown early, the decoder's worker, the pictures kept and let go, the bubble on a drag, and none with the data saver or the switch off. |
| `astra-dolby.test.mjs`, `astra-dolby-browser.test.mjs` | Dolby Vision profile 5: the record read from an MKV and an MP4, the colour matrices against their sources, and IPT patches drawn through the filter coming out as the colours they stand for (and wrong with the switch off). |
| `astra-picture-browser.test.mjs` | Animation (Anime4K) drawn over a playing film, and an HDR film tone-mapped along the BT.2390 curve, read back from the canvas. |
| `astra-wiring-browser.test.mjs` | The Sound tab, the Picture section, skip times reaching the Skip button, and the Settings › Playback rows, with the real engine. |
| `astra-app-play-browser.test.mjs` | The app end to end: an invented add-on, a tap on a stream, chapters, the sound tap fed, data used, the Sound tab, Find a line, another source drawn by libass, no page error. |
| `astra-tap-browser.test.mjs` | From a tap to the first picture in the real app, signed in against a stand-in for the owner's server, with Get ready ahead on, off and under the saver: one connection and no question when listed, the press's ahead answer taken by the tap, the next episode made ready so Next asks nothing, nothing before a tap when off, nothing ever playing without one. |
| `astra-resolve-browser.test.mjs` | The address path in the real app: the server's address played in Astra's own mode with Stream info saying "From TorBox directly"; its error met by the add-on's link in Chrome's player with the server's reason as the notice and Stream info's line; signed out, nothing asked and the add-on's link played as before. |
| `astra-open-browser.test.mjs` | The Thunderhead's link (`?find=…&max_mb=…`) opens Details, the size chip, nothing plays by itself. |

- **Films**: `tests/fixtures/astra/` (about 4.2 MB, committed). Most are
  made by `bash scripts/astra/fixtures.sh [film…]` (needs ffmpeg; name
  films to remake only those, since x264 builds differ). Each is a moving
  test picture with a clock and a sine tone per sound track at its own
  pitch, so a check can tell by ear which track plays: `multi.mkv` (two AAC
  tracks, SRT, chapters), `surround.mkv` (Dolby Digital 5.1), `plain.mp4`
  (a plain MP4, unpacked by Astra like any other film), `open.webm` (VP9,
  Opus), `anime.mkv` (the hand-written, invented `signs.ass` with Inter Bold
  attached), `centre.mkv` (a tone in the centre channel only), `truehd.mkv`, `dts.mkv` (DTS 5.1, 3 s),
  `mixed.mkv` (Dolby Digital 5.1, converted, and AAC stereo, passed through),
  `hevc.mkv` (software decoder in the test browser), `clusters.mkv` (a
  cluster every 5 s and a key frame every 10 s, so half the clusters begin
  between key frames: Astra's Matroska reader), `frontcues.mkv` (its cue
  index before the clusters), `hls/` and `dash/`; `beside.srt` loads beside
  a film. `dolby-patches.webm` and `dolby-untagged.webm` (grey and colour
  patches carried as Dolby Vision profile 5 carries them, in VP9 so the
  test browsers decode them) are made by `node scripts/astra/dolby-patches.mjs`.
  Three are made by the command in their test's header:
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
  `?nocors` on one film's address does it for that film alone), `limit`
  (a request beyond that many open at once answers 429, as a link's
  connection limit might). `link(name, label)` is a second address for the
  same film (`/via/<label>/<name>`, a renewed link) and `kill(url, status)`
  makes one address answer 403 or 410 and cuts what it is sending: a link
  that died. `stats.open` counts the requests being answered, from their
  arrival to their end, and `stats.peak` the most at once; an answer ends
  with its last byte, as a real server's does.
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
- the preconnect to the owner's server and to a film's host on Android, and
  what Get ready ahead saves before the first picture there;
- the address path against the real Worker, TorBox and AIOStreams (the
  tests use a stand-in server and invented links);
- a film remembered (`astra-films`) on a real connection: how much sooner
  it opens the second time;
- headphone surround's cost on the phone's processor;
- converted sound (Dolby Digital Plus, TrueHD, DTS) on the phone: the sound
  worker's and decoder's time on its cores, which DevTools could not slow;
- a real network change (Wi-Fi to mobile data) while a film plays;
- TorBox itself: what its file servers do with a fifth connection to a
  link, whether a renewed link plays on after a real link's three hours,
  and the TorBox check against the owner's real Worker (only a stub of its
  helper has answered it so far).
