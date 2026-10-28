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
3. **Add-on URLs, stream URLs and the debrid token are secrets.** On the server they are stored only
   Worker-encrypted; they never appear in logs, senses, surfaces, errors, the mind's context or the repo.
4. **libmedia stays** (owner ruling 2026-10-28: the owner has permission, and it is Astra's software decoder for HEVC/AV1/VP9 without hardware support, 10-bit H.264 and AVI/FLV/MPEG-PS). mediabunny (MPL-2.0) stays too. libmedia is a named exception to the no-GPL rule; keep its licence files beside it.
5. **No third-party script origins** (later step, §2 #7). The as-is port keeps loading hls.js and
   dash.js as today; vendoring them waits for the owner's yes.
6. **The old backup format (`backup/1`) is the migration format.** The owner's Astra data arrives on
   the new site through it, checked and all-or-nothing, as Astra's own restore already does.
7. **Nothing plays without a tap**, including anything the mind arranged.

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
view transition is later), 8, 9, 15 and 16, plus root-absolute asset paths (the host serves `/astra`
without a redirect). **Every other row is a later step**, proposed after the port and built only if
the owner agrees.

| # | Change | Exact rule | Check |
|---|---|---|---|
| 1 | **Location** | Source moves to `frontend/apps/astra/` and is staged to `/astra/` as its own document. `scripts/stage.mjs` must **not** write a shell stub at `astra/index.html`: remove `astra` from `APP_ROUTES` when Astra lands (today's list includes it, which would overwrite Astra's page). | Stage test: `/astra/index.html` is Astra's, not the shell. |
| 2 | **Opening from the ring** | The ring's Astra bubble navigates to `/astra/` with a cross-document view transition (`@view-transition { navigation: auto }` on both documents). Back on Astra's Home returns to `/`. Video stopping on leave is correct. | Playwright: ring → Astra → back lands on Home. |
| 3 | **Tokens** | `src/styles/tokens.css` maps onto the Thunderhead tokens ([DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md)). Night: pure black `#000` background, surfaces from the night tokens. Day: the day tokens for browse screens. Accent: `#8b5cf6` for fills (selected tab, primary button, progress); text accent per the design system. **The player screen stays black in both themes.** | Visual snapshot in day and night at 390×844. |
| 4 | **Fonts** | Remove Astra's six static Inter files (`fonts/inter-400…900.woff2`). Use the shared self-hosted `/ui/fonts/Inter.woff2` (variable). Fraunces is not used in Astra (it is only the Thunderhead's voice). | Static test: no `woff2` under `apps/astra/`; total font bytes unchanged site-wide. |
| 5 | **Icons** | Astra's drawn icons are replaced by the shared Phosphor sprite where an equivalent exists; player glyphs that have no Phosphor match stay as Astra's own SVG. | Static test: no inline icon map duplicates a sprite symbol. |
| 6 | **Service worker** | Delete Astra's `sw.js` and its release logic. The root service worker (scope `/`) precaches Astra's files with the rest of the release. The root worker's activate step deletes only `th-<older>` caches, so Astra's `astra-data-v1` cache survives updates. The "Astra has been updated · Reload" toast is replaced by the shell's update rule (apply only when nothing is playing). | Browser test: offline start of `/astra/`; an update never reloads mid-play. |
| 7 | **Third-party scripts** | hls.js 1.6.13 (Apache-2.0) and dash.js 5.2.0 (BSD-3-Clause) are vendored at `/vendor/hls.js-1.6.13/` and `/vendor/dashjs-5.2.0/` with licences and sha256, loaded on demand as today. `cdn.jsdelivr.net` is removed from the CSP. | Static test: no `https://cdn.` in `apps/astra/`. |
| 8 | **CSP** | Astra keeps its own `<meta>` CSP (it is a separate document): `script-src 'self' 'wasm-unsafe-eval' blob:`; `connect-src 'self' https:` (add-ons are arbitrary hosts) plus the Worker origin; `media-src 'self' blob: https:`; `img-src 'self' data: blob: https:`; `worker-src 'self' blob:`; `base-uri 'none'`; `form-action 'none'`. The localhost entries are test-only and removed by stage. | Static test parses the meta tag. |
| 9 | **Error reports** | `/assets/error-report.js` is replaced by the shell's error reporter (`POST /v1/ops/errors`), with the secret scrubber of §5. | Unit test of the scrubber. |
| 10 | **`th` bridge** | Astra imports `/th/th.js` for `sense()`, verbs and sign-in state (same origin, same IndexedDB token). No other shell code. | Static test: Astra imports only `/th/th.js` from outside its folder. |
| 11 | **Senses** | `astra.watch` and friends (§3). | Sense schema tests. |
| 12 | **Verb** | `astra.open` (§4). | Verb tests. |
| 13 | **Deep link** | New route parameter: `/astra/?open=<type>:<id>[&s=<season>&e=<episode>]`, read once on start, then removed with `history.replaceState`. Opens **Details**, never Streams, never the player. | Browser test. |
| 14 | **Classic import** | The one-time copy from `astra.v1.*` is removed (the new origin has no classic data). Replaced by the migration import (§7). | Static test: no `astra.v1.` string. |
| 15 | **Software decoding** | Unchanged: libmedia comes over with Astra (owner ruling 2026-10-28). | Existing planner tests pass. |
| 16 | **Lab** | `/astra/lab/` stays as a developer page, not linked from the UI; its "copy a report" output passes through the scrubber (§5). | Unit test: the report contains no add-on path or token. |
| 17 | **Server backup** | Astra's `backup/1` is also kept, Worker-encrypted, on the server (§5.3), so a new device restores it after sign-in. | API test. |

Expected size: the port is a handful of lines; the later rows together are about 300–600 lines
changed plus deletions (fonts, SW, classic import).

---

## 3. Senses

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

| Field | Rule |
|---|---|
| Args | `{ref: "astra:<type>:<id>", season?: int, episode?: int}` — validated with a strict schema (unknown keys rejected by the Worker *and* by `verbs.js`). There is no argument for a stream, URL, add-on or quality, so a stream cannot be named. |
| Effect | If the shell is visible and the owner asked for something to watch in the last 10 minutes, navigate to `/astra/?open=…` (Details). Otherwise create the surface card "Ready in Astra: <title>" on Home's conversation with **Open**. |
| Example (owner ruling 2026-10-27) | "An anime I'd like, 20 min, under 200 MB": the mind uses the owner's past favourites to pick a fitting title from the add-ons' catalogs and opens it in Astra; the owner picks the stream. Needs §2 rows 12–13, so it arrives after the port, once the owner agrees. |
| Never | Opens Streams, starts the player, or resolves a debrid link. |
| Undo | `{verb: "astra.close"}` (returns to the previous screen). |
| Ledger | "Opened <title> in Astra — you asked for something under 25 minutes." (Law 3: the why). |

### 4.2 `astra.save` [proposal]

Adds a title to Astra's Library. Args `{ref}`. Undo `astra.unsave`. Shown in the Ledger.

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
3. **Playback needs a user gesture**: `PlayerScreen.open()` returns without playing unless
   `navigator.userActivation.isActive`. Check: calling it from a timer does nothing.
4. **The mind never sees streams**: the Worker holds no stream data; senses carry none (§3).

Recorded in [decisions.md](../../process/decisions.md) as an owner ruling (2026-10-27).

---

## 5. Secrets

### 5.1 What counts as a secret

| Item | Why |
|---|---|
| Every add-on URL | Configured add-ons carry their settings in the URL path, including debrid API keys inside resolve paths. Treat the whole URL as secret. |
| Stream URLs | Direct links often embed tokens (`…/requestdl?token=…`). |
| Debrid token | Account access. |
| OpenSubtitles hash/size | Not a secret, but not sent anywhere except the subtitle add-on. |

### 5.2 Rules

1. On the phone, add-ons stay in `localStorage` `astra.v2.addons` as today (Astra needs them in clear to
   call add-ons).
2. **Never** in: senses, surfaces, verbs, the Ledger, `POST /v1/ops/errors` payloads, Worker logs,
   GitHub (code, tests, fixtures, Actions logs), or the mind's briefing.
3. **Scrubber** (one function, `scrubSecrets(text)`, used by error reports and the lab report): replaces
   every `https?://` URL with `<host>/…` and every query value named `token`, `apikey`, `api_key`, `key`
   with `***`, and any 32+ character hex or base64url run with `***`. Check: unit tests with fixture
   add-on URLs (invented hosts).
4. Fixture add-ons in tests use invented hosts (`addon.example`) and invented tokens.

### 5.3 Server copy (Worker-encrypted)

- `PUT /v1/astra/backup` with the `backup/1` JSON, sent 60 s after the last change to add-ons, library,
  progress, watched or settings, and on `visibilitychange → hidden`.
- The Worker seals the whole body with AES-256-GCM under a Worker secret key (see
  [SECURITY.md](../../engineering/SECURITY.md) for the key name and rotation) and stores the ciphertext
  in `thunderhead-private/astra/backup.json.enc` plus the last 7 daily versions **[proposal]**.
- `GET /v1/astra/backup` returns the decrypted JSON **only to a signed-in owner device token**; agent
  tokens (the mind, Muse) get 403. Check: API test with each token role.
- The Worker never logs request or response bodies for `/v1/astra/*`. Check: a log-capture test asserts
  no body text appears.

---

## 6. Licences

| Component | Licence | Verdict |
|---|---|---|
| mediabunny 1.55.7 (`mediabunny.js`) | MPL-2.0 | Keep (file-level copyleft; we ship it unmodified with its licence). Consider updating to the current release when touching the engine. |
| `@mediabunny/ac3`, `@mediabunny/dts` 1.55.7 | MPL-2.0 wrappers around FFmpeg decoders compiled to WebAssembly, which FFmpeg licenses as LGPL-2.1+ | Keep. The package README's FFmpeg configure line shows no `--enable-gpl` **[verify against the package's build script when updating]**. |
| hls.js 1.6.13 | Apache-2.0 | Vendor (§2 #7). |
| dash.js 5.2.0 | BSD-3-Clause | Vendor (§2 #7). |
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

---

## Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Which codecs the A15 plays without libmedia (HEVC 8/10-bit, VP9 profile 2, AV1, 10-bit H.264) | Run the codec fixtures in the Astra lab on the A15; record results in decisions. |
| 2 | How often the owner's real streams needed the software path | Ask the owner; or add a temporary local-only counter in the old Astra (ask first: old-site deploy). |
| 3 | Day theme for Astra's browse screens: does the owner want Astra always dark? | Show both on the phone; owner picks. Default: follows the site theme, player always black. |
| 4 | Root service worker scope over `/astra/` with Astra's own Cache Storage use | Browser test in P8. |
| 5 | Whether cross-document view transitions feel right on the A15 between the shell and `/astra/` | Device check; fall back to no transition if a frame drop > 100 ms is measured. |
| 6 | The stream rule as a decisions line | Settled: recorded 2026-10-27 (owner). |
