# Astra

> **Owner ruling 2026-10-28:** this app is first ported over **as it is**, with no changes. This spec describes where it goes *after* that port; nothing here is built until the owner agrees to it.

Astra is the owner's film and series app: it browses catalogs from the owner's own add-ons, finds
streams for a title, and plays them with a capable in-browser player. It comes over from the old repo
**as it is** (owner ruling 2026-10-28), because it is recent, tested and good. This doc says what it
does today, the few adjustments the port strictly needs, what may change later (only if the owner
agrees), and the rules around streams and secrets.
Ring colour `#8b5cf6`, icon Phosphor `monitor-play`, its own page at `/astra/`, phase **P8**.

## Rules at a glance

1. **Port as it is.** Astra moves as its own document at `/astra/` (decisions: "Astra stays its own
   page at first"). Its logic, engine, player, look, fonts, service worker and tests come over
   unchanged; only the adjustments in §2 marked **Port** are made. A restyle and the other §2 rows are
   later steps, only if the owner agrees.
2. **The mind may pick a title and open it; the owner picks the stream** (owner ruling 2026-10-27).
   Above all, it never auto-picks a stream from a torrent or debrid source. Astra itself ranks nothing
   and plays nothing without a tap.
   **Owner ruling 2026-11-15:** three earlier limits are relaxed so films start sooner. Before a tap,
   Astra may read the owner's own TorBox list when streams are listed and resolve the stream under a
   finger as the press begins; every film the page can read is unpacked by Astra (a plain MP4/WebM
   too); and the next episode of the same release may be prepared (its stream resolved and its file
   described) before Next. All of the before-a-tap work is behind Settings › Playback › "Get ready
   ahead" (on by default) and is off with the data saver. Still in force: nothing plays without a tap;
   Astra never ranks, picks or pre-selects a stream on the list; secrets never leave the phone or
   reach storage (§5).
3. **Add-on URLs, stream URLs and the debrid token are secrets.** On the server they are stored only
   Worker-encrypted; they never appear in logs, senses, surfaces, errors, the mind's context or the repo.
   **Owner ruling 2026-11-18:** stream addresses may pass through the owner's Worker in transit, for the
   owner's signed-in device only, never stored, never logged; the TorBox API key lives in the Worker as
   the secret `TORBOX_KEY`. TorBox's own file links may carry the account's token: such a link is passed
   only to the owner's signed-in device, in the answer body, never logged or stored, exactly as every
   add-on already hands it to the phone when it plays. The key as a bare secret (the Worker secret,
   the `Authorization` header, a TorBox API address such as a requestdl permanent link) never leaves.
4. **libmedia stays** (owner ruling 2026-10-28: the owner has permission, and it is Astra's software decoder for HEVC/AV1/VP9 without hardware support, 10-bit H.264 and AVI/FLV/MPEG-PS). mediabunny (MPL-2.0) stays too. libmedia is a named exception to the no-GPL rule; keep its licence files beside it.
5. **No third-party script origins** (later step, §2 #7). The as-is port keeps loading hls.js and
   dash.js as today; vendoring them waits for the owner's yes.
   **As built (2026-11-15):** done. hls.js and dash.js are vendored in `frontend/astra/vendor/` and
   loaded with their pinned integrity hashes; no Astra page names a script origin other than its own.
6. **The old backup format (`backup/1`) is the migration format.** The owner's Astra data arrives on
   the new site through it, checked and all-or-nothing, as Astra's own restore already does.
7. **Nothing plays without a tap**, including anything the mind arranged.
8. **Owner rulings 2026-11-18 (the relay, §4.4):** on the owner's tap, Astra (through the Worker) may
   add an item TorBox already has cached to the owner's TorBox account (`add_only_if_cached`); nothing
   is added before a tap, and nothing uncached is ever added by Astra. Astra's page moves onto the
   site's sign-in the way Guitar did (SECURITY.md §4.4 rule 4). Rule 3's ruling of the same day lets
   addresses through the Worker. Still in force: nothing plays without a tap; Astra never ranks, picks
   or pre-selects a stream.

---

## 1. What Astra does today (old repo, `frontend/astra/`, ~7.9k lines)

Measured from the old code and its README; this is the behavior to keep.

| Area | Today |
|---|---|
| Tabs | Home, Search, Library, Settings. All four stay alive (scroll kept); the floating nav shrinks to icons when a page scrolls. Back from another tab → Home; back on Home leaves. |
| Back stack | Every screen, sheet and menu is one history entry (`back-stack.js`). |
| Home | Hero of up to 8 titles turning every 8 s; Continue Watching; one row per add-on catalog that needs no search text. Long-press a poster: save / mark watched. |
| Details | Play says what it will do (Play, Resume, Play S1 E2, Upcoming). Series open on the season of the next unwatched episode. Draws at once from the tapped card. |
| Streams | Every enabled add-on is asked at once; sections fill in the add-ons' own order with placeholder cards; **nothing is ranked or picked**. Long-press a stream: copy, open in VLC, check in the lab. Debrid links (`src/addons/debrid.js`) are resolved to the file just before play. |
| Playback engine | Probe (one open-ended range read, 1 MiB block cache) → plan once (`native`, `remux`, `software`, `hls`/`dash`, `unsupported`) → play via MSE with untouched video packets; AC-3/E-AC-3/DTS/etc. audio rebuilt to Opus on the device; offer "another app" (Android intent) when nothing in the browser can play it. |
| Player | Nuvio-style gestures: tap toggles controls (hide after 3.5 s), double-tap ±10 s, horizontal seek, brightness/volume swipes, hold for 2×, lock, PiP, skip intro/outro, next-episode card at 99% (tap only), "Reconnecting…" for up to 60 s. |
| Subtitles | Add-ons + OpenSubtitles v3 (hash match marked "Exact match"), embedded SRT/ASS/WebVTT/PGS/VobSub, HLS/DASH tracks, files from the phone, old code pages. |
| Progress | Saved every 10 s, on pause, close and leaving. Streams under 121 s are not tracked. 90% = watched. Max 300 progress entries. |
| Saved data | `localStorage` keys `astra.v2.*`; each value sanitised when read; a recovery card offers **Export raw data** and **Reset Astra data**; two windows merge safely. |
| Backup | Settings → Your data → **Export a backup** writes `astra-backup-YYYY-MM-DD.json`; **Restore** checks the whole file, then replaces all or nothing. |
| Fast start | Own service worker with a per-release saved copy; add-on answers cached in Cache Storage `astra-data-v1` (manifests 6 h, Home catalogs 30 min, title pages 12 h, unused entries dropped after 7 days). |
| Tests | `tests/astra-*.test.mjs` (planner, subtitles, MKV/MP4 readers, range reader, add-on client and data, store, rows, Play button) and browser suites for playback, player, shell and app against a fixture add-on server. |

### 1.1 The backup format (`backup/1`) — kept exactly

```json
{
  "astra": "backup/1",
  "at": "2026-11-20T18:04:11.000Z",
  "data": {
    "addons":         [{"url": "https://addon.example/manifest.json", "enabled": true, "name": "Example"}],
    "library":        {"movie:tt0000001": {"id": "tt0000001", "type": "movie", "name": "Example Film", "poster": "https://…", "added": 1763600000000}},
    "progress":       {"series:tt0000002|tt0000002:1:3": {"type": "series", "id": "tt0000002", "videoId": "tt0000002:1:3", "season": 1, "episode": 3, "time": 812, "duration": 2640, "updated": 1763600000000, "completed": false, "meta": {"id": "tt0000002", "type": "series", "name": "Example Series"}}},
    "watched":        {"movie:tt0000003": 1763500000000},
    "settings":       {"posterWidth": 120, "hero": true, "openSubtitles": true, "hiddenRows": []},
    "recentSearches": ["example"]
  }
}
```

- `BACKUP_KEYS` = `addons, library, progress, watched, settings, recentSearches`.
- `DEVICE_KEYS` (kept by a restore, never in a backup) = `player, libraryLayout, librarySort, lastAddon`.
- A file whose `astra` isn't `backup/<n>` is refused ("That file isn't an Astra backup."); `backup/2+`
  is refused with "That backup is from a newer Astra. Update Astra, then restore it."; a key of the wrong
  shape refuses the whole file; damaged entries inside a good key are skipped and counted.

Check: the existing `astra-store.test.mjs` cases move over unchanged and pass.

---

## 2. What changes

**Port** (the first move: strictly needed to run on the new site): rows 1, 2 (plain navigation; the
view transition is later), 8 (the old CSP kept), 15 and 16, plus root-absolute asset paths (the host
serves `/astra` without a redirect). Row 9 is a later step: at the port Astra keeps
`/assets/error-report.js`, which reports to the old Worker. **Every other row is a later step**, proposed after the port and built only if
the owner agrees.

| # | Change | Exact rule | Check |
|---|---|---|---|
| 1 | **Location** | Source moves to `frontend/astra/` (ported folders sit at the top of `frontend/`, [ARCHITECTURE](../../engineering/ARCHITECTURE.md) §3) and is staged to `/astra/` as its own document. `scripts/stage.mjs` must **not** write a shell stub at `astra/index.html`: remove `astra` from `APP_ROUTES` when Astra lands (today's list includes it, which would overwrite Astra's page). | Stage test: `/astra/index.html` is Astra's, not the shell. |
| 2 | **Opening from the ring** | The ring's Astra bubble navigates to `/astra/` with a cross-document view transition (`@view-transition { navigation: auto }` on both documents). Back on Astra's Home returns to `/`. Video stopping on leave is correct. | Playwright: ring → Astra → back lands on Home. |
| 3 | **Tokens** | `src/styles/tokens.css` maps onto the Thunderhead tokens ([DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md)). Night: pure black `#000` background, surfaces from the night tokens. Day: the day tokens for browse screens. Accent: `#8b5cf6` for fills (selected tab, primary button, progress); text accent per the design system. **The player screen stays black in both themes.** | Visual snapshot in day and night at 390×844. |
| 4 | **Fonts** | Remove Astra's six static Inter files (`fonts/inter-400…900.woff2`). Use the shared self-hosted `/ui/fonts/Inter.woff2` (variable). Fraunces is not used in Astra (it is only the Thunderhead's voice). | Static test: no `woff2` under `apps/astra/`; total font bytes unchanged site-wide. |
| 5 | **Icons** | Astra's drawn icons are replaced by the shared Phosphor sprite where an equivalent exists; player glyphs that have no Phosphor match stay as Astra's own SVG. | Static test: no inline icon map duplicates a sprite symbol. |
| 6 | **Service worker** | Delete Astra's `sw.js` and its release logic. The root service worker (scope `/`) precaches Astra's files with the rest of the release. The root worker's activate step deletes only `th-<older>` caches, so Astra's `astra-data-v1` cache survives updates. The "Astra has been updated · Reload" toast is replaced by the shell's update rule (apply only when nothing is playing). **As built (2026-11-15):** Astra keeps its own worker (`frontend/astra/sw.js`). A release is named by `components.astra.tree` in `/release.json`, a hash of every file under `frontend/astra` as staged (a commit elsewhere is not a release), and listed with a hash of each file in `/astra/files.json` (`scripts/astra/files.mjs`, written by `scripts/stage.mjs`). A new release is saved whole, unchanged files copied and the rest checked against their hash, before pages are told; a page keeps its release until it closes; `vendor/` is saved when a film first needs it; the Reload offer stays until Reload or Later. Nothing reloads by itself, so never mid-play. | Browser test: offline start of `/astra/`; an update never reloads mid-play. As built: `tests/astra-sw.test.mjs`, `tests/astra-sw-browser.test.mjs`. |
| 7 | **Third-party scripts** | hls.js 1.6.13 (Apache-2.0) and dash.js 5.2.0 (BSD-3-Clause) are vendored at `/vendor/hls.js-1.6.13/` and `/vendor/dashjs-5.2.0/` with licences and sha256, loaded on demand as today. `cdn.jsdelivr.net` is removed from the CSP. **As built (2026-11-15):** vendored at `frontend/astra/vendor/hls/` and `vendor/dash/` (served under `/astra/vendor/`) with their licences, pinned in `vendor/vendor.json` with a sha256 of every file and the integrity hash `engine/adaptive.js` gives the browser; loaded only when an HLS or DASH stream plays. `cdn.jsdelivr.net` is gone from both Astra pages' CSP. | Static test: no `https://cdn.` in `apps/astra/`. As built: `frontend/ported.json` records the CSP without it, and `node scripts/astra/vendor.mjs --check` checks the files. |
| 8 | **CSP** | Astra keeps its own `<meta>` CSP (it is a separate document), **unchanged** at the port: today's sources, including `https://cdn.jsdelivr.net` for hls.js and dash.js (rule 5), `'wasm-unsafe-eval'` and `blob:` for libmedia, `https:` for add-ons and streams, and the `http://localhost:*` / `http://127.0.0.1:*` entries. Trimming any of them is a later step the owner agrees to. **As built (2026-11-15):** `script-src 'self' 'wasm-unsafe-eval' blob:` (no CDN; `'wasm-unsafe-eval'` and `blob:` now also serve libass's WebAssembly and the Sound tab's small worklet, made from a `blob:`); the rest unchanged: `https:` and the two local entries for images, media and connections, `worker-src 'self' blob:`, `default-src 'none'`. | Static test: the CSP equals the one recorded for `/astra/` in `ported.json` ([SECURITY](../../engineering/SECURITY.md) §4.4). |
| 9 | **Error reports** | `/assets/error-report.js` is replaced by the shell's error reporter (`POST /v1/ops/errors`), with the secret scrubber of §5. | Unit test of the scrubber. |
| 10 | **`th` bridge** | Astra imports `/th/th.js` for `sense()`, verbs and sign-in state (same origin, same IndexedDB token). No other shell code. | Static test: Astra imports only `/th/th.js` from outside its folder. |
| 11 | **Senses** | `astra.watch` and friends (§3). | Sense schema tests. |
| 12 | **Verb** | `astra.open` (§4). | Verb tests. |
| 13 | **Deep link** | New route parameter: `/astra/?open=<type>:<id>[&s=<season>&e=<episode>]`, read once on start, then removed with `history.replaceState`. Opens **Details**, never Streams, never the player. | Browser test. |
| 14 | **Classic import** | The one-time copy from `astra.v1.*` is removed (the new origin has no classic data). Replaced by the migration import (§7). | Static test: no `astra.v1.` string. |
| 15 | **Software decoding** | Unchanged: libmedia comes over with Astra (owner ruling 2026-10-28). | Existing planner tests pass. |
| 16 | **Lab** | `/astra/lab/` stays as a developer page, not linked from the UI; its "copy a report" output passes through the scrubber (§5). | Unit test: the report contains no add-on path or token. |
| 17 | **Server backup** | Astra's `backup/1` is also kept, Worker-encrypted, on the server (§5.3), so a new device restores it after sign-in. **As built (2026-11-19):** a `sync/1` copy that every signed-in phone merges with, not restores (§5.3). | API test. |

Expected size: the port is a handful of lines; the later rows together are about 300–600 lines
changed plus deletions (fonts, SW, classic import).

---

## 3. Senses

**Built (B1, 2026-11-02), shared with My Media:** `astra.open` (the page), `media.watch` (`{ms}` watched since the last report), `media.finish` and `media.drop` (an unfinished title taken off Continue Watching), by `astra:<type>:<id>[:<season>:<episode>]`, read from Astra's own progress (`astra.v2.progress`) by `th/senses/watch.js`, so Astra is unchanged. One switch, Settings › Privacy › Astra and My Media. The list and its fields are `SENSE_TYPES` (CONTRACT.md "Senses"); the table below is the fuller plan.

Shape per [decisions](../../process/decisions.md): `{id, at, type, ref, data, sensitivity}`.
Refs: `astra:<type>:<id>` for a title (`astra:movie:tt0000001`), `astra:<type>:<id>:<season>:<episode>`
for an episode. **No sense ever carries a stream URL, an add-on URL or name, an info hash, a file name or a
debrid identifier.**

| Type | When | `data` | Sensitivity |
|---|---|---|---|
| `astra.watch` | On pause, close, leaving, every 5 min while playing, and at completion; only for streams ≥ 121 s | `{pos_s, dur_s, delta_s, completed}` (`delta_s` = seconds watched since the last `astra.watch` for this ref) | 0 |
| `astra.open` | Details opened | `{from: "home"\|"search"\|"library"\|"continue"\|"verb"\|"link"}` | 0 |
| `astra.save` / `astra.unsave` | Library toggled | `{}` | 0 |
| `astra.search` | Search submitted | `{q_len, results}` | 0 |
| `astra.play_fail` | Playback gave up | `{plan: "native"\|"remux"\|"hls"\|"dash"\|"unsupported", reason_code}` | 0 |

`astra.watch` replaces nothing in Astra's own progress store; it is a copy for the mind. Check: a
Playwright run plays a 3-minute fixture to the end and the outbox holds exactly one `completed: true`
event and no string containing `http`.

---

## 4. Verbs and surfaces

### 4.1 `astra.open`

**Built as a link (2026-10-30, the owner's day-1 request):** the mind's reply carries a chip to
`/astra/?find=<title>[&type=series|movie][&max_mb=<n>]` (or `?open=<type>:<id>`). Astra reads it
once (`frontend/th/astra/open.js`, loaded only for such a link), searches the owner's own add-ons on
the phone (no add-on address leaves it), opens the best match's Details (the same name, else one that
starts so, else the first), and sets a removable "Under N MB" chip on Streams that hides results of a
known larger size (in `streams.js` itself, so Astra still starts offline). Never Streams, never the
player; the owner picks the stream. Recorded `improvement` edits to `src/main.js` and
`src/screens/streams.js`. The verb below, the senses (§3) and "For you" (§4.3) come with Astra's data
move.

| Field | Rule |
|---|---|
| Args | `{ref: "astra:<type>:<id>", season?: int, episode?: int, max_mb?: int}` (`max_mb` only pre-sets the Streams size filter, F48) — validated with a strict schema (unknown keys rejected by the Worker *and* by `verbs.js`). There is no argument for a stream, URL, add-on or quality, so a stream cannot be named. |
| Effect | If the shell is visible and the owner asked for something to watch in the last 10 minutes, navigate to `/astra/?open=…` (Details). Otherwise create the surface card "Ready in Astra: <title>" on Home's conversation with **Open**. |
| Example (owner ruling 2026-10-27) | "An anime I'd like, 20 min, under 200 MB": the mind uses the owner's past favourites to pick a fitting title from the add-ons' catalogs and opens it in Astra; the owner picks the stream. The size limit travels as a hint: `/astra/?open=…&max_mb=200` turns on a removable "Under 200 MB" filter on Streams that hides results whose known size is larger; it never ranks, picks or plays **[proposal]**. Needs §2 rows 12–13, so it arrives after the port, once the owner agrees. |
| Never | Opens Streams, starts the player, or resolves a debrid link. |
| Undo | `{verb: "astra.close"}` (returns to the previous screen). |
| Ledger | "Opened <title> in Astra — you asked for something under 25 minutes." (Law 3: the why). |

### 4.3 Surfaces

| Slot | Kind | Where |
|---|---|---|
| `astra.home` | Arranged list of up to 10 titles, each with a one-line why | A row titled "For you" at the top of Astra's Home **[proposal]**. Tapping a title opens Details. |
| `briefing.media` | Count of new episodes of saved series | Briefing "new media" ([BRIEFING](../BRIEFING.md)) |

### 4.4 The stream rule (owner rule)

> The mind may suggest titles but never auto-picks streams from torrent or debrid sources.

How it is enforced:
1. **No interface exists** for the mind to name a stream: verbs take only a title ref (§4.1).
2. **Astra never picks**: Streams lists every add-on's results in the add-ons' order; there is no
   "best stream", no auto-play of the first result, no auto-resolve before a tap. The existing behavior
   stays and gains a test: `StreamsScreen` renders, waits 10 s, and asserts no player was created and no
   debrid request was made.
   **Owner ruling 2026-11-15 ("Get ready ahead"):** with Settings › Playback › "Get ready ahead" on (the
   default) and the data saver off, Streams opens a connection to the Worker when streams are listed,
   and a finger coming down on a stream starts resolving it through the Worker in mode "ahead" (below),
   whose answer the tap then takes (`app/ready.js`); a sound converter a
   listed label needs may be fetched ahead on an unmetered connection; and while an episode plays, the
   next episode's streams are collected and, only for a stream of the release group playing now (the
   rule Next already follows), resolved and described, never played (`app/next-ready.js`). With the
   switch off or the saver on, no relay, add-on or film-host request is made before a tap
   (`tests/astra-tap-browser.test.mjs`). Unchanged: nothing plays without a tap, and no stream is
   ranked, picked or pre-selected on the list.
   **Owner rulings 2026-11-18 (the relay; they replace the page's own TorBox reads of 2026-11-15):** a
   page cannot read TorBox's API (CORS), so Astra asks the owner's Worker for the film's address
   (`POST /v1/astra/play`, [SECURITY.md §8.2](../../engineering/SECURITY.md)), which asks TorBox with
   the key it holds. Mode "ahead" (before a tap) may read the owner's TorBox account but never adds
   anything; mode "play" (the tap) may add an item TorBox already has cached (`add_only_if_cached`,
   seeding off), never an uncached one. When TorBox says for certain the film is not cached, the tap
   is answered so ("This film is not on TorBox yet, so Astra did not start it."). The Worker resolves
   only the stream the page names: a file it cannot tell apart from the others in a torrent is
   refused, never guessed; the cached item a tap added for it stays in the account, which is harmless
   and uses no slot. Without a TorBox address the Worker answers none and the page plays the add-on's
   own link itself, as before the relay: the Worker does not open add-on links, since an add-on may tie
   a link to the connection that asked for the stream list (the owner's phone got an add-on's error
   clip when the Worker opened one, 2026-11-18).
   **The owner's filter chips (2026-11-11, `addons/stream-facts.js`):** a second row under the add-ons,
   for the owner who wants small files to save data: Smallest first; one size limit (under 700 MB,
   1.5 GB or 3 GB); any of the picture sizes (720p, 1080p, 4K, SD) and codecs (HEVC, AV1); Clear. They
   are read from each stream's own words and `behaviorHints.videoSize`, kept between titles
   (`streamFilters` in Astra's store), and say how many they hide. With a size limit on, a stream of
   unknown size is hidden: it may be any size. A stream whose size and the title's runtime are known
   shows what an hour of it costs ("710 MB an hour"). This orders and hides at the owner's word only;
   Astra still never picks or plays a stream.
   **As built (2026-11-15), the next episode (`app/playing.js`):** Next, or an episode picked in the
   player, stops what plays and collects that episode's streams. Only when the stream playing names a
   release group (`bingeGroup`) and the new episode has a stream of the same group does that one play
   on (the group the owner already picked, as Stremio does); otherwise the player opens the episode's
   sources, through the owner's filters (those hidden are counted and can be shown), and loads nothing
   until a tap. The earlier fallback that played the first source when no group matched is gone.
   **"Plays on this phone" (2026-11-15, `addons/device-facts.js`):** each playable stream card says, on
   one quiet line, "Plays directly" or "Needs the software decoder (uses more battery)", from its
   label and the browser's own answer (`navigator.mediaCapabilities.decodingInfo`: smooth and
   power-efficient), and "Sound converted on the phone" for Dolby Digital or DTS. It informs only:
   nothing is hidden, ranked or picked by it.
3. **Playback needs a user gesture**: `PlayerScreen.open()` returns without playing unless
   `navigator.userActivation.isActive`. Check: calling it from a timer does nothing.
4. **The mind never sees streams**: the Worker stores no stream data (since 2026-11-18 addresses pass
   through `/v1/astra/*` in transit and a torrent's id and file list stay half an hour in its memory,
   for the owner's device only; agent keys get 403); senses carry none (§3).

Recorded in [decisions.md](../../process/decisions.md) as an owner ruling (2026-10-27).

---

## 5. Secrets

### 5.1 What counts as a secret

| Item | Why |
|---|---|
| Every add-on URL | Configured add-ons carry their settings in the URL path, including debrid API keys inside resolve paths. Treat the whole URL as secret. |
| Stream URLs | Direct links often embed tokens (`…/requestdl?token=…`). |
| Debrid token | Account access. Since 2026-11-18 the TorBox key is the Worker secret `TORBOX_KEY`; the phone gets only TorBox's own file links, which may carry the account's token (rule 3). |
| OpenSubtitles hash/size | Not a secret, but not sent anywhere except the subtitle add-on. |

### 5.2 Rules

1. On the phone, add-ons stay in `localStorage` `astra.v2.addons` as today (Astra needs them in clear to
   call add-ons).
2. **Never** in: senses, surfaces, verbs, the Ledger, `POST /v1/ops/errors` payloads, Worker logs,
   GitHub (code, tests, fixtures, Actions logs), or the mind's briefing.
3. **Scrubber** (one function, `scrubSecrets(text)`; as built 2026-11-18 it is `frontend/astra/src/lab/scrub.js`, used by the lab's reports, while error reports use `frontend/ui/scrub.js`): replaces
   every `https?://` URL with `<host>/…` and every query value named `token`, `apikey`, `api_key`, `key`
   with `***`, and any 32+ character hex or base64url run with `***`. Check: unit tests with fixture
   add-on URLs (invented hosts).
4. Fixture add-ons in tests use invented hosts (`addon.example`) and invented tokens.
5. **As built (2026-11-15):** "Check playback in the lab" sends the stream address in the fragment
   (`lab/#src=…`), which never reaches a server or a cache key, and the lab removes it from the address
   bar and history as soon as it has read it (`?src=` still works and is removed the same way). Astra's
   saved copy never keys a cache by a query: pages are saved by address alone, the page reports its
   files without query or fragment, and the worker's activate step deletes any entry an earlier
   version saved with one. The skip-times lookup (below) sends no add-on, stream or title name.
6. **Owner rulings 2026-11-18 (replacing 2026-11-15's TorBox reads):** the page no longer reads TorBox
   or holds its key as such (a file link it gets may carry the account's token, rule 3). A stream's
   link, and the hash and file facts the page reads from it, go only to the owner's Worker, in a POST
   body (never a path, a query or storage); the Worker logs and stores none of them (it remembers a
   torrent's TorBox id and file list by hash in its own memory for half an hour, so the next ask is
   quick), and its notes and reasons are fixed sentences. Resolved addresses stay in the page's
   memory only (`frontend/astra/README.md` says for how long). A film's header and index kept on the
   phone (IndexedDB `astra-films`) are keyed by the file's size and a SHA-256 of its first 64 KiB,
   never by its address; what the device learnt about its decoders (localStorage `astra-routes`) holds
   codec names only.

### 5.3 Server copy (Worker-encrypted), as built (2026-11-19)

The owner agreed (2026-11-19) that Astra's data follows their sign-in: "any phone I sign in on, nothing
to set up". The add-on list, whose addresses are secrets, is kept on the owner's server only sealed by
the Worker (rule 3).

- **Routes** (`backend/src/areas/astra/backup.ts`, shapes in `shared/contract/astra.ts`), the owner's
  device sessions only (route table `D`: the mind, Muse, reflex and CI get 403), `Cache-Control:
  no-store`, 30 requests a minute per isolate (then 429): `GET /v1/astra/backup` →
  `{version, saved_at, copy}` (all null when none is kept; `copy` null alone when what is kept does not
  open), `PUT /v1/astra/backup` `{base, copy}` → `{version, saved_at}`, or `409 conflict` when `base` is
  not the version kept now (another phone saved first), `DELETE /v1/astra/backup` → 204. Without the
  bucket binding every route answers `503 unavailable` and the page carries on alone.
- **The copy** is `{"astra": "sync/1", "keys": {<key>: {"at", "value", "gone"?}}}` for the
  `BACKUP_KEYS`: `value` as the store holds it, `at` when the key last changed on a phone (ms), `gone`
  (progress, watched, library) the removed entries with when. The Worker checks only that outer shape (an
  object, the tag, known keys, each with a time and a value; `DEVICE_KEYS` never travel), at most 2 MiB as
  sent (`413 too_large` beyond; a heavy real-shaped store of 2,000 progress entries, 500 library titles
  and 3,000 watched episodes is 1.72 MiB; a full phone at Astra's own 300 progress entries about 0.5 MiB),
  and never reads, parses further or logs what the keys hold. Errors name a rule, never a value sent.
- **At rest** (`backup-seal.ts`, `backup-store.ts`): sealed whole with AES-256-GCM, a fresh 12-byte nonce
  each time, under a key HKDF-SHA-256 derives from `AUTH_PEPPER` (salt `thunderhead`, info `astra.backup`),
  as the Drive grant's is; the additional data is the object's name and the version, so a copy opens only
  where and as what it was written. It lives in `thunderhead-private` at `astra/backup.json.enc`, with only
  its version and save time as metadata. `version` is a new UUIDv7 each save; the write is conditional
  (`If-None-Match: *` when none is kept, else the etag read just before), so two phones saving on the same
  version cannot both win.
- **Daily copies, undone by hand:** the first save of a UTC day first copies the kept object, sealed as it
  is, to `astra/days/<YYYY-MM-DD>.json.enc`; the newest 7 are kept. Its additional data still names the
  main object, so it opens only put back there: to undo a bad merge, copy a day's object (with its
  metadata) over `astra/backup.json.enc`; the phones take it at their next fetch. `DELETE` removes the
  copy and every daily one.
- **Pepper rotation** follows the Drive grant: `AUTH_PEPPER` is never overwritten (SECURITY.md §11); if
  it ever were, the copy would no longer open, `GET` would answer `copy: null`, and the next phone's save
  would replace it with what the phones hold (the daily copies would stay unreadable).
- **The page** (`frontend/astra/src/app/sync.js`, the merge in `sync-merge.js`): signed out, or with
  Settings › Your data › "Keep Astra the same on every phone I sign in on" off, nothing is hooked or sent.
  Signed in it fetches and merges shortly after start (never before the first paint), back in front after
  more than 5 minutes, and before each save; a save goes out a minute after the last change, and as a
  keepalive request when the page is hidden (when it fits in 63 KiB; else on the next start). Offline,
  5xx, 503 and three conflicts in a row stay quiet and are tried again later (1, 2, 5, 10, then 30
  minutes). The merge: progress, watched and library entry by entry by their own times (`updated`, the
  time marked, `added`), removals kept as tombstones for 60 days so they never come back; add-ons,
  settings and recent searches whole, the newer change winning, a change stamped later than the time
  this phone last saw for the key (so a phone whose clock is behind still wins with a change it made
  after seeing the other's); a phone's first merge puts both sides together (add-ons by address, settings
  field by field) and a phone with nothing but defaults takes the server's. Every server value passes the
  store's own sanitisers, all or nothing per key; merged values are written through the store and
  announced as another window's write, so every open screen follows; the title playing keeps its own
  progress. The device-only record (`localStorage` `astra.sync.v1`: the switch, each key's last change,
  the tombstones, the version last merged, when it last saved and fetched) is outside `astra.v2.*`, so a
  backup never carries it. Merged progress is written into the senses reader's last look as well
  (`sync-senses.js`), so another phone's watching is never reported as watching here.
- **Checks:** `backend/tests/integration/astra-backup.test.ts` (each token role, round trip, conflict and
  a race, 413, the shape, 503, the count), `astra-backup-seal.test.ts` (no plain text of an add-on
  address in the bucket, a tampered copy refused, the daily copies, a log capture), `tests/astra-sync.test.mjs`
  (the merge), `tests/astra-sync-engine.test.mjs` (the engine on the real store), `tests/astra-sync-browser.test.mjs`
  (two phones in Chromium).

---

## 6. Licences

| Component | Licence | Verdict |
|---|---|---|
| mediabunny 1.55.7 (`mediabunny.js`) | MPL-2.0 | Keep (file-level copyleft; we ship it unmodified with its licence). Consider updating to the current release when touching the engine. **As built (2026-11-15):** 1.66.0. |
| `@mediabunny/ac3`, `@mediabunny/dts` 1.55.7 | MPL-2.0 wrappers around FFmpeg decoders compiled to WebAssembly, which FFmpeg licenses as LGPL-2.1+ | Keep. The package README's FFmpeg configure line shows no `--enable-gpl` **[verify against the package's build script when updating]**. **As built (2026-11-15):** 1.66.0, with `@mediabunny/truehd` 1.66.0 (Dolby TrueHD, the same kind of FFmpeg build) beside them. |
| hls.js 1.6.13 | Apache-2.0 | Vendor (§2 #7). **Vendored 2026-11-15** (`vendor/hls/`, its licence beside it). |
| dash.js 5.2.0 | BSD-3-Clause | Vendor (§2 #7). **Vendored 2026-11-15** (`vendor/dash/`); its build also holds `buffer`, `ieee754`, codem-isoboxer and a `String.fromCodePoint` polyfill (MIT, BSD-3-Clause), whose notices ship beside it. |
| JASSUB 2.5.37 (`vendor/jassub/`, added 2026-11-15) | MIT for JASSUB itself; inside its WebAssembly: libass (ISC), FreeType (FTL, chosen over GPL-2.0), HarfBuzz (MIT-Modern-Variant), GNU FriBidi (LGPL-2.1+), Brotli and mimalloc (MIT), Emscripten's runtime; bundled with abslink (Apache-2.0), rvfc-polyfill (GPL-3.0, inactive in Chrome) and throughput (MIT); Liberation Sans (OFL 1.1) as the fallback font | Keep. Every part, its licence and its source are listed in `vendor/LICENSES.md`; the LGPL part is linked into separate `.wasm` files anyone can rebuild and replace. rvfc-polyfill is a GPL file shipped under the owner's any-licence ruling (AGENTS.md, 2026-11-09), its source public. |
| AMD FidelityFX Super Resolution 1.0 (EASU, RCAS), ported in `src/enhance/fsr.js` (added 2026-11-15) | MIT (Advanced Micro Devices) | Keep, with its notice in the file and in `src/enhance/LICENSES.md`. The de-band pass beside it is Astra's own. |
| Anime4K "Upscale CNN x2 (S)" and "Restore CNN (S)" shaders, in `src/enhance/anime4k-upscale.js` and `anime4k-restore.js` (added 2026-11-15) | MIT (bloc97) | Keep, with its notice in the files and in `src/enhance/LICENSES.md`. |
| libmedia 1.3.1 (AVPlayer JS) | LGPL-3.0 | Its JavaScript alone would be allowed, but it is useless without its decoders. |
| libmedia FFmpeg decoders (`decode/*.wasm`, `resample`, `stretchpitch`) | **GPL-3.0 in effect.** At the pinned commit (`152f629…`), `build/build-ffmpeg-decoder.sh` and `build/build-ffmpeg-util.sh` configure FFmpeg with `--enable-gpl --enable-version3`. FFmpeg built with `--enable-gpl` is distributed under the GPL. (The old repo ships no x264/x265 encoders, which upstream names as its GPL parts, but the decoder build flag alone settles it.) | **Kept by owner ruling 2026-10-28** (owner has permission; named exception to the no-GPL rule). Ship its licence files beside it. |
| Nuvio, Stremio web | GPL | Design references only; nothing copied (as today). |

**Why libmedia stays:** without it, Astra could not play 10-bit H.264 (common for anime releases), HEVC/VP9/AV1 on phones without a hardware decoder, or AVI/FLV/MPEG-PS files. Owner ruling 2026-10-28 keeps it.

**Option B [proposal]:** build our own LGPL-only FFmpeg decoders (same decoder list, no
`--enable-gpl`) in a `workflow_dispatch` Action. It handles only public source code, so public logs are
fine. Ship it only if the A15 codec test shows real files the owner watches that need it.

Check: a CI licence test reads every `vendor/*/LICENSE*` and fails on GPL/AGPL text unless the file is
the LGPL's included copy of the GPL or libmedia's own licence (the named exception).

---

## 7. Migration of the owner's Astra data

**At the port:** the owner uses Astra's own **Export a backup** on the old site and **Restore** on the
new one (Settings → Your data); nothing in Astra changes for it. The server route below is a later
step, only if the owner agrees.

Full procedure: [MIGRATION.md](../../engineering/MIGRATION.md) §5. Astra's part:

1. The old site's export page reads `astra.v2.*` and builds a `backup/1` object with
   `Object.fromEntries(BACKUP_KEYS.map(k => [k, value]))`, exactly as Astra's own **Export a backup** does.
   It also carries `DEVICE_KEYS.player` (player preferences) as a separate field `astra_device`.
2. It is sent with the rest of the phone export to `POST /v1/import/phone`. The Worker moves
   `data.addons` into the sealed store (§5.3) immediately and keeps only counts in the import record.
3. On first start of the new Astra, if `astra.v2.*` is empty and the server has a backup, Astra calls
   `GET /v1/astra/backup` and runs its own `restoreBackup()`. The message shows the counts, e.g.
   "Restored 4 add-ons, 37 saved, 6 in progress, 112 watched, settings."
4. The owner compares with the old Astra's Settings → Your data counts. Match = done.

Check: an end-to-end browser test with an invented backup: export page → Worker → new Astra →
same counts, add-on URLs never present in any captured log or event.

---

## 8. Tests that move over

| Old | New |
|---|---|
| `tests/astra-*.test.mjs` | `tests/astra/*.test.mjs` (`node --test`), unchanged logic (all suites move over unchanged at the port; the edits below come with the later rows) |
| `backend/tests/astra-playback-browser.test.js` | `tests/browser/astra-playback.spec.mjs` (`@playwright/test`) |
| `backend/tests/astra-player-browser.test.js` | `tests/browser/astra-player.spec.mjs` |
| `backend/tests/astra-shell-browser.test.js` | `tests/browser/astra-shell.spec.mjs` |
| `backend/tests/astra-app-browser.test.js` | `tests/browser/astra-app.spec.mjs` (classic-import cases removed; server-restore cases added) |
| `backend/tests/helpers/astra-media-server.js` | `tests/helpers/astra-media-server.mjs` |
| `scripts/astra/make-fixtures.sh` | `scripts/astra/make-fixtures.sh` (needs ffmpeg locally; fixtures are synthetic tones) |
| `scripts/astra/vendor.mjs --check` | `scripts/vendor.mjs --check` (shared for all vendored libraries) |

New tests: the stream rule (§4.4), the scrubber (§5.2), the backup endpoint roles (§5.3), the CSP and
font checks (§2), and the `?open=` deep link.

**As built (2026-11-15):** Astra's tests are `tests/astra-*.test.mjs` in the root `node --test` run,
the browser ones (`*-browser.test.mjs`) through Playwright against films from a local file host
(`tests/fixtures/astra-host.mjs`) that can misbehave on purpose. The films are made by
`scripts/astra/fixtures.sh` and committed (`tests/fixtures/astra/`, about 3.4 MB); `node
scripts/astra/vendor.mjs --check` checks the vendored files. Each file is listed in
`frontend/astra/README.md`, Tests.

---


## The mind's arrangement slot (2026-11-04, verbs batch 2)

One slot, one kind ([BEHAVIOR.md §3.1](../../mind/BEHAVIOR.md#31-rung-0-silent-arrangement), API.md §11.11 "The apps' arrangements"): `astra/tonight`, kind `shortlist`, placed by `astra.shortlist`: "three for tonight", two or three titles and up to three filters for the owner to pick from; it never picks or plays. It carries its why behind a tap, and the app reports it seen, taken up or dismissed (`arrangement.seen`, `arrangement.tap`, `arrangement.dismiss`), so the meter and what lands count it.

**As built (2026-11-04, `frontend/astra/src/ui/components.js` `mountTonight`):** a card on Home under the hero ("Three for tonight"): each title a button that opens it, the filters under it, Why and Dismiss. It never picks or plays.

## The player, as built (2026-11-15)

The player was hardened and gained these on 2026-11-15. Paths are under
`frontend/astra/src/`; how each behaves is in `frontend/astra/README.md`. Nothing in it plays,
skips or picks a stream by itself.

| Capability | Where |
|---|---|
| The screen split into parts that each shut down on close | `player/player-screen.js`, `view.js`, `controls.js`, `menus.js`, `surface.js`, `timeline.js`, `markers.js`, `loading.js`, `system.js` |
| Playback menu: speed 0.5x to 2x (pitch kept), sleep timer (15 to 60 min, end of episode), repeat a part (A–B), Sound only | `player/playback.js`, `sleep.js`, `repeat.js`, `sound-only.js` |
| Volume, brightness and speed remembered; "Start over" after a resume | `player/prefs.js`, `extras.js`, `resume.js` |
| Seek bar: skippable parts, chapter marks, chapter names while dragging; live streams marked Live | `player/marks.js`, `timeline.js` |
| Frame step while paused; Save this frame (PNG named by title and time) | `player/frames.js` |
| Pinch to zoom, 1x to 4x, and moving the zoomed picture | `player/zoom.js`, `gestures.js` |
| Subtitle delay in 0.1 s and 1 s steps; Find a line; a second subtitle track | `player/subtitle-menu.js`, `find.js`, `engine/player-second.js` |
| ASS/SSA drawn by libass with the film's attached fonts | `subtitles/libass.js`, `engine/player-libass.js`, `engine/mkv-attachments.js` |
| Data used so far; the data saver (Settings › Playback) | `player/info-extras.js`, `engine/player-data.js` |
| Sound tab: volume boost, night mode, dialogue, sound delay | `player/sound-menu.js`, `enhance/sound.js`, `enhance/sound-chain.js`, `engine/player-sound.js` |
| Picture: sharpen (AMD FSR 1.0) and smooth banding, off for HDR, stepping itself down | `player/picture-menu.js`, `enhance/picture.js`, `filter.js`, `fsr.js` |
| Skip intro: found by sound on the phone, or looked up for anime | `app/skip.js`, `engine/intro-finder.js`, `fingerprint.js`, `fingerprint-match.js`, `sound-tap.js`, `app/intro-store.js`, `addons/skip-times.js` |
| Dolby TrueHD sound; chapters; MPEG-TS start times; a stall watchdog | `engine/audio-decoders.js`, `chapters.js`, `stall-watch.js` |
| How a stream will play on this phone, on its card | `addons/device-facts.js`, `screens/streams.js` |
| The next episode opening its sources and waiting (§4.4) | `app/playing.js` |

**Skip intro's two sources and their privacy.** *Found by sound* (Settings › Playback › Find intros
by sound, on by default) works entirely on the phone: while an episode plays, Astra fingerprints the
sound of its first six and last four minutes and matches it against episodes of the same series it
heard before; the fingerprints and segments stay in the browser's IndexedDB (`astra-intro`) and
nothing is sent anywhere. It only hears films Astra re-wraps itself (`remux`), not ones Chrome plays
directly, HLS or DASH streams, or the software decoder. *Looked up* (Settings › Playback › Look up
anime skip times) is **off unless the owner turns it on**. Then, for a series with a MyAnimeList,
Kitsu or (first season only) IMDb id, it sends that public id to `api.ani.zip` to learn the
MyAnimeList id, and the MyAnimeList id, the episode number and the file's length in whole seconds to
`api.aniskip.com`; no cookies, no referrer, no add-on, stream or title name. Either way the Skip
button only offers: nothing skips without a tap.

## The player, as built (2026-11-15, second round)

Added in the second round of 2026-11-15, under the owner ruling of that day (rule 2, §4.4). Paths are
under `frontend/astra/src/`; how each behaves is in `frontend/astra/README.md`. Nothing in it plays
or picks a stream by itself.

| Capability | Where |
|---|---|
| Reads answered as bytes arrive; only what is asked for fetched while a film is described; read-ahead and cache sized by the film's bitrate, asked for in bounded requests | `engine/http-source.js`, `source-stream.js`, `source-blocks.js`, `source-tuning.js` |
| A film's end asked for beside its start; side reads that never disturb playback; downloads asked again when the network changes | `engine/source-tail.js`, `side-read.js`, `http-source.js` |
| A film's header and index remembered on the phone (by size and a hash of its first 64 KiB) | `engine/film-memory.js`, `file-hash.js` |
| Astra's own Matroska reader: packets as a cluster's bytes arrive, seeks by the cue index, Mediabunny as the fallback | `engine/mkv-packets.js`, `mkv-blocks.js`, `mkv-sink.js` |
| Every readable film unpacked by Astra; Dolby Digital, DD+ and DTS passed to the phone's decoder where it has one; failed routes remembered 30 days | `engine/plan.js`, `player-routes.js`, `route-memory.js` |
| HLS and DASH with a phone's settings: level capped to the player, buffer targets, the saver's 720p ceiling | `engine/adaptive.js`, `adaptive-tuning.js` |
| Get ready ahead: TorBox list and resolve before the tap; the next episode prepared (switch in Settings › Playback) | `app/ready.js`, `app/next-ready.js`, `addons/debrid.js`, `screens/streams.js`, `screens/settings.js` |
| Even loudness (BS.1770, -18 LUFS, remembered per title) and headphone surround | `enhance/loudness.js`, `leveller.js`, `headphone.js`, `sound-chain.js`, `player/sound-menu.js` |
| Upscaling: Standard (FSR 1.0) or Animation (Anime4K), stepping down; HDR films tone-mapped (BT.2390) | `enhance/anime4k.js`, `anime4k-upscale.js`, `anime4k-restore.js`, `tonemap.js`, `filter.js`, `picture.js`, `player/picture-menu.js` |
| Several cores (cross-origin isolation, libmedia threads): present, switched off | `frontend/astra/sw.js` (`ISOLATE`), `engine/software-threads.js` (`THREADS`) |

## The player, as built (2026-11-16, third round)

The experiments of the second round that proved themselves. Paths are under `frontend/astra/src/`;
how each behaves is in `frontend/astra/README.md`.

| What | Where |
|---|---|
| Seek previews: the key frame where a drag rests, in the seek bar's bubble (switch in the Playback menu; off with the data saver) | `engine/preview.js`, `preview-frames.js`, `preview-decode.js`, `player-preview.js`, `player/seek-preview.js` |
| Converted sound (Dolby Digital, DTS, TrueHD where the phone has no decoder) fed from Astra's own Matroska reader, so it starts with the picture | `engine/sound-stream.js` |
| Converted surround kept whole (FLAC) while Headphone surround is on | `engine/sound-six.js`, `player-sound.js`, `player/sound-menu.js` |
| HDR seen from the film's own frame on routes with no container facts (HLS, DASH, the browser's own player) | `enhance/picture.js` (`see`) |
| More files for the software decoder: H.264 in AVI, H.263 in 3GP, Windows Media sound in MKV (three recorded patches to libmedia's readers) | `engine/software.js`, `frontend/assets/libmedia/` (`licenses/libmedia-modifications.txt`) |
| Dolby Vision profile 5: colours corrected in the picture filter, without the per-frame reshaping (switch in the Picture section, on by default) | `enhance/dolby.js`, `tonemap.js`, `engine/mp4.js`, `player/picture-menu.js` |

## The relay, as built (2026-11-18)

`backend/src/areas/astra/`, shapes in `shared/contract/astra.ts`, rules in SECURITY.md §8.2; device
only, nothing stored or logged.

| Route | What |
|---|---|
| `POST /v1/astra/play` | `{link, hash?, fileIndex?, fileName?, fileSize?, mode}` → `{url, via, size, type, readable, steps}`. With `TORBOX_KEY` and a hash. A tap: createtorrent with `add_only_if_cached` (refused as not cached: 503), the torrent's files, requestdl for the phone's nearest server: 3 TorBox calls. A press: checkcached, the account's newest 100, requestdl; it never adds. A torrent found is remembered in the Worker's memory for 30 minutes: the next ask costs requestdl alone. The file by name, size or the one video; an index alone only when it names the one video; never a guess. TorBox's file address is handed over (it may carry the account's token); one on TorBox's API is asked again, never handed over. Otherwise `url: null`, and the page plays the add-on's link; following add-on forwards here only with `ASTRA_FOLLOW` `on`. Taps 30 a minute, presses 60 on their own count |
| `GET /v1/astra/torbox` | `{configured, ok, plan}`: whether the key is set and TorBox takes it, and the plan number |

Without the key (`none`, until the owner sets it: `backend/README.md`), the direct path is skipped and
the page plays the add-on's own link, as before the relay.

## Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Which codecs the A15 plays without libmedia (HEVC 8/10-bit, VP9 profile 2, AV1, 10-bit H.264) | Run the codec fixtures in the Astra lab on the A15; record results in decisions. |
| 2 | How often the owner's real streams needed the software path | Ask the owner; or add a temporary local-only counter in the old Astra (ask first: old-site deploy). |
| 3 | Day theme for Astra's browse screens: does the owner want Astra always dark? | Show both on the phone; owner picks. Default: follows the site theme, player always black. |
| 4 | Root service worker scope over `/astra/` with Astra's own Cache Storage use | Browser test in P8. |
| 5 | Whether cross-document view transitions feel right on the A15 between the shell and `/astra/` | Device check; fall back to no transition if a frame drop > 100 ms is measured. |
| 6 | The stream rule as a decisions line | Settled: recorded 2026-10-27 (owner). |

---

## Not built

Sections once marked as proposals that are not built and not in PLAN.md; their full text is in
[archive/NOT-BUILT-2026-11-02.md](../../archive/NOT-BUILT-2026-11-02.md).

- **§4.2 `astra.save`.** A verb that adds a title to Astra's Library (args `{ref}`, undo `astra.unsave`).
  Not built and not in PLAN.md.
